-- 0026: Docs version history + anchored comments.
--
-- Version history: the live document is a Yjs CRDT synced over a WebSocket and
-- compacted into grown.docs_updates. A *version* is an immutable point-in-time
-- snapshot of the rendered document, captured by the client (which owns the
-- ProseMirror/Yjs state) and POSTed here. We store the rendered HTML so a
-- version can be previewed and restored without replaying CRDT history. Restore
-- works by the client loading a version's HTML back into the live document.
--
-- Comments: a comment anchors to a text selection in the document. Because the
-- content is a CRDT we cannot rely on absolute character offsets surviving
-- concurrent edits, so each comment records the anchored quote plus the
-- selection range as a best-effort hint; the editor decorates the matching
-- range and falls back to the quote text when the range drifts.

CREATE TABLE IF NOT EXISTS grown.docs_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id      UUID NOT NULL REFERENCES grown.docs_documents(id) ON DELETE CASCADE,
    -- Author of the snapshot (the user whose edit/manual action produced it).
    author_id   UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    -- Optional human label ("Name current version"); empty for auto snapshots.
    label       TEXT NOT NULL DEFAULT '',
    -- Rendered HTML of the document at snapshot time.
    content_html TEXT NOT NULL,
    -- True when produced by a periodic/auto snapshot vs. an explicit user save.
    is_auto     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS docs_versions_doc_idx
  ON grown.docs_versions (doc_id, created_at DESC);

CREATE TABLE IF NOT EXISTS grown.docs_comments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id      UUID NOT NULL REFERENCES grown.docs_documents(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    -- The comment body text.
    body        TEXT NOT NULL,
    -- The text the comment is anchored to (the quoted selection).
    quote       TEXT NOT NULL DEFAULT '',
    -- Best-effort ProseMirror document positions of the anchored range. May
    -- drift under concurrent edits; the client re-locates via quote when needed.
    anchor_from INTEGER NOT NULL DEFAULT 0,
    anchor_to   INTEGER NOT NULL DEFAULT 0,
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS docs_comments_doc_idx
  ON grown.docs_comments (doc_id, created_at);
