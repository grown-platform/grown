// Package contacts is the data-access + service layer for the address book.
package contacts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no contact matches the given id (within the org).
var ErrNotFound = errors.New("contact not found")

// ErrGroupNotFound is returned when no contact group matches the given id.
var ErrGroupNotFound = errors.New("contact group not found")

// Contact is the in-memory representation of a grown.contacts row.
type Contact struct {
	ID          string
	OrgID       string
	OwnerID     string
	DisplayName string
	FirstName   string
	LastName    string
	Company     string
	JobTitle    string
	Emails      []string
	Phones      []string
	Labels      []string
	Notes       string
	Starred     bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Fields bundles the editable attributes of a contact (used by Create/Update).
type Fields struct {
	DisplayName string
	FirstName   string
	LastName    string
	Company     string
	JobTitle    string
	Emails      []string
	Phones      []string
	Labels      []string
	Notes       string
	Starred     bool
}

// ContactGroup is the in-memory representation of a grown.contact_groups row.
type ContactGroup struct {
	ID          string
	OrgID       string
	OwnerUserID string
	Name        string
	CreatedAt   time.Time
}

// Repository reads and writes contacts.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const columns = `id::text, org_id::text, owner_id::text, display_name, first_name, last_name,
	company, job_title, emails, phones, labels, notes, starred, created_at, updated_at`

func jsonArr(s []string) []byte {
	if s == nil {
		s = []string{}
	}
	b, _ := json.Marshal(s)
	return b
}

func scan(row pgx.Row) (Contact, error) {
	var c Contact
	var emails, phones, labels []byte
	err := row.Scan(&c.ID, &c.OrgID, &c.OwnerID, &c.DisplayName, &c.FirstName, &c.LastName,
		&c.Company, &c.JobTitle, &emails, &phones, &labels, &c.Notes, &c.Starred, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return Contact{}, err
	}
	_ = json.Unmarshal(emails, &c.Emails)
	_ = json.Unmarshal(phones, &c.Phones)
	_ = json.Unmarshal(labels, &c.Labels)
	return c, nil
}

// Create inserts a new contact.
func (r *Repository) Create(ctx context.Context, orgID, ownerID string, f Fields) (Contact, error) {
	q := `INSERT INTO grown.contacts
		(org_id, owner_id, display_name, first_name, last_name, company, job_title, emails, phones, labels, notes, starred)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING ` + columns
	c, err := scan(r.pool.QueryRow(ctx, q, orgID, ownerID, f.DisplayName, f.FirstName, f.LastName,
		f.Company, f.JobTitle, jsonArr(f.Emails), jsonArr(f.Phones), jsonArr(f.Labels), f.Notes, f.Starred))
	if err != nil {
		return Contact{}, fmt.Errorf("contacts.Create: %w", err)
	}
	return c, nil
}

// Get returns a contact within orgID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Contact, error) {
	q := `SELECT ` + columns + ` FROM grown.contacts WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`
	c, err := scan(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Contact{}, ErrNotFound
	}
	if err != nil {
		return Contact{}, fmt.Errorf("contacts.Get: %w", err)
	}
	return c, nil
}

// ListFilter controls which contacts List returns.
type ListFilter struct {
	GroupID     string // when non-empty, only contacts in this group
	StarredOnly bool   // when true, only starred contacts
}

// List returns all non-trashed contacts in orgID, ordered by display name.
// When f.GroupID is set, only contacts that are members of that group are
// returned. When f.StarredOnly is true, only starred contacts are returned.
func (r *Repository) List(ctx context.Context, orgID string, f ListFilter) ([]Contact, error) {
	var q string
	var args []any
	switch {
	case f.GroupID != "":
		q = `SELECT c.` + columns + `
			FROM grown.contacts c
			JOIN grown.contact_group_members m ON m.contact_id = c.id
			WHERE c.org_id=$1 AND c.trashed_at IS NULL AND m.group_id=$2
			ORDER BY c.starred DESC, lower(NULLIF(c.display_name,'')) NULLS LAST, lower(c.first_name), lower(c.last_name)`
		args = []any{orgID, f.GroupID}
	case f.StarredOnly:
		q = `SELECT ` + columns + ` FROM grown.contacts
			WHERE org_id=$1 AND trashed_at IS NULL AND starred=true
			ORDER BY lower(NULLIF(display_name,'')) NULLS LAST, lower(first_name), lower(last_name)`
		args = []any{orgID}
	default:
		q = `SELECT ` + columns + ` FROM grown.contacts
			WHERE org_id=$1 AND trashed_at IS NULL
			ORDER BY starred DESC, lower(NULLIF(display_name,'')) NULLS LAST, lower(first_name), lower(last_name)`
		args = []any{orgID}
	}
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("contacts.List: %w", err)
	}
	defer rows.Close()
	var out []Contact
	for rows.Next() {
		c, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("contacts.List scan: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Update replaces the editable fields of a contact within orgID.
func (r *Repository) Update(ctx context.Context, orgID, id string, f Fields) (Contact, error) {
	q := `UPDATE grown.contacts SET
		display_name=$3, first_name=$4, last_name=$5, company=$6, job_title=$7,
		emails=$8, phones=$9, labels=$10, notes=$11, starred=$12, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + columns
	c, err := scan(r.pool.QueryRow(ctx, q, id, orgID, f.DisplayName, f.FirstName, f.LastName,
		f.Company, f.JobTitle, jsonArr(f.Emails), jsonArr(f.Phones), jsonArr(f.Labels), f.Notes, f.Starred))
	if errors.Is(err, pgx.ErrNoRows) {
		return Contact{}, ErrNotFound
	}
	if err != nil {
		return Contact{}, fmt.Errorf("contacts.Update: %w", err)
	}
	return c, nil
}

