-- 0090_podcasts.sql
-- Podcasts — per-user subscriptions to RSS podcast feeds.
--
-- A subscription is a saved pointer to a podcast's RSS feed plus a snapshot of
-- its display metadata (title/author/artwork) so the "Your subscriptions" list
-- renders without re-fetching every feed. Episodes are NOT stored: they are
-- fetched + parsed live by the server-side SSRF-guarded feed proxy
-- (GET /api/v1/podcasts/feed?url=...) whenever a show is opened. Feeds include
-- curated "radio shows" published as podcast feeds.
--
-- Org-scoped like the rest of grown, but uniqueness is per-user: two users in
-- the same org can each independently subscribe to the same feed.
CREATE TABLE IF NOT EXISTS grown.podcast_subscriptions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    user_id     UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    feed_url    TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    author      TEXT NOT NULL DEFAULT '',
    artwork_url TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One subscription per (user, feed_url) so subscribe is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS podcast_subscriptions_user_feed_idx
    ON grown.podcast_subscriptions (user_id, feed_url);

-- Drives the per-user subscription list read.
CREATE INDEX IF NOT EXISTS podcast_subscriptions_org_user_idx
    ON grown.podcast_subscriptions (org_id, user_id);
