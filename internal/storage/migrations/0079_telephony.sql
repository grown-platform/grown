-- 0079: Telephony (internal WebRTC softphone).
--
-- Persists per-user extensions and call history. Live signaling state (who is
-- currently connected/online) is purely in-memory in the Hub; only extension
-- assignments and the call log survive restarts.

CREATE TABLE IF NOT EXISTS grown.telephony_extensions (
    org_id     UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    user_id    UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    extension  INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, user_id),
    UNIQUE (org_id, extension)
);

CREATE INDEX IF NOT EXISTS telephony_extensions_org_idx
  ON grown.telephony_extensions (org_id);

CREATE TABLE IF NOT EXISTS grown.telephony_calls (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    caller_id  UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    callee_id  UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    -- status is one of: completed, missed, rejected.
    status     TEXT NOT NULL DEFAULT 'completed',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS telephony_calls_org_idx
  ON grown.telephony_calls (org_id);

CREATE INDEX IF NOT EXISTS telephony_calls_participants_idx
  ON grown.telephony_calls (org_id, caller_id, callee_id, started_at DESC);
