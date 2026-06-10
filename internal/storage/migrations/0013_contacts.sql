-- 0013: Contacts (address book).
--
-- A simple per-org address book. Multi-valued fields (emails, phones) are
-- stored as JSONB arrays of strings; labels too. Keeps the model flat and
-- queryable without a join table for the MVP.

CREATE TABLE IF NOT EXISTS grown.contacts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    display_name  TEXT NOT NULL DEFAULT '',
    first_name    TEXT NOT NULL DEFAULT '',
    last_name     TEXT NOT NULL DEFAULT '',
    company       TEXT NOT NULL DEFAULT '',
    job_title     TEXT NOT NULL DEFAULT '',
    emails        JSONB NOT NULL DEFAULT '[]',
    phones        JSONB NOT NULL DEFAULT '[]',
    labels        JSONB NOT NULL DEFAULT '[]',
    notes         TEXT NOT NULL DEFAULT '',
    starred       BOOLEAN NOT NULL DEFAULT false,
    trashed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_org_idx
  ON grown.contacts (org_id) WHERE trashed_at IS NULL;
