# Google Sheets Editor — Menu Reference

> Captured from docs.google.com/spreadsheets/create on 2026-06-08.
> Existing-doc capture: `/spreadsheets/d/1hECLbKzwD43bzpwBSh7vY_OR4U0QJ1Mt5rxSuQtUdXo/edit`
> Live probe artifacts: `grown-workspace/research/gworkspace-frontend/pass3/sheets_editor/menus/`
>
> **Extraction method:** Live Playwright click/right-click probes (pass-3 harness) against
> an authenticated Chromium session on 2026-06-08. All 9 menubar menus and context menus
> captured by actually opening them. Prior pass-2 capture only captured Data, Extensions, Help
> from pre-rendered DOM; all other menus now confirmed from live capture.
>
> **Disabled items** reflect state at capture time (blank new spreadsheet, nothing selected).
> Item counts for each menu are the actual captured counts.

---

## Menubar structure

The menubar (`id="docs-menubar"`, `role="menubar"`) contains:

`File` | `Edit` | `View` | `Insert` | `Format` | `Data` | `Tools` | `Extensions` | `Help`

Sheets adds the **Data** menu (`id="w183"`) between Format and Tools.
This is the primary difference from the Docs menubar.

---

## File menu

**Trigger:** Click `id="docs-file-menu"`.

**Source:** `pass3/sheets_editor/menus/menu-file.{html,json,png}` (16 items, captured 2026-06-08)

| #   | Label                  | Shortcut | Has submenu | Disabled | Notes                                        |
| --- | ---------------------- | -------- | ----------- | -------- | -------------------------------------------- |
| 1   | New                    | —        | yes ▸       | —        | Spreadsheet / Document / Presentation / Form |
| 2   | Open                   | Ctrl+O   | —           | —        | Drive file picker                            |
| 3   | Import                 | —        | —           | —        | Import CSV, XLSX, ODS                        |
| 4   | Make a copy            | —        | —           | —        | Duplicate spreadsheet                        |
| 5   | Share                  | —        | yes ▸       | —        | Share / Publish / Email                      |
| 6   | Email                  | —        | yes ▸       | yes      | Email as attachment / collaborators          |
| 7   | Download               | —        | yes ▸       | —        | See Download submenu                         |
| 8   | Approvals              | (F2)     | —           | yes      | Workflow approvals (Workspace Business+)     |
| 9   | Rename                 | —        | —           | —        | Inline title rename                          |
| 10  | Move to trash          | —        | —           | yes      | Disabled on new/unsaved sheet                |
| 11  | Version history        | —        | yes ▸       | yes      | Disabled on new sheet                        |
| 12  | Make available offline | —        | —           | —        |                                              |
| 13  | Details                | (B)      | —           | yes      | Spreadsheet info                             |
| 14  | Security limitations   | —        | —           | yes      | IRM status                                   |
| 15  | Settings               | —        | —           | —        | Locale, timezone, calculation settings       |
| 16  | Print                  | Ctrl+P   | —           | —        |                                              |

### Download → submenu (Sheets)

| #   | Label                           | Notes              |
| --- | ------------------------------- | ------------------ |
| 1   | Microsoft Excel (.xlsx)         |                    |
| 2   | OpenDocument Spreadsheet (.ods) |                    |
| 3   | PDF Document (.pdf)             |                    |
| 4   | Web Page (.html, zipped)        |                    |
| 5   | Comma Separated Values (.csv)   | Current sheet only |
| 6   | Tab Separated Values (.tsv)     | Current sheet only |

---

## Edit menu

**Trigger:** Click `id="docs-edit-menu"`.

**Source:** `pass3/sheets_editor/menus/menu-edit.{html,json,png}` (9 items, captured 2026-06-08)

