-- 0037: Audit log (cross-cutting activity trail).
--
-- A single append-only table records mutating actions across every built-in
-- service (gRPC RPCs via the audit interceptor; raw upload/download/stream
-- routes via the audit HTTP middleware). Rows are scoped to an org and ordered
-- by created_at for the Admin "Audit log" viewer.
--
--   actor_id    — grown user id of the caller (NULL when unauthenticated).
--   actor_email — denormalized caller email for cheap display/filtering.
--   service     — derived service slug, e.g. "video", "drive", "mail".
--   action      — derived verb, e.g. "create", "update", "delete", "upload".
--   resource_*  — best-effort type + id of the affected resource.
--   method      — full gRPC method or HTTP "METHOD path" for traceability.
--   status      — "ok" or "error" (gRPC code / HTTP status class).
--   detail      — free-form JSONB (gRPC code, http status, extra context).

CREATE TABLE IF NOT EXISTS grown.audit_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE CASCADE,
    actor_id      UUID REFERENCES grown.users(id) ON DELETE SET NULL,
    actor_email   TEXT NOT NULL DEFAULT '',
    service       TEXT NOT NULL DEFAULT '',
    action        TEXT NOT NULL DEFAULT '',
    resource_type TEXT NOT NULL DEFAULT '',
    resource_id   TEXT NOT NULL DEFAULT '',
    method        TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT '',
    detail        JSONB NOT NULL DEFAULT '{}',
    ip            TEXT NOT NULL DEFAULT '',
    user_agent    TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary viewer query: an org's events newest-first, with keyset pagination on
-- created_at (the "before" filter).
CREATE INDEX IF NOT EXISTS audit_events_org_created_idx
  ON grown.audit_events (org_id, created_at DESC);

-- Service facet filter.
CREATE INDEX IF NOT EXISTS audit_events_org_service_idx
  ON grown.audit_events (org_id, service);
