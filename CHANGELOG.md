# Changelog

All notable changes to Grown. Releases are tagged `vX.Y.Z`; every push to
`main` also ships a dated image (`YYYYMMDD-HHMMSS-<sha>`) that the reference
instances deploy automatically.

## Unreleased

### Added

- **Keyboard shortcut styles for Docs and Sheets.** Each user picks, per app,
  Microsoft Office style (Word / Excel, the default) or Google style (Google
  Docs / Google Sheets), in Settings ▸ Keyboard shortcuts or from the editor's
  Help ▸ Keyboard shortcuts dialog. The choice is saved with the user's
  preferences and follows them across devices. The Office style keeps every
  existing shortcut and adds Word's Ctrl+L/E/R/J alignment, Ctrl+= /
  Ctrl+Shift+= sub/superscript and Ctrl+Shift+G word count, and Excel's Ctrl+1
  Format cells, Ctrl+Alt+V Paste special, Ctrl+Shift+= / Ctrl+- insert/delete,
  Ctrl+9 / Ctrl+0 hide and Ctrl+Shift+L filter. The Google style uses
  Alt+Shift+5 strikethrough and Ctrl+Alt+X spelling in Docs, and Ctrl+Alt+= /
  Ctrl+Alt+- insert/delete, Ctrl+Alt+9 / 0 hide and Ctrl+Shift+L/E/R alignment
  in Sheets. Both Sheets styles gain Ctrl+Shift+9 / 0 unhide, Ctrl+Space /
  Shift+Space select column / row and Shift+F2 comment. See
  `docs/services/docs.md` and `docs/services/sheets.md`.

## v0.4.0 (2026-09-28)

Home Assistant becomes part of the platform: it ships in the default Helm
install, opens inside Grown, and a new Home Assistant integration brings
Grown's calendar, tasks and notifications into HA.

### Install

- **Image:** `code.pick.haus/grown/grown:v0.4.0`
- **Helm chart:** 0.4.1 (appVersion `v0.4.0`).
- **Plain manifests:** `deploy/manifests/grown.yaml`. It now expects a Secret
  `grown-homeassistant-owner` (keys `username`, `password`) for the Home
  Assistant owner; see `deploy/manifests/README.md`.

### Highlights

- **Home Assistant in every chart install.** `homeAssistant.enabled` now
  defaults to `true`. HA runs next to Grown at `ha.<domain>`, and Grown's Home
  Assistant tile points at it for every org that hasn't set its own URL.
- **No open setup page.** A sidecar creates HA's owner account from the
  `<release>-homeassistant-owner` Secret (generated once) the moment HA starts.
  HA reports ready only after that, so the ingress never routes a visitor to
  HA's first-run page. Read the password with
  `kubectl get secret <release>-homeassistant-owner -o jsonpath='{.data.password}' | base64 -d`.
- **HA inside Grown.** The tile opens `/homeassistant`, which shows HA in a
  full-height frame under Grown's header, with reload and "Open in new tab".
  The chart's seeded HA config allows framing (`use_x_frame_options: false`);
  set `homeAssistant.http.useXFrameOptions: true` to turn that off.
- **The Grown integration for Home Assistant** (`grown`), MIT-licensed, in
  `integrations/homeassistant/`:
  - a calendar entity for Grown Calendar (create, edit, delete);
  - one to-do entity per Grown task list (add, complete, edit, reorder,
    delete);
  - sensors for unread notifications, open tasks and overdue tasks;
  - a notify entity that sends notifications into Grown's bell from HA
    automations.

  Grown serves the integration at `/integrations/homeassistant/grown.zip`, and
  the chart's HA installs it from there on every start, so it always matches
  the Grown version. Bring-your-own HA installs the same zip.
- **Proxy settings that stick.** Home Assistant 2026.9 only keeps changes to
  its `http:` settings (reverse-proxy trust, framing) if they are confirmed
  within five minutes; otherwise it reverts, and requests through the ingress
  fail with 400. The onboarding sidecar now confirms the chart's settings and
  re-applies them if they drift (`homeAssistant.http.manage`, on by default).
  It also repairs installs that already reverted. Chart 0.4.0 lacked this, so
  use 0.4.1.
- **Connect Home Assistant** in Settings > API tokens creates a token with
  exactly the scopes the integration needs and shows the setup steps.

### Platform

