-- 0015: Calendar events.
--
-- A per-org event store. Single (non-recurring) events are fully supported;
-- the `recurrence` column holds an RRULE string for future expansion.

CREATE TABLE IF NOT EXISTS grown.calendar_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    title         TEXT NOT NULL DEFAULT '',
    description   TEXT NOT NULL DEFAULT '',
    location      TEXT NOT NULL DEFAULT '',
    start_at      TIMESTAMPTZ NOT NULL,
    end_at        TIMESTAMPTZ NOT NULL,
    all_day       BOOLEAN NOT NULL DEFAULT false,
    color         TEXT NOT NULL DEFAULT '',
    recurrence    TEXT NOT NULL DEFAULT '',
    trashed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendar_events_org_range_idx
  ON grown.calendar_events (org_id, start_at, end_at) WHERE trashed_at IS NULL;
