# Google Forms Editor — Menu Reference

> Captured from docs.google.com/forms/create on 2026-06-09.
> Existing-doc capture: `/forms/d/1gDkkR96uVariZxKrG-opTu3mrTyQsWxKZcE0A11tZW4/edit`
> Live probe artifacts: `grown-workspace/research/gworkspace-frontend/pass3/forms_editor/menus/`
>
> **Extraction method:** Live Playwright JS-click probes (pass-3 harness) against
> an authenticated Chromium session on 2026-06-09. 5 artifacts captured from forms_editor.
>
> **Framework:** Forms uses the "freebird" framework — completely different from the Kix
> framework used by Docs, Sheets, and Slides. There is **no** `#docs-menubar`, no
> `#docs-file-menu`, no standard Kix menu IDs. The Forms UI is a single-page editor
> with a header action bar and a question builder canvas.
>
> **Scrim overlay:** Forms has a global pointer-intercepting scrim (`div.VIpgJd-TUo6Hb-xJ5Hnf`,
> same as Google Photos) that covers the entire viewport. All button interactions require
> `element.click()` dispatched via JavaScript evaluate — normal Playwright `.click()` fails
> with "subtree intercepts pointer events".
>
> **Welcome/Gemini dialog:** On first load, Forms shows a "Help me create a form" dialog
> (`#insertabletemplates-dialog-notforstyling`) with AI prompt suggestions. This dialog
> must be dismissed before header controls are accessible.

---

## Header bar structure

The Forms editor header bar (top of page) contains:

`Forms Home` | `Document title` (input) | `Star` | `Help me create a form (Gemini)` | `Customize Theme` | `Preview` | `Undo` | `Redo` | `Copy responder link` | `Share` | `Publish` | `More (⋮)`

Below the header, the editor has three tabs: `Questions` | `Responses` | `Settings`

**Key differences from Docs/Sheets/Slides:**

- No File / Edit / View / Insert / Format / Tools / Extensions / Help menubar
- All sharing, settings, and overflow actions are in the header bar
- Question-building is done via a canvas (not a toolbar-driven editor)

---

## More (⋮) overflow menu

**Trigger:** JS-click `[aria-label="More"][role="button"]` in the Forms header bar.

**Source:** `pass3/forms_editor/menus/header-overflow-menu.{html,json,png}` (9 items, captured 2026-06-09)

| #   | Label              | Disabled | Notes                                 |
| --- | ------------------ | -------- | ------------------------------------- |
| 1   | Make a copy        | —        | Duplicate this form in Drive          |
| 2   | Move to trash      | yes      | Disabled on new/unsaved form          |
| 3   | Pre-fill form      | —        | Opens pre-filled link generator       |
| 4   | Embed HTML         | —        | Gets `<iframe>` embed code            |
| 5   | Print              | —        | Print the form                        |
| 6   | Apps Script        | —        | Opens bound Apps Script editor        |
| 7   | Get add-ons        | —        | Marketplace for Forms add-ons         |
| 8   | Unpublish form     | yes      | Disabled when form is not published   |
| 9   | Keyboard shortcuts | —        | Shows Forms keyboard shortcuts dialog |

**Note:** Forms does not have a File menu. File-level operations (copy, trash, print, script)
are consolidated in this single overflow menu.

---

## Customize Theme panel

**Trigger:** JS-click `[aria-label="Customize Theme"][role="button"]` in the header bar.

This button opens a **side panel** (not a dropdown menu). The panel is captured as an HTML
artifact but does not produce `[role="menu"]`-style items.

**Source:** `pass3/forms_editor/menus/customize-theme.{html,json,png}` (3 items detected as panel content)

The Customize Theme panel allows changing:

- Header image (upload / choose from gallery / solid color)
- Theme color (pre-set palette or custom hex color)
- Background color (Light / Dark)
- Text style: Font family for header, question titles, and body text (each with size)
  — `[aria-label="Select a font family for your form header. Current font: Roboto"]`
  — `[aria-label="Select a font family for your form's question titles. Current font: Roboto"]`
  — `[aria-label="Select a font family for your form's body text. Current font: Roboto"]`

---

## Question type dropdown

**Trigger:** JS-click `[aria-label="Question types"][role="listbox"]` on a question card.

**Source:** `pass3/forms_editor/menus/question-type-dropdown.{html,json,png}` (captured 2026-06-09)

This is a `[role="listbox"]` selector rendered as a Material dropdown. Items are the available
question types in Google Forms:

