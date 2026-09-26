# OnlyOffice parity — index

Grown (MIT) is a Google-Workspace-like suite. This directory tracks how far
Grown's editors are from OnlyOffice's *behaviour* and test coverage, and plans
the additive work to close the gap. Everything here is planning: the plans
describe features and tests to add on top of Grown's existing architecture,
never rewrites (see the ground rule in each plan).

Canonical source: **https://code.pick.haus/grown/grown-workspace** (Forgejo).
**https://github.com/grown-platform/grown** is a mirror only — open PRs and
issues on Forgejo.

## Plans

**Start with [ROADMAP.md](ROADMAP.md)**: the combined, wave-ordered execution plan across all four plans.

| Plan | Scope | Manifest rows |
|---|---|---|
| [docs.md](docs.md) | Word processor (`sdkjs/word`, `tests/word`, `web-apps/apps/documenteditor`) vs `web/app/src/pages/docs` + `internal/docs` | `docs-tests.csv` |
| [sheets.md](sheets.md) | Spreadsheet (`sdkjs/cell`, `tests/cell`, `spreadsheeteditor`) vs `web/app/src/pages/sheets` + `internal/sheets` | `sheets-tests.csv` |
| [slides.md](slides.md) | Presentations (`sdkjs/slide`, `tests/slide`, `presentationeditor`) vs `web/app/src/pages/slides` + `internal/slides` | `slides-tests.csv` |
| [cross-cutting.md](cross-cutting.md) | PDF editor, Forms/oform, Visio viewing, `sdkjs/common` (fonts, geometry, charts, colour mods, spellcheck, collaboration, plugins/macros), file conversion (`core/`), and the parity scoreboard design | `common-tests.csv` |

## License rule

OnlyOffice is **AGPL-3.0**. Grown is **MIT**. Therefore:

- Never copy OnlyOffice code, test files, or fixture documents into the tracked
  tree. `research/` is gitignored (`.gitignore` line `research/`) and must stay so.
- Read their tests to learn behaviour — inputs and expected outputs — then write
  *new* tests in Grown's own harnesses (vitest in `web/app`, Playwright in
  `web/e2e` and `pdf/frontend/e2e`, `go test` in `internal/`).
- Never link, vendor, or `exec` OnlyOffice `core`/`x2t`. External converters are
  allowed only as separately installed executables invoked over stdio (as pandoc
  already is in `internal/docs/convert.go`) and only with permissive or GPL/MPL
  licenses — never AGPL.
- OnlyOffice fixture *documents* may be used as local, non-committed round-trip
  input (`GROWN_CONVERSION_CORPUS`); tests skip when the directory is absent.

## `research/onlyoffice/` layout (local only)

Shallow clones fetched 2026-09-26; see `research/onlyoffice/README.md` for refresh commands.

| Dir | Upstream | What it is |
|---|---|---|
| `sdkjs/` | ONLYOFFICE/sdkjs master (72b0421) | Editor engines: `word/`, `cell/`, `slide/`, `pdf/`, `visio/`, `common/` (+ a few in-tree manual harnesses: `pdf/test`, `common/geometry/test`, `common/libfont/test`) |
| `sdkjs-tests-v9.3.1/tests/` | sdkjs tag v9.3.1.11 `tests/` (removed upstream in 9.4) | QUnit suites run by `runAll.js` (node-qunit-puppeteer): `cell/` (1073 tests), `word/` (356), `slide/` (38), `common/` (36), `visio/` (7), `oform/` (2), `pdf/` (1), `code-style/check.py` — **1513 `QUnit.test(` total** |
| `web-apps/` | ONLYOFFICE/web-apps master (9c0ca538) | UI: `apps/{documenteditor,spreadsheeteditor,presentationeditor,pdfeditor}`, shared `apps/common` (plugins controller, dialogs) |
| `sdkjs-forms/` | ONLYOFFICE/sdkjs-forms master (a16e987) | oform model (roles, field masters/groups, XML package) |
| `core/` | ONLYOFFICE/core master (3250a848) | C++ `X2tConverter` + format libraries (`OOXML`, `OdfFile`, `PdfFile`, `DocxRenderer`, `EpubFile`, …) and their C++ tests + **86 fixture documents** |
| `DocumentServer/` | ONLYOFFICE/DocumentServer master (f580eb5) | Umbrella repo |

