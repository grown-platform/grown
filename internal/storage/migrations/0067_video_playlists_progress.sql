-- 0067: Video playlists, per-user watch progress, and caption tracks.

CREATE TABLE IF NOT EXISTS grown.video_playlists (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    name          TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_playlists_org_idx
    ON grown.video_playlists (org_id);

CREATE TABLE IF NOT EXISTS grown.video_playlist_items (
    playlist_id UUID NOT NULL REFERENCES grown.video_playlists(id) ON DELETE CASCADE,
    video_id    UUID NOT NULL REFERENCES grown.videos(id) ON DELETE CASCADE,
    position    INT NOT NULL DEFAULT 0,
    PRIMARY KEY (playlist_id, video_id)
);

CREATE INDEX IF NOT EXISTS video_playlist_items_playlist_idx
    ON grown.video_playlist_items (playlist_id, position);

CREATE TABLE IF NOT EXISTS grown.video_progress (
    user_id          UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    video_id         UUID NOT NULL REFERENCES grown.videos(id) ON DELETE CASCADE,
    position_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    percent          DOUBLE PRECISION NOT NULL DEFAULT 0,
    watched          BOOLEAN NOT NULL DEFAULT false,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, video_id)
);

CREATE INDEX IF NOT EXISTS video_progress_user_idx
    ON grown.video_progress (user_id);

CREATE TABLE IF NOT EXISTS grown.video_captions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE CASCADE,
    video_id   UUID NOT NULL REFERENCES grown.videos(id) ON DELETE CASCADE,
    lang       TEXT NOT NULL DEFAULT 'en',
    label      TEXT NOT NULL DEFAULT '',
    blob_key   TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_captions_video_idx
    ON grown.video_captions (video_id);
