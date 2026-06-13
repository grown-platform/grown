-- 0084_gamerooms_admin.sql
-- Admin control plane for the public multiplayer game-room relay
-- (internal/gamerooms): a global on/off switch plus an audit trail of
-- room/peer lifecycle and admin actions. The relay itself stays account-free;
-- these tables are read/written by the admin-gated HTTP surface and the hub.

-- Single-row global settings for the relay. The id is pinned to TRUE so there
-- is at most one row (an upsert target). `enabled` gates new WS joins and the
-- public lobby; when FALSE the relay rejects new connections.
CREATE TABLE IF NOT EXISTS grown.gamerooms_settings (
    id          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  TEXT NOT NULL DEFAULT ''   -- acting admin email, for the toggle
);

-- Seed the single row so the hub can read it on boot (enabled by default).
INSERT INTO grown.gamerooms_settings (id, enabled) VALUES (TRUE, TRUE)
    ON CONFLICT (id) DO NOTHING;

-- Event trail. Rooms have no org/account, so this is a standalone side-table
-- (not grown.audit_events, which is org-scoped). `actor_email` is set only for
-- admin actions (toggle/kick); lifecycle events (created/joined/left) leave it
-- empty. `detail` carries free-form context as JSON.
CREATE TABLE IF NOT EXISTS grown.gamerooms_audit (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event        TEXT NOT NULL,            -- room_created | peer_joined | peer_left | kicked | toggled
    room         TEXT NOT NULL DEFAULT '', -- room code (empty for global toggles)
    game         TEXT NOT NULL DEFAULT '',
    peer_id      TEXT NOT NULL DEFAULT '',
    peer_name    TEXT NOT NULL DEFAULT '',
    actor_email  TEXT NOT NULL DEFAULT '', -- acting admin (admin actions only)
    detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gamerooms_audit_created_idx ON grown.gamerooms_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS gamerooms_audit_event_idx   ON grown.gamerooms_audit (event);
CREATE INDEX IF NOT EXISTS gamerooms_audit_room_idx     ON grown.gamerooms_audit (room);
