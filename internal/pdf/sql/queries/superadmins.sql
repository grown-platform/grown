-- name: IsSuperadmin :one
SELECT EXISTS (SELECT 1 FROM superadmins WHERE lower(email) = lower($1));

-- name: ListSuperadmins :many
SELECT email, granted_by, granted_at FROM superadmins ORDER BY granted_at ASC;

-- name: GrantSuperadmin :exec
INSERT INTO superadmins (email, granted_by) VALUES (lower($1), $2)
ON CONFLICT (email) DO NOTHING;

-- name: RevokeSuperadmin :exec
DELETE FROM superadmins WHERE lower(email) = lower($1);

-- name: CountSuperadmins :one
SELECT count(*)::int FROM superadmins;
