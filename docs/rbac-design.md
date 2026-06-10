# Per-Org Admin Roles (RBAC)

grown-workspace authorizes admin actions per organization. This replaces the
earlier email-allowlist model whose empty-allowlist fallback treated **every**
authenticated member as an admin — a security hole (any logged-in user could
reset others' Zitadel passwords, view the audit log, etc.).

## Authorization model

A caller is an **admin of their org** iff **either**:

- **(a)** their email is in `GROWN_ADMIN_EMAILS` (comma-separated) — these are
  _bootstrap super-admins_, configured out-of-band on the server; **or**
- **(b)** a row exists in `grown.org_admins` for `(caller.org_id,
caller.user_id)` — an in-app-assignable, per-org admin grant.

There is **no open fallback**. An empty `GROWN_ADMIN_EMAILS` no longer grants
anyone admin; admin access then comes solely from `org_admins` grants (which are
seeded by the first-admin auto-bootstrap below).

### Where the rule is enforced

The rule lives in three decoupled handlers/services. Each is kept free of the
generated protobuf (`gen/`) by receiving an injected `AdminChecker` closure that
`internal/server/server.go` builds from the `org_admins` repo + the auth context
(mirroring the existing `EmailResolver` / audit-recorder wiring):

| Surface                                                  | File                                                      | Check                       |
| -------------------------------------------------------- | --------------------------------------------------------- | --------------------------- |
| Admin user-management API (`/api/v1/admin/users*`)       | `internal/adminusers/handler.go` (`authorize`, `IsAdmin`) | allowlist OR `AdminChecker` |
| Audit-log viewer (`/api/v1/admin/audit`)                 | `internal/audit/handler.go` (`ServeHTTP`)                 | allowlist OR `AdminChecker` |
| Service-settings RPC (`AdminService.SetServiceSettings`) | `internal/admin/service.go` (`requireAdmin`)              | allowlist OR `AdminChecker` |

The `org_admins` data layer is `internal/orgadmin/repository.go`
(`IsAdmin`, `ListAdmins`, `GrantAdmin`, `RevokeAdmin`, `CountAdmins`,
`EnsureFirstAdmin`, `AdminUserIDsForZitadel`). Schema: migration
`internal/storage/migrations/0041_org_admins.sql`.

## First-admin auto-bootstrap

When a user becomes the **first member of an org that has no admins yet**, they
are automatically granted org-admin. This guarantees a freshly-provisioned org is
never left with nobody who can administer it, even when `GROWN_ADMIN_EMAILS` is
empty.

**Hook:** `internal/auth/service.go`, `Service.Callback` — immediately after
`users.UpsertByOIDC` (the point where a user is first seen for an org), the
service calls `FirstAdminBootstrapper.EnsureFirstAdmin(orgID, userID)`. That
method (`internal/orgadmin/repository.go`) atomically checks `CountAdmins==0`
under a row lock and inserts the grant only if so — safe against a concurrent
first sign-in. It is **best-effort**: a failure does not block sign-in.

`server.go` injects the bootstrapper via `authSvc.WithFirstAdminBootstrapper(cfg.OrgAdminRepo)`.

> Migration note: on an existing deployment, the first existing user to sign in
> after migration 0041 — when their org still has zero `org_admins` rows — will
> be bootstrapped as that org's admin. Seed `GROWN_ADMIN_EMAILS` if you need a
> specific super-admin regardless of sign-in order.

## Bootstrap via `GROWN_ADMIN_EMAILS`

`GROWN_ADMIN_EMAILS` is the break-glass / super-admin path. Any caller whose
email matches is an admin of **any** org they're in, independent of
`org_admins`. Use it to grant the initial human admin before anyone has signed
in, or to retain platform-operator access. It is checked first (cheap, no DB).

## Grant / revoke API

Admin-gated, under the admin-users handler (`internal/adminusers/handler.go`):

- `GET    /api/v1/admin/users` — each user now carries an `isAdmin` bool.
- `POST   /api/v1/admin/users/{id}/admin` — grant the org-admin role.
- `DELETE /api/v1/admin/users/{id}/admin` — revoke it; returns **409** if it
  would remove the org's **last** admin (last-admin protection).

`{id}` is the **Zitadel user id**. See the id-mapping note below.

Frontend: the Admin console "Users" page (`web/app/src/pages/admin/index.tsx`,
client `usersApi.ts`) shows an **Admin** badge + a grant/revoke toggle per user,
and surfaces the 409 as "You can't remove the last admin." The Users section is
its own route at **`/admin/users`** (each admin section maps to `/admin/:section`).

## Org creation gating

Only an admin may create a new org, and the creator becomes that org's first
admin. The primitive is `orgs.Repository.Create(slug, displayName,
creatorUserID)` (`internal/orgs/repository.go`), which inserts the org and the
creator's `org_admins` row in one transaction.

> **Gap:** there is currently **no `CreateOrg` RPC** in the gRPC surface — orgs
> are seeded by migration `0003_default_org.sql` for single-org mode. `Create`
> exists so the multi-org path is gated correctly the moment such an RPC is
> added; that handler MUST reject non-admin callers (via the same `AdminChecker`)
> before calling `Create`.

## Zitadel-user → grown-user id mapping (the `isAdmin` join)

The admin-users API lists users straight from **Zitadel**, returning Zitadel user
ids. `org_admins`, however, references **grown** user ids. They are joined via
`grown.users.oidc_subject` = Zitadel user id, scoped by `(org_id, oidc_issuer)`
— the same identity grown stamps when provisioning a user
(`internal/directory` does this lazily; `auth.Callback` on sign-in).

- **Listing** (`AdminUserIDsForZitadel`): joins Zitadel ids to grown users to
  `org_admins` in one query.
- **Granting** (`orgAdminRoster.GrownUserIDForZitadel` in `server.go`): resolves
  the Zitadel id to a grown user id, **lazily provisioning** a minimal grown row
  (empty email/display_name, enriched on the user's next sign-in) if the user has
  never signed into grown — so an admin can grant the role pre-emptively.

> **Known limitation:** a Zitadel user who has never signed into grown has no
> grown row until granted or until the directory search provisions one, so they
> report `isAdmin=false` in the list until then. The grant flow handles this by
> provisioning on demand.

---

## NOTE — future extensions (not implemented)

These are requested but intentionally **out of scope** for this change. Below are
the integration points to wire them later.

### (a) Auto-provision a Forgejo organization when a grown org is created

When a grown org is created, create a matching Forgejo organization (so each
workspace org gets its own code-hosting namespace).

- **Hook:** `orgs.Repository.Create` (or the future `CreateOrg` RPC handler) —
  after the org + first-admin commit, call the Forgejo API
  `POST /api/v1/orgs` (admin token) with `{ "username": <org.slug> }`.
- Store the resulting Forgejo org id/handle (suggest a new column, e.g.
  `grown.orgs.forgejo_org` or a side table `grown.org_forgejo(org_id, handle)`)
  so later admin-sync (b) can target it.
- Make it idempotent (Forgejo returns 422 if the org exists) and best-effort /
  retryable so a Forgejo outage doesn't fail grown-org creation.

### (b) Make a grown-org admin also an admin of that Forgejo org

When `org_admins` changes (grant/revoke), reflect it into the org's Forgejo org
team membership so grown admins are Forgejo org owners/admins too.

- **Hook:** `orgadmin.Repository.GrantAdmin` / `RevokeAdmin`, and the
  first-admin bootstrap path — emit a sync after the DB write.
- Map the grown user → Forgejo user (by email, or a stored Forgejo username on
  `grown.users`), then call the Forgejo API to add/remove them from the org's
  Owners team: `PUT /api/v1/teams/{id}/members/{username}` /
  `DELETE …` (Owners team id discoverable via `GET /api/v1/orgs/{org}/teams`).
- Requires a Forgejo **admin token** (suggest `GROWN_FORGEJO_URL` +
  `GROWN_FORGEJO_ADMIN_TOKEN`), read in `main.go` and threaded to a small
  `internal/forgejo` client injected where `org_admins` is mutated.
- Keep it best-effort + reconcilable (a periodic resync from `org_admins` →
  Forgejo handles missed events), since the source of truth stays grown's
  `org_admins`.
