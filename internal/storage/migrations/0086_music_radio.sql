-- 0086: Music – radio stations + stream caching.
--
-- Radio stations are per-org named streams (ICY/Shoutcast). When a user plays a
-- station, the server taps the stream, parses ICY StreamTitle metadata, and
-- caches each complete song as a normal grown.music_tracks row with
-- source='radio', album = station name, and radio_station_id set. This lets the
-- existing album/track library views surface a station's recorded songs with no
-- new read paths. Retention is per-station: 'keep' holds songs indefinitely,
-- 'days' trashes radio-source tracks older than retention_days.

CREATE TABLE IF NOT EXISTS grown.music_radio_stations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    name            TEXT NOT NULL,
    stream_url      TEXT NOT NULL,
    genre           TEXT,
    logo_url        TEXT,
    retention_mode  TEXT NOT NULL DEFAULT 'keep' CHECK (retention_mode IN ('keep', 'days')),
    retention_days  INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_radio_stations_org_idx ON grown.music_radio_stations (org_id);

-- One station per (org, stream_url) so the seeder is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS music_radio_stations_org_url_idx
    ON grown.music_radio_stations (org_id, stream_url);

-- Mark radio-recorded tracks so they're distinguishable / groupable / sweepable.
ALTER TABLE grown.music_tracks
    ADD COLUMN IF NOT EXISTS radio_station_id UUID
        REFERENCES grown.music_radio_stations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload';

CREATE INDEX IF NOT EXISTS music_tracks_radio_station_idx
    ON grown.music_tracks (radio_station_id) WHERE trashed_at IS NULL;
