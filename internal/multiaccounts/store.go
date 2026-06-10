// Package multiaccounts implements server-side multi-account switching.
//
// The model mirrors Google's /u/0 /u/1 model but kept entirely within grown:
//
//   - Each browser gets a stable, random browser_id cookie (HttpOnly, Secure,
//     SameSite=Lax, long-lived). This is NOT a secret — it is just an identifier.
//   - When a user completes an OIDC callback (signs in), the new session token is
//     added to the browser_accounts table under that browser_id.
//   - Switching accounts: POST /api/v1/me/accounts/{sessionId}/activate looks up
//     the session token whose public_id matches, verifies the browser_id cookie
//     holds that session, then replaces the session cookie — no OIDC redirect.
//   - GET /api/v1/me/accounts returns all sessions the browser has added, with
//     user + org info + whether each is currently active.
//   - "Add another account" is the ordinary /api/v1/auth/login?prompt=select_account
//     redirect — after OIDC callback the new session is appended.
//   - Signing out of one account removes that row from browser_accounts; if it
//     was active, the client selects another or falls to logged-out.
package multiaccounts

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const maxAccountsPerBrowser = 10

// BrowserAccountRow is one entry in grown.browser_accounts.
type BrowserAccountRow struct {
	SessionToken string
}

// Store reads and writes the browser_accounts table.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// AddAccount registers a session under a browser_id, enforcing the per-browser
// cap. Duplicate (browser_id, session_token) is silently ignored (ON CONFLICT).
func (s *Store) AddAccount(ctx context.Context, browserID, sessionToken string) error {
	// Enforce cap: remove oldest rows beyond the limit before inserting.
	_, err := s.pool.Exec(ctx,
		`DELETE FROM grown.browser_accounts
		  WHERE id IN (
		    SELECT id FROM grown.browser_accounts
		     WHERE browser_id = $1
		     ORDER BY added_at DESC
		     OFFSET $2
		  )`,
		browserID, maxAccountsPerBrowser-1,
	)
	if err != nil {
		return fmt.Errorf("multiaccounts.AddAccount: trim: %w", err)
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO grown.browser_accounts (browser_id, session_token)
		 VALUES ($1, $2)
		 ON CONFLICT (browser_id, session_token) DO NOTHING`,
		browserID, sessionToken,
	)
	if err != nil {
		return fmt.Errorf("multiaccounts.AddAccount: insert: %w", err)
	}
	return nil
}

// TokensForBrowser returns all session tokens registered under browserID,
// newest first. Tokens for expired/revoked sessions are pruned lazily by
// ON DELETE CASCADE on the sessions FK.
func (s *Store) TokensForBrowser(ctx context.Context, browserID string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT session_token FROM grown.browser_accounts
		  WHERE browser_id = $1
		  ORDER BY added_at DESC`,
		browserID,
	)
	if err != nil {
		return nil, fmt.Errorf("multiaccounts.TokensForBrowser: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var tok string
		if err := rows.Scan(&tok); err != nil {
			return nil, err
		}
		out = append(out, tok)
	}
	return out, rows.Err()
}

// HasSession reports whether browserID has the given session token registered.
// Used to authorize activate requests.
func (s *Store) HasSession(ctx context.Context, browserID, sessionToken string) (bool, error) {
	var n int
	err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM grown.browser_accounts
		  WHERE browser_id = $1 AND session_token = $2`,
		browserID, sessionToken,
	).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("multiaccounts.HasSession: %w", err)
	}
	return n > 0, nil
}

// RemoveSession removes a session token from the browser's account list.
// Used on per-account sign-out.
func (s *Store) RemoveSession(ctx context.Context, browserID, sessionToken string) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM grown.browser_accounts
		  WHERE browser_id = $1 AND session_token = $2`,
		browserID, sessionToken,
	)
	if err != nil {
		return fmt.Errorf("multiaccounts.RemoveSession: %w", err)
	}
	return nil
}
