-- 0068: Whiteboard sharing support.
--
-- Adds thumbnail_blob_key to grown.whiteboards for gallery preview images.
-- Sharing reuses the existing grown.object_grants table with
-- object_type = 'whiteboard'; no new table is needed.

ALTER TABLE grown.whiteboards
    ADD COLUMN IF NOT EXISTS thumbnail_blob_key TEXT;
