-- Add parent_issue_id to project_issues for Linear-style sub-issues.
-- A NULL parent means the issue is top-level.  ON DELETE SET NULL means
-- trashing/deleting a parent orphans its children gracefully.
ALTER TABLE grown.project_issues
    ADD COLUMN IF NOT EXISTS parent_issue_id UUID NULL
        REFERENCES grown.project_issues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_issues_parent
    ON grown.project_issues(parent_issue_id)
    WHERE parent_issue_id IS NOT NULL;
