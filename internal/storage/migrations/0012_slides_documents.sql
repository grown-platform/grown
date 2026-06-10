-- 0012: Slides (presentations).
--
-- The deck contents are an opaque JSON blob (the slides model: an array of
-- slides, each with positioned elements), autosaved by the editor.
-- preview_html is a small rendered thumbnail of the first slide.

CREATE TABLE IF NOT EXISTS grown.slides_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    title         TEXT NOT NULL DEFAULT 'Untitled presentation',
    data          TEXT,
    preview_html  TEXT,
    trashed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slides_documents_org_idx
  ON grown.slides_documents (org_id, owner_id) WHERE trashed_at IS NULL;
