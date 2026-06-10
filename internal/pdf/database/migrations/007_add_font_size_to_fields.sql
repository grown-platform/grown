-- +goose Up
-- +goose StatementBegin

ALTER TABLE signature_fields ADD COLUMN font_size INTEGER DEFAULT 12;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE signature_fields DROP COLUMN IF EXISTS font_size;

-- +goose StatementEnd
