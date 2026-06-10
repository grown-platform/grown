-- 0006: Docs documents.
--
-- A document's content is NOT stored here. Content is a Yjs CRDT synced over a
-- WebSocket; its hot update log lives in grown.docs_updates (0007) and its
-- canonical snapshot is a blob in rustfs/Drive (drive_key / drive_file_id).

CREATE TABLE IF NOT EXISTS grown.docs_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    title         TEXT NOT NULL DEFAULT 'Untitled document',
    -- storage_key of the canonical snapshot in the org's rustfs bucket.
    drive_key     TEXT,
    -- set once Drive's DriveService owns the underlying file row.
    drive_file_id UUID,
    -- monotonically increases each time a snapshot is compacted to the blob.
    snapshot_seq  BIGINT NOT NULL DEFAULT 0,
    trashed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS docs_documents_org_idx
  ON grown.docs_documents (org_id, owner_id) WHERE trashed_at IS NULL;
