-- name: CreateDocument :one
INSERT INTO documents (
    id, organization_id, name, description, status, storage_key,
    total_pages, file_size_bytes, signing_order, expires_at,
    reminder_frequency_days, created_by
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
)
RETURNING *;

-- name: GetDocument :one
SELECT * FROM documents WHERE id = $1;

-- name: GetDocumentByOrg :one
SELECT * FROM documents WHERE id = $1 AND organization_id = $2;

-- name: UpdateDocument :one
UPDATE documents
SET name = $2, description = $3, signing_order = $4, expires_at = $5, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateDocumentStatus :one
UPDATE documents
SET status = $2, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateDocumentSignedKey :one
UPDATE documents
SET signed_storage_key = $2, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateDocumentCompleted :one
UPDATE documents
SET status = 'completed', signed_storage_key = $2, completed_at = NOW(), updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateDocumentPageCount :one
UPDATE documents
SET total_pages = $2, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: DeleteDocument :exec
DELETE FROM documents WHERE id = $1;

-- name: ListDocumentsByOrg :many
SELECT * FROM documents
WHERE organization_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListDocumentsByOrgAndStatus :many
SELECT * FROM documents
WHERE organization_id = $1 AND status = $2
ORDER BY created_at DESC
LIMIT $3 OFFSET $4;

-- name: CountDocumentsByOrg :one
SELECT COUNT(*) FROM documents WHERE organization_id = $1;

-- name: CountDocumentsByOrgAndStatus :one
SELECT COUNT(*) FROM documents WHERE organization_id = $1 AND status = $2;

-- name: GetExpiredDocuments :many
SELECT * FROM documents
WHERE status IN ('pending', 'in_progress')
AND expires_at IS NOT NULL
AND expires_at < NOW();

-- name: ListAllDocuments :many
SELECT * FROM documents
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountAllDocuments :one
SELECT COUNT(*) FROM documents;

-- name: ListDocumentsForUser :many
SELECT * FROM documents
WHERE lower(created_by) = lower($1)
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountDocumentsForUser :one
SELECT count(*)::int FROM documents WHERE lower(created_by) = lower($1);

-- name: GetDocumentAnnotations :one
SELECT annotations FROM documents WHERE id = $1;

-- name: UpdateDocumentAnnotations :exec
UPDATE documents SET annotations = $2, updated_at = now() WHERE id = $1;
