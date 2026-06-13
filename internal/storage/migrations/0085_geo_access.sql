-- 0085_geo_access.sql
-- Instance-level geo-location access control for the whole site (NOT per-org).
-- A single-row settings table holds the edge access policy enforced by the
-- geoaccess middleware against Cloudflare's CF-IPCountry request header. This
-- gates edge access to the main app + games area; the admin API, auth/login,
-- and health endpoints are always exempt so an admin can never lock themselves
-- out (see internal/geoaccess).

-- Single-row policy (id pinned to TRUE so there is at most one row — an upsert
-- target, same singleton pattern as grown.gamerooms_settings in 0084).
--   mode      : 'off'   – no filtering (default; the policy is inert)
--               'block' – deny requests from countries in `countries`
--               'allow' – deny everything EXCEPT countries in `countries`
--   countries : ISO 3166-1 alpha-2 codes (upper-case, e.g. {US,DE}) the mode
--               applies to. Ignored when mode = 'off'.
CREATE TABLE IF NOT EXISTS grown.geo_access (
    id          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    mode        TEXT NOT NULL DEFAULT 'off'
                  CHECK (mode IN ('off', 'block', 'allow')),
    countries   TEXT[] NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  TEXT NOT NULL DEFAULT ''   -- acting admin email, for the audit
);

-- Seed the single row so the middleware can read it on boot (off by default —
-- no filtering until an admin opts in).
INSERT INTO grown.geo_access (id, mode) VALUES (TRUE, 'off')
    ON CONFLICT (id) DO NOTHING;
