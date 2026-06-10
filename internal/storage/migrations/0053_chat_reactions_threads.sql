-- 0053: Chat reactions + threaded replies.
--
-- Reactions: a normalised table so many users can react with the same emoji and
-- toggling is an upsert+delete, not a JSON merge. The aggregate (emoji → count
-- + whether the caller reacted) is computed at query time.
--
-- Threads: messages already have a channel_id. We add an optional parent_id so
-- a message can be a reply to another message in the same channel. Top-level
-- messages have parent_id IS NULL. Replies carry the root message id only
-- (single-level threading, matching Google Chat behaviour).

-- Threaded replies: nullable self-referencing FK on chat_messages.
ALTER TABLE grown.chat_messages
    ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES grown.chat_messages(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS chat_messages_parent_id_idx
    ON grown.chat_messages (parent_id)
    WHERE parent_id IS NOT NULL;

-- Reactions table: one row per (message, user, emoji).
CREATE TABLE IF NOT EXISTS grown.chat_message_reactions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES grown.chat_messages(id) ON DELETE CASCADE,
    org_id     UUID NOT NULL REFERENCES grown.orgs(id)           ON DELETE RESTRICT,
    user_id    UUID NOT NULL REFERENCES grown.users(id)          ON DELETE CASCADE,
    emoji      TEXT NOT NULL CHECK (length(emoji) <= 64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS chat_message_reactions_message_id_idx
    ON grown.chat_message_reactions (message_id);
