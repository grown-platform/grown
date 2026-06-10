-- 0056: Calendar recurrence exceptions + structured attendees with RSVP.
--
-- Adds override support for recurring-event instances (exception events store
-- the master event id and their original computed start) and a proper
-- calendar_attendees table that tracks per-attendee RSVP status.

-- Exception/override fields on the master events table.
ALTER TABLE grown.calendar_events
    ADD COLUMN IF NOT EXISTS recurrence_parent_id UUID REFERENCES grown.calendar_events(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS original_start TIMESTAMPTZ;

-- Index to look up all exceptions for a given master quickly.
CREATE INDEX IF NOT EXISTS calendar_events_parent_idx
    ON grown.calendar_events (recurrence_parent_id)
    WHERE recurrence_parent_id IS NOT NULL;

-- Structured attendees with RSVP status.
CREATE TABLE IF NOT EXISTS grown.calendar_attendees (
    event_id        UUID NOT NULL REFERENCES grown.calendar_events(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES grown.orgs(id)            ON DELETE CASCADE,
    email           TEXT NOT NULL,
    response_status TEXT NOT NULL DEFAULT 'needs_action',
    -- response_status values: needs_action | accepted | declined | tentative
    optional        BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, email)
);

CREATE INDEX IF NOT EXISTS calendar_attendees_event_idx
    ON grown.calendar_attendees (event_id);

CREATE INDEX IF NOT EXISTS calendar_attendees_org_email_idx
    ON grown.calendar_attendees (org_id, email);