| #   | Label            | Shortcut | Has submenu | Disabled | Notes                               |
| --- | ---------------- | -------- | ----------- | -------- | ----------------------------------- |
| 1   | Undo             | Ctrl+Z   | —           | —        |                                     |
| 2   | Redo             | Ctrl+Y   | —           | —        |                                     |
| 3   | Cut              | Ctrl+X   | —           | —        |                                     |
| 4   | Copy             | Ctrl+C   | —           | —        |                                     |
| 5   | Paste            | Ctrl+V   | —           | —        |                                     |
| 6   | Paste special    | —        | yes ▸       | —        | Values / Format / Transposed / etc. |
| 7   | Move             | —        | yes ▸       | yes      | Disabled on new sheet               |
| 8   | Delete           | —        | yes ▸       | —        | Delete rows/columns/cells           |
| 9   | Find and replace | Ctrl+H   | —           | —        |                                     |

### Paste special → submenu

| #   | Label                       | Shortcut     | Notes                                   |
| --- | --------------------------- | ------------ | --------------------------------------- |
| 1   | Values only                 | Ctrl+Shift+V | Pastes data without formatting          |
| 2   | Format only                 | —            | Pastes formatting without data          |
| 3   | All except borders          | —            |                                         |
| 4   | Column widths only          | —            |                                         |
| 5   | Formula only                | —            |                                         |
| 6   | Data validation only        | —            |                                         |
| 7   | Conditional formatting only | —            |                                         |
| 8   | Transposed                  | —            | Swaps rows and columns                  |
| —   | _separator_                 |              |                                         |
| 9   | Paste link                  | —            | Creates a reference to the copied cells |

---

## View menu

**Trigger:** Click `id="docs-view-menu"`.

**Source:** `pass3/sheets_editor/menus/menu-view.{html,json,png}` (7 items, captured 2026-06-08)

| #   | Label         | Shortcut | Has submenu | Disabled | Notes                                                          |
| --- | ------------- | -------- | ----------- | -------- | -------------------------------------------------------------- |
| 1   | Show          | —        | yes ▸       | —        | Formula bar / Gridlines / Row & column headers / etc.          |
| 2   | Freeze        | —        | yes ▸       | —        | Freeze 1 row / 2 rows / 1 column / 2 columns / Up to row/col N |
| 3   | Group         | —        | yes ▸       | —        | Group rows / Group columns                                     |
| 4   | Comments      | (4)      | yes ▸       | —        | Show/hide comments                                             |
| 5   | Hidden sheets | —        | yes ▸       | yes      | List of hidden sheet tabs (disabled when none hidden)          |
| 6   | Zoom          | —        | yes ▸       | —        | 50%, 75%, 90%, 100%, 125%, 150%, 200%                          |
| 7   | Full screen   | —        | —           | —        |                                                                |

---

## Insert menu

**Trigger:** Click `id="docs-insert-menu"`.

**Source:** `pass3/sheets_editor/menus/menu-insert.{html,json,png}` (19 items, captured 2026-06-08)

| #   | Label            | Shortcut   | Has submenu | Disabled | Notes                                               |
| --- | ---------------- | ---------- | ----------- | -------- | --------------------------------------------------- |
| 1   | Cells            | —          | yes ▸       | —        | Insert cells and shift right / down                 |
| 2   | Rows             | —          | yes ▸       | —        | Rows above / Rows below                             |
| 3   | Columns          | —          | yes ▸       | —        | Columns to the left / right                         |
| 4   | Sheet            | Shift+F11  | —           | —        | Insert a new blank sheet tab                        |
| 5   | Generate a table | (V)        | —           | —        | AI-assisted table generation                        |
| 6   | Pre-built tables | —          | —           | —        | Insert a template table                             |
| 7   | Timeline         | —          | —           | —        | Insert a timeline view                              |
| 8   | Chart            | —          | —           | —        | Insert a chart                                      |
| 9   | Pivot table      | —          | —           | —        | Insert a pivot table                                |
| 10  | Image            | —          | yes ▸       | —        | In cell / Over cells                                |
| 11  | Drawing          | —          | —           | —        | Create a shape or text drawing                      |
| 12  | Function         | —          | yes ▸       | —        | SUM, AVERAGE, COUNT, MAX, MIN, and function browser |
| 13  | Link             | Ctrl+K     | —           | —        | Insert hyperlink                                    |
| 14  | Checkbox         | —          | —           | —        | Insert interactive checkbox                         |
| 15  | Dropdown         | —          | yes ▸       | —        | Insert dropdown list                                |
| 16  | Emoji            | —          | —           | —        | Insert an emoji                                     |
| 17  | Smart chips      | —          | yes ▸       | —        | @mention / Date / File / Place / Finance / Variable |
| 18  | Comment          | Ctrl+Alt+M | —           | —        |                                                     |
| 19  | Note             | Shift+F2   | —           | —        | Insert a cell note (non-threaded)                   |

