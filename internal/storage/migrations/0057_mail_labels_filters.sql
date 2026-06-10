-- 0057: Mail labels (named, colored) and filters.
--
-- Adds first-class label entities (id, name, color) distinct from the JSONB
-- label strings already on messages. A join table links messages to labels.
-- A mail_filters table captures user-defined rules with a normalized
-- (match_field, match_op, match_value) shape — parallel to mail_rules but
-- easier to query and extend.
--
-- Existing JSONB labels on mail_messages are kept for backward compatibility
-- with the local-backend code that already stores/queries them there.

-- Named, colored labels owned by an org+user.
CREATE TABLE IF NOT EXISTS grown.mail_labels (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    user_id    UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#3D5A80',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS mail_labels_user_idx ON grown.mail_labels (user_id);

-- Links messages to their labels (many-to-many).
CREATE TABLE IF NOT EXISTS grown.mail_message_labels (
    message_id UUID NOT NULL REFERENCES grown.mail_messages(id) ON DELETE CASCADE,
    label_id   UUID NOT NULL REFERENCES grown.mail_labels(id)   ON DELETE CASCADE,
    PRIMARY KEY (message_id, label_id)
);

CREATE INDEX IF NOT EXISTS mail_message_labels_label_idx ON grown.mail_message_labels (label_id);
CREATE INDEX IF NOT EXISTS mail_message_labels_msg_idx   ON grown.mail_message_labels (message_id);

-- Normalized filters: a single match_field / match_op / match_value triple.
-- match_field ∈ from|to|subject|body  match_op ∈ contains|equals
-- action_type ∈ label|mark_read|archive|star  action_value: label name (for label action)
CREATE TABLE IF NOT EXISTS grown.mail_filters (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    user_id       UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    match_field   TEXT NOT NULL DEFAULT 'subject',
    match_op      TEXT NOT NULL DEFAULT 'contains',
    match_value   TEXT NOT NULL DEFAULT '',
    action_type   TEXT NOT NULL DEFAULT 'label',
    action_value  TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_filters_user_idx ON grown.mail_filters (user_id);
