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

## Flake image build (in-repo, `nix/images.nix`)
grown's own `flake.nix` now builds the four images directly via `dockerTools`,
so we don't have to route everything through `nix-containers` to start. Outputs
live under `nix/images.nix` (+ `nix/spa.nix` for the Vite SPA) and are exposed as
flake `images.*` attrs.

### Commands
```
nix build .#images.grown      # grown app: Go backend + Vite SPA + pandoc
nix build .#images.postgres   # Postgres 17 (initdb + /docker-entrypoint-initdb.d)
nix build .#images.minio      # MinIO (server /data --console-address :9001)
nix build .#images.zitadel    # Zitadel (start-from-init passthrough)
nix build .#images.all        # all four tarballs in one linkFarm dir
```
Each `result` is a gzipped image tar; load with `docker load < result`. Images are
tagged `<name>:nix`. The dep images are drop-in for the chart's invocations:
- **postgres**: stock-compatible entrypoint — reads `POSTGRES_USER/PASSWORD/DB` +
  `PGDATA`, runs `initdb` on first boot, sources `/docker-entrypoint-initdb.d/*.sh`
  (the chart's `init-extra-dbs.sh` for the zitadel/pdf DBs), then `exec postgres`.
- **minio**: `Entrypoint=minio`, default `Cmd=[server /data --console-address :9001]`
  (chart's `args` pass straight through), ports 9000/9001, `MINIO_ROOT_*` env.
- **zitadel**: `Entrypoint=zitadel` so the chart's
  `[start-from-init --masterkeyFromEnv --tlsMode disabled]` + `ZITADEL_*` env work
  unchanged; port 8080. zitadel IS in nixpkgs (2.71.7; chart pins upstream v2.71.0).
- **grown**: `Entrypoint=/app/server`, `WorkingDir=/app`, SPA at
  `GROWN_STATIC_DIR=/app/web/dist`, pandoc on PATH, ports 8080/9000, `User=10001`.

### Build approach / what resolved
- **grown backend**: `buildGoModule` over the repo (`subPackages=["cmd/server"]`,
  `CGO_ENABLED=0`, version/commit ldflags, migrations embedded). The committed
  `gen/` proto code (gitignored but present in the worktree) is used as-is, so the
  build does NOT re-run `buf generate` (which needs BSR remote plugins/network).
  Resolved **`vendorHash = sha256-DD1IQwbNBgrhSMJ/wM3De5tIuv+PWjZdl4LBXhhBYpM=`**.
- **grown SPA** (`nix/spa.nix`): `buildNpmPackage` over `web/app`, `npm run build`
  (= `tsc -b && vite build`) with the `VITE_*` build args (defaults mirror the
  Dockerfile; overridable as flake args). Output `$out` = the `dist/` dir copied to
  `GROWN_STATIC_DIR`. Resolved
  **`npmDepsHash = sha256-bBVBjGHFkk+H/9SyJMc6d5wjIDeyEnCqjtUAV758a7g=`**.
- **minio** in the pinned nixpkgs is flagged insecure (recent CVE batch); the images
  nixpkgs sets `permittedInsecurePackages = ["minio-2025-10-15T17-29-55Z"]` so the
  image still builds (the chart already runs an upstream minio — no regression).

### Not yet bundled
The Dockerfile's **PDF SPA** (`/app/pdf-web`, `GROWN_PDF_STATIC_DIR`,
`GROWN_PDF_BUILTIN`) is NOT in the nix image yet: its lockfile pulls a non-registry
`tibui` tarball (`code.pick.haus/.../tibui-v1.3.5.tar.gz`) which `buildNpmPackage`'s
content-addressed npm cache doesn't ingest cleanly. `GROWN_PDF_BUILTIN` is off by
default, so the image is functional without it. Follow-up: add a second
`buildNpmPackage` (or a `fetchurl` of tibui wired into the npm cache) and copy its
`dist` to `/app/pdf-web`.

### Architecture caveat (IMPORTANT)
`dockerTools` images are **linux** images, built for `pkgs.system`. The flake
targets **x86_64-linux** by default (`.#images.*`, for the homelab amd64 cluster)
and exposes **`.#images-aarch64-linux.*`** for the Pi cluster (arm64). The final
image-assembly derivations require a matching linux builder to *run* (they report
`Required system: x86_64-linux`).

On the current **aarch64-darwin** dev host the milestone is partially blocked:
- Flake **evaluates** cleanly for all four images on both arches (drvPaths resolve).
- The **vendorHash** and **npmDepsHash** are resolved and the **SPA dist** + the
  **Go server binary** build successfully (validated natively on darwin — both
  build steps are platform-independent for hashing/compile, Go is `GOOS`-portable).
- The **final `.tar.gz` image-assembly** could NOT be run here: the configured
  remote `x86_64-linux` builder (`ssh://…@192.168.72.110`) was **unreachable**
  (network/VPN down) AND the local user isn't a nix `trusted-user`, so the
  client `builders` setting is ignored. There is no native linux build path on
  aarch64-darwin without a linux builder.

To produce the tarballs: run `nix build .#images.<name>` from a **linux host**
(or with a reachable/registered linux builder, e.g. the homelab amd64 node, a
`darwin.linux-builder` VM, or in CI on a linux runner). For the Pi cluster build
`.#images-aarch64-linux.<name>` on an aarch64-linux builder. Host-arch linux
builds that succeed are the milestone; cross-arch (building arm64 from an amd64
runner) can use `pkgsCross`/binfmt later.

## Status
In-repo flake image builds added (`flake.nix` + `nix/images.nix` + `nix/spa.nix`).
Build logic + both hashes verified on darwin; producing the linux image tarballs is
blocked only on builder availability (see caveat above) — run on a linux builder to
get `result` tarballs, `docker load`, and inspect. Then proceed with the swap order
(MinIO → Postgres → Zitadel → grown), using grown.haus as the testbed. Do NOT swap
images while a deploy is mid-flight.