- `POST /api/v1/notifications/push` sends a notification to the caller's own
  bell. It needs the `notifications:write` scope, and is limited to 60 per
  minute per user.
- `GET /api/v1/integrations/homeassistant/info` describes the caller: user,
  org, token scopes and server version. It works with any valid token.
- Notifications that link to an absolute http(s) URL open in a new tab.
- Token scopes: `notifications` is available in the limited-token form.

### Upgrading from 0.3.x

- Upgrading the chart **adds Home Assistant**: a StatefulSet, a 5Gi PVC, a
  Service and an ingress host `ha.<domain>`. Set
  `homeAssistant.enabled: false` to keep it off.
- Resource defaults for HA are a 50m CPU / 384Mi request and a 1536Mi memory
  limit. Lower the limit if a LimitRange caps containers at 1Gi.
- If your ingress or tunnel needs an explicit route, add one for the HA host.
  Point it at `<release>-homeassistant:8123`.

## v0.3.0 (2026-09-28)

The first tagged release of Grown, the self-hosted, MIT-licensed workspace
suite. It covers everything merged to `main` from 2026-09-26 through `fd158ea`,
about 440 commits.

Most of this release is about Office-grade editing. Docs, Sheets and Slides
now do most of what people expect from a desktop office suite, and they open
and save Office files much more faithfully. We measured the work against
OnlyOffice's published test suites. Their behaviour was used only as a
reference: every test is written from scratch in Grown's own harnesses, and
no OnlyOffice code or fixtures are included. **2,326 of 2,493 OnlyOffice test
cases (93.3%) now exist as Grown tests.** CI tracks the number and fails if it
goes down. The plans, with notes on what shipped and what is still missing,
are in `docs/plans/onlyoffice-parity/`.

### Install

- **Image:** `code.pick.haus/grown/grown:v0.3.0`
- **Helm chart:** `deploy/helm/grown` at chart version 0.3.0; its appVersion
  (the default image tag) is `v0.3.0`.
  ```sh
  helm install grown deploy/helm/grown -n grown --create-namespace \
    --set domain=grown.example.com
  ```
- **Plain manifests:** `kubectl apply -n grown -f deploy/manifests/grown.yaml`
  (rendered from chart 0.3.0 with the documented dev credentials; re-render
  with your own values for anything beyond a test cluster).

### Highlights

- **Docs is a full word processor.** It has real pagination with sections,
  columns, and headers and footers per section. Also new: styles and
  multilevel lists, Word-style tables, track changes with a review panel,
  equations, a table of contents, captions and cross-references, content
  controls and fillable forms, compare and combine, mail merge, and a built-in
  spell checker.
- **.docx, .xlsx and .pptx files round-trip directly in the browser.** The new
  readers and writers keep styles, lists, tracked changes, comments, fields,
  sections, drawings, charts, tables, themes and animations. The old pandoc
  route remains as a fallback.
- **Sheets:** pivot tables, charts on the grid, Excel tables with structured
  references, filters, conditional formatting, data validation, number
  formats, cross-sheet and whole-column references, dynamic arrays, goal seek,
  trace arrows, threaded comments, and a 509-function Insert Function wizard.
- **Slides:** themes and layouts, 68 preset shapes and connectors, grouping and
  alignment, rich text, tables, cropped pictures, charts, diagrams, video,
  audio and word art. Also transitions and animations, a slideshow with
  presenter view, comments with @mentions, and PDF, ODP and handout export.
- **Version history** for Sheets, Slides and Whiteboards, with previews and
  highlighted changes. Docs versions can show their differences as tracked
  changes.
- **Forms** gained answer validation, input masks, grid and rating questions,
  and section branching. The **PDF editor** gained calculated fields, number
  and date formats, list boxes and push buttons.
- **Helm chart 0.3.0** replaces MinIO, which can no longer be pulled, with
  **rustfs** and includes a verified migration Job. It can also deploy
  **Home Assistant**, which is a new bring-your-own app tile.
