-- +goose Up
CREATE TABLE superadmins (
    email      TEXT PRIMARY KEY,
    granted_by TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE superadmins;
