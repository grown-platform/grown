-- 0035: Groups (Google Groups clone — per-org mailing lists / forums).
--
-- A group is a per-org list with a name, email and description plus a set of
-- members (org users, stored as a JSONB array of user-id strings, mirroring the
-- chat_channels.member_ids shape). Within a group, group_topics are
-- conversation threads, each owning an ordered list of group_posts. Author
-- display name is denormalized onto topics/posts for cheap rendering, mirroring
-- chat_messages.sender_name.

CREATE TABLE IF NOT EXISTS grown.groups (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id     UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    name         TEXT  NOT NULL DEFAULT '',
    email        TEXT  NOT NULL DEFAULT '',
    description  TEXT  NOT NULL DEFAULT '',
    member_ids   JSONB NOT NULL DEFAULT '[]',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS groups_org_idx ON grown.groups (org_id);

CREATE TABLE IF NOT EXISTS grown.group_topics (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id     UUID NOT NULL REFERENCES grown.groups(id) ON DELETE CASCADE,
    org_id       UUID NOT NULL REFERENCES grown.orgs(id)   ON DELETE RESTRICT,
    subject      TEXT NOT NULL DEFAULT '',
    author_id    UUID NOT NULL REFERENCES grown.users(id)  ON DELETE RESTRICT,
    author_name  TEXT NOT NULL DEFAULT '',
    last_post_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_topics_group_idx
  ON grown.group_topics (group_id, last_post_at DESC NULLS LAST, created_at DESC);

CREATE TABLE IF NOT EXISTS grown.group_posts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id     UUID NOT NULL REFERENCES grown.group_topics(id) ON DELETE CASCADE,
    group_id     UUID NOT NULL REFERENCES grown.groups(id)       ON DELETE CASCADE,
    org_id       UUID NOT NULL REFERENCES grown.orgs(id)         ON DELETE RESTRICT,
    author_id    UUID NOT NULL REFERENCES grown.users(id)        ON DELETE RESTRICT,
    author_name  TEXT NOT NULL DEFAULT '',
    body         TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_posts_topic_idx
  ON grown.group_posts (topic_id, created_at);
