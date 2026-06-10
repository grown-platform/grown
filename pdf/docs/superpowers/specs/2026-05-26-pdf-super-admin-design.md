# Pdf super_admin layer — Design

**Status:** Approved — ready for implementation plan
**Branch:** `feat/openfga-superadmin` (kept for continuity; will be renamed at PR time)
**Scope:** Add a minimal super_admin role with grant/revoke API, an "All Documents" admin view, and per-user document scoping for non-admins. Stored in a new postgres table — **no OpenFGA**, no external authz service. Quicker to ship than the full OpenFGA layer; FGA can come later if/when finer-grained authz is needed.

## Decisions

- **Storage**: new `superadmins` table in pdf's existing postgres.
- **Bootstrap**: env var `PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL` (default `lpick@pick.haus` in pick-gitops). On startup, if the table is empty AND the env var is set, insert that email as the first superadmin.
- **Identity**: comes from the existing OIDC middleware's verified ID-token claim (email). Case-insensitive comparisons throughout.
- **Document scoping**:
  - Non-superadmins: `GET /api/documents` returns **only documents they created** (`created_by` matches their email).
  - Superadmins: `GET /api/documents` returns **all** documents; the frontend shows a clear "All Documents" indicator.

## Out of scope

- Per-document permissions (owner/editor/viewer per doc)
- Organization-level roles
- Multi-tenant `org_id` wiring (still hardcoded `org_default`)
- Audit-trail entries for grant/revoke events (logs only, not in `audit_trail` table)
- PDF-from-scratch editor (separate spec)

## Database

### Migration

New goose migration `backend/internal/database/migrations/0008_superadmins.sql`:

```sql
-- +goose Up
CREATE TABLE superadmins (
    email          TEXT PRIMARY KEY,
    granted_by     TEXT NOT NULL,
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE superadmins;
```

(Use the next available version number after the current latest; the spec writes `0008` as a placeholder — confirm during implementation.)

### sqlc queries

Add `backend/sql/queries/superadmins.sql`:

```sql
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
SELECT count(*) FROM superadmins;
```

Run `sqlc-gen` to regenerate.

## Backend changes

### `internal/auth/superadmin.go` (new)

A tiny package-level helper:

```go
package auth

import (
    "context"
    "code.pick.haus/grown/pdf/internal/sqlc"
)

// IsSuperadmin returns true if the email currently has the super_admin role.
// Returns false (with no error) on DB errors so a transient DB blip does not
// elevate privilege.
func IsSuperadmin(ctx context.Context, q *sqlc.Queries, email string) bool {
    if email == "" { return false }
    ok, err := q.IsSuperadmin(ctx, email)
    if err != nil { return false }
    return ok
}
```

### `internal/auth/middleware.go` (modify)

Add a context key + helpers so handlers can read the verified email without re-parsing the cookie:

```go
type ctxKeyUserEmail struct{}

func WithUserEmail(ctx context.Context, email string) context.Context { ... }
func UserEmailFromContext(ctx context.Context) string { ... }
```

In the existing OIDC middleware (`Middleware.HTTPMiddleware`): after verifying the cookie + parsing claims, call `r.WithContext(WithUserEmail(r.Context(), claims.Email))` so downstream handlers can read it.

### `internal/handler/admin.go` (new)

Three plain-HTTP handlers registered on `rootMux` (not gRPC — avoids proto regen for an admin-only feature):

```go
type AdminHandler struct {
    db    *database.DB
}

func (h *AdminHandler) ListSuperadmins(w http.ResponseWriter, r *http.Request) {
    // GET /api/admin/superadmins
    // Returns {"superadmins":[{"email":"...","grantedBy":"...","grantedAt":"..."}]}
}

func (h *AdminHandler) GrantSuperadmin(w http.ResponseWriter, r *http.Request) {
    // POST /api/admin/superadmins/{email}
    // Body: ignored (email is in URL)
}

func (h *AdminHandler) RevokeSuperadmin(w http.ResponseWriter, r *http.Request) {
    // DELETE /api/admin/superadmins/{email}
    // Refuse if it would remove the last superadmin AND no bootstrap email is configured
    // (otherwise the system is locked out).
}
```

Each wrapped in `auth.RequireSuperadmin(h, db)` middleware that:

1. Reads `UserEmailFromContext(r.Context())`. If empty → 401.
2. Calls `IsSuperadmin(ctx, db.Queries, email)`. If false → 403.

### Document listing scope (`internal/handler/documents.go:ListDocuments`)

Modify `ListDocuments`:

1. Read caller email from context.
2. Look up `IsSuperadmin(ctx, q, email)`.
3. Pass to sqlc query: `ListDocumentsForUser(email)` for non-admins, existing `ListDocuments()` for superadmins.

New sqlc query `ListDocumentsForUser`:

```sql
-- name: ListDocumentsForUser :many
SELECT * FROM documents
WHERE lower(created_by) = lower($1)
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountDocumentsForUser :one
SELECT count(*) FROM documents WHERE lower(created_by) = lower($1);
```

`ListDocuments` keeps returning everything (used by the admin path).

