-- 0007: Docs Yjs update log (the "hot" CRDT tail).
--
-- Each row is one binary Yjs update produced by a connected client. On connect,
-- the server replays the latest snapshot plus the tail of this table so a joining
-- client converges. A debounced compaction job merges these into a single snapshot
-- blob, advances docs_documents.snapshot_seq, and deletes the merged rows.

CREATE TABLE IF NOT EXISTS grown.docs_updates (
    id          BIGSERIAL PRIMARY KEY,
    doc_id      UUID NOT NULL REFERENCES grown.docs_documents(id) ON DELETE CASCADE,
    update_blob BYTEA NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS docs_updates_doc_idx ON grown.docs_updates (doc_id, id);
