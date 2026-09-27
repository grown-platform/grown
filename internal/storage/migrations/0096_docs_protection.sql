-- 0096: Document protection (Docs M10).
--
-- The editors enforce every protection mode (read only, comments only,
-- tracked changes only, filling forms only) from the document's own Yjs
-- state. The server also needs the read-only case, so the collab hub can
-- drop writes from everyone but the owner: '' (none) or the mode name.

ALTER TABLE grown.docs_documents ADD COLUMN IF NOT EXISTS protection TEXT NOT NULL DEFAULT '';