---

## Format menu

**Trigger:** Click `id="docs-format-menu"`.

**Source:** `pass3/sheets_editor/menus/menu-format.{html,json,png}` (13 items, captured 2026-06-08)

| #   | Label                  | Shortcut   | Has submenu | Disabled | Notes                                           |
| --- | ---------------------- | ---------- | ----------- | -------- | ----------------------------------------------- |
| 1   | Theme                  | —          | —           | —        | Opens theme picker for sheet color scheme       |
| 2   | Number                 | —          | yes ▸       | —        | See Number submenu below                        |
| 3   | Text                   | —          | yes ▸       | —        | Bold, Italic, Underline, Strikethrough          |
| 4   | Alignment              | —          | yes ▸       | —        | Left/Center/Right, Top/Middle/Bottom            |
| 5   | Wrapping               | —          | yes ▸       | —        | Overflow / Wrap / Clip                          |
| 6   | Rotation               | —          | yes ▸       | —        | None / Tilt up/down / Stack vertically / Custom |
| 7   | Smart chips            | —          | yes ▸       | —        | Smart chip formatting options                   |
| 8   | Font size              | —          | yes ▸       | —        | Increase / Decrease font size                   |
| 9   | Merge cells            | —          | yes ▸       | yes      | Disabled — nothing selected                     |
| 10  | Convert to table       | Ctrl+Alt+T | —           | yes      | Disabled — nothing selected                     |
| 11  | Conditional formatting | —          | —           | —        | Opens conditional formatting sidebar            |
| 12  | Alternating colors     | —          | —           | —        | Apply zebra-striped background                  |
| 13  | Clear formatting       | Ctrl+\     | —           | —        |                                                 |

### Number → submenu

| #   | Label                | Notes                       |
| --- | -------------------- | --------------------------- |
| 1   | Automatic            | Default — auto-detects type |
| 2   | Plain text           | Treats all input as text    |
| —   | _separator_          |                             |
| 3   | Number               | 1,000.12                    |
| 4   | Percent              | 10.12%                      |
| 5   | Scientific           | 1.01E+03                    |
| 6   | Accounting           | $(1,000.12)                 |
| 7   | Financial            | (1,000.12)                  |
| 8   | Currency             | $1,000.12                   |
| 9   | Currency (rounded)   | $1,000                      |
| —   | _separator_          |                             |
| 10  | Date                 | e.g. 9/26/2008              |
| 11  | Time                 | e.g. 3:59:00 PM             |
| 12  | Date time            | e.g. 9/26/2008 15:59:00     |
| 13  | Duration             | e.g. 3:59:00                |
| —   | _separator_          |                             |
| 14  | Custom number format | Opens format dialog         |
| 15  | Custom date and time | Opens format dialog         |
| —   | _separator_          |                             |
| 16  | More formats         | Opens full format gallery   |

---

## Data menu _(Sheets-only)_

**Trigger:** Click `id="w183"` in menubar.

**Source:** `pass3/sheets_editor/menus/menu-data.{html,json,png}` (17 items, captured 2026-06-08)

This menu is unique to Sheets; it does not exist in Docs or Drive.

