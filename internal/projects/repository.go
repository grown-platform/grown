// Package projects is the data-access + service layer for the Linear-style
// issue tracker (teams, issues, projects, labels, comments).
package projects

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no row matches the given id within the org.
var ErrNotFound = errors.New("not found")

// ErrNotOrgMember is returned when adding a user to a team who is not an org member.
var ErrNotOrgMember = errors.New("user is not a member of this org")

// ── Domain types ─────────────────────────────────────────────────────────────

type Team struct {
	ID         string
	OrgID      string
	Name       string
	Key        string
	Color      string
	Icon       string
	IssueCount int32
	CreatedAt  time.Time
}

type Issue struct {
	ID            string
	OrgID         string
	TeamID        string
	TeamKey       string
	Number        int32
	Title         string
	Description   string
	Status        string
	Priority      int32
	AssigneeID    string
	AssigneeName  string
	LabelIDs      []string
	ProjectID     string
	Estimate      int32
	SortOrder     float64
	CreatorID     string
	CreatedAt     time.Time
	UpdatedAt     time.Time
	ParentIssueID string // empty = top-level
	SubIssueCount int32  // total direct children (non-trashed)
	SubIssueDone  int32  // children with status "done" or "canceled"
}

// Identifier returns the KEY-N display identifier.
func (i Issue) Identifier() string {
	if i.TeamKey == "" {
		return ""
	}
	return fmt.Sprintf("%s-%d", i.TeamKey, i.Number)
}

