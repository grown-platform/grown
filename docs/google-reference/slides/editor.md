# Google Slides Editor — Menu Reference

> Captured from docs.google.com/presentation/create on 2026-06-09.
> Existing-doc capture: `/presentation/d/17_5vmx_kJPcGh5BbsjIftUr-uMozhayBVwKXkGcrjlM/edit`
> Live probe artifacts: `grown-workspace/research/gworkspace-frontend/pass3/slides_editor/menus/`
> `grown-workspace/research/gworkspace-frontend/pass3/slides_existing/menus/`
>
> **Extraction method:** Live Playwright click/right-click probes (pass-3 harness) against
> an authenticated Chromium session on 2026-06-09. All menubar menus and context menus
> captured by actually opening them. 44 artifacts from slides_editor + 47 from slides_existing.
>
> **Framework:** Slides shares the Kix/Punch framework with Docs. Most menu IDs use the
> standard `#docs-{name}-menu` pattern. Slides-specific menus use unique IDs:
> `#punch-slide-menu` (Slide) and `#sketchy-arrange-menu` (Arrange).
>
> **Disabled items** reflect state at capture time (blank new presentation, no object selected).

---

## Menubar structure

The menubar (`id="docs-menubar"`, `role="menubar"`) contains:

`File` | `Edit` | `View` | `Insert` | `Format` | `Slide` | `Arrange` | `Tools` | `Extensions` | `Help`

Compared to Docs: Slides adds **Slide** (`id="punch-slide-menu"`) and **Arrange** (`id="sketchy-arrange-menu"`),
and does not have a separate Data menu (that is Sheets-only).

---

## File menu

**Trigger:** Click `id="docs-file-menu"`.

**Source:** `pass3/slides_editor/menus/menu-file.{html,json,png}` (19 items, captured 2026-06-09)

| #   | Label                  | Shortcut | Has submenu | Disabled | Notes                                                |
| --- | ---------------------- | -------- | ----------- | -------- | ---------------------------------------------------- |
| 1   | New                    | —        | yes ▸       | —        | Presentation / Document / Spreadsheet / Form         |
| 2   | Open                   | Ctrl+O   | —           | —        | Drive file picker                                    |
| 3   | Import slides          | —        | —           | —        | Import from PPTX, another Slides file, or Drive      |
| 4   | Make a copy            | —        | yes ▸       | —        | Copy / Copy of current slide / Duplicate as template |
| 5   | Share                  | —        | yes ▸       | —        | Share / Publish to web / Email                       |
| 6   | Email                  | —        | yes ▸       | yes      | Email as attachment / collaborators                  |
| 7   | Download               | —        | yes ▸       | —        | See Download submenu                                 |
| 8   | Approvals              | (F2)     | —           | yes      | Workflow approvals (Workspace Business+)             |
| 9   | Convert to video       | —        | —           | yes      | Export slideshow as MP4 (disabled on blank)          |
| 10  | Rename                 | —        | —           | —        | Inline title rename                                  |
| 11  | Move to trash          | —        | —           | yes      | Disabled on new/unsaved                              |
| 12  | Version history        | —        | yes ▸       | yes      | Disabled on new presentation                         |
| 13  | Make available offline | —        | —           | —        |                                                      |
| 14  | Details                | (B)      | —           | yes      | Presentation info                                    |
| 15  | Security limitations   | —        | —           | yes      | IRM status                                           |
| 16  | Language               | —        | yes ▸       | —        | Language selector                                    |
| 17  | Page setup             | —        | —           | —        | Slide dimensions / aspect ratio                      |
| 18  | Print preview          | —        | —           | —        | Full-screen print preview                            |
| 19  | Print                  | Ctrl+P   | —           | —        |                                                      |

### Download → submenu (Slides)

| #   | Label                                          | Notes |
| --- | ---------------------------------------------- | ----- |
| 1   | Microsoft PowerPoint (.pptx)                   |       |
| 2   | ODP Document (.odp)                            |       |
| 3   | PDF Document (.pdf)                            |       |
| 4   | Plain Text (.txt)                              |       |
| 5   | JPEG Image (.jpg, current slide)               |       |
| 6   | PNG Image (.png, current slide)                |       |
| 7   | Scalable Vector Graphics (.svg, current slide) |       |

---

## Edit menu

**Trigger:** Click `id="docs-edit-menu"`.

**Source:** `pass3/slides_editor/menus/menu-edit.{html,json,png}` (10 items, captured 2026-06-09)

