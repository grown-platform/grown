-- 0024: Music library.
--
-- Audio bytes live in the blob store (shared with Drive); metadata lives here.
-- Soft-delete via trashed_at mirrors the video/contacts/drive pattern.
-- Playlists are ordered collections of tracks within an org.

CREATE TABLE IF NOT EXISTS grown.music_tracks (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id           UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    title              TEXT NOT NULL DEFAULT '',
    artist             TEXT NOT NULL DEFAULT '',
    album              TEXT NOT NULL DEFAULT '',
    content_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
    size               BIGINT NOT NULL DEFAULT 0,
    duration_seconds   DOUBLE PRECISION NOT NULL DEFAULT 0,
    artwork_data_url   TEXT NOT NULL DEFAULT '',
    blob_key           TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS music_tracks_org_idx ON grown.music_tracks (org_id) WHERE trashed_at IS NULL;

CREATE TABLE IF NOT EXISTS grown.music_playlists (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id           UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    name               TEXT NOT NULL DEFAULT '',
    description        TEXT NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS music_playlists_org_idx ON grown.music_playlists (org_id) WHERE trashed_at IS NULL;

-- Ordered membership of tracks within a playlist. position orders the tracks;
-- a track may appear in a playlist at most once.
CREATE TABLE IF NOT EXISTS grown.music_playlist_tracks (
    playlist_id        UUID NOT NULL REFERENCES grown.music_playlists(id) ON DELETE CASCADE,
    track_id           UUID NOT NULL REFERENCES grown.music_tracks(id)    ON DELETE CASCADE,
    position           INTEGER NOT NULL DEFAULT 0,
    added_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (playlist_id, track_id)
);

CREATE INDEX IF NOT EXISTS music_playlist_tracks_order_idx
    ON grown.music_playlist_tracks (playlist_id, position);
