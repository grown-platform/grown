-- +goose Up
-- +goose StatementBegin

CREATE TYPE signature_algorithm AS ENUM (
    'RSA_SHA256',
    'ECDSA_SHA256',
    'RSA_SHA384',
    'ECDSA_SHA384'
);

CREATE TABLE signatures (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    signer_id TEXT NOT NULL REFERENCES signers(id) ON DELETE CASCADE,

    -- Cryptographic signature data
    signature_data BYTEA NOT NULL,
    signature_algorithm signature_algorithm NOT NULL,
    certificate_chain TEXT NOT NULL,
    signing_timestamp TIMESTAMPTZ NOT NULL,

    -- Document hash at signing time
    document_hash TEXT NOT NULL,
    document_hash_algorithm TEXT NOT NULL DEFAULT 'SHA256',

    -- Long-term validation (LTV) data
    ocsp_response BYTEA,
    timestamp_token BYTEA,

    -- Verification metadata
    certificate_issuer TEXT,
    certificate_serial TEXT,
    certificate_valid_from TIMESTAMPTZ,
    certificate_valid_to TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signatures_document ON signatures(document_id);
CREATE INDEX idx_signatures_signer ON signatures(signer_id);
CREATE UNIQUE INDEX idx_signatures_document_signer ON signatures(document_id, signer_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS signatures;
DROP TYPE IF EXISTS signature_algorithm;

-- +goose StatementEnd
