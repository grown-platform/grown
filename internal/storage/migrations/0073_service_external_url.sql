-- 0073: Add external_url to per-org service settings.
--
-- When set, the dashboard tile for that service opens the external URL in a
-- new tab instead of routing to the built-in grown page.  The canonical use
-- case is pointing the Photos tile at the org's Immich instance, but the
-- override applies to every catalog app uniformly.
--
-- NULL means "use the internal route" (the previous and default behaviour);
-- an empty string is normalised to NULL by the application layer.

ALTER TABLE grown.org_service_settings
    ADD COLUMN IF NOT EXISTS external_url TEXT;
