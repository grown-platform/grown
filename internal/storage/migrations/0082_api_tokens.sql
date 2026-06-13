-- 0082_api_tokens.sql
-- Per-user personal access tokens for the HTTP API, with scopes.
-- The plaintext token is shown to the user exactly once; only its SHA-256 hash
-- is stored. A token authenticates as its owning user, limited to its scopes.

CREATE TABLE IF NOT EXISTS grown.api_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    org_id       UUID NOT NULL,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL,        -- sha256(plaintext) hex
    prefix       TEXT NOT NULL,        -- e.g. "grw_ab12cd" for display
    scopes       TEXT[] NOT NULL DEFAULT '{}',
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_idx ON grown.api_tokens (token_hash);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON grown.api_tokens (user_id) WHERE revoked_at IS NULL;