| #   | Label                    | Shortcut     | Has submenu | Disabled | Notes                       |
| --- | ------------------------ | ------------ | ----------- | -------- | --------------------------- |
| 1   | Undo                     | Ctrl+Z       | —           | —        |                             |
| 2   | Redo                     | Ctrl+Y       | —           | —        |                             |
| 3   | Cut                      | Ctrl+X       | —           | yes      | Disabled (nothing selected) |
| 4   | Copy                     | Ctrl+C       | —           | yes      | Disabled (nothing selected) |
| 5   | Paste                    | Ctrl+V       | —           | —        |                             |
| 6   | Paste without formatting | Ctrl+Shift+V | —           | —        |                             |
| 7   | Select all               | Ctrl+A       | —           | —        |                             |
| 8   | Delete                   | —            | —           | yes      | Disabled (nothing selected) |
| 9   | Duplicate                | Ctrl+D       | —           | yes      | Disabled (nothing selected) |
| 10  | Find and replace         | Ctrl+H       | —           | —        |                             |

---

## View menu

**Trigger:** Click `id="docs-view-menu"`.

**Source:** `pass3/slides_editor/menus/menu-view.{html,json,png}` (11 items, captured 2026-06-09)

| #   | Label             | Shortcut             | Has submenu | Disabled | Notes                                  |
| --- | ----------------- | -------------------- | ----------- | -------- | -------------------------------------- |
| 1   | Mode              | (S)                  | yes ▸       | —        | Editing / Suggesting / Viewing         |
| 2   | Slideshow         | (P) Ctrl+F5          | —           | —        | Starts presentation from current slide |
| 3   | Slides recordings | (T)                  | —           | —        | Slides with recorded audio/video       |
| 4   | Motion            | (A) Ctrl+Alt+Shift+B | —           | —        | Motion panel for animations            |
| 5   | Theme builder     | —                    | —           | —        | Full theme editor                      |
| 6   | Comments          | (J)                  | yes ▸       | —        | Show all / Expanded / Collapsed        |
| 7   | Guides            | —                    | yes ▸       | —        | Show guides / Edit guides              |
| 8   | Snap to           | (X)                  | yes ▸       | —        | Snap to guides / grid / other objects  |
| 9   | Live pointers     | —                    | yes ▸       | —        | Show laser pointer / Mouse pointers    |
| 10  | Zoom menu         | —                    | yes ▸       | —        | 50%, 75%, 100%, 125%, 150%, 200%, Fit  |
| 11  | Full screen       | —                    | —           | —        |                                        |

### Mode → submenu

| #   | Label      | Notes                           |
| --- | ---------- | ------------------------------- |
| 1   | Editing    | Default mode — full edit access |
| 2   | Suggesting | Track-changes-style suggestions |
| 3   | Viewing    | Read-only view                  |

---

## Insert menu

**Trigger:** Click `id="docs-insert-menu"`.

**Source:** `pass3/slides_editor/menus/menu-insert.{html,json,png}` (22 items, captured 2026-06-09)

| #   | Label                | Shortcut   | Has submenu | Disabled | Notes                                                           |
| --- | -------------------- | ---------- | ----------- | -------- | --------------------------------------------------------------- |
| 1   | Help me visualize 🍌 | (J)        | yes ▸       | —        | Gemini AI image generation                                      |
| 2   | Image                | —          | yes ▸       | —        | Upload / Camera / URL / Drive / Photos / Google Search          |
| 3   | Text box             | —          | —           | —        | Draw a text box on the slide                                    |
| 4   | Shape                | —          | yes ▸       | —        | Shapes / Arrows / Callouts / Equations                          |
| 5   | Building blocks      | —          | —           | —        | Smart chips and building block templates                        |
| 6   | Diagram              | —          | yes ▸       | —        | Grid / Hierarchy / Timeline / Process / Relationship / Cycle    |
| 7   | Table                | —          | yes ▸       | —        | Size picker (rows × columns, up to 20×20)                       |
| 8   | Chart                | —          | yes ▸       | —        | Bar / Column / Line / Pie / From Sheets                         |
| 9   | Line                 | (Q)        | yes ▸       | —        | Line / Arrow / Elbow / Curved / Polyline / Scribble / Connector |
| 10  | Word art             | —          | —           | —        | Outline text element                                            |
| 11  | Speaker spotlight    | (F)        | —           | —        | Webcam overlay for presenter                                    |
| 12  | Video                | —          | —           | —        | YouTube / Drive video embed                                     |
| 13  | Audio                | —          | —           | —        | Drive audio embed                                               |
| 14  | Special characters   | —          | —           | yes      | Disabled (no text box selected)                                 |
| 15  | Animation            | —          | —           | yes      | Disabled (no object selected)                                   |
| 16  | Link                 | Ctrl+K     | —           | yes      | Disabled (no object selected)                                   |
| 17  | Comment              | Ctrl+Alt+M | —           | —        |                                                                 |
| 18  | New slide            | Ctrl+M     | —           | —        | Appends a blank slide                                           |
| 19  | Create a slide       | (Z)        | yes ▸       | —        | Create slide from template / AI                                 |
| 20  | Templates            | —          | —           | —        | Insert a template slide                                         |
| 21  | Slide numbers        | —          | —           | —        | Insert slide number placeholder                                 |
| 22  | Placeholder          | —          | yes ▸       | yes      | Disabled (no theme placeholder)                                 |

