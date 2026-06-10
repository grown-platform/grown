-- 0040: Live streaming (multi-user "like YouTube Live").
--
-- Each row is a live-stream channel owned by an org user. The media bytes never
-- touch Postgres: publishing/playback flow through MediaMTX (the media server),
-- which grown authorizes via an HTTP auth webhook and observes via runOnReady /
-- runOnNotReady hooks. This table is the metadata + authorization source.
--
-- stream_key is the secret publish password MediaMTX checks on a publish auth.
-- path is the MediaMTX path (== the stream id text); it appears in every
-- ingest/playback URL. status is flipped live/offline by the ready hooks.
--
-- 0040 chosen as a clearly-free number: the current committed max is 0035, with
-- in-flight branches occupying up to ~0038; 0040 leaves a gap to avoid clashes.

CREATE TABLE IF NOT EXISTS grown.live_streams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id    UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    title       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    -- stream_key: random secret used as the publish password (publish auth).
    stream_key  TEXT NOT NULL UNIQUE,
    -- path: the MediaMTX path; equals the stream id text so it's globally
    -- unique and easy to map back to a row in the auth/ready webhooks.
    path        TEXT NOT NULL UNIQUE,
    -- status ∈ {'offline','live'}; flipped by the runOnReady/runOnNotReady hooks.
    status      TEXT NOT NULL DEFAULT 'offline',
    -- visibility ∈ {'org','public'}.
    visibility  TEXT NOT NULL DEFAULT 'org',
    started_at  TIMESTAMPTZ,
    ended_at    TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- List streams within an org (the common ListStreams path).
CREATE INDEX IF NOT EXISTS live_streams_org_idx ON grown.live_streams (org_id);

-- The auth/ready webhooks look streams up by their MediaMTX path; UNIQUE above
-- already provides the index, so no extra index needed for path.

-- Currently-live streams (the Browse-live grid) — partial index for the hot
-- "filter=live" query.
CREATE INDEX IF NOT EXISTS live_streams_live_idx ON grown.live_streams (org_id)
    WHERE status = 'live';
