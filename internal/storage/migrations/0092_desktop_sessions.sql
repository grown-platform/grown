-- 0092_desktop_sessions.sql
-- On-demand container-desktop sessions (Guacamole Phase 2). Each row tracks one
-- launched desktop: the chosen flavor + mode, the backing k8s pod/PVC, the
-- Guacamole connection it was registered as, and an idle heartbeat used by the
-- reaper. Instance-level feature (pick.haus only); rows are still org/user-scoped
-- so a user only ever sees their own sessions.
CREATE TABLE IF NOT EXISTS grown.desktop_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    flavor        TEXT NOT NULL,                    -- catalog id (linux-desktop|browser|terminal)
    mode          TEXT NOT NULL,                    -- 'ephemeral' | 'persistent'
    pod_name      TEXT NOT NULL DEFAULT '',
    pvc_name      TEXT NOT NULL DEFAULT '',         -- persistent mode only
    guac_conn_id  TEXT NOT NULL DEFAULT '',         -- Guacamole connection identifier
    state         TEXT NOT NULL DEFAULT 'starting', -- starting | running | stopped | error
    open_url      TEXT NOT NULL DEFAULT '',         -- deep link into Guacamole
    detail        TEXT NOT NULL DEFAULT '',         -- error / status context
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS desktop_sessions_user_idx
    ON grown.desktop_sessions (user_id);

-- The reaper scans live sessions by idle time.
CREATE INDEX IF NOT EXISTS desktop_sessions_lastseen_idx
    ON grown.desktop_sessions (last_seen_at)
    WHERE state IN ('starting', 'running');
