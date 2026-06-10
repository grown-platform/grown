-- 0030: Mail snooze.
--
-- Adds a snooze_until timestamp to messages. While snooze_until is set and in
-- the future, the message is treated as living in the "snoozed" folder: hidden
-- from Inbox and listed under Snoozed. Once the time passes (checked at list
-- time), the message un-snoozes back into its underlying folder.
--
-- We keep the message's real folder intact (so un-snooze restores it) and use
-- snooze_until + folder together to decide visibility, rather than overwriting
-- the folder column.

ALTER TABLE grown.mail_messages
    ADD COLUMN IF NOT EXISTS snooze_until TIMESTAMPTZ;

-- Index to efficiently find snoozed messages for a mailbox.
CREATE INDEX IF NOT EXISTS mail_messages_snooze_idx
    ON grown.mail_messages (owner_id, snooze_until)
    WHERE snooze_until IS NOT NULL;
