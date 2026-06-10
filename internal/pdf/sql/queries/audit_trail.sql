-- name: CreateAuditEntry :one
INSERT INTO audit_trail (
    id, document_id, signer_id, user_id, action, action_details,
    ip_address, user_agent, geo_location
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING *;

-- name: GetAuditTrail :many
SELECT * FROM audit_trail
WHERE document_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountAuditEntries :one
SELECT COUNT(*) FROM audit_trail WHERE document_id = $1;

-- name: GetAuditEntriesBySigner :many
SELECT * FROM audit_trail
WHERE signer_id = $1
ORDER BY created_at DESC;

-- name: GetAuditEntriesByAction :many
SELECT * FROM audit_trail
WHERE document_id = $1 AND action = $2
ORDER BY created_at DESC;
