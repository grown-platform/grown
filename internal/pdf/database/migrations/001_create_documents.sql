-- +goose Up
-- +goose StatementBegin

CREATE TYPE document_status AS ENUM (
    'draft',
    'pending',
    'in_progress',
    'completed',
    'declined',
    'expired',
    'voided'
);

CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status document_status NOT NULL DEFAULT 'draft',

    -- Storage references
    storage_key TEXT NOT NULL,
    signed_storage_key TEXT,

    -- Metadata
    total_pages INTEGER NOT NULL DEFAULT 1,
    file_size_bytes BIGINT,
    mime_type TEXT NOT NULL DEFAULT 'application/pdf',

    -- Signing configuration
    signing_order BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ,
    reminder_frequency_days INTEGER DEFAULT 3,

    -- Audit
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_documents_organization ON documents(organization_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_created_by ON documents(created_by);
CREATE INDEX idx_documents_expires_at ON documents(expires_at) WHERE expires_at IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS documents;
DROP TYPE IF EXISTS document_status;

-- +goose StatementEnd
