# Audit log — wiring instructions

The audit feature ships as a self-contained package (`internal/audit`) plus a
migration and a frontend section. Two shared files must be edited by hand:
`cmd/server/main.go` and `internal/server/server.go`. This file gives the exact,
copy-pasteable edits. Nothing else in those files needs to change.

The audit package never imports `internal/auth` (so it builds standalone). It
learns the caller's org/user/email through injected resolver closures that
server.go builds from `auth.UserFromContext` / `auth.OrgFromContext`.

---

## 1. `cmd/server/main.go`

### 1a. Construct the audit repository

Anywhere after `pool` is created (e.g. next to `booksRepo := books.NewRepository(pool)`),
add:

```go
auditRepo := audit.NewRepository(pool)
```

Add the import to the import block:

```go
"code.pick.haus/grown/grown/internal/audit"
```

### 1b. Pass it to the server config

Inside the `server.New(server.Config{ ... })` literal, add the field (next to
`AdminRepo` / `AdminEmails` — `AdminEmails: os.Getenv("GROWN_ADMIN_EMAILS")` is
already read and is reused by the audit handler, no second env read needed):

```go
		AuditRepo:   auditRepo,
```

---

## 2. `internal/server/server.go`

### 2a. Add the config field

In `type Config struct`, next to `AdminRepo` / `AdminEmails`, add:

```go
	// AuditRepo backs the cross-cutting audit trail. When nil, auditing is a
	// no-op (the interceptor passes through and the admin handler 404s/empties).
	AuditRepo *audit.Repository
```

### 2b. Add the import

In the import block, add:

```go
	"code.pick.haus/grown/grown/internal/audit"
```

### 2c. Build the recorder and register the interceptor

At the very top of `func New(cfg Config) *Server`, replace:

```go
	grpcSrv := grpc.NewServer()
```

with:

```go
	// Audit recorder: resolves the caller's org/user/email from the auth context
	// (kept here so internal/audit stays free of internal/auth's gen/ dep).
	auditRec := audit.NewRecorder(cfg.AuditRepo, func(ctx context.Context) (audit.Actor, bool) {
		org, ok := auth.OrgFromContext(ctx)
		if !ok {
			return audit.Actor{}, false
		}
		a := audit.Actor{OrgID: org.ID}
		if u, ok := auth.UserFromContext(ctx); ok {
			a.UserID = u.ID
			a.Email = u.Email
		}
		return a, true
	})

	// One interceptor auto-audits every mutating RPC across all gRPC services.
	// NOTE: if an auth/other unary interceptor already exists, CHAIN it — keep
	// the existing one(s) first and append audit.NewInterceptor(auditRec):
	//   grpc.ChainUnaryInterceptor(existingInterceptor, audit.NewInterceptor(auditRec))
	// As of this change there is no pre-existing unary interceptor, so we add ours:
	grpcSrv := grpc.NewServer(grpc.ChainUnaryInterceptor(audit.NewInterceptor(auditRec)))
```

> If you later add an auth interceptor, do **not** replace this line — extend the
> `ChainUnaryInterceptor(...)` argument list, e.g.
> `grpc.ChainUnaryInterceptor(authInterceptor, audit.NewInterceptor(auditRec))`.

### 2d. Wrap the raw (binary) routes

The raw upload/download/stream routes live in the `router` HandlerFunc. Wrap
each handler with `auditRec.Log(service, action, <handler>)` AROUND the existing
`driveAuthWrap(...)` (so auth still resolves the caller first; `Log` reads the
populated context after the handler runs). `Log` is a no-op when auditing is
off, so these wraps are always safe.

Apply each replacement below (left → right) inside `router`:

**Drive — upload + download**

```go
// before
driveAuthWrap(cfg.Drive.UploadHandler()).ServeHTTP(w, r)
// after
auditRec.Log("drive", "upload", driveAuthWrap(cfg.Drive.UploadHandler())).ServeHTTP(w, r)
```

```go
// before
driveAuthWrap(cfg.Drive.DownloadHandler()).ServeHTTP(w, r)
// after
auditRec.Log("drive", "download", driveAuthWrap(cfg.Drive.DownloadHandler())).ServeHTTP(w, r)
```

**Mail attachments — upload + download**

```go
// before
driveAuthWrap(mailAtt.UploadHandler()).ServeHTTP(w, r)
// after
auditRec.Log("mail", "attachment-upload", driveAuthWrap(mailAtt.UploadHandler())).ServeHTTP(w, r)
```

