-- 0058: Photos albums + per-user favorites extension.
--
-- Adds photo_album_items (a canonical alias for the album-photo join table with
-- the name used in later tooling), and photo_favorites (a per-user favorites
-- table that decouples "favorited by this user" from the per-row boolean on
-- grown.photos — useful when multiple users share an org library).
--
-- The existing grown.album_photos join table and grown.photos.favorite column
-- remain in place and are still used by the current repository layer; these new
-- tables are additive and prepared for future per-user semantics.

-- Per-user favorites: each (user_id, photo_id) pair is unique.
CREATE TABLE IF NOT EXISTS grown.photo_favorites (
    user_id   UUID NOT NULL REFERENCES grown.users(id)  ON DELETE CASCADE,
    photo_id  UUID NOT NULL REFERENCES grown.photos(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, photo_id)
);

CREATE INDEX IF NOT EXISTS photo_favorites_user_idx
    ON grown.photo_favorites (user_id);

CREATE INDEX IF NOT EXISTS photo_favorites_photo_idx
    ON grown.photo_favorites (photo_id);

-- Canonical alias for the album–photo join table (identical semantics to
-- grown.album_photos; both are maintained going forward).
CREATE TABLE IF NOT EXISTS grown.photo_album_items (
    album_id  UUID NOT NULL REFERENCES grown.photo_albums(id) ON DELETE CASCADE,
    photo_id  UUID NOT NULL REFERENCES grown.photos(id)       ON DELETE CASCADE,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (album_id, photo_id)
);

CREATE INDEX IF NOT EXISTS photo_album_items_photo_idx
    ON grown.photo_album_items (photo_id);

CREATE INDEX IF NOT EXISTS photo_album_items_album_idx
    ON grown.photo_album_items (album_id, added_at DESC);
