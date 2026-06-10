-- 0023: Books (Play Books-style ebook library).
--
-- A per-org library of ebooks. The book file bytes (epub/pdf/mobi/txt/cbz) and
-- the optional cover image live in the blob store (shared with Drive); their
-- keys + metadata live here. Reading state (last_location / progress / finished)
-- is checkpointed by the reader UI.

CREATE TABLE IF NOT EXISTS grown.books (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id         UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    title            TEXT NOT NULL DEFAULT '',
    author           TEXT NOT NULL DEFAULT '',
    -- one of: epub, pdf, mobi, txt, cbz
    format           TEXT NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    file_name        TEXT NOT NULL DEFAULT '',
    content_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes       BIGINT NOT NULL DEFAULT 0,
    -- blob store key for the book file; NULL until a file is uploaded.
    file_key         TEXT,
    -- blob store key for the cover image; NULL when no cover present.
    cover_key        TEXT,
    starred          BOOLEAN NOT NULL DEFAULT false,
    finished         BOOLEAN NOT NULL DEFAULT false,
    last_location    TEXT NOT NULL DEFAULT '',
    progress_percent INTEGER NOT NULL DEFAULT 0,
    trashed_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS books_org_idx
  ON grown.books (org_id) WHERE trashed_at IS NULL;
