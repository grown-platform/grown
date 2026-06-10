-- 0064: Music – likes (favourites) table.
--
-- The playlists and playlist_tracks tables were created in 0024. This
-- migration adds the per-user track likes table so users can heart tracks
-- and view a "Liked songs" collection.

CREATE TABLE IF NOT EXISTS grown.music_likes (
    user_id     UUID NOT NULL REFERENCES grown.users(id)        ON DELETE CASCADE,
    track_id    UUID NOT NULL REFERENCES grown.music_tracks(id) ON DELETE CASCADE,
    liked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS music_likes_user_idx ON grown.music_likes (user_id);
CREATE INDEX IF NOT EXISTS music_likes_track_idx ON grown.music_likes (track_id);
