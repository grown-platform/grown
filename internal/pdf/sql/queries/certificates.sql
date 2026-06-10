-- name: CreateSigningCertificate :one
INSERT INTO signing_certificates (
    id, organization_id, user_id, certificate_type, status,
    certificate_pem, private_key_encrypted, key_encryption_key_id,
    serial_number, issuer_dn, subject_dn, valid_from, valid_to,
    ca_name, ca_certificate_chain
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
)
RETURNING *;

-- name: GetSigningCertificate :one
SELECT * FROM signing_certificates WHERE id = $1;

-- name: GetActiveCertificateByUser :one
SELECT * FROM signing_certificates
WHERE user_id = $1 AND status = 'active' AND valid_to > NOW()
ORDER BY created_at DESC
LIMIT 1;

-- name: GetActiveCertificateByOrg :one
SELECT * FROM signing_certificates
WHERE organization_id = $1 AND user_id IS NULL AND status = 'active' AND valid_to > NOW()
ORDER BY created_at DESC
LIMIT 1;

-- name: ListCertificatesByOrg :many
SELECT * FROM signing_certificates
WHERE organization_id = $1
ORDER BY created_at DESC;

-- name: RevokeCertificate :one
UPDATE signing_certificates
SET status = 'revoked', revoked_at = NOW(), revocation_reason = $2, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: GetExpiredCertificates :many
SELECT * FROM signing_certificates
WHERE status = 'active' AND valid_to < NOW();
