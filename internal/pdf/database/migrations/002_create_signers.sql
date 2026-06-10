-- +goose Up
-- +goose StatementBegin

CREATE TYPE signer_status AS ENUM (
    'pending',
    'viewed',
    'signed',
    'declined',
    'expired'
);

CREATE TYPE signer_type AS ENUM (
    'signer',
    'approver',
    'cc'
);

CREATE TABLE signers (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

    -- Signer identification
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    user_id TEXT,

    -- Signer configuration
    signer_type signer_type NOT NULL DEFAULT 'signer',
    signing_order INTEGER NOT NULL DEFAULT 1,
    status signer_status NOT NULL DEFAULT 'pending',

    -- Access token for guest signing
    access_token TEXT UNIQUE,
    access_token_expires_at TIMESTAMPTZ,

    -- Tracking
    email_sent_at TIMESTAMPTZ,
    last_reminder_at TIMESTAMPTZ,
    viewed_at TIMESTAMPTZ,
    signed_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    decline_reason TEXT,

    -- IP and device tracking for audit
    signing_ip_address INET,
    signing_user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(document_id, email)
);

CREATE INDEX idx_signers_document ON signers(document_id);
CREATE INDEX idx_signers_email ON signers(email);
CREATE INDEX idx_signers_user ON signers(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_signers_access_token ON signers(access_token) WHERE access_token IS NOT NULL;
CREATE INDEX idx_signers_status ON signers(status);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS signers;
DROP TYPE IF EXISTS signer_status;
DROP TYPE IF EXISTS signer_type;

-- +goose StatementEnd
