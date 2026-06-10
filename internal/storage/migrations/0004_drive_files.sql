-- 0004: Drive files + folders.
--
-- One row per file or folder. Folders have NULL storage_key and size_bytes=0
-- (and mime_type = 'folder'). Files have a key into the org's rustfs bucket.
-- parent_id is NULL for org-root entries; otherwise references another row
-- (and cascade-deletes children when a folder is hard-deleted).

CREATE TABLE IF NOT EXISTS grown.drive_files (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    parent_id     UUID REFERENCES grown.drive_files(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    storage_key   TEXT,
    size_bytes    BIGINT NOT NULL DEFAULT 0,
    trashed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, parent_id, name)
);

CREATE INDEX IF NOT EXISTS drive_files_parent_idx
  ON grown.drive_files (org_id, parent_id) WHERE trashed_at IS NULL;
CREATE INDEX IF NOT EXISTS drive_files_owner_idx
  ON grown.drive_files (org_id, owner_id);
CREATE INDEX IF NOT EXISTS drive_files_trash_idx
  ON grown.drive_files (org_id, trashed_at) WHERE trashed_at IS NOT NULL;
