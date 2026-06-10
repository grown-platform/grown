-- name: CreateSignature :one
INSERT INTO signatures (
    id, document_id, signer_id, signature_data, signature_algorithm,
    certificate_chain, signing_timestamp, document_hash, document_hash_algorithm,
    ocsp_response, timestamp_token, certificate_issuer, certificate_serial,
    certificate_valid_from, certificate_valid_to
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
)
RETURNING *;

-- name: GetSignature :one
SELECT * FROM signatures WHERE id = $1;

-- name: GetSignatureByDocumentAndSigner :one
SELECT * FROM signatures WHERE document_id = $1 AND signer_id = $2;

-- name: GetSignaturesByDocument :many
SELECT * FROM signatures
WHERE document_id = $1
ORDER BY signing_timestamp ASC;

-- name: CountSignaturesByDocument :one
SELECT COUNT(*) FROM signatures WHERE document_id = $1;
