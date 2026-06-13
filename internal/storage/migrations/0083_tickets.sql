-- 0083_tickets.sql
-- A configurable ticketing service (Jira-like). Projects scope tickets and
-- define how requests come in: from org members ("team") or via an unguessable
-- public intake link ("public"). Each project keeps its own ticket counter and
-- its own ordered list of statuses, so workflows can differ per project.

CREATE TABLE IF NOT EXISTS grown.ticket_projects (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL,
    key           TEXT NOT NULL,                 -- short prefix, e.g. "SUP"
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    intake_mode   TEXT NOT NULL DEFAULT 'team',  -- 'team' | 'public'
    public_token  TEXT,                          -- unguessable slug for public intake
    statuses      TEXT[] NOT NULL DEFAULT '{open,in_progress,resolved,closed}',
    seq           BIGINT NOT NULL DEFAULT 0,     -- per-project ticket counter
    created_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_projects_org_key_idx ON grown.ticket_projects (org_id, lower(key));
CREATE UNIQUE INDEX IF NOT EXISTS ticket_projects_public_token_idx ON grown.ticket_projects (public_token) WHERE public_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS grown.tickets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES grown.ticket_projects(id) ON DELETE CASCADE,
    org_id            UUID NOT NULL,
    number            BIGINT NOT NULL,               -- per-project sequence (KEY-<number>)
    title             TEXT NOT NULL,
    body              TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'open',
    priority          TEXT NOT NULL DEFAULT 'normal',-- low | normal | high | urgent
    requester_user_id UUID,                          -- set when an org member files it
    requester_name    TEXT NOT NULL DEFAULT '',
    requester_email   TEXT NOT NULL DEFAULT '',
    assignee_user_id  UUID,
    source            TEXT NOT NULL DEFAULT 'web',    -- 'web' | 'public'
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tickets_project_idx ON grown.tickets (project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS tickets_project_number_idx ON grown.tickets (project_id, number);

CREATE TABLE IF NOT EXISTS grown.ticket_comments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id      UUID NOT NULL REFERENCES grown.tickets(id) ON DELETE CASCADE,
    author_user_id UUID,
    author_name    TEXT NOT NULL DEFAULT '',
    body           TEXT NOT NULL,
    is_internal    BOOLEAN NOT NULL DEFAULT false,   -- hidden from public requesters
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_comments_ticket_idx ON grown.ticket_comments (ticket_id, created_at);
