// Package tickets implements a configurable, Jira-like ticketing service.
//
// A Project scopes tickets and decides how requests arrive: "team" (filed by
// org members) or "public" (submitted via an unguessable intake link, no
// account needed). Each project keeps its own ticket counter (KEY-<number>)
// and its own ordered status list, so different queues can run different
// workflows. Tickets carry status/priority/assignee and a comment thread.
package tickets

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a project or ticket can't be resolved.
var ErrNotFound = errors.New("not found")

// DefaultStatuses is the starting workflow for a new project.
var DefaultStatuses = []string{"open", "in_progress", "resolved", "closed"}

// Project is a ticket queue with its own intake rules and workflow.
type Project struct {
	ID          string
	OrgID       string
	Key         string
	Name        string
	Description string
	IntakeMode  string // "team" | "public"
	PublicToken string // empty unless intake is public
	Statuses    []string
	OpenCount   int // populated by ListProjects
	CreatedAt   time.Time
}

// Ticket is a single request within a project.
type Ticket struct {
	ID              string
	ProjectID       string
	OrgID           string
	ProjectKey      string // joined for display (KEY-<number>)
	Number          int64
	Title           string
	Body            string
	Status          string
	Priority        string
	RequesterUserID *string
	RequesterName   string
	RequesterEmail  string
	AssigneeUserID  *string
	Source          string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Comment is one entry on a ticket's thread.
type Comment struct {
	ID           string
	TicketID     string
	AuthorUserID *string
	AuthorName   string
	Body         string
	IsInternal   bool
	CreatedAt    time.Time
}

// Repository reads and writes tickets, projects and comments.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool. Returns nil if the
// pool is nil so callers can cleanly skip wiring the feature.
func NewRepository(pool *pgxpool.Pool) *Repository {
	if pool == nil {
		return nil
	}
	return &Repository{pool: pool}
}

func newToken() string {
	raw := make([]byte, 16)
	_, _ = rand.Read(raw)
	return "pt_" + hex.EncodeToString(raw)
}

// ---- Projects --------------------------------------------------------------

// ListProjects returns an org's projects (with open-ticket counts), newest first.
func (r *Repository) ListProjects(ctx context.Context, orgID string) ([]Project, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT p.id::text, p.org_id::text, p.key, p.name, p.description, p.intake_mode,
		        COALESCE(p.public_token,''), p.statuses, p.created_at,
		        COALESCE(c.n, 0)
		   FROM grown.ticket_projects p
		   LEFT JOIN (
		        SELECT project_id, COUNT(*) n FROM grown.tickets
		         WHERE status NOT IN ('resolved','closed') GROUP BY project_id
		   ) c ON c.project_id = p.id
		  WHERE p.org_id = $1
		  ORDER BY p.created_at DESC`, orgID)
	if err != nil {
		return nil, fmt.Errorf("tickets.ListProjects: %w", err)
	}
	defer rows.Close()
	var out []Project
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.OrgID, &p.Key, &p.Name, &p.Description, &p.IntakeMode,
			&p.PublicToken, &p.Statuses, &p.CreatedAt, &p.OpenCount); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreateProject makes a new queue. intakeMode "public" mints a public token.
func (r *Repository) CreateProject(ctx context.Context, orgID, userID, key, name, description, intakeMode string) (Project, error) {
	key = strings.ToUpper(strings.TrimSpace(key))
	if key == "" {
		key = "TKT"
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = key
	}
	intakeMode = normalizeIntake(intakeMode)
	var token *string
	if intakeMode == "public" {
		t := newToken()
		token = &t
	}
	var p Project
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.ticket_projects (org_id, key, name, description, intake_mode, public_token, statuses, created_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		 RETURNING id::text, org_id::text, key, name, description, intake_mode, COALESCE(public_token,''), statuses, created_at`,
		orgID, key, name, strings.TrimSpace(description), intakeMode, token, DefaultStatuses, nullUUID(userID)).
		Scan(&p.ID, &p.OrgID, &p.Key, &p.Name, &p.Description, &p.IntakeMode, &p.PublicToken, &p.Statuses, &p.CreatedAt)
	if err != nil {
		return Project{}, fmt.Errorf("tickets.CreateProject: %w", err)
	}
	return p, nil
}