```go
// before
driveAuthWrap(mailAtt.DownloadHandler()).ServeHTTP(w, r)
// after
auditRec.Log("mail", "attachment-download", driveAuthWrap(mailAtt.DownloadHandler())).ServeHTTP(w, r)
```

**Photos — upload + download**

```go
// before
driveAuthWrap(photosMedia.UploadHandler()).ServeHTTP(w, r)
// after
auditRec.Log("photos", "upload", driveAuthWrap(photosMedia.UploadHandler())).ServeHTTP(w, r)
```

```go
// before
driveAuthWrap(photosMedia.DownloadHandler()).ServeHTTP(w, r)
// after
auditRec.Log("photos", "download", driveAuthWrap(photosMedia.DownloadHandler())).ServeHTTP(w, r)
```

**Books — file + cover, upload + download** (four `driveAuthWrap(...)` calls in
the two `switch r.Method` blocks):

```go
// file upload
auditRec.Log("books", "upload", driveAuthWrap(booksFiles.UploadFileHandler())).ServeHTTP(w, r)
// file download
auditRec.Log("books", "download", driveAuthWrap(booksFiles.DownloadFileHandler())).ServeHTTP(w, r)
// cover upload
auditRec.Log("books", "cover-upload", driveAuthWrap(booksFiles.UploadCoverHandler())).ServeHTTP(w, r)
// cover download
auditRec.Log("books", "cover-download", driveAuthWrap(booksFiles.CoverHandler())).ServeHTTP(w, r)
```

**Video — upload + stream**

```go
// before
driveAuthWrap(videoHTTP.UploadHandler()).ServeHTTP(w, r)
// after
auditRec.Log("video", "upload", driveAuthWrap(videoHTTP.UploadHandler())).ServeHTTP(w, r)
```

```go
// before
driveAuthWrap(videoHTTP.StreamHandler()).ServeHTTP(w, r)
// after
auditRec.Log("video", "download", driveAuthWrap(videoHTTP.StreamHandler())).ServeHTTP(w, r)
```

**Music — upload + stream**

```go
// before
driveAuthWrap(musicHTTP.UploadHandler()).ServeHTTP(w, r)
// after
auditRec.Log("music", "upload", driveAuthWrap(musicHTTP.UploadHandler())).ServeHTTP(w, r)
```

```go
// before
driveAuthWrap(musicHTTP.StreamHandler()).ServeHTTP(w, r)
// after
auditRec.Log("music", "download", driveAuthWrap(musicHTTP.StreamHandler())).ServeHTTP(w, r)
```

### 2e. Mount the admin audit handler

Build the handler next to where `adminUsers` is constructed (after
`driveAuthWrap` is defined, before the `router` HandlerFunc):

```go
	// Admin-gated audit-log viewer. Same trust model as adminUsers: mounted
	// inside the auth middleware (so the caller is on the context) and gated on
	// the GROWN_ADMIN_EMAILS allowlist. The resolver returns the caller's email
	// AND org id (the audit list is org-scoped).
	auditHandler := audit.NewHandler(cfg.AuditRepo, cfg.AdminEmails).
		WithResolver(func(ctx context.Context) (string, string, bool) {
			u, ok := auth.UserFromContext(ctx)
			if !ok {
				return "", "", false
			}
			orgID := ""
			if org, ok := auth.OrgFromContext(ctx); ok {
				orgID = org.ID
			}
			return u.Email, orgID, true
		})
```

Then, inside the `router` HandlerFunc, add this branch BEFORE the
`/api/v1/admin/users` branch (so the more specific path matches first — though
the two paths are distinct, keeping audit above the generic `/api/` fallthrough
is what matters):

```go
		// Admin-gated audit-log JSON listing.
		if r.URL.Path == "/api/v1/admin/audit" {
			driveAuthWrap(auditHandler).ServeHTTP(w, r)
			return
		}
```

A good spot is immediately above:

```go
		if strings.HasPrefix(r.URL.Path, "/api/v1/admin/users") {
```

---

## 3. Migration

`internal/storage/migrations/0037_audit.sql` is embedded and auto-applied on
boot (max existing was 0035; 0036 reserved for chat attachments). No code change
needed — `storage.RunMigrations` picks it up.

---

## 4. Verification after wiring

```sh
go build ./...
cd web/app && npm run build
```
