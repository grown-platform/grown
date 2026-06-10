-- name: CreateTemplate :one
INSERT INTO document_templates (
    id, organization_id, name, description, signer_slots, signing_order, created_by
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
)
RETURNING *;

-- name: GetTemplate :one
SELECT * FROM document_templates WHERE id = $1;

-- name: GetTemplateByOrg :one
SELECT * FROM document_templates WHERE id = $1 AND organization_id = $2;

-- name: ListTemplates :many
SELECT * FROM document_templates
WHERE organization_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountTemplates :one
SELECT COUNT(*) FROM document_templates WHERE organization_id = $1;

-- name: DeleteTemplate :exec
DELETE FROM document_templates WHERE id = $1;

-- name: CreateTemplateField :one
INSERT INTO template_fields (
    id, template_id, signer_slot, field_type, page_number,
    x, y, width, height, required, label, font_size
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
)
RETURNING *;

-- name: GetTemplateFields :many
SELECT * FROM template_fields
WHERE template_id = $1
ORDER BY signer_slot ASC, page_number ASC, y ASC;

-- name: DeleteTemplateFields :exec
DELETE FROM template_fields WHERE template_id = $1;
