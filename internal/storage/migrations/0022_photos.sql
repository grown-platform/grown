-- 0022: Photos (Google Photos-style media library).
--
-- Image bytes live in the blob store (shared with Drive); metadata lives here.
-- Albums are per-org named collections; the album_photos join table links them
-- many-to-many and records insertion order (added_at) for cover/ordering.

CREATE TABLE IF NOT EXISTS grown.photos (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    filename      TEXT NOT NULL DEFAULT '',
    content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
    size          BIGINT NOT NULL DEFAULT 0,
    width         INTEGER NOT NULL DEFAULT 0,
    height        INTEGER NOT NULL DEFAULT 0,
    description   TEXT NOT NULL DEFAULT '',
    favorite      BOOLEAN NOT NULL DEFAULT false,
    blob_key      TEXT NOT NULL,
    trashed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photos_org_idx
  ON grown.photos (org_id, created_at DESC) WHERE trashed_at IS NULL;

CREATE TABLE IF NOT EXISTS grown.photo_albums (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id        UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    title           TEXT NOT NULL DEFAULT '',
    cover_photo_id  UUID REFERENCES grown.photos(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photo_albums_org_idx
  ON grown.photo_albums (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS grown.album_photos (
    album_id   UUID NOT NULL REFERENCES grown.photo_albums(id) ON DELETE CASCADE,
    photo_id   UUID NOT NULL REFERENCES grown.photos(id)       ON DELETE CASCADE,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (album_id, photo_id)
);

CREATE INDEX IF NOT EXISTS album_photos_photo_idx
  ON grown.album_photos (photo_id);