type Project struct {
	ID          string
	OrgID       string
	Name        string
	Description string
	Color       string
	Icon        string
	State       string
	LeadID      string
	LeadName    string
	TargetDate  string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Label struct {
	ID        string
	OrgID     string
	Name      string
	Color     string
	CreatedAt time.Time
}

type Comment struct {
	ID         string
	IssueID    string
	AuthorID   string
	AuthorName string
	Body       string
	CreatedAt  time.Time
}

// IssueFields bundles the editable attributes of an issue for Create.
type IssueFields struct {
	Title         string
	Description   string
	Status        string
	Priority      int32
	AssigneeID    string
	LabelIDs      []string
	ProjectID     string
	Estimate      int32
	ParentIssueID string // empty = top-level
}

// IssuePatch is a partial update: only fields whose *Set flag is true change.
type IssuePatch struct {
	Title         string
	TitleSet      bool
	Description   string
	DescSet       bool
	Status        string
	StatusSet     bool
	Priority      int32
	PrioSet       bool
	AssigneeID    string
	AssigneeSet   bool
	LabelIDs      []string
	LabelsSet     bool
	ProjectID     string
	ProjectSet    bool
	Estimate      int32
	EstimateSet   bool
	SortOrder     float64
	SortSet       bool
	ParentIssueID string // empty = clear parent
	ParentSet     bool
}

type ProjectFields struct {
	Name        string
	Description string
	Color       string
	Icon        string
	State       string
	LeadID      string
	TargetDate  string
}

// IssueFilter constrains ListIssues. Empty strings mean "no constraint".
// Special value "none" for ParentIssueID means top-level only (IS NULL).
type IssueFilter struct {
	TeamID        string
	ProjectID     string
	AssigneeID    string
	Status        string
	ParentIssueID string // "" = all, "none" = top-level only, any UUID = children of that parent
}

// Repository reads and writes the tracker entities.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// Member is an org user assignable to issues.
type Member struct {
	ID    string
	Name  string
	Email string
}

// ListMembers returns the org's users (for assignee / lead pickers).
func (r *Repository) ListMembers(ctx context.Context, orgID string) ([]Member, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, COALESCE(NULLIF(display_name,''), email, ''), COALESCE(email,'')
		 FROM grown.users WHERE org_id=$1 ORDER BY lower(COALESCE(NULLIF(display_name,''), email))`, orgID)
	if err != nil {
		return nil, fmt.Errorf("projects.ListMembers: %w", err)
	}
	defer rows.Close()
	var out []Member
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.ID, &m.Name, &m.Email); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func jsonArr(s []string) []byte {
	if s == nil {
		s = []string{}
	}
	b, _ := json.Marshal(s)
	return b
}

func nullable(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// ── Teams ────────────────────────────────────────────────────────────────────

const teamCols = `id::text, org_id::text, name, key, color, icon, issue_count, created_at`

func scanTeam(row pgx.Row) (Team, error) {
	var t Team
	err := row.Scan(&t.ID, &t.OrgID, &t.Name, &t.Key, &t.Color, &t.Icon, &t.IssueCount, &t.CreatedAt)
	return t, err
}

func (r *Repository) ListTeams(ctx context.Context, orgID string) ([]Team, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+teamCols+` FROM grown.project_teams WHERE org_id=$1 ORDER BY name`, orgID)
	if err != nil {
		return nil, fmt.Errorf("projects.ListTeams: %w", err)
	}
	defer rows.Close()
	var out []Team
	for rows.Next() {
		t, err := scanTeam(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *Repository) GetTeam(ctx context.Context, orgID, id string) (Team, error) {
	t, err := scanTeam(r.pool.QueryRow(ctx, `SELECT `+teamCols+` FROM grown.project_teams WHERE id=$1 AND org_id=$2`, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Team{}, ErrNotFound
	}
	return t, err
}

func (r *Repository) CreateTeam(ctx context.Context, orgID, name, key, color, icon string) (Team, error) {
	q := `INSERT INTO grown.project_teams (org_id, name, key, color, icon)
		VALUES ($1,$2,$3,COALESCE(NULLIF($4,''),'#6e79d6'),$5) RETURNING ` + teamCols
	t, err := scanTeam(r.pool.QueryRow(ctx, q, orgID, name, key, color, icon))
	if err != nil {
		return Team{}, fmt.Errorf("projects.CreateTeam: %w", err)
	}
	return t, nil
}

func (r *Repository) UpdateTeam(ctx context.Context, orgID, id, name, color, icon string) (Team, error) {
	q := `UPDATE grown.project_teams
		SET name=$3, color=COALESCE(NULLIF($4,''),'#6e79d6'), icon=$5
		WHERE id=$1 AND org_id=$2 RETURNING ` + teamCols
	t, err := scanTeam(r.pool.QueryRow(ctx, q, id, orgID, name, color, icon))
	if errors.Is(err, pgx.ErrNoRows) {
		return Team{}, ErrNotFound
	}
	if err != nil {
		return Team{}, fmt.Errorf("projects.UpdateTeam: %w", err)
	}
	return t, nil
}

func (r *Repository) DeleteTeam(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.project_teams WHERE id=$1 AND org_id=$2`, id, orgID)
	if err != nil {
		return fmt.Errorf("projects.DeleteTeam: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Team members ──────────────────────────────────────────────────────────────

// IsOrgMember reports whether userID belongs to orgID (guards AddTeamMember).
func (r *Repository) IsOrgMember(ctx context.Context, orgID, userID string) (bool, error) {
	var ok bool
	err := r.pool.QueryRow(ctx,
		`SELECT true FROM grown.users WHERE id=$1 AND org_id=$2`, userID, orgID).Scan(&ok)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return ok, err
}

func (r *Repository) AddTeamMember(ctx context.Context, orgID, teamID, userID string) error {
	// Verify team belongs to org.
	if _, err := r.GetTeam(ctx, orgID, teamID); err != nil {
		return err
	}
	// Verify user is an org member.
	ok, err := r.IsOrgMember(ctx, orgID, userID)
	if err != nil {
		return fmt.Errorf("projects.AddTeamMember check: %w", err)
	}
	if !ok {
		return ErrNotOrgMember
	}
	_, err = r.pool.Exec(ctx,
		`INSERT INTO grown.project_team_members (team_id, user_id) VALUES ($1,$2)
		 ON CONFLICT DO NOTHING`, teamID, userID)
	if err != nil {
		return fmt.Errorf("projects.AddTeamMember: %w", err)
	}
	return nil
}

func (r *Repository) RemoveTeamMember(ctx context.Context, orgID, teamID, userID string) error {
	// Verify team belongs to org.
	if _, err := r.GetTeam(ctx, orgID, teamID); err != nil {
		return err
	}
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.project_team_members WHERE team_id=$1 AND user_id=$2`,
		teamID, userID)
	if err != nil {
		return fmt.Errorf("projects.RemoveTeamMember: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) ListTeamMembers(ctx context.Context, orgID, teamID string) ([]Member, error) {
	// Verify team belongs to org.
	if _, err := r.GetTeam(ctx, orgID, teamID); err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx,
		`SELECT u.id::text, COALESCE(NULLIF(u.display_name,''), u.email, ''), COALESCE(u.email,'')
		 FROM grown.project_team_members tm
		 JOIN grown.users u ON u.id = tm.user_id
		 WHERE tm.team_id=$1
		 ORDER BY lower(COALESCE(NULLIF(u.display_name,''), u.email))`, teamID)
	if err != nil {
		return nil, fmt.Errorf("projects.ListTeamMembers: %w", err)
	}
	defer rows.Close()
	var out []Member
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.ID, &m.Name, &m.Email); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListAssignable returns team members when teamID is non-empty, else org members.
func (r *Repository) ListAssignable(ctx context.Context, orgID, teamID string) ([]Member, error) {
	if teamID != "" {
		members, err := r.ListTeamMembers(ctx, orgID, teamID)
		if err != nil {
			return nil, err
		}
		// Fall back to org members when the team has no explicit members yet.
		if len(members) > 0 {
			return members, nil
		}
	}
	return r.ListMembers(ctx, orgID)
}

// ── Issues ───────────────────────────────────────────────────────────────────

// issueSelect joins the team (for the key) and assignee (for display name).
// Sub-issue counts are computed inline via correlated subqueries.
const issueSelect = `SELECT i.id::text, i.org_id::text, i.team_id::text, t.key, i.number,
	i.title, i.description, i.status, i.priority,
	COALESCE(i.assignee_id::text,''), COALESCE(NULLIF(u.display_name,''), u.email, ''),
	i.label_ids, COALESCE(i.project_id::text,''), i.estimate, i.sort_order,
	i.creator_id::text, i.created_at, i.updated_at,
	COALESCE(i.parent_issue_id::text,''),
	(SELECT COUNT(*) FROM grown.project_issues c WHERE c.parent_issue_id = i.id AND c.trashed_at IS NULL)::int,
	(SELECT COUNT(*) FROM grown.project_issues c WHERE c.parent_issue_id = i.id AND c.trashed_at IS NULL AND c.status IN ('done','canceled'))::int
	FROM grown.project_issues i
	JOIN grown.project_teams t ON t.id = i.team_id
	LEFT JOIN grown.users u ON u.id = i.assignee_id`

func scanIssue(row pgx.Row) (Issue, error) {
	var i Issue
	var labels []byte
	err := row.Scan(&i.ID, &i.OrgID, &i.TeamID, &i.TeamKey, &i.Number,
		&i.Title, &i.Description, &i.Status, &i.Priority,
		&i.AssigneeID, &i.AssigneeName, &labels, &i.ProjectID, &i.Estimate, &i.SortOrder,
		&i.CreatorID, &i.CreatedAt, &i.UpdatedAt,
		&i.ParentIssueID, &i.SubIssueCount, &i.SubIssueDone)
	if err != nil {
		return Issue{}, err
	}
	_ = json.Unmarshal(labels, &i.LabelIDs)
	return i, nil
}

func (r *Repository) ListIssues(ctx context.Context, orgID string, f IssueFilter) ([]Issue, error) {
	q := issueSelect + ` WHERE i.org_id=$1 AND i.trashed_at IS NULL`
	args := []interface{}{orgID}
	add := func(col, val string) {
		if val != "" {
			args = append(args, val)
			q += fmt.Sprintf(" AND i.%s=$%d", col, len(args))
		}
	}
	add("team_id", f.TeamID)
	add("project_id", f.ProjectID)
	add("assignee_id", f.AssigneeID)
	add("status", f.Status)
	switch f.ParentIssueID {
	case "":
		// no constraint — return all issues
	case "none":
		q += ` AND i.parent_issue_id IS NULL`
	default:
		args = append(args, f.ParentIssueID)
		q += fmt.Sprintf(` AND i.parent_issue_id=$%d`, len(args))
	}
	q += ` ORDER BY i.sort_order, i.created_at`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("projects.ListIssues: %w", err)
	}
	defer rows.Close()
	var out []Issue
	for rows.Next() {
		i, err := scanIssue(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (r *Repository) GetIssue(ctx context.Context, orgID, id string) (Issue, error) {
	i, err := scanIssue(r.pool.QueryRow(ctx, issueSelect+` WHERE i.id=$1 AND i.org_id=$2 AND i.trashed_at IS NULL`, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Issue{}, ErrNotFound
	}
	return i, err
}

// CreateIssue allocates the next per-team number atomically and inserts the row.
func (r *Repository) CreateIssue(ctx context.Context, orgID, teamID, creatorID string, f IssueFields) (Issue, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Issue{}, err
	}
	defer tx.Rollback(ctx)

	var number int32
	err = tx.QueryRow(ctx,
		`UPDATE grown.project_teams SET issue_count = issue_count + 1
		 WHERE id=$1 AND org_id=$2 RETURNING issue_count`, teamID, orgID).Scan(&number)
	if errors.Is(err, pgx.ErrNoRows) {
		return Issue{}, ErrNotFound
	}
	if err != nil {
		return Issue{}, fmt.Errorf("projects.CreateIssue allocate: %w", err)
	}

	status := f.Status
	if status == "" {
		status = "backlog"
	}
	var id string
	err = tx.QueryRow(ctx,
		`INSERT INTO grown.project_issues
		 (org_id, team_id, number, title, description, status, priority, assignee_id, label_ids, project_id, estimate, sort_order, creator_id, parent_issue_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id::text`,
		orgID, teamID, number, f.Title, f.Description, status, f.Priority,
		nullable(f.AssigneeID), jsonArr(f.LabelIDs), nullable(f.ProjectID), f.Estimate,
		float64(time.Now().UnixNano()), creatorID, nullable(f.ParentIssueID)).Scan(&id)
	if err != nil {
		return Issue{}, fmt.Errorf("projects.CreateIssue insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Issue{}, err
	}
	return r.GetIssue(ctx, orgID, id)
}

func (r *Repository) UpdateIssue(ctx context.Context, orgID, id string, p IssuePatch) (Issue, error) {
	set := []string{}
	args := []interface{}{id, orgID}
	add := func(expr string, val interface{}) {
		args = append(args, val)
		set = append(set, fmt.Sprintf("%s=$%d", expr, len(args)))
	}
	if p.TitleSet {
		add("title", p.Title)
	}
	if p.DescSet {
		add("description", p.Description)
	}
	if p.StatusSet {
		add("status", p.Status)
	}
	if p.PrioSet {
		add("priority", p.Priority)
	}
	if p.AssigneeSet {
		add("assignee_id", nullable(p.AssigneeID))
	}
	if p.LabelsSet {
		add("label_ids", jsonArr(p.LabelIDs))
	}
	if p.ProjectSet {
		add("project_id", nullable(p.ProjectID))
	}
	if p.EstimateSet {
		add("estimate", p.Estimate)
	}
	if p.SortSet {
		add("sort_order", p.SortOrder)
	}
	if p.ParentSet {
		add("parent_issue_id", nullable(p.ParentIssueID))
	}
	if len(set) == 0 {
		return r.GetIssue(ctx, orgID, id)
	}
	set = append(set, "updated_at=now()")
	q := `UPDATE grown.project_issues SET ` + joinComma(set) +
		` WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`
	tag, err := r.pool.Exec(ctx, q, args...)
	if err != nil {
		return Issue{}, fmt.Errorf("projects.UpdateIssue: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Issue{}, ErrNotFound
	}
	return r.GetIssue(ctx, orgID, id)
}

func (r *Repository) DeleteIssue(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.project_issues SET trashed_at=now(), updated_at=now()
		 WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`, id, orgID)
	if err != nil {
		return fmt.Errorf("projects.DeleteIssue: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Projects ─────────────────────────────────────────────────────────────────

const projectSelect = `SELECT p.id::text, p.org_id::text, p.name, p.description, p.color, p.icon,
	p.state, COALESCE(p.lead_id::text,''), COALESCE(NULLIF(u.display_name,''), u.email, ''),
	p.target_date, p.created_at, p.updated_at
	FROM grown.project_projects p
	LEFT JOIN grown.users u ON u.id = p.lead_id`

func scanProject(row pgx.Row) (Project, error) {
	var p Project
	err := row.Scan(&p.ID, &p.OrgID, &p.Name, &p.Description, &p.Color, &p.Icon,
		&p.State, &p.LeadID, &p.LeadName, &p.TargetDate, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

func (r *Repository) ListProjects(ctx context.Context, orgID string) ([]Project, error) {
	rows, err := r.pool.Query(ctx, projectSelect+` WHERE p.org_id=$1 AND p.trashed_at IS NULL ORDER BY p.created_at DESC`, orgID)
	if err != nil {
		return nil, fmt.Errorf("projects.ListProjects: %w", err)
	}
	defer rows.Close()
	var out []Project
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) CreateProject(ctx context.Context, orgID string, f ProjectFields) (Project, error) {
	state := f.State
	if state == "" {
		state = "backlog"
	}
	var id string
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.project_projects (org_id, name, description, color, icon, state, lead_id, target_date)
		 VALUES ($1,$2,$3,COALESCE(NULLIF($4,''),'#6e79d6'),$5,$6,$7,$8) RETURNING id::text`,
		orgID, f.Name, f.Description, f.Color, f.Icon, state, nullable(f.LeadID), f.TargetDate).Scan(&id)
	if err != nil {
		return Project{}, fmt.Errorf("projects.CreateProject: %w", err)
	}
	return r.getProject(ctx, orgID, id)
}

func (r *Repository) getProject(ctx context.Context, orgID, id string) (Project, error) {
	p, err := scanProject(r.pool.QueryRow(ctx, projectSelect+` WHERE p.id=$1 AND p.org_id=$2 AND p.trashed_at IS NULL`, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Project{}, ErrNotFound
	}
	return p, err
}

func (r *Repository) UpdateProject(ctx context.Context, orgID string, f ProjectFields, id string) (Project, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.project_projects SET name=$3, description=$4, color=COALESCE(NULLIF($5,''),'#6e79d6'),
		 icon=$6, state=$7, lead_id=$8, target_date=$9, updated_at=now()
		 WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`,
		id, orgID, f.Name, f.Description, f.Color, f.Icon, f.State, nullable(f.LeadID), f.TargetDate)
	if err != nil {
		return Project{}, fmt.Errorf("projects.UpdateProject: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Project{}, ErrNotFound
	}
	return r.getProject(ctx, orgID, id)
}

func (r *Repository) DeleteProject(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.project_projects SET trashed_at=now(), updated_at=now()
		 WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`, id, orgID)
	if err != nil {
		return fmt.Errorf("projects.DeleteProject: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Labels ───────────────────────────────────────────────────────────────────

func (r *Repository) ListLabels(ctx context.Context, orgID string) ([]Label, error) {
	rows, err := r.pool.Query(ctx, `SELECT id::text, org_id::text, name, color, created_at FROM grown.project_labels WHERE org_id=$1 ORDER BY name`, orgID)
	if err != nil {
		return nil, fmt.Errorf("projects.ListLabels: %w", err)
	}
	defer rows.Close()
	var out []Label
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.OrgID, &l.Name, &l.Color, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (r *Repository) CreateLabel(ctx context.Context, orgID, name, color string) (Label, error) {
	var l Label
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.project_labels (org_id, name, color) VALUES ($1,$2,COALESCE(NULLIF($3,''),'#95a2b3'))
		 RETURNING id::text, org_id::text, name, color, created_at`, orgID, name, color).
		Scan(&l.ID, &l.OrgID, &l.Name, &l.Color, &l.CreatedAt)
	if err != nil {
		return Label{}, fmt.Errorf("projects.CreateLabel: %w", err)
	}
	return l, nil
}

func (r *Repository) DeleteLabel(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM grown.project_labels WHERE id=$1 AND org_id=$2`, id, orgID)
	if err != nil {
		return fmt.Errorf("projects.DeleteLabel: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Comments ─────────────────────────────────────────────────────────────────

// issueInOrg verifies an issue belongs to orgID (guards comment access).
func (r *Repository) issueInOrg(ctx context.Context, orgID, issueID string) error {
	var ok bool
	err := r.pool.QueryRow(ctx, `SELECT true FROM grown.project_issues WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`, issueID, orgID).Scan(&ok)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (r *Repository) ListComments(ctx context.Context, orgID, issueID string) ([]Comment, error) {
	if err := r.issueInOrg(ctx, orgID, issueID); err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, issue_id::text, author_id::text, author_name, body, created_at
		 FROM grown.project_comments WHERE issue_id=$1 ORDER BY created_at`, issueID)
	if err != nil {
		return nil, fmt.Errorf("projects.ListComments: %w", err)
	}
	defer rows.Close()
	var out []Comment
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.IssueID, &c.AuthorID, &c.AuthorName, &c.Body, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *Repository) CreateComment(ctx context.Context, orgID, issueID, authorID, authorName, body string) (Comment, error) {
	if err := r.issueInOrg(ctx, orgID, issueID); err != nil {
		return Comment{}, err
	}
	var c Comment
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.project_comments (issue_id, author_id, author_name, body)
		 VALUES ($1,$2,$3,$4) RETURNING id::text, issue_id::text, author_id::text, author_name, body, created_at`,
		issueID, authorID, authorName, body).
		Scan(&c.ID, &c.IssueID, &c.AuthorID, &c.AuthorName, &c.Body, &c.CreatedAt)
	if err != nil {
		return Comment{}, fmt.Errorf("projects.CreateComment: %w", err)
	}
	return c, nil
}

func joinComma(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}
