-- 0089_visits.sql
-- Lightweight, privacy-preserving visitor tracking that powers the public
-- "N players in the last 24h" counter atop /games. One row per (day, hashed IP):
-- the raw client IP is NEVER stored — only a salted SHA-256 hash — so the table
-- holds no PII, just a daily distinct-visitor set. A small middleware upserts a
-- row per real page/app request (static asset + bot/scanner noise is skipped);
-- a periodic prune drops rows older than ~2 days so the table stays tiny.
--
-- Instance-global by design: the counter is public and account-free (same
-- posture as /api/v1/games/recent), so there is no org to scope to. Mirrors the
-- other instance-level side-tables (honeypot_alerts 0087, ratelimit_blocks 0088).
CREATE TABLE IF NOT EXISTS grown.visits (
    day        DATE NOT NULL,                 -- UTC calendar day of the visit
    ip_hash    TEXT NOT NULL,                 -- salted SHA-256 of the client IP (NOT the IP)
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (day, ip_hash)
);

-- Drives the COUNT(DISTINCT ip_hash) WHERE last_seen > now()-24h query.
CREATE INDEX IF NOT EXISTS visits_last_seen_idx ON grown.visits (last_seen);
