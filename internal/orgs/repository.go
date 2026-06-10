// Package orgs holds the data-access layer for Org rows.
package orgs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned by Get* methods when no row matches.
var ErrNotFound = errors.New("org not found")

// Org is the in-memory representation of a grown.orgs row.
type Org struct {
	ID          string
	Slug        string
	DisplayName string
	// IsPersonal is true for a single-user (personal) org created per-user on
	// first sign-in (slug "personal-<hex>"); false for the shared "default" org
	// and any normally-created team org. Surfaced on whoami so the SPA can hide
	// the Admin app in personal orgs.
	IsPersonal bool
}

// Repository reads and writes orgs.
type Repository struct {
	pool *pgxpool.Pool

	// OnCreate is an optional hook invoked after a successful Create or
	// CreatePersonal call. The Org passed to it is the newly-persisted row.
	// creatorEmail carries the creating user's email when known (empty during
	// bootstrap). The hook is called synchronously in the same goroutine but
	// AFTER the database transaction has committed, so a hook failure never
	// rolls back org creation. Callers should use this for best-effort
	// side-effects (e.g. provisioning an external service) — errors must be
	// handled inside the hook itself.
	//
	// The pattern mirrors internal/sharing.Repository.OnGrant: the hook field
	// is set from cmd/server/main.go, keeping this package free of any
	// dependency on the downstream provisioner.
	OnCreate func(ctx context.Context, o Org, creatorEmail string)
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// GetBySlug returns the org with the given slug, or ErrNotFound.
func (r *Repository) GetBySlug(ctx context.Context, slug string) (Org, error) {
	var o Org
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, slug, display_name, is_personal FROM grown.orgs WHERE slug = $1`,
		slug,
	).Scan(&o.ID, &o.Slug, &o.DisplayName, &o.IsPersonal)
	if errors.Is(err, pgx.ErrNoRows) {
		return Org{}, ErrNotFound
	}
	if err != nil {
		return Org{}, fmt.Errorf("orgs.GetBySlug: %w", err)
	}
	return o, nil
}

// Create inserts a new org and, atomically, makes creatorUserID its first admin
// (a grown.org_admins row). It is the single org-creation primitive; org
// creation is admin-gated at the call site (see docs/rbac-design.md — only a
// super-admin / existing admin may create an org, and the creator becomes that
// org's first admin here). creatorUserID may be "" only when bootstrapping
// outside any membership (no admin row is then written).
//
// NOTE: there is currently no CreateOrg RPC wired in the gRPC surface (orgs are
// seeded by migration 0003 for single-org mode). This method exists so the
// multi-org path is gated correctly the moment such an RPC is added; the RPC
// handler must reject non-admin callers before calling Create.
func (r *Repository) Create(ctx context.Context, slug, displayName, creatorUserID string) (Org, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Org{}, fmt.Errorf("orgs.Create begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after commit

	var o Org
	if err := tx.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name, is_personal) VALUES ($1, $2, false)
		 RETURNING id::text, slug, display_name, is_personal`,
		slug, displayName,
	).Scan(&o.ID, &o.Slug, &o.DisplayName, &o.IsPersonal); err != nil {
		return Org{}, fmt.Errorf("orgs.Create insert: %w", err)
	}
	if creatorUserID != "" {
		if _, err := tx.Exec(ctx,
			`INSERT INTO grown.org_admins (org_id, user_id, granted_by)
			 VALUES ($1, $2, NULL) ON CONFLICT DO NOTHING`,
			o.ID, creatorUserID,
		); err != nil {
			return Org{}, fmt.Errorf("orgs.Create first-admin: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Org{}, fmt.Errorf("orgs.Create commit: %w", err)
	}
	if r.OnCreate != nil {
		r.OnCreate(ctx, o, "") // creatorEmail unknown at this call site; hook must handle ""
	}
	return o, nil
}

// CreatePersonal inserts a personal (org-per-user) org with a generated slug
// of the form "personal-<short-uuid>" and the given display name. It does NOT
// write an admin row — the caller bootstraps the sole member as admin via
// internal/orgadmin EnsureFirstAdmin after upserting the user. Returns the new
// org. Used by the OIDC callback for first-ever sign-ins when personal orgs are
// enabled (see docs/sharing-and-personal-orgs.md).
//
// displayName empty becomes "Personal workspace". The slug is collision-checked
// with a bounded retry loop in case two new users race the same random suffix.
func (r *Repository) CreatePersonal(ctx context.Context, displayName string) (Org, error) {
	if displayName == "" {
		displayName = "Personal workspace"
	}
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		slug, err := personalSlug()
		if err != nil {
			return Org{}, err
		}
		var o Org
		err = r.pool.QueryRow(ctx,
			`INSERT INTO grown.orgs (slug, display_name, is_personal) VALUES ($1, $2, true)
			 ON CONFLICT (slug) DO NOTHING
			 RETURNING id::text, slug, display_name, is_personal`,
			slug, displayName,
		).Scan(&o.ID, &o.Slug, &o.DisplayName, &o.IsPersonal)
		if errors.Is(err, pgx.ErrNoRows) {
			// Slug collision; try a fresh suffix.
			lastErr = fmt.Errorf("slug collision on %q", slug)
			continue
		}
		if err != nil {
			return Org{}, fmt.Errorf("orgs.CreatePersonal: %w", err)
		}
		if r.OnCreate != nil {
			r.OnCreate(ctx, o, "") // personal orgs have no meaningful Forgejo equivalent; hook skips them
		}
		return o, nil
	}
	return Org{}, fmt.Errorf("orgs.CreatePersonal: exhausted slug retries: %w", lastErr)
}

// personalSlug returns a "personal-<12-hex>" slug.
func personalSlug() (string, error) {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("orgs.personalSlug: %w", err)
	}
	return "personal-" + hex.EncodeToString(buf), nil
}

// UpdateDisplayName renames the org (its display_name) while keeping the slug
// stable. Returns the updated row, or ErrNotFound if no org has the given id.
// The caller is responsible for admin-gating (see internal/orgadminhttp).
func (r *Repository) UpdateDisplayName(ctx context.Context, id, displayName string) (Org, error) {
	var o Org
	err := r.pool.QueryRow(ctx,
		`UPDATE grown.orgs SET display_name = $2 WHERE id = $1
		 RETURNING id::text, slug, display_name, is_personal`,
		id, displayName,
	).Scan(&o.ID, &o.Slug, &o.DisplayName, &o.IsPersonal)
	if errors.Is(err, pgx.ErrNoRows) {
		return Org{}, ErrNotFound
	}
	if err != nil {
		return Org{}, fmt.Errorf("orgs.UpdateDisplayName: %w", err)
	}
	return o, nil
}

// GetByID returns the org with the given UUID, or ErrNotFound.
func (r *Repository) GetByID(ctx context.Context, id string) (Org, error) {
	var o Org
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, slug, display_name, is_personal FROM grown.orgs WHERE id = $1`,
		id,
	).Scan(&o.ID, &o.Slug, &o.DisplayName, &o.IsPersonal)
	if errors.Is(err, pgx.ErrNoRows) {
		return Org{}, ErrNotFound
	}
	if err != nil {
		return Org{}, fmt.Errorf("orgs.GetByID: %w", err)
	}
	return o, nil
}
