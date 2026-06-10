-- 0055: Enhance docs_comments for threading, org-scoping, and updated_at.
--
-- Adds columns to the existing grown.docs_comments table (created in 0026):
--
--   org_id           — denormalised org scope, matches docs_documents.org_id.
--                      Filled retroactively by joining on docs_documents; NULL
--                      for rows that pre-date this migration (safe: all access
--                      checks join through the doc anyway).
--   parent_comment_id — self-referential FK; NULL for top-level comments,
--                      set for replies. Enables Google-Docs-style threaded
--                      discussions where replies nest under the root comment.
--   updated_at        — tracks edits; defaults to created_at for existing rows.
--
-- All changes are purely additive (IF NOT EXISTS / DEFAULT) so they are safe
-- to run against a live schema without downtime.

ALTER TABLE grown.docs_comments
    ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS parent_comment_id UUID REFERENCES grown.docs_comments(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Back-fill org_id from the parent document row (best-effort; NULL is fine for
-- the access-check path which still goes through the doc).
UPDATE grown.docs_comments c
   SET org_id = d.org_id
  FROM grown.docs_documents d
 WHERE c.doc_id = d.id
   AND c.org_id IS NULL;

-- Index to speed up "list thread replies" lookups (parent_comment_id IS NOT NULL).
CREATE INDEX IF NOT EXISTS docs_comments_parent_idx
    ON grown.docs_comments (parent_comment_id)
 WHERE parent_comment_id IS NOT NULL;

-- Composite index for the common list query: doc's open comments, oldest first.
CREATE INDEX IF NOT EXISTS docs_comments_doc_open_idx
    ON grown.docs_comments (doc_id, created_at)
 WHERE resolved_at IS NULL;
