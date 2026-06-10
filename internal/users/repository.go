// Package users holds the data-access layer for User rows.
package users

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned by Get* methods when no row matches.
var ErrNotFound = errors.New("user not found")

// User is the in-memory representation of a grown.users row.
type User struct {
	ID          string
	OrgID       string
	OIDCIssuer  string
	OIDCSubject string
	Email       string
	DisplayName string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// UpsertInput is the input to UpsertByOIDC.
type UpsertInput struct {
	OrgID       string
	OIDCIssuer  string
	OIDCSubject string
	Email       string
	DisplayName string
}

// Repository reads and writes users.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// UpsertByOIDC inserts a new user or updates the email + display_name of an
// existing user identified by the (org_id, oidc_issuer, oidc_subject) triple.
// Returns the persisted row.
func (r *Repository) UpsertByOIDC(ctx context.Context, in UpsertInput) (User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (org_id, oidc_issuer, oidc_subject)
		 DO UPDATE SET email = EXCLUDED.email,
		               display_name = EXCLUDED.display_name,
		               updated_at = now()
		 RETURNING id::text, org_id::text, oidc_issuer, oidc_subject, email, display_name, created_at, updated_at`,
		in.OrgID, in.OIDCIssuer, in.OIDCSubject, in.Email, in.DisplayName,
	).Scan(&u.ID, &u.OrgID, &u.OIDCIssuer, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return User{}, fmt.Errorf("users.UpsertByOIDC: %w", err)
	}
	return u, nil
}

// SearchByOrg returns users in orgID whose display name or email matches the
// (case-insensitive, substring) query. An empty query returns all org users.
// Ordered by display name; capped at limit (<=0 → 50).
func (r *Repository) SearchByOrg(ctx context.Context, orgID, query string, limit int) ([]User, error) {
	if limit <= 0 {
		limit = 50
	}
	q := `SELECT id::text, org_id::text, oidc_issuer, oidc_subject, email, display_name, created_at, updated_at
		FROM grown.users
		WHERE org_id = $1 AND ($2 = '' OR display_name ILIKE '%'||$2||'%' OR email ILIKE '%'||$2||'%')
		ORDER BY lower(COALESCE(NULLIF(display_name,''), email)) LIMIT $3`
	rows, err := r.pool.Query(ctx, q, orgID, query, limit)
	if err != nil {
		return nil, fmt.Errorf("users.SearchByOrg: %w", err)
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.OrgID, &u.OIDCIssuer, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// ListOIDCSubjectsByOrg returns the oidc_subject (Zitadel user id) values of the
// members of orgID for the given issuer, optionally pre-filtered by a substring
// query against display_name/email. Used by the admin Users list to scope the
// roster to org members (the subjects are then enriched via Zitadel). Ordered by
// display name; capped at limit (<=0 → 200).
func (r *Repository) ListOIDCSubjectsByOrg(ctx context.Context, orgID, issuer, query string, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 200
	}
	q := `SELECT oidc_subject
		FROM grown.users
		WHERE org_id = $1 AND oidc_issuer = $2 AND oidc_subject <> ''
		  AND ($3 = '' OR display_name ILIKE '%'||$3||'%' OR email ILIKE '%'||$3||'%')
		ORDER BY lower(COALESCE(NULLIF(display_name,''), email)) LIMIT $4`
	rows, err := r.pool.Query(ctx, q, orgID, issuer, query, limit)
	if err != nil {
		return nil, fmt.Errorf("users.ListOIDCSubjectsByOrg: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// DeleteByOIDC deletes the grown.users row identified by (org_id, oidc_issuer,
// oidc_subject), returning the deleted user id (for cascading cleanup) and
// whether a row was removed. Deleting a non-member is a no-op (id="", ok=false).
// This only removes the grown membership row — it never touches the IdP.
func (r *Repository) DeleteByOIDC(ctx context.Context, orgID, issuer, subject string) (string, bool, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`DELETE FROM grown.users WHERE org_id = $1 AND oidc_issuer = $2 AND oidc_subject = $3
		 RETURNING id::text`,
		orgID, issuer, subject,
	).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("users.DeleteByOIDC: %w", err)
	}
	return id, true, nil
}

// GetByOIDC returns the user identified by the (org_id, oidc_issuer,
// oidc_subject) triple, or ErrNotFound. Used to map a Zitadel user id
// (oidc_subject) to a grown user id without provisioning a new row.
func (r *Repository) GetByOIDC(ctx context.Context, orgID, issuer, subject string) (User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, org_id::text, oidc_issuer, oidc_subject, email, display_name, created_at, updated_at
		 FROM grown.users WHERE org_id = $1 AND oidc_issuer = $2 AND oidc_subject = $3`,
		orgID, issuer, subject,
	).Scan(&u.ID, &u.OrgID, &u.OIDCIssuer, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("users.GetByOIDC: %w", err)
	}
	return u, nil
}

// GetByOIDCAnyOrg returns the user identified by (oidc_issuer, oidc_subject)
// in ANY org, or ErrNotFound. Used by the OIDC callback to decide whether a
// sign-in belongs to an existing grown user (in the shared default org OR a
// personal org) before provisioning a new personal org for a first-ever
// sign-in. If, in some future multi-org setup, the same (issuer, subject)
// somehow exists in more than one org, the oldest row wins (deterministic).
func (r *Repository) GetByOIDCAnyOrg(ctx context.Context, issuer, subject string) (User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, org_id::text, oidc_issuer, oidc_subject, email, display_name, created_at, updated_at
		 FROM grown.users WHERE oidc_issuer = $1 AND oidc_subject = $2
		 ORDER BY created_at LIMIT 1`,
		issuer, subject,
	).Scan(&u.ID, &u.OrgID, &u.OIDCIssuer, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("users.GetByOIDCAnyOrg: %w", err)
	}
	return u, nil
}

// GetByID returns the user with the given id.
func (r *Repository) GetByID(ctx context.Context, id string) (User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, org_id::text, oidc_issuer, oidc_subject, email, display_name, created_at, updated_at
		 FROM grown.users WHERE id = $1`,
		id,
	).Scan(&u.ID, &u.OrgID, &u.OIDCIssuer, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("users.GetByID: %w", err)
	}
	return u, nil
}
