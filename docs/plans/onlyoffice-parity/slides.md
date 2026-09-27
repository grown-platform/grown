# OnlyOffice parity plan — Slides

Status: plan (2026-09-26); M0–M6 landed — see the status notes in §6.4–6.10.

Scope: the OnlyOffice **presentation editor** (`sdkjs/slide`, the shared drawing
engine in `sdkjs/common`, and the `web-apps/apps/presentationeditor` UI) versus
Grown Slides (`web/app/src/pages/slides`, `internal/slides`).

Ground rules (from `research/onlyoffice/README.md` and the user):

- OnlyOffice is AGPL-3.0; Grown is MIT. **Nothing from `research/onlyoffice/` is
  copied into the tracked tree** — not engine code, not test files, not fixtures.
  Tests are re-expressed as *behaviour* (inputs → expected outputs) in Grown's own
  vitest (`web/app`) and Playwright (`web/e2e`) harnesses.
- **Additive only.** This plan improves what Grown Slides already has. It does
  not replace the DOM/CSS renderer, the JSON deck model, the op-broadcast collab
  hub, or the pptxgenjs exporter. Where a gap genuinely cannot be closed without
  a large refactor, it is listed under *Flagged exceptions* with a justification
  and a smaller additive alternative, instead of being made part of the plan.

Companion file: `slides-tests.csv` (one row per OnlyOffice test suite/file).

---

## 1. How Grown Slides works today

### 1.1 Data model — `web/app/src/pages/slides/model.ts` (294 lines)

- `DeckDoc { slides: Slide[] }` → `Slide { id, background, elements[], notes?, transition? }`
  → `SlideElement { id, type, x, y, w, h, …props }` on a fixed logical canvas of
  `CANVAS_W × CANVAS_H = 960 × 540` (16:9). All coordinates are logical px; every
  renderer scales with a CSS `transform: scale()`.
- 10 element types: `text | rect | ellipse | image | line | triangle | diamond |
  rightArrow | roundRect | table`. `SHAPE_TYPES` = the six fill/stroke shapes.
  Non-box shapes are drawn with a CSS `clip-path: polygon(...)` (`shapeClipPath`).
- Per-element props are *whole-element* (no runs): `text, fontSize, fontFamily,
  bold, italic, underline, strike, list ('bullet'|'number'), lineSpacing, color,
  align, valign, fill, stroke, strokeWidth, src, table {rows, cols, cells[][]},
  url, rotation, flipH, flipV, animation {type, order}`.
- Slide-level: `notes` (speaker notes), `transition` (5 types: none, fade,
  slide-left, slide-right, slide-up). Element entrance animations: 4 types
  (appear, fade-in, fly-in-bottom, fly-in-left) with a 1-based click `order`.
- Helpers: `newSlide`, `titleSlide`, `defaultDeck`, `newElement(type)`, `newTable`,
  `elementTransform`, `parseDeck` (tolerant JSON parse with fallback), `uid`.
- Deck templates: `templates.ts` (240 lines) builds whole decks from `txt()`/`rect()`.
- Persistence: the deck is a JSON string in `Deck.data`
  (`proto/grown/v1/slides.proto:89-98`); `web/app/src/pages/slides/types.ts` mirrors it.

### 1.2 Rendering — DOM/CSS, two renderers

- **Editor canvas** `SlideCanvas.tsx` (279 lines): absolutely positioned `<div>`
  per element inside a `960×540` box scaled to the stage width. Pointer-capture
  move; 8-handle resize (2 handles for `line`); double-click → `contentEditable`
  in-place text editing (commits `innerText` on blur); right-click → context menu
  callback; single selection only (`selectedId`).
- **Read-only view** `SlideView.tsx` (347 lines): same element styles
  (`elementStyle`) for thumbnails and present mode. Adds `revealedIds` (elements
  with an animation are hidden until revealed, then play a CSS keyframe from
  `ELEMENT_ANIM_CSS`), `linkable` (elements with `url` become `<a>`),
  `renderSlideText` (bullet/number prefixes per line), `SlideTable`
  (contentEditable cells when `onCellChange` is passed).
- **Editor shell** `DeckEditor.tsx` (1,798 lines): title, `SlideMenuBar`, toolbar
  (insert text/image/rect/ellipse/line + "more shapes", B/I/U, align L/C/R, font
  size, text/fill color), thumbnail rail (click, new, copy, delete, up/down),
  stage with `ResizeObserver` fit, speaker-notes panel, context menu (cut/copy/
  paste/duplicate/order/delete, or paste/new text/insert image/new slide/
  background), Transition modal (Select), Animations modal (per-element type +
  order), `ShareDialog`, image paste-from-clipboard, file-picker image insert.
- **Present mode** `PresentView` (inside `DeckEditor.tsx`): full-screen black
  stage, click/keys to advance, per-slide transition keyframes (`TRANSITION_CSS`),
  animation steps (`animStep` over sorted unique `order`s), presenter view (S) with
  elapsed timer, current + next slide, notes; hyperlinks clickable.
- **Menus** `SlideMenuBar.tsx` (504 lines): File/Edit/View/Insert/Format/Slide/
  Arrange/Tools/Extensions/Help mirroring `docs/google-reference/slides/editor.md`.
  Roughly 70 items are `disabled` stubs (see §2 for the per-item mapping).
- **Undo/redo**: JSON snapshots of the whole deck (`hist.past/future`, 50 deep,
  400 ms coalescing) in `DeckEditor.tsx`.
- Route: `/slides` (list) and `/slides/d/:id` (editor) via `pages/slides/index.tsx`.
  The Drive file-open route `/slides/:id` is still `EditorPlaceholder`
  (`web/app/src/App.tsx:525-528`).

### 1.3 Collaboration — op broadcast, not CRDT

- `internal/slides/collab.go` (144 lines): a stateless WebSocket **broadcast hub**
  keyed by deck id. It relays whatever the client sends to the other peers,
  drops deck-mutating ops from read-only grantees (`canWrite=false`), and always
  relays `{"t":"presence"}`.
- Client ops (`DeckEditor.tsx`): `upsert {si, el}`, `remove {si, elId}`,
  `slides {slides}` (whole-deck replace — used by slide add/move/delete/reorder,
  arrange, background, notes, undo/redo), `presence {p}` (user, colour, slideIdx,
  4 s heartbeat, 12 s prune).
- Durability: debounced (1.2 s) `PUT /api/v1/slides/d/{id}/data` with the full
  JSON; late joiners load via `GET`. There is **no server-side merge**; concurrent
  `slides` ops are last-writer-wins for the whole deck. (Note:
  `docs/TODO-feature-gaps.md:159` says "Yjs collab" for slides — that is
  inaccurate; only Docs uses Yjs.)
- ACL: per-user grants (`GrantAccess/ListGrants/RevokeAccess`, "shared with me",
  cross-org reads) in `internal/slides/service.go` + `sharing` repo.

### 1.4 Export — `web/app/src/pages/slides/export.ts` (431 lines)

- Formats (`DECK_DOWNLOAD_FORMATS`): `pptx` (pptxgenjs, lazy-loaded chunk), `pdf`
  (opens a print window with `fullHTML` and calls `print()` — user "Save as PDF"),
  `txt` (text + notes), `html` (absolutely positioned HTML, one page per slide),
  `jpg | png | svg` (current slide; `slideToSVG` → offscreen canvas rasterize).
- pptx mapping: 10 in × 5.625 in layout; text (`addText` with size/bold/italic/
  underline/color/align/valign/font), six shapes (`addShape` with matching
  pptxgenjs `ShapeType` names), line, image (data: or path), notes. **Not
  exported to pptx today**: tables, rotation, flipH/flipV, strike, bullets,
  lineSpacing, hyperlinks, element animations, transitions, `roundRect` radius
  adjust. (pptxgenjs supports most of these natively — see M1.)
- No import of any format. No ODP.
- *Update (Wave 2, M1):* pptx export and import landed. See §6.5.

### 1.5 Backend — `internal/slides/`

`service.go` (311), `repository.go` (181), `collab.go` (144). Deck CRUD
(list/create/get/rename/save-data/trash), grants, shared-with-me. Model is opaque
JSON to the server (no validation beyond `model_test.go` round-trips).

### 1.6 Tests today

- **Go** (24 test funcs, 6 files): `collab_unit_test.go` (7: presence detection,
  room lifecycle, broadcast fan-out semantics), `service_auth_test.go` (5),
  `model_test.go` (5: notes/transition/animation JSON round-trips, DB round-trip),
  `mapping_test.go` (4), `repository_test.go` (2), `grants_test.go` (1).
- **vitest** (`web/app`, jsdom, `src/test-setup.ts` = jest-dom): **zero** tests
  under `web/app/src/pages/slides/`. (Sheets has `sheetOps.test.ts`,
  `chartData.test.ts`, `pivotData.test.ts`, `iconSets.test.ts` — the convention is
  colocated `*.test.ts` next to pure-function modules.)
- **Playwright** (`web/e2e`): no `slides.spec.ts`. Slides is only touched by
  `nav.spec.ts` (route mounts) and `api.spec.ts` (`GET /api/v1/slides` is 200).
  `docs.spec.ts`/`sheets.spec.ts` show the house style: create fixture via JSON
  API in `helpers.ts`, drive UI, reload, assert persistence, trash in `finally`.

---

## 2. Feature inventory — OnlyOffice presentation editor vs Grown

Legend: **Have** / **Partial** / **Missing**. OnlyOffice references are file paths
under `research/onlyoffice/` (read-only, never copied). Grown references are
tracked paths. UI-string counts come from
`web-apps/apps/presentationeditor/main/locale/en.json` (3,707 strings total).

### 2.1 Layouts, masters, themes

OnlyOffice: `sdkjs/slide/Editor/Format/SlideMaster.js` (1,539 lines),
`Layout.js` (1,506), `NotesMaster.js`, `Presentation.js` (11,850; `sldSz` slide
size, `CPrSection` sections, `notesMasters`), 16 placeholder types
(`phType_title/body/ctrTitle/subTitle/pic/tbl/chart/dgm/dt/ftr/sldNum/hdr/media/obj/clipArt/sldImg`),
Slide Master tab UI (`view/SlideMasterTab.js`, 26 strings: add master/layout,
insert placeholder ×9 kinds), theme picker + colour schemes
(`Toolbar.tipSlideTheme`, `tipColorSchemas`), `SlideSizeSettings` (20 strings:
4:3, 16:9, A4, Letter, custom, orientation, "number slides from"),
`HeaderFooterDialog` (18 strings: date/time fixed/auto, slide number, footer,
"don't show on title slide").

| Feature | Grown | Where |
| --- | --- | --- |
| Theme (fonts + colour scheme) | Missing | menu stubs `SlideMenuBar.tsx` "Edit theme", "Change theme", "Theme builder" |
| Slide layouts / Apply layout | Missing | `SlideMenuBar.tsx` "Apply layout" disabled; only `titleSlide()` in `model.ts` |
| Slide master editing / placeholders | Missing | — |
| Deck templates (whole decks) | Have | `templates.ts`, `DeckList.tsx` |
| Slide size / page setup | Missing (fixed 960×540) | `model.ts` `CANVAS_W/H`; "Page setup" disabled |
| Slide numbers / footer / date | Missing | "Slide numbers" disabled |
| Background colour | Have (hex prompt) | `DeckEditor.tsx setBackground` |
| Background image / gradient / pattern | Missing | OO `SlideSettings` (47 strings) |
| Skip (hide) slide | Missing | OO `Slide.show`; Grown "Skip slide" disabled |
| Sections | Missing | OO `CPrSection` |
| Notes master / handouts | Missing | — |

### 2.2 Text boxes and text formatting

OnlyOffice: paragraph/run model (`sdkjs/common/Drawings/Format/TextBody.js`,
`TextDrawer.js` 2,816), `ParagraphSettings(Advanced)`, `Toolbar` (539 strings:
font, size ±, B/I/U/S, super/sub, change case ×5, font/highlight colour, H/V
align, bullets ×8 styles, numbering, indent ±, line spacing, columns ×3, text
direction LTR/RTL, clear style, copy style), `SymbolTableDialog` (27),
`TextArtSettings` (45; 40 `text*` warp presets in `CreateGeometry.js`),
autocorrect, spell-check, find/replace (`SearchPanel` 21).

