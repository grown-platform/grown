-- 0005: Drive share tokens.
--
-- One row per issued share link. `audience` NULL means "anyone with link";
-- a future revision can populate it with per-user/per-group rows. Revocation
-- is soft (revoked_at IS NOT NULL); rows are never deleted unless the parent
-- file is hard-deleted (CASCADE).

CREATE TABLE IF NOT EXISTS grown.drive_shares (
    token         TEXT PRIMARY KEY,
    file_id       UUID NOT NULL REFERENCES grown.drive_files(id) ON DELETE CASCADE,
    role          TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor')),
    audience      TEXT,
    created_by    UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS drive_shares_file_idx
  ON grown.drive_shares (file_id) WHERE revoked_at IS NULL;
