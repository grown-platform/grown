-- 0070: Notifications feed.
--
-- Per-user, org-scoped notification feed. Each row represents one in-app
-- notification (e.g. "Alice shared 'Q3 Deck' with you"). Callers outside
-- this package should use internal/notifications.Repository.Create.
--
-- actor_user_id may be NULL for system-generated notifications.
-- target_url is a deep link the user is routed to on click.
-- read tracks whether the user has dismissed/read the notification.

CREATE TABLE IF NOT EXISTS grown.notifications (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES grown.orgs(id)   ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES grown.users(id)  ON DELETE CASCADE,
    type           TEXT NOT NULL,
    actor_user_id  UUID REFERENCES grown.users(id)           ON DELETE SET NULL,
    title          TEXT NOT NULL DEFAULT '',
    body           TEXT NOT NULL DEFAULT '',
    target_url     TEXT NOT NULL DEFAULT '',
    read           BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary read path: a user's unread/all notifications, newest first.
CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx
    ON grown.notifications (user_id, read, created_at DESC);