| Feature | Grown | Where |
| --- | --- | --- |
| Insert text box | Have | `DeckEditor.tsx insert("text")` |
| Draw-to-insert (drag a box) | Missing | elements spawn at a fixed spot (`newElement`) |
| Font family / size / colour | Have (whole element) | `FONT_FAMILIES`, toolbar in `DeckEditor.tsx` |
| Bold / italic / underline / strike | Have (whole element) | `toggle()` |
| Mixed formatting within one box (runs) | Missing | model has one style per element — see Flagged exception F1 |
| Superscript / subscript | Missing | — |
| Align L/C/R | Have | `setAlign` |
| Justify | Missing | — |
| Vertical align top/middle/bottom | Have (model) / Partial (no UI) | `valign` in `model.ts`; no toolbar control |
| Bulleted / numbered list | Have (single level, 1 style each) | `list`, `renderSlideText` |
| List levels / indent ± / bullet styles | Missing | — |
| Line spacing 1/1.5/2 | Have | `setLineSpacing` |
| Paragraph before/after spacing | Missing | — |
| Increase/decrease font size step | Missing | OO ladder 10→11→12→14→16 (`shortcuts.js` "text property change") |
| Change case | Missing | — |
| Text direction RTL | Missing | — |
| Columns in text box | Missing | — |
| Clear formatting | Missing | menu disabled |
| Paint format (copy/paste style) | Missing | — |
| Find and replace | Missing | menu disabled |
| Special characters / symbols | Missing | menu disabled |
| Word art / text warp | Missing | menu disabled — see F5 |
| Text insets / padding | Partial (fixed 4 px) | `elementStyle` padding |
| Autofit / shrink text on overflow | Missing | `overflow: hidden` |
| Spell check | Missing | Tools menu stubs |

### 2.3 Shapes and preset geometry

OnlyOffice: `sdkjs/common/Drawings/Format/CreateGeometry.js` (10,397 lines) builds
**227 presets** (187 shapes + 40 `text*` warps) by evaluating ECMA-376 adjust
values, guides, paths, handles and connection sites; `Geometry.js` (2,020)
evaluates them; `Shape.js` (7,749). `ShapeSettings` (72 strings): fill
none/colour/gradient (linear/radial, stop editor)/picture-or-texture/pattern,
opacity, line (colour/width/style/no line), shadow (9 offsets, adjust), change
shape, edit points, rotation, flip, eyedropper. Toolbar: merge shapes (union/
combine/fragment/intersect/subtract via `path-boolean.js`). Connectors
(`CnxShape.js`): straight/bent/curved ×2-5 with connection sites.

| Feature | Grown | Where |
| --- | --- | --- |
| Rect, roundRect, ellipse, triangle, diamond, rightArrow | Have | `model.ts` `SHAPE_TYPES`, `shapeClipPath` |
| Other presets (~180: arrows, callouts, flowchart, stars, math, action buttons…) | Partial (68 presets, M3) | `presetDefs.ts`, `presetGeometry.ts` |
| Straight line | Have (horizontal only, `h:0`) | `newElement("line")` |
| Diagonal lines, arrows, elbow/curved connectors, polyline/scribble | Have except polyline/scribble (M3) | `type: "connector"`, `connectorOps.ts` |
| Solid fill / stroke colour / stroke width | Have | `fill/stroke/strokeWidth` |
| No fill / no line | Have | `"none"` sentinel |
| Gradient fill, picture/texture fill, pattern | Missing | — |
| Opacity / transparency | Missing | — |
| Dash style, line caps/arrowheads | Have (M3; caps fixed) | `dash`, `headEnd`/`tailEnd` |
| Shadow / reflection | Missing | "Format options" disabled |
| Rotation (90° steps + arbitrary) | Have (model) / Partial (UI is 90° only) | `rotate()` |
| Flip H/V | Have | `rotate("flipH")` |
| Adjust handles (e.g. roundRect radius) | Have for presets (M3) | `solveHandle`; legacy roundRect stays 18% |
| Edit points / merge shapes | Missing | — see F4 |
| Change shape type | Missing | — |
| Shape name / alt text | Missing | OO `SetName/GetName` (`api-drawing.js`) |

### 2.4 Images and crop

OnlyOffice: `Image.js` (1,094), `ImageSettings` (26 strings): crop (free, fill,
fit, crop-to-shape ×227 presets), replace (file/URL/storage), actual size, fit
to slide, rotate/flip, opacity, edit object (plugins).

| Feature | Grown | Where |
| --- | --- | --- |
| Insert image from file / clipboard paste | Have | `onImagePicked`, paste handler in `DeckEditor.tsx` |
| Insert by URL | Missing | — |
| Crop / crop to shape / reset crop | Missing | Format → Image disabled |
| Replace image | Missing | — |
| Alt text | Missing | context "Alt text" absent |
| Opacity / recolour | Missing | — |
| Aspect-ratio-locked resize (Shift) | Missing | `SlideCanvas.tsx` resize is free |
| Image storage | Partial (data: URLs inline in deck JSON) | bloats `Deck.data`; no Drive/asset store |

### 2.5 Tables

OnlyOffice: `GraphicFrame.js` (1,381) wrapping the Word table engine;
`TableSettings` (58 strings: templates/styles grid, header/first/last/banded
rows-cols, border picker ×10, cell size, distribute rows/cols),
`TableSettingsAdvanced` (26); keyboard nav (Tab/Shift+Tab, arrows, Enter in
cell) covered by `shortcuts.js` "main actions with shapes".

| Feature | Grown | Where |
| --- | --- | --- |
| Insert table (3×3 only) | Have | `newTable(3,3)` |
| Size picker (r×c) | Missing | menu says "Table (3×3)" |
| Edit cell text | Have | `SlideTable` contentEditable |
| Insert/delete rows/cols | Missing | Format → Table disabled |
| Merge / split cells | Missing | — |
| Borders, cell fill, table styles | Partial (one border colour, one fill) | `elementHTML` table branch |
| Column widths / row heights | Missing (uniform) | — |
| Keyboard nav Tab/arrows between cells | Missing | — |
| Table in pptx export | Missing | `export.ts` skips `table` |

### 2.6 Charts

OnlyOffice: `ChartSpace.js` (14,408), `ChartFormat.js` (20,177),
`ChartsDrawer.js` (20,958), `ChartEx.js` (chartEx: waterfall/funnel/treemap…),
45 chart-type strings (`chartData`), `ChartSettings(Advanced)` (28/92), data
editor via embedded spreadsheet editor, 3-D rotation dialog, trendlines,
error bars, axes/gridlines/legend/data labels context menus.

| Feature | Grown | Where |
| --- | --- | --- |
| Insert chart (bar/column/line/pie) | Missing | menu disabled; Sheets has `pages/sheets/chartData.ts` reusable |
| Edit chart data | Missing | — |
| Chart from Sheets (linked) | Missing | — |

### 2.7 SmartArt / diagrams

OnlyOffice: `sdkjs/common/SmartArts/` (`SmartArtTree.js` 8,441; 151 layout data
files under `SmartArtData/`; 159 named layouts in the UI).

| Feature | Grown | Where |
| --- | --- | --- |
| Diagram insert (grid/hierarchy/timeline/process/relationship/cycle) | Missing | menu disabled — see M11 (template-based, additive) |
| Full SmartArt layout engine | Missing | — see F6 |

### 2.8 Grouping, align, distribute, z-order

OnlyOffice: `GroupShape.js` (1,813), `CommonController.js` (12,345: multi-select,
marquee, group/ungroup, align ×6 to slide or to selection, distribute H/V,
arrange ×4, nudge 1/5 units, Tab cycling, smart guides/snap, rulers/gridlines).

| Feature | Grown | Where |
| --- | --- | --- |
| Bring to front/forward/backward/back | Have (also for a multi-selection, M2) | `arrangeMany()` |
| Multi-select (Shift+click, marquee) | Have (M2) | `selection.ts`, `geometry.marqueeSelect` |
| Group / ungroup | Have (M2), round-trips as `p:grpSp` | `groupOps.ts` |
| Align L/C/R/T/M/B | Have (M2), to selection or slide | `alignElements()` |
| Distribute H/V | Have (M2) | `distributeElements()` |
| Center on page H/V | Have (M2) | `centerOnPage()` |
| Arrow-key nudge (2 px / Shift 10 px) | Have | keyboard handler in `DeckEditor.tsx` |
| Tab / Shift+Tab select next/prev object | Have (M2) | `cycleSelection()` |
| Guides / snap to grid / smart guides | Have (M2): smart guides + grid; no user-placed guides | `geometry.snapMove/snapResize` |
| Rulers / gridlines / zoom levels | Missing | View → Zoom disabled; stage auto-fits |
| Duplicate element (Ctrl+D) | Have | `duplicateEl` |
| Cut/copy/paste element (in-app clipboard) | Have (multi-element; internal JSON on the OS clipboard, M2) | `clipboard.ts` |
| System clipboard interop (paste text/HTML/image) | Have (M2): image → picture, text/HTML → text box | paste handler |

### 2.9 Transitions

OnlyOffice: `Transitions.js` (5,599) + `TransitionsGL.js` (2,970) +
`MorphTransition.js` (2,061). 21 types (`c_oAscSlideTransitionTypes`: None, Fade,
Push, Wipe, Split, UnCover, Cover, Clock, Zoom, Morph, Random, Cut, Blinds,
Checker, Comb, Circle, Diamond, Dissolve, Plus, RandomBar, BoxZoom) × 37 param
constants (directions, in/out, clockwise…), duration, delay, start-on-click,
advance-after-N-s, apply-to-all, preview (`Transitions` view: 75 strings).

| Feature | Grown | Where |
| --- | --- | --- |
| 5 transitions (none/fade/from R/L/B) | Have | `TRANSITIONS`, `TRANSITION_CSS` |
| Push/wipe/split/cover/uncover/zoom/box/cut/dissolve… with directions | Missing | — |
| Duration / delay / auto-advance | Missing (fixed 350 ms) | `transitionAnimation` |
| Apply to all slides | Missing | — |
| Preview in editor | Missing | — |
| Morph / 3-D GL transitions | Missing | — see F7 |

### 2.10 Animations

OnlyOffice: `Timing.js` (15,113) implements the OOXML `<p:timing>` tree
(sequences, triggers, nodes), `anim-pane.js` (3,203). UI (`Animation` 31 strings
+ 199 effect strings): entrance/exit/emphasis/motion-path catalogues, start
On Click / With Previous / After Previous, duration presets (0.5–20 s), delay,
repeat, rewind, trigger "On click of", move earlier/later, animation pane.

| Feature | Grown | Where |
| --- | --- | --- |
| 4 entrance types with click order | Have | `ANIMATION_TYPES`, Animations modal, `revealedIds` |
| Exit / emphasis effects | Missing | — |
| Start with/after previous, duration, delay | Missing | fixed durations in `ELEMENT_ANIM_CSS` |
| Directions (from top/left/right…) | Partial (bottom/left only) | — |
| Animation pane (reorder, preview) | Partial (order number input) | Animations modal |
| Motion paths | Missing | — see F8 |
| Text-by-paragraph animation | Missing | — |

### 2.11 Slideshow / presenter view

OnlyOffice: `DemonstrationManager` (mocked by `tests/slide/common/demonstrationManager.js`),
`SlideShowAnnotations.js` (310: pen ink during show), `SlideshowSettings`
(loop until Esc), Statusbar "Show from beginning / from current / presenter
view", shortcuts (`c_oAscPresentationShortcutType.Demonstration*`: next/prev/
first/last, number+Enter, Esc), hyperlink `ppaction://hlinkshowjump?jump=
firstslide|lastslide|nextslide|previousslide`.

| Feature | Grown | Where |
| --- | --- | --- |
| Start slideshow (current slide) | Have | `present()` |
| Start from beginning | Missing | always current `cur` |
| Next/prev/Esc, click to advance | Have | `PresentView` |
| Home/End, number+Enter go-to | Missing | — |
| Loop, blackout (B), pointer/laser | Missing | — |
| Pen / highlighter annotations | Missing | — |
| Presenter view (notes, next, timer) | Have | `PresentView presenter` |
| Separate audience window | Missing | presenter view replaces the stage |
| Hidden (skipped) slides excluded | Missing | — |
| Internal slide links (first/last/next/prev/slide N) | Missing (URL only) | `url` |

### 2.12 Speaker notes

| Feature | Grown | Where |
| --- | --- | --- |
| Notes panel + presenter view + txt export | Have | `setNotes`, `PresentView`, `export.ts` |
| Rich notes / notes master | Missing | plain string |

### 2.13 Comments

OnlyOffice: `sdkjs/slide/Editor/Format/Comments.js` (1,198), UI `Comments` (33)
+ `ReviewPopover` (15): slide-anchored comments with threads, resolve, mentions.

