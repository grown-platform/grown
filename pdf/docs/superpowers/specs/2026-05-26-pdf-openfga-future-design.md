# Pdf OpenFGA super_admin layer — Design (DEFERRED)

**Status:** Deferred — kept for a future iteration when fine-grained authz (per-document, per-org, workflow-role) is needed.
**Superseded for now by:** [2026-05-26-pdf-super-admin-design.md](./2026-05-26-pdf-super-admin-design.md), which ships a simpler DB-table-based super_admin role without the OpenFGA dependency.
**Branch:** N/A — not currently implemented.
**Scope (when revived):** Stand up OpenFGA in the pdf namespace, add a minimal `internal/openfga` package, define a tiny model with just `system:global` + `superadmin`, expose a small admin API, and bootstrap an initial superadmin from an env var. Mirrors agility's pattern (`apps/base/agility/openfga/` + `agility/backend/internal/openfga/`).

## What this does NOT cover

These are explicit non-goals for this iteration. They are tracked but require their own design cycles:

- Per-document permissions (owner/editor/viewer per doc)
- Organization-level roles (org_admin, member, viewer)
- Filtering `GET /api/documents` by the authenticated user's identity — _any authenticated user still sees every document_ after this lands. Closing that gap is the natural next iteration.
- Admin UI in the frontend — for now the admin API is callable via curl / postman
- Reading/checking the user identity claim from Zitadel — the design takes the user's email from the same place handlers already use (auth middleware's verified ID-token claims); no new identity plumbing.

## Deployment topology

### OpenFGA server

A new HelmRelease in the **pdf namespace**, backed by a new database in the **existing `pdf-db-cluster`**. Mirrors `apps/base/agility/openfga/`.

Files to add under `apps/base/pdf/openfga/`:

| File                 | Purpose                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kustomization.yaml` | Aggregates the three files below; namespace = pdf                                                                                                            |
| `openfga.yaml`       | OCIRepository + HelmRelease pointing at `oci://ghcr.io/openfga/helm-charts/openfga`, semver `0.x`, datastore=postgres, `existingSecret: pdf-db-cluster-auth` |
| `pg-database.yaml`   | CNPG `Database` resource creating `openfga` database on the existing `pdf-db-cluster`                                                                        |
| `pdb.yaml`           | PodDisruptionBudget mirroring agility's config                                                                                                                   |

Wired into `apps/base/pdf/kustomization.yaml` via `- openfga` resource entry.

### Pdf backend connection

Pdf reaches OpenFGA at `http://openfga.pdf:8080` (in-cluster, gRPC + HTTP). New config keys:

```yaml
fga:
  api_url: "http://openfga.pdf:8080"
  store_id: "" # populated at startup if blank (see Bootstrap below)
  bootstrap_superadmin_email: "lpick@pick.haus" # via PDF_FGA_BOOTSTRAP_SUPERADMIN_EMAIL
```

Env equivalents:

- `PDF_FGA_API_URL`
- `PDF_FGA_STORE_ID`
- `PDF_FGA_BOOTSTRAP_SUPERADMIN_EMAIL`

Startup validation: if **none** of these are set, FGA features are disabled (handlers behave as before — no superadmin checks). If `api_url` is set but `bootstrap_superadmin_email` is empty, the server starts but logs a warning that no bootstrap is configured. If `api_url` is set, the backend MUST be able to reach OpenFGA at startup or it refuses to boot.

### Network policy

Egress allowlist for pdf namespace already permits in-namespace endpoints, so reaching `openfga.pdf:8080` works without policy changes.

## FGA model

Stored at `backend/internal/openfga/model.json` (embedded via `//go:embed`):

