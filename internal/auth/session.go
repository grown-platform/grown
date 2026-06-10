package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors returned by SessionStore.Lookup.
var (
	ErrSessionNotFound = errors.New("session not found")
	ErrSessionExpired  = errors.New("session expired")
	ErrSessionRevoked  = errors.New("session revoked")
)

// Session is a row from grown.sessions.
type Session struct {
	Token      string
	UserID     string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	RevokedAt  *time.Time
	IP         string
	UserAgent  string
	LastSeenAt *time.Time
}

// SessionInfo is a session joined to its owning user, for the admin/own-session
// listings. Token is intentionally omitted; ID is the row's stable identifier
// (a short, non-secret hash of the token) used for the revoke route.
type SessionInfo struct {
	ID          string
	UserID      string
	Email       string
	DisplayName string
	CreatedAt   time.Time
	ExpiresAt   time.Time
	LastSeenAt  *time.Time
	RevokedAt   *time.Time
	IP          string
	UserAgent   string
	Current     bool // set by the handler for the caller's own active session
}

// SessionStore persists session tokens to Postgres.
type SessionStore struct {
	pool *pgxpool.Pool
}

// NewSessionStore constructs a SessionStore over the given pool.
func NewSessionStore(pool *pgxpool.Pool) *SessionStore {
	return &SessionStore{pool: pool}
}

// Create generates a new opaque token and persists a session for `userID`
// with `lifetime` until expiry. Returns the token string for cookie delivery.
func (s *SessionStore) Create(ctx context.Context, userID string, lifetime time.Duration) (string, error) {
	return s.CreateWithContext(ctx, userID, lifetime, "", "")
}

// CreateWithContext is Create plus the client IP + user agent captured at
// sign-in (from the OIDC callback). Empty ip/userAgent are stored as NULL.
func (s *SessionStore) CreateWithContext(ctx context.Context, userID string, lifetime time.Duration, ip, userAgent string) (string, error) {
	tok, err := newToken()
	if err != nil {
		return "", fmt.Errorf("session.Create: token: %w", err)
	}
	var ipv, uav any
	if ip != "" {
		ipv = ip
	}
	if userAgent != "" {
		uav = userAgent
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO grown.sessions (token, user_id, expires_at, ip, user_agent, last_seen_at, public_id)
		 VALUES ($1, $2, $3, $4, $5, now(), $6)`,
		tok, userID, time.Now().Add(lifetime), ipv, uav, sessionPublicID(tok),
	)
	if err != nil {
		return "", fmt.Errorf("session.Create: insert: %w", err)
	}
	return tok, nil
}

// sessionPublicID derives a stable, non-secret identifier for a session token —
// a truncated SHA-256 hex digest. It lets the admin UI reference and revoke a
// session without ever exposing the bearer token itself.
func sessionPublicID(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])[:16]
}

// Lookup returns the session row for `token`, or one of the sentinel errors.
func (s *SessionStore) Lookup(ctx context.Context, token string) (Session, error) {
	var sess Session
	var ip, ua *string
	err := s.pool.QueryRow(ctx,
		`SELECT token, user_id::text, created_at, expires_at, revoked_at, ip, user_agent, last_seen_at
		 FROM grown.sessions WHERE token = $1`,
		token,
	).Scan(&sess.Token, &sess.UserID, &sess.CreatedAt, &sess.ExpiresAt, &sess.RevokedAt, &ip, &ua, &sess.LastSeenAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrSessionNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("session.Lookup: %w", err)
	}
	if ip != nil {
		sess.IP = *ip
	}
	if ua != nil {
		sess.UserAgent = *ua
	}
	if sess.RevokedAt != nil {
		return sess, ErrSessionRevoked
	}
	if time.Now().After(sess.ExpiresAt) {
		return sess, ErrSessionExpired
	}
	return sess, nil
}

// touchInterval throttles last_seen_at writes so the auth middleware doesn't
// issue an UPDATE on every single request.
const touchInterval = 5 * time.Minute

// TouchLastSeen refreshes last_seen_at for the token's session, but only when it
// is stale by more than touchInterval (a cheap, racy WHERE-guarded UPDATE). It
// is best-effort: errors are returned for logging but never block the request.
func (s *SessionStore) TouchLastSeen(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE grown.sessions
		    SET last_seen_at = now()
		  WHERE token = $1
		    AND revoked_at IS NULL
		    AND (last_seen_at IS NULL OR last_seen_at < now() - $2::interval)`,
		token, touchInterval.String(),
	)
	if err != nil {
		return fmt.Errorf("session.TouchLastSeen: %w", err)
	}
	return nil
}

