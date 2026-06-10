# Personal orgs & per-object ACL sharing

Two foundational changes that take grown from "strictly org-isolated" to
"org-isolated **plus** explicit per-object cross-org sharing", and let an
individual sign up without belonging to a shared tenant.

Both are additive and fail-safe: with the personal-org flag off and no grants
created, behavior is identical to before.

---

## Feature 1 — Personal (org-per-user) onboarding

### Behavior

When a user signs in via OIDC for the **first time ever** (no `grown.users`
row exists for their `(oidc_issuer, oidc_subject)` in **any** org), they get a
brand-new **personal org** of which they are the sole member and admin, instead
of being dropped into the shared `default` org.

- Personal org slug: `personal-<12 hex>` (random, collision-retried).
- Display name: the user's name, falling back to email, then
  `"Personal workspace"`.
- The new user is bootstrapped as their personal org's first admin via the
  existing `internal/orgadmin` `EnsureFirstAdmin` (same path team orgs use).

### What it does NOT do

- It never moves or re-orgs an **existing** user. Returning users are matched by
  `(oidc_issuer, oidc_subject)` across all orgs
  (`users.GetByOIDCAnyOrg`) and keep whatever org they were provisioned into —
  so current `default`-org members are untouched.
- It does not create a personal org for users added to an existing team org
  (that invite path is unchanged / future work — see Gaps).

### Config flag

`GROWN_PERSONAL_ORGS` (default **on**). Set to `0`/`false`/`off`/`no` to
disable: first-ever sign-ins then fall back to the shared `default` org (the
legacy single-org behavior). Surfaced as `auth.Config.PersonalOrgs`.

### Where it hooks in

`internal/auth/service.go` → `Service.Callback` now calls
`Service.resolveSignInOrg(issuer, subject, name, email)`:

1. `users.GetByOIDCAnyOrg` → existing user? reuse their org.
2. else if `PersonalOrgs` → `orgs.CreatePersonal(displayName)` → new org.
3. else → the `default` org.

The user is then upserted into the resolved org and (unchanged) the
first-admin bootstrap runs against that org.

`orgs.CreatePersonal` (`internal/orgs/repository.go`) is the new org-creation
primitive for this path; it does not write an admin row (the existing
`EnsureFirstAdmin` in `Callback` does that).

### Admin UI for personal orgs

The dashboard already gates the admin tile on `whoami.isAdmin`. A personal user
**is** their own org's admin, so the admin surface remains available to them but
is effectively a single-member org (no other members to manage). We left it
visible rather than special-casing it — documented here as intentional. It can
be suppressed later by checking org member count == 1 if desired.

---

## Feature 2 — Per-object ACL grants (Drive + Docs)

### Model

A single table, `grown.object_grants` (migration **0042**), is the per-user
sharing primitive:

```
object_grants(
  object_type      text,      -- 'drive_file' | 'docs_document' (app-defined)
  object_id        uuid,
  grantee_user_id  uuid → grown.users(id),
  role             text check in ('viewer','commenter','editor'),
  granted_by       uuid → grown.users(id),
  created_at       timestamptz,
  primary key (object_type, object_id, grantee_user_id)
)
```

A row grants one **grown user** a role on one object. `object_id` is
intentionally **not** a foreign key (it spans multiple tables); the owning
service resolves and is responsible for it. Grants are keyed by grown user id,
resolved from the directory picker (`GET /api/v1/directory?q=`).

`internal/sharing` is the data-access layer:
`GrantAccess`, `RevokeAccess`, `ListGrantsForObject`,
`ListObjectIDsGrantedToUser`, and the security-critical `RoleFor`.

### The cross-org read path (security-critical)

A grant lets a user who is **not** a member of the object's owning org open
**that one object** — nothing else. Org isolation is otherwise unchanged.

Both services funnel reads through an `accessX` helper that returns the object,
the caller's effective role, and `NotFound` when neither path applies:

- **Drive** — `drive.Service.accessFile` (`internal/drive/service.go`):
  1. `repo.Get(orgID, id)` — org-member path (org-scoped query). Member role is
     `editor` (`owner` if they own it).
  2. else `grants.RoleFor(userID, "drive_file", id)` — if a grant exists,
     `repo.GetByID(id)` (no org filter) returns the file at the granted role.
  3. else `NotFound`.

  `GetFile` and the blob `DownloadHandler` both use `accessFile`, so metadata
  and content share one gate.