- **Security fixes** in document import, collaboration sockets and access
  checks. See [Security](#security).

### Docs

- **Pages and layout.** Documents are laid out as real pages: keep with next,
  keep lines together, widow and orphan control, and tables that split across
  pages with their header rows repeated. New Layout menu and Page Setup
  dialog. Settings can differ per section: page size, orientation, margins,
  columns, line numbers, page borders, page colour, watermark and
  hyphenation. Each section can have its own first, even and default headers
  and footers, with page number, page count and section-page fields. Also
  added: a status bar with the current page, word count and zoom; a page
  thumbnails pane; print preview with page ranges; and a pageless view.
- **Styles and lists.** Style gallery with Word's built-in styles, custom
  styles and "update to match". Bullet, numbered and multilevel list
  libraries, restart and continue numbering, and a Paragraph Settings dialog
  (indents, spacing, line rules, tabs, breaks, borders, shading) tied to the
  ruler.
- **Tables.** Size picker and a Table Settings panel: ten Word-style table
  styles, borders, cell shading and margins, distribute rows and columns,
  autofit, repeat header row, split table, and conversion between text and
  tables.
- **Track changes.** Changes record author and date. Formatting and paragraph
  changes are tracked too. There is a review panel and pop-up, four display
  modes (Markup, Simple, Final, Original), accept and reject, and "track
  changes for everyone". Find and replace also work while tracking is on.
- **References.** Table of contents, table of figures, captions,
  cross-references, bookmarks, and fields (page, date, SEQ, REF and more)
  with Word's F9 update shortcuts. A new References menu and a Link Settings
  dialog that can link to places inside the document.
- **Equations.** Insert with Ctrl+Alt+= or the Σ button. Type in Word's linear
  format with math autocorrect, or in LaTeX, with a live preview, template
  menus and a context menu. Equations survive .docx (OMML) import and export
  and paste from Word and MathML.
- **Pictures, shapes, text boxes and charts.** Pictures are stored as assets,
  not inlined. Wrapping options include square, tight, behind and in front of
  text. You can position, crop, rotate and flip pictures and set alt text.
  Shapes come from the Slides gallery, and charts use the Sheets chart
  editor. All of these round-trip through .docx.
- **Forms and protection.** Content controls (text, check box, combo box,
  drop-down, date, picture), form fields with input formats and masks, and a
  fill-in view with roles. Documents can be protected as read-only, comments
  only, tracked changes only, or filling forms only. Read-only protection is
  enforced by the server. Custom XML data binding is supported.
- **Compare, combine and mail merge.** Compare or combine with another Grown
  doc, a saved version, or an uploaded .docx. The result opens as a new
  document with tracked changes. Mail merge reads a Grown Sheet or a CSV and
  can output a new doc (one section per record), a .docx, a PDF, or email.
- **Proofing.** A built-in spell checker (en-US and en-GB dictionaries) with
  suggestions, a personal dictionary, and a language setting for text or the
  whole document. Also added: AutoCorrect options, a floating find/replace bar
  (Ctrl+F / Ctrl+H) with highlighted matches, and cleaner paste from Word and
  Google Docs.
- **Smaller additions.** Five change-case modes. Insert Symbol, Date and time,
  Drop cap, and Text from file. Show non-printing characters, a dark document
  view, document statistics, and a shortcuts dialog that stays in sync with
  the keymap.
- **Export.** Download as PDF now happens in the browser from the page layout,
  with searchable text and working links, so the server needs no TeX
  installation. Pictures now survive .odt, .rtf, .epub and .md export.
- **Fixes.** Imported content could be lost if the document opened before
  collaboration had synced. The status bar word count now updates while you
  type. The collaboration indicator no longer gets stuck on "connecting".

### Sheets

- **Formulas.** New: references to other sheets, named ranges, whole-column
  and whole-row references (`A:A`), unions and intersections, `INDIRECT` and
  `OFFSET` across the workbook, and `;` as an argument separator. Every
  formula is recalculated on the server. Added function groups: complex
  numbers (the IM* functions), Bessel, bond and coupon, depreciation, and the
  full statistical library (distributions, T/Z/F/χ² tests, and LINEST,
  LOGEST, TREND and GROWTH with multiple regression). Many functions now
  follow Excel's argument rules more closely, including XLOOKUP, XMATCH,
  SWITCH, SUM and the logical functions.
- **Dynamic arrays.** Functions spill over arrays and ranges, and spills
  persist correctly between saves.
- **Tools.** Trace precedents and dependents with arrows, and Goal Seek.
- **Number formats.** Accounting, financial, duration and fraction presets, a
  custom format dialog, and typed-input recognition for currency, percentages,
  dates and fractions. The same engine runs in the browser and on the server.
- **Data tools.**
  - Filters: by value, condition, top 10, date period or colour.
  - Conditional formatting: every rule type, colour scales, data bars and
    icon sets, managed in a rules manager.
  - Data validation: lists, checkboxes, input and error messages, and
    "circle invalid data".
- **Editing.** Autofill and Fill Series. Multi-key sort. Paste Special
  (values, formats, transpose, arithmetic). Insert and delete cells with a
  shift. Row and column moves that update every formula. Change case, AutoSum
  over a selection, a full set of Excel shortcuts, and Ctrl/Cmd+click to add a
  reference while writing a formula.
- **Pivot tables.** Rows, columns, filters and values; eleven summary
  functions; "show values as"; calculated fields and items; and all three
  layouts. Pivots refresh when their source changes, support drill-down, and
  work with `GETPIVOTDATA`.
- **Charts.** New types: combo, histogram, waterfall and doughnut. Also
  trendlines, a secondary axis and a chart editor. Charts sit on the grid,
  move with row and column edits, and are saved to .xlsx. Sparkline groups
  are also supported.
- **Excel tables.** Insert Table (Ctrl+L) with a style gallery, a total row,
  calculated columns and structured references (`Table1[Col]`, `[@Col]`).
  `SUBTOTAL` respects filtered rows.
- **Import, export and print.** A new .xlsx reader and writer keeps styles,
  rules, tables, charts, comments, print setup and protection. Import can
  create a new spreadsheet, add sheets, or replace or append data. The print
  dialog has page setup, scaling, print areas and title rows, and can
  download a PDF. Sheet and range protection is enforced on the server.
- **Threaded comments** on cells, with a comments panel.
- **Fixes.**
  - A typed value could be erased for everyone while a collaborator was
    editing.
  - Merge and Unmerge did nothing.
  - Autosave did not fire while the editor was open.
  - The selection jumped back to A1.
  - Charts were missing after opening another spreadsheet.
- **Known limit.** .ods export does not keep number formats.

### Slides

- **Office files.** A new .pptx importer (from the File menu, the deck list or
  Drive) keeps the theme, layouts, slide size, hidden slides, backgrounds,
  tables, cropped pictures, charts (including newer Office chart types),
  comments, transitions and animations. Export was rebuilt to match. ODP
  import and export were also added.
- **Layout and design.** Theme gallery and editor, slide layouts,
  placeholders, page setup, backgrounds, skipped slides, and headers and
  footers.
- **Shapes.** 68 preset shapes with adjustment handles, connectors that stick
  to shapes, and gradient fills. Also multi-select, marquee selection,
  snapping, align and distribute, and grouping.
- **Text.** Formatting within a line of text, a Format menu, format painter,
  links (including jumps to other slides), find and replace, and special
  characters. Text boxes follow the spell-check setting.
- **Tables and media.** Table editing with merged cells and styles. Pictures
  with crop, crop to shape, opacity, borders, shadows and alt text. Charts
  built on the Sheets chart engine. Simple diagrams (list, process, cycle,
  org chart, pyramid, Venn) built from an outline. Video and audio (upload,
  YouTube or Vimeo). Word art.
- **Motion and presenting.** A Motion panel for transitions and entrance,
  emphasis and exit animations. Slideshow with keyboard control, laser
  pointer, pen, and black or white screen. Presenter view in a second window.
- **Export and print.** PDF files. Print with handouts, notes pages or
  outline. Zips of PNG, JPEG or SVG images of every slide. ODP download.
- **Collaboration.** Comments with canvas markers and @mention notifications,
  and collaborators' selections are shown. The sync server now catches up
  after reconnects and rejects stale edits instead of silently dropping
  changes.
- **Accessibility.** The editor can be used entirely from the keyboard: slide
  rail, F6 to move between panes, and a shortcuts dialog. Also accessible
  names, an outline and alt-text checker, and support for reduced motion.
- **Clipboard.** Rich copy and paste between decks and to and from Docs.

### PDF and export

- **PDF editor forms.**
  - Calculated fields: sum, product, average, min, max, or an expression.
    Scripts are evaluated safely and are never executed as JavaScript.
  - Number, percent and date formats.
  - New list box and push button fields.
  - Opening a PDF with an existing form turns its fields into editable fields.
- **Fix.** Text and drop-down fields exported from the editor were invisible
  in other viewers. They now render.
- **PDF export for Docs and Sheets** is generated in the browser. The server
  returns 501, not 500, when no PDF engine is installed and a fallback is
  requested.
- **Legacy Office import (optional).** With LibreOffice enabled, you can
  import .doc, .xls and .ppt files (plus .wpd, .dot, .xlt, .pps and .pot).
  It is off by default. See the chart README for how to enable it.
- **Fonts.** Open fonts metric-compatible with Calibri, Cambria, Arial, Times
  New Roman and Courier New are bundled, so imported Office files keep their
  layout even where those fonts aren't installed.

### Forms

- Answer validation for numbers, text, length, regex and checkbox counts,
  each with custom error messages. Validation is checked on the server too.
- Input masks: phone, ZIP code, credit card or custom.
- Multiple-choice and checkbox grid questions, and rating questions.
- Sections with branching ("go to section" and "after section").
  Required-question checks now apply only to sections the respondent actually
  saw.
- **"Limit to 1 response" is now enforced.** Before this release it was saved
  but never checked.

### Whiteboard

- **Visio import.** Import `.vsdx` drawings into a new or existing board.
  Shapes, connectors, text, masters and theme colours are kept.
- **Export** to PNG, SVG and `.excalidraw`.
- File > Version history (see Highlights).

### Drive

- **Open in Docs, Sheets and Slides** for Office and OpenDocument files.
  `.vsdx` files open in Whiteboard.
- **Fix.** Row menu submenus (Open with, Share, Organize, File information)
  closed as soon as they opened.

### Music and Radio

- **Radio cache cap.** The radio cache now has one limit for the whole
  instance (default 5 GiB and 30 days). The oldest unsaved songs are evicted
  first, and liked or playlisted songs are never evicted. The Radio view shows
  how much of the cache is used.
- **Fix.** Radio records only while someone is actually listening. Before this
  fix, closing a tab mid-stream could leave a station recording forever.
  Deleted radio files are now purged from storage.

### Workspace and Home Assistant

- **Home Assistant** is a new bring-your-own app tile, set per organization.
  Org admins set the URL in Admin > Services; personal orgs set it in
  Settings. The tile stays hidden until a URL is set. Setup guide:
  `docs/services/homeassistant.md`.
- The header app launchers (hamburger menu and 9-dot grid) now use the same
  service settings as the dashboard.

### Platform and self-hosting

- **Helm chart 0.2.0: rustfs replaces MinIO.** MinIO images can no longer be
  pulled, so fresh installs and rescheduled pods failed. The chart now runs
  rustfs, with generated credentials and an idempotent bucket-setup step
  (AWS CLI). An optional one-time `migrateFromMinio` Job copies and verifies
  your data. Chart 0.1.8 already moved bucket setup off the unpullable
  `minio/mc` image.
- **Helm chart 0.3.0: optional Home Assistant.** Off by default. Set
  `homeAssistant.enabled`. When it is on, its URL becomes the default tile URL
  for orgs that haven't set their own.
- **Radio cache settings:** `GROWN_RADIO_CACHE_MAX_BYTES` and
  `GROWN_RADIO_CACHE_MAX_DAYS`, or in Helm `music.radioCache.maxBytes` and
  `music.radioCache.maxDays`. Set 0 for no limit.
- **LibreOffice settings:** `GROWN_LIBREOFFICE=1` (plus `_TIMEOUT`,
  `_MAX_BYTES` and `_CONCURRENCY`), or Helm `grown.libreoffice.*`. This needs
  an image with LibreOffice; the `Dockerfile` ends with a recipe for building
  one.
- **pandoc 3.10.** The production image ships the upstream static pandoc 3.10,
  pinned by checksum. Alpine's older pandoc lost ODT table headers and code
  blocks, and it had the sandbox problem described under Security.
- **Local stack.** `deploy/local/stack.sh` runs Postgres, Zitadel and rustfs in
  Docker, with the backend and frontend running natively, so no Nix is
  needed. `GROWN_PORT` starts extra backends alongside the one on :8080.
- **Documentation site** published to GitHub Pages. The canonical source is
  code.pick.haus, and GitHub is a mirror.

### Security

- **Document import sandbox escape (fixed).** Uploaded HTML, Markdown or text
  files could make the server read local files or fetch URLs during
  conversion. Import and export now run pandoc in its sandbox. Import only
  embeds pictures packed inside the uploaded file. The pandoc bundled with
  the image enforces the sandbox. Everyone should upgrade.
- **Imported content is sanitized.** Scripts, raw HTML, event handlers and
  `javascript:` links are removed from imported documents.
- **Access checks.**
  - Doc comments now use the same access check as opening the document.
    Users from other organizations with a share grant can read comments, and
    viewer-only grants can no longer add them.
  - The Docs protection endpoint now uses that same check.
  - Viewer and commenter grants are read-only on the whiteboard
    collaboration socket.
  - Read-only viewers can no longer fake "version restored" messages, which
    made other editors reload and lose unsaved work.
  - Restoring a sheet version can no longer get around protected ranges.
- **Less leakage in error responses.** Malformed form IDs return 404 instead
  of a 500 that exposed database errors. Oversized or unreadable Docs imports
  return 413 or 422 with a generic message, instead of the converter's
  output.
- New automated access tests cover Docs, Sheets, Slides, Whiteboards, Forms
  and version history, plus an end-to-end test with a second signed-in user.

### Developer and testing

- **Parity scoreboard.** `npm run parity` in `web/app` counts the tagged
  OnlyOffice-parity tests. CI runs it with `--check` against `baseline.json`
  and fails if the count drops.
- **New CI jobs:**
  - a `go-db` job runs the database-backed Go tests against Postgres;
  - the `go` job installs the same pandoc as production, so conversion
    tests run instead of being skipped.
- **Test suites.** Large new unit suites for Docs (a headless editor test
  harness), Sheets (shared test data for the Go engine and the browser) and
  Slides. Many new Playwright end-to-end specs cover collaboration between two
  browser contexts, restoring versions, and round trips through .docx, .xlsx
  and .pptx.
- **Code style.** `.editorconfig`, plus a check for LF line endings and a
  final newline.

### Upgrading

**Helm chart 0.1.x to 0.3.0 (required steps).** The bundled object store
changes from MinIO to rustfs. rustfs starts empty, and your data is copied
over by a Job. The full guide is in
[`deploy/helm/grown/README.md`, "Upgrading from 0.1.x (MinIO) to 0.2.0 (rustfs)"](deploy/helm/grown/README.md#upgrading-from-01x-minio-to-020-rustfs).
In short:

1. **Upgrade with MinIO kept and the migration on:** set
   `minio.enabled: true` and `migrateFromMinio.enabled: true`.
   - The MinIO pod does not restart.
   - Budget storage for both volumes during the copy.
   - With Flux, raise the timeout or set `upgrade.disableWaitForJobs: true`.
   - To avoid a window where old files read as missing, scale grown to 0
     until the Job finishes.
2. **Wait for the copy Job.** `<release>-migrate-from-minio` finishes with
   `MIGRATION COMPLETE: all buckets verified`. To re-run it, delete the Job and
   upgrade again.
3. **Verify.** Open a few older files (Drive, Photos, a signed PDF) and upload
   a new one.
4. **Retire MinIO:** set `minio.enabled: false`, `minio.allowRemoval: true`
   and `migrateFromMinio.enabled: false`. The MinIO volume is never deleted by
   the chart; delete it yourself when you're confident.

If you only bump the chart version while MinIO is still running, the upgrade
fails on purpose until you set `minio.allowRemoval`. Old values
(`minio.bucket`, `minio.persistence.size`, `minio.external.*`, and the
MinIO keys) still work as fallbacks.

**Other changes in behaviour:**

- **Database migrations 0095 to 0097** (version history, Docs protection, and
  Forms' one-response limit) run automatically when the server starts.
- **Header launchers** now hide services the org has disabled and use the
  org's URL overrides, matching the dashboard.
- **Radio:**
  - The new cache cap (5 GiB / 30 days by default) may evict older unsaved
    songs soon after you upgrade.
  - New stations keep songs for 14 days.
  - "Keep forever" is now "Keep until cache is full".
- **Forms with "Limit to 1 response"** now require sign-in and reject a second
  submission with HTTP 409.
- **Whiteboard viewer and commenter grants** can no longer edit boards.
- **Docs import/convert** now returns 413 for bodies over 16 MiB instead of
  quietly truncating them. Imports no longer fetch pictures referenced by
  server paths or URLs.
- **.docx files** are now imported and exported by the browser, falling back
  to the server's pandoc route if that fails. **PDF export** from Docs and
  Sheets happens in the browser.
- **LibreOffice import is off by default.** Legacy formats are offered only
  when the server is configured for it.