// GetProject fetches one project scoped to its org.
func (r *Repository) GetProject(ctx context.Context, orgID, id string) (Project, error) {
	var p Project
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, org_id::text, key, name, description, intake_mode, COALESCE(public_token,''), statuses, created_at
		   FROM grown.ticket_projects WHERE id = $1 AND org_id = $2`, id, orgID).
		Scan(&p.ID, &p.OrgID, &p.Key, &p.Name, &p.Description, &p.IntakeMode, &p.PublicToken, &p.Statuses, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Project{}, ErrNotFound
	}
	if err != nil {
		return Project{}, fmt.Errorf("tickets.GetProject: %w", err)
	}
	return p, nil
}

// UpdateProject edits name/description/intake. Toggling intake to public mints a
// token; toggling away clears it.
func (r *Repository) UpdateProject(ctx context.Context, orgID, id, name, description, intakeMode string) (Project, error) {
	cur, err := r.GetProject(ctx, orgID, id)
	if err != nil {
		return Project{}, err
	}
	if strings.TrimSpace(name) != "" {
		cur.Name = strings.TrimSpace(name)
	}
	cur.Description = strings.TrimSpace(description)
	intakeMode = normalizeIntake(intakeMode)
	var token *string
	if intakeMode == "public" {
		if cur.PublicToken != "" {
			t := cur.PublicToken
			token = &t
		} else {
			t := newToken()
			token = &t
		}
	}
	err = r.pool.QueryRow(ctx,
		`UPDATE grown.ticket_projects
		    SET name = $3, description = $4, intake_mode = $5, public_token = $6
		  WHERE id = $1 AND org_id = $2
		 RETURNING id::text, org_id::text, key, name, description, intake_mode, COALESCE(public_token,''), statuses, created_at`,
		id, orgID, cur.Name, cur.Description, intakeMode, token).
		Scan(&cur.ID, &cur.OrgID, &cur.Key, &cur.Name, &cur.Description, &cur.IntakeMode, &cur.PublicToken, &cur.Statuses, &cur.CreatedAt)
	if err != nil {
		return Project{}, fmt.Errorf("tickets.UpdateProject: %w", err)
	}
	return cur, nil
}

// projectByToken resolves a public project by its intake token. Used unauthenticated.
func (r *Repository) projectByToken(ctx context.Context, token string) (Project, error) {
	var p Project
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, org_id::text, key, name, description, intake_mode, COALESCE(public_token,''), statuses, created_at
		   FROM grown.ticket_projects WHERE public_token = $1 AND intake_mode = 'public'`, token).
		Scan(&p.ID, &p.OrgID, &p.Key, &p.Name, &p.Description, &p.IntakeMode, &p.PublicToken, &p.Statuses, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Project{}, ErrNotFound
	}
	if err != nil {
		return Project{}, fmt.Errorf("tickets.projectByToken: %w", err)
	}
	return p, nil
}

// PublicProject returns the minimal project info a public intake form needs.
func (r *Repository) PublicProject(ctx context.Context, token string) (Project, error) {
	return r.projectByToken(ctx, token)
}

// ---- Tickets ---------------------------------------------------------------

