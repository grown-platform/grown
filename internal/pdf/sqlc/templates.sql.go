// Hand-written sqlc-style queries for document_templates and template_fields.
// Keep in sync with sql/queries/templates.sql and migration 010.

package sqlc

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

// DocumentTemplate represents a row in document_templates.
type DocumentTemplate struct {
	ID             string             `json:"id"`
	OrganizationID string             `json:"organization_id"`
	Name           string             `json:"name"`
	Description    pgtype.Text        `json:"description"`
	SignerSlots    int32              `json:"signer_slots"`
	SigningOrder   bool               `json:"signing_order"`
	CreatedBy      string             `json:"created_by"`
	CreatedAt      pgtype.Timestamptz `json:"created_at"`
	UpdatedAt      pgtype.Timestamptz `json:"updated_at"`
}

// TemplateField represents a row in template_fields.
type TemplateField struct {
	ID         string             `json:"id"`
	TemplateID string             `json:"template_id"`
	SignerSlot int32              `json:"signer_slot"`
	FieldType  string             `json:"field_type"`
	PageNumber int32              `json:"page_number"`
	X          pgtype.Numeric     `json:"x"`
	Y          pgtype.Numeric     `json:"y"`
	Width      pgtype.Numeric     `json:"width"`
	Height     pgtype.Numeric     `json:"height"`
	Required   bool               `json:"required"`
	Label      pgtype.Text        `json:"label"`
	FontSize   pgtype.Int4        `json:"font_size"`
	CreatedAt  pgtype.Timestamptz `json:"created_at"`
}

// --- CreateTemplate ---

const createTemplate = `
INSERT INTO document_templates (
    id, organization_id, name, description, signer_slots, signing_order, created_by
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, organization_id, name, description, signer_slots, signing_order, created_by, created_at, updated_at
`

type CreateTemplateParams struct {
	ID             string      `json:"id"`
	OrganizationID string      `json:"organization_id"`
	Name           string      `json:"name"`
	Description    pgtype.Text `json:"description"`
	SignerSlots    int32       `json:"signer_slots"`
	SigningOrder   bool        `json:"signing_order"`
	CreatedBy      string      `json:"created_by"`
}

func (q *Queries) CreateTemplate(ctx context.Context, arg CreateTemplateParams) (DocumentTemplate, error) {
	row := q.db.QueryRow(ctx, createTemplate,
		arg.ID, arg.OrganizationID, arg.Name, arg.Description,
		arg.SignerSlots, arg.SigningOrder, arg.CreatedBy,
	)
	var t DocumentTemplate
	err := row.Scan(
		&t.ID, &t.OrganizationID, &t.Name, &t.Description,
		&t.SignerSlots, &t.SigningOrder, &t.CreatedBy,
		&t.CreatedAt, &t.UpdatedAt,
	)
	return t, err
}

// --- GetTemplate ---

const getTemplate = `
SELECT id, organization_id, name, description, signer_slots, signing_order, created_by, created_at, updated_at
FROM document_templates WHERE id = $1
`

func (q *Queries) GetTemplate(ctx context.Context, id string) (DocumentTemplate, error) {
	row := q.db.QueryRow(ctx, getTemplate, id)
	var t DocumentTemplate
	err := row.Scan(
		&t.ID, &t.OrganizationID, &t.Name, &t.Description,
		&t.SignerSlots, &t.SigningOrder, &t.CreatedBy,
		&t.CreatedAt, &t.UpdatedAt,
	)
	return t, err
}

// --- GetTemplateByOrg ---

const getTemplateByOrg = `
SELECT id, organization_id, name, description, signer_slots, signing_order, created_by, created_at, updated_at
FROM document_templates WHERE id = $1 AND organization_id = $2
`

type GetTemplateByOrgParams struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organization_id"`
}

func (q *Queries) GetTemplateByOrg(ctx context.Context, arg GetTemplateByOrgParams) (DocumentTemplate, error) {
	row := q.db.QueryRow(ctx, getTemplateByOrg, arg.ID, arg.OrganizationID)
	var t DocumentTemplate
	err := row.Scan(
		&t.ID, &t.OrganizationID, &t.Name, &t.Description,
		&t.SignerSlots, &t.SigningOrder, &t.CreatedBy,
		&t.CreatedAt, &t.UpdatedAt,
	)
	return t, err
}

// --- ListTemplates ---