| #   | Label                | Notes                                  |
| --- | -------------------- | -------------------------------------- |
| 1   | Short answer         | Single-line text input                 |
| 2   | Paragraph            | Multi-line text input                  |
| 3   | Multiple choice      | Radio buttons — exactly one answer     |
| 4   | Checkboxes           | Checkboxes — zero or more answers      |
| 5   | Dropdown             | Select from a dropdown list            |
| 6   | File upload          | Responder uploads a file               |
| 7   | Linear scale         | Numeric rating (e.g., 1–5)             |
| 8   | Multiple choice grid | Grid of radio buttons (rows × columns) |
| 9   | Checkbox grid        | Grid of checkboxes (rows × columns)    |
| 10  | Date                 | Date picker                            |
| 11  | Time                 | Time picker                            |

**Note:** The question type dropdown appears within the question card which requires the
question card to be selected/active first.

---

## Question card three-dot menu

**Trigger:** Click `[aria-label="More options"]` button that appears on hover of a question card.

_Not successfully captured in pass-3 (the button has a scrim overlay). Canonical items based
on Forms documentation:_

| #   | Label                         | Notes                                          |
| --- | ----------------------------- | ---------------------------------------------- |
| 1   | Description                   | Add a description/hint text below the question |
| 2   | Shuffle row order             | (for grid questions)                           |
| 3   | Shuffle option order          | Randomize answer order                         |
| 4   | Go to section based on answer | Section branching (multiple choice only)       |
| 5   | Show validation               | Show/hide validation rules                     |

---

## Responses tab

**Trigger:** JS-click `[role="tab"]` with text "Responses".

**Source:** `pass3/forms_editor/menus/responses-tab.{html,json,png}` (captured 2026-06-09)

Switching to the Responses tab shows three sub-tabs:

| #   | Label      | Notes                                         |
| --- | ---------- | --------------------------------------------- |
| 1   | Summary    | Charts and aggregate counts for each question |
| 2   | Question   | Browse responses by question                  |
| 3   | Individual | Browse individual form submissions            |

The Responses tab also has a toolbar:

- **Link to Sheets** button — create/link a response spreadsheet
- **More options for responses** (⋮) — see below

---

## Responses tab overflow menu

**Trigger:** JS-click `[aria-label="More options for responses"]` in the Responses tab toolbar.

**Source:** `pass3/forms_editor/menus/responses-overflow.{html,json,png}` (5 items, captured 2026-06-09)

| #   | Label                            | Disabled | Notes                              |
| --- | -------------------------------- | -------- | ---------------------------------- |
| 1   | Select destination for responses | —        | Link/create a response spreadsheet |
| 2   | Unlink form                      | yes      | Disabled when not linked to Sheets |
| 3   | Download responses (.csv)        | yes      | Disabled when no responses         |
| 4   | Print all responses              | yes      | Disabled when no responses         |
| 5   | Delete all responses             | yes      | Disabled when no responses         |

---

## Settings tab

**Trigger:** Click the `Settings` tab in the editor.

The Settings tab is not a menu — it renders an inline settings panel with the following
sections and controls:

**Responses section:**

- Collect email addresses (toggle + options: Not collected / Responder input / Verified)
- Send responders a copy of their response (toggle: Off / Upon request / Always)
- Allow response editing (toggle)
- Limit to 1 response (toggle, requires sign-in)
- Accept responses (toggle, turns form on/off)
- Response confirmation (custom message)

**Presentation section:**

- Show progress bar (toggle)
- Shuffle question order (toggle)
- Show link to submit another response (toggle)
- Confirmation message text

**Defaults section:**

- Make questions required by default (toggle)

---

## Publish button

**Trigger:** Click `[aria-label="Publish"][role="button"]` in the header bar.

Opens the Publish dialog (send/share modal). Tabs:

| Tab     | Description                              |
| ------- | ---------------------------------------- |
| Link    | Shareable URL to the form                |
| Email   | Send via email to respondents            |
| Embed   | `<iframe>` embed code with size controls |
| Prefill | Generate pre-filled link                 |

The Publish URL format: `https://docs.google.com/forms/d/{form-id}/viewform`

---

## Right-side floating toolbar (question editor)

When a question card is active/selected, a floating toolbar appears to the right:

| Button                    | Notes                             |
| ------------------------- | --------------------------------- |
| Add question              | + button — appends a new question |
| Import questions          | Import from another form          |
| Add title and description | Section header                    |
| Add image                 | Embed an image                    |
| Add video                 | Embed a YouTube video             |
| Add section               | Create a new form section/page    |

---

## Structural notes

- Forms does **not** have a traditional menubar (no File / Edit / View etc.)
- All "app-level" actions (copy, trash, print, scripts) are in the header `More (⋮)` menu
- The editor is entirely click-driven — no keyboard shortcuts for most operations
  (exception: Ctrl+Z/Y for undo/redo, Ctrl+Enter to submit)
- Question reordering is drag-and-drop
- Section branching (logic) is configured per-question in the three-dot menu
