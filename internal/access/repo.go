package access

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// App is a published internal app registered by an org admin.
type App struct {
	ID          string    `json:"id"`
	OrgID       string    `json:"org_id"`
	Name        string    `json:"name"`
	URL         string    `json:"url"`
	Description string    `json:"description"`
	Icon        string    `json:"icon"`
	CreatedBy   string    `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
}

// ErrNotFound is returned when a requested access app does not exist.
var ErrNotFound = errors.New("access app not found")

// Repository is the storage layer for grown.access_apps.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository backed by pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// List returns all access_apps for orgID, ordered by created_at ascending.
func (r *Repository) List(ctx context.Context, orgID string) ([]App, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, org_id, name, url, description, COALESCE(icon,''), COALESCE(created_by::text,''), created_at
		FROM grown.access_apps
		WHERE org_id = $1
		ORDER BY created_at ASC
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var apps []App
	for rows.Next() {
		var a App
		if err := rows.Scan(&a.ID, &a.OrgID, &a.Name, &a.URL, &a.Description, &a.Icon, &a.CreatedBy, &a.CreatedAt); err != nil {
			return nil, err
		}
		apps = append(apps, a)
	}
	return apps, rows.Err()
}

// Create inserts a new access app for orgID, recording createdBy (user id).
// Returns the created App with its generated id + created_at.
func (r *Repository) Create(ctx context.Context, orgID, name, rawURL, description, icon, createdBy string) (App, error) {
	var a App
	// createdBy may be empty (e.g. bootstrap); use NULL in that case.
	var createdByParam *string
	if createdBy != "" {
		createdByParam = &createdBy
	}
	err := r.pool.QueryRow(ctx, `
		INSERT INTO grown.access_apps (org_id, name, url, description, icon, created_by)
		VALUES ($1, $2, $3, $4, NULLIF($5,''), $6)
		RETURNING id, org_id, name, url, description, COALESCE(icon,''), COALESCE(created_by::text,''), created_at
	`, orgID, name, rawURL, description, icon, createdByParam).
		Scan(&a.ID, &a.OrgID, &a.Name, &a.URL, &a.Description, &a.Icon, &a.CreatedBy, &a.CreatedAt)
	return a, err
}

// Update replaces the mutable fields of the access app identified by id + orgID.
// Returns ErrNotFound when no matching row exists.
func (r *Repository) Update(ctx context.Context, orgID, id, name, rawURL, description, icon string) (App, error) {
	var a App
	err := r.pool.QueryRow(ctx, `
		UPDATE grown.access_apps
		SET name=$3, url=$4, description=$5, icon=NULLIF($6,'')
		WHERE org_id=$1 AND id=$2
		RETURNING id, org_id, name, url, description, COALESCE(icon,''), COALESCE(created_by::text,''), created_at
	`, orgID, id, name, rawURL, description, icon).
		Scan(&a.ID, &a.OrgID, &a.Name, &a.URL, &a.Description, &a.Icon, &a.CreatedBy, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return App{}, ErrNotFound
	}
	return a, err
}

// Delete removes the access app identified by id + orgID.
// Returns ErrNotFound when no matching row exists.
func (r *Repository) Delete(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx, `
		DELETE FROM grown.access_apps WHERE org_id=$1 AND id=$2
	`, orgID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
