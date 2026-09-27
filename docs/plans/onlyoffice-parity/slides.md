# OnlyOffice parity plan — Slides

Status: plan (2026-09-26); M0–M9 and M11 landed — see the status notes in §6.4–6.15.

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
| Theme (fonts + colour scheme) | Have (M7) | `theme.ts`, `DesignDialogs.tsx` ThemeDialog (8 built-ins + imported; Edit theme) |
| Slide layouts / Apply layout | Have (M7) | `layouts.ts` (8 standard layouts), Slide ▸ Apply layout, Layout ▾, Reset slide |
| Slide master editing / placeholders | Partial (placeholders; no master editor, F3) | `SlideElement.placeholder`, Ctrl+Enter |
| Deck templates (whole decks) | Have | `templates.ts`, `DeckList.tsx` |
| Slide size / page setup | Have (M7) | `slideProps.ts` `resizeDeck`, File ▸ Page setup |
| Slide numbers / footer / date | Have (M7) | `layouts.ts` header & footer, Insert ▸ Header & footer |
| Background colour | Have (dialog, theme colours) | `DesignDialogs.tsx` BackgroundDialog |
| Background image / gradient / pattern | Partial (image, 2-stop gradient; no pattern) | `Slide.bgFill` |
| Skip (hide) slide | Have (M7) | `Slide.hidden`, Slide ▸ Skip slide |
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
| Insert chart (bar/column/line/pie) | Have (M11) | `chartElement.ts` on the Sheets chart code; all 10 Sheets types |
| Edit chart data | Have (M11, small grid, F9) | `ObjectDialogs.ChartDialog` |
| Chart from Sheets (linked) | Missing | — |

### 2.7 SmartArt / diagrams

OnlyOffice: `sdkjs/common/SmartArts/` (`SmartArtTree.js` 8,441; 151 layout data
files under `SmartArtData/`; 159 named layouts in the UI).

| Feature | Grown | Where |
| --- | --- | --- |
| Diagram insert (grid/hierarchy/timeline/process/relationship/cycle) | Partial (M11: list, process, cycle, hierarchy, pyramid, Venn) | `diagrams.ts` (groups of presets from an outline) |
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
| Fade (smooth / through black), cut, dissolve | Have (M8) | `transitions.ts` |
| Push/wipe/cover/uncover ×4, split ×4, reveal, zoom in/out | Have (M8) | `TRANSITION_DEFS`, `transitionFx` |
| Clock/blinds/checker/comb/circle/diamond/plus/random bars | Missing (import as fade) | — |
| Duration / advance on click / auto-advance after N s | Have (M8) | Motion panel, `autoAdvanceDelay` |
| Apply to all slides | Have (M8) | Motion panel |
| Preview in editor | Have (M8) | `MotionPreview` |
| Morph | Partial (M8): crossfade + matched-element tween | `morphPairs` — see F7 |
| 3-D GL transitions | Missing | — see F7 |

### 2.10 Animations

OnlyOffice: `Timing.js` (15,113) implements the OOXML `<p:timing>` tree
(sequences, triggers, nodes), `anim-pane.js` (3,203). UI (`Animation` 31 strings
+ 199 effect strings): entrance/exit/emphasis/motion-path catalogues, start
On Click / With Previous / After Previous, duration presets (0.5–20 s), delay,
repeat, rewind, trigger "On click of", move earlier/later, animation pane.

| Feature | Grown | Where |
| --- | --- | --- |
| Entrance effects (appear, fade, fly, float, wipe, zoom) | Have (M8) | `animOps.ANIM_CATALOG` |
| Exit / emphasis effects (pulse, colour pulse, teeter, spin, grow/shrink) | Have (M8) | `animOps` |
| Start with/after previous, duration, delay | Have (M8) | `buildTimeline` |
| Directions (from top/bottom/left/right) | Have (M8) | effect editor |
| Animation pane (reorder, preview, remove) | Have (M8) | Motion panel |
| Motion paths, triggers, repeat/rewind | Missing | — see F8 |
| Text-by-paragraph animation | Have (M8) | `expandParagraphs` |

### 2.11 Slideshow / presenter view

OnlyOffice: `DemonstrationManager` (mocked by `tests/slide/common/demonstrationManager.js`),
`SlideShowAnnotations.js` (310: pen ink during show), `SlideshowSettings`
(loop until Esc), Statusbar "Show from beginning / from current / presenter
view", shortcuts (`c_oAscPresentationShortcutType.Demonstration*`: next/prev/
first/last, number+Enter, Esc), hyperlink `ppaction://hlinkshowjump?jump=
firstslide|lastslide|nextslide|previousslide`.

| Feature | Grown | Where |
| --- | --- | --- |
| Start slideshow (current slide) | Have | `startPresent` |
| Start from beginning | Have (M9) | Present ▾, F5 |
| Next/prev/Esc, click to advance | Have | `SlideShow`, `presentReduce` |
| Home/End, number+Enter go-to | Have (M9) | `presentReduce` |
| Loop, blackout (B/W), laser pointer | Have (M9) | `DeckDoc.show.loop`, Ctrl+L |
| Pen annotations (transient) | Have (M9): pen + erase, not saved | Ctrl+P, E |
| Presenter view (notes, next, timer, clock) | Have | `PresenterView` |
| Separate presenter window | Have (M9): `window.open` + BroadcastChannel | `PresenterWindow` |
| Hidden (skipped) slides excluded | Have (M7) | `showSlides` |
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
| Video / audio embed | Have (M11) | `media.ts`, `ObjectViews.MediaBody`; upload or YouTube/Vimeo/direct URL |

### 2.17 Import / export

OnlyOffice: conversion is server-side C++ (`core/X2tConverter`, `core/OOXML`,
`core/OdfFile`) — pptx/ppsx/potx/ppt/odp/otp/pdf/images; the JS side has
`fromToJSON.js` (3,880) for a JSON mirror of the OOXML model.

| Feature | Grown | Where |
| --- | --- | --- |
| Export pptx | Have (M1). Animations are not exported | `pptx/write.ts` |
| Export pdf | Have (M12): a PDF file built in the browser, plus File ▸ Print | `pdfExport.ts`, `pdfWriter.ts` |
| Export txt / html / jpg / png / svg | Have; every slide as a zip since M12 | `export.ts` |
| Export odp | Have (M12) | `odp/write.ts` |
| Import pptx / Import slides | Have (M1). All slides are appended; there is no slide picker | `pptx/read.ts`, File ▸ Import slides, Slides home ▸ Upload .pptx |
| Open from Drive (`/slides/:id`) | Partial (M1). "Open in Slides" makes an editable copy of a .pptx | `EditorPlaceholder.tsx` |