- **Docs** — `docs.Service.accessDoc` (`internal/docs/service.go`): identical
  shape over `repo.Get` / `grants.RoleFor("docs_document", id)` /
  `repo.GetByID`. `GetDoc` uses it; the collab WebSocket
  (`internal/server/server.go` → `serveDocsWS`) adds a per-user-grant branch
  (editor grant ⇒ write, viewer/commenter ⇒ read-only) alongside the existing
  org-member and link-token branches.

**Never reveal existence without access.** The non-org, non-grantee case
returns gRPC `NotFound` (HTTP 404) — the same as a missing object — so callers
can't probe for objects they can't see. The org-scoped repo queries (`Get`,
`List`, `Trash`, `Rename`, grant-management) are unchanged, so a non-member
cannot mutate or manage a shared object; only the read path was widened.

### List queries

- **"Shared with me"** = `ListObjectIDsGrantedToUser(userID, type)` →
  `repo.GetByIDs(ids)` (cross-org, non-trashed), minus any object already in the
  caller's own org. Drive: `ListSharedWithMe` (`GET /api/v1/drive/shared-with-me`).
  Docs: `ListSharedWithMe` (`GET /api/v1/docs/shared-with-me`).
- The existing org-scoped `ListFiles` / `ListDocs` are **unchanged** — they
  still return only the caller's org. Shared objects appear exclusively in the
  "Shared with me" view, not mixed into the org list.

### Grant management RPCs

Only an **org member** of the object may grant/revoke (a mere grantee cannot
re-share). Drive: `GrantAccess` / `ListGrants` / `RevokeAccess` under
`/api/v1/drive/files/{file_id}/grants`. Docs: same under
`/api/v1/docs/d/{doc_id}/grants`. `ObjectGrant` (in `drive.proto`, reused by
`docs.proto`) carries the resolved grantee name/email for the UI.

### Link-based shares still work

`drive_shares` and `docs_shares` (anyone-with-the-link + email audience) are
untouched and coexist with per-user grants.

### Notifications

Best-effort: `GrantAccess` calls an optional `Notifier.NotifyGranted` hook
(nil = no-op today). It never blocks the grant.

### Frontend

- `web/app/src/components/PeopleGrants.tsx` — shared "share with specific
  people" panel: a debounced directory picker (`api/directory.ts`
  `searchDirectory`) + role select + current-grantee list with revoke. Wired
  with app-specific list/grant/revoke callbacks.
- Drive: inside `FileDetailsPanel` → "Manage access" (above the link section).
  "Shared with me" sidebar entry → `/drive?view=shared`.
- Docs: inside `ShareDialog` (above invite-by-email). "Shared with me" appears
  as an owner-filter option in `DocList`.

---

## Extending to other apps

The pattern is app-agnostic. To add per-user sharing to e.g. Sheets:

1. Pick an `object_type` string (`'sheets_document'`).
2. Give the repo a `GetByID(id)` (no org filter, non-trashed) and
   `GetByIDs(ids)`.
3. Inject `*sharing.Repository` into the service (`WithSharing`), add an
   `accessX` helper mirroring Drive/Docs, and route the read/connect path
   through it.
4. Add `GrantAccess` / `ListGrants` / `RevokeAccess` / `ListSharedWithMe` RPCs
   (reusing `ObjectGrant`).
5. Frontend: reuse `PeopleGrants` with the new endpoints.

Today only **Drive** (`drive_file`) and **Docs** (`docs_document`) are wired.

## Gaps / follow-ups

- **Directory reach across orgs.** The picker (`/api/v1/directory`) searches the
  caller's own org roster (plus live Zitadel matches, which it lazily provisions
  into the caller's org). A personal-org user in a different org won't appear in
  another org member's picker unless Zitadel enrichment surfaces them. Grants
  themselves are cross-org once you have the grantee's grown user id; broadening
  picker discovery (e.g. global email lookup) is a follow-up.
- **Invite-to-team-org flow.** Personal-org creation only covers self-serve
  first sign-ins. Adding an existing/new user to a team org is unchanged.
- **Grant cleanup on hard-delete.** `object_grants.object_id` is not an FK;
  `DeleteForever` does not yet prune grant rows (harmless — the object is gone,
  so `GetByID` returns NotFound — but they linger). A periodic sweep or a
  service-side delete hook is a follow-up.
- **Commenter role** is stored and enforced read-vs-write (commenter = no
  write, same as viewer for collab); a distinct comment-only capability in the
  editor is future work.
- **Notifications** are a no-op stub.

```

```
