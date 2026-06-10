-- 0009: Cached HTML preview for document thumbnails.
--
-- The editor periodically posts a small rendered-HTML snapshot of the document
-- so the Docs home grid can show a real first-page thumbnail without opening
-- each document's CRDT. Truncated client-side; not the canonical content.

ALTER TABLE grown.docs_documents ADD COLUMN IF NOT EXISTS preview_html TEXT;
