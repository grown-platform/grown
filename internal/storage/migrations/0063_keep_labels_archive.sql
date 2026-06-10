-- 0063: Keep labels (managed) + archive column guard.
--
-- Introduces a first-class label entity for Keep: users can create named
-- labels within their org/user scope, then associate notes with them via a
-- junction table. The note's existing JSONB labels column is kept for
-- backward compatibility (display chips); the new tables back the label
-- manager UI and filtered views.
--
-- The archived and pinned columns already exist on grown.keep_notes from
-- migration 0033; this migration is defensive (IF NOT EXISTS) in case a
-- future schema diverges.

-- First-class label entity (org + user scoped, matching Google Keep's model
-- where labels are per-user within the org).
CREATE TABLE IF NOT EXISTS grown.keep_labels (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID        NOT NULL REFERENCES grown.orgs(id)  ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, user_id, name)
);

CREATE INDEX IF NOT EXISTS keep_labels_org_user_idx
    ON grown.keep_labels (org_id, user_id);

-- Junction table: many-to-many between notes and labels.
CREATE TABLE IF NOT EXISTS grown.keep_note_labels (
    note_id  UUID NOT NULL REFERENCES grown.keep_notes(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES grown.keep_labels(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, label_id)
);

CREATE INDEX IF NOT EXISTS keep_note_labels_label_idx
    ON grown.keep_note_labels (label_id);

-- Guard: ensure archived and pinned columns exist (they were added in 0033,
-- but this makes the migration self-contained against schema drift).
ALTER TABLE grown.keep_notes
    ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pinned   BOOLEAN NOT NULL DEFAULT false;

-- Index for the Archive view query (archived=true within an org, non-trashed).
CREATE INDEX IF NOT EXISTS keep_notes_archived_idx
    ON grown.keep_notes (org_id, archived)
    WHERE trashed_at IS NULL;
