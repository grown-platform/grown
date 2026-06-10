-- 0029: Calendar gap — attendees/guests on events.
--
-- Adds a JSONB array of attendee email addresses to each event. Recurrence
-- expansion is handled in application code (no schema change needed for it,
-- since the existing `recurrence` column already stores the rule string).

ALTER TABLE grown.calendar_events
    ADD COLUMN IF NOT EXISTS attendees JSONB NOT NULL DEFAULT '[]';
