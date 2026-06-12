-- 0081_event_meet.sql
-- Links a calendar event to a Meet room (video meeting), without touching the
-- calendar proto/Event schema. One meeting per event.

CREATE TABLE IF NOT EXISTS grown.event_meet (
    event_id   UUID PRIMARY KEY REFERENCES grown.calendar_events(id) ON DELETE CASCADE,
    org_id     UUID NOT NULL,
    room_id    UUID NOT NULL,
    code       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup by room is used by the Meet hub to find the event (and its attendees)
-- when the first participant joins.
CREATE INDEX IF NOT EXISTS event_meet_room_idx ON grown.event_meet (room_id);
