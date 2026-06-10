-- +goose Up
-- +goose StatementBegin

-- Add 'sent' to signer_status enum so the first signer can be marked as
-- notified while subsequent signers wait for their turn.
ALTER TYPE signer_status ADD VALUE IF NOT EXISTS 'sent';

-- Document templates: saved field layouts that can be reused
CREATE TABLE IF NOT EXISTS document_templates (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,

    -- How many signer roles this template expects (slot positions 1..n)
    signer_slots INTEGER NOT NULL DEFAULT 1,

    -- Whether signers should sign in slot order
    signing_order BOOLEAN NOT NULL DEFAULT false,

    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_templates_org ON document_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_document_templates_created_by ON document_templates(created_by);

-- Template fields: field layout stored per signer slot (1-based)
CREATE TABLE IF NOT EXISTS template_fields (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,

    -- Which signer slot this field belongs to (1-based)
    signer_slot INTEGER NOT NULL DEFAULT 1,

    field_type TEXT NOT NULL DEFAULT 'signature',
    page_number INTEGER NOT NULL,

    -- Normalized 0-1 coordinates (same convention as signature_fields)
    x DECIMAL(10, 8) NOT NULL,
    y DECIMAL(10, 8) NOT NULL,
    width DECIMAL(10, 8) NOT NULL,
    height DECIMAL(10, 8) NOT NULL,

    required BOOLEAN NOT NULL DEFAULT true,
    label TEXT,
    font_size INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_fields_template ON template_fields(template_id);
CREATE INDEX IF NOT EXISTS idx_template_fields_slot ON template_fields(template_id, signer_slot);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS template_fields;
DROP TABLE IF EXISTS document_templates;

-- NOTE: Postgres does not support removing enum values directly.
-- The 'sent' value added to signer_status remains but is unused after rollback.

-- +goose StatementEnd
