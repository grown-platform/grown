-- 0087_honeypot_alerts.sql
-- Honeypot / intrusion-tripwire alerts for the whole instance (NOT per-org).
-- A decoy-path middleware + a hidden-form-field trap record an alert whenever a
-- prober touches a trap that legitimate users never reach (no real UI links to
-- the decoy paths, and the hidden form field is invisible to humans). The alerts
-- are read-only surfaced in the admin console (internal/honeypot).
--
-- Instance-global by design: the traps fire on UNAUTHENTICATED requests (the
-- point is to catch probers before they have a session/org), so there is no org
-- to scope to. This mirrors grown.gamerooms_audit (0084) and grown.geo_access
-- (0085), which are likewise instance-level side-tables.
CREATE TABLE IF NOT EXISTS grown.honeypot_alerts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        TEXT NOT NULL DEFAULT '',   -- decoy_path | form_bot
    path        TEXT NOT NULL DEFAULT '',   -- the requested path (decoy_path)
    method      TEXT NOT NULL DEFAULT '',   -- HTTP method
    ip          TEXT NOT NULL DEFAULT '',   -- best-effort client IP (XFF / CF-Connecting-IP)
    country     TEXT NOT NULL DEFAULT '',   -- CF-IPCountry, when present
    user_agent  TEXT NOT NULL DEFAULT '',   -- request User-Agent
    detail      TEXT NOT NULL DEFAULT '',   -- free-form context (e.g. the hidden field name)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS honeypot_alerts_created_idx ON grown.honeypot_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS honeypot_alerts_kind_idx    ON grown.honeypot_alerts (kind);
CREATE INDEX IF NOT EXISTS honeypot_alerts_ip_idx      ON grown.honeypot_alerts (ip);
