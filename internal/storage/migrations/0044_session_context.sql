-- 0044: Session login context (IP, user agent, last-seen).
--
-- Backs the Admin console's "Sessions & logins" view (Google-Admin style): each
-- session row now records the client IP and User-Agent captured at sign-in (in
-- the OIDC callback), plus a throttled last_seen_at refreshed by the auth
-- middleware so an admin can see active devices and revoke them.
--
-- All columns are nullable so existing rows (and any code path that doesn't
-- supply context) keep working.

ALTER TABLE grown.sessions ADD COLUMN IF NOT EXISTS ip           TEXT;
ALTER TABLE grown.sessions ADD COLUMN IF NOT EXISTS user_agent   TEXT;
ALTER TABLE grown.sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- public_id is a stable, non-secret handle for a session (a truncated SHA-256 of
-- the bearer token, computed in Go at insert time). The admin Sessions view and
-- the revoke routes reference sessions by this id so the secret token is never
-- exposed to the client. Existing rows get a value backfilled from md5(token) as
-- a one-off (those tokens predate the feature and are only reachable by their
-- owner's live cookie anyway); new rows are written by session.Create.
ALTER TABLE grown.sessions ADD COLUMN IF NOT EXISTS public_id TEXT;
UPDATE grown.sessions SET public_id = left(md5(token), 16) WHERE public_id IS NULL;
CREATE INDEX IF NOT EXISTS sessions_public_id_idx ON grown.sessions (public_id);