```json
{
  "schema_version": "1.1",
  "type_definitions": [
    { "type": "user" },
    {
      "type": "system",
      "relations": {
        "superadmin": { "this": {} },
        "can_grant_superadmin": {
          "computedUserset": { "relation": "superadmin" }
        },
        "can_revoke_superadmin": {
          "computedUserset": { "relation": "superadmin" }
        },
        "can_list_superadmins": {
          "computedUserset": { "relation": "superadmin" }
        }
      },
      "metadata": {
        "relations": {
          "superadmin": { "directly_related_user_types": [{ "type": "user" }] }
        }
      }
    }
  ]
}
```

The single instance referenced is `system:global`. All four relations are scoped to that instance.

## `internal/openfga` package shape

Located at `backend/internal/openfga/` mirroring `agility/backend/internal/openfga/`:

| File             | Responsibility                                                             |
| ---------------- | -------------------------------------------------------------------------- |
| `model.json`     | Embedded model (above)                                                     |
| `client.go`      | `Client` struct wrapping `github.com/openfga/go-sdk/client`; methods below |
| `client_test.go` | Tests using a test FGA store (or stubs)                                    |

### Public API

```go
type Client struct { /* fga SDK client, model id, store id */ }

func New(ctx context.Context, cfg Config) (*Client, error)
//   - opens connection to cfg.APIURL
//   - if cfg.StoreID is empty: lists stores, finds "pdf" or creates it
//   - reads embedded model.json; if model not yet written for store, writes it
//   - persists store_id + model_id on the Client

// User-key formatting. FGA user keys are "user:<email-lowercased>"
func UserKey(email string) string

// Permission checks
func (c *Client) IsSuperadmin(ctx context.Context, email string) (bool, error)

// Grants & revokes
func (c *Client) GrantSuperadmin(ctx context.Context, email string) error
func (c *Client) RevokeSuperadmin(ctx context.Context, email string) error
func (c *Client) ListSuperadmins(ctx context.Context) ([]string, error)
//   returns lower-cased emails
```

`Client.New` is idempotent — repeated calls don't duplicate stores or rewrite the model unless the embedded model differs from what's stored.

## Bootstrap

At server startup, immediately after `Client.New` succeeds:

```
if cfg.FGA.BootstrapSuperadminEmail != "" {
    existing, _ := client.ListSuperadmins(ctx)
    if len(existing) == 0 {
        err := client.GrantSuperadmin(ctx, cfg.FGA.BootstrapSuperadminEmail)
        log "Bootstrapped initial superadmin", email=...
    }
}
```

Idempotent: only fires when zero superadmins exist. If `lpick@pick.haus` is granted via the API then revoked, subsequent boots WILL re-bootstrap (no superadmin remaining). This is the desired behavior — it ensures the deployment is never locked out.

## Admin API

Three new HTTP endpoints. They are NOT defined in proto (which would require regeneration and gateway wiring); they are registered directly on `rootMux` in `cmd/server/main.go` as plain `http.HandlerFunc`s.

| Method   | Path                             | Behavior                                    |
| -------- | -------------------------------- | ------------------------------------------- |
| `GET`    | `/api/admin/superadmins`         | Returns `{"superadmins": ["a@b.com", ...]}` |
| `POST`   | `/api/admin/superadmins/{email}` | Grants superadmin to `{email}`              |
| `DELETE` | `/api/admin/superadmins/{email}` | Revokes superadmin from `{email}`           |

All three are gated by middleware `auth.RequireSuperadmin` which:

1. Pulls the caller's email from the OIDC ID-token claims (existing OAuth middleware already verifies the cookie and parses claims into `OIDCClaims`).
2. Calls `fga.IsSuperadmin(ctx, callerEmail)`.
3. Returns `403 Forbidden` if not.

The bootstrap email becomes the only caller able to grant additional superadmins. Once a superadmin is granted via the API, they can also grant others.

The `email` path parameter is treated case-insensitively (lower-cased before passing to FGA).

### Behavior when FGA is not configured

If `cfg.FGA.APIURL == ""`, the admin endpoints return `503 Service Unavailable` with the body `"superadmin RBAC not configured"`. This lets dev/test deployments skip FGA without breaking the build.

## Auth-context propagation

