-- 0041: Per-org admin roles.
--
-- Replaces the dangerous "empty GROWN_ADMIN_EMAILS allowlist ⇒ any authenticated
-- member is an admin" fallback with a real, in-app-assignable role. A row here
-- means (user_id) is an administrator of (org_id): they may manage users, view
-- the audit log, change service settings, grant/revoke other admins, and create
-- new orgs.
--
-- Authorization model (see docs/rbac-design.md): a caller is an admin iff their
-- email is in GROWN_ADMIN_EMAILS (bootstrap super-admins) OR a row exists here
-- for (caller.org_id, caller.user_id). There is NO open fallback.
--
-- granted_by is the admin who granted the role (NULL for auto-bootstrapped
-- first admins and GROWN_ADMIN_EMAILS-seeded super-admins).

CREATE TABLE IF NOT EXISTS grown.org_admins (
    org_id      UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    granted_by  UUID REFERENCES grown.users(id) ON DELETE SET NULL,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_admins_user_idx ON grown.org_admins (user_id);
