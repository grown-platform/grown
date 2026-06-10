-- +goose Up
-- +goose StatementBegin

CREATE TYPE audit_action AS ENUM (
    'document_created',
    'document_updated',
    'document_sent',
    'document_viewed',
    'document_completed',
    'document_declined',
    'document_voided',
    'document_expired',

    'signer_added',
    'signer_removed',
    'signer_notified',
    'signer_reminded',

    'field_added',
    'field_updated',
    'field_removed',
    'field_filled',

    'signature_captured',
    'signature_validated',

    'certificate_issued',
    'certificate_validated'
);

CREATE TABLE audit_trail (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    signer_id TEXT REFERENCES signers(id) ON DELETE SET NULL,
    user_id TEXT,

    action audit_action NOT NULL,
    action_details JSONB,

    -- Request metadata
    ip_address INET,
    user_agent TEXT,
    geo_location TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_trail_document ON audit_trail(document_id);
CREATE INDEX idx_audit_trail_action ON audit_trail(action);
CREATE INDEX idx_audit_trail_created ON audit_trail(created_at);
CREATE INDEX idx_audit_trail_signer ON audit_trail(signer_id) WHERE signer_id IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS audit_trail;
DROP TYPE IF EXISTS audit_action;

-- +goose StatementEnd
