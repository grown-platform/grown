# grown-workspace V1 design — platform foundation + dashboard

**Status:** Draft
**Date:** 2026-06-08
**Author:** Lucas Pick
**Working name:** `grown-workspace` (placeholder; final name TBD)

## Background

This document specifies V1 of a self-hostable, open-source workspace platform that occupies a similar product surface to Google Workspace (Drive, Docs, Sheets, Slides, Forms, Calendar, Mail, Chat, Meet, Contacts, Admin Console, etc.). It is the first of a multi-phase program; subsequent phases will add specific apps.

The decision to build rather than adopt an existing OSS suite (Nextcloud, OCIS, etc.) was made knowing the full multi-app scope is multi-year. V1 focuses on the **foundation everything else depends on** — auth, tenancy, API surface, deployment, and a tile-launcher dashboard. No real apps ship in V1.

## Goals

1. Provide a working **dashboard** (Workspace-style tile launcher) that signs users in and shows the catalog of planned apps.
2. Lay the **platform foundations** every later app phase will reuse: auth, multi-org tenancy, brand/theming, native API, gam-compat shim, deploy.
3. Be **runnable locally with one command** (`nix run .#dev`) — no Docker, no Kubernetes, no manual setup. Production K8s deploy is a Helm chart; full kind/k8s local dev is deferred until we actually need it.
4. Be **multi-brandable** at deploy time and per-org.
5. Default deployment is **single-org**, but the same codebase scales to **multi-org** via config.
6. Be **LLM-friendly** to develop on: well-typed schemas, generated SDKs, small focused files, module-level READMEs.

## Non-goals (V1)

- Any real app implementation (Drive, Docs, Sheets, etc. — all later phases).
- Real-time collaboration infrastructure.
- File storage backend.
- WebRTC infrastructure.
- Mail (SMTP/IMAP) infrastructure.
- Mobile clients.
- Migration tools from Google Workspace.
- Marketplace / add-on SDK.
- Notifications, presence, cross-app search.
- Pixel-perfect Google Workspace UI mimicry (Material 3 sibling aesthetic, not a clone).

## Stack

