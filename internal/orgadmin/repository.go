// Package orgadmin is the data-access layer for per-org admin roles
// (grown.org_admins). A row (org_id, user_id) marks user_id as an administrator
// of org_id. It backs the authorization model documented in docs/rbac-design.md:
// a caller is an admin iff their email is in GROWN_ADMIN_EMAILS (bootstrap
// super-admins) OR org_admins has a row for (caller.org_id, caller.user_id).
//
// This package depends only on pgx — it does NOT import internal/auth or the
// generated protos, so the decoupled handlers (internal/adminusers, audit,
// admin) can be wired against it via injected closures from server.go.
package orgadmin

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository reads and writes per-org admin grants.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// IsAdmin reports whether userID is an admin of orgID. A DB error is treated as
// "not an admin" (fail closed) but is also returned so callers can log it.
func (r *Repository) IsAdmin(ctx context.Context, orgID, userID string) (bool, error) {
	if orgID == "" || userID == "" {
		return false, nil
	}
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.org_admins WHERE org_id=$1 AND user_id=$2)`,
		orgID, userID,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("orgadmin.IsAdmin: %w", err)
	}
	return exists, nil
}

// ListAdmins returns the user ids that are admins of orgID, oldest grant first.
func (r *Repository) ListAdmins(ctx context.Context, orgID string) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT user_id::text FROM grown.org_admins WHERE org_id=$1 ORDER BY granted_at`,
		orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("orgadmin.ListAdmins: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("orgadmin.ListAdmins scan: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// CountAdmins returns the number of admins for orgID.
func (r *Repository) CountAdmins(ctx context.Context, orgID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM grown.org_admins WHERE org_id=$1`, orgID,
	).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("orgadmin.CountAdmins: %w", err)
	}
	return n, nil
}

// GrantAdmin makes userID an admin of orgID. grantedBy is the granting admin's
// user id ("" → stored NULL, used for auto-bootstrapped first admins). Idempotent:
// re-granting an existing admin is a no-op (the original grant is preserved).
func (r *Repository) GrantAdmin(ctx context.Context, orgID, userID, grantedBy string) error {
	var by any
	if grantedBy != "" {
		by = grantedBy
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.org_admins (org_id, user_id, granted_by)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (org_id, user_id) DO NOTHING`,
		orgID, userID, by,
	)
	if err != nil {
		return fmt.Errorf("orgadmin.GrantAdmin: %w", err)
	}
	return nil
}

// RevokeAdmin removes userID's admin role for orgID. Revoking a non-admin is a
// no-op (no error).
func (r *Repository) RevokeAdmin(ctx context.Context, orgID, userID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM grown.org_admins WHERE org_id=$1 AND user_id=$2`,
		orgID, userID,
	)
	if err != nil {
		return fmt.Errorf("orgadmin.RevokeAdmin: %w", err)
	}
	return nil
}

// EnsureFirstAdmin grants userID admin of orgID, but only when the org has NO
// admins yet — the auto-bootstrap of the first member/creator. Returns whether
// the grant happened. Runs in a transaction so the count-then-insert is atomic
// against a concurrent first sign-in.
func (r *Repository) EnsureFirstAdmin(ctx context.Context, orgID, userID string) (bool, error) {
	if orgID == "" || userID == "" {
		return false, nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("orgadmin.EnsureFirstAdmin begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after commit

	// Serialize concurrent bootstrap for this org with a transaction-scoped
	// advisory lock — `count(*) ... FOR UPDATE` is invalid in Postgres
	// (aggregates can't take row locks), which made this error out silently.
	if _, err := tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, orgID,
	); err != nil {
		return false, fmt.Errorf("orgadmin.EnsureFirstAdmin lock: %w", err)
	}
	var n int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM grown.org_admins WHERE org_id=$1`, orgID,
	).Scan(&n); err != nil {
		return false, fmt.Errorf("orgadmin.EnsureFirstAdmin count: %w", err)
	}
	if n > 0 {
		return false, nil
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO grown.org_admins (org_id, user_id, granted_by)
		 VALUES ($1, $2, NULL)
		 ON CONFLICT (org_id, user_id) DO NOTHING`,
		orgID, userID,
	); err != nil {
		return false, fmt.Errorf("orgadmin.EnsureFirstAdmin insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("orgadmin.EnsureFirstAdmin commit: %w", err)
	}
	return true, nil
}

// AdminUserIDsForZitadel maps a set of Zitadel user ids (oidc_subject values) to
// the subset that are admins of orgID. issuer scopes the oidc_subject lookup to
// the configured IdP. Used to compute the isAdmin flag in the admin users list:
// the admin-users API returns Zitadel user ids, which we join to grown users via
// (org_id, oidc_issuer, oidc_subject) and then to org_admins.
//
// Returns a set keyed by Zitadel user id. Subjects with no matching grown user,
// or grown users who are not admins, are simply absent from the result.
func (r *Repository) AdminUserIDsForZitadel(ctx context.Context, orgID, issuer string, zitadelIDs []string) (map[string]bool, error) {
	out := make(map[string]bool)
	if orgID == "" || len(zitadelIDs) == 0 {
		return out, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT u.oidc_subject
		   FROM grown.users u
		   JOIN grown.org_admins a ON a.org_id = u.org_id AND a.user_id = u.id
		  WHERE u.org_id = $1 AND u.oidc_issuer = $2 AND u.oidc_subject = ANY($3)`,
		orgID, issuer, zitadelIDs,
	)
	if err != nil {
		return nil, fmt.Errorf("orgadmin.AdminUserIDsForZitadel: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var sub string
		if err := rows.Scan(&sub); err != nil {
			return nil, fmt.Errorf("orgadmin.AdminUserIDsForZitadel scan: %w", err)
		}
		out[sub] = true
	}
	return out, rows.Err()
}
