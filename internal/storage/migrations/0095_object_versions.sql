-- 0095: Version history for Sheets, Slides and Whiteboards (CC7).
--
-- Docs keeps its own grown.docs_versions (rendered HTML captured by the
-- client). Sheets, decks and boards store their whole model as one opaque JSON
-- blob in *_documents.data, so a version here is simply a copy of that blob at
-- a point in time. One generic table serves all three apps, keyed by
-- (object_type, object_id); object_type is the app name used in the API path
-- ("sheets" | "slides" | "whiteboards").
--
-- There is no FK to the document tables (the table is shared across three of
-- them). Documents are only ever soft-deleted, and every read goes through the
-- document's own access check first, so rows of a trashed document are simply
-- unreachable.
--
-- Rows are append-only apart from the label: auto snapshots are written on save
-- (throttled server-side) and when the last editor leaves; "Name current
-- version" labels one; a restore writes the restored content back to the
-- document and appends a new version pointing at its source (restored_from),
-- so history is never rewritten. Old *auto* snapshots are pruned past a
-- per-document cap; named versions are kept.
--
-- Purely additive: nothing existing reads or writes this table.

CREATE TABLE IF NOT EXISTS grown.object_versions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_type   TEXT NOT NULL,
    object_id     UUID NOT NULL,
    -- The user whose save/action produced the snapshot. Kept when the user is
    -- removed (the version stays, authorless).
    author_id     UUID REFERENCES grown.users(id) ON DELETE SET NULL,
    -- Human label ("Name current version"); empty for unnamed snapshots.
    label         TEXT NOT NULL DEFAULT '',
    -- The document's stored JSON at snapshot time.
    data          TEXT NOT NULL,
    -- sha256 of data (hex), to skip snapshots identical to the previous one.
    data_hash     TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    -- True for automatic snapshots (on save / session end); false for named
    -- and restore versions.
    is_auto       BOOLEAN NOT NULL DEFAULT FALSE,
    -- Set on a version created by a restore: the version it was restored from.
    restored_from UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS object_versions_object_idx
  ON grown.object_versions (object_type, object_id, created_at DESC);