| #   | Label                     | Shortcut | Has submenu | Disabled | Notes                                                          |
| --- | ------------------------- | -------- | ----------- | -------- | -------------------------------------------------------------- |
| 1   | Analyze data              | —        | —           | yes      | AI-powered data insights (Workspace Business+ only at capture) |
| —   | _separator_               |          |             |          |                                                                |
| 2   | Sort sheet                | —        | yes ▸       | —        | Sort entire sheet by column A–Z / Z–A                          |
| 3   | Sort range                | —        | yes ▸       | yes      | Sort a selected range (disabled with no multi-cell selection)  |
| —   | _separator_               |          |             |          |                                                                |
| 4   | Create a filter           | —        | —           | —        | Adds filter dropdowns to selected range or whole sheet         |
| 5   | Create group by view      | —        | yes ▸       | —        | Group rows by a column value                                   |
| 6   | Create filter view        | —        | —           | —        | Named filter view (others see unfiltered)                      |
| 7   | Add a slicer              | —        | —           | —        | Visual filter control widget                                   |
| —   | _separator_               |          |             |          |                                                                |
| 8   | Protect sheets and ranges | —        | —           | —        | Opens protection panel                                         |
| 9   | Named ranges              | —        | —           | —        | Opens named ranges sidebar                                     |
| 10  | Named functions           | —        | —           | —        | Create reusable custom functions                               |
| 11  | Randomize range           | —        | —           | yes      | Shuffle rows randomly (disabled with no range selected)        |
| —   | _separator_               |          |             |          |                                                                |
| 12  | Column stats              | —        | —           | —        | Stats sidebar for selected column                              |
| 13  | Data validation           | —        | —           | —        | Validation rules for cell input                                |
| 14  | Data cleanup              | —        | yes ▸       | —        | Remove duplicates / Trim whitespace / Convert text to number   |
| 15  | Split text to columns     | —        | —           | —        | Parse delimited text in cells                                  |
| 16  | Data extraction           | —        | —           | —        | Extract from unstructured text                                 |
| —   | _separator_               |          |             |          |                                                                |
| 17  | Data connectors New       | —        | yes ▸       | —        | Connect to BigQuery, Looker, or other sources                  |

### Sort sheet → submenu

| #     | Label                                    | Notes                         |
| ----- | ---------------------------------------- | ----------------------------- |
| 1     | Sort sheet by column A (A to Z)          |                               |
| 2     | Sort sheet by column A (Z to A)          |                               |
| _(N)_ | Sort sheet by column [X] (A to Z/Z to A) | Dynamically lists all columns |

### Sort range → submenu

| #   | Label                           | Notes                       |
| --- | ------------------------------- | --------------------------- |
| 1   | Sort range by column A (A to Z) |                             |
| 2   | Sort range by column A (Z to A) |                             |
| 3   | Advanced range sorting options  | Opens multi-key sort dialog |

### Data cleanup → submenu

| #   | Label                  | Notes                           |
| --- | ---------------------- | ------------------------------- |
| 1   | Remove duplicates      | Deduplicate by selected columns |
| 2   | Trim whitespace        | Remove leading/trailing spaces  |
| 3   | Convert text to number | Parse numeric text strings      |

### Data connectors → submenu

| #   | Label               | Notes |
| --- | ------------------- | ----- |
| 1   | Connect to BigQuery |       |
| 2   | Connect to Looker   |       |
| 3   | Manage connections  |       |

**Source:** `pass3/sheets_editor/menus/menu-data.{html,json,png}` — live-captured 2026-06-08.

---

## Tools menu

**Trigger:** Click `id="docs-tools-menu"`.

**Source:** `pass3/sheets_editor/menus/menu-tools.{html,json,png}` (7 items, captured 2026-06-08)

| #   | Label                     | Shortcut | Has submenu | Disabled | Notes                                                     |
| --- | ------------------------- | -------- | ----------- | -------- | --------------------------------------------------------- |
| 1   | Create a new form         | —        | —           | —        | Creates a linked Google Form (responses go to this sheet) |
| 2   | Spelling                  | —        | yes ▸       | —        | Spell check / Enable autocorrect                          |
| 3   | Suggestion controls       | —        | yes ▸       | —        | Control suggestion/autocomplete behavior                  |
| 4   | Conditional notifications | (U)      | —           | —        | Set up conditional email alerts                           |
| 5   | Notification settings     | —        | yes ▸       | —        | Email notifications for changes                           |
| 6   | Accessibility             | —        | —           | —        | Screen reader settings                                    |
| 7   | Activity dashboard        | (Z)      | yes ▸       | yes      | View tracking (Workspace Business+)                       |

