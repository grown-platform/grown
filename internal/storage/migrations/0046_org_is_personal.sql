-- 0046: distinguish single-user (personal) orgs from multi-user (team) orgs.
-- A personal org is one created per-user on first sign-in (slug "personal-<hex>")
-- by orgs.CreatePersonal; the shared seeded "default" org and any normally
-- created org are team orgs. The Admin app (Users + Sessions management) is
-- hidden in personal orgs (see internal/adminusers + the SPA dashboard gate).
ALTER TABLE grown.orgs ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing rows: personal-% slugs become personal orgs; everything else
-- (notably "default") stays a team org.
UPDATE grown.orgs SET is_personal = true WHERE slug LIKE 'personal-%';
