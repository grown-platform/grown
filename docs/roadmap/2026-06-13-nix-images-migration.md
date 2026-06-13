# Migrate grown to Nix-built container images

Goal: replace every container image grown runs with **Nix-built images** from the
`nix-containers` framework (`~/workspace/drduker/nix-containers`, published to
`ghcr.io/nix-containers/images/<name>`), swapping them **one at a time** with
verification — never a big-bang.

## Why
Reproducible, minimal, supply-chain-auditable images; one build system for the
whole platform; `nix-containers` already maps many upstream images to nix
equivalents (`images/chart-image-mapping.nix`).

## Inventory — what grown runs
| Component | Today (upstream image) | nix-containers status |
|---|---|---|
| **MinIO** (S3) | `quay.io/minio/minio` | ✅ available (`minio`, nixpkgs) |
| **Postgres** | `postgres` / CNPG | ✅ available (`postgres`; CNPG = `cloudnative-pg`) |
| **Zitadel** (OIDC) | `ghcr.io/zitadel/zitadel` | ⚠️ verify / add (`keycloak`/`dex` exist; zitadel may need adding) |
| **pandoc** (in grown image) | bundled in grown Dockerfile | ✅ `pandoc` package available |
| **grown app** (Go + React SPA + pandoc) | `code.pick.haus/grown/grown` (Dockerfile) | ❌ **new build** — the main piece |
| bolo-mp (Orona sim) | `code.pick.haus/grown/bolo-mp` (node) | ❌ later (low priority) |

## Swap order (lowest risk → highest)
1. **MinIO** — flip the chart's `minio.image` to `ghcr.io/nix-containers/images/minio`. Stateless-ish; easy rollback.
2. **Postgres** — flip `postgres.image` to the nix image (match the major version). Take a backup first.
3. **Zitadel** — confirm/add a nix image; flip `zitadel.image`. (Auth — verify login end-to-end.)
4. **grown app image** — the big one: build a Nix image for the Go backend + the
   Vite SPA + pandoc (replace the multi-stage `Dockerfile`). Add a `grown` image to
   `nix-containers/images` (dockerTools `buildLayeredImage`: the Go binary via
   `buildGoModule`, the SPA via a `buildNpmPackage`/`pnpm` derivation, pandoc in
   `contents`), publish, then flip `image.repository`/`image.tag` in the chart +
   the gitops deployment (currently Flux image-automation tracks the Forgejo tag —
   the nix image will need its own tag/automation policy).

## Mechanism
- Each swap = change ONE image value in `deploy/helm/grown/values.yaml` (and/or the
  gitops deployment), reconcile, verify (`/healthz`, the component's own check,
  end-to-end where relevant), and only then move to the next.
- Keep the old image pinned in a comment for instant rollback.

## Testbed: grown.haus
The new **self-contained `grown.haus`** instance (its own Postgres/MinIO/Zitadel,
deployed from the chart) is the ideal place to validate each nix image **before**
swapping `workspace.pick.haus`. Plan: get nix images green on grown.haus first,
then promote the same value to the prod instance.

## Registry
`ghcr.io/nix-containers/images/<name>` (built by the existing nix-containers ARC
runner — see gitops `clusters/homelab/arc/runner-nixcontainers-hr.yaml`). The grown
app image can publish there too, or to `code.pick.haus/grown/`.

## Status
Plan only. Deps are largely available now; the grown-app nix image is the main
build. Start swaps after grown.haus is up (use it as the testbed). Do NOT swap
images while a deploy is mid-flight.
