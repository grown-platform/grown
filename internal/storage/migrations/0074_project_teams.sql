-- 0074: project_team_members + UpdateTeam/DeleteTeam support.
--
-- Adds a team-membership table so users can be added to a team.  Issues'
-- assignee picker is then scoped to the team's members (or the full org when the
-- issue has no team-member constraint).  Also adds ON-DELETE bookkeeping.

CREATE TABLE IF NOT EXISTS grown.project_team_members (
    team_id    UUID NOT NULL REFERENCES grown.project_teams(id)  ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES grown.users(id)          ON DELETE CASCADE,
    PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_team_members_user_idx
    ON grown.project_team_members (user_id);
