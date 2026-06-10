-- 0078: Cloud Import — import jobs and per-type results.
-- Supports Google Takeout (.zip/.tgz) and individual Apple/Google export files.
-- Jobs are created on upload and processed asynchronously; items capture per-type counts.

CREATE TABLE IF NOT EXISTS grown.import_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    source      TEXT NOT NULL DEFAULT '',   -- 'google_takeout' | 'apple' | 'file'
    filename    TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | done | failed
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_jobs_org_user
    ON grown.import_jobs (org_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS grown.import_job_items (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id  UUID NOT NULL REFERENCES grown.import_jobs(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL,    -- contacts | calendar | drive | photos | mail
    count   INT  NOT NULL DEFAULT 0,
    status  TEXT NOT NULL DEFAULT 'pending',  -- pending | done | skipped | error
    detail  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS import_job_items_job
    ON grown.import_job_items (job_id);
