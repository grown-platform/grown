-- +goose Up
-- +goose StatementBegin

CREATE TYPE certificate_type AS ENUM (
    'user',
    'organization',
    'timestamp'
);

CREATE TYPE certificate_status AS ENUM (
    'active',
    'revoked',
    'expired'
);

CREATE TABLE signing_certificates (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    user_id TEXT,

    certificate_type certificate_type NOT NULL,
    status certificate_status NOT NULL DEFAULT 'active',

    -- Certificate data
    certificate_pem TEXT NOT NULL,
    private_key_encrypted BYTEA NOT NULL,
    key_encryption_key_id TEXT NOT NULL,

    -- Certificate metadata
    serial_number TEXT NOT NULL,
    issuer_dn TEXT NOT NULL,
    subject_dn TEXT NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ NOT NULL,

    -- CA information
    ca_name TEXT NOT NULL,
    ca_certificate_chain TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT
);

CREATE INDEX idx_signing_certs_org ON signing_certificates(organization_id);
CREATE INDEX idx_signing_certs_user ON signing_certificates(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_signing_certs_status ON signing_certificates(status);
CREATE UNIQUE INDEX idx_signing_certs_serial ON signing_certificates(serial_number, ca_name);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS signing_certificates;
DROP TYPE IF EXISTS certificate_status;
DROP TYPE IF EXISTS certificate_type;

-- +goose StatementEnd
