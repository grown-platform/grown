-- name: CreateSigner :one
INSERT INTO signers (
    id, document_id, email, name, user_id, signer_type, signing_order
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
)
RETURNING *;

-- name: GetSigner :one
SELECT * FROM signers WHERE id = $1;

-- name: GetSignerByToken :one
SELECT * FROM signers
WHERE access_token = $1
AND access_token_expires_at > NOW();

-- name: GetSignersByDocument :many
SELECT * FROM signers
WHERE document_id = $1
ORDER BY signing_order ASC;

-- name: UpdateSigner :one
UPDATE signers
SET name = $2, email = $3, signer_type = $4, signing_order = $5, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateSignerStatus :one
UPDATE signers
SET status = $2, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateSignerSent :one
UPDATE signers
SET status = 'sent', email_sent_at = NOW(), updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateSignerViewed :one
UPDATE signers
SET status = 'viewed', viewed_at = NOW(), updated_at = NOW()
WHERE id = $1 AND status IN ('pending', 'sent')
RETURNING *;

-- name: UpdateSignerSigned :one
UPDATE signers
SET status = 'signed', signed_at = NOW(), signing_ip_address = $2, signing_user_agent = $3, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateSignerDeclined :one
UPDATE signers
SET status = 'declined', declined_at = NOW(), decline_reason = $2, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: SetSignerAccessToken :one
UPDATE signers
SET access_token = $2, access_token_expires_at = $3, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateSignerEmailSent :one
UPDATE signers
SET email_sent_at = NOW(), updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateSignerReminder :one
UPDATE signers
SET last_reminder_at = NOW(), updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: DeleteSigner :exec
DELETE FROM signers WHERE id = $1;

-- name: GetPendingSignersByDocument :many
SELECT * FROM signers
WHERE document_id = $1 AND status IN ('pending', 'viewed')
ORDER BY signing_order ASC;

-- name: GetNextSigner :one
SELECT * FROM signers
WHERE document_id = $1 AND status IN ('pending', 'viewed')
ORDER BY signing_order ASC
LIMIT 1;

-- name: CountSignedSigners :one
SELECT COUNT(*) FROM signers WHERE document_id = $1 AND status = 'signed';

-- name: CountTotalSigners :one
SELECT COUNT(*) FROM signers WHERE document_id = $1 AND signer_type = 'signer';

-- name: GetSignersByEmail :many
SELECT s.* FROM signers s
JOIN documents d ON d.id = s.document_id
WHERE s.email = $1
AND s.status IN ('pending', 'viewed')
AND d.status IN ('pending', 'in_progress')
ORDER BY d.created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountSignersByEmail :one
SELECT COUNT(*) FROM signers s
JOIN documents d ON d.id = s.document_id
WHERE s.email = $1
AND s.status IN ('pending', 'viewed')
AND d.status IN ('pending', 'in_progress');
