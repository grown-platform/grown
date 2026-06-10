-- 0054: drive starred + trash enhancements.
--
-- drive_files already has a trashed_at column from the initial drive migration;
-- this migration is additive: it adds a drive_stars table for per-user starring
-- and ensures the trashed_at column and supporting indexes exist.

-- Starred items: per-user, per-file flag. One row = "user starred file".
CREATE TABLE IF NOT EXISTS grown.drive_stars (
    user_id UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES grown.drive_files(id) ON DELETE CASCADE,
    starred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, file_id)
);

-- Index for the ListStarred query (all files starred by a user).
CREATE INDEX IF NOT EXISTS idx_drive_stars_user_id ON grown.drive_stars (user_id);

-- Ensure trashed_at column exists (defensive; original drive migration adds it,
-- but concurrent migrations may have diverged).
ALTER TABLE grown.drive_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Fast trash-list query: files in an org that are trashed, ordered by trashed_at.
CREATE INDEX IF NOT EXISTS idx_drive_files_trashed ON grown.drive_files (org_id, trashed_at)
    WHERE trashed_at IS NOT NULL;

-- Fast recent query: non-trashed files by org + updated_at DESC.
CREATE INDEX IF NOT EXISTS idx_drive_files_recent ON grown.drive_files (org_id, updated_at DESC)
    WHERE trashed_at IS NULL;
