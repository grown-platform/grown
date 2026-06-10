-- 0032: Admin — per-org service settings.
--
-- Backs the Admin console's "Apps & services" feature: a row here means an org
-- has explicitly set whether one workspace service is enabled for its members.
-- Absence of a row means the service is enabled by default (default-on), so the
-- application layer treats any unset service_id as enabled=true.
--
-- service_id is a free-form TEXT matching a frontend catalog app id (e.g.
-- "music", "books", "docs"); it is intentionally not an FK since the catalog
-- lives in the frontend, not the database.

CREATE TABLE IF NOT EXISTS grown.org_service_settings (
    org_id      UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE CASCADE,
    service_id  TEXT NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, service_id)
);
