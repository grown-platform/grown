-- 0031: Projects (Linear-style issue tracker).
--
-- Per-org teams own issues identified KEY-N (the team key + a per-team counter).
-- Issues carry status / priority / assignee / labels / project / estimate.
-- Projects group issues toward a goal; labels are per-org tags; comments thread
-- on an issue. Multi-valued label_ids stored as a JSONB array of UUID strings.

CREATE TABLE IF NOT EXISTS grown.project_teams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    name        TEXT NOT NULL,
    key         TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#6e79d6',
    icon        TEXT NOT NULL DEFAULT '',
    issue_count INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, key)
);
CREATE INDEX IF NOT EXISTS project_teams_org_idx ON grown.project_teams (org_id);

CREATE TABLE IF NOT EXISTS grown.project_projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT '#6e79d6',
    icon        TEXT NOT NULL DEFAULT '',
    state       TEXT NOT NULL DEFAULT 'backlog',
    lead_id     UUID REFERENCES grown.users(id) ON DELETE SET NULL,
    target_date TEXT NOT NULL DEFAULT '',
    trashed_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_projects_org_idx
  ON grown.project_projects (org_id) WHERE trashed_at IS NULL;

CREATE TABLE IF NOT EXISTS grown.project_labels (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#95a2b3',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_labels_org_idx ON grown.project_labels (org_id);

CREATE TABLE IF NOT EXISTS grown.project_issues (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    team_id     UUID NOT NULL REFERENCES grown.project_teams(id) ON DELETE CASCADE,
    number      INTEGER NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'backlog',
    priority    INTEGER NOT NULL DEFAULT 0,
    assignee_id UUID REFERENCES grown.users(id) ON DELETE SET NULL,
    label_ids   JSONB NOT NULL DEFAULT '[]',
    project_id  UUID REFERENCES grown.project_projects(id) ON DELETE SET NULL,
    estimate    INTEGER NOT NULL DEFAULT 0,
    sort_order  DOUBLE PRECISION NOT NULL DEFAULT 0,
    creator_id  UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    trashed_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, number)
);
CREATE INDEX IF NOT EXISTS project_issues_org_idx
  ON grown.project_issues (org_id) WHERE trashed_at IS NULL;
CREATE INDEX IF NOT EXISTS project_issues_team_idx
  ON grown.project_issues (team_id) WHERE trashed_at IS NULL;

CREATE TABLE IF NOT EXISTS grown.project_comments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id    UUID NOT NULL REFERENCES grown.project_issues(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    author_name TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_comments_issue_idx
  ON grown.project_comments (issue_id, created_at);
