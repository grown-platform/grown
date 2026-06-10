// Package branding holds the data-access layer for per-org branding
// (grown.org_branding): a logo blob key + accent color the SPA applies at
// session start. It depends only on pgx — no internal/auth, no gen/ — so the
// decoupled HTTP handler can be wired against it from server.go.
package branding

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Branding is the in-memory representation of a grown.org_branding row. Empty
// LogoBlobKey / AccentColor mean "unset" — the SPA then falls back to defaults.
type Branding struct {
	OrgID       string
	LogoBlobKey string
	LogoMIME    string
	AccentColor string
	ProductName string
}

// Repository reads and writes per-org branding.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// Get returns the branding for orgID. When no row exists, it returns a zero
// Branding (all fields empty) and a nil error — an org with no explicit branding
// is the normal default-brand case, not an error.
func (r *Repository) Get(ctx context.Context, orgID string) (Branding, error) {
	var b Branding
	b.OrgID = orgID
	var logoKey, logoMIME, accent, productName *string
	err := r.pool.QueryRow(ctx,
		`SELECT logo_blob_key, logo_mime, accent_color, product_name
		   FROM grown.org_branding WHERE org_id = $1`,
		orgID,
	).Scan(&logoKey, &logoMIME, &accent, &productName)
	if errors.Is(err, pgx.ErrNoRows) {
		return b, nil
	}
	if err != nil {
		return Branding{}, fmt.Errorf("branding.Get: %w", err)
	}
	if logoKey != nil {
		b.LogoBlobKey = *logoKey
	}
	if logoMIME != nil {
		b.LogoMIME = *logoMIME
	}
	if accent != nil {
		b.AccentColor = *accent
	}
	if productName != nil {
		b.ProductName = *productName
	}
	return b, nil
}

// SetProductName upserts only the product name for orgID (empty ⇒ NULL, falling
// back to the default). Preserves any logo/accent already set.
func (r *Repository) SetProductName(ctx context.Context, orgID, name string) error {
	var val any
	if name != "" {
		val = name
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.org_branding (org_id, product_name, updated_at)
		 VALUES ($1, $2, now())
		 ON CONFLICT (org_id)
		 DO UPDATE SET product_name = EXCLUDED.product_name, updated_at = now()`,
		orgID, val,
	)
	if err != nil {
		return fmt.Errorf("branding.SetProductName: %w", err)
	}
	return nil
}

// SetAccentColor upserts only the accent color for orgID, preserving any
// existing logo. An empty color clears the override (stored NULL).
func (r *Repository) SetAccentColor(ctx context.Context, orgID, accent string) error {
	var val any
	if accent != "" {
		val = accent
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.org_branding (org_id, accent_color, updated_at)
		 VALUES ($1, $2, now())
		 ON CONFLICT (org_id)
		 DO UPDATE SET accent_color = EXCLUDED.accent_color, updated_at = now()`,
		orgID, val,
	)
	if err != nil {
		return fmt.Errorf("branding.SetAccentColor: %w", err)
	}
	return nil
}

// SetLogo upserts only the logo blob key + mime for orgID, preserving any
// existing accent color. An empty key clears the logo (stored NULL).
func (r *Repository) SetLogo(ctx context.Context, orgID, blobKey, mime string) error {
	var key, m any
	if blobKey != "" {
		key = blobKey
		m = mime
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.org_branding (org_id, logo_blob_key, logo_mime, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (org_id)
		 DO UPDATE SET logo_blob_key = EXCLUDED.logo_blob_key,
		               logo_mime = EXCLUDED.logo_mime,
		               updated_at = now()`,
		orgID, key, m,
	)
	if err != nil {
		return fmt.Errorf("branding.SetLogo: %w", err)
	}
	return nil
}