// ListByOrg returns every session belonging to a user in orgID (active and
// revoked), newest first, joined to the owning user's email/display name. Used
// by the admin Sessions view. currentToken, when matching, flags the caller's
// own session as Current.
func (s *SessionStore) ListByOrg(ctx context.Context, orgID, currentToken string) ([]SessionInfo, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT s.token, s.public_id, s.user_id::text, u.email, u.display_name,
		        s.created_at, s.expires_at, s.last_seen_at, s.revoked_at, s.ip, s.user_agent
		   FROM grown.sessions s
		   JOIN grown.users u ON u.id = s.user_id
		  WHERE u.org_id = $1
		  ORDER BY s.created_at DESC`,
		orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("session.ListByOrg: %w", err)
	}
	return scanSessionInfos(rows, currentToken)
}

// ListByUser returns every session owned by userID, newest first. Used by the
// non-admin "your devices" security view.
func (s *SessionStore) ListByUser(ctx context.Context, userID, currentToken string) ([]SessionInfo, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT s.token, s.public_id, s.user_id::text, u.email, u.display_name,
		        s.created_at, s.expires_at, s.last_seen_at, s.revoked_at, s.ip, s.user_agent
		   FROM grown.sessions s
		   JOIN grown.users u ON u.id = s.user_id
		  WHERE s.user_id = $1
		  ORDER BY s.created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("session.ListByUser: %w", err)
	}
	return scanSessionInfos(rows, currentToken)
}

// scanSessionInfos materializes session+user rows into SessionInfo, computing
// the public id and flagging the row matching currentToken as Current.
func scanSessionInfos(rows pgx.Rows, currentToken string) ([]SessionInfo, error) {
	defer rows.Close()
	var out []SessionInfo
	for rows.Next() {
		var (
			token, publicID, userID, email, display string
			ip, ua                                  *string
			info                                    SessionInfo
		)
		if err := rows.Scan(&token, &publicID, &userID, &email, &display,
			&info.CreatedAt, &info.ExpiresAt, &info.LastSeenAt, &info.RevokedAt, &ip, &ua); err != nil {
			return nil, fmt.Errorf("session.scan: %w", err)
		}
		info.ID = publicID
		info.UserID = userID
		info.Email = email
		info.DisplayName = display
		if ip != nil {
			info.IP = *ip
		}
		if ua != nil {
			info.UserAgent = *ua
		}
		if currentToken != "" && token == currentToken {
			info.Current = true
		}
		out = append(out, info)
	}
	return out, rows.Err()
}

// RevokeByOrgAndID revokes the session whose public id matches `id` AND whose
// owner is in orgID — the admin revoke path, org-scoped so an admin can never
// revoke a session outside their own org. Returns whether a row was revoked.
func (s *SessionStore) RevokeByOrgAndID(ctx context.Context, orgID, id string) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`UPDATE grown.sessions s
		    SET revoked_at = now()
		   FROM grown.users u
		  WHERE u.id = s.user_id
		    AND u.org_id = $1
		    AND s.revoked_at IS NULL
		    AND s.public_id = $2`,
		orgID, id)
	if err != nil {
		return false, fmt.Errorf("session.RevokeByOrgAndID: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// RevokeByUserAndID revokes the session whose public id matches `id` AND whose
// owner is userID — the non-admin "sign out this device" path. Returns whether a
// row was revoked.
func (s *SessionStore) RevokeByUserAndID(ctx context.Context, userID, id string) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`UPDATE grown.sessions
		    SET revoked_at = now()
		  WHERE user_id = $1
		    AND revoked_at IS NULL
		    AND public_id = $2`,
		userID, id)
	if err != nil {
		return false, fmt.Errorf("session.RevokeByUserAndID: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// LookupPublicID returns the public_id for the given session token, or
// ErrSessionNotFound when no matching row exists.
func (s *SessionStore) LookupPublicID(ctx context.Context, token string) (string, error) {
	var publicID string
	err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(public_id, '') FROM grown.sessions WHERE token = $1`,
		token,
	).Scan(&publicID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrSessionNotFound
	}
	if err != nil {
		return "", fmt.Errorf("session.LookupPublicID: %w", err)
	}
	return publicID, nil
}

// LookupTokenByPublicID returns the bearer token for the session whose public_id
// matches id. Returns ErrSessionNotFound when no matching row exists. The token
// is only used internally (e.g. to authorize multi-account activation) and must
// never be returned to the client.
func (s *SessionStore) LookupTokenByPublicID(ctx context.Context, publicID string) (string, error) {
	var token string
	err := s.pool.QueryRow(ctx,
		`SELECT token FROM grown.sessions WHERE public_id = $1`,
		publicID,
	).Scan(&token)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrSessionNotFound
	}
	if err != nil {
		return "", fmt.Errorf("session.LookupTokenByPublicID: %w", err)
	}
	return token, nil
}

// Revoke marks the session as revoked. Subsequent Lookup calls return ErrSessionRevoked.
func (s *SessionStore) Revoke(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE grown.sessions SET revoked_at = now() WHERE token = $1 AND revoked_at IS NULL`,
		token,
	)
	if err != nil {
		return fmt.Errorf("session.Revoke: %w", err)
	}
	return nil
}

func newToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