| Feature | Grown | Where |
| --- | --- | --- |
| Comments | Missing | Insert → Comment disabled; Docs has a comments implementation to mirror |

### 2.14 Collaboration

OnlyOffice: `CollaborativeEditing.js` (per-object locks, fast/strict modes),
chat, version history, "show others' changes".

| Feature | Grown | Where |
| --- | --- | --- |
| Live ops + presence avatars/dots per slide | Have | `collab.go`, `DeckEditor.tsx` |
| Concurrent edit safety | Partial (element-level LWW; whole-deck `slides` op clobbers) | — see M10 / F2 |
| Object locks / "being edited by" hint | Missing | — |
| Version history | Missing | menu disabled |
| Read-only viewer role enforcement | Have (server drops ops) | `collab.go Serve(canWrite)` |

### 2.15 Hyperlinks

| Feature | Grown | Where |
| --- | --- | --- |
| Element-level URL link | Have | `setLink` (prompt) |
| Text-range link | Missing | needs runs (F1) |
| Link to slide (first/last/next/prev/N) | Missing | OO `HyperlinkSettingsDialog` (21 strings) |
| Tooltip / display text | Missing | — |
| URL validation (http/ftp/mailto/unsafe) | Missing | OO `asc_getUrlType` (`tests/common/api/api.js`) |

### 2.16 Audio / video

| Feature | Grown | Where |
| --- | --- | --- |
| Video / audio embed | Missing | menu disabled; OO `capInsertVideo/Audio` |

### 2.17 Import / export

OnlyOffice: conversion is server-side C++ (`core/X2tConverter`, `core/OOXML`,
`core/OdfFile`) — pptx/ppsx/potx/ppt/odp/otp/pdf/images; the JS side has
`fromToJSON.js` (3,880) for a JSON mirror of the OOXML model.

| Feature | Grown | Where |
| --- | --- | --- |
| Export pptx | Have (M1). Animations are not exported | `pptx/write.ts` |
| Export pdf | Partial (browser print dialog) | `export.ts` |
| Export txt / html / jpg / png / svg | Have | `export.ts` |
| Export odp | Missing | comment in `export.ts` |
| Import pptx / Import slides | Have (M1). All slides are appended; there is no slide picker | `pptx/read.ts`, File ▸ Import slides, Slides home ▸ Upload .pptx |
| Open from Drive (`/slides/:id`) | Partial (M1). "Open in Slides" makes an editable copy of a .pptx | `EditorPlaceholder.tsx` |

### 2.18 Print

| Feature | Grown | Where |
| --- | --- | --- |
| Print (via pdf path) | Have | `actions.print` |
| Print preview / handouts (N per page) / notes pages | Missing | OO `PrintWithPreview` (28 strings) |

### 2.19 Shortcuts

OnlyOffice: `sdkjs/slide/Editor/Shortcuts.js`, 92 named shortcut types in
`sdkjs/slide/apiDefines.js:708` (`c_oAscPresentationShortcutType`), plus
hotkeys enumerated by `tests/slide/shortcuts/events.js` (97 descriptors);
UI `Shortcuts` (256 strings, `ShortcutsEditDialog` customisation).

| Feature | Grown | Where |
| --- | --- | --- |
| Delete/Backspace, Ctrl+M, arrows nudge, Esc (present) | Have | `DeckEditor.tsx` onKey |
| Ctrl+B/I/U, Ctrl+Z/Y, Ctrl+D, Ctrl+K, Ctrl+P, Ctrl+F5 | Missing as keys (menu labels only) | `SlideMenuBar.tsx kbd()` |
| Ctrl+A, Ctrl+X/C/V system clipboard, Ctrl+G group, Tab cycle, Ctrl+Enter next placeholder, Ctrl+Shift+C/V paint, Ctrl+Space clear, Ctrl+Shift+>/< size, Page Up/Down, Home/End slides | Missing | — |
| Keyboard-shortcuts dialog | Partial (`window.alert` list) | Help menu |

---

## 3. Test inventory — OnlyOffice suites in scope

All counts are from grepping `research/onlyoffice/sdkjs-tests-v9.3.1/tests/`
(`QUnit.test(` = test functions; `assert.` = assertion sites).

### 3.1 `tests/slide/`

| File | Lines | Tests | Asserts | What it covers | Portability |
| --- | ---: | ---: | ---: | --- | --- |
| `shortcuts/shortcuts.js` | 1,237 | 23 | 116 | Keyboard behaviour end-to-end (see 3.3) | High |
| `shortcuts/events.js` | 486 | 0 | 0 | Fixture: 97 hotkey descriptors (`mainShortcutTypes` 41-264, `demonstrationTypes` 265-298, `thumbnailsTypes` 299+) — key code + modifiers per action | High as a key-map table |
| `shortcuts/shortcuts.html` | — | 0 | 0 | QUnit harness page | N/A |
| `js-api/api-drawing.js` | 298 | 10 | 48 | Shape create w/ solid + radial gradient fill; `SetOutLine` (width 25400 EMU = 2 pt, colour, rejects null/{}); `GetName`/`SetName` (empty/null/undefined → false; duplicate name renames the earlier shape); `Select`/`Unselect`; `GetFlipH/V`, `SetFlipH/V` (non-bool → false) | High |
| `js-api/api-presentation.js` | 73 | 1 | 3 | `GetDrawingsByName([...])` filters by name | High |
| `js-api/api-shape.js` | 74 | 1 | 5 | `SetPaddings(l,t,r,b)` in EMU → body insets in mm (4/2/3/5) | Medium |
| `js-api/common.js`, `js-api.html` | 78 | 0 | 0 | Harness | N/A |
| `copypaste/copy-paste-tests.js` | 73 | 3 | 6 | `asc_PasteData` callback fires for Text / HtmlElement / Internal formats (negative-only; their own TODO says positive cases are missing) | Medium |
| `copypaste/copy-paste-tests.html` | — | 0 | 0 | Harness | N/A |
| `common/common.js` (73), `demonstrationManager.js` (57), `editor.js` (158), `measurer.js` (169), `presentation.js` (90), `thumbnails.js` (55) | 602 | 0 | 0 | Mocks of editor/drawing-document/thumbnails/demo manager; `demonstrationManager.js` documents the slideshow API surface (Start/Next/Prev/GoToSlide/End) | N/A (informative) |

Slide-scope total: **38 test functions, 178 assertion sites**.

### 3.2 `tests/common/` (drawing-related)

| File | Lines | Tests | Asserts | What it covers | Portability |
| --- | ---: | ---: | ---: | --- | --- |
| `color-mods/color-mods.js` | 20,310 | 28 | 4 (in a shared helper, applied per case) | ECMA-376 colour transforms on RGB: identity, `satMod/satOff`, `lumMod/lumOff`, `hueMod/hueOff`, `tint`, `shade`, `gamma/invGamma`, `comp`, `inv`, `gray`, `red/green/blue` + `*Mod/*Off`, `alpha/alphaMod/alphaOff`, plus combined mods. 9,886 `test(rgb, [mods], expectedRgb)` data rows + 51 array-literal combos ≈ **9,937 cases** | High (pure maths; spec-defined) |
| `color-mods/color-mods.html` | — | 0 | 0 | Harness | N/A |
| `api/api.js` | 148 | 2 | 2 | `asc_getUrlType` classifies URL strings as Http / Unsafe / Invalid (table-driven; browser vs desktop variants) | High |
| `api/api.html` | — | 0 | 0 | Harness | N/A |
| `charts/chartEx-serialize.js` | 660 | 3 active (+3 commented out) | 11 | Serialize/parse round-trip of `<cx:chartSpace>` (chartEx: waterfall/funnel/treemap/sunburst/box) XML: string compare and DOM-diff compare | Low (only once pptx import parses charts) |
| `charts/chartEx-serialize-files.js` | 464 | 0 | 0 | Fixture: 1 chartEx XML + base64 zip | Low |
| `charts/chartEx-serialize-files-many.js` | 32 | 0 | 0 | Empty stub | N/A |
| `charts/chartEx-serialize.html` | — | 0 | 0 | Harness | N/A |

Common-scope total: **33 test functions (≈9,950 data cases)**.

### 3.3 `shortcuts.js` — the 23 cases, individually