### 2.18 Print

| Feature | Grown | Where |
| --- | --- | --- |
| Print (via pdf path) | Have | `actions.print` |
| Print preview / handouts (N per page) / notes pages | Have (M12): full slides, notes pages, handouts 1/2/3/4/6/9, outline | `PrintDialog.tsx`, `printLayout.ts` |

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
| Keyboard-shortcuts dialog | Have (M13): Ctrl+/, searchable, generated from `shortcuts.ts` | `A11yDialogs.tsx` |

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

- ~~Element animations (`p:timing`) are neither written nor read, so
  M8 is needed.~~ (resolved in M8, see §6.12)
- ~~Per-run formatting is lost~~ (resolved in M4, see §6.8).
- Underline on a hyperlinked run is dropped on import, because it can't be
  told apart from the hyperlink style.
- ~~Table merges and per-cell styles are not kept; table styles
  (`tableStyleId`) are ignored.~~ (resolved in M5, see §6.9)
- Gradients import as their first stop, and pattern fills as their
  foreground colour (slide backgrounds keep their gradient since M7).
- ~~Image crop (`srcRect`) is ignored.~~ (resolved in M6, see §6.10)
- Group rotation is ignored.
- Custom geometry other than a straight segment is drawn as a rect or
  dropped.
- ~~Hidden slides are imported as visible.~~ (resolved in M7, see §6.11)
- ~~Slide size is not stored in `DeckDoc`, so non-16:9 decks are
  letterboxed.~~ (resolved in M7, see §6.11)
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
- Enter in a title placeholder makes a paragraph (placeholders exist
  since M7, but the title's Enter-as-line-break is not wired); equation
  line breaks are out of scope.
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

- ~~Style colours are the Office theme's, not the deck's theme (Grown has
  no theme yet, M7); a pptx whose theme recolours accents shows Office
  colours.~~ (resolved in M7: styles take the deck theme's colours.) Only the nine styles above are in the gallery; other built-in
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

### 6.11 M7 status (Wave 5): layouts, theme, slide properties

**Model (additive, §4.5 / F3).** `DeckDoc` gains `theme` (colour scheme
`dk1…folHlink`, fonts `major`/`minor`, `dark` for the bg↔dk colour map),
`layouts` (template slides whose elements carry `placeholder {type, idx}`:
title/ctrTitle/subTitle/body/obj/pic/dt/ftr/sldNum), `size` (`{w: 960, h}`;
absent = 16:9) and `hf` (header & footer: date auto/fixed, footer text,
slide number, start number, not on title slides). `Slide` gains `layout`,
`bgFill` (gradient stops + angle/radial, or a picture), `bgRef`, `hidden`
and `hf` (per-slide switches). Elements gain `placeholder` and
`themeRefs` (`fill`/`stroke`/`color` → a scheme slot with optional
DrawingML modifiers, e.g. `tx1/lumMod:65000/lumOff:35000`; `font` →
`major`/`minor`). **Deviation from §4.5:** colours stay literal hex on
the element and the ref sits beside them, instead of `fill:
"theme:accent1"` tokens resolved at render time. Every renderer and
export keeps reading hex, older clients still draw the deck, and a theme
change re-resolves only ref'd properties (`theme.applyTheme`), so
explicit colours are kept by construction. An edit that sets an explicit
value drops that ref (`reconcileRefs`, applied on every local upsert).
Layouts are applied by copying (no inheritance); only the date/footer/
number boxes are drawn from the layout at render time (`withFooters`).

The slide height is a live binding: `model.setCanvasSize` sets
`CANVAS_H` for the open deck (540 for 16:9, 720 for 4:3), so the geometry,
snapping, align-to-slide and export helpers keep their signatures; the
pptx reader and writer take the size from the deck. The table styles
(`tableStyles.tableTemplates/findTableTemplate`) are built per theme and
default to the open deck's (`theme.setActiveTheme`), which closes the M5
gap: styled tables follow the deck theme.

**Modules.**

- `theme.ts`: 8 built-in themes (Office — the implicit default, with
  Arial — Simple Light, Simple Dark, Streamline, Focus, Coral, Forest,
  Slate; three are dark), ref parse/format/resolve through
  `lib/colorMods` and the colour map, palette tints/shades,
  `applyTheme`, `reconcileRefs`, `withColorRef`/`withFontRef`.
- `layouts.ts`: PowerPoint's standard layouts (Title slide, Title and
  content, Section header, Two content, Comparison, Title only, Content
  with caption, Blank; ids = the pptx layout types) generated from the
  theme and slide height; `slideFromLayout`, `applyLayout` (placeholders
  paired by family then idx/order move to the layout boxes and keep
  content; missing ones added empty; empty unmatched ones removed;
  filled ones kept), `resetSlide`, `nextPlaceholder` (Ctrl+Enter),
  `nextLayoutFor` (Ctrl+M: current layout; a title slide → title and
  content), header & footer (`hfFlags`, `footerElements`, `withFooters`),
  `newLayoutDeck`.
- `slideProps.ts`: size presets (16:9, 16:10, 4:3, A4) and custom inches,
  `resizeDeck` with Ensure fit / Maximize (boxes, fonts, runs and insets
  scale; content centred), background CSS, set/apply-to-all backgrounds,
  `toggleHidden`, `showSlides` (the slideshow's visible slides with
  footers, and where to start).
- `DesignDialogs.tsx`: theme gallery + Edit theme (12 colour slots,
  heading/body fonts, dark), layout grid (thumbnails with placeholder
  boxes and prompts), Page setup, Background (colour or theme colour,
  two-stop gradient with direction or radial, picture upload; Reset to
  theme; Apply to all), Header & footer (Apply / Apply to all), theme
  colour palette.

**Editor.** New decks start from the Title slide layout; empty
placeholders show their prompt (dashed box, editor only) and nothing in
thumbnails, the slideshow or exports. With nothing selected the toolbar
shows Background, Layout ▾ and Theme (Google Slides); the rail's New
slide has a layout ▾. Slide menu: New slide with layout, Skip slide
(checked; the rail marks the thumbnail "Skipped"), Apply layout (the
current one checked), Reset slide, Edit theme, Change theme; View ▸
Theme builder; Insert ▸ Slide numbers… / Header & footer…; File ▸ Page
setup. Shapes get a theme-colour ▾ next to Fill. Ctrl/Cmd+Enter selects
the next placeholder (also from inside a text box) and after the last
one adds a slide and selects its first placeholder. The slideshow plays
the visible slides only, with the header/footer boxes. A new `deck` collab
op carries whole-deck changes (theme, size, header & footer, undo/redo);
the `slides` op now keeps deck props, and so do `mapSlide` and
find/replace (they used to rebuild `{slides}` only).

**pptx.** Writer: the theme's colour scheme and name go into
`theme1.xml`, its fonts through pptxgenjs `theme`, and a dark theme swaps
the master `p:clrMap`. When any slide uses a layout, every deck layout
becomes a pptx slide layout (pptxgenjs `defineSlideMaster`, then
`patchLayoutXml` writes `@type`, the background and typed placeholders
with their text styles; decorations are not written because slides carry
copies). Slides link to their layout, placeholders are tagged `p:ph`,
theme refs are written as `a:schemeClr` (+ modifiers) and `+mj-lt`/
`+mn-lt`, the slide size follows `DeckDoc.size`, hidden slides get
`show="0"`, gradient and theme-colour backgrounds are patched into
`p:bg` (pictures via pptxgenjs), and the header/footer boxes are written
as `dt`/`ftr`/`sldNum` placeholders (`a:fld type="slidenum"`, and
`datetime1` for an automatic date). Reader: `DeckDoc.theme` (a built-in
theme when name, colours, fonts and colour map match, else "imported"),
every layout of every master (ids = layout types where they are
Grown's; placeholders read with their resolved styles and empty text;
decorations and background included; an empty untyped layout — pptxgenjs's
default — is skipped), slide `layout`, empty placeholders kept (they were
dropped), `placeholder` and `themeRefs` on elements (scheme fill/outline
colours from `spPr` or the shape style, text colour and theme fonts from
the element-wide run), `size` instead of pillar-boxing, `hidden`,
gradient/picture backgrounds as `bgFill` (a picture background used to
become a full-slide image element), background `bgRef`, and header &
footer from the slides' `dt`/`ftr`/`sldNum` placeholders (deck switch =
any slide shows it, per-slide overrides for the rest, "not on title
slide" when every title slide lacks them). Upload .pptx / Open in Slides
save the whole deck; File ▸ Import slides scales the imported slides to
the open deck's size and keeps only layout ids the deck has.

**Tests.** `theme.test.ts` (7), `layouts.test.ts` (10),
`slideProps.test.ts` (7), `pptx/design.test.ts` (10: XML for scheme
colours, theme part, colour map and backgrounds; a themed 4:3 deck with
every M7 feature through deckToPptx → readPptx; a double round trip; a
dark theme; `show="0"`, fields and 9 layout parts; a legacy deck stays
layout-free; resize then export), additions to `deckOps.test.ts`,
`pptx/read.test.ts` (4:3 size, empty placeholder kept, picture
background) and `pptx/importDeck.test.ts`; e2e `web/e2e/slides-theme.spec.ts`
(prompts on a new deck, Ctrl+Enter across placeholders into a new slide,
Coral theme, Two content layout, Skip slide, slide numbers, reload, the
slideshow skips the hidden slide; and a Focus-themed deck across five
layouts with a theme-coloured shape, screenshot via
`GROWN_SLIDES_M7_SHOT`). `slides.spec.ts` now expects the Title and
content placeholders on a new slide.

**Ported (now passing):** `shortcuts.js#Check actions for objects with
placeholder` (#12), in `layouts.test.ts` (reducer) and
`slides-theme.spec.ts` (e2e).

**Not done / gaps.**

- #1 `Check actions with slides` (multi-slide selection, Move slide
  submenu) and sections (`DeckDoc.sections`) are not done; Slide ▸ Move
  slide is still a stub.
- Enter in a title placeholder still makes a paragraph (#13's title
  case).
- No master editor (F3): editing a layout means editing
  `DeckDoc.layouts` data; there is no UI to change a layout's
  placeholders. Edit theme edits colours and fonts only (no effects or
  background styles).
- Runs don't carry theme refs: a run coloured differently from its box
  keeps its hex on a theme change. Table cell colours and table/cell
  borders are literal (the table *styles* follow the theme).
- Theme colour picking is on shape fill and backgrounds only; the text
  colour and outline pickers still set hex (an imported or layout ref is
  kept until one of them sets an explicit value).
- Layout decorations are not written to pptx layouts (slides carry
  copies), so a Grown export's layouts have placeholders only.
- The slide width is always 10 in in pptx (only the aspect ratio round
  trips); A4 is 10 × 6.92 in rather than 10.83 × 7.5 in.
- Pattern fills and multi-stop gradient editing in the Background dialog
  (two stops only; imported multi-stop gradients are kept).
- Hidden slides are still exported to HTML/PDF and numbered (as in
  PowerPoint).

### 6.12 M8 status (Wave 6): transitions and animations

**Model (additive).** `Slide` gains `transitionDir` (the pptx `dir`
value, or `black`, `vert-out`, `in`/`out`… per type), `transitionDur`
(ms), `advanceOnClick` (false = clicks don't advance) and `advanceAfter`
(ms), and `anims: AnimEffect[]` — the slide's effect list in play order
(`{id, el, cls: entr|emph|exit, kind, start: click|with|after, delay,
dur, dir, byPara, scale, color, angle}`). `TransitionType` keeps the
pre-M8 `slide-left/right/up` names (read as push from right/left/bottom).
The pre-M8 per-element `animation {type, order}` is still read:
`animOps.effectsOf` turns it into click effects (equal orders play
together); the first edit in the animation pane writes `anims` and drops
the old fields. Duplicating a slide copies its effects onto the new ids.

**Modules.**

- `transitions.ts`: the catalogue — fade (smooth / through black), push,
  wipe, cover (×4 directions), uncover (×4), split (vertical/horizontal,
  in/out), reveal (left/right), zoom (in/out), dissolve, cut, morph —
  with default durations; `transitionFx` maps a slide to CSS animations
  for an incoming and an outgoing layer (and which is on top);
  `morphPairs`/`morphStyle` are morph-lite (F7): matched elements (same
  name, else same id, else same text/picture/shape+fill) tween from the
  old box with `translate`/`scale`, the rest crossfade.
- `animOps.ts`: the effect catalogue (entrance/exit: appear, fade, fly,
  float, wipe, zoom; emphasis: pulse, colour pulse, teeter, spin,
  grow/shrink), pane edits (add to the selection — first on click, the
  rest with it — update, move earlier/later, remove, remap), the timeline
  (`buildTimeline`: group 0 plays when the slide appears, each "on
  click" opens a group, "with previous" starts with the previous effect,
  "after previous" when everything so far in the group has ended, then
  each effect's delay; by-paragraph text becomes one step per non-empty
  paragraph), and `framesAt` (per element or paragraph at a step: hidden
  until an entrance plays, hidden after an exit, a finished grow keeps its
  scale; the triggered group carries CSS animations whose delays are the
  begin times). Keyframes use the individual `translate`/`scale`/`rotate`
  properties, so they compose with the element's own rotation, and wipes
  use a mask so a shape's clip path is untouched. Exits play the entrance
  keyframes in reverse.

**Editor.** A **Motion** side panel (Slide ▸ Transition…, Insert ▸
Animation, View ▸ Motion): transition type, option, duration, "On mouse
click", "After N s", Apply to all slides, Preview (plays in the panel's
preview from the previous slide); Add animation (Entrance / Emphasis /
Exit menu, enabled with a selection); the animation pane lists effects
with their click number, class colour, target and start marker, with
move earlier/later and remove, and a Play button that runs the slide's
steps back to back. Selecting an effect selects its element and opens its
editor: class, effect, direction, start, duration, delay, by paragraph
(text), size (grow/shrink), colour (colour pulse), Preview effect. With
an effect selected, Delete removes the effect and not the shape (#10).

**pptx** (`pptx/motionXml.ts`). The writer emits `p:transition` for every
type (`p:pull` for uncover, `p:split orient dir`, `p:zoom dir`,
`thruBlk`), `advClick="0"`/`advTm`, and — for a custom duration, reveal
and morph — `mc:AlternateContent` with a `p14:dur` / `p14:reveal` /
`p159:morph` Choice and a classic Fallback. Slides with effects are
marked so `patchElements` reports each element's `cNvPr@id`, and
`p:timing` is written after the transition: the main sequence with one
`par` per click group (group 0 starts `onBegin`), one sub-`par` per
click/after chain, and per effect a `cTn` with PowerPoint's
`presetID`/`presetClass`/`presetSubtype`/`nodeType`/delay and the
behaviours PowerPoint writes (`set style.visibility`, `animEffect`
fade/wipe filters, `anim ppt_x/ppt_y/ppt_w/ppt_h`, `animScale`,
`animRot`, `animClr`), `p:txEl/p:pRg` for paragraphs and `p:bldP`
(`build="p"`). The reader picks a known `mc:Choice` (else the
Fallback), maps spd to a duration when it isn't the type's default, maps
presets back (duration = the behaviours' span, doubled for auto-reverse),
turns a shape read as two elements into two effects (the second "with"),
merges consecutive paragraph effects into a by-paragraph effect, and
approximates other presets (checkerboard, bounce, …) as fade/pulse and
skips motion paths and trigger sequences with a warning.

**Tests.** `transitions.test.ts` (6: legacy names, defaults, every
type/option → existing keyframes, directions and layering, morph
matching and tween maths), `animOps.test.ts` (14: legacy read, add/
update/move/remove, remap, labels, with/after chains with delays, group 0
auto effects, default durations, by-paragraph, frames before/while/after
each step, CSS for every catalogue entry), `pptx/motion.test.ts` (9:
every transition type/option written and read, p14:dur + fallback +
advance, speeds and extension effects, transition/timing placement,
every catalogue effect with starts/delays/durations/options through
deckToPptx → readPptx and a double round trip, the timing tree shape
and spids, legacy element animations exported, a hand-written foreign
timing with a motion path and paragraph builds); `pptx/read.test.ts`
and `pptx/roundtrip.test.ts` now expect the M8 form (push + direction).

**Ported (now passing):** `shortcuts.js#Check remove graphic objects
(animation effect)` in `animOps.test.ts` (an effect is removed and its
shape stays).

**Gaps.** Motion paths (F8) and 3-D/GL transitions (F7) are not
offered; morph is the crossfade + matched-element tween above (no shape
or text morphing). The other OnlyOffice/PowerPoint effects (blinds,
checkerboard, bounce, wheel…; transitions such as clock, shape, random
bars) import as the nearest supported one. No triggers ("on click of
shape"), repeat/rewind, sound, or "after animation" dimming. Effects on
group members are not offered, and effects on groups are not written to
pptx. Transition and effect durations are exact in pptx only through
p14:dur and the effect's `cTn@dur` (odd auto-reverse durations round to
2 ms). The editor canvas does not animate: previews play in the Motion
panel's preview box.

### 6.13 M9 status (Wave 6): slideshow and presenter

**Show (`SlideShow.tsx`, `presentOps.ts`).** Present (current slide), a
▾ menu with Present from beginning / from current slide / Presenter view /
Loop until Esc, View ▸ Slideshow, Slideshow from beginning, Presenter
view and Loop; F5 / Ctrl+Shift+F5 from the beginning, Shift+F5 / Ctrl+F5
from the current slide. Hidden slides are skipped (M7's `showSlides`).
`presentReduce`: next plays the slide's remaining click steps, then moves
on; past the last slide it loops (`DeckDoc.show.loop`) or shows "End of
slide show" (a further next exits); prev undoes the last step (shown
settled), else goes to the previous slide fully built; Home/End; digits
then Enter go to that slide, Enter alone is next; B or . / W or , toggle
a black/white screen that the next navigation clears. Keys
(`keymap.presentKeyAction`): N, →, ↓, Space, PgDn, Enter / P, ←, ↑,
PgUp, Backspace / Home / End / digits / B . W , / S (in-page presenter
view) / Ctrl+L laser pointer / Ctrl+P pen / E erase ink / Esc (leaves a
tool first, then the show); everything but Esc is preventDefault-ed (so
Ctrl+P doesn't print). A click advances unless the slide turns "On
mouse click" off or the pen is on; `autoAdvanceDelay` advances "after
N s" measured from the slide start but never before the playing step has
ended (remaining click steps then play back to back). Transitions play
when moving forward (next or a loop), with group-0 effects held until
the transition ends. Pen ink is an SVG overlay per slide for the show's
lifetime (not saved). A hover toolbar has previous/next, laser, pen,
Presenter window and Presenter view (S).

**Presenter view.** `PresenterView` shows the current slide at its
current step, the next slide, speaker notes, elapsed time, the clock and
"Slide n / N" (plus the step and a black/white screen chip), with
Previous / Next (step) / Black. "Presenter window" (and Present ▾ ▸
Presenter view) opens `/slides/d/:id/presenter` with `window.open`: the
new window posts `hello` on a `BroadcastChannel`
(`grown-slides-show:<deck>`), the audience window answers with the show's
slides (hidden ones removed, footers drawn in) and slide height, then
sends its state on every change; the presenter window sends navigation
commands and `exit`, and closes when the show ends. When the pop-up is
blocked, the in-page presenter view (the pre-M9 single-window mode, S)
is used instead.

**Tests.** `presentOps.test.ts` (17: steps per slide, step playing,
prev rebuild, end screen and exit, loop both ways, number + Enter, black/
white, goto clamps, with/after chains as one click, hidden slides,
auto-advance timing, click switch, elapsed format, channel message
validation), `keymap.test.ts` (the show key table and preventDefault);
e2e `web/e2e/slides-show.spec.ts` sets a push transition (applied to
all) and three effects in the Motion panel (fade on click, fly in from
left after previous, spin on the next click), reorders in the pane,
checks the saved model, presents from the beginning (3 of 4 slides: one
hidden), checks entrances hidden before the click and the after-previous
delay, steps with →/N/Space, B, End/Home, 2 + Enter and P, draws and
erases pen ink, shows the laser, opens the presenter window (counter,
notes, timer, next slide; Next and ←/→ there drive the show), ends with
Esc (the window closes) and checks the single-window presenter view.
`GROWN_SLIDES_M8_SHOT=<prefix>` saves the animation pane, a transition,
ink and the presenter window.

**Ported (now passing):** `shortcuts.js#Check actions with catch events`
(was `it.skip`): the slideshow half through the key map and the reducer
on 12 slides — Right/Down/Space/Enter/PgDn, Left/Up/PgUp, Home, End,
5/8/1 0 + Enter, Enter alone, Esc. The editor half (Ctrl+P print,
Shift+F10 context menu) stays M13; Ctrl+K is covered since M4.

**Gaps.** Internal slide links in the show were already honoured (M4);
there is no "Set up slide show" dialog (kiosk mode, show a range,
custom shows), no rehearse timings/recording, no highlighter or
per-colour pens, ink is not kept, and the presenter window has no
thumbnails strip or zoom. The presenter window shows the next *slide*,
not the next animation step. BroadcastChannel needs both windows on the
same origin and browser profile.

### 6.15 M11 status (Wave 7): charts, diagrams, media, word art

**Charts.** `type: "chart"` elements carry `chart: SlideChart` — the
Sheets `ChartConfig` options (type, title, stacking, legend, data labels,
series in rows, per-series options, axes, waterfall totals, hole size)
minus the workbook range/anchor, plus the chart's own data sheet
(`data[0]` = series names, column 0 = categories, strings as typed). No
chart code is duplicated: `chartElement.chartConfigOf` builds a Sheets
`ChartConfig` over the whole grid and `chartInputOf` reads it through the
new `chartData.buildChartInputFromGrid` (the workbook reader's grid core,
split out), `ChartRenderer` draws it, and the pptx writer/reader use
`xlsx/xlsxCharts`. The Sheets chart modules stay in `pages/sheets/`
(`ChartRenderer` depends on the Sheets number formats), so a move to a
common module was not cleanly separable; Slides imports them. Series (pie:
slice) colours without an explicit colour take the deck theme's accent
cycle at render time (`themeSeriesColor` over the M7 theme), so a theme
change recolours charts. All ten Sheets chart types are offered.
`ChartDialog` (Insert ▸ Chart…, and Bar/Column/Line/Pie; double-click,
toolbar "Edit chart", Format ▸ Chart data…) edits type, title, legend,
stacking, data labels, series in rows and the data grid (add/remove
rows and series, paste a tab/comma block into any cell; ≤ 200 × 30) with
a live preview. Embedded spreadsheet editing stays out (F9).

**pptx charts.** A chart is laid down as a marker shape and swapped for a
`p:graphicFrame` (rotation/flips kept) pointing at `ppt/charts/chartN.xml`.
The part is `xlsxCharts.chartSpaceXml` over "Sheet1" with two additive
options: `c:strCache`/`c:numCache` for every series, category and name
(blank points left out) and `c:externalData` pointing at
`ppt/embeddings/Microsoft_Excel_WorksheetN.xlsx`, the data sheet written
by the Sheets xlsx writer (numbers as numbers). The Grown extension entry
carries the `SlideChart` itself (not the theme-resolved config), so Grown
reads back exactly what it wrote and theme colours are not pinned. A
foreign chart is rebuilt by `readChartSpace` (type, grouping, legend,
axes, colours…) plus the new `readChartCache` (series names, categories,
values, scatter x). chartEx (waterfall/funnel/treemap as `cx:chart`) is
not read: its `mc:Fallback` shape imports as usual.

**SmartArt-lite (F6's additive alternative).** `diagrams.ts` parses an
outline (one item per line; tabs or two-space indents give the level; a
leading `-`/`*`/`•` is dropped; a level jumps at most one) and builds a
group of M3 presets + text boxes + connectors: basic list (rounded blocks
in a grid), process (boxes and arrows), cycle (circles with tangent
arrows), hierarchy (org chart: leaf-count layout, elbow lines from
connectors), pyramid (triangle + trapezoids whose adjust matches the tier
above) and Venn (50 % translucent circles). Sub-items are listed in their
node ("• item") except in the hierarchy, where they are child boxes. All
labels share one fitted size. Colours are theme refs (`accent1…6`, tints
via lumMod/lumOff, `lt1` text, a grey `tx1` tint for lines), so
`applyTheme` recolours diagrams. The group stores `diagram {layout,
outline}`; the outline panel (`DiagramDialog`: layout buttons, outline
textarea where Tab/Shift+Tab indent, live preview; Insert ▸ Diagram…,
double-click, "Edit outline", Format ▸ Diagram outline…) rebuilds the
group's members inside its current box, and resizing a diagram rebuilds
it at the new size (`refitDiagram`, on every local upsert) so its text
refits. Diagrams are ordinary groups in every renderer and export, and
are written to pptx as `p:grpSp`. **Import:** a SmartArt graphic frame
is read from its cached drawing (`dsp:drawing`, found through the data
part's `dsp:dataModelExt@relId`, else the slide's only `diagramDrawing`
relationship) as a shape tree in the frame's coordinates, and becomes a
group; the diagram data itself is not kept.

**Media.** `type: "media"` elements carry `media: SlideMedia` (`kind`
video/audio, `src`, `embed {provider, id}` for YouTube/Vimeo, `poster`,
`mime`, `autoplay`, `loop`, `muted`). Insert ▸ Video…/Audio… uploads a
file (client allowlist MP4/WebM/Ogg/MOV/MP3/M4A/AAC/WAV, ≤ 100 MB) to the
M6 asset endpoint, or takes a link (`media.parseMediaUrl`: YouTube
watch/short/embed/shorts URLs, Vimeo, or a direct http(s) media file;
other pages and schemes are refused). A video's poster frame is captured
in the browser (a frame ~10 % in, drawn to a canvas, uploaded as a JPEG
asset) and its box takes the clip's aspect; YouTube clips use the
provider's thumbnail. **Server:** `internal/slides/assets.go` now sniffs
clips too (`sniffAsset`: ISO-BMFF brands for MP4 vs M4A, WebM, Ogg with
or without Theora, WAVE, MP3 with or without ID3, ADTS AAC), caps clips
at `MaxMediaBytes` (100 MiB; pictures stay at 20 MiB) and serves them
with byte ranges (`http.ServeContent`) so players can seek. In the
editor and thumbnails a clip is its poster with a play badge (audio: a
speaker); in the slideshow it plays: a native `<video>`/`<audio>` with
controls (autoplay/loop/mute as set), or the YouTube (nocookie)/Vimeo
player in a frame — framed at once when autoplaying, else after a click
on the poster. Clicks on a clip don't advance the show. Playback options:
Format ▸ Playback…, the "Playback" toolbar button, double-click.
**pptx:** pptxgenjs `addMedia` embeds uploaded clips (inlined like
pictures by `assets.inlineImages`, which now also inlines clip files and
posters) with the poster as the cover, and links online/direct clips;
the patch writes `a:audioFile` for audio (pptxgenjs writes `a:videoFile`
for both; linked audio gets an `audio` relationship) and the playback
options in a Grown `p:nvPr` extension. The reader turns a `p:pic` with
`a:videoFile`/`a:audioFile` into a clip: the embedded file (`p14:media`,
≤ 100 MB, browser-playable types) as a data: URL — uploaded to the asset
store on import by `externalizeImages`, which now handles clips — or the
linked URL (YouTube/Vimeo recognised), the poster from the blip, and the
Grown options.

**Word art (F5's cheap subset).** Text boxes gain `wordArt` (outline,
two-stop gradient fill with a DrawingML angle, shadow, glow, warp).
Effects are CSS on a wrapper of the text body (`-webkit-text-stroke`,
`background-clip: text`, and `filter: drop-shadow` for shadow and glow,
which sits behind a clipped gradient where `text-shadow` would not).
Warps are the presets an SVG `textPath` can draw with the text as one
line: arch up/down (elliptical arcs with the ends leaning in 25°),
circle, wave, slant up/down; text shorter than the path is centred at its
width, longer text is squeezed (`textLength`), a circle is filled.
`wordArt.warpSvgMarkup` is the single SVG used by the editor, slideshow
and exports. Insert ▸ Word art adds a styled box; Format ▸ Word art… (and
the "Word art" toolbar button on a text box) has five styles plus each
effect and the warp. **pptx:** every run gets `a:ln`, `a:gradFill`
(instead of the solid fill) and `a:effectLst` (`a:glow`, `a:outerShdw`,
alpha from 8-digit hex) in schema order, and the body `a:prstTxWarp`;
the reader maps the first run's effects and a supported warp back.

**Exports.** HTML/PDF and SVG/PNG/JPEG draw charts, clips and warps as
pictures (`exportObjects.objectsToPictures`: the chart rendered to SVG by
`ChartRenderer` via `react-dom/server`, the poster or a placeholder, the
warp SVG); unwarped word art keeps its CSS in HTML and becomes SVG text
attributes (gradient defs, stroke, filter) in the SVG export.

**Tests.** `chartElement.test.ts` (11), `diagrams.test.ts` (18),
`media.test.ts` (9), `wordArt.test.ts` (10), `pptx/objects.test.ts`
(13: chart frame/part/caches/workbook/content types, exact round trip,
theme colours not pinned, a foreign chart from XML + caches, pie/line/
scatter double round trip with rotation; embedded video with poster and
options, linked YouTube, embedded + linked audio as `a:audioFile`; word
art XML order and round trip; a diagram group; a hand-built SmartArt
frame read from its `dsp:drawing`); `pptx/read.test.ts` expects the new
chart warning; Go `assets_test.go` (clip sniffing for 9 formats, refused
types, size limits per kind, byte ranges). e2e
`web/e2e/slides-objects.spec.ts`: insert a chart and edit its grid,
switch type through the editor, a process diagram edited through the
outline panel (Tab indents), word art retyped and warped, reload and
check the model, canvas and thumbnail
(`GROWN_SLIDES_M11_SHOT=<file.png>` saves the slide); a WebM recorded in
the page uploaded as a video (refused non-media file first, poster frame,
16:9 box), playback options, a YouTube link, byte ranges, and the
slideshow (looping muted autoplay player, a click doesn't advance, the
YouTube player starts on click). `slides-show.spec.ts` now waits for the
pen (`data-tool` on the slideshow) before drawing ink.

**Ported (now passing):** `shortcuts.js#Check select all in chart title`
(#11, grown-variant: the title is edited in the chart dialog, where
Ctrl+A selects all of it) in `slides-objects.spec.ts`; the chart step of
`shortcuts.js#Check remove graphic objects` in `arrange.test.ts`.
`common/charts/chartEx-serialize.js` stays n/a (it compares
Altova-generated XML for OnlyOffice's own serializer; Grown writes
`c:chart`, not `cx:chart`), as in Sheets.

**Gaps.** No chart editing on the canvas (select a series, click a title
to type, drag the plot) and no linked "chart from Sheets"; chartEx and
3-D charts import only as their fallback. Diagrams: six layouts, no
per-node styling that survives an outline edit (a rebuild restyles), no
SmartArt data model (imported SmartArt is a plain group), no text-pane
editing on the canvas. Media: autoplay/loop/mute round-trip only through
Grown's extension (PowerPoint's `p:timing` media nodes are neither
written nor read), no trimming, fades, volume or bookmarks, no "play
across slides", and uploads of big clips are buffered in memory (≤ 100
MiB) on the server; imported embedded clips larger than the upload limit
stay inline in the deck. Word art: six warps of PowerPoint's 40, one text
line per warp, effects apply to the whole box (runs can't differ), the
glow/shadow of a gradient text in the SVG export uses a CSS filter that
some SVG viewers ignore, and the in-place text editor shows plain text
while editing.

### 6.16 M12 status (Wave 7): export and print

**One page model, three outputs.** `printLayout.ts` (pure, in points)
decides which slides print (all, the current one, or a custom range such
as "1-3, 5, 8-"; hidden slides only when asked, though the current slide
always prints) and where they go:

- **Full slides:** one 720 pt page per slide, at the deck's aspect.
- **Notes pages:** portrait paper, with the slide on top and the notes below.
- **Handouts:** 1, 2, 3, 4, 6 or 9 slides per page, in horizontal or
  vertical order. With 3 per page, each slide gets 7 ruled lines for notes.
- **Outline:** titles and body text with list levels, tables row by row,
  and alt text. It is paginated by estimated height.

Handouts and outline pages carry the deck title in a header. Every paper
page is numbered. Paper is Letter or A4. The frame, include-hidden and
grayscale options apply to every layout.

`printRender.ts` draws each page as one SVG. Slides are nested with their
ids prefixed, so several slides can share a page, and grayscale is an SVG
colour-matrix filter. The page SVG serves three outputs:

- **Print preview:** the Print dialog.
- **Print window:** inline SVG, so the browser prints vectors ("Save as
  PDF" gives a vector PDF).
- **PDF file:** `pdfExport.deckToPdf` rasterizes each page at 144 dpi
  (JPEG) and `pdfWriter.ts` writes it. `pdfWriter.ts` is a small PDF 1.4
  writer written from ISO 32000; it adds no dependency, because pdf-lib
  lives only in `pdf/`. Each page gets an invisible Helvetica text layer
  (text boxes, table cells, notes, outline and headers, WinAnsi-encoded),
  so the PDF is searchable and copyable. It also gets URI link
  annotations for web and mail links (on a shape, or on a text run),
  and a UTF-16 title.

File ▸ Download ▸ PDF now downloads that file (all slides, hidden ones
included) instead of opening the print dialog. File ▸ Print and Ctrl+P
open the Print dialog, which has a live preview with page navigation,
Print and Download PDF.

**SVG export fidelity (also PNG/JPEG/PDF).** SVG text used to be one
`<tspan>` per paragraph with no wrapping. `svgText.layoutTextLines` now
breaks lines as the HTML renderer does:

- word wrap at the box width, breaking a single over-long word between
  characters, and `\v` line breaks;
- insets, paragraph indents and list markers in the hanging indent;
- alignment, line spacing, space before/after and vertical anchoring.

Widths come from canvas `measureText`, with an estimate outside the
browser. Rotation and flips now apply to text, pictures, tables and the
legacy shapes; presets already carried their own. Alt text becomes an
SVG `<title>`. Links without a colour use the link colour. PNG/JPEG
export at 1920 px wide (it was 960).

**More formats.** PNG, JPEG or SVG of every slide as a zip
(`slide-01.png`…). ODP is written by `odp/write.ts` with jszip (ODF 1.3,
`mimetype` stored first) and supports:

- text with runs, alignment, insets and links;
- every preset, as the renderer's own path, with fill/stroke/dash/shadow,
  plus lines and connectors with arrowheads;
- rotation about the centre, and flattened groups;
- `Pictures/` (SVG included) with alt text;
- tables with merges, fills and borders;
- notes, hidden slides, colour/gradient/picture backgrounds, footers and
  the loop setting.

Charts, clips and warped word art arrive as pictures (through
`objectsToPictures`, like the other picture exports). The output opens
in LibreOffice Impress, checked by converting to PDF with `soffice`.

**Each export path was checked against M1–M11.** `exportPaths.test.ts`
builds a deck with every feature: runs, bullets, a table, a rotated
preset, a group, a picture with alt text, a chart, a video, gradient and
warped word art, a SmartArt-lite diagram and a gradient background. It
checks that each one reaches:

- the SVG (and so PNG/JPEG and the PDF picture);
- the HTML export;
- the print pages, including the text layer and link areas.

pptx has its round-trip suite (M1–M11) and ODP its writer tests.

**Tests.**

- `printLayout.test.ts` (19): range parsing, hidden/current/custom
  selection, every layout's page count and geometry (the 1–9 grids with
  no overlaps and all boxes on the page, order, A4), outline pagination
  and extraction.
- `svgText.test.ts` (7).
- `pdfWriter.test.ts` (4). This includes opening the file with pdf.js:
  page count, MediaBoxes, the text layer, only safe links, and the title.
- `exportPaths.test.ts` (5).
- `odp/write.test.ts` (20).
- e2e `slides-export.spec.ts`:
  - A feature-rich deck downloads as a PDF: 3 pages, 720×405 pt, the
    title and table text in the text layer, and every page picture
    non-blank.
  - It downloads as a PNG (1920×1080, non-blank), as a zip of 3 PNGs,
    and as ODP.
  - Ctrl+P opens the Print dialog: the page count without the hidden
    slide, then 3-per-page handouts with the hidden slide (one portrait
    page, 3 slides, ruled lines), a bad and a good custom range, and a
    notes-pages PDF (2 Letter pages holding each slide's notes).
  - `GROWN_SLIDES_M12_SHOT=<prefix>` saves the handouts preview, the
    PDF, its first page picture and the ODP.

**Gaps.**

- The downloaded PDF is a picture per page under a text layer, not
  vector. The vector route is Print ▸ "Save as PDF".
- The PDF text layer uses standard Helvetica and WinAnsi, so text in
  other scripts is left out of it (it is still in the picture).
- SVG text uses system fonts: web fonts don't load inside an SVG image.
  Vertical text is laid out horizontally in the SVG/PDF path.
- ODP gaps:
  - list markers are literal text, not `text:list`;
  - gradients keep only two stops;
  - crop and word-art effects are dropped;
  - there is no ODP import.
- The print window prints what the preview shows. Browser print settings
  (margins, scale) can still shrink it.
- "Convert to video" is out of scope (declined in the plan).

### 6.17 M13 status (Wave 7): shortcuts, accessibility, polish

**Shortcut suite: 23/23 tagged.** `#Check actions with slides` (#1) is no
longer skipped. The slide rail is now a keyboard-operable multi-select
list: pure `railOps.ts` handles selection moves, ranges and Ctrl/Shift
clicks, moves a non-contiguous selection ±1 or to the start/end, and
deletes it (one blank slide is kept). `keymap.railKeyAction` maps:

| Keys | Action |
| --- | --- |
| Up/Down, Left/Right, PgUp/PgDn, Home/End | Move |
| Shift + any of those | Extend the selection |
| Ctrl+Up/Down | Move the selected slides one place |
| Ctrl+Shift+Up/Down | Move them to the start/end |
| Delete/Backspace | Delete them |
| Ctrl+A | Select all slides |
| Enter or Ctrl+M | New slide |
| Ctrl+D | Duplicate |
| Ctrl+Shift+H | Hide/unhide |

The OnlyOffice sequence is replayed in `railOps.test.ts`.

The last two cases are new:

- `#Check prevent default` (#9): NumLock, ScrollLock and Ctrl+= are
  swallowed. Ctrl+=/-/0 now drive a real editor zoom (0.25–4×, also View
  ▸ Zoom, fit by default, the stage scrolls), so the page zoom doesn't
  scale the toolbars.
- `#Check show paragraph marks (grown-variant)` (#16): Ctrl+Shift+8
  toggles ¶ marks when no text is selected, and View ▸ Show paragraph
  marks does the same. Grown keeps Google's Ctrl+Shift+8 = bulleted list
  when text boxes are selected or being edited.

**Shortcut list.** `shortcuts.ts` holds 52 rows in 5 groups (general,
slides, objects, text, slideshow). It is our own table; `events.js` was
read only for coverage. 46 rows carry a probe key press, and
`shortcuts.test.ts` checks each probe against `keymap.ts`, so the list
can't drift from the key maps. Help ▸ Keyboard shortcuts and Ctrl+/
open a searchable dialog of real `<table>`s with row headers. On macOS
it shows ⌘/⌥/⇧. It replaces the `window.alert`.

**Keyboard-only operation.**

- F6 and Shift+F6 move between the slide rail, the canvas and the
  speaker notes.
- The canvas is focusable: clicking it gives it focus. Tab and Shift+Tab
  cycle through its objects, and still move between toolbar controls
  elsewhere.
- Enter or F2 edits the selected text box, with the caret at the start.
- Esc leaves the text box, the object stays selected and focus returns to
  the canvas. A second Esc deselects.
- The arrow keys nudge.
- The rail keeps a roving tabindex: the current slide is the tab stop,
  and the other slides are reached with the arrow keys.

**ARIA and names.** Pure `a11y.ts` builds the accessible names:
`elementKind`/`elementLabel` ("Title: …", "Picture: <alt>", "Shape:
Star", "Chart: pie", "Table, 2 rows by 3 columns", "Group of 3 objects"),
`slideLabel` ("Slide 3 of 10: Title, hidden") and
`selectionAnnouncement`.

- The rail is a `listbox` (`aria-multiselectable`). Its items are
  `option`s with `aria-selected` and `aria-current`.
- The canvas is a `region` (`aria-roledescription="slide"`, named "Slide
  N of M, editing canvas") with a hidden usage hint.
- Non-text objects are `img` (groups: `group`) named by their alt text.
- A polite live region announces selection changes.
- The print, shortcut and outline dialogs are labelled.

**Outline view** (View ▸ Outline and accessibility…, Tools ▸
Accessibility check…):

- Each slide is an `h3` with a "Go to slide" button. Its body text is in
  properly nested lists, followed by its notes.
- An accessibility check lists pictures, charts and clips without alt
  text (`missingAltText`, group members included). Each links to the Alt
  text dialog.
- It shares `slideOutline` with the printed outline.

**High contrast and focus.** Rail items and the canvas have
`:focus-visible` rings in Joy's focus colour. Under `forced-colors:
active` the current or selected thumbnail and the selected objects
outline in `Highlight`.

**Reduced motion.** With `prefers-reduced-motion: reduce` the slideshow
skips slide transitions, and effects show their end state at once.
Timings, auto-advance and click steps are unchanged.

**Clipboard (the `copypaste` suite, extended).**

- Copy now also writes `text/html`: text boxes as `<p>` or nested
  `<ul>`/`<ol>` with `<strong>/<em>/<u>/<s>/<sup>/<sub>/<a>` and colour,
  tables as `<table>`, and pictures as `<img alt>`. Docs (and other
  editors) paste rich text.
- The HTML root carries the internal payload (`data-grown-slides`), so a
  browser that drops custom clipboard types still pastes real elements.
- Pasting HTML from Docs, Google Docs or the web (`htmlToElements`,
  DOMParser):
  - a lone table becomes a table, and lone pictures become pictures;
  - anything else becomes one text box with runs (bold, italic,
    underline, strike, super/sub, colour, safe links);
  - when every paragraph is a list item it becomes a list, with levels.
- Elements pasted from another deck bring their pictures and clip
  posters into this deck's asset store (`assets.rehomeAssets`), so
  people who can open only this deck still see them.

**Tests.**

| File | Tests | Covers |
| --- | ---: | --- |
| `railOps.test.ts` | 5 | #1 |
| `keymap.test.ts` | 23 | #9, #16, Enter/F2, F6, zoom and rail keys |
| `shortcuts.test.ts` | 48 | Every probed row (46), plus table and formatting checks |
| `a11y.test.ts` | 5 | Accessible names |
| `clipboard.test.ts` | 13 | 6 new |
| `assets.test.ts` | 3 | `rehomeAssets` |
| `geometry.test.ts` | +1 | `zoomStep` |

e2e `slides-keyboard.spec.ts` covers:

- Rail roles and names, then Down, Shift+Down, Ctrl+Up and
  Ctrl+Shift+Down reorders, all persisted, and End + Delete.
- F6 to the canvas region, Tab through the objects with the live
  announcements and the picture's alt-text name, and arrow and
  Shift+arrow nudges.
- Shift+Tab, Enter to edit and type, Esc back to the canvas, and Esc to
  deselect.
- F6 to the notes and round to the rail.
- Ctrl+= zoom and Ctrl+0 fit, and Ctrl+Shift+8 paragraph marks (the ¶
  pseudo-element).
- The Ctrl+/ dialog and its search.
- The outline dialog: headings, missing alt text and notes, then going
  to a slide.
- A second test copies a formatted text box between two decks through
  the system clipboard, pastes it into a Grown doc (bold kept) and
  pastes the doc's paragraph back into a deck (bold run kept).

axe-core is not installed in `web/e2e`, so the accessibility checks are
targeted role and name assertions rather than an axe scan.

**Gaps.**

- There is no Alt+/ menu search in Slides yet (Docs has one).
- No full audit of the toolbar was run. Menus are Joy's, with their own
  roles.
- There is no in-group selection by keyboard (Tab stops at the group).
- There is no keyboard resize or rotate: use Format ▸ Size & rotation.
- The outline view is read-only: it is not an editable outline pane.
- Copying slides between decks from the rail is not implemented yet.
  Objects paste; whole slides do not.
- The MotionPanel preview ignores reduced motion. Only the slideshow
  honours it.

