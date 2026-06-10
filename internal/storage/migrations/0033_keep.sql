-- 0033: Keep (quick notes).
--
-- Per-org quick notes (a Google Keep clone). Labels are stored as a JSONB
-- array of strings and the optional checklist as a JSONB array of
-- {text, checked} objects, mirroring how contacts stores its multi-valued
-- fields. Soft-delete via trashed_at.

CREATE TABLE IF NOT EXISTS grown.keep_notes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    title         TEXT NOT NULL DEFAULT '',
    body          TEXT NOT NULL DEFAULT '',
    color         TEXT NOT NULL DEFAULT '',
    pinned        BOOLEAN NOT NULL DEFAULT false,
    archived      BOOLEAN NOT NULL DEFAULT false,
    labels        JSONB NOT NULL DEFAULT '[]',
    checklist     JSONB NOT NULL DEFAULT '[]',
    trashed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS keep_notes_org_idx
  ON grown.keep_notes (org_id) WHERE trashed_at IS NULL;
