-- 0071: per-user preferences store
CREATE TABLE IF NOT EXISTS grown.user_preferences (
    user_id          UUID        PRIMARY KEY REFERENCES grown.users(id) ON DELETE CASCADE,
    org_id           UUID        NOT NULL    REFERENCES grown.orgs(id)  ON DELETE CASCADE,
    language         TEXT        NOT NULL DEFAULT 'en',
    density          TEXT        NOT NULL DEFAULT 'comfortable',
    default_app      TEXT        NOT NULL DEFAULT 'dashboard',
    date_format      TEXT        NOT NULL DEFAULT 'MMM D, YYYY',
    time_format      TEXT        NOT NULL DEFAULT '12h',
    week_start       TEXT        NOT NULL DEFAULT 'sunday',
    email_notifications BOOLEAN  NOT NULL DEFAULT true,
    extra            JSONB       NOT NULL DEFAULT '{}',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
