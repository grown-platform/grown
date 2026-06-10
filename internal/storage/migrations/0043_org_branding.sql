-- 0043: Per-org branding (logo + accent color).
--
-- Backs the Admin console's "Customize branding" feature: an org may upload a
-- logo and pick an accent color that the SPA applies at session start (accent →
-- theme primary; logo → Header brand). Absence of a row, or an unset column,
-- means the deploy default brand applies.
--
-- logo_blob_key references a blob stored in the shared Drive blob store (rustfs
-- /S3). It is intentionally NOT an FK — the blob store lives outside Postgres.
-- accent_color is a CSS hex color string (e.g. "#3F704D"); NULL = default.

CREATE TABLE IF NOT EXISTS grown.org_branding (
    org_id        UUID PRIMARY KEY REFERENCES grown.orgs(id) ON DELETE CASCADE,
    logo_blob_key TEXT,
    logo_mime     TEXT,
    accent_color  TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