### Macros → submenu

| #   | Label         | Notes                          |
| --- | ------------- | ------------------------------ |
| 1   | Record macro  | Starts macro recording session |
| 2   | Manage macros | Edit/delete existing macros    |
| 3   | Import        | Import macro from Apps Script  |

---

## Extensions menu _(Sheets)_

**Trigger:** Click `id="docs-extensions-menu"`.

**Source:** `pass3/sheets_editor/menus/menu-extensions.{html,json,png}` (5 items, captured 2026-06-08)

| #   | Label       | Has submenu | Notes                                              |
| --- | ----------- | ----------- | -------------------------------------------------- |
| 1   | Add-ons     | yes ▸       | Get add-ons / Manage add-ons / (installed add-ons) |
| 2   | Macros      | yes ▸       | Record / Manage / Import macros                    |
| 3   | Apps Script | —           | Opens the bound Apps Script editor                 |
| 4   | AppSheet    | yes ▸       | Create / Manage AppSheet apps from this data       |
| 5   | Data Studio | (L) yes ▸   | Open / Create Looker Studio dashboards             |

### Add-ons → submenu

| #             | Label                   | Notes             |
| ------------- | ----------------------- | ----------------- |
| 1             | Get add-ons             | Marketplace       |
| 2             | Manage add-ons          | Installed add-ons |
| _(installed)_ | (each installed add-on) |                   |

### AppSheet → submenu

| #   | Label         | Notes                                                  |
| --- | ------------- | ------------------------------------------------------ |
| 1   | Create an app | Launch AppSheet builder with this sheet as data source |
| 2   | Manage apps   |                                                        |

### Data Studio → submenu

| #   | Label         | Notes                      |
| --- | ------------- | -------------------------- |
| 1   | Explore data  | Quick Looker Studio report |
| 2   | Create report | Full Looker Studio report  |

---

## Help menu _(Sheets)_

**Trigger:** Click `id="docs-help-menu"`.

**Source:** `pass3/sheets_editor/menus/menu-help.{html,json,png}` (8 items, captured 2026-06-08)

| #   | Label               | Shortcut | Notes                                       |
| --- | ------------------- | -------- | ------------------------------------------- |
| 1   | Search the menus    | Alt+/    |                                             |
| 2   | Ask Gemini for help | —        | Opens Gemini AI assistant (badge: New)      |
| 3   | Sheets Help         | —        | Google Sheets Help Center                   |
| 4   | Training            | —        | Workspace training                          |
| 5   | Updates             | —        | What's new in Sheets                        |
| 6   | Help Sheets improve | —        | Feedback                                    |
| 7   | Function list       | —        | Opens the Sheets function reference browser |
| 8   | Keyboard shortcuts  | Ctrl+/   |                                             |

---

## Cell right-click context menu

**Trigger:** Right-click on any cell in the grid.
The grid is a `<canvas>` element; the menu is DOM-injected on contextmenu event.

