-- 0072: User avatars + browser account list (multi-account switching).
--
-- user_avatars stores a reference to each user's uploaded avatar blob (in the
-- shared Drive blob store, just like org logos). The blob key contains a random
-- suffix so a re-upload automatically busts any CDN/proxy cache.
--
-- browser_accounts enables in-app multi-account switching without OIDC redirects:
-- a browser has a stable, random browser_id cookie. When a user signs in, their
-- session token is added to that browser's account list. Switching accounts just
-- updates the active session cookie — no OIDC round-trip. A browser may hold up
-- to 10 accounts. Rows are pruned when sessions expire or are revoked.

CREATE TABLE IF NOT EXISTS grown.user_avatars (
    user_id      UUID PRIMARY KEY REFERENCES grown.users(id) ON DELETE CASCADE,
    blob_key     TEXT NOT NULL,
    mime_type    TEXT NOT NULL DEFAULT 'image/png',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grown.browser_accounts (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    browser_id   TEXT NOT NULL,
    session_token TEXT NOT NULL REFERENCES grown.sessions(token) ON DELETE CASCADE,
    added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (browser_id, session_token)
);

CREATE INDEX IF NOT EXISTS browser_accounts_browser_idx ON grown.browser_accounts (browser_id);
