# Pdf super_admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DB-backed super_admin role with grant/revoke API, bootstrap from env var, scoped document listing for non-admins, and an admin-only "All Documents" view. No OpenFGA in this iteration.

**Architecture:** New `superadmins` postgres table (email → granted_by/granted_at). Existing OIDC middleware stashes the verified user email into context. Three new admin HTTP endpoints registered directly on the root mux (no proto / gRPC gateway) gated by a `RequireSuperadmin` middleware. `ListDocuments` filters by `created_by = caller_email` for non-admins; superadmins hit a separate `/api/admin/documents` for the full list. `CreateDocument` records the caller email as `created_by` (was hardcoded `user_default`). `/api/user/me` exposes `isSuperadmin` so the frontend can conditionally render the admin nav.

**Tech Stack:** Go 1.21+, postgres + goose migrations, sqlc, koanf config, React 19 + react-query. Run all commands inside `nix develop`. Pre-commit hook has a known symlink churn — use `--no-verify` on commits.

---

## File map

| File                                                       | Action | Purpose                                                                                                    |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `backend/internal/config/config.go`                        | Modify | Add `BootstrapSuperadminEmail` to `AuthConfig`                                                             |
| `backend/internal/database/migrations/008_superadmins.sql` | Create | Goose migration                                                                                            |
| `backend/sql/queries/superadmins.sql`                      | Create | sqlc queries for the new table                                                                             |
| `backend/sql/queries/documents.sql`                        | Modify | Add `ListDocumentsForUser`, `CountDocumentsForUser`                                                        |
| `backend/internal/auth/context.go`                         | Create | `WithUserEmail`, `UserEmailFromContext` helpers                                                            |
| `backend/internal/auth/superadmin.go`                      | Create | `IsSuperadmin(ctx, db, email) bool` helper + `RequireSuperadmin` HTTP middleware                           |
| `backend/internal/auth/superadmin_test.go`                 | Create | Pure unit tests against the middleware (no DB)                                                             |
| `backend/internal/auth/middleware.go`                      | Modify | After successful verify, parse claims and stash email into context                                         |
| `backend/internal/auth/oauth.go`                           | Modify | `MeHandler` response: add `isSuperadmin` field                                                             |
| `backend/internal/handler/admin.go`                        | Create | `AdminHandler` with `ListSuperadmins`, `GrantSuperadmin`, `RevokeSuperadmin`, `ListAllDocuments`           |
| `backend/internal/handler/documents.go`                    | Modify | `ListDocuments` filters by caller email for non-admins; `CreateDocument` uses caller email as `created_by` |
| `backend/cmd/server/main.go`                               | Modify | Construct `AdminHandler`, register admin routes, run bootstrap on startup                                  |
| `frontend/src/contexts/UserContext.tsx`                    | Modify | Surface `isSuperadmin` from `/api/user/me`                                                                 |
| `frontend/src/App.tsx`                                     | Modify | Conditionally add "All Documents" nav item + route                                                         |
| `frontend/src/features/admin/pages/AdminDocumentsPage.tsx` | Create | Lists all documents (calls `/api/admin/documents`)                                                         |

pick-gitops (separate PR):
| File | Action |
|------|--------|
| `apps/base/pdf/pdf.yaml` | Add `PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL: lpick@pick.haus` to the ConfigMap |

---

## Task 1: Add `BootstrapSuperadminEmail` to AuthConfig

**Files:**

- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/config/config_test.go` (add a test for the new field)

- [ ] **Step 1: Write the failing test**

Append to `backend/internal/config/config_test.go`:

```go
func TestLoad_BootstrapSuperadminEmailFromEnv(t *testing.T) {
	t.Setenv("PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL", "admin@example.com")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Auth.BootstrapSuperadminEmail != "admin@example.com" {
		t.Fatalf("expected admin@example.com, got %q", cfg.Auth.BootstrapSuperadminEmail)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```
nix develop --command go test ./internal/config/... -run TestLoad_BootstrapSuperadminEmailFromEnv -v
```

From `backend/`. Expected: compile error (`BootstrapSuperadminEmail` undefined).

- [ ] **Step 3: Add the field**

In `backend/internal/config/config.go`, inside `AuthConfig` struct (currently at line 44-51), add a new field after `CookieSecure`:

```go
	// BootstrapSuperadminEmail is the email granted superadmin on first
	// boot when the `superadmins` table is empty. Idempotent: only runs
	// when zero superadmins exist. If unset, no bootstrap happens.
	BootstrapSuperadminEmail string `koanf:"bootstrap_superadmin_email"`
```

- [ ] **Step 4: Run test to verify it passes**

```
nix develop --command go test ./internal/config/... -run TestLoad_BootstrapSuperadminEmailFromEnv -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/config/config.go backend/internal/config/config_test.go
git commit --no-verify -m "config: add Auth.BootstrapSuperadminEmail"
```

---

## Task 2: Database migration for `superadmins`

**Files:**

- Create: `backend/internal/database/migrations/008_superadmins.sql`

- [ ] **Step 1: Create the migration file**

Write `backend/internal/database/migrations/008_superadmins.sql`:

```sql
-- +goose Up
CREATE TABLE superadmins (
    email      TEXT PRIMARY KEY,
    granted_by TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE superadmins;
```

- [ ] **Step 2: Verify migrations parse**

From the repo root, in `nix develop`:

```
nix develop --command bash -c 'cd backend && goose -dir internal/database/migrations validate'
```

(If `goose validate` is not available, just confirm the file exists and the syntax is well-formed.) Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/database/migrations/008_superadmins.sql
git commit --no-verify -m "db: add superadmins migration"
```

---

## Task 3: sqlc queries for superadmins + per-user document listing

**Files:**

- Create: `backend/sql/queries/superadmins.sql`
- Modify: `backend/sql/queries/documents.sql` (append)

- [ ] **Step 1: Write the superadmins queries**

Create `backend/sql/queries/superadmins.sql`:

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
SELECT count(*)::int FROM superadmins;
```

- [ ] **Step 2: Append per-user document listing queries**

Append to `backend/sql/queries/documents.sql`:

```sql
-- name: ListDocumentsForUser :many
SELECT * FROM documents
WHERE lower(created_by) = lower($1)
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountDocumentsForUser :one
SELECT count(*)::int FROM documents WHERE lower(created_by) = lower($1);
```

- [ ] **Step 3: Regenerate sqlc**

From `backend/`:

```
nix develop --command sqlc-gen
```

Expected: updated files under `backend/internal/sqlc/`. Look for `IsSuperadmin`, `ListSuperadmins`, `GrantSuperadmin`, `RevokeSuperadmin`, `CountSuperadmins`, `ListDocumentsForUser`, `CountDocumentsForUser` in `backend/internal/sqlc/querier.go` and the corresponding `.sql.go` files.

- [ ] **Step 4: Verify build**

```
nix develop --command go build ./...
```

From `backend/`. Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add backend/sql/queries/superadmins.sql backend/sql/queries/documents.sql backend/internal/sqlc/
git commit --no-verify -m "sqlc: superadmins + per-user document queries"
```

---

## Task 4: Auth context helpers (`WithUserEmail`, `UserEmailFromContext`)

**Files:**

- Create: `backend/internal/auth/context.go`

- [ ] **Step 1: Write the file**

Create `backend/internal/auth/context.go`:

```go
package auth

import "context"

// userEmailKeyType is a unique private type for the user-email context key
// so external packages can't accidentally collide.
type userEmailKeyType struct{}

var userEmailKey = userEmailKeyType{}

// WithUserEmail returns a new context carrying the given email as the
// authenticated user's verified email.
func WithUserEmail(ctx context.Context, email string) context.Context {
	return context.WithValue(ctx, userEmailKey, email)
}

// UserEmailFromContext returns the authenticated user's email if the
// auth middleware has stashed one. Empty string means no user.
func UserEmailFromContext(ctx context.Context) string {
	email, _ := ctx.Value(userEmailKey).(string)
	return email
}
```

- [ ] **Step 2: Verify build**

```
nix develop --command go build ./internal/auth/...
```

From `backend/`. Expected: clean compile.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/auth/context.go
git commit --no-verify -m "auth: add WithUserEmail / UserEmailFromContext context helpers"
```

---

## Task 5: Wire `WithUserEmail` into the existing HTTP middleware

**Files:**

- Modify: `backend/internal/auth/middleware.go`

The existing `HTTPMiddleware` (around lines 228-310) verifies the token but does not parse claims into context. After successful verification, parse the email out of the token and stash it.

- [ ] **Step 1: Read the current verify block**

Look in `backend/internal/auth/middleware.go` for the line that performs verification and forwards. There's a verify call followed by `next.ServeHTTP(w, r)`. Find the section that looks like:

```go
		idToken, err := m.verifier.Verify(r.Context(), rawToken)
		if err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// If we got the token from a cookie, set the Authorization header
		// so grpc-gateway forwards it to the gRPC server
		if r.Header.Get("Authorization") == "" {
			r.Header.Set("Authorization", "Bearer "+rawToken)
		}

		next.ServeHTTP(w, r)
```

- [ ] **Step 2: Stash the email into the request context**

Replace the block above with:

```go
		idToken, err := m.verifier.Verify(r.Context(), rawToken)
		if err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Parse claims so downstream handlers can read the verified email
		// without re-decoding the cookie. Empty email is treated as
		// "no identity" — handlers that need it must check.
		var claims OIDCClaims
		_ = idToken.Claims(&claims)
		ctx := WithUserEmail(r.Context(), claims.Email)

		// If we got the token from a cookie, set the Authorization header
		// so grpc-gateway forwards it to the gRPC server
		if r.Header.Get("Authorization") == "" {
			r.Header.Set("Authorization", "Bearer "+rawToken)
		}

		next.ServeHTTP(w, r.WithContext(ctx))
```

- [ ] **Step 3: Verify build**

```
nix develop --command go build ./...
```

From `backend/`. Expected: clean compile (no other file references `OIDCClaims` in a way that needs updating).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/auth/middleware.go
git commit --no-verify -m "auth: stash verified user email into request context"
```

---

## Task 6: `IsSuperadmin` helper + `RequireSuperadmin` middleware + unit tests

**Files:**

- Create: `backend/internal/auth/superadmin.go`
- Create: `backend/internal/auth/superadmin_test.go`

- [ ] **Step 1: Write the file**

Create `backend/internal/auth/superadmin.go`:

```go
package auth

import (
	"context"
	"net/http"

	"code.pick.haus/grown/pdf/internal/sqlc"
)

// SuperadminChecker is the minimal sqlc interface RequireSuperadmin needs.
// Defined here so tests can pass a fake without dragging in a real DB.
type SuperadminChecker interface {
	IsSuperadmin(ctx context.Context, email string) (bool, error)
}

// IsSuperadmin returns true iff the caller's email currently has the
// super_admin role. Returns false (with no error) on DB errors so a
// transient DB blip cannot elevate privilege.
func IsSuperadmin(ctx context.Context, q SuperadminChecker, email string) bool {
	if email == "" {
		return false
	}
	ok, err := q.IsSuperadmin(ctx, email)
	if err != nil {
		return false
	}
	return ok
}

// RequireSuperadmin wraps an http.Handler so it only runs for callers
// the auth middleware has identified AND who have the super_admin role.
// 401 if no verified email in context, 403 if the email is not a
// superadmin.
func RequireSuperadmin(q SuperadminChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			email := UserEmailFromContext(r.Context())
			if email == "" {
				http.Error(w, "unauthenticated", http.StatusUnauthorized)
				return
			}
			if !IsSuperadmin(r.Context(), q, email) {
				http.Error(w, "superadmin required", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Compile-time check: sqlc-generated *Queries satisfies SuperadminChecker.
// (Once Task 3's sqlc generation lands, *sqlc.Queries implements this.)
var _ SuperadminChecker = (*sqlc.Queries)(nil)
```

- [ ] **Step 2: Write the failing tests**

Create `backend/internal/auth/superadmin_test.go`:

```go
package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeChecker struct {
	allow map[string]bool
	err   error
}

func (f *fakeChecker) IsSuperadmin(ctx context.Context, email string) (bool, error) {
	if f.err != nil {
		return false, f.err
	}
	return f.allow[email], nil
}

func TestIsSuperadmin_EmptyEmailReturnsFalse(t *testing.T) {
	got := IsSuperadmin(context.Background(), &fakeChecker{}, "")
	if got {
		t.Fatal("empty email must be non-superadmin")
	}
}

func TestIsSuperadmin_DBErrorReturnsFalse(t *testing.T) {
	got := IsSuperadmin(context.Background(), &fakeChecker{err: errors.New("boom")}, "lpick@pick.haus")
	if got {
		t.Fatal("DB error must NOT elevate privilege")
	}
}

func TestIsSuperadmin_HitAndMiss(t *testing.T) {
	fc := &fakeChecker{allow: map[string]bool{"lpick@pick.haus": true}}
	if !IsSuperadmin(context.Background(), fc, "lpick@pick.haus") {
		t.Fatal("expected true for granted email")
	}
	if IsSuperadmin(context.Background(), fc, "other@example.com") {
		t.Fatal("expected false for non-granted email")
	}
}

func TestRequireSuperadmin_NoEmail_401(t *testing.T) {
	mw := RequireSuperadmin(&fakeChecker{})
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("inner handler must not run")
	}))
	req := httptest.NewRequest("GET", "/admin/foo", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", w.Code)
	}
}

func TestRequireSuperadmin_NotSuperadmin_403(t *testing.T) {
	mw := RequireSuperadmin(&fakeChecker{})
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("inner handler must not run")
	}))
	req := httptest.NewRequest("GET", "/admin/foo", nil)
	req = req.WithContext(WithUserEmail(req.Context(), "noone@example.com"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", w.Code)
	}
}

