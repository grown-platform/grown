-- 0036: Chat attachments.
--
-- Attachment bytes live in the blob store (shared with Drive/Mail); metadata
-- lives here. A message carries a denormalized JSONB list of its attachments
-- for display without a join (mirrors mail_attachments pattern).

CREATE TABLE IF NOT EXISTS grown.chat_attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id   UUID REFERENCES grown.chat_messages(id) ON DELETE CASCADE,
    org_id       UUID NOT NULL REFERENCES grown.orgs(id)   ON DELETE RESTRICT,
    name         TEXT NOT NULL DEFAULT '',
    mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes   BIGINT NOT NULL DEFAULT 0,
    blob_key     TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_attachments_message_id_idx
    ON grown.chat_attachments (message_id);

-- Allow message_id to be NULL so attachments can be uploaded before the
-- message is posted (the front-end uploads first, then sends the message with
-- attachment_ids). The FK is set on send.
ALTER TABLE grown.chat_attachments ALTER COLUMN message_id DROP NOT NULL;