### Image → submenu

| #   | Label                | Notes                     |
| --- | -------------------- | ------------------------- |
| 1   | Upload from computer |                           |
| 2   | Search the web       | Google Image Search       |
| 3   | Drive                | Insert from Google Drive  |
| 4   | Photos               | Insert from Google Photos |
| 5   | By URL               | Paste an image URL        |
| 6   | Camera               | Take a photo with webcam  |

### Shape → submenu

| Category  | Examples                                                                      |
| --------- | ----------------------------------------------------------------------------- |
| Shapes    | Rectangle, circle, triangle, diamond, parallelogram, trapezoid, and many more |
| Arrows    | Right arrow, left arrow, up arrow, bent arrows, etc.                          |
| Callouts  | Rectangular callout, oval callout, cloud callout, etc.                        |
| Equations | Plus, minus, multiply, divide, equals, not-equal                              |

---

## Format menu

**Trigger:** Click `id="docs-format-menu"`.

**Source:** `pass3/slides_editor/menus/menu-format.{html,json,png}` (9 items, captured 2026-06-09)

All items disabled when no object is selected (blank presentation state at capture time).

| #   | Label                    | Shortcut | Has submenu | Disabled | Notes                                               |
| --- | ------------------------ | -------- | ----------- | -------- | --------------------------------------------------- |
| 1   | Text                     | (S)      | yes ▸       | yes      | Bold, Italic, Underline, Strikethrough, Size        |
| 2   | Align & indent           | —        | yes ▸       | yes      | Left/Center/Right/Justify, Increase/Decrease indent |
| 3   | Line & paragraph spacing | —        | yes ▸       | yes      | Line height + Before/After paragraph spacing        |
| 4   | Bullets & numbering      | —        | yes ▸       | yes      | List type picker                                    |
| 5   | Table                    | (2)      | yes ▸       | yes      | Insert/delete rows, columns, merge cells            |
| 6   | Image                    | —        | yes ▸       | yes      | Crop, Replace, Alt text, Recolor                    |
| 7   | Borders & lines          | (Q)      | yes ▸       | yes      | Border weight, color, dash style                    |
| 8   | Format options           | (\)      | —           | yes      | Side panel: Size, Position, Drop shadow, Reflection |
| 9   | Clear formatting         | Ctrl+\   | —           | yes      | Disabled (nothing selected)                         |

---

## Slide menu _(Slides-specific)_

**Trigger:** Click `id="punch-slide-menu"`.

**Source:** `pass3/slides_editor/menus/menu-slide.{html,json,png}` (13 items, captured 2026-06-09)

| #   | Label                | Shortcut | Has submenu | Disabled | Notes                                                             |
| --- | -------------------- | -------- | ----------- | -------- | ----------------------------------------------------------------- |
| 1   | New slide            | Ctrl+M   | —           | —        | Append blank slide                                                |
| 2   | Create a slide       | (Z)      | yes ▸       | —        | Create from template / AI / layout                                |
| 3   | Beautify as image 🍌 | —        | —           | —        | Gemini-powered slide redesign                                     |
| 4   | Templates            | —        | —           | —        | Insert a template slide                                           |
| 5   | Duplicate slide      | —        | —           | —        | Copy current slide                                                |
| 6   | Delete slide         | —        | —           | —        | Remove current slide                                              |
| 7   | Skip slide           | —        | —           | —        | Hide slide from presentation without deleting                     |
| 8   | Move slide           | —        | yes ▸       | yes      | Move to beginning/end/specific position (disabled — single slide) |
| 9   | Change background    | —        | —           | —        | Opens background panel (color, image, video)                      |
| 10  | Apply layout         | —        | yes ▸       | —        | Thumbnail picker for slide layouts                                |
| 11  | Transition           | —        | —           | —        | Opens Transitions panel (animation between slides)                |
| 12  | Edit theme           | —        | —           | —        | Opens the master/theme editor                                     |
| 13  | Change theme         | —        | —           | —        | Theme gallery dialog                                              |

---

