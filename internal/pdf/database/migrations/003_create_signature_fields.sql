-- +goose Up
-- +goose StatementBegin

CREATE TYPE field_type AS ENUM (
    'signature',
    'initials',
    'date',
    'text',
    'checkbox'
);

CREATE TABLE signature_fields (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    signer_id TEXT NOT NULL REFERENCES signers(id) ON DELETE CASCADE,

    field_type field_type NOT NULL DEFAULT 'signature',
    page_number INTEGER NOT NULL,

    -- Position (normalized 0-1 coordinates, compatible with tibui PDFEditor)
    x DECIMAL(10, 8) NOT NULL,
    y DECIMAL(10, 8) NOT NULL,
    width DECIMAL(10, 8) NOT NULL,
    height DECIMAL(10, 8) NOT NULL,

    -- Field properties
    required BOOLEAN NOT NULL DEFAULT true,
    label TEXT,
    placeholder TEXT,

    -- Filled value
    value TEXT,
    filled_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signature_fields_document ON signature_fields(document_id);
CREATE INDEX idx_signature_fields_signer ON signature_fields(signer_id);
CREATE INDEX idx_signature_fields_page ON signature_fields(document_id, page_number);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS signature_fields;
DROP TYPE IF EXISTS field_type;

-- +goose StatementEnd