| #   | Label                         | Shortcut   | Has submenu | Notes                                           |
| --- | ----------------------------- | ---------- | ----------- | ----------------------------------------------- |
| 1   | Cut                           | Ctrl+X     | —           |                                                 |
| 2   | Copy                          | Ctrl+C     | —           |                                                 |
| 3   | Paste                         | Ctrl+V     | —           |                                                 |
| 4   | Paste special                 | —          | yes ▸       | Values / Format / Transposed / etc.             |
| —   | _separator_                   |            |             |                                                 |
| 5   | Insert N rows above           | —          | —           | N = rows selected                               |
| 6   | Insert N rows below           | —          | —           |                                                 |
| 7   | Insert N columns to the left  | —          | —           |                                                 |
| 8   | Insert N columns to the right | —          | —           |                                                 |
| —   | _separator_                   |            |             |                                                 |
| 9   | Delete row                    | —          | —           |                                                 |
| 10  | Delete column                 | —          | —           |                                                 |
| 11  | Delete cells                  | —          | yes ▸       | Shift up / Shift left                           |
| 12  | Clear row                     | —          | —           | Clears content, keeps row                       |
| 13  | Clear column                  | —          | —           |                                                 |
| —   | _separator_                   |            |             |                                                 |
| 14  | View more cell actions        | —          | yes ▸       | Format, Data validation, Conditional formatting |
| —   | _separator_                   |            |             |                                                 |
| 15  | Define named range            | —          | —           |                                                 |
| 16  | Protect range                 | —          | —           |                                                 |
| —   | _separator_                   |            |             |                                                 |
| 17  | Add comment                   | Ctrl+Alt+M | —           |                                                 |
| 18  | Insert link                   | Ctrl+K     | —           |                                                 |
| 19  | Insert note                   | Shift+F2   | —           |                                                 |
| 20  | Insert dropdown               | —          | —           |                                                 |
| 21  | Insert checkbox               | —          | —           |                                                 |
| —   | _separator_                   |            |             |                                                 |
| 22  | Edit named range              | —          | —           | (shown when cell is in a named range)           |
| 23  | Edit data validation          | —          | —           |                                                 |

**Note:** The cell context menu is rendered on-demand. Items shown above are canonical
for Google Sheets; confirmed with live capture needed.

---

## Column header right-click context menu

**Trigger:** Right-click on a column letter header (A, B, C, etc.).

| #   | Label                        | Has submenu | Notes                  |
| --- | ---------------------------- | ----------- | ---------------------- |
| 1   | Cut                          | —           |                        |
| 2   | Copy                         | —           |                        |
| 3   | Paste                        | —           |                        |
| 4   | Paste special                | yes ▸       |                        |
| —   | _separator_                  |             |                        |
| 5   | Insert 1 column to the left  | —           |                        |
| 6   | Insert 1 column to the right | —           |                        |
| —   | _separator_                  |             |                        |
| 7   | Delete column                | —           |                        |
| 8   | Clear column                 | —           |                        |
| —   | _separator_                  |             |                        |
| 9   | Resize column                | —           | Dialog for exact width |
| 10  | Fit to data                  | —           | Auto-size column       |
| 11  | Hide column                  | —           |                        |
| —   | _separator_                  |             |                        |
| 12  | Sort sheet A to Z            | —           |                        |
| 13  | Sort sheet Z to A            | —           |                        |
| 14  | Sort range A to Z            | —           |                        |
| 15  | Sort range Z to A            | —           |                        |
| —   | _separator_                  |             |                        |
| 16  | Group columns                | —           |                        |
| 17  | Create filter                | —           |                        |
| —   | _separator_                  |             |                        |
| 18  | Column stats                 | —           | Opens stats sidebar    |
| 19  | Define named range           | —           |                        |

---

## Row header right-click context menu

**Trigger:** Right-click on a row number (1, 2, 3, etc.).

| #   | Label              | Has submenu | Notes                   |
| --- | ------------------ | ----------- | ----------------------- |
| 1   | Cut                | —           |                         |
| 2   | Copy               | —           |                         |
| 3   | Paste              | —           |                         |
| 4   | Paste special      | yes ▸       |                         |
| —   | _separator_        |             |                         |
| 5   | Insert 1 row above | —           |                         |
| 6   | Insert 1 row below | —           |                         |
| —   | _separator_        |             |                         |
| 7   | Delete row         | —           |                         |
| 8   | Clear row          | —           |                         |
| —   | _separator_        |             |                         |
| 9   | Resize row         | —           | Dialog for exact height |
| 10  | Fit to data        | —           |                         |
| 11  | Hide row           | —           |                         |
| —   | _separator_        |             |                         |
| 12  | Group rows         | —           |                         |
| —   | _separator_        |             |                         |
| 13  | Define named range | —           |                         |

---

## Sheet tab right-click context menu

**Trigger:** Right-click on a sheet tab at the bottom (`.docs-sheet-tab-name` or `.docs-sheet-tab-caption` elements).

**Source:** `pass3/sheets_existing/menus/sheet-tab-context.json` (10 items, live captured 2026-06-09)

