-- 0045: per-org brandable product name. NULL ⇒ the SPA falls back to the
-- default ("Grown"). Extends the org_branding row added in 0043.
ALTER TABLE grown.org_branding ADD COLUMN IF NOT EXISTS product_name TEXT;
