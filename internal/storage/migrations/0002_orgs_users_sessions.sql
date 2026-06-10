-- 0002: Orgs, Users, and Sessions tables.
--
-- Every domain row carries an org_id so multi-org mode can isolate tenants.
-- In single-org mode the column is always set to the bootstrapped default org.

CREATE TABLE IF NOT EXISTS grown.orgs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grown.users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    oidc_issuer   TEXT NOT NULL,
    oidc_subject  TEXT NOT NULL,
    email         TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, oidc_issuer, oidc_subject)
);

CREATE INDEX IF NOT EXISTS users_email_idx ON grown.users (org_id, email);

CREATE TABLE IF NOT EXISTS grown.sessions (
    token        TEXT PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON grown.sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON grown.sessions (expires_at) WHERE revoked_at IS NULL;
