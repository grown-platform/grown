-- 0060: Tasks (Google Tasks clone).
--
-- task_lists are per-org, per-user named lists. tasks live inside a list with
-- optional notes, due date, completion, one level of subtask nesting, and
-- a position integer for manual ordering.

CREATE TABLE IF NOT EXISTS grown.task_lists (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_user_id   UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    name            TEXT NOT NULL DEFAULT '',
    position        INT  NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_lists_org_owner_idx
  ON grown.task_lists (org_id, owner_user_id);

CREATE TABLE IF NOT EXISTS grown.tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES grown.orgs(id)      ON DELETE RESTRICT,
    list_id         UUID NOT NULL REFERENCES grown.task_lists(id) ON DELETE CASCADE,
    owner_user_id   UUID NOT NULL REFERENCES grown.users(id)     ON DELETE RESTRICT,
    title           TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    due_at          TIMESTAMPTZ,
    completed       BOOLEAN NOT NULL DEFAULT false,
    completed_at    TIMESTAMPTZ,
    parent_task_id  UUID REFERENCES grown.tasks(id) ON DELETE CASCADE,
    position        INT  NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_org_list_idx
  ON grown.tasks (org_id, list_id);

CREATE INDEX IF NOT EXISTS tasks_list_position_idx
  ON grown.tasks (list_id, position);
