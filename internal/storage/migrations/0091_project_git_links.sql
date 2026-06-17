-- 0091_project_git_links.sql
-- Links a projects issue to a Forgejo branch / pull request / commit discovered
-- via webhook. Org-wide: any repo in the org's Forgejo org can reference an
-- issue by its KEY-N identifier. One row per (issue, kind, repo, ref).

CREATE TABLE IF NOT EXISTS grown.project_git_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE CASCADE,
    issue_id    UUID NOT NULL REFERENCES grown.project_issues(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,            -- 'branch' | 'pr' | 'commit'
    repo        TEXT NOT NULL,            -- "owner/name"
    ref         TEXT NOT NULL,            -- branch name | PR number (text) | commit sha
    url         TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL DEFAULT '',
    state       TEXT NOT NULL DEFAULT 'open', -- 'open' | 'merged' | 'closed'
    is_magic    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (issue_id, kind, repo, ref)
);

CREATE INDEX IF NOT EXISTS project_git_links_issue_idx
    ON grown.project_git_links (issue_id);
