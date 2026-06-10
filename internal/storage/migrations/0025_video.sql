-- 0025: Video library.
--
-- Video bytes live in the blob store (shared with Drive); metadata lives here.
-- Soft-delete via trashed_at mirrors the contacts/drive pattern.

CREATE TABLE IF NOT EXISTS grown.videos (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id           UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    title              TEXT NOT NULL DEFAULT '',
    description        TEXT NOT NULL DEFAULT '',
    content_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
    size               BIGINT NOT NULL DEFAULT 0,
    duration_seconds   DOUBLE PRECISION NOT NULL DEFAULT 0,
    thumbnail_data_url TEXT NOT NULL DEFAULT '',
    blob_key           TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS videos_org_idx ON grown.videos (org_id) WHERE trashed_at IS NULL;