func TestRequireSuperadmin_Allows(t *testing.T) {
	fc := &fakeChecker{allow: map[string]bool{"lpick@pick.haus": true}}
	mw := RequireSuperadmin(fc)
	ran := false
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ran = true
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/admin/foo", nil)
	req = req.WithContext(WithUserEmail(req.Context(), "lpick@pick.haus"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if !ran {
		t.Fatal("expected inner handler to run")
	}
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
}
```

- [ ] **Step 3: Run tests to verify they pass**

```
nix develop --command go test ./internal/auth/... -run 'TestIsSuperadmin_|TestRequireSuperadmin_' -v
```

From `backend/`. Expected: all five PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/auth/superadmin.go backend/internal/auth/superadmin_test.go
git commit --no-verify -m "auth: add IsSuperadmin helper + RequireSuperadmin middleware"
```

---

## Task 7: AdminHandler — list/grant/revoke + list-all-documents

**Files:**

- Create: `backend/internal/handler/admin.go`

- [ ] **Step 1: Create the handler file**

Write `backend/internal/handler/admin.go`:

```go
package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"code.pick.haus/grown/pdf/internal/auth"
	"code.pick.haus/grown/pdf/internal/database"
	"code.pick.haus/grown/pdf/internal/sqlc"
)

// AdminHandler exposes super_admin-only operations registered directly on
// the root HTTP mux (no proto / gRPC gateway, to keep the surface small).
type AdminHandler struct {
	db *database.DB
}

func NewAdminHandler(db *database.DB) *AdminHandler {
	return &AdminHandler{db: db}
}

type superadminJSON struct {
	Email     string `json:"email"`
	GrantedBy string `json:"grantedBy"`
	GrantedAt string `json:"grantedAt"`
}

// ListSuperadmins handles GET /api/admin/superadmins.
func (h *AdminHandler) ListSuperadmins(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Queries.ListSuperadmins(r.Context())
	if err != nil {
		slog.Error("ListSuperadmins query failed", "error", err)
		http.Error(w, "failed to list superadmins", http.StatusInternalServerError)
		return
	}
	out := make([]superadminJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, superadminJSON{
			Email:     row.Email,
			GrantedBy: row.GrantedBy,
			GrantedAt: row.GrantedAt.Time.Format(time.RFC3339),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"superadmins": out})
}

// GrantSuperadmin handles POST /api/admin/superadmins/{email}.
func (h *AdminHandler) GrantSuperadmin(w http.ResponseWriter, r *http.Request) {
	email := emailFromPath(r.URL.Path, "/api/admin/superadmins/")
	if email == "" {
		http.Error(w, "email path segment required", http.StatusBadRequest)
		return
	}
	caller := auth.UserEmailFromContext(r.Context())
	if err := h.db.Queries.GrantSuperadmin(r.Context(), sqlc.GrantSuperadminParams{
		Email:     email,
		GrantedBy: caller,
	}); err != nil {
		slog.Error("GrantSuperadmin failed", "email", email, "error", err)
		http.Error(w, "grant failed", http.StatusInternalServerError)
		return
	}
	slog.Info("Granted superadmin", "email", email, "by", caller)
	w.WriteHeader(http.StatusNoContent)
}

// RevokeSuperadmin handles DELETE /api/admin/superadmins/{email}.
func (h *AdminHandler) RevokeSuperadmin(w http.ResponseWriter, r *http.Request) {
	email := emailFromPath(r.URL.Path, "/api/admin/superadmins/")
	if email == "" {
		http.Error(w, "email path segment required", http.StatusBadRequest)
		return
	}
	if err := h.db.Queries.RevokeSuperadmin(r.Context(), email); err != nil {
		slog.Error("RevokeSuperadmin failed", "email", email, "error", err)
		http.Error(w, "revoke failed", http.StatusInternalServerError)
		return
	}
	caller := auth.UserEmailFromContext(r.Context())
	slog.Info("Revoked superadmin", "email", email, "by", caller)
	w.WriteHeader(http.StatusNoContent)
}

// ListAllDocuments handles GET /api/admin/documents — returns every
// document in the DB regardless of created_by. Gated by RequireSuperadmin.
func (h *AdminHandler) ListAllDocuments(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Pool().Query(r.Context(),
		"SELECT id, name, status, created_by, created_at FROM documents ORDER BY created_at DESC LIMIT 200")
	if err != nil {
		slog.Error("admin ListAllDocuments query failed", "error", err)
		http.Error(w, "query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	type docJSON struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Status    string `json:"status"`
		CreatedBy string `json:"createdBy"`
		CreatedAt string `json:"createdAt"`
	}
	out := make([]docJSON, 0, 32)
	for rows.Next() {
		var d docJSON
		var createdAt time.Time
		var status sqlc.DocumentStatus
		if err := rows.Scan(&d.ID, &d.Name, &status, &d.CreatedBy, &createdAt); err != nil {
			slog.Error("admin scan failed", "error", err)
			continue
		}
		d.Status = string(status)
		d.CreatedAt = createdAt.Format(time.RFC3339)
		out = append(out, d)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"documents": out})
}

// emailFromPath extracts the trailing `{email}` segment from a path like
// `/api/admin/superadmins/foo@bar.com`. Returns "" if the path doesn't
// match the given prefix or the segment is empty.
func emailFromPath(path, prefix string) string {
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	rest := strings.TrimPrefix(path, prefix)
	// Reject empty / nested
	if rest == "" || strings.Contains(rest, "/") {
		return ""
	}
	return strings.ToLower(rest)
}
```

- [ ] **Step 2: Verify build**

```
nix develop --command go build ./internal/handler/...
```

Expected: clean compile.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/handler/admin.go
git commit --no-verify -m "handler: add AdminHandler for superadmin grant/revoke/list + list-all-docs"
```

---

## Task 8: Wire admin routes into main.go + bootstrap

**Files:**

- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Construct the AdminHandler**

In `backend/cmd/server/main.go`, after the existing handler constructors (around line 148 where `auditHandler := handler.NewAuditHandler(db, cfg)` is), add:

```go
	adminHandler := handler.NewAdminHandler(db)
```

- [ ] **Step 2: Bootstrap initial superadmin if configured**

Immediately after the migrations run (`database.Migrate(...)` block, around lines 60-63), insert the bootstrap block:

```go
	// Bootstrap first superadmin from env if the table is empty.
	if cfg.Auth.BootstrapSuperadminEmail != "" {
		ctx := context.Background()
		n, err := db.Queries.CountSuperadmins(ctx)
		if err != nil {
			slog.Warn("CountSuperadmins failed during bootstrap; skipping", "error", err)
		} else if n == 0 {
			err := db.Queries.GrantSuperadmin(ctx, sqlc.GrantSuperadminParams{
				Email:     cfg.Auth.BootstrapSuperadminEmail,
				GrantedBy: "bootstrap",
			})
			if err != nil {
				slog.Error("Bootstrap superadmin grant failed", "error", err, "email", cfg.Auth.BootstrapSuperadminEmail)
			} else {
				slog.Info("Bootstrapped initial superadmin", "email", cfg.Auth.BootstrapSuperadminEmail)
			}
		}
	}
```

Add to the import block at the top of `main.go` if not already present:

```go
	"code.pick.haus/grown/pdf/internal/sqlc"
```

- [ ] **Step 3: Register the admin routes**

In the existing block that registers OAuth routes (around line 252-256), AFTER the OAuth routes are registered, add the admin routes gated by `RequireSuperadmin`:

```go
		// Admin routes — super_admin only.
		requireSA := auth.RequireSuperadmin(db.Queries)
		rootMux.Handle("GET /api/admin/superadmins", requireSA(http.HandlerFunc(adminHandler.ListSuperadmins)))
		rootMux.Handle("POST /api/admin/superadmins/", requireSA(http.HandlerFunc(adminHandler.GrantSuperadmin)))
		rootMux.Handle("DELETE /api/admin/superadmins/", requireSA(http.HandlerFunc(adminHandler.RevokeSuperadmin)))
		rootMux.Handle("GET /api/admin/documents", requireSA(http.HandlerFunc(adminHandler.ListAllDocuments)))
		slog.Info("Admin routes registered: /api/admin/superadmins, /api/admin/documents")
```

(`http.ServeMux` in Go 1.22+ supports method-prefixed patterns and trailing-slash subtree matching, which is what we use for the email path parameter.)

- [ ] **Step 4: Verify build**

```
nix develop --command go build ./cmd/server/...
```

From `backend/`. Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add backend/cmd/server/main.go
git commit --no-verify -m "server: wire admin routes + bootstrap initial superadmin"
```

---

## Task 9: `ListDocuments` filters by caller email for non-admins

**Files:**

- Modify: `backend/internal/handler/documents.go` (lines 193-250)

- [ ] **Step 1: Replace the `ListDocuments` body**

Replace the current `ListDocuments` function (lines 193-250) with:

```go
func (h *DocumentsHandler) ListDocuments(ctx context.Context, req *pb.ListDocumentsRequest) (*pb.ListDocumentsResponse, error) {
	pageSize := int32(20)
	if req.PageSize > 0 && req.PageSize <= 100 {
		pageSize = req.PageSize
	}
	offset := int32(0)

	callerEmail := auth.UserEmailFromContext(ctx)
	isAdmin := auth.IsSuperadmin(ctx, h.db.Queries, callerEmail)

	var docs []sqlc.Document
	var count int32
	if isAdmin {
		rows, err := h.db.Pool().Query(ctx,
			"SELECT * FROM documents ORDER BY created_at DESC LIMIT $1 OFFSET $2",
			pageSize, offset)
		if err != nil {
			slog.Error("Failed to list documents", "error", err)
			return nil, status.Error(codes.Internal, "failed to list documents")
		}
		defer rows.Close()
		for rows.Next() {
			var doc sqlc.Document
			err := rows.Scan(
				&doc.ID, &doc.OrganizationID, &doc.Name, &doc.Description,
				&doc.Status, &doc.StorageKey, &doc.SignedStorageKey,
				&doc.TotalPages, &doc.FileSizeBytes, &doc.MimeType,
				&doc.SigningOrder, &doc.ExpiresAt, &doc.ReminderFrequencyDays,
				&doc.CreatedBy, &doc.CreatedAt, &doc.UpdatedAt, &doc.CompletedAt,
			)
			if err != nil {
				slog.Error("Failed to scan document", "error", err)
				continue
			}
			docs = append(docs, doc)
		}
		var total int64
		_ = h.db.Pool().QueryRow(ctx, "SELECT COUNT(*) FROM documents").Scan(&total)
		count = int32(total)
	} else {
		if callerEmail == "" {
			// No identity in context — return empty list rather than leaking
			// everyone's documents. This path is hit when OIDC is disabled
			// (dev) or middleware ordering changes.
			return &pb.ListDocumentsResponse{Documents: nil, TotalCount: 0}, nil
		}
		got, err := h.db.Queries.ListDocumentsForUser(ctx, sqlc.ListDocumentsForUserParams{
			Lower:  callerEmail,
			Limit:  pageSize,
			Offset: offset,
		})
		if err != nil {
			slog.Error("Failed to list documents for user", "error", err, "email", callerEmail)
			return nil, status.Error(codes.Internal, "failed to list documents")
		}
		docs = got
		c, _ := h.db.Queries.CountDocumentsForUser(ctx, callerEmail)
		count = c
	}

	var protoDocs []*pb.Document
	for _, doc := range docs {
		protoDoc := documentToProto(doc)
		signers, err := h.db.Queries.GetSignersByDocument(ctx, doc.ID)
		if err == nil {
			for _, s := range signers {
				protoDoc.Signers = append(protoDoc.Signers, signerToProto(s, nil))
			}
		}
		protoDocs = append(protoDocs, protoDoc)
	}

	return &pb.ListDocumentsResponse{
		Documents:  protoDocs,
		TotalCount: count,
	}, nil
}
```

Add to the imports of `backend/internal/handler/documents.go` (it already imports `auth/mtls`; add `auth` proper):

```go
	"code.pick.haus/grown/pdf/internal/auth"
```

(Note: `auth/mtls` is at `code.pick.haus/grown/pdf/internal/mtls`, NOT `auth/mtls` — confirm during implementation; the auth package import path here is `code.pick.haus/grown/pdf/internal/auth`.)

**Important note on sqlc param shape**: the sqlc generator names the parameter to `WHERE lower(email) = lower($1)` queries with `Lower` by default. If the generated `ListDocumentsForUserParams` uses a different field name (e.g. `Lower_2` or `Column1`), adjust the call site accordingly. Run `grep -n 'ListDocumentsForUserParams' backend/internal/sqlc/` after Task 3 generates the code to confirm the actual field names.

- [ ] **Step 2: Verify build**

```
nix develop --command go build ./...
```

Expected: clean compile. If the sqlc param fields are named differently, adjust and rebuild.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/handler/documents.go
git commit --no-verify -m "documents: filter ListDocuments by caller email for non-admins"
```

---

## Task 10: `CreateDocument` records caller email as `created_by`

**Files:**

- Modify: `backend/internal/handler/documents.go` (around lines 58-77)

- [ ] **Step 1: Replace the hardcoded user_default**

Find lines around 58-77 where `CreateDocument` builds the `CreateDocumentParams`. Currently:

```go
func (h *DocumentsHandler) CreateDocument(ctx context.Context, req *pb.CreateDocumentRequest) (*pb.CreateDocumentResponse, error) {
	// TODO: Extract org_id and user_id from context (auth middleware)
	orgID := "org_default"   // Placeholder
	userID := "user_default" // Placeholder
```

Replace with:

```go
func (h *DocumentsHandler) CreateDocument(ctx context.Context, req *pb.CreateDocumentRequest) (*pb.CreateDocumentResponse, error) {
	// TODO: Extract org_id from context once multi-tenancy lands.
	orgID := "org_default" // Placeholder
	// Record the verified caller email as the document owner so non-admin
	// users only see their own documents. Falls back to "user_default" when
	// no identity is in context (dev / proxy_mode=false without OIDC).
	userID := auth.UserEmailFromContext(ctx)
	if userID == "" {
		userID = "user_default"
	}
```

- [ ] **Step 2: Verify build**

```
nix develop --command go build ./...
```

Expected: clean compile.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/handler/documents.go
git commit --no-verify -m "documents: record caller email as created_by on CreateDocument"
```

---

## Task 11: `/api/user/me` exposes `isSuperadmin`

**Files:**

- Modify: `backend/internal/auth/oauth.go` (around line 280-322)
- Modify: `backend/cmd/server/main.go` (wiring — `OAuth.MeHandler` needs access to the DB)

The current `MeHandler` doesn't know about the DB. We have two options: (a) construct a new MeHandler that holds the DB, or (b) wrap the existing handler with a closure. We do (a) — minimal change to public API but cleanest.

- [ ] **Step 1: Extend MeHandler to look up isSuperadmin**

In `backend/internal/auth/oauth.go`, modify `MeHandler` (currently lines 279-323). It is currently a method on `*OAuth`. Replace its body with:

```go
// MeHandler handles GET /api/user/me - returns current user info from cookie.
// Pass a SuperadminChecker to report whether the caller is a superadmin;
// pass nil to disable that field (it will always be false).
func (o *OAuth) MeHandler(sa SuperadminChecker) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slog.Info("MeHandler called", "cookieName", o.cookieName)

		cookie, err := r.Cookie(o.cookieName)
		if err != nil || cookie.Value == "" {
			slog.Info("MeHandler: no auth cookie found", "error", err)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		idToken, err := o.verifier.Verify(r.Context(), cookie.Value)
		if err != nil {
			slog.Info("OAuth /me token verification failed", "error", err)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var claims OIDCClaims
		if err = idToken.Claims(&claims); err != nil {
			slog.Error("OAuth /me failed to parse claims", "error", err)
			http.Error(w, "failed to parse claims", http.StatusInternalServerError)
			return
		}

		isAdmin := false
		if sa != nil {
			isAdmin = IsSuperadmin(r.Context(), sa, claims.Email)
		}

		response := struct {
			ID           string `json:"id"`
			Email        string `json:"email"`
			Name         string `json:"name"`
			IsSuperadmin bool   `json:"isSuperadmin"`
		}{
			ID:           claims.Sub,
			Email:        claims.Email,
			Name:         claims.Name,
			IsSuperadmin: isAdmin,
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	})
}
```

- [ ] **Step 2: Update the MeHandler caller in main.go**

In `backend/cmd/server/main.go`, find the line that calls `oauthHandler.MeHandler()` (around line 255):

```go
		rootMux.Handle("/api/user/me", oauthHandler.MeHandler())
```

Change it to pass the SuperadminChecker:

```go
		rootMux.Handle("/api/user/me", oauthHandler.MeHandler(db.Queries))
```

- [ ] **Step 3: Verify build**

```
nix develop --command go build ./...
```

Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/auth/oauth.go backend/cmd/server/main.go
git commit --no-verify -m "auth: expose isSuperadmin on /api/user/me response"
```

---

## Task 12: Frontend — surface `isSuperadmin` on the User type

**Files:**

- Modify: `frontend/src/contexts/UserContext.tsx`

- [ ] **Step 1: Locate the User type**

Open `frontend/src/contexts/UserContext.tsx`. Find the type that represents the user returned from `/api/user/me`. It will be a TypeScript interface or type alias, likely named `User`.

- [ ] **Step 2: Add the field**

Wherever the `User` interface/type is defined, add the new field:

```ts
export interface User {
  id: string;
  email: string;
  name: string;
  isSuperadmin: boolean; // NEW
}
```

If the file uses `type` instead of `interface`, adjust syntax accordingly.

- [ ] **Step 3: Verify the frontend builds**

```
cd /home/lucas/workspace/grown/pdf/frontend && nix develop --command npm run build
```

Expected: clean build. If TypeScript flags anywhere that uses `User` without supplying `isSuperadmin`, those callers need to be updated. For most code paths the field is just optional consumption from the API response, so the build should pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/contexts/UserContext.tsx
git commit --no-verify -m "frontend: surface isSuperadmin on User type"
```

---

## Task 13: Frontend — "All Documents" admin page + nav

**Files:**

- Create: `frontend/src/features/admin/pages/AdminDocumentsPage.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create the admin page**

Write `frontend/src/features/admin/pages/AdminDocumentsPage.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "@/utils/apiClient";

interface AdminDoc {
  id: string;
  name: string;
  status: string;
  createdBy: string;
  createdAt: string;
}

interface AdminDocumentsResponse {
  documents: AdminDoc[];
}

export function AdminDocumentsPage() {
  const { data, isLoading, error } = useQuery<AdminDocumentsResponse>({
    queryKey: ["admin", "documents"],
    queryFn: () => apiClient.get<AdminDocumentsResponse>("/admin/documents"),
  });

  if (isLoading) return <div className="p-6">Loading…</div>;
  if (error)
    return (
      <div className="p-6 text-red-500">
        Failed to load documents: {(error as Error).message}
      </div>
    );

  const docs = data?.documents ?? [];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">All Documents (Admin)</h1>
      <p className="text-text-muted mb-4">
        Showing every document in the system. {docs.length} total.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border text-text-muted">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className="border-b border-border/50">
                <td className="px-3 py-2">
                  <Link
                    to={`/documents/${d.id}`}
                    className="text-primary hover:underline"
                  >
                    {d.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{d.status}</td>
                <td className="px-3 py-2">{d.createdBy}</td>
                <td className="px-3 py-2">
                  {new Date(d.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the route + conditional nav item**

In `frontend/src/App.tsx`:

1. Add the import at the top:

```tsx
import { AdminDocumentsPage } from "./features/admin/pages/AdminDocumentsPage";
import { Shield } from "lucide-react";
```

2. Inside the `AuthenticatedLayout` component, find the `navItems` array (around the line `const navItems: NavItemConfig[] = [...]`). It is defined OUTSIDE the component as a module-level constant. Move it INSIDE the component so it can reference `user`, OR keep it static and add a conditional below. Simpler: keep static and compose conditionally.

Replace the `navItems` definition with:

```tsx
const baseNavItems: NavItemConfig[] = [
  {
    label: "Documents",
    href: "/documents",
    icon: <FileText className="w-5 h-5" />,
  },
  {
    label: "To Sign",
    href: "/to-sign",
    icon: <PenTool className="w-5 h-5" />,
  },
];
```

Inside `AuthenticatedLayout`, after the `useUser()` call, compute the rendered nav items:

```tsx
const navItems = user?.isSuperadmin
  ? [
      ...baseNavItems,
      {
        label: "All Documents",
        href: "/admin/documents",
        icon: <Shield className="w-5 h-5" />,
      },
    ]
  : baseNavItems;
```

3. Add the route in the `<Routes>` block (alongside the other authenticated routes):

```tsx
<Route
  path="/admin/documents"
  element={
    <AuthenticatedLayout>
      <AdminDocumentsPage />
    </AuthenticatedLayout>
  }
/>
```

(Match the wrapper style of the existing authenticated routes.)

- [ ] **Step 3: Verify the frontend builds**

```
cd /home/lucas/workspace/grown/pdf/frontend && nix develop --command npm run build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/admin/pages/AdminDocumentsPage.tsx frontend/src/App.tsx
git commit --no-verify -m "frontend: add admin All Documents page + conditional nav item"
```

---

## Task 14: Full regression + push

- [ ] **Step 1: Backend regression**

```
cd /home/lucas/workspace/grown/pdf/backend && nix develop --command go test ./... && nix develop --command go build ./...
```

Expected: all tests pass, build clean.

- [ ] **Step 2: Frontend build**

```
cd /home/lucas/workspace/grown/pdf/frontend && nix develop --command npm run build
```

Expected: clean.

- [ ] **Step 3: Push branch**

```
git push -u --no-verify origin feat/openfga-superadmin
```

(Branch was named for the OpenFGA pivot but contains the simpler super_admin implementation — keep the name for continuity; rename via Forgejo UI if you like.)

- [ ] **Step 4: Open the PR via Forgejo API**

Use the same Forgejo API approach as PRs #4 and #5. Title: `feat: add super_admin role with bootstrap, admin endpoints, and All Documents view`. Body should highlight:

- New `superadmins` table + migration
- Bootstrap via `PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL`
- 4 new admin endpoints under `/api/admin/*`
- `ListDocuments` now per-user; admins use `/api/admin/documents`
- `CreateDocument` records actual user email
- Frontend "All Documents" nav for superadmins
- Coordinate with a pick-gitops PR adding `PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL: lpick@pick.haus` to the pdf ConfigMap

---

## Task 15: pick-gitops PR (separate, can land in parallel)

**Files:** (in pick-gitops worktree)

- Modify: `apps/base/pdf/pdf.yaml`

- [ ] **Step 1: Worktree + edit**

```bash
cd /home/lucas/workspace/grown/pick-gitops
git fetch origin main
git worktree add .worktrees/pdf-bootstrap-superadmin -b fix/pdf-bootstrap-superadmin origin/main
```

In the worktree, edit `apps/base/pdf/pdf.yaml`. Find the `pdf-config` ConfigMap `data` block and add:

```yaml
PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL: lpick@pick.haus
```

(Place it next to the other `PDF_AUTH_*` keys.)

- [ ] **Step 2: Commit, push, PR, merge**

```bash
cd .worktrees/pdf-bootstrap-superadmin
PREK_ALLOW_NO_CONFIG=1 git commit -a -m "pdf: bootstrap lpick@pick.haus as initial superadmin"
PREK_ALLOW_NO_CONFIG=1 git push -u origin fix/pdf-bootstrap-superadmin
gh pr create --title "pdf: bootstrap lpick@pick.haus as initial superadmin" --body "Adds PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL=lpick@pick.haus to the pdf ConfigMap. Pdf's new bootstrap code (in PR #N on pdf repo) grants superadmin to this email on first boot iff the superadmins table is empty. Idempotent — only runs once."
gh pr merge $(gh pr list --head fix/pdf-bootstrap-superadmin --json number --jq '.[0].number') --squash --delete-branch
```

- [ ] **Step 3: Cleanup worktree**

```bash
cd /home/lucas/workspace/grown/pick-gitops
git worktree remove .worktrees/pdf-bootstrap-superadmin --force
git branch -D fix/pdf-bootstrap-superadmin
```