Existing OAuth middleware (`backend/internal/auth/oauth.go`) verifies the cookie and parses claims into `OIDCClaims{Sub, Email, Name, ...}`. Today these are only used inside `MeHandler`. For this feature we need the email available downstream.

Add to `backend/internal/auth/middleware.go`:

- A context key `userEmailKey`
- Helpers `WithUserEmail(ctx, email) context.Context` and `UserEmailFromContext(ctx) string`
- Update the existing `auth.Middleware` (the one that verifies the cookie on every `/api/*` request) to stash the claim email into context after a successful verify.

`auth.RequireSuperadmin` then reads from context. No changes to existing handlers required — they just keep ignoring the email (which is fine; that gap is out of scope).

## Test surface

| Layer                              | Test                                                                                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/openfga/client_test.go`  | Boot a real OpenFGA via testcontainers (or an HTTP mock if testcontainers isn't already used in the repo — check; fall back to mocks if it isn't): create store, write model, grant superadmin, list, check, revoke. |
| `internal/auth/middleware_test.go` | Verify `WithUserEmail` round-trip + that `RequireSuperadmin` rejects unauthenticated, rejects non-superadmin, allows superadmin.                                                                                     |
| `cmd/server` smoke                 | Manual curl after deploy: `GET /api/admin/superadmins` with the bootstrap user's cookie returns the bootstrap email.                                                                                                 |

Use of testcontainers vs mocks: agility's `migration_test.go` already runs a real FGA SDK against an `fgaclient.NewSdkClient` pointing at an `apiURL` — same pattern works if dev process-compose has FGA running, otherwise mock the SDK client interface.

## Frontend (deferred)

No UI changes in this iteration. Admin endpoints are called via curl/postman. A simple "Superadmins" page in the frontend can land as a follow-up once we know the API surface is correct.

## pick-gitops changes

| File                                           | Change                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/base/pdf/openfga/openfga.yaml`       | New — HelmRelease for OpenFGA                                                                                                         |
| `apps/base/pdf/openfga/pg-database.yaml`   | New — `openfga` Database on pdf-db-cluster                                                                                        |
| `apps/base/pdf/openfga/pdb.yaml`           | New — PDB                                                                                                                             |
| `apps/base/pdf/openfga/kustomization.yaml` | New — aggregates the three above                                                                                                      |
| `apps/base/pdf/kustomization.yaml`         | Add `- openfga` to resources                                                                                                          |
| `apps/base/pdf/pdf.yaml`               | Add `PDF_FGA_API_URL: http://openfga.pdf:8080` and `PDF_FGA_BOOTSTRAP_SUPERADMIN_EMAIL: lpick@pick.haus` to the ConfigMap |
| `clusters/dev/network-policies/pdf.yaml`   | No change — in-namespace egress already allowed                                                                                       |

## Deployment sequencing

1. Merge pdf PR with `internal/openfga` package + admin handlers + config. CI builds new image.
2. Merge pick-gitops PR with the openfga HelmRelease + ConfigMap additions.
3. Flux reconciles: openfga pod comes up, postgres database is created, openfga writes its store.
4. Pdf pod restarts (image bump from #1 + ConfigMap change from #2), calls `Client.New` on boot, finds zero superadmins, grants `lpick@pick.haus`.
5. Verify with `curl https://sign.pick.haus/api/admin/superadmins` while logged in as lpick.

If the openfga pod isn't ready when pdf starts, pdf refuses to boot (per the validation rule). Flux `RetryOnFailure` strategy will retry. Once openfga is ready, pdf succeeds.

## Out of scope (explicitly deferred to future cycles)

- Document-scoped permissions (owner/signer/viewer per doc)
- Org-level roles
- ListDocuments filtering by ownership
- Admin frontend UI
- Audit log of grant/revoke events (FGA's own changelog is captured but not surfaced in pdf's audit_trail table)
- Multi-tenant org_id wiring (still placeholder `org_default`)
