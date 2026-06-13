package drive

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrShareNotFound = errors.New("share not found")
	ErrShareRevoked  = errors.New("share revoked")
	ErrShareExpired  = errors.New("share expired")
)

// Share mirrors a grown.drive_shares row.
type Share struct {
	Token     string
	FileID    string
	Role      string
	CreatedBy string
	CreatedAt time.Time
	ExpiresAt *time.Time
	RevokedAt *time.Time
}

// ACL is the Postgres-backed share-token store.
type ACL struct {
	pool *pgxpool.Pool
}

func NewACL(pool *pgxpool.Pool) *ACL { return &ACL{pool: pool} }

// CreateShare issues a token granting `role` on `fileID`. Zero `expiresAt`
// means no expiry.
func (a *ACL) CreateShare(ctx context.Context, fileID, createdBy, role string, expiresAt time.Time) (string, error) {
	if role != "viewer" && role != "commenter" && role != "editor" {
		return "", fmt.Errorf("invalid role: %q", role)
	}
	tok, err := newShareToken()
	if err != nil {
		return "", err
	}
	var exp interface{}
	if !expiresAt.IsZero() {
		exp = expiresAt
	}
	_, err = a.pool.Exec(ctx,
		`INSERT INTO grown.drive_shares (token, file_id, role, created_by, expires_at) VALUES ($1, $2, $3, $4, $5)`,
		tok, fileID, role, createdBy, exp,
	)
	if err != nil {
		return "", fmt.Errorf("acl.CreateShare: %w", err)
	}
	return tok, nil
}

// LookupShare returns the share for `token`, or ErrShareNotFound /
// ErrShareRevoked / ErrShareExpired. Revoked/expired shares still return the
// Share value so callers can audit; only `ErrShareNotFound` returns zero.
func (a *ACL) LookupShare(ctx context.Context, token string) (Share, error) {
	var s Share
	err := a.pool.QueryRow(ctx,
		`SELECT token, file_id::text, role, created_by::text, created_at, expires_at, revoked_at
		 FROM grown.drive_shares WHERE token = $1`,
		token,
	).Scan(&s.Token, &s.FileID, &s.Role, &s.CreatedBy, &s.CreatedAt, &s.ExpiresAt, &s.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Share{}, ErrShareNotFound
	}
	if err != nil {
		return Share{}, fmt.Errorf("acl.LookupShare: %w", err)
	}
	if s.RevokedAt != nil {
		return s, ErrShareRevoked
	}
	if s.ExpiresAt != nil && time.Now().After(*s.ExpiresAt) {
		return s, ErrShareExpired
	}
	return s, nil
}

// ListSharesForFile returns the active (non-revoked) shares for `fileID`,
// newest first.
func (a *ACL) ListSharesForFile(ctx context.Context, fileID string) ([]Share, error) {
	rows, err := a.pool.Query(ctx,
		`SELECT token, file_id::text, role, created_by::text, created_at, expires_at, revoked_at
		 FROM grown.drive_shares
		 WHERE file_id = $1 AND revoked_at IS NULL
		   AND (expires_at IS NULL OR expires_at > now())
		 ORDER BY created_at DESC`,
		fileID,
	)
	if err != nil {
		return nil, fmt.Errorf("acl.List: %w", err)
	}
	defer rows.Close()
	var out []Share
	for rows.Next() {
		var s Share
		if err := rows.Scan(&s.Token, &s.FileID, &s.Role, &s.CreatedBy, &s.CreatedAt, &s.ExpiresAt, &s.RevokedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// RevokeShare marks `token` revoked. Returns ErrShareNotFound if no active
// share matches.
func (a *ACL) RevokeShare(ctx context.Context, token string) error {
	res, err := a.pool.Exec(ctx,
		`UPDATE grown.drive_shares SET revoked_at = now() WHERE token = $1 AND revoked_at IS NULL`,
		token,
	)
	if err != nil {
		return fmt.Errorf("acl.Revoke: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrShareNotFound
	}
	return nil
}

func newShareToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