## Arrange menu _(Slides-specific)_

**Trigger:** Click `id="sketchy-arrange-menu"`.

**Source:** `pass3/slides_editor/menus/menu-arrange.{html,json,png}` (8 items, captured 2026-06-09)

All items disabled when no object is selected on the canvas.

| #   | Label          | Shortcut         | Has submenu | Disabled | Notes                                                         |
| --- | -------------- | ---------------- | ----------- | -------- | ------------------------------------------------------------- |
| 1   | Order          | —                | yes ▸       | yes      | Bring to front / Bring forward / Send backward / Send to back |
| 2   | Align          | —                | yes ▸       | yes      | Left / Center / Right / Top / Middle / Bottom edges           |
| 3   | Distribute     | —                | yes ▸       | yes      | Horizontally / Vertically (requires ≥2 objects)               |
| 4   | Center on page | —                | yes ▸       | yes      | Horizontally / Vertically                                     |
| 5   | Rotate         | —                | yes ▸       | yes      | Rotate 90° CW/CCW, Flip H/V                                   |
| 6   | Image          | —                | yes ▸       | yes      | Crop / Replace / Alt text / Recolor                           |
| 7   | Group          | Ctrl+Alt+G       | —           | yes      | Group selected objects                                        |
| 8   | Ungroup        | Ctrl+Alt+Shift+G | —           | yes      | Ungroup a group                                               |

---

## Tools menu

**Trigger:** Click `id="docs-tools-menu"`.

**Source:** `pass3/slides_editor/menus/menu-tools.{html,json,png}` (8 items, captured 2026-06-09)

| #   | Label                 | Shortcut     | Has submenu | Disabled | Notes                                     |
| --- | --------------------- | ------------ | ----------- | -------- | ----------------------------------------- |
| 1   | Spelling              | —            | yes ▸       | —        | Spell check / Enable autocorrect          |
| 2   | Linked objects        | —            | —           | —        | Manage linked charts/tables from Sheets   |
| 3   | Dictionary            | Ctrl+Shift+Y | —           | —        | Lookup word meaning                       |
| 4   | Q&A history           | —            | —           | —        | Audience Q&A session history              |
| 5   | Notification settings | —            | —           | —        | Email notifications for this presentation |
| 6   | Preferences           | —            | —           | —        | Auto-capitalization, smart quotes, etc.   |
| 7   | Accessibility         | —            | —           | —        | Screen reader settings                    |
| 8   | Activity dashboard    | (Z)          | yes ▸       | yes      | View tracking (Workspace Business+)       |

### Spelling → submenu

| #   | Label              | Notes                     |
| --- | ------------------ | ------------------------- |
| 1   | Spell check        | Opens spell-check UI      |
| 2   | Enable autocorrect | Toggle autocorrect on/off |

---

## Extensions menu

**Trigger:** Click `id="docs-extensions-menu"`.

**Source:** `pass3/slides_editor/menus/menu-extensions.{html,json,png}` (2 items, captured 2026-06-09)

| #   | Label       | Has submenu | Notes                                              |
| --- | ----------- | ----------- | -------------------------------------------------- |
| 1   | Add-ons     | yes ▸       | Get add-ons / Manage add-ons / (installed add-ons) |
| 2   | Apps Script | —           | Opens the bound Apps Script editor                 |

### Add-ons → submenu

| #             | Label                   | Notes             |
| ------------- | ----------------------- | ----------------- |
| 1             | Get add-ons             | Marketplace       |
| 2             | Manage add-ons          | Installed add-ons |
| _(installed)_ | (each installed add-on) |                   |

**Note:** Slides does not show a Macros submenu (unlike Sheets). The extensions menu is
leaner — no AppSheet or Data Studio integrations at presentation-editor level.

---

## Help menu

**Trigger:** Click `id="docs-help-menu"`.

**Source:** `pass3/slides_editor/menus/menu-help.{html,json,png}` (6 items, captured 2026-06-09)

| #   | Label               | Shortcut | Notes                     |
| --- | ------------------- | -------- | ------------------------- |
| 1   | Search the menus    | Alt+/    |                           |
| 2   | Slides Help         | —        | Google Slides Help Center |
| 3   | Training            | —        | Workspace training        |
| 4   | Updates             | —        | What's new in Slides      |
| 5   | Help Slides improve | —        | Feedback                  |
| 6   | Keyboard shortcuts  | Ctrl+/   |                           |

**Note:** Slides Help menu does not include "Ask Gemini for help" item (which is present in
Sheets/Docs help menus). Gemini integration in Slides is via the Insert and Slide menus.

---

## Slide thumbnail filmstrip right-click context menu

