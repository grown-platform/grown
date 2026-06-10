-- 0016: Mail messages.
--
-- A lightweight per-org mail store backing the Gmail-style UI. Internal mail is
-- delivered between org users; the schema is shaped to later be fed by an
-- IMAP/SMTP bridge to mailcow (folders + flags map to IMAP folders/keywords).
--
-- Each row is one message in one mailbox (owner_id). thread_id groups a
-- conversation. folder ∈ inbox|sent|drafts|trash|spam. labels is a JSONB array.

CREATE TABLE IF NOT EXISTS grown.mail_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id     UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    thread_id    UUID NOT NULL DEFAULT gen_random_uuid(),
    folder       TEXT NOT NULL DEFAULT 'inbox',
    from_addr    TEXT NOT NULL DEFAULT '',
    from_name    TEXT NOT NULL DEFAULT '',
    to_addrs     JSONB NOT NULL DEFAULT '[]',
    cc_addrs     JSONB NOT NULL DEFAULT '[]',
    subject      TEXT NOT NULL DEFAULT '',
    body         TEXT NOT NULL DEFAULT '',
    snippet      TEXT NOT NULL DEFAULT '',
    is_read      BOOLEAN NOT NULL DEFAULT false,
    starred      BOOLEAN NOT NULL DEFAULT false,
    labels       JSONB NOT NULL DEFAULT '[]',
    sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_messages_box_idx
  ON grown.mail_messages (owner_id, folder, sent_at DESC);