| # | Test | Behaviour (inputs → expected) | Port | Milestone |
| --- | --- | --- | --- | --- |
| 1 | Check actions with slides | In the thumbnail rail: Ctrl+M/Enter add next slide (new id, selected); Down/Up/PgDn/PgUp move; Home/End first/last; Shift+Down/Up extend selection; Shift+End/Home select to end/start; Ctrl+Down/Up move selected slides ±1; Ctrl+Shift+Down/Up to end/start; Delete/Backspace removes selection; Ctrl+A selects all; same via main-canvas hotkeys | vitest (pure `deckOps`) + e2e | M0, M2 |
| 2 | Check actions with catch events | Slideshow: Right/Down/Space/Enter/PgDn → slide n+1; Left/Up/PgUp/Backspace → n-1; Home → 0; End → last; typing digits then Enter → slide N-1; Esc → end event. Ctrl+P → print event; Shift+F10 → context menu; Ctrl+K in text → hyperlink dialog | vitest (present reducer) + e2e | M0, M9 |
| 3 | Check add various characters | Ctrl+Shift+Space → NBSP; Ctrl+Alt+E → €; Ctrl+Alt+- → en dash; Space | e2e | M4 |
| 4 | Check actions with text movements | Home/End, ←/→, Ctrl+←/→ word, ↑/↓ line, Ctrl+Home/End, and Shift variants select (expected selected strings given) | e2e (native contentEditable) | M4 |
| 5 | Check remove parts of text | Backspace, Ctrl+Backspace word, Delete, Ctrl+Delete word | e2e | M4 |
| 6 | Check text property change | Ctrl+B/I/U, Ctrl+5 strike, Ctrl+. super, Ctrl+, sub toggle; Ctrl+] / Ctrl+[ font size ladder 10→11→12→14→16→14→12→11→10 | vitest (`fontStep`) + e2e | M0, M4 |
| 7 | Check paragraph property change | Ctrl+E center, Ctrl+J justify, Ctrl+L left, Ctrl+R right; Tab/Shift+Tab indent 11.1125 mm / 0; Ctrl+Shift+L bullet; bullet indent | vitest + e2e | M4 |
| 8 | Check main actions with shapes | Arrow nudges 5 units, Ctrl+Arrow 1 unit (position math); Tab/Shift+Tab cycles selection incl. wrap; Enter on shape starts text edit at start; Ctrl+A in shape selects "Hello"; Ctrl+G group → one group selected; Ctrl+Shift+G ungroup → two shapes; Esc steps out of in-group selection then clears; table 4×4: →/←/↓/↑ and Tab/Shift+Tab move cell; Ctrl+A in table cell; Backspace over selection | vitest (`deckOps` nudge/cycle/group) + e2e (table) | M2, M5 |
| 9 | Check prevent default | NumLock, ScrollLock, Ctrl+= are `preventDefault`ed | e2e | M13 |
| 10 | Check remove graphic objects | Delete/Backspace: removes a selected animation effect (not the shape), then the shape, a chart, a shape inside a group, then the group | vitest | M2, M8 |
| 11 | Check select all in chart title | Ctrl+A inside chart title selects "Diagram Title" | e2e | M11 |
| 12 | Check actions for objects with placeholder | Ctrl+Enter selects next placeholder; on the last placeholder creates a new slide and moves to it | vitest + e2e | M7 |
| 13 | Check add break line | Shift+Enter → 1 paragraph, 2 lines; Enter in a title placeholder → line break (not paragraph); Alt+Enter in equation | e2e (math: skip) | M4 |
| 14 | Check add new paragraph | Enter → 2 paragraphs | e2e | M4 |
| 15 | Check add tab symbol | Tab inserts a tab char | e2e | M4 |
| 16 | Check show paragraph marks | Ctrl+Shift+8 toggles pilcrow display | optional | M13 |
| 17 | Check copy/paste format and clear formatting | Ctrl+Shift+C captures B/I/S; Ctrl+Shift+V applies; Ctrl+Space clears | vitest + e2e | M4 |
| 18 | Check undo/redo | type "8888"; Ctrl+Z → ""; Ctrl+Y → "8888" | vitest + e2e | M0 |
| 19 | Check select all | Ctrl+A in a text box selects the whole content | e2e | M4 |
| 20 | Check reset action with adding new shape | Esc cancels an in-progress "draw shape" mode | e2e | M3 |
| 21 | Check visit hyperlink | Ctrl+click on `ppaction://hlinkshowjump?jump=lastslide` jumps to last slide and marks visited | vitest + e2e | M4 |
| 22 | Check duplicate presentation objects | Ctrl+D with a shape selected → 2 shapes on slide; with nothing selected → 2 slides | vitest | M0 |
| 23 | Check save action | Ctrl+S from canvas or thumbnails triggers save | e2e (`PUT …/data` observed) | M0 |

---

## 4. Architecture recommendations (additive)

### 4.1 Rendering: keep DOM/CSS; add an SVG *element body* for geometry

Keep `SlideCanvas.tsx`/`SlideView.tsx` as they are: absolutely positioned
`<div>` per element, CSS `transform: scale()` for zoom, `contentEditable` for
text, CSS keyframes for transitions/animations. This is the right choice for an
MIT web app — it gives text editing, accessibility, IME, and hit-testing for
free, and every new feature below plugs into `elementStyle()`/`ElementView`.

Additive changes only:

- New element type `"shape"` with `preset: string` + `adj?: Record<string,number>`
  rendered as an inline `<svg viewBox="0 0 w h"><path d=…/></svg>` inside the
  existing element `<div>`. The six legacy types keep working; `shapeClipPath`
  stays for them (optionally re-expressed as `shape` presets on load).
- Fill/stroke extensions become optional fields (`gradient`, `opacity`,
  `shadow`, `dash`, `arrowHead`) that `elementStyle()` maps to CSS / SVG attrs.
- Multi-select is `selectedIds: Set<string>` beside the existing `selectedId`
  (keep `selectedId` = last selected for the toolbar).
- Groups: `type: "group"` with `children: SlideElement[]` (child coords relative
  to the group box), rendered by recursion in `ElementView`.

### 4.2 Shape geometry engine: ECMA-376 preset definitions, evaluated in TS

The preset geometries (`rect`, `roundRect`, … 187 shapes + 40 text warps) are
**specification data**: ECMA-376 Part 1, §20.1.10.56 `ST_ShapeType` and the
normative `presetShapeDefinitions.xml` (Part 1 Annex; also shipped in the ISO/IEC
29500 package). Each preset is a list of adjust values (`avLst`), guides
(`gdLst` with formulas `*/`, `+-`, `pin`, `val`, `sin`, `cos`, `at2`…), handles,
connection sites and paths (`moveTo/lnTo/arcTo/quadBezTo/cubicBezTo/close`).
OnlyOffice's `CreateGeometry.js` is a hand-transcription of that XML into JS
calls — we must **not** copy it; we generate our own from the spec XML:

- `web/app/src/pages/slides/geometry/presets.json` — generated at build time by
  a small script (`web/app/scripts/gen-presets.ts`) from
  `presetShapeDefinitions.xml` downloaded from the ECMA-376 package (kept out of
  the repo or vendored with its ECMA licence note; it is not OnlyOffice code).
- `geometry/eval.ts` — formula evaluator (the 17 guide operators from
  §20.1.9.11), producing an SVG path string + handle positions + connection
  sites for a `(preset, w, h, adj)` tuple.
- Tests: `geometry/eval.test.ts` — per-operator unit tests, plus golden path
  strings for the presets Grown already ships and for a curated set (arrows,
  callouts, flowchart, stars). Golden values are computed from the spec
  formulas by hand for a few and by our own evaluator snapshotted for the rest.
- pptx round-trip: `preset` maps 1:1 to `<a:prstGeom prst="…">`, so import and
  export need no geometry maths at all — only `adj` values.

Text-warp presets (`text*`) are excluded (F5).

### 4.3 pptx round-trip: keep pptxgenjs for writing; add a reader

- **Export**: stay on pptxgenjs. First close the cheap gaps it already supports:
  `addTable`, `rotate`, `flipH/flipV`, `strike`, `bullet`/`bullet:{type:'number'}`,
  `lineSpacingMultiple`, `hyperlink`, `paraSpaceBefore/After`, `subscript/
  superscript`, `transparency`, `shadow`, `line: {dashType, beginArrowType,
  endArrowType}`, `addNotes`, `slideNumber`, and the pptxgenjs `ShapeType`
  enum (which uses the same ECMA preset names — so `shape.preset` passes
  straight through). Where pptxgenjs cannot express something (transitions,
  animations, layouts/masters, sections, hidden slides), post-process its output
  zip with `jszip` (already a pptxgenjs dependency) and patch the XML
  (`<p:transition>`, `<p:timing>`, `show="0"`, `<p14:sectionLst>`). This keeps
  a single writer and adds only XML patch functions, each unit-testable on the
  emitted string.
- **Import**: new `pptx/read.ts` using `jszip` + `DOMParser`: `presentation.xml`
  (slide size, order, sections), `slides/slideN.xml` (`<p:sp>`, `<p:pic>`,
  `<p:graphicFrame>` tables/charts, `<p:grpSp>`), `slideLayouts`/`slideMasters`
  for placeholder inheritance and theme colours/fonts, `notesSlides`, media
  rels → data: URLs (or Drive assets, M6). EMU → logical px: `px = emu / 914400
  * 96 * (960 / (slideWidthEmu/914400*96))`, i.e. normalise to the 960-wide
  canvas and record the source aspect in `DeckDoc.size`.
- **Colour maths**: `<a:schemeClr val="accent1"><a:lumMod val="60000"/>
  <a:lumOff val="40000"/></a:schemeClr>` is everywhere in real pptx files, so
  import needs an ECMA-376 §20.1.2.3 colour-transform implementation
  (`colorMods.ts`; **landed in CC1 as the shared `web/app/src/lib/colorMods.ts`** —
  use `resolveColor`/`readColorMods` from there, don't fork it). This is where the OnlyOffice `color-mods` suite is ported
  (as behaviour tables we write ourselves — the transforms are spec-defined
  HSL/RGB maths).
- **Round-trip tests**: vitest `pptx/roundtrip.test.ts` — build a `DeckDoc`
  fixture → export (pptxgenjs in jsdom, `write({outputType:'nodebuffer'})`) →
  import → deep-equal on the normalised model; plus reading a handful of small
  pptx fixtures **authored by us** (python-pptx or PowerPoint) checked into
  `web/app/src/pages/slides/pptx/__fixtures__/`.

### 4.4 Collab: keep the broadcast hub; shrink the blast radius of ops

Keep `internal/slides/collab.go` and the JSON autosave. Additively introduce
finer-grained ops so that fewer edits fall back to the whole-deck `slides` op:
`slideInsert {at, slide}`, `slideRemove {si}`, `slideMove {si, to}`,
`slideProps {si, patch}` (background/notes/transition/hidden), `reorder {si,
ids[]}` (z-order), `elPatch {si, elId, patch}` (partial element update, merged
field-wise so two users changing different fields of one element do not
clobber each other). The reducer that applies these ops is a pure function
(`deckOps.ts`) shared by the sender and the receiver — and is exactly what the
ported OnlyOffice tests exercise. See F2 for why CRDT is not proposed.

### 4.5 Themes/layouts as data, not as a master editor

Add `DeckDoc.theme { name, fonts {heading, body}, colors {dk1, lt1, dk2, lt2,
accent1..6, hlink, folHlink} }` and `DeckDoc.layouts: Layout[]` (each a `Slide`
template whose elements carry `placeholder: 'title'|'body'|'subTitle'|'pic'|
'sldNum'|'ftr'|'dt'`). "Apply layout" copies the layout's placeholders that are
missing on the slide; existing slides remain plain element lists. Theme colours
are referenced by elements as `fill: "theme:accent1"`-style tokens resolved in
`elementStyle()`; literal hex keeps working. This gives Change theme / Apply
layout / slide numbers / pptx `<p:sldLayout>` mapping without a master editor.

---

## 5. Phased implementation plan

Sizes: S ≤ 1 day, M ≈ 2–4 days, L ≈ 1–2 weeks, XL > 2 weeks. Each milestone lists
the OnlyOffice cases it ports (by the numbering in §3.3, or by file).

### M0 — Test foundation + pure-function extraction (M) — *do first*

- Extract the slide/element operations that live inline in `DeckEditor.tsx`
  into `web/app/src/pages/slides/deckOps.ts` (pure, `(doc, op) => doc`): new/
  duplicate/delete/move slide, select-next/prev/first/last, multi-slide select
  and move (Ctrl+Up/Down, to start/end), arrange, rotate/flip, duplicate element,
  nudge, undo/redo stack (`history.ts`), `fontStep` ladder, present-mode
  navigation reducer (`presentOps.ts`: next/prev/first/last/goto N/steps).
  `DeckEditor.tsx` calls these instead of inline code (behaviour unchanged).
- vitest: `deckOps.test.ts`, `history.test.ts`, `presentOps.test.ts`,
  `model.test.ts` (parseDeck fallback, newElement defaults, elementTransform).
- Playwright: `web/e2e/slides.spec.ts` — create deck via API (`helpers.ts`
  gets `createDeck/trashDeck/getDeck`), open `/slides/d/:id`, insert text box,
  type, reload → persists; Ctrl+M adds slide; Ctrl+S / autosave observed via
  `page.waitForResponse(PUT …/data)`.
- Ports: §3.3 #1 (slide actions), #2 (demo navigation reducer), #6 (font-size
  ladder), #18 (undo/redo), #22 (Ctrl+D dual behaviour), #23 (save).
- Depends on: nothing.

### M1 — pptx fidelity + import (round-trip) (L) — *highest user leverage*

- Export: add tables, rotation, flips, strike, lists, line spacing, hyperlinks,
  notes (kept), `roundRect` via `ShapeType.roundRect` with `rectRadius`; then
  XML post-processing for `<p:transition>` and `<p:timing>` (map the 5+4
  existing types), `show="0"` once hidden slides exist (M7).
- Import: `pptx/read.ts` (§4.3) into the existing model; File → "Import slides"
  (choose which slides), DeckList "Upload .pptx", Drive open route
  `/slides/:id` → real editor for `.pptx` and Grown decks (removes the
  `EditorPlaceholder` for slides in `App.tsx`).
- `colorMods.ts` (ECMA-376 colour transforms) used by import for scheme colours
  (shared `web/app/src/lib/colorMods.ts`, landed in CC1).
- Tests: `pptx/write.test.ts` (inspect emitted XML strings per feature),
  `pptx/read.test.ts` (fixtures authored by us), `pptx/roundtrip.test.ts`,
  `colorMods.test.ts` — port of `common/color-mods/color-mods.js` as our own
  table: per-mod tests (28 groups) with a representative grid (e.g. 9 base
  colours × 11 values per mod ≈ 2.5k rows generated in the test from the
  spec formulas, plus the identity/combined cases); e2e `slides-import.spec.ts`
  (upload pptx → slide count/text visible → export pptx → non-empty).
- Ports: `common/color-mods/color-mods.js` (28), `common/api/api.js` (URL
  classifier — needed for hyperlink import validation) (2).
- Depends on: M0 (helpers), nothing else.

### M2 — Selection, arrange, group (M)

- Multi-select (Shift+click, marquee drag on empty canvas), Ctrl+A select all
  elements, Tab/Shift+Tab cycle, Esc deselect; group/ungroup (`type:"group"`),
  align ×6 (to slide when one selected, to selection when many), distribute
  H/V, center on page; keyboard nudge parity (Arrow = 1 unit, Shift = 10; keep
  current values); Delete semantics for group/child; wire all disabled
  Arrange menu items; finer-grained collab ops (`elPatch`, `reorder`, `slide*`)
  in `deckOps.ts` + `DeckEditor.tsx` + accepted by the receiver.
- Tests: `deckOps.test.ts` (align/distribute/group maths, cycle order, delete in
  group), `collabOps.test.ts` (apply-op idempotence, patch merge), e2e
  `slides-arrange.spec.ts`.
- Ports: §3.3 #8 (nudge, Tab cycle, group/ungroup, Esc), #10 (delete shape/
  group/child), `js-api/api-drawing.js` Select/Unselect/Flip (4 of 10),
  `api-presentation.js` GetDrawingsByName (as `findElementsByName`, requires
  `name` field), `copypaste` (3, as positive tests of in-app + system clipboard
  JSON payload).
- Depends on: M0.

### M3 — Preset geometry engine + shape/line tools (L)

- `geometry/` per §4.2; shape picker (Shapes / Arrows / Callouts / Flowchart /
  Stars / Equation categories, as in the Google reference); Line submenu
  (line, arrow, elbow, curved, polyline, scribble) — lines become 2-point
  elements with arrowheads; draw-to-insert mode with Esc cancel; adjust
  handles for presets with `avLst`; fill/stroke/opacity/dash/shadow/gradient
  side panel ("Format options"); change shape type; `name` + alt text.
