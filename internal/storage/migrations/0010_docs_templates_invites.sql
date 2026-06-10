-- 0010: Doc templates ("Add to gallery") + share invites (audience).
--
-- is_template flags a document as a reusable template surfaced in the Docs
-- "Start a new document" gallery. audience records who a share link was issued
-- for (an email) vs NULL = anyone-with-the-link.

ALTER TABLE grown.docs_documents ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE grown.docs_shares    ADD COLUMN IF NOT EXISTS audience TEXT;