| #   | Label         | Has submenu | Disabled | Notes                              |
| --- | ------------- | ----------- | -------- | ---------------------------------- |
| 1   | Delete        | —           | —        | Delete this sheet                  |
| 2   | Duplicate     | —           | —        | Copies the sheet                   |
| 3   | Copy to       | yes ▸       | —        | Copy sheet to another spreadsheet  |
| 4   | Rename        | —           | —        | Inline tab rename                  |
| 5   | Change color  | yes ▸       | —        | Color picker for tab color         |
| 6   | Protect sheet | —           | —        | Opens protection panel             |
| 7   | Hide sheet    | —           | —        | Hides the tab                      |
| 8   | View comments | —           | yes      | Disabled when no comments on sheet |
| 9   | Move right    | —           | —        |                                    |
| 10  | Move left     | —           | yes      | Disabled for leftmost sheet        |

**Note:** "Insert sheet" does not appear in this context menu (it is accessed via the "+" button next to tabs).

### Copy to submenu

**Source:** `pass3/sheets_existing/menus/sheet-tab-context-copy-to.json`
Opens a spreadsheet picker dialog — no submenu items captured (dialog-type action).

### Change color submenu

**Source:** `pass3/sheets_existing/menus/sheet-tab-context-change-color.json`
Color picker grid — no menu items captured (color-grid type action).

---

## Toolbar dropdowns

### Font family dropdown

`aria-label="Font list. Default (Arial) selected."` / `aria-label^="Font"`
Same font list as Docs editor. See `docs/editor.md`.

### Font size dropdown

`aria-label="Font size list. 10 selected."` / `aria-label="Font size"`
Default size is 10pt (Sheets default). Common values: 6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36.

### Format as number (toolbar)

`aria-label="Format as currency"` — one-click currency formatting.
`aria-label="Format as percent"` — one-click percentage formatting.

### Horizontal align dropdown

`aria-label="Horizontal align"` — Left / Center / Right / Justify

### Borders dropdown

`aria-label="Borders"` — Grid of border options: all / outer / inner / top / bottom / left / right / no border / custom.

### Functions dropdown (toolbar)

`aria-label="Functions"` — Quick-insert: SUM, AVERAGE, COUNT, MIN, MAX, + browse.

---

## Toolbar buttons (Sheets-specific, reference)

| Label            | Shortcut     | Notes                         |
| ---------------- | ------------ | ----------------------------- |
| Undo             | Ctrl+Z       |                               |
| Redo             | Ctrl+Y       |                               |
| Print            | Ctrl+P       |                               |
| Paint format     | —            |                               |
| Zoom %           | —            |                               |
| Font             | —            | Dropdown                      |
| Font size        | —            | Dropdown                      |
| Bold             | Ctrl+B       |                               |
| Italic           | Ctrl+I       |                               |
| Strikethrough    | Alt+Shift+5  |                               |
| Text color       | —            |                               |
| Fill color       | —            |                               |
| Borders          | —            | Dropdown                      |
| Merge cells      | —            |                               |
| Horizontal align | —            | Dropdown (Left/Center/Right)  |
| Vertical align   | —            | Dropdown (Top/Middle/Bottom)  |
| Text wrapping    | —            | Dropdown (Overflow/Wrap/Clip) |
| Text rotation    | —            | Dropdown                      |
| Link             | Ctrl+K       |                               |
| Comment          | Ctrl+Alt+M   |                               |
| Chart            | —            |                               |
| Filter           | —            | Create a filter               |
| Functions        | —            | Dropdown                      |
| Hide menus       | Ctrl+Shift+F | Compact controls toggle       |

---

## Share button (top-right)

Same as Docs editor share dialog — see `docs/editor.md`.
Sheets additionally shows a "Share a copy" option for viewers.

---

## Sheet name menu (bottom left)

**Trigger:** Click `aria-label="All Sheets"` button (leftmost tab area control).

Shows a scrollable list of all sheet tabs in the workbook,
with a tick mark next to the currently active sheet.
Clicking a sheet navigates to it.
