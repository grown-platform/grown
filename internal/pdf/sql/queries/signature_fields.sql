-- name: CreateSignatureField :one
INSERT INTO signature_fields (
    id, document_id, signer_id, field_type, page_number,
    x, y, width, height, required, label, placeholder, font_size
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
)
RETURNING *;

-- name: GetSignatureField :one
SELECT * FROM signature_fields WHERE id = $1;

-- name: GetSignatureFieldsByDocument :many
SELECT * FROM signature_fields
WHERE document_id = $1
ORDER BY page_number ASC, y ASC;

-- name: GetSignatureFieldsBySigner :many
SELECT * FROM signature_fields
WHERE signer_id = $1
ORDER BY page_number ASC, y ASC;

-- name: UpdateSignatureField :one
UPDATE signature_fields
SET page_number = $2, x = $3, y = $4, width = $5, height = $6, label = $7, font_size = $8, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: FillSignatureField :one
UPDATE signature_fields
SET value = $2, filled_at = NOW(), updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: DeleteSignatureField :exec
DELETE FROM signature_fields WHERE id = $1;

-- name: DeleteSignatureFieldsBySigner :exec
DELETE FROM signature_fields WHERE signer_id = $1;

-- name: CountRequiredUnfilledFields :one
SELECT COUNT(*) FROM signature_fields
WHERE signer_id = $1 AND required = true AND value IS NULL;

-- name: CountFilledFieldsBySigner :one
SELECT COUNT(*) FROM signature_fields
WHERE signer_id = $1 AND value IS NOT NULL;
