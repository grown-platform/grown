-- +goose Up
ALTER TABLE documents
ADD COLUMN annotations JSONB NOT NULL DEFAULT '[]'::jsonb;

-- +goose Down
ALTER TABLE documents
DROP COLUMN annotations;