const listTemplates = `
SELECT id, organization_id, name, description, signer_slots, signing_order, created_by, created_at, updated_at
FROM document_templates
WHERE organization_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3
`

type ListTemplatesParams struct {
	OrganizationID string `json:"organization_id"`
	Limit          int32  `json:"limit"`
	Offset         int32  `json:"offset"`
}

func (q *Queries) ListTemplates(ctx context.Context, arg ListTemplatesParams) ([]DocumentTemplate, error) {
	rows, err := q.db.Query(ctx, listTemplates, arg.OrganizationID, arg.Limit, arg.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []DocumentTemplate{}
	for rows.Next() {
		var t DocumentTemplate
		if err := rows.Scan(
			&t.ID, &t.OrganizationID, &t.Name, &t.Description,
			&t.SignerSlots, &t.SigningOrder, &t.CreatedBy,
			&t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, t)
	}
	return items, rows.Err()
}

// --- CountTemplates ---

const countTemplates = `SELECT COUNT(*) FROM document_templates WHERE organization_id = $1`

func (q *Queries) CountTemplates(ctx context.Context, organizationID string) (int64, error) {
	row := q.db.QueryRow(ctx, countTemplates, organizationID)
	var n int64
	err := row.Scan(&n)
	return n, err
}

// --- DeleteTemplate ---

const deleteTemplate = `DELETE FROM document_templates WHERE id = $1`

func (q *Queries) DeleteTemplate(ctx context.Context, id string) error {
	_, err := q.db.Exec(ctx, deleteTemplate, id)
	return err
}

// --- CreateTemplateField ---

const createTemplateField = `
INSERT INTO template_fields (
    id, template_id, signer_slot, field_type, page_number,
    x, y, width, height, required, label, font_size
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING id, template_id, signer_slot, field_type, page_number, x, y, width, height, required, label, font_size, created_at
`

type CreateTemplateFieldParams struct {
	ID         string         `json:"id"`
	TemplateID string         `json:"template_id"`
	SignerSlot int32          `json:"signer_slot"`
	FieldType  string         `json:"field_type"`
	PageNumber int32          `json:"page_number"`
	X          pgtype.Numeric `json:"x"`
	Y          pgtype.Numeric `json:"y"`
	Width      pgtype.Numeric `json:"width"`
	Height     pgtype.Numeric `json:"height"`
	Required   bool           `json:"required"`
	Label      pgtype.Text    `json:"label"`
	FontSize   pgtype.Int4    `json:"font_size"`
}

func (q *Queries) CreateTemplateField(ctx context.Context, arg CreateTemplateFieldParams) (TemplateField, error) {
	row := q.db.QueryRow(ctx, createTemplateField,
		arg.ID, arg.TemplateID, arg.SignerSlot, arg.FieldType, arg.PageNumber,
		arg.X, arg.Y, arg.Width, arg.Height, arg.Required, arg.Label, arg.FontSize,
	)
	var f TemplateField
	err := row.Scan(
		&f.ID, &f.TemplateID, &f.SignerSlot, &f.FieldType, &f.PageNumber,
		&f.X, &f.Y, &f.Width, &f.Height, &f.Required, &f.Label, &f.FontSize,
		&f.CreatedAt,
	)
	return f, err
}

// --- GetTemplateFields ---

const getTemplateFields = `
SELECT id, template_id, signer_slot, field_type, page_number, x, y, width, height, required, label, font_size, created_at
FROM template_fields
WHERE template_id = $1
ORDER BY signer_slot ASC, page_number ASC, y ASC
`

func (q *Queries) GetTemplateFields(ctx context.Context, templateID string) ([]TemplateField, error) {
	rows, err := q.db.Query(ctx, getTemplateFields, templateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []TemplateField{}
	for rows.Next() {
		var f TemplateField
		if err := rows.Scan(
			&f.ID, &f.TemplateID, &f.SignerSlot, &f.FieldType, &f.PageNumber,
			&f.X, &f.Y, &f.Width, &f.Height, &f.Required, &f.Label, &f.FontSize,
			&f.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, f)
	}
	return items, rows.Err()
}

// --- DeleteTemplateFields ---

const deleteTemplateFields = `DELETE FROM template_fields WHERE template_id = $1`

func (q *Queries) DeleteTemplateFields(ctx context.Context, templateID string) error {
	_, err := q.db.Exec(ctx, deleteTemplateFields, templateID)
	return err
}
