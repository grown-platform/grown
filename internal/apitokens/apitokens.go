// Package apitokens implements per-user personal access tokens for the HTTP API.
// A token authenticates as its owning user, limited to a set of scopes. The
// plaintext is shown once at creation; only its SHA-256 hash is stored.
package apitokens

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrInvalid is returned when a presented token is unknown, revoked or expired.
var ErrInvalid = errors.New("invalid api token")

// tokenPrefix is the visible prefix of every token, so they're recognizable.
const tokenPrefix = "grw_"

// Token is a stored token row (never includes the plaintext).
type Token struct {
	ID         string
	UserID     string
	OrgID      string
	Name       string
	Prefix     string
	Scopes     []string
	LastUsedAt *time.Time
	ExpiresAt  *time.Time
	CreatedAt  time.Time
}

// Repository reads and writes api_tokens.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	if pool == nil {
		return nil
	}
	return &Repository{pool: pool}
}

func hashToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// Create issues a new token. Returns the one-time plaintext and the stored row.
func (r *Repository) Create(ctx context.Context, userID, orgID, name string, scopes []string, expiresAt *time.Time) (string, Token, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", Token{}, err
	}
	plain := tokenPrefix + hex.EncodeToString(raw) // grw_<48 hex>
	prefix := plain[:11]                           // grw_ + 7 chars, for display
	scopes = normalizeScopes(scopes)

	var t Token
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.api_tokens (user_id, org_id, name, token_hash, prefix, scopes, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 RETURNING id::text, user_id::text, org_id::text, name, prefix, scopes, last_used_at, expires_at, created_at`,
		userID, orgID, strings.TrimSpace(name), hashToken(plain), prefix, scopes, expiresAt).
		Scan(&t.ID, &t.UserID, &t.OrgID, &t.Name, &t.Prefix, &t.Scopes, &t.LastUsedAt, &t.ExpiresAt, &t.CreatedAt)
	if err != nil {
		return "", Token{}, fmt.Errorf("apitokens.Create: %w", err)
	}
	return plain, t, nil
}

// Resolve validates a presented plaintext token and returns its owner + scopes.
// Returns ErrInvalid for unknown/revoked/expired tokens. Best-effort updates
// last_used_at.
func (r *Repository) Resolve(ctx context.Context, plain string) (userID, orgID string, scopes []string, err error) {
	if !strings.HasPrefix(plain, tokenPrefix) {
		return "", "", nil, ErrInvalid
	}
	var id string
	row := r.pool.QueryRow(ctx,
		`SELECT id::text, user_id::text, org_id::text, scopes
		   FROM grown.api_tokens
		  WHERE token_hash = $1 AND revoked_at IS NULL
		    AND (expires_at IS NULL OR expires_at > now())`,
		hashToken(plain))
	if scanErr := row.Scan(&id, &userID, &orgID, &scopes); scanErr != nil {
		if errors.Is(scanErr, pgx.ErrNoRows) {
			return "", "", nil, ErrInvalid
		}
		return "", "", nil, scanErr
	}
	// Best-effort, fire-and-forget last-used update.
	go func() {
		bg, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = r.pool.Exec(bg, `UPDATE grown.api_tokens SET last_used_at = now() WHERE id = $1`, id)
	}()
	return userID, orgID, scopes, nil
}

// List returns the caller's active tokens, newest first (no plaintext).
func (r *Repository) List(ctx context.Context, userID string) ([]Token, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, user_id::text, org_id::text, name, prefix, scopes, last_used_at, expires_at, created_at
		   FROM grown.api_tokens
		  WHERE user_id = $1 AND revoked_at IS NULL
		  ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("apitokens.List: %w", err)
	}
	defer rows.Close()
	var out []Token
	for rows.Next() {
		var t Token
		if err := rows.Scan(&t.ID, &t.UserID, &t.OrgID, &t.Name, &t.Prefix, &t.Scopes, &t.LastUsedAt, &t.ExpiresAt, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Revoke marks a token revoked (scoped to the owner so users can't revoke
// others' tokens).
func (r *Repository) Revoke(ctx context.Context, userID, id string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE grown.api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
		id, userID)
	return err
}

func normalizeScopes(scopes []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range scopes {
		s = strings.ToLower(strings.TrimSpace(s))
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	if len(out) == 0 {
		out = []string{"*"} // default to full access if none specified
	}
	return out
}

// ScopesAllow reports whether a token's scopes permit an API request.
//
// Scope grammar:
//   - "*"            full access to everything
//   - "<service>"    read+write to /api/v1/<service>/*  (e.g. "drive")
//   - "<service>:read"  read-only (GET/HEAD) to that service
//
// Non-/api paths are always allowed (token auth still attaches the user; scope
// gating is for the JSON API surface).
func ScopesAllow(scopes []string, path, method string) bool {
	if !strings.HasPrefix(path, "/api/") {
		return true
	}
	svc := serviceFromPath(path)
	write := method != "GET" && method != "HEAD" && method != "OPTIONS"
	for _, s := range scopes {
		if s == "*" {
			return true
		}
		name, level, _ := strings.Cut(s, ":")
		if name != svc {
			continue
		}
		if !write {
			return true // any matching scope grants read
		}
		if level == "" || level == "write" {
			return true
		}
	}
	return false
}

// serviceFromPath extracts the service segment from /api/v1/<service>/...
func serviceFromPath(path string) string {
	p := strings.TrimPrefix(path, "/api/v1/")
	if p == path { // no /api/v1/ prefix
		p = strings.TrimPrefix(path, "/api/")
	}
	if i := strings.IndexByte(p, '/'); i >= 0 {
		return p[:i]
	}
	return p
}
