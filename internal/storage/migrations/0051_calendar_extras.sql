-- 0051: Calendar extras — item_type, reminders, status, visibility.
--
-- item_type distinguishes plain events from tasks, out-of-office blocks, and
-- focus-time blocks.  reminders holds a JSONB int array of minutes-before-start
-- values.  status is busy/free.  visibility is default/public/private.
-- task_done tracks completion for tasks.

ALTER TABLE grown.calendar_events
    ADD COLUMN IF NOT EXISTS item_type   TEXT NOT NULL DEFAULT 'event',
    ADD COLUMN IF NOT EXISTS reminders   JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'busy',
    ADD COLUMN IF NOT EXISTS visibility  TEXT NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS task_done   BOOLEAN NOT NULL DEFAULT false;

-- Fast filter by type per org.
CREATE INDEX IF NOT EXISTS calendar_events_org_type_idx
  ON grown.calendar_events (org_id, item_type) WHERE trashed_at IS NULL;