// ListTickets returns a project's tickets, newest first. statusFilter "" = all.
func (r *Repository) ListTickets(ctx context.Context, orgID, projectID, statusFilter string) ([]Ticket, error) {
	q := `SELECT t.id::text, t.project_id::text, t.org_id::text, p.key, t.number, t.title, t.body,
	             t.status, t.priority, t.requester_user_id::text, t.requester_name, t.requester_email,
	             t.assignee_user_id::text, t.source, t.created_at, t.updated_at
	        FROM grown.tickets t JOIN grown.ticket_projects p ON p.id = t.project_id
	       WHERE t.project_id = $1 AND t.org_id = $2`
	args := []any{projectID, orgID}
	if strings.TrimSpace(statusFilter) != "" {
		q += ` AND t.status = $3`
		args = append(args, statusFilter)
	}
	q += ` ORDER BY t.created_at DESC`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("tickets.ListTickets: %w", err)
	}
	defer rows.Close()
	var out []Ticket
	for rows.Next() {
		t, err := scanTicket(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// CreateTicket files a ticket, atomically allocating the next per-project number.
func (r *Repository) CreateTicket(ctx context.Context, orgID, projectID, title, body, priority string, requesterUserID *string, requesterName, requesterEmail, source string) (Ticket, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return Ticket{}, errors.New("title required")
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Ticket{}, err
	}
	defer tx.Rollback(ctx)

	var key string
	var number int64
	// Bump the project counter and confirm the project belongs to the org.
	err = tx.QueryRow(ctx,
		`UPDATE grown.ticket_projects SET seq = seq + 1 WHERE id = $1 AND org_id = $2 RETURNING key, seq`,
		projectID, orgID).Scan(&key, &number)
	if errors.Is(err, pgx.ErrNoRows) {
		return Ticket{}, ErrNotFound
	}
	if err != nil {
		return Ticket{}, fmt.Errorf("tickets.CreateTicket bump: %w", err)
	}

	var t Ticket
	err = tx.QueryRow(ctx,
		`INSERT INTO grown.tickets (project_id, org_id, number, title, body, status, priority, requester_user_id, requester_name, requester_email, source)
		 VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10)
		 RETURNING id::text, project_id::text, org_id::text, number, title, body, status, priority,
		           requester_user_id::text, requester_name, requester_email, assignee_user_id::text, source, created_at, updated_at`,
		projectID, orgID, number, title, strings.TrimSpace(body), normalizePriority(priority),
		requesterUserID, strings.TrimSpace(requesterName), strings.TrimSpace(requesterEmail), source).
		Scan(&t.ID, &t.ProjectID, &t.OrgID, &t.Number, &t.Title, &t.Body, &t.Status, &t.Priority,
			&t.RequesterUserID, &t.RequesterName, &t.RequesterEmail, &t.AssigneeUserID, &t.Source, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return Ticket{}, fmt.Errorf("tickets.CreateTicket insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Ticket{}, err
	}
	t.ProjectKey = key
	return t, nil
}

// CreatePublicTicket files a ticket from a public intake link. Returns the
// ticket plus its display ref (KEY-<number>).
func (r *Repository) CreatePublicTicket(ctx context.Context, token, title, body, name, email string) (Ticket, string, error) {
	p, err := r.projectByToken(ctx, token)
	if err != nil {
		return Ticket{}, "", err
	}
	t, err := r.CreateTicket(ctx, p.OrgID, p.ID, title, body, "normal", nil, name, email, "public")
	if err != nil {
		return Ticket{}, "", err
	}
	return t, fmt.Sprintf("%s-%d", p.Key, t.Number), nil
}

// GetTicket fetches a ticket (org-scoped) and its comment thread.
func (r *Repository) GetTicket(ctx context.Context, orgID, id string) (Ticket, []Comment, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT t.id::text, t.project_id::text, t.org_id::text, p.key, t.number, t.title, t.body,
		        t.status, t.priority, t.requester_user_id::text, t.requester_name, t.requester_email,
		        t.assignee_user_id::text, t.source, t.created_at, t.updated_at
		   FROM grown.tickets t JOIN grown.ticket_projects p ON p.id = t.project_id
		  WHERE t.id = $1 AND t.org_id = $2`, id, orgID)
	t, err := scanTicket(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Ticket{}, nil, ErrNotFound
	}
	if err != nil {
		return Ticket{}, nil, fmt.Errorf("tickets.GetTicket: %w", err)
	}
	comments, err := r.listComments(ctx, id)
	if err != nil {
		return Ticket{}, nil, err
	}
	return t, comments, nil
}

// UpdateTicket patches mutable fields. Empty/nil patch values leave fields as-is
// (assignee uses a sentinel: pass a non-nil pointer to set, "" pointer to clear).
func (r *Repository) UpdateTicket(ctx context.Context, orgID, id string, status, priority, title, body *string, assignee *string, clearAssignee bool) (Ticket, error) {
	cur, _, err := r.GetTicket(ctx, orgID, id)
	if err != nil {
		return Ticket{}, err
	}
	if status != nil && strings.TrimSpace(*status) != "" {
		cur.Status = strings.TrimSpace(*status)
	}
	if priority != nil && strings.TrimSpace(*priority) != "" {
		cur.Priority = normalizePriority(*priority)
	}
	if title != nil && strings.TrimSpace(*title) != "" {
		cur.Title = strings.TrimSpace(*title)
	}
	if body != nil {
		cur.Body = strings.TrimSpace(*body)
	}
	switch {
	case clearAssignee:
		cur.AssigneeUserID = nil
	case assignee != nil && strings.TrimSpace(*assignee) != "":
		a := strings.TrimSpace(*assignee)
		cur.AssigneeUserID = &a
	}
	err = r.pool.QueryRow(ctx,
		`UPDATE grown.tickets
		    SET status = $3, priority = $4, title = $5, body = $6, assignee_user_id = $7, updated_at = now()
		  WHERE id = $1 AND org_id = $2
		 RETURNING id::text, project_id::text, org_id::text, number, title, body, status, priority,
		           requester_user_id::text, requester_name, requester_email, assignee_user_id::text, source, created_at, updated_at`,
		id, orgID, cur.Status, cur.Priority, cur.Title, cur.Body, cur.AssigneeUserID).
		Scan(&cur.ID, &cur.ProjectID, &cur.OrgID, &cur.Number, &cur.Title, &cur.Body, &cur.Status, &cur.Priority,
			&cur.RequesterUserID, &cur.RequesterName, &cur.RequesterEmail, &cur.AssigneeUserID, &cur.Source, &cur.CreatedAt, &cur.UpdatedAt)
	if err != nil {
		return Ticket{}, fmt.Errorf("tickets.UpdateTicket: %w", err)
	}
	return cur, nil
}

// ---- Comments --------------------------------------------------------------

func (r *Repository) listComments(ctx context.Context, ticketID string) ([]Comment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, ticket_id::text, author_user_id::text, author_name, body, is_internal, created_at
		   FROM grown.ticket_comments WHERE ticket_id = $1 ORDER BY created_at ASC`, ticketID)
	if err != nil {
		return nil, fmt.Errorf("tickets.listComments: %w", err)
	}
	defer rows.Close()
	var out []Comment
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.TicketID, &c.AuthorUserID, &c.AuthorName, &c.Body, &c.IsInternal, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// AddComment appends to a ticket's thread (after verifying org ownership).
func (r *Repository) AddComment(ctx context.Context, orgID, ticketID string, authorUserID *string, authorName, body string, isInternal bool) (Comment, error) {
	if strings.TrimSpace(body) == "" {
		return Comment{}, errors.New("comment body required")
	}
	if _, _, err := r.GetTicket(ctx, orgID, ticketID); err != nil {
		return Comment{}, err
	}
	var c Comment
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.ticket_comments (ticket_id, author_user_id, author_name, body, is_internal)
		 VALUES ($1,$2,$3,$4,$5)
		 RETURNING id::text, ticket_id::text, author_user_id::text, author_name, body, is_internal, created_at`,
		ticketID, authorUserID, strings.TrimSpace(authorName), strings.TrimSpace(body), isInternal).
		Scan(&c.ID, &c.TicketID, &c.AuthorUserID, &c.AuthorName, &c.Body, &c.IsInternal, &c.CreatedAt)
	if err != nil {
		return Comment{}, fmt.Errorf("tickets.AddComment: %w", err)
	}
	// Touch the ticket so it sorts as recently active.
	_, _ = r.pool.Exec(ctx, `UPDATE grown.tickets SET updated_at = now() WHERE id = $1`, ticketID)
	return c, nil
}

// ---- helpers ---------------------------------------------------------------

type rowScanner interface {
	Scan(dest ...any) error
}

func scanTicket(row rowScanner) (Ticket, error) {
	var t Ticket
	err := row.Scan(&t.ID, &t.ProjectID, &t.OrgID, &t.ProjectKey, &t.Number, &t.Title, &t.Body,
		&t.Status, &t.Priority, &t.RequesterUserID, &t.RequesterName, &t.RequesterEmail,
		&t.AssigneeUserID, &t.Source, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

func normalizeIntake(m string) string {
	if strings.ToLower(strings.TrimSpace(m)) == "public" {
		return "public"
	}
	return "team"
}

func normalizePriority(p string) string {
	switch strings.ToLower(strings.TrimSpace(p)) {
	case "low":
		return "low"
	case "high":
		return "high"
	case "urgent":
		return "urgent"
	default:
		return "normal"
	}
}

// nullUUID turns "" into a nil arg so an empty user id stores as NULL.
func nullUUID(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}