## Manifest CSVs

Every plan ships a `*-tests.csv` with the same columns:

```
onlyoffice_path,test_count,area,portability,target_grown_path,milestone
```

- `onlyoffice_path` — relative to `research/onlyoffice/`.
- `test_count` — snapshot count of `QUnit.test(` in that file (or fixture
  documents for `core/**` directories) at the time the row was written.
- `area` — scoreboard grouping; free text per plan (e.g. `pdf`, `forms`,
  `visio`, `common-api`, `conversion`, or the editor-specific areas each plan
  chooses). The scoreboard groups by the exact string.
- `portability` — `high` (port cases 1:1), `medium` (same behaviour, different
  model), `low` (only the idea carries over), `none`/`n/a` (harness or fixture
  file with no cases, or not applicable). Case-insensitive; a trailing
  parenthetical note is allowed (`High (as key-map table)`) — the scoreboard
  keys on the first word.
- `target_grown_path` — one or more files/globs where the ported tests live or
  will live, separated by `;` (a quoted comma list is also accepted); may not
  exist yet. Empty means no Grown target.
- `milestone` — one or more milestone ids from the plan, space-separated
  (`CC0…CC8` in cross-cutting; editor plans use their own `M<n>` ids);
  `exception` for flagged non-goals; `-` or empty for none.

The scoreboard script normalises all of the above, so plans only need to keep
the six columns and the row-per-OnlyOffice-file shape.

## Scoreboard

Designed in [cross-cutting.md §4](cross-cutting.md#4-parity-tracking-harness-scoreboard--design); to be implemented as milestone CC0:

- `web/app/scripts/onlyoffice-parity.mjs` (plain Node ESM, no deps; same
  pattern as `web/app/scripts/gen-games-pwa.mjs`), exposed as `npm run parity`.
- Reads all `docs/plans/onlyoffice-parity/*-tests.csv`; for each row counts the
  OnlyOffice side live from `research/onlyoffice/` when present (otherwise uses
  the snapshot `test_count` and marks the column `(snapshot)`), and counts Grown
  tests in `target_grown_path` (`it/test(` in vitest files, `test(` in Playwright
  specs, `func Test` in Go). Optional `--vitest-json/--go-json/--pw-json` inputs
  turn "ported" into "passing".
- Prints a per-area table plus a grand total; `--json` and `--md` for CI
  artifacts; `--check` compares against tracked `baseline.json` and fails on
  regression; `--write-baseline` updates it.
- Degrades gracefully in CI (no `research/`, no result files, missing targets →
  snapshot counts, `n/a`, and 0 respectively; never an error).
- Wire-up: one step in `.forgejo/workflows/checks.yaml` `frontend` job.

## Baseline commit

All plans and CSVs in this directory are baselined against **`origin/main` c90064e**
(2026-09-26). That commit includes the merged PDF-editor overhaul (PR #32,
4850ecf: `/editor` with 67 e2e) and docs import via pandoc (c3e38aa, dac2186).
Re-run the scoreboard rather than trusting these numbers after that commit.

## Current Grown test baseline (origin/main c90064e)

| Harness | Files | Cases |
|---|---|---|
| `web/app` vitest | 16 | 164 |
| `web/e2e` Playwright | 8 | 16 |
| `pdf/frontend` Playwright | 27 (25 `editor-*` + `api` + `app`) | 76 (67 editor + 5 + 4) |
| `internal/` Go | 237 | 1606 `func Test` |
