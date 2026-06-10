-- 0019: Chat (channels + messages).
--
-- Supports DM and group channels. Members are stored as a JSONB array of user
-- UUIDs. Messages are per-channel with sender denorm for quick display.
-- last_message_at on the channel lets the list be sorted without a subquery.
-- unread_at tracks per-user read cursor for unread counts.

CREATE TABLE IF NOT EXISTS grown.chat_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    kind            TEXT NOT NULL CHECK (kind IN ('dm', 'group')),
    name            TEXT NOT NULL DEFAULT '',
    member_ids      JSONB NOT NULL DEFAULT '[]',
    last_message_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_channels_org_idx ON grown.chat_channels (org_id);

CREATE TABLE IF NOT EXISTS grown.chat_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id  UUID NOT NULL REFERENCES grown.chat_channels(id) ON DELETE CASCADE,
    org_id      UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    sender_id   UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    sender_name TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    reactions   JSONB NOT NULL DEFAULT '{}',
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_channel_idx ON grown.chat_messages (channel_id, sent_at DESC);

-- Per-user read cursor: last_read_at per channel so we can compute unread counts.
CREATE TABLE IF NOT EXISTS grown.chat_read_cursors (
    channel_id   UUID NOT NULL REFERENCES grown.chat_channels(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, user_id)
);