**Trigger:** Right-click on a slide thumbnail in the filmstrip panel (left sidebar).
The filmstrip uses `.punch-filmstrip-scroll` as the scrollable container.

**Source:** `pass3/slides_editor/menus/slide-thumb-context.{html,json,png}` (15 items, captured 2026-06-09)

| #   | Label                    | Shortcut     | Has submenu | Notes                       |
| --- | ------------------------ | ------------ | ----------- | --------------------------- |
| 1   | Cut                      | Ctrl+X       | —           |                             |
| 2   | Copy                     | Ctrl+C       | —           |                             |
| 3   | Paste                    | Ctrl+V       | —           |                             |
| 4   | Paste without formatting | Ctrl+Shift+V | —           |                             |
| 5   | Delete                   | —            | —           | Delete current slide        |
| 6   | New slide                | Ctrl+M       | —           | Append blank slide          |
| 7   | Create a slide           | —            | yes ▸       | Create from template / AI   |
| 8   | Templates                | —            | —           | Insert template slide       |
| 9   | Duplicate slide          | —            | —           |                             |
| 10  | Skip slide               | —            | —           | Hide from presentation      |
| 11  | Change background        | —            | —           | Background panel            |
| 12  | Apply layout             | —            | yes ▸       | Layout picker               |
| 13  | Change theme             | —            | —           | Theme gallery               |
| 14  | Transition               | —            | —           | Transitions panel           |
| 15  | Comment                  | Ctrl+Alt+M   | —           | Add a comment to this slide |

The `slides_existing` capture showed 17 items (includes "Move to" which appears when
multiple slides are present).

---

## Slide canvas right-click context menu

**Trigger:** Right-click on the main slide canvas (`id="canvas"`).

**Source:** `pass3/slides_editor/menus/canvas-context.{html,json,png}` (13 items, captured 2026-06-09)

The canvas context menu varies based on what is selected. Capture was taken with nothing
selected (but a default title text placeholder was present on a new slide).

| #   | Label                    | Shortcut     | Has submenu | Notes                                                         |
| --- | ------------------------ | ------------ | ----------- | ------------------------------------------------------------- |
| 1   | Cut                      | Ctrl+X       | —           | Disabled if nothing selected                                  |
| 2   | Copy                     | Ctrl+C       | —           | Disabled if nothing selected                                  |
| 3   | Paste                    | Ctrl+V       | —           |                                                               |
| 4   | Paste without formatting | Ctrl+Shift+V | —           |                                                               |
| 5   | Delete                   | —            | —           | Disabled if nothing selected                                  |
| 6   | Alt text                 | Ctrl+Alt+Y   | —           | Add alt text to selected object                               |
| 7   | Order                    | —            | yes ▸       | Bring to front / Bring forward / Send backward / Send to back |
| 8   | Rotate                   | —            | yes ▸       | Rotate 90° CW/CCW / Flip H/V                                  |
| 9   | Center on page           | —            | yes ▸       | Horizontally / Vertically                                     |
| 10  | Comment                  | Ctrl+Alt+M   | —           |                                                               |
| 11  | Link                     | Ctrl+K       | —           | Add hyperlink                                                 |
| 12  | Animate                  | —            | —           | Opens Animations panel                                        |
| 13  | Format options           | —            | —           | Size, Position, Drop shadow panel                             |

The `slides_existing` capture showed 15 items (adds "Refine" for AI improvement and
additional object-type-specific items).

---

## Toolbar reference

Slides uses the standard Kix toolbar above the slide canvas. Key controls:

| Control                      | Notes                     |
| ---------------------------- | ------------------------- |
| Undo / Redo                  |                           |
| Paint format                 | Copy formatting           |
| Zoom %                       | Percentage dropdown       |
| Insert image                 | Quick-insert image button |
| Text box                     | Draw text box             |
| Shape picker                 | Shapes dropdown           |
| Line tool                    | Line picker dropdown      |
| Background                   | Slide background picker   |
| Theme                        | Theme gallery             |
| Insert slide                 | New blank slide           |
| Slideshow                    | Start presentation        |
| Font                         | Font family dropdown      |
| Font size                    | Font size                 |
| Bold / Italic / Underline    |                           |
| Text color / Fill color      |                           |
| Border color / Border weight |                           |
| Align                        | H/V alignment dropdown    |
| Bullet list / Numbered list  |                           |
| Insert link                  | Ctrl+K                    |
| Insert comment               | Ctrl+Alt+M                |

---

## Share button (top-right)

Same as Docs editor share dialog. Slides additionally has a "Share a copy" option
and a "Publish to the web" option for embedding in iframes.