// SetStarred sets or clears the starred flag on a contact within orgID.
func (r *Repository) SetStarred(ctx context.Context, orgID, id string, starred bool) (Contact, error) {
	q := `UPDATE grown.contacts SET starred=$3, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + columns
	c, err := scan(r.pool.QueryRow(ctx, q, id, orgID, starred))
	if errors.Is(err, pgx.ErrNoRows) {
		return Contact{}, ErrNotFound
	}
	if err != nil {
		return Contact{}, fmt.Errorf("contacts.SetStarred: %w", err)
	}
	return c, nil
}

// Trash soft-deletes a contact within orgID.
func (r *Repository) Trash(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.contacts SET trashed_at=now(), updated_at=now()
		 WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`, id, orgID)
	if err != nil {
		return fmt.Errorf("contacts.Trash: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetMany returns contacts by IDs within orgID (skipping trashed).
// Order is stable by display_name.
func (r *Repository) GetMany(ctx context.Context, orgID string, ids []string) ([]Contact, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	q := `SELECT ` + columns + ` FROM grown.contacts
		WHERE org_id=$1 AND id = ANY($2::uuid[]) AND trashed_at IS NULL
		ORDER BY lower(NULLIF(display_name,'')) NULLS LAST`
	rows, err := r.pool.Query(ctx, q, orgID, ids)
	if err != nil {
		return nil, fmt.Errorf("contacts.GetMany: %w", err)
	}
	defer rows.Close()
	var out []Contact
	for rows.Next() {
		c, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("contacts.GetMany scan: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ---- Contact group operations ----

const groupColumns = `id::text, org_id::text, owner_user_id::text, name, created_at`

func scanGroup(row pgx.Row) (ContactGroup, error) {
	var g ContactGroup
	err := row.Scan(&g.ID, &g.OrgID, &g.OwnerUserID, &g.Name, &g.CreatedAt)
	if err != nil {
		return ContactGroup{}, err
	}
	return g, nil
}

// CreateGroup inserts a new contact group.
func (r *Repository) CreateGroup(ctx context.Context, orgID, ownerUserID, name string) (ContactGroup, error) {
	q := `INSERT INTO grown.contact_groups (org_id, owner_user_id, name)
		VALUES ($1,$2,$3) RETURNING ` + groupColumns
	g, err := scanGroup(r.pool.QueryRow(ctx, q, orgID, ownerUserID, name))
	if err != nil {
		return ContactGroup{}, fmt.Errorf("contacts.CreateGroup: %w", err)
	}
	return g, nil
}

// ListGroups returns all groups for orgID, ordered by name.
func (r *Repository) ListGroups(ctx context.Context, orgID string) ([]ContactGroup, error) {
	q := `SELECT ` + groupColumns + ` FROM grown.contact_groups WHERE org_id=$1 ORDER BY lower(name)`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("contacts.ListGroups: %w", err)
	}
	defer rows.Close()
	var out []ContactGroup
	for rows.Next() {
		g, err := scanGroup(rows)
		if err != nil {
			return nil, fmt.Errorf("contacts.ListGroups scan: %w", err)
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// UpdateGroup renames a group within orgID.
func (r *Repository) UpdateGroup(ctx context.Context, orgID, id, name string) (ContactGroup, error) {
	q := `UPDATE grown.contact_groups SET name=$3 WHERE id=$1 AND org_id=$2 RETURNING ` + groupColumns
	g, err := scanGroup(r.pool.QueryRow(ctx, q, id, orgID, name))
	if errors.Is(err, pgx.ErrNoRows) {
		return ContactGroup{}, ErrGroupNotFound
	}
	if err != nil {
		return ContactGroup{}, fmt.Errorf("contacts.UpdateGroup: %w", err)
	}
	return g, nil
}

// DeleteGroup removes a group (and its memberships) within orgID.
func (r *Repository) DeleteGroup(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.contact_groups WHERE id=$1 AND org_id=$2`, id, orgID)
	if err != nil {
		return fmt.Errorf("contacts.DeleteGroup: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrGroupNotFound
	}
	return nil
}

// AddToGroup inserts membership rows for each contactID into groupID,
// silently ignoring duplicates.
func (r *Repository) AddToGroup(ctx context.Context, orgID, groupID string, contactIDs []string) error {
	// Verify the group belongs to the org.
	var count int
	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(1) FROM grown.contact_groups WHERE id=$1 AND org_id=$2`,
		groupID, orgID).Scan(&count); err != nil {
		return fmt.Errorf("contacts.AddToGroup verify: %w", err)
	}
	if count == 0 {
		return ErrGroupNotFound
	}
	for _, cid := range contactIDs {
		_, err := r.pool.Exec(ctx,
			`INSERT INTO grown.contact_group_members (group_id, contact_id)
			 VALUES ($1,$2) ON CONFLICT DO NOTHING`, groupID, cid)
		if err != nil {
			return fmt.Errorf("contacts.AddToGroup insert: %w", err)
		}
	}
	return nil
}

// RemoveFromGroup deletes the membership of contactID in groupID within orgID.
func (r *Repository) RemoveFromGroup(ctx context.Context, orgID, groupID, contactID string) error {
	// Verify group belongs to org first.
	var count int
	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(1) FROM grown.contact_groups WHERE id=$1 AND org_id=$2`,
		groupID, orgID).Scan(&count); err != nil {
		return fmt.Errorf("contacts.RemoveFromGroup verify: %w", err)
	}
	if count == 0 {
		return ErrGroupNotFound
	}
	_, err := r.pool.Exec(ctx,
		`DELETE FROM grown.contact_group_members WHERE group_id=$1 AND contact_id=$2`,
		groupID, contactID)
	return err
}