| Layer                 | Choice                                  | Rationale                                                                                                                                                                            |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend language      | Go                                      | CNCF default; Grown already has Go expertise (forge-arc); largest contributor pool for k8s-native projects.                                                                       |
| RPC                   | gRPC + grpc-gateway                     | gRPC for service-to-service and typed clients; gateway exposes REST + OpenAPI for browser and tooling.                                                                               |
| API schema            | Protobuf + Buf                          | Single source of truth for types and surface; generates Go server, TS client, OpenAPI, docs.                                                                                         |
| Database              | PostgreSQL                              | Default OSS data store; row-level security supports the tenancy model.                                                                                                               |
| Frontend language     | TypeScript                              | End-to-end types from `.proto` to UI.                                                                                                                                                |
| Frontend framework    | React + Vite                            | Largest contributor pool; ecosystem maturity.                                                                                                                                        |
| UI library            | Material 3 (MUI / m3-react)             | Same design language Google uses, defensibly OSS, polished.                                                                                                                          |
| Auth                  | OIDC (Zitadel default)                  | Pluggable: any OIDC-compliant IdP works (Keycloak, Authentik, Dex).                                                                                                                  |
| Local dev / first-run | Nix flake + process-compose             | One `nix run .#dev` brings up Postgres, Zitadel, backend, frontend as supervised processes. No Docker required. Optional docker-compose alternative for folks who prefer containers. |
| Production deploy     | Helm chart + container images (via Nix) | Reproducible builds, deterministic images. K8s is the production target. Kind / kubectl-based local dev is deferred to a later phase (we don't need it to ship V1).                  |
| License               | Apache 2.0                              | Permissive; OSS-kit norm.                                                                                                                                                            |

## Tenancy model

V1 supports two deploy modes with **the same binary and the same data layer**:

### Single-org mode (default)

- Set via `mode: single-org` in deployment config.
- Exactly one org exists. All data has `org_id` set to the lone org.
- URL pattern: `workspace.acmecorp.com/...` (no subdomain routing).
- One Zitadel realm.
- Smaller cognitive footprint for self-hosters.

### Multi-org mode

- Set via `mode: multi-org` in deployment config.
- N orgs exist within one deploy.
- URL pattern: `<org-slug>.workspace.example.com/...` (subdomain routing; requires wildcard TLS cert).
- Each org has its own auth realm (separate Zitadel project) **or** a shared Zitadel with an `org` claim — pluggable per deployment.
- Row-level data isolation enforced at the data layer.
- Cross-org operations require system-admin role.

### Data model

Every row has `org_id uuid not null`. Single-org mode treats it as a constant; multi-org mode enforces it via:

- Per-request tenant context (extracted from subdomain + JWT claims, cross-checked).
- Row-level security policies in PostgreSQL where supported.
- Application-level filters as defence-in-depth.

## API surface

Two layers, same backend:

### Native API — `/api/v1/...`

- Modeled around our domain (Org, User, Group, App, BrandConfig, etc.).
- gRPC core; grpc-gateway exposes REST + JSON.
- OpenAPI spec generated from `.proto`.
- TypeScript and Go clients generated, committed to `gen/`.

### gam-compat shim — `/admin/directory/v1/...`, etc.

- Implements enough of [Google Admin SDK Directory API](https://developers.google.com/admin-sdk/directory) for `gam` to work unmodified against our backend.
- Translates Google's data model onto our native model.
- Coverage grows as the rest of the platform grows; V1 ships with `Users` and `Groups` (the minimum that lets `gam info user`, `gam create user`, `gam create group` work).
- Not goal-compatible (we don't have to match every quirk); behaviour-compatible for the operations we expose.

## Auth flow

- OIDC Authorization Code + PKCE.
- Backend ships with a default config for Zitadel; identity-provider settings are per-org (multi-org) or global (single-org).
- JWTs from the IdP are exchanged for short-lived **session tokens** signed by the backend; this lets us cache user/org/permission lookups without re-validating the IdP token on every request.
- gRPC and REST share the same session token (cookie for browser, `Authorization: Bearer` for CLI/gam).
- Role mapping: IdP groups → our roles via a per-org config map. Default mapping ships with sensible defaults (e.g. `admins` IdP group → `org-admin` role).

## Brand / theming

A `Brand` value (per-deploy default, per-org override in multi-org) controls:

- Product name (default: "Workspace")
- Logo (SVG / PNG)
- Colors (primary, secondary, surface, error)
- Support URL
- Custom dashboard headline / tagline

The React app reads brand tokens from CSS custom properties at runtime. Brand changes don't require a rebuild; they're a config push.

## V1 dashboard tile set

Stub tiles for every Workspace-equivalent app in the planned roadmap. Each tile routes to a "Coming soon" page (HTTP 501 + a friendly UI) until that app's phase ships.

Initial catalog (matches our research scope):

| Tile          | Future phase            |
| ------------- | ----------------------- |
| Drive         | Phase 1 (foundational)  |
| Calendar      | Phase 1                 |
| Contacts      | Phase 1                 |
| Mail          | Phase 2 (communication) |
| Chat          | Phase 2                 |
| Meet          | Phase 2                 |
| Docs          | Phase 3 (documents)     |
| Sheets        | Phase 3                 |
| Slides        | Phase 3                 |
| Forms         | Phase 3                 |
| Photos        | Phase 3                 |
| Keep          | Phase 4 (auxiliary)     |
| Sites         | Phase 4                 |
| Groups        | Phase 4                 |
| Admin Console | Phase 4                 |
| Marketplace   | Phase 4                 |

Tile metadata lives in `internal/catalog/`. Adding or reordering tiles is config, not code.

## LLM-friendly project conventions

- **Schema-first** development. Every API has a versioned `.proto` with thorough comments; LLMs and humans read intent there before code.
- **Generated SDKs in `gen/`**, committed. Never hand-edited. Regenerated by `nix run .#gen`.
- **One concept per file**; files target ≤ 300 lines so they fit in a model's context fully.
- **Module-level `MODULE.md`** in every `internal/<name>/` directory describing purpose, key interfaces, dependencies, and gotchas.
- **No package-level circular deps** (enforced via `buf lint` + `golangci-lint`).
- **Pre-commit hooks** run `go vet`, `golangci-lint`, `buf lint`, frontend type-check, `gofumpt`, `eslint`.

## Repo structure

The grown-workspace project lives as a sibling of grown-workspace under `/home/lucas/workspace/grown/grown-workspace/`. Initial layout:

```
grown-workspace/
  flake.nix                      # devshell, build, container, helm packaging
  flake.lock
  go.mod, go.sum
  package.json, pnpm-lock.yaml   # only for the web/ subtree
  buf.yaml, buf.gen.yaml

  proto/
    grown/
      v1/                        # Native API
        org.proto, user.proto, group.proto, app.proto, brand.proto, ...
      admin/directory/v1/        # gam-compat shim (mirrors Google's surface)
        users.proto, groups.proto, ...

  gen/
    go/                          # generated Go server stubs and clients
    ts/                          # generated TS client

  cmd/
    server/                      # backend HTTP+gRPC entrypoint
      main.go
    grown/                       # CLI: `grown users create lucas`
      main.go

  internal/
    auth/                        # OIDC + session tokens
      MODULE.md
    tenancy/                     # org context, single/multi-org routing
      MODULE.md
    brand/                       # theming
      MODULE.md
    catalog/                     # app catalog (tile metadata)
      MODULE.md
    gamcompat/                   # Google Admin SDK shim
      MODULE.md
    storage/                     # Postgres data layer
      MODULE.md
    audit/                       # audit log (foundational; lights up in later phases)
      MODULE.md

  web/
    app/                         # React + Vite frontend
      src/
        routes/
        components/
        brand/
        api/                     # uses generated TS client
        pages/
          Dashboard.tsx
          ComingSoon.tsx
          SignIn.tsx
      index.html
      package.json
      vite.config.ts

  deploy/
    process-compose/             # local dev: `nix run .#dev` -- supervised processes, no Docker
    docker-compose/              # alternative local: same stack as containers, for folks who prefer them
    helm/grown-workspace/        # production: K8s Helm chart
    nix/                         # container image definitions (Nix-built, deterministic)

  docs/
    DEVELOPMENT.md               # how to develop locally
    DEPLOYMENT.md                # how to deploy (single-org + multi-org)
    BRANDING.md                  # how to customize a brand
    AUTH.md                      # how to plug in a different IdP
    GAM-COMPAT.md                # which gam commands work, which don't
    architecture/
      adr/                       # ADRs go here as decisions accumulate
```

## Testing strategy

- **Unit tests** in Go using the standard `testing` package; `internal/` packages all carry tests.
- **API contract tests** via `buf` breaking-change detection + protobuf snapshot tests.
- **Integration tests** spin up a Postgres in a test container and exercise the real data layer; auth integration tests use a [Mock OIDC Provider](https://github.com/oauth2-proxy/mockoidc) or Zitadel's test mode.
- **Browser end-to-end tests** with **Playwright** — consistent with the capture harness we already use for research; tests live in `web/app/e2e/` and cover sign-in, dashboard render, tile click, single-org → multi-org switch, and gam-compat happy path.
- **CI** runs the full suite in a Nix-built shell so it matches devshell exactly.

## V1 success criteria

V1 is **done** when:

1. `nix run .#dev` starts the full stack locally (Postgres, Zitadel, backend, frontend) via process-compose. No Docker, no kubectl, no kind.
2. Browsing to `http://workspace.localtest.me` (resolves to 127.0.0.1 automatically — no /etc/hosts editing) shows the dashboard sign-in.
3. Signing in via Zitadel lands the user on a Material 3 dashboard with stub tiles for all planned apps.
4. Clicking any tile loads a "Coming soon" page styled with the active brand.
5. Switching to `mode: multi-org` and creating a second org via the CLI gives that org its own subdomain (`acme.workspace.localtest.me`) with its own dashboard.
6. `gam info user lucas@workspace.localtest.me` works against the gam-compat shim and returns a user record.
7. Brand config can be swapped at deploy time and the dashboard re-skins.
8. End-to-end tests cover sign-in, dashboard render, tile click, gam-compat happy path, and the single-org → multi-org switch.

## Open questions

| #   | Question                                                                                            | Default if unanswered                                                               |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Final project name (replaces "grown-workspace")                                                     | `grown-workspace`                                                                   |
| 2   | Default local-dev hostname                                                                          | `workspace.localtest.me` (resolves to 127.0.0.1 with no /etc/hosts edits)           |
| 3   | Initial Zitadel admin password (for `nix run .#dev`)                                                | Generated and printed once at first boot                                            |
| 4   | Should the gam-compat shim ship with the minimal Users/Groups endpoints in V1, or wait for Phase 1? | V1 — but only the read-side; writes deferred until we have something to write into. |
| 5   | Whose Zitadel image are we using — upstream `ghcr.io/zitadel/zitadel` or pinned via Nix?            | Pinned via Nix (deterministic)                                                      |
| 6   | Do we publish the Helm chart to a chart registry, or is it repo-local only for V1?                  | Repo-local only for V1                                                              |

## Phase plan (for context only — not in V1 scope)

| Phase         | Scope                                                                                                                                                                                                                                                                                                                                                          | Estimated effort         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 0 (this spec) | Platform foundation + dashboard                                                                                                                                                                                                                                                                                                                                | Foundation; weeks-months |
| 1             | Drive, Calendar, Contacts (foundational apps)                                                                                                                                                                                                                                                                                                                  | Months                   |
| 2             | Mail, Chat, Meet (communication)                                                                                                                                                                                                                                                                                                                               | Months                   |
| 3             | Docs, Sheets, Slides, Forms, Photos — heaviest lift. Real-time multi-user editing is mandatory: requires WebSocket/WebTransport endpoints alongside the existing HTTP gateway, plus an OT or CRDT protocol layer. Likely uses Collabora Online or OnlyOffice as the editor substrate, with our shell wrapping it and our backend brokering the collab session. | Months-years             |
| 4             | Keep, Sites, Groups, Admin Console, Marketplace (auxiliary + admin)                                                                                                                                                                                                                                                                                            | Months                   |

## Next step

Once this spec is approved, hand off to the writing-plans skill to generate an executable implementation plan for V1.
