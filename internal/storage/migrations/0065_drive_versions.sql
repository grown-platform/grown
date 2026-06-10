-- 0065: Drive file version history.
--
-- Each time a file's content is replaced/re-uploaded, the current blob is
-- snapshotted as a version row before the file row is updated. The current
-- content always lives on drive_files.storage_key; this table holds the
-- historical blobs.

CREATE TABLE IF NOT EXISTS grown.drive_file_versions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id       UUID NOT NULL REFERENCES grown.drive_files(id) ON DELETE CASCADE,
    org_id        UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE CASCADE,
    blob_key      TEXT NOT NULL,
    size_bytes    BIGINT NOT NULL DEFAULT 0,
    content_type  TEXT NOT NULL DEFAULT '',
    uploaded_by   UUID REFERENCES grown.users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drive_file_versions_file_created_idx
  ON grown.drive_file_versions (file_id, created_at DESC);
