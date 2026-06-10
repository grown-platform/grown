-- 0046: Clientless-access published apps.
--
-- Org admins register internal/self-hosted web services (name, URL, optional
-- icon / description) that org members can launch in a new tab. These are the
-- "published apps" layer of the Access feature — the no-client, immediately
-- useful v1 that works via the existing Cloudflare-tunnel + Zitadel SSO.
--
-- Authorization (mirrors the rest of the admin surface, see docs/rbac-design.md):
--   LIST  — any authenticated org member
--   CREATE/UPDATE/DELETE — org admin only (enforced in the handler, not here)
--
-- icon is a freeform string (emoji, a short MUI icon name, or a URL). NULL means
-- the client renders a default globe icon.

CREATE TABLE IF NOT EXISTS grown.access_apps (
    id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id      UUID        NOT NULL REFERENCES grown.orgs(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    url         TEXT        NOT NULL CHECK (url ~ '^https?://'),
    description TEXT        NOT NULL DEFAULT '',
    icon        TEXT,
    created_by  UUID        REFERENCES grown.users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_apps_org_idx ON grown.access_apps (org_id, created_at);
