# ci/ — container-image dependency-update system (foundation)

This directory is the **foundation** of a dependency-update system for every
container image this repo builds, bundles, or deploys. It is **report-only**:
nothing here edits a pin, triggers a build, or changes a deployment. It gives
a future automation (a daily Claude agent) a single manifest to read and a
checker to tell it what is out of date.

Two files:

| file               | role                                                          |
| ------------------ | ------------------------------------------------------------- |
| `versions.toml`    | the manifest — single source of truth for every tracked image |
| `check-updates.sh` | the checker — reports which pins have newer versions          |

## `versions.toml` — the manifest

One `[[image]]` table per tracked dependency. Each entry records the **current
pin**, **where that pin lives** (file + field, so a bumper knows exactly what to
edit), and a **check source** (how to find newer versions). The full schema is
documented in the header comment of the file. Key fields:

- `key` — stable id used in checker output / JSON.
- `kind` — `self` | `nix` | `upstream` (see below).
- `current` — the version currently pinned, read verbatim from `pin_file`.
- `pin_file` / `pin_field` — the file and the exact location of the pin to edit.
- `check_type` + (`check_url` | `check_repo` | `nix_attr`/`lock_file`) + `tag_filter`.
- `gap` — a short tag for a known gap the checker should surface.

### The three `kind`s

- **`self`** — built by this repo's CI (the `.forgejo/workflows/*`). There is no
  upstream version to chase; the entry records the workflow + tag scheme and
  flags any gaps. Tracked: `grown`, `ls-sandbox`, `pdf`.
- **`nix`** — a `dockerTools` image from `nix/images.nix`, whose version is
  whatever the pinned `nixpkgs` rev in `flake.lock` evaluates to. Bumped with
  `nix flake update`, not by editing a tag. Tracked: `nix-postgres`,
  `nix-minio`, `nix-zitadel`.
- **`upstream`** — a third-party image pinned to an explicit tag in a
  `deploy/`/`helm` file. Bumped by editing that tag. Tracked: `postgres`,
  `minio`, `zitadel`, `bolo-mp`, `guacamole`, `guacd`.

## `check-updates.sh` — the checker

```bash
./ci/check-updates.sh          # pretty human-readable report (default)
./ci/check-updates.sh --json   # machine-readable JSON array to stdout
./ci/check-updates.sh --help
```

- Read-only. **Always exits 0** (it's a report).
- Uses `curl` + `jq` for upstream and `nixos-unstable`-HEAD lookups, and `nix`
  (if present) to evaluate nix attribute versions. If any tool is missing or the
  network is down, that one source is marked `skipped`/`error` and the run
  continues — one failing source never aborts the whole report.
- `--json` emits `[{key, kind, current, latest, status}, ...]` for the daily
  agent to consume. `status` is one of: `up-to-date`, `update`, `manual`,
  `skipped`, `error`, `ci-built`, `gap:<name>`, `lock-behind-head`.

Per `kind` the checker does:

- **upstream** — queries the recorded source (Docker Hub / quay / GitHub
  releases), finds the newest tag matching `tag_filter`, and prints
  `UP-TO-DATE` or `UPDATE: <key> <current> -> <latest>` with the source URL.
  `check_type=none` (e.g. `bolo-mp`) prints `MANUAL` — no queryable source.
- **nix** — reports the root `flake.lock` `nixpkgs` rev + `lastModified` + age
  in days, and whether `nixos-unstable` HEAD is newer; with `nix` available it
  also `nix eval`s the attribute version the current lock would build.
- **self** — prints `SELF` (CI-built, no upstream check) and `SELF/GAP` with the
  recorded gap.

## Known gaps the checker surfaces

- **nix images not version-tagged** (`nix-postgres`/`nix-minio`/`nix-zitadel`):
  `nix/images.nix` tags them only `:nix` and they are not published with version
  tags. Deploys still use the upstream images, not these.
- **`ls-sandbox` deployed as `:latest`**: `deploy/guacamole/40-ls-sandbox.yaml`
  pins `:latest` (`imagePullPolicy: Always`), ignoring the version tag its
  workflow produces — no pinned/auditable version in the deploy.
- **`pdf` publishes no `:latest`** — only the versioned tag.
- **Two separate flakes**: the root `flake.lock` (drives the nix images) and
  `pdf/flake.lock` (independent; nixpkgs + nix2container + treefmt +
  pre-commit-hooks) update independently.
- **`bolo-mp`** is built outside this repo with no public source — bump by hand.

## How the planned daily Claude agent will use this

1. Run `./ci/check-updates.sh --json`.
2. For each entry with `status=update`: open `pin_file`, edit `pin_field` from
   `current` to `latest`.
3. For each `nix` entry with `status=lock-behind-head` (when a refresh is
   wanted): run `nix flake update` (and `pdf/` separately).
4. Group changes, open a **PR for human review** — never auto-merge, never push
   to a deploy directly. The gaps above become tracked follow-up issues.

Editing `versions.toml` after a bump (to record the new `current`) keeps the
manifest honest for the next run.
