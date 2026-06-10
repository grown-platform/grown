-- 0008: Docs link sharing.
--
-- A share token grants access to one document at a fixed role. "anyone with the
-- link" sharing: a request carrying a live token may open the doc + its collab
-- WebSocket without an org session. viewer = read-only, editor = full edit.

CREATE TABLE IF NOT EXISTS grown.docs_shares (
    token       TEXT PRIMARY KEY,
    doc_id      UUID NOT NULL REFERENCES grown.docs_documents(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
    created_by  UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS docs_shares_doc_idx
  ON grown.docs_shares (doc_id) WHERE revoked_at IS NULL;
