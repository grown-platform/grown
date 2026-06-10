-- 0011: Sheets (spreadsheets).
--
-- The workbook contents are an opaque JSON blob (the FortuneSheet model),
-- autosaved by the editor. preview_html is a small rendered thumbnail.

CREATE TABLE IF NOT EXISTS grown.sheets_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    title         TEXT NOT NULL DEFAULT 'Untitled spreadsheet',
    data          TEXT,
    preview_html  TEXT,
    trashed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sheets_documents_org_idx
  ON grown.sheets_documents (org_id, owner_id) WHERE trashed_at IS NULL;