### `CreateDocument` — set `created_by` to the caller's verified email

Today: `userID := "user_default"` hardcoded.
After: `userID := UserEmailFromContext(ctx)`; if empty (e.g., proxy_mode=false dev path), fall back to `"user_default"` so the dev environment continues to work but doesn't conflate users.

### `GET /api/user/me` — expose `isSuperadmin`

Extend the response struct returned by `MeHandler`:

```go
response := struct {
    ID            string `json:"id"`
    Email         string `json:"email"`
    Name          string `json:"name"`
    IsSuperadmin  bool   `json:"isSuperadmin"`
}{ ..., IsSuperadmin: auth.IsSuperadmin(r.Context(), db.Queries, claims.Email) }
```

Frontend reads this to conditionally render the admin nav item.

### Bootstrap on startup

In `cmd/server/main.go`, after migrations run and DB is ready:

```go
if cfg.Auth.BootstrapSuperadminEmail != "" {
    n, _ := db.Queries.CountSuperadmins(ctx)
    if n == 0 {
        _ = db.Queries.GrantSuperadmin(ctx, sqlc.GrantSuperadminParams{
            Email:     cfg.Auth.BootstrapSuperadminEmail,
            GrantedBy: "bootstrap",
        })
        slog.Info("Bootstrapped initial superadmin", "email", cfg.Auth.BootstrapSuperadminEmail)
    }
}
```

Idempotent: only runs when zero superadmins exist. If all superadmins are ever revoked, next boot re-bootstraps from the configured email.

### Config

Extend `AuthConfig`:

```go
type AuthConfig struct {
    // ... existing fields
    BootstrapSuperadminEmail string `koanf:"bootstrap_superadmin_email"`
}
```

Env: `PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL`. No startup validation — empty is acceptable (treated as "no auto-bootstrap").

## Frontend changes

### Nav

In `App.tsx`, the `navItems` array currently has `Documents` and `To Sign`. Add a conditional third item:

```tsx
const navItems: NavItemConfig[] = [
  { label: "Documents", href: "/documents", icon: <FileText /> },
  { label: "To Sign", href: "/to-sign", icon: <PenTool /> },
];
if (user?.isSuperadmin) {
  navItems.push({
    label: "All Documents",
    href: "/admin/documents",
    icon: <Shield />,
  });
}
```

Add the route in the `<Routes>` block: `<Route path="/admin/documents" element={<AdminDocumentsPage/>} />`.

### New page: `AdminDocumentsPage`

Located at `frontend/src/features/admin/pages/AdminDocumentsPage.tsx`. Identical to `DocumentsPage` but calls `GET /api/documents?scope=all` (or a new endpoint). Server differentiates based on `isSuperadmin` check — query param is just a hint that allows the frontend to render the page label correctly.

Actually, simpler: route the admin page to call a new endpoint `GET /api/admin/documents` that requires superadmin and returns all docs. Removes ambiguity.

Add to backend:

- `GET /api/admin/documents` → calls existing unfiltered `ListDocuments`, gated by `RequireSuperadmin`.

### `UserContext` — surface `isSuperadmin`

The existing `UserContext.useUser()` returns `{user, isLoading, logout}`. Extend `user` type to include `isSuperadmin: boolean` (from the `/api/user/me` response).

## CSRF interaction

The `POST` and `DELETE` admin endpoints are state-changing. The existing CSRF middleware (commit 951a3c…) already requires `X-Requested-With: pdf-frontend` on state-changing `/api/*` requests, OR an `Authorization` header. Frontend `apiClient` already sets `X-Requested-With` on every request. No changes needed.

## Tests

| File                                     | What it tests                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `internal/handler/admin_test.go` (new)   | List/grant/revoke superadmin via the handler — using a real DB through a test fixture (sqlc patterns the codebase uses elsewhere)                                                                            |
| `internal/auth/superadmin_test.go` (new) | `IsSuperadmin` returns true/false/false-on-error correctly                                                                                                                                                   |
| Manual smoke                             | After deploy: `curl -X GET https://sign.pick.haus/api/admin/superadmins` (with lpick's session cookie) returns lpick. `POST /api/admin/superadmins/foo@example.com` adds them. `DELETE` removes them. |

If the codebase has no DB test harness today (e.g., no testcontainers), the handler tests stub the DB. Confirm during the plan write-up.

## pick-gitops changes

| File                                       | Change                                                         |
| ------------------------------------------ | -------------------------------------------------------------- |
| `apps/base/pdf/pdf.yaml` ConfigMap | Add `PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL: lpick@pick.haus` |

That's the only deploy-side change.

## Deployment sequencing

1. Merge pdf PR (migration + handlers + frontend + config addition).
2. CI builds new image.
3. Image-automation bumps pick-gitops pdf tag.
4. Merge pick-gitops PR adding `PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL` to the ConfigMap.
5. Flux reconciles — pdf pod restarts with new image + env. Goose applies the new migration. Bootstrap inserts lpick@pick.haus. The "All Documents" nav appears for lpick after the next `/api/user/me` fetch.