- Tests: `geometry/eval.test.ts`, `geometry/presets.test.ts` (golden paths),
  `elementOps.test.ts` (fill/outline setters incl. invalid input rejection),
  e2e `slides-shapes.spec.ts`.
- Ports: `js-api/api-drawing.js` (remaining 6: gradient fill, SetOutLine,
  Get/SetName), #20 (Esc cancels draw mode).
- Depends on: M2 (side panel needs selection model), M1 for preset export.

### M4 — Text formatting depth (L)

- Super/subscript, justify, vertical-align UI, indent ± and multi-level lists
  with bullet styles, paragraph spacing, font-size ±, change case, clear
  formatting, paint format, find & replace (across slides + notes), special
  characters picker, text insets, autofit-shrink, text-direction; keyboard:
  Ctrl+B/I/U/5/./, Ctrl+]/[ Ctrl+E/J/L/R, Ctrl+Shift+L, Ctrl+Shift+C/V, Ctrl+Space,
  Ctrl+Shift+Space/Alt+E/Alt+- inserts, Shift+Enter; hyperlink dialog with
  slide targets (first/last/next/prev/N) and URL validation.
- Runs: additive `runs?: TextRun[]` on text elements (see F1) so that
  selection-scoped formatting works; `text` stays as the plain-text mirror so
  every existing reader keeps working.
- Tests: `textOps.test.ts` (case change, list levels, paint-format capture/
  apply/clear, run splitting), `links.test.ts` (URL classifier + slide targets),
  e2e `slides-text.spec.ts` (#3, #4, #5, #13, #14, #15, #19 as browser-native
  behaviours with expected strings).
- Ports: #3, #4, #5, #6 (remaining), #7, #13, #14, #15, #17, #19, #21,
  `js-api/api-shape.js` (paddings).
- Depends on: M0; M2 for keyboard focus model.

### M5 — Tables (M)

- Size picker, insert/delete rows/cols, merge/split, per-cell fill and borders,
  column widths / row heights (drag), table styles (header row, banded), cell
  keyboard navigation (Tab/Shift+Tab/arrows, Enter = newline, Backspace over
  selection), pptx `addTable` round-trip.
- Tests: `tableOps.test.ts` (grid mutations, merge maps), e2e
  `slides-table.spec.ts` (#8 table half).
- Depends on: M1 (export), M2.

### M6 — Images (M)

- Insert by URL, replace, alt text, crop (rect crop stored as `crop {l,t,r,b}`
  fractions; rendered with `object-fit`/`clip-path`), crop to shape (uses M3
  paths as `clip-path: path()`), opacity, Shift-locked aspect resize, "actual
  size"/"fit to slide"; move images out of `Deck.data` into Drive-backed assets
  (`POST /api/v1/slides/d/{id}/assets`) with `src` = asset URL — keeps data:
  URLs working for old decks.
- Tests: `imageOps.test.ts` (crop maths), Go `assets_test.go`, e2e.
- Depends on: M3 for crop-to-shape.

### M7 — Layouts, theme, slide props (L)

- `DeckDoc.theme` + `layouts` (§4.5): Change theme gallery (6–8 built-in themes
  as data), Apply layout, Edit theme = edit the layout templates, placeholders
  with Ctrl+Enter next-placeholder / new-slide, slide numbers / footer / date,
  Page setup (16:9, 4:3, custom — `DeckDoc.size` with the renderer already
  scaling by `CANVAS_W/H`), Skip slide (`hidden`), Move slide submenu,
  sections (`DeckDoc.sections`), background image/gradient.
- Tests: `layoutOps.test.ts` (apply layout merge rules, placeholder cycling),
  `theme.test.ts` (token resolution), e2e `slides-theme.spec.ts`.
- Ports: #12 (placeholders), #1 (multi-slide move via Move slide submenu).
- Depends on: M1 (theme colours in import/export), M4.

### M8 — Transitions and animations (L)

- Transitions: add the CSS-expressible OnlyOffice/PowerPoint set (push ×4,
  wipe ×4, split H/V in/out, cover/uncover ×8, cut, zoom in/out, box, dissolve,
  blinds/checker/comb/randombars via `mask-image` gradients, circle/diamond/
  plus/clock via animated `clip-path`), duration, delay, auto-advance after N s,
  apply to all, preview button.
- Animations: exit and emphasis catalogues, directions, start On Click / With
  Previous / After Previous, duration/delay, animation pane with reorder and
  preview; remove selected effect with Delete before the shape (#10).
- Tests: `transitions.test.ts` (catalogue → CSS mapping), `animOps.test.ts`
  (timeline builder: click groups from start rules), e2e present-mode steps.
- Ports: #10 (animation-effect delete), #2 (advance semantics with steps).
- Depends on: M0 (`presentOps`).

### M9 — Slideshow and presenter (M)

- Start from beginning vs current, loop, Home/End, number+Enter go-to,
  blackout (B/.), laser pointer (mouse overlay), pen/highlighter ink
  (transient canvas overlay, not persisted), skip hidden slides, audience
  window (`window.open` + `BroadcastChannel`) so presenter view and audience
  view differ, internal slide links honoured, Ctrl+P print, Shift+F10 context.
- Tests: `presentOps.test.ts` extended (goto digits, loop, hidden skip),
  e2e `slides-present.spec.ts`.
- Ports: #2 (full), #9 (prevent-default keys), #23.
- Depends on: M0, M7 (hidden slides).

### M10 — Comments, version history, collab hardening (L, backend)

- Slide/element-anchored comments (`internal/slides/comments.go`, proto
  additions; UI mirrors Docs comments), resolve/threads, Insert → Comment,
  Ctrl+Alt+M; version history (`deck_versions` table written on each autosave
  with coalescing; list/restore UI); "being edited by" hint from presence
  (`selectedIds` in presence payload); server-side op validation (reject ops
  for unknown slide ids; rate limit); finer ops from M2 become the default.
- Tests: Go `comments_test.go`, `versions_test.go`, `collab_ops_test.go`;
  e2e two-page collab test (`browser.newContext()` ×2) for element edits and
  presence.
- Depends on: M2.

### M11 — Charts, diagrams, media, word art (L)

- Charts: reuse `pages/sheets/chartData.ts` to render bar/column/line/pie as
  inline SVG in a `type:"chart"` element with an inline data editor (small
  grid), pptx export via pptxgenjs `addChart`, import of `<c:chart>` basics;
  chartEx (waterfall/funnel/treemap) only as pass-through XML on import.
- Diagrams: Google-style Diagram picker (grid/hierarchy/timeline/process/
  relationship/cycle) generated as **groups of preset shapes + text** (data
  templates, no layout engine).
- Video/audio: `type:"media"` element (`<video>`/`<audio>` in view; poster in
  thumbnails/exports; pptx `addMedia`).
- Word art: outline/gradient text via `-webkit-text-stroke` and
  `background-clip:text` (no warps, see F5).
- Tests: `chartElement.test.ts`, `diagramTemplates.test.ts`, e2e insert chart.
- Ports: #11 (chart title select-all), `common/charts/chartEx-serialize.js`
  (3, as pass-through preservation tests only).
- Depends on: M2, M3.

### M12 — Export/print completeness (M)

- Client-side PDF without the print dialog (render each slide's SVG via the
  existing `slideToSVG` into a PDF using `pdf-lib`/`jspdf` — additive), print
  preview with handouts 1/2/3/4/6/9 per page and notes pages, ODP writer
  (`odp/write.ts`: zip of `content.xml`/`styles.xml`/`meta.xml` — still
  a new writer, but small for our model), "Convert to video" declined (out of
  scope).
- Tests: `pdfExport.test.ts` (page count/size), `odp/write.test.ts` (XML shape).
- Depends on: M3 (SVG paths for presets in `slideToSVG`).

### M13 — Shortcuts, accessibility, polish (S–M)

- Single `shortcuts.ts` key map (OnlyOffice's 92 types ∪ Google's list) with a
  generated Ctrl+/ dialog (replaces the `window.alert`), Alt+/ menu search
  (Docs already has one), preventDefault set, aria labels for all toolbar
  controls, Ctrl+Shift+8 paragraph marks (optional).
- Tests: `shortcuts.test.ts` (key event → action mapping for every entry, the
  port of `events.js` as our own table), e2e spot checks.
- Ports: `shortcuts/events.js` (as the key map), #9, #16.
- Depends on: M2, M4.

Ordering rationale: M0 makes everything else testable; M1 is what users hit
first (opening real decks, exporting faithfully) and is where most OnlyOffice
test cases (colour mods, URL classifier) land; M2–M4 are the day-to-day editing
gaps that `docs/TODO-feature-gaps.md` flags ("align/distribute; group/ungroup;
find&replace; table/chart"); M7/M8 unlock the "themes/layouts" and "animations"
items; M10–M13 finish parity.

### Flagged exceptions (not planned as-is)

| # | Gap | Why it is not additive | Additive alternative in this plan |
| --- | --- | --- | --- |
| F1 | Per-run rich text (mixed bold/colour inside one box, text-range links) | Model stores one style per element; selection-scoped styling implies a run model and contentEditable ↔ runs serialisation | M4 adds optional `runs[]` while keeping `text` as a plain mirror; readers that ignore `runs` still work |
| F2 | CRDT/Yjs collaboration for slides | Swapping the hub for Yjs docs changes persistence, the op protocol and every mutation site | M2/M10 add fine-grained ops + field-level patch merge on the existing hub; server-side validation |
| F3 | Slide master editor (OnlyOffice "Slide Master" tab) | A master/layout inheritance chain with placeholder cascades is a second document model | M7 stores layouts/theme as data and "applies" them by copying |
| F4 | Edit points, merge shapes (boolean path ops), connectors glued to shapes | Needs path-boolean maths and a connection-site graph in the renderer | M3 exposes adjust handles and connection *sites* for snapping only |
| F5 | Text warp / WordArt (40 `text*` presets) | Requires per-glyph path layout (OnlyOffice draws text to paths) | M11 offers outline/gradient word art via CSS |
| F6 | SmartArt layout engine (151 layouts) | Layout algorithms + data model far beyond the deck model | M11 ships diagram templates as groups of shapes |
| F7 | Morph and GL 3-D transitions | WebGL renderer of slides | M8 covers the 2-D catalogue with CSS |
| F8 | Motion-path animations | Path editor + `offset-path` runtime | Can be added later on top of M8's timeline; not scheduled |
| F9 | Embedded spreadsheet/OLE editing for charts | Requires the Sheets engine inside Slides | M11 uses a small inline data grid |

---

## 6. Test-porting approach

### 6.1 File layout

```
web/app/src/pages/slides/
  deckOps.ts            deckOps.test.ts       (M0)  slide/element/arrange/group ops
  history.ts            history.test.ts       (M0)
  presentOps.ts         presentOps.test.ts    (M0/M9)
  model.test.ts                               (M0)
  (colorMods + URL classifier live in web/app/src/lib/ — landed in CC1)
  links.ts              links.test.ts         (M1/M4) slide link targets; URL classes via lib/urlType
  shortcuts.ts          shortcuts.test.ts     (M13) ← slide/shortcuts/events.js
  textOps.ts            textOps.test.ts       (M4)
  tableOps.ts           tableOps.test.ts      (M5)
  elementOps.ts         elementOps.test.ts    (M2/M3) ← slide/js-api/*
  collabOps.ts          collabOps.test.ts     (M2)
  geometry/eval.ts      geometry/eval.test.ts (M3)
  geometry/presets.json geometry/presets.test.ts
  pptx/write.ts pptx/read.ts pptx/*.test.ts pptx/__fixtures__/*.pptx (M1)
web/e2e/
  helpers.ts            (+ createDeck/trashDeck/getDeck/saveDeck)
  slides.spec.ts        (M0)  create/edit/reload/save
  slides-arrange.spec.ts slides-shapes.spec.ts slides-text.spec.ts
  slides-table.spec.ts  slides-present.spec.ts slides-import.spec.ts
  slides-collab.spec.ts (two contexts)
```

Colocated `*.test.ts` next to pure modules matches the existing Sheets
convention; e2e specs are `<app>[-area].spec.ts` and auto-run in the `authed`
project per `web/e2e/playwright.config.ts`.

### 6.2 Naming and traceability

- Every ported case carries the OnlyOffice origin in its title as a tag:
  `it("oo:slide/shortcuts#22 Ctrl+D duplicates the selected element", …)` /
  `test("oo:common/color-mods lumMod 60000 on accent blue", …)`. `#N` is the
  §3.3 number; suites without numbering use the QUnit test name in words.
- Tests written for Grown-only behaviour carry no tag. Tests for behaviour we
  intentionally diverge from (e.g. nudge distances, font-size ladder values if
  we choose Google's) are tagged `oo:…` plus `(grown-variant)` and the doc
  comment states the difference.
- Never paste OnlyOffice assertions, fixture strings, or their base64 files.
  Write expected values from the behaviour description (this file), from the
  ECMA-376 formulas, or from our own fixtures.

### 6.3 Tracking progress

- `slides-tests.csv` is the source of truth for *what* to port. Add a
  `docs/plans/onlyoffice-parity/slides-progress.md` at M0 with one line per
  CSV row: `ported / total` and the Grown test files; update it in the PR that
  ports cases.
- Mechanical check in CI (script, later):
  `grep -rhoE 'oo:[a-z/-]+#?[0-9]*' web/app/src/pages/slides web/e2e | sort -u | wc -l`
  compared against `test_count` sums in the CSV — a monotonically increasing
  number is the parity KPI.
- Definition of "ported": at least one Grown test asserts the same
  input → output pair for each OnlyOffice `QUnit.test`, at the closest layer
  (pure reducer > component > e2e). Data-table suites (color-mods) count as
  ported when every modifier has a grid test and the combined cases pass.

### 6.4 M0 status (Wave 0)

Tag convention in use (supersedes the `#N` form in 6.2): every ported case's
test title *is* its tag, `oo:<path>#<QUnit test name>`, with `<path>` relative
to `sdkjs-tests-v9.3.1/tests/` — e.g.
`it("oo:slide/shortcuts/shortcuts.js#Check undo/redo", …)`. One tag per
OnlyOffice `QUnit.test`; a skipped tag means "evaluated, Grown differs".

Pure modules extracted from `DeckEditor.tsx` / `SlideCanvas.tsx` (behaviour
unchanged; components import them): `deckOps.ts` (slide add/duplicate/delete/
move, element upsert/remove/arrange/rotate/flip/duplicate/nudge, style
toggles, collab-op reducer), `history.ts` (undo/redo stack with 400 ms
coalescing, 50-step cap), `presentOps.ts` (animation steps, revealed elements,
next/prev reducer, transition CSS), `keymap.ts` (editor + slideshow key
tables), `geometry.ts` (drag/resize maths, handles, stage fitting),
`selection.ts`, `presence.ts`. Grown has no snapping, so there is nothing to
extract for it yet.

Ported and passing: `api-drawing.js` GetFlipH, GetFlipV, Select, Unselect;
`shortcuts.js` Check undo/redo (at the history-reducer layer).
Smoke e2e: `web/e2e/slides.spec.ts` (new slide + text box → autosave).

#### Semantic differences found

Each is an `it.skip` with the tag and the reason in a comment:

| OnlyOffice case | Grown today |
| --- | --- |
| `slide/shortcuts/shortcuts.js#Check actions with slides` | Only Ctrl+M (add next slide), single-slide Up/Down buttons and Delete slide exist. The thumbnail rail has no keyboard navigation, multi-slide selection or multi-slide move. |
| `slide/shortcuts/shortcuts.js#Check actions with catch events` | The slideshow handles Right/Down/Space (next), Left/Up (prev), Esc (exit) and S (presenter view). It does not handle PgUp/PgDn/Enter/Backspace, Home/End or number+Enter go-to. Ctrl+P, Shift+F10 and Ctrl+K are not bound. |
| `slide/shortcuts/shortcuts.js#Check text property change` | Ctrl+B/I/U/5/./, are not bound: bold, italic and underline are element-wide toolbar toggles. There is no super/subscript and no Ctrl+]/[ font-size ladder. |
| `slide/shortcuts/shortcuts.js#Check paragraph property change` | There is no justify, no Ctrl+E/J/L/R, no indent levels and no Ctrl+Shift+L. |
| `slide/shortcuts/shortcuts.js#Check main actions with shapes` | Nudge distances differ: OnlyOffice uses 5 per Arrow and 1 per Ctrl+Arrow, Grown uses 2 px per Arrow and 10 per Shift+Arrow. Tab cycling, Enter-to-edit, groups and table cell navigation are missing. |
| `slide/shortcuts/shortcuts.js#Check remove graphic objects` | Delete removes the selected shape. Grown has no animation-effect selection, charts or groups. |
| `slide/js-api/api-drawing.js#Test: SetFlipH` / `#Test: SetFlipV` | Flipping is a toggle only. There is no boolean setter that reports success or rejects invalid input. |

Undo/redo note: `#Check undo/redo` passes at the reducer layer. Inside a
text box the browser's native contentEditable undo applies.

Resolved since Wave 0 (canvas shortcuts in `keymap.ts` + `DeckEditor.tsx`,
none of which fire while a text box or input is being edited):
Ctrl/Cmd+Z undo; Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z redo; Ctrl/Cmd+D duplicates
the selected element, or the current slide when nothing is selected
(`#Check duplicate presentation objects` now passes); Ctrl/Cmd+S flushes the
debounced autosave immediately and suppresses the browser's save dialog, also
while editing text (`#Check save action` now passes); Ctrl/Cmd+C/V copy and
paste the selected element through the in-app clipboard (an image on the OS
clipboard still pastes as a picture). Ctrl/Cmd+A is not bound: the editor has
a single selection.

### 6.5 M1 status (Wave 2): pptx fidelity and import

**Export** (`pptx/write.ts`; `export.ts` delegates to it). pptxgenjs now also
writes tables (`a:tbl` with a grid, borders, cell fill and font), rotation,
flipH/flipV, strike, bullet and numbered paragraphs, line spacing, text-run
and shape/image hyperlinks, the `roundRect` corner adjust (18 %, matching
the renderer) and fill alpha. Transitions are patched into the zip with
jszip (`insertTransition`, placed after `p:clrMapOvr`): fade → `p:fade`, and
slide-left/right/up → `p:push dir="l|r|u"`.

**Import** (`pptx/read.ts`, jszip + DOMParser, written from ECMA-376):

- Slides are read in `sldIdLst` order, then scaled uniformly to the
  960×540 canvas. 4:3 decks are pillar-boxed, with a warning.
- Text boxes and placeholders are read. Geometry is inherited from the
  layout, then the master, matched by idx and then by type. Run and
  paragraph properties (size, font, bold/italic/underline/strike, colour,
  alignment, anchor, line spacing, bullets/numbering, `normAutofit`
  fontScale) resolve through shape `lstStyle` → layout ph → master ph →
  `p:style/fontRef` → master `txStyles` → `defaultTextStyle`. Theme fonts
  (`+mj-lt`/`+mn-lt`) are resolved too.
- Preset shapes map to the closest Grown shape (`mapPreset`); unknown
  presets are drawn as a rect, with a warning. Lines, connectors
  (`cxnSp`) and single-segment freeforms become rotated Grown lines. Group
  shapes are flattened through `chOff`/`chExt`.
- Pictures become data: URLs. EMF/WMF/TIFF are skipped, with a warning.
- Tables keep the grid, cell text, first-cell fill, border and font. Charts
  and SmartArt are skipped, with a warning.
- Speaker notes, and backgrounds from the slide, then the layout, then the
  master, are read. A picture background becomes a full-slide image at the
  bottom of the element list.
- Master and layout decorations are included, honouring `showMasterSp`.
- Transitions are read from `mc:Fallback`. push/cover/pull/wipe with a
  direction map to slide-*, and anything else maps to fade.
- Colours are `srgb`/`scheme`/`sys`/`hsl`/`scrgb`/`prst` plus transforms. They
  go through `lib/colorMods` `resolveColor`, with the master `clrMap` and
  `clrMapOvr` applied. Fill/line fall back to the shape's `fillRef`/`lnRef`.
- Hyperlinks keep only absolute web and mail targets (`lib/urlType`).
  Relative file links, script schemes and slide jumps are dropped.

**UI.** File ▸ Import slides (.pptx) appends all slides to the open deck and
reports warnings in a snackbar. The Slides home page gets "Upload .pptx",
which creates a new deck. A .pptx opened from Drive (`/slides/:id`) gets
"Open in Slides", which makes an editable copy.

**Tests.**

- `pptx/write.test.ts` (17) checks the emitted XML for each feature.
- `pptx/read.test.ts` (24) reads hand-authored XML packages.
- `pptx/roundtrip.test.ts` (10) runs deck → pptxgenjs → reader with deep
  equality on the normalised model. The fixture is generated in the test.
  Cases are a full deck with every element type, the defaults of every
  insertable type, all 5 templates, a double round trip, and sub-px
  geometry.
- `pptx/importDeck.test.ts` (3).
- `pptx/corpus.test.ts` (8) is local only. It reads OnlyOffice's 8 sample
  .pptx files through read → write → read, and tags them
  `oo:core/OdfFile/Test/{test_odf,Test}/ExampleFiles#…`. It is skipped
  unless `GROWN_CONVERSION_CORPUS` is set or the default probe exists. The
  M1 CSV rows (`color-mods`, `api.js`) were already ported in CC1.
- e2e `web/e2e/slides-pptx.spec.ts` downloads a deck as .pptx via the UI,
  uploads it as a new deck, checks the thumbnails, notes, transition and
  table, then appends it with File ▸ Import slides.

**Known gaps.** These don't round-trip or import yet:

- Element animations (`p:timing`) are neither written nor read, so
  M8 is needed.
- ~~Per-run formatting is lost~~ (resolved in M4, see §6.8).
- Underline on a hyperlinked run is dropped on import, because it can't be
  told apart from the hyperlink style.
- ~~Table merges and per-cell styles are not kept; table styles
  (`tableStyleId`) are ignored.~~ (resolved in M5, see §6.9)
- Gradients import as their first stop, and pattern fills as their
  foreground colour.
- ~~Image crop (`srcRect`) is ignored.~~ (resolved in M6, see §6.10)
- Group rotation is ignored.
- Custom geometry other than a straight segment is drawn as a rect or
  dropped.
- Hidden slides are imported as visible.
- Slide size is not stored in `DeckDoc`, so non-16:9 decks are letterboxed.
- An empty image placeholder (no `src`) is not exported.
- ~~Imports with large images can exceed the 8 MiB collab WebSocket frame
  limit on the broadcast after File ▸ Import slides.~~ Imported pictures
  now go to the deck's asset store (M6, §6.10); only a server without a
  blob store keeps them inline.

### 6.6 M2 status (Wave 3): selection, arrange, group

**Model.** `SlideElement` gains `type: "group"` with `children`, plus
optional `name` and `locked`. Group members use absolute slide coordinates
as if the group were upright and unflipped. The group's own
rotation/flip turns the whole set about its centre, which is the pptx
`p:grpSp` model with `chOff = off` and `chExt = ext`. Moving a group moves
its members, and resizing it scales them (fonts and stroke widths are not
scaled, as in PowerPoint).

**Pure modules.**

- `geometry.ts`: rotated bounds, union, marquee (fully enclosed, like
  OnlyOffice), point hit-test with a band for 0-height lines,
  `setElementBox`/`mapElementInto` (group scaling), `resizeSelection`, and
  snapping. `snapMove` locks the left/centre/right and top/middle/bottom
  lines to the slide or to other elements within 6 px. Without a guide hit
  it snaps to the grid, if one is set. `snapResize` snaps only the edges
  that the handle drags. `guidesFor` returns the lines to draw.
- `groupOps.ts`: group (at the topmost member's z-position),
  ungroup/`bakeChild` (the group's rotation and flips are folded into each
  member: rotation θ + det(F)·φ, flips XOR-ed), `removeDeep` (a member
  inside a group; a group left with one member dissolves), `flattenGroups`
  for the HTML/SVG/PDF exports, and `reId` for duplicate and paste.
- `deckOps.ts`: align ×6 to the selection or the slide, distribute H/V,
  center on page, `arrangeMany` (z-order for a selection), selection-wide
  move, `cycleSelection` (Tab), `setLocked`, and `duplicateElements`. It
  also adds collab ops `upsertMany`, `removeMany`, `reorder` and
  `setElements`. Each is idempotent in `applyCollabOp`, which the receiver
  now routes every non-presence op through. The broadcast hub needed no
  change, because it relays any op.
- `selection.ts` (click/toggle/marquee merge/select all/prune),
  `elementOps.ts` (names: default, set with the duplicate-name rule,
  find by name), `clipboard.ts` (internal JSON payload under
  `application/x-grown-slides+json`, text/HTML → text box).

**Editor.** The selection is now a list of ids.

- Shift/Ctrl/Cmd+click toggles an element, and a drag on the empty
  canvas draws a marquee.
- A multi-selection shows a dashed box with shared resize handles. Moves
  and resizes snap, with magenta guides; Alt disables snapping.
- A drag, nudge, align or group records one history entry and sends one
  collab op.
- Keys: Ctrl/Cmd+A selects all. Tab/Shift+Tab cycle the selection (only
  when focus is on the page). Esc deselects. Ctrl+G or Ctrl+Alt+G groups,
  and adding Shift ungroups. Ctrl+X cuts.
- The Arrange menu wires Align (with an "Align to slide" toggle),
  Distribute, Center on page, Group/Ungroup and Lock/Unlock position.
  View ▸ Snap to toggles Guides (on by default) and Grid (20 px, drawn
  while on). Edit ▸ Select all is wired, and the context menu gains
  Group/Ungroup/Lock.
- Formatting applies to every selected element.
- A locked element can be selected but is not moved, resized, aligned or
  distributed. It shows a dashed outline.

**pptx.** The writer gives group members a path-marker object name and
nests them into `p:grpSp` after pptxgenjs runs (`wrapGroups`: DOM-based,
fresh `cNvPr` ids, `rot`/`flipH`/`flipV` kept, markers removed). The reader
turns `p:grpSp` into Grown groups instead of flattening them, so group
rotation is no longer lost. The round-trip test covers a rotated, flipped
group holding a nested group, text and an image, exported twice.

**Tests.** `geometry.snap.test.ts`, `groupOps.test.ts`, `arrange.test.ts`,
`selection.multi.test.ts`, `elementOps.test.ts`, `clipboard.test.ts`, plus
additions to `keymap`, `pptx/read`, `pptx/write` and `pptx/roundtrip`. The
e2e test `web/e2e/slides-arrange.spec.ts` marquee-selects two shapes, aligns
them, groups them, drags the group onto the slide centre (guides visible),
reloads, and ungroups.

**Ported (now passing):**

- `shortcuts.js#Check main actions with shapes`: Grown variant; the nudge
  step stays 2/10 px, and Enter-to-edit and table navigation are M4/M5.
- `shortcuts.js#Check remove graphic objects`: the chart step waits for M11.
- `api-drawing.js#Test: GetName` and `#Test: SetName`.
- `api-presentation.js#Test: GetDrawingsByName`.
- All three `copy-paste-tests.js` cases, as positive tests.
- `api-drawing.js#Test: Select` and `#Test: Unselect`, rewritten for
  multi-selection.

**Not done / gaps.**

- There is no in-group selection: you can't click into a group to select
  a member, and there is no Esc step-out. `removeDeep` supports deleting a
  member, but the UI deletes whole groups.
- There is no rotation handle; rotation is still Arrange ▸ Rotate, which
  works on groups.
- There are no user-placed ruler guides and no rulers.
- Non-uniform scaling of a rotated member inside a group only scales that
  member's box.
- Names are not yet read from, or written to, pptx `cNvPr@name`, and there
  is no Selection pane.


### 6.7 M3 status (Wave 3): preset geometry, shapes, lines

**Geometry data and licence.** No copy of ECMA-376's
`presetShapeDefinitions.xml` was available locally (none under
`research/onlyoffice/core`, the LibreOffice install or elsewhere on disk).
So the preset table (`presetDefs.ts`) was transcribed by hand from the
ECMA-376 Part 1 formulas (§20.1.10.56 and the annex definitions). Nothing
comes from OnlyOffice's `CreateGeometry.js` (AGPL) or LibreOffice. The file
header records this.

It covers 68 presets:

- 22 basic shapes, including `pie`, `can`, `cube`, `heart`, `smileyFace` and
  `lightningBolt`.
- 10 block arrows.
- 5 equation shapes (`mathNotEqual` is not included).
- 18 flowchart shapes.
- 5 stars and banners.
- 3 wedge callouts.
- 5 line presets: `line`, `straightConnector1`, `bentConnector2`,
  `bentConnector3` and `curvedConnector3`.

Adjust names, defaults, ranges, guides and paths follow the spec, so avLst
values round-trip with PowerPoint. The text rectangles of parallelogram,
hexagon, octagon, wave and the callouts are simplified. Other presets (cloud,
ribbons, scrolls, action buttons, curved arrows, `borderCallout*`,
`bentConnector4/5`, `curvedConnector2/4/5`) still import as the closest legacy
shape, with a warning.

**Engine (`presetGeometry.ts`).**

- It evaluates all 17 guide operators and the six path commands (arcTo uses
  the spec's visual angles and becomes ≤90° cubic Béziers).
- Path `w`/`h` scaling and the path `fill`/`stroke` modes are supported.
- It returns SVG path data, adjust-handle positions, connection sites and
  the text rectangle.
- `solveHandle` inverts a handle drag for any formula. It does a coarse scan,
  then a golden-section refine per referenced adjust value; this covers both
  XY and polar handles. It clamps to the handle's (guide-valued) min and max,
  and ±2³¹ is treated as unbounded.

**Model.**

- New `type: "shape"` elements carry `preset` and `adj`.
- New `type: "connector"` elements carry a line preset between two box
  corners. flipH/flipV pick the diagonal, as in a pptx `cxnSp`.
- Both take the optional `dash` (pptx `prstDash`).
- Connectors also take `headEnd`/`tailEnd` (none, triangle, stealth,
  diamond, oval, arrow) and `stCxn`/`endCxn` glue.
- The six legacy shape types are unchanged.

**Rendering.** `shapeRender.ts` turns the geometry into layers: fill,
darken/lighten shading, dashed outline, and arrowheads with the line pulled
back under filled heads. SlideView/SlideCanvas render these layers as inline
SVG inside the element `<div>`, so rotation and flip are still CSS. The HTML,
PDF, SVG and PNG exports use the same markup.

**Editor.**

- The **Shapes** toolbar gallery groups Lines, Basic shapes, Block arrows,
  Equation shapes, Flowchart, Stars and banners, and Callouts. Insert ▸ All
  shapes opens it; Insert ▸ Arrow / Elbow connector / Curved connector arm a
  tool directly.
- Picking arms draw-to-insert: a click inserts at the preset's default size,
  a drag draws the box (Shift keeps it square), and Esc cancels.
- A selected preset shows yellow diamond adjust handles.
- A selected connector shows end handles. These glue to the connection sites
  of any top-level element within 10 px (the sites are shown while
  dragging). Glued connectors follow their shapes on every upsert.
  Dragging a connector away on its own unglues it.
- The toolbar adds line colour, weight, dash type, and start/end arrowheads.

**pptx.**

- Preset shapes are written by `prst` name through pptxgenjs. On slides that
  have presets, every element carries a marker name. `patchElements` then
  writes the `avLst` adjust values, rebuilds connectors as `p:cxnSp` with
  `a:stCxn`/`a:endCxn` pointing at the target shapes' `cNvPr` ids, and
  restores the names.
- The reader turns `prstGeom` + `avLst` into presets. It keeps the legacy
  types only where they draw identically: rect, ellipse and diamond;
  roundRect at Grown's 18 % corner; and triangle and rightArrow at their
  defaults. Connectors keep their preset, adjust, flips, arrowheads, dash
  and glue (resolved per shape tree). A plain straight line without
  arrowheads is still a legacy line.

**Tests.**

- `presetGeometry.test.ts` (26) covers each operator, and checks path
  strings, bounds and points against hand-computed values. The presets
  checked are rect, roundRect, ellipse, triangle, rightArrow, star5, pie,
  the flowchart w/h scaling, both wedge callouts, can and the connectors.
  It also checks that every preset is finite at four sizes, including 0×0.
  It solves handles for roundRect, rightArrow, donut (polar R), pie (polar
  angle), wedgeRectCallout (unbounded 2-axis) and bentConnector3.
- `shapeRender.test.ts`, `connectorOps.test.ts` (glue, reroute and unglue)
  and `drawTool.test.ts` cover rendering, glue and draw-to-insert.
- `pptx/presets.test.ts` round-trips all 60 non-legacy presets with shifted
  adjust values, rotation, flips and dash. It also round-trips connectors
  with glue, and runs a double round trip.
- The e2e test `web/e2e/slides-shapes.spec.ts` covers gallery click and drag,
  Esc cancel, a glued elbow connector, an adjust-handle drag, moving a glued
  shape, and reload.

**Ported (now passing):**

- `api-drawing.js#Test: SetOutLine`, as `elementOps.setOutline`, with
  invalid-input rejection.
- `#Test: SetFlipH` and `#Test: SetFlipV`, as the typed setter
  `elementOps.setFlip`. These were `it.skip` in M0.
- `shortcuts.js#Check reset action with adding new shape`, as the keymap
  `cancelDraw` action plus the e2e test.

**Not done / gaps.**

- `#Test: Create shape with gradient fill` needs gradient fills.
- There is no Format options side panel: opacity, shadow and gradients are
  missing.
- There is no change-shape-type command, and no text inside preset shapes
  (the text rect is computed but unused).
- Polyline and scribble are missing.
- Connectors are re-routed only by moving their ends. There is no
  PowerPoint-style elbow re-layout around obstacles, and nothing is glued
  to group members.
- Imported glue that targets a picture or a graphic frame is dropped.

### 6.8 M4 status (Wave 4): text formatting depth

**Runs (F1).** Text elements gain optional `runs?: TextRun[]` (bold,
italic, underline, strike, super/subscript, size, font, colour, link per
run) and `paras?: ParaProps[]` (level 0–8 and alignment per paragraph).
`text` stays the plain-text mirror: the runs always concatenate to it, and
runs whose text no longer matches (an edit by an older client) are ignored.
"\n" separates paragraphs; "\v" is a line break inside one (Shift+Enter,
pptx `a:br`). `textOps.withRuns` normalises every edit: adjacent equal runs
merge, run values equal to the element's are dropped, a value every run
shares moves up to the element, and `runs`/`paras` vanish when they carry
nothing, so a box that was never range-formatted keeps its old shape.
Collab needs no new op: `upsert` relays the whole element.

Other new element fields: `baseline`, `bulletStyle` (bullet character or
`buAutoNum` scheme), `spaceBefore`/`spaceAfter`, `insets` (default 4 px),
`autofit: "shrink"`, `rtl`, `vert` (`vert`/`vert270`); `align` gains
`justify`.

**Modules.**

- `textOps.ts` (pure): range format/toggle, font-size ladder (`fontStep`:
  8…28, 36, 48, 72, then ±10), change case (the Docs logic, now shared from
  `lib/textCase.ts`), clear formatting, paint-format capture/apply, text
  replace keeping runs, paragraph align/indent, multi-level list markers
  (bullets •◦▪ by level; numbering arabic/alpha/roman by level, restarting
  per level), insets with invalid-input rejection, link ranges.
- `links.ts`: slide targets stored as `#slide:first|last|next|prev|<id>`,
  resolved from the current slide; pptx `ppaction://hlinkshowjump` and
  `hlinksldjump` both ways; dialog input classified via `lib/urlType`.
- `findReplace.ts`: matches across text boxes (in groups too), table cells
  and notes; match case / whole word; replace one or all, keeping runs.
- `textDom.ts` + `TextEditor.tsx`: the in-place editor owns its DOM
  imperatively (`div[data-para]` > `span[data-run]` with each run's style as
  JSON). Typing, Enter, Shift+Enter and deletes are native contentEditable;
  the DOM is read back into runs when a command runs and when editing ends.
  Browser-made markup (b/i/u/sup/sub/a, inline styles, bare divs) is read
  too. `textLayout.ts` gives SlideView, the editor and the HTML export the
  same run/paragraph CSS.
- `specialChars.ts`, `TextDialogs.tsx` (hyperlink, find and replace, special
  characters, text options), `TextFormatControls.tsx` (toolbar).

**Editor.** A text command applies to the live selection while a box is
edited, else to the selection the box had when editing ended (a menu,
dialog or colour picker took focus; editing then resumes with it), else to
every selected box as a whole. A collapsed caret acts on its word
(character formatting) or its paragraph (paragraph formatting). Toolbar:
font, size ±, colour, strikethrough, super/subscript, justify, vertical
align, bullet/number styles, indent ±, change case, paint format, clear
formatting, link. Format menu: the same plus text fitting, text direction
and Text options… (insets, paragraph spacing, shrink on overflow,
direction). Edit ▸ Find and replace (Ctrl+H) is a floating panel; matches
in top-level boxes are highlighted with the CSS Custom Highlight API
without taking focus. Insert ▸ Special characters… (categories + search).
The hyperlink dialog links to a web/email address (classified live;
script schemes rejected, other schemes flagged) or to the first, last,
next, previous or a chosen slide; Ctrl/Cmd+click follows a link in the
editor and a click follows it in the slideshow.

Keys (`keymap.textKeyAction`): Ctrl+B/I/U, Ctrl+5 and Alt+Shift+5, Ctrl+.
and Ctrl+, , Ctrl+] / Ctrl+[ and Ctrl+Shift+> / <, Ctrl+E/J/L/R (and the
Ctrl+Shift Google aliases), Ctrl+Shift+L or Ctrl+Shift+8 bullets,
Ctrl+Shift+7 numbering, Ctrl+Shift+C/V paint format, Ctrl+Space or Ctrl+\
clear, Ctrl+K link, Ctrl+H find; while editing Ctrl+Shift+Space (NBSP),
Ctrl+Alt+E (€), Ctrl+Alt+- (en dash), Tab/Shift+Tab (indent a list
paragraph, else a tab character), Esc (leave the box).

**pptx.** Text boxes are no longer written by pptxgenjs's text code (it
merges element options into every run and repeats `a:pPr` per run).
pptxgenjs lays down the shape and `pptx/textXml.ts` writes the `p:txBody`
(every run's full `a:rPr`, `a:br`, `lvl`/`algn`/`rtl`, spacing, bullet char
or `buAutoNum`, `marL`/`indent`, insets, anchor, `vert`, `normAutofit`),
swapped in by `patchElements`, which also adds hyperlink and slide
relationships. The reader builds runs from each run's resolved properties
(the whole inheritance chain) and normalises with `withRuns`; one link over
the whole text stays an element link. Round-trip: `pptx/richText.test.ts`.

**Tests.** `textOps.test.ts` (29), `links.test.ts`, `findReplace.test.ts`,
`textDom.test.ts`, `pptx/richText.test.ts`, additions to `keymap.test.ts`
and `pptx/read.test.ts`; e2e `web/e2e/slides-text.spec.ts` (12).

**Ported (now passing):** `shortcuts.js#Check add various characters`,
`#Check actions with text movements`, `#Check remove parts of text`,
`#Check add break line`, `#Check add new paragraph`, `#Check add tab
symbol`, `#Check select all` (e2e, browser-native caret/delete behaviour);
`#Check text property change` and `#Check paragraph property change` (were
`it.skip`); `#Check copy/paste format and clear formatting actions`;
`#Check visit hyperlink`; `api-shape.js#Test: SetPaddings` (px, not mm).

**Semantic differences / gaps.**

- Caret movement, word deletes and select-all are the browser's; on macOS
  the word/line keys are Alt/Cmd+arrows and Alt+Delete keeps the space
  after the word. The e2e asserts the OnlyOffice selections, not caret
  indices.
- Enter in a title placeholder makes a paragraph (Grown has no
  placeholders); equation line breaks are out of scope.
- Link "visited" state is not tracked; tooltips (ScreenTips) aren't stored.
- Ctrl+5 is reserved by some browsers (tab switching); Alt+Shift+5 works.
- A collapsed caret with Ctrl+B formats the word at the caret; there is no
  pending "type in bold" state.
- Group members and table cells can't be edited as rich text; find matches
  in them select the group/table without highlighting.
- The editor's native undo stack resets when a formatting command rebuilds
  its DOM; the deck-level undo still has every command.
- Shrink-on-overflow uses CSS zoom on the rendered text and doesn't write
  a `fontScale` (PowerPoint recomputes it when the box is edited).

### 6.9 M5 status (Wave 4): tables

**Model (additive).** `TableData` keeps `rows`/`cols`/`cells` (the
plain-text mirror of every cell) and gains optional `colW`/`rowH`
(relative sizes, scaled to the element box, so resizing the table scales
its grid), `merges` (`{r, c, rs, cs}` blocks anchored top-left; covered
cells keep ""), `props[r][c]` (per-cell `fill`, `borders` per side with
colour/width/dash, `align`, `valign`, a cell-wide `style` and rich
`runs`/`paras`), `style` (a pptx table style GUID) and `look` (header,
total row, banded rows, first/last column, banded columns). A table
without any of these renders exactly as before.

**Modules.**

- `tableStyles.ts`: PowerPoint's built-in table styles by GUID ("No Style,
  No Grid", "No Style, Table Grid", "Medium Style 2" and its six accents,
  Office theme colours) with the documented rules: whole-table fill and
  grid, row/column bands counted after the header/first column,
  header/total/first/last conditional fill, text colour and bold, and the
  thick white edge under a header / over a total row.
- `tableOps.ts` (pure): column/row geometry; merge lookup and range growth
  over merges; insert/delete rows and columns (new rows copy the
  neighbour's formatting; merges spanning the point grow; deleting a
  merge's anchor row keeps its content); merge (contents joined as
  paragraphs, runs kept) and split (a merged cell into blocks that divide
  its span, or a single cell by adding grid lines that the other cells
  span); grid-line drag (inner lines trade width, the table keeps its
  width; row lines grow the table); distribute rows/columns; fills; the
  ten border presets (all, outer, inner, inner H/V, top/bottom/left/right,
  none), which also set the facing side of the neighbour across a range
  edge; style/look; effective cell format (explicit → template → legacy
  element fill/stroke). A cell is presented as a text element
  (`cellTextEl`, id `<table>:<r>:<c>`) and written back with `setCellText`,
  which stores only what differs from the table/template defaults — so the
  M4 rich editor, every textOps command and find/replace work on cells.
  `tableKey` is the keyboard reducer for a selected table.

**Editor.** Insert ▸ Table… and a toolbar button open a 8×10 size picker;
new tables get "Medium Style 2 - Accent 1" with a header row and banded
rows (PowerPoint's default). With the table selected, a click in a cell
opens the rich editor there (a drag or Shift+click selects a cell range);
Tab/Shift+Tab move to the next/previous cell (Tab on the last cell adds a
row), and arrows cross cell edges at the ends of the text. Outside the
editor, arrows move the active cell, Shift+arrows extend the range, Enter
edits it (text selected), Enter over a range clears it and edits its first
cell, Backspace/Delete clear the range, Esc drops the cell selection.
Inner grid lines drag to resize columns/rows. The toolbar adds Rows &
columns (insert/delete/select/distribute), Merge, Split… (rows × columns
dialog), a Style gallery with the six style options, cell fill and a
Borders menu (colour, width, preset). Format ▸ Table and the context
menu carry the same commands. Text formatting with a table selected (not
editing) applies to the selected cells, or the whole table. HTML/PDF and
SVG/PNG exports draw widths, heights, merges, fills, borders and rich
cells.

**pptx.** pptxgenjs still lays down the graphic frame; its `a:tbl` is
replaced by `pptx/tableXml.ts`: `a:tblPr` flags + `a:tableStyleId`,
`a:gridCol` widths, `a:tr@h`, `gridSpan`/`rowSpan` with `hMerge`/`vMerge`
on covered cells, per-cell `a:lnL/R/T/B` (width 0 → `a:noFill`) and fill
in `a:tcPr` (with margins and anchor), and rich cell text through the M4
paragraph writer. A legacy (unstyled) Grown table omits the style id and
bakes its element fill/border into every cell, as before. The reader
maps all of that back; cell text goes through `readText` and
`setCellText`. An unstyled pptx table whose cells share one fill and one
border becomes a legacy Grown table; any other unstyled table becomes
"No Style, No Grid" with its explicit cell formatting. An unknown style
GUID is read as "No Style, No Grid" with a warning.

**Tests.** `tableOps.test.ts` (23), `pptx/tables.test.ts` (6: XML
checks, styled round trip with merge/fills/dashed borders/sizes/rich text
and a link, double round trip, mixed unstyled borders, table grid, unknown
style), the updated table case in `pptx/read.test.ts`; e2e
`web/e2e/slides-media.spec.ts` (picker, typing with Tab, Shift+click range,
merge, style, reload) and the table-keys test.

**Ported (now passing):** `shortcuts.js#Check main actions with shapes`,
table half, as `…(table cell navigation)` (reducer: right ×3, left ×2,
down, up, Tab ×2, Shift+Tab ×2, Enter selects the first cell's text, Enter
over a range removes it) and `…(table keys in the editor)` (e2e).

**Gaps.**

- Style colours are the Office theme's, not the deck's theme (Grown has
  no theme yet, M7); a pptx whose theme recolours accents shows Office
  colours. Only the nine styles above are in the gallery; other built-in
  GUIDs import as "No Style, No Grid".
- No diagonal borders, cell margins UI, text direction in cells, or
  "distribute" for a range that crosses merges.
- The table is one element for collab: two people editing different cells
  at once still last-writer-wins on the table.
- Row heights are minimums (as in PowerPoint), but the element box
  doesn't grow with text that overflows a row: the drawn table then runs
  past its box and its selection outline.

### 6.10 M6 status (Wave 4): pictures

**Storage.** `POST /api/v1/slides/d/{id}/assets` (multipart `file` or a raw
body, ≤ 20 MiB) sniffs the type (PNG/JPEG/GIF/WebP/BMP; SVG is refused, as
it would run script from our origin) and stores it in the blob store shared
with Drive (rustfs/S3) under `slides/<deck>/<sha256>`; the picture's `src`
is `/api/v1/slides/d/<deck>/assets/<sha256>`. `GET` serves it with
`nosniff`, a sandbox CSP, an ETag and immutable caching. Access follows the
deck (`slidesDeckAccess`, now shared with the collab WebSocket): readers
may fetch, writers may upload (`internal/slides/assets.go`,
`assets_test.go`). The client uploads inserted, pasted and replacing
pictures (`api.deckImageSrc`) and falls back to a data: URL when the
server has no blob store or refuses the file (SVG); old decks with data:
URLs keep working. File ▸ Import slides, Upload .pptx and Drive's "Open
in Slides" move imported pictures to the asset store too
(`assets.externalizeImages`). Exports that leave the browser (pptx, HTML,
SVG/PNG/JPEG) inline the asset URLs back into data: URLs
(`assets.inlineImages`).

**Model.** `crop {l, t, r, b}` (fractions cut from each side, as pptx
`srcRect`), `cropShape` (a preset name), `opacity`, `shadow`, `alt` (any
element); the border reuses `stroke`/`strokeWidth`/`dash`. A picture with
a crop or a crop shape is stretched to its box (the pptx model); one
without keeps the legacy letterbox.

**Modules.** `imageOps.ts` (pure): crop normalisation, the full-picture
rectangle, crop-handle drag (the picture stays put; edges stop at the
picture), pan inside the crop, reset crop (same scale), Fill/Fit,
insert box (the picture's own proportions, ≤ 60 % of the slide), actual
size, fit to slide, replace (keeps the box area), opacity, alt text, and
the crop-to-shape clip path from the M3 preset engine.

**Editor.** Pictures insert at their own proportions. With a picture
selected the toolbar shows Crop (crop mode: the uncropped picture shows
faintly, square black handles crop, a drag pans; Enter/Esc/deselect ends
it), Crop options (remove shape, Fill, Fit, reset crop, actual size, fit
to slide, replace image, alt text), Crop to shape (the shape gallery
without lines), Opacity, Shadow, and the line colour/weight/dash controls
for a border. Format ▸ Image and the context menu add crop/reset/replace;
"Alt text…" is on the context menu and Format ▸ Image for any element.

**pptx.** `patchPicture` writes `a:srcRect`, `a:alphaModFix`, the crop
shape as `a:prstGeom@prst`, `a:ln` and an `a:outerShdw`; `cNvPr@descr`
carries alt text for every element (pptxgenjs used to put the image data
there). The reader maps them back (negative `srcRect` values are
dropped).

**Tests.** `imageOps.test.ts` (14), `pptx/images.test.ts` (7: XML, full
round trip, plain picture, alt text on shapes, `inlineImages`,
`externalizeImages`), Go `internal/slides/assets_test.go` (path parsing,
upload + dedupe + serve + 304, access, SVG/HTML/empty refused, size
limit); e2e `slides-media.spec.ts` uploads a picture (201, asset URL in
the model, served as image/png after reload), crops it to an oval and on
the left edge, adds alt text. No OnlyOffice suite covers pictures, so
these tests carry no `oo:` tag.

**Gaps.**

- Insert by URL and "From storage" (Drive picker) are not done.
- No Shift-locked aspect resize, recolour or picture effects beyond the
  one preset shadow.
- Crop mode ignores rotation (it crops in the unrotated frame).
- Assets are never garbage-collected; a picture copied into another deck
  still points at the first deck's asset (readable by whoever can read
  that deck).

