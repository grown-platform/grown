-- 0036: Video sharing.
--
-- Two tables:
--   video_shares      – targeted shares: video → specific org user
--   video_share_links – public link tokens (YouTube-style, no account required)

CREATE TABLE IF NOT EXISTS grown.video_shares (
    video_id         UUID NOT NULL REFERENCES grown.videos(id) ON DELETE CASCADE,
    shared_with_user_id UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (video_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS video_shares_user_idx
  ON grown.video_shares (shared_with_user_id);

CREATE TABLE IF NOT EXISTS grown.video_share_links (
    token       TEXT PRIMARY KEY,
    video_id    UUID NOT NULL REFERENCES grown.videos(id) ON DELETE CASCADE,
    org_id      UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE CASCADE,
    created_by  UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS video_share_links_video_idx
  ON grown.video_share_links (video_id) WHERE revoked_at IS NULL;
