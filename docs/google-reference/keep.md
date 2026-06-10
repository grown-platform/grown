# Google Keep — Menu Reference

> Captured from keep.google.com/u/0/ on 2026-06-09 using the pass-3 Playwright probe harness.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/keep/menus/`
>
> **Extraction method:** Live Playwright click probes in an authenticated Chromium session.
> Google Keep is a Polymer Web Components app (`Q0hgme-*` and `IZ65Hb-*` class namespace).
> Unlike Photos, Keep does **not** use a global pointer-intercepting scrim overlay on the main
> note board. Standard Playwright `.click()` works for toolbar buttons.
>
> **Account state:** Throwaway account had no notes at start. The `note-more-menu` setup
> step creates a note by clicking the compose area and typing, then Escape to commit.
> The note persists for subsequent per-note probes.
>
> **DOM patterns:**
>
> - Toolbar buttons: `<div role="button">` (not `<button>`) with `aria-label`
> - Note compose area: `.IZ65Hb-n0tgWb` container with `role="combobox"` inside
> - Note card (once created): also `.IZ65Hb-n0tgWb` — same class as compose bar
> - Nav items: `[role="tab"]` DIVs (not links), with labels Notes / Reminders / Edit Labels / Archive / Trash
> - Apps switcher: `<a class="gb_C" role="button" aria-label="Google apps">`
> - Account: `<a class="gb_C gb_5a gb_6" role="button" aria-label="Google Account: ...">`

---

## Settings gear menu

**Trigger:** Click `[role="button"][aria-label="Settings"]` (a `<div role="button">` in the top
toolbar, not a `<button>` element).

**Source:** `pass3/keep/menus/settings.{html,json,png}` (6 items, captured 2026-06-09)

| #   | Label              | Notes                                  |
| --- | ------------------ | -------------------------------------- |
| 1   | Settings           | Opens the full Keep Settings panel     |
| 2   | Enable dark theme  | Toggle dark/light theme                |
| 3   | Send feedback      | Opens the feedback submission form     |
| 4   | Help               | Links to Keep help documentation       |
| 5   | App downloads      | Links to iOS/Android app install pages |
| 6   | Keyboard shortcuts | Opens the keyboard shortcuts reference |

---

## Note card "More" menu (hover-revealed toolbar)

**Trigger:** Hover over a note card (`.IZ65Hb-n0tgWb`) to reveal the bottom toolbar, then click
`[role="button"][aria-label="More"]` (class `xl07Ob`, DIV role="button"). The toolbar appears
on hover — it is hidden by default (`display: none` on the note actions bar).

**Source:** `pass3/keep/menus/note-more-menu.{html,json,png}` (7 items, captured 2026-06-09)

| #   | Label               | Notes                                   |
| --- | ------------------- | --------------------------------------- |
| 1   | Delete note         | Move note to Trash (30-day retention)   |
| 2   | Add label           | Assign a label to the note              |
| 3   | Add drawing         | Open the drawing canvas for this note   |
| 4   | Make a copy         | Duplicate the note                      |
| 5   | Show checkboxes     | Convert the note into a checklist       |
| 6   | Copy to Google Docs | Export note content to a new Google Doc |
| 7   | Version history     | View edit history for this note         |

---

## Note card background/color picker

**Trigger:** Hover over a note card to reveal the bottom toolbar, then click
`[role="button"][aria-label="Background options"]` (class `VsHK1d`).

**Source:** `pass3/keep/menus/note-color-picker.{html,json,png}` (12 items, captured 2026-06-09)

The picker shows 12 color swatches. Item labels are not exposed as `textContent` (icons only)
but each swatch has an `aria-label` in the DOM:

| #   | aria-label | Notes                          |
| --- | ---------- | ------------------------------ |
| 1   | Default    | White / no color (transparent) |
| 2   | Coral      | Warm red-orange                |
| 3   | Peach      | Light orange                   |
| 4   | Sand       | Light yellow-tan               |
| 5   | Mint       | Light green                    |
| 6   | Sage       | Medium muted green             |
| 7   | Fog        | Light blue-grey                |
| 8   | Storm      | Medium blue-grey               |
| 9   | Dusk       | Medium purple                  |
| 10  | Blossom    | Light pink                     |
| 11  | Clay       | Medium terracotta              |
| 12  | Chalk      | Off-white/cream                |

**Note:** The picker container has `aria-label="1 of 2: Color: 12 options. Select to add note color."`
indicating a two-tab picker (colors + background images; only the colors tab was captured).

---

## Note edit modal "More" menu

**Trigger:** Click a note card to open it in the full edit modal, then click
`[role="button"][aria-label="More"]` in the edit modal's bottom toolbar.

**Source:** `pass3/keep/menus/note-edit-more.{html,json,png}` (7 items, captured 2026-06-09)

The edit-modal More menu has the same 7 items as the card hover More menu:

| #   | Label               | Notes                |
| --- | ------------------- | -------------------- |
| 1   | Delete note         | Move note to Trash   |
| 2   | Add label           | Assign a label       |
| 3   | Add drawing         | Open drawing canvas  |
| 4   | Make a copy         | Duplicate the note   |
| 5   | Show checkboxes     | Convert to checklist |
| 6   | Copy to Google Docs | Export to Google Doc |
| 7   | Version history     | View edit history    |

**Structural note:** The edit modal items are identical to the card hover menu items. The edit modal
does NOT add Share or Send items at this account level (may require Google Workspace organizational
accounts for Send/Share to other users). Both menus use the same trigger selector.

---

## Note reminder picker ("Remind me")

**Trigger:** Click a note card to open it in the edit modal, then click
`[role="button"][aria-label="Remind me"]` (class `zyxPWd`).

**Source:** `pass3/keep/menus/note-edit-reminder.{html,json,png}` (4 items, captured 2026-06-09)

| #   | Label            | Notes                                         |
| --- | ---------------- | --------------------------------------------- |
| 1   | Later today      | Reminder at next available time today         |
| 2   | Tomorrow         | Reminder at 8:00 AM tomorrow                  |
| 3   | Next week        | Reminder at 8:00 AM next Monday               |
| 4   | Pick date & time | Opens inline date/time picker (has submenu ▸) |

### Reminder "Pick date & time" submenu

**Source:** `pass3/keep/menus/note-edit-reminder-pick-date-time.{html,json,png}` (4 items, captured 2026-06-09)

The submenu auto-expands the same listbox element (the harness re-captured the parent items with
inline time annotations appended):

| #   | Captured label           | Notes                                              |
| --- | ------------------------ | -------------------------------------------------- |
| 1   | Later today — 6:00 PM    | Quick-select with suggested time                   |
| 2   | Tomorrow — 8:00 AM       | Quick-select with suggested time                   |
| 3   | Next week — Mon, 8:00 AM | Quick-select with suggested time                   |
| 4   | Pick date & time         | Inline calendar + time picker (not a further menu) |

**Inline date/time picker:** Clicking "Pick date & time" in the submenu opens an inline calendar
control and time field (not a `[role="menu"]`). The harness's `waitForMenu` does not capture it
because it renders as a custom dialog outside the menu.

---

## Note card bottom toolbar (per-note action buttons)

The following buttons appear in the note card's bottom toolbar when the card is hovered, and
also inside the note edit modal. These are `<div role="button">` elements (not `<button>` tags).

| Button                | `aria-label`                  | CSS class       | Notes                                     |
| --------------------- | ----------------------------- | --------------- | ----------------------------------------- |
| Remind me             | `"Remind me"`                 | `zyxPWd`        | Opens reminder menu (see above)           |
| Collaborator          | `"Collaborator"`              | `euCgFf`        | Opens collaborator add dialog             |
| Background options    | `"Background options"`        | `VsHK1d`        | Opens color/background picker (see above) |
| Add image             | `"Add image"`                 | `Ge5tnd-HiaYvf` | Opens image picker / camera               |
| Archive               | `"Archive"`                   | `JqEhuc`        | Moves note to Archive (immediate action)  |
| More                  | `"More"`                      | `xl07Ob`        | Opens More menu (see above)               |
| Select note           | `"Select note"`               | `IZ65Hb-NGme3c` | Enables bulk selection mode               |
| Pin note / Unpin note | `"Pin note"` / `"Unpin note"` | `IZ65Hb-nQ1Faf` | Toggles pin at top of board               |

**Notes on hover-revealed buttons:** All per-note toolbar buttons are initially hidden
(`display: none` or off-screen) and only appear when the note card is hovered. The Playwright
`hover()` step must precede any click on these buttons. The collaborator and archive buttons
open modal dialogs or execute immediate actions — they do not open `[role="menu"]` elements
and were therefore skipped by the harness's `waitForMenu` detection.

---

## Note compose bar (always-visible action buttons)

The top of the Keep page shows a collapsed compose bar with three always-visible action buttons:

| Button                | `aria-label`              | CSS class              | Notes                               |
| --------------------- | ------------------------- | ---------------------- | ----------------------------------- |
| New list              | `"New list"`              | `RmniWd-rymPhb`        | Opens a new checklist note directly |
| New note with drawing | `"New note with drawing"` | `RmniWd-nA1mMd-h1U9Be` | Opens drawing canvas                |
| New note with image   | `"New note with image"`   | `RmniWd-HiaYvf-h1U9Be` | Opens image picker                  |

**The collapsed compose input** uses a `role="combobox"` with placeholder text "Take a note…"
(visually shown in `.fmcmS-LwH6nd`). Clicking anywhere on the compose bar expands it into a
full editor with Title + Note content fields. None of these actions open a `[role="menu"]` —
the buttons execute immediate actions (create note type) or expand inline editors.

---

## View toggle, Refresh, and other toolbar buttons

| Button                | `aria-label`                   | Type   | Notes                                         |
| --------------------- | ------------------------------ | ------ | --------------------------------------------- |
| Refresh               | `"Refresh"`                    | action | Reloads the note grid                         |
| Grid view / List view | `"Grid view"` or `"List view"` | toggle | Switches between masonry grid and list layout |
| Settings              | `"Settings"`                   | menu   | Opens 6-item settings menu (see above)        |
| Main menu             | `"Main menu"`                  | action | Expands/collapses the left navigation panel   |
| Search                | `"Search"`                     | action | Expands the search bar with `role="combobox"` |

**View toggle:** Clicking the view toggle button immediately switches the layout — it does not
open a dropdown menu. The harness's `waitForMenu` correctly reported "menu did not appear".

---

## Account menu (top-right avatar)

**Trigger:** JS-click `a.gb_C.gb_5a.gb_6[aria-label^="Google Account:"]` — opens iframe overlay.

**Source:** Skipped — `waitForMenu` did not detect the iframe-based overlay.

Keep uses the same `<a class="gb_C">` anchor pattern as Play Books and Google Meet for the
account avatar. Clicking opens the Google Account iframe overlay at `ogs.google.com` (same
content as documented in `calendar.md`).

---

## Apps switcher (waffle, 9-dot)

**Trigger:** JS-click `a.gb_C[aria-label="Google apps"]` — opens iframe overlay.

**Source:** Skipped — `waitForMenu` did not detect the iframe-based overlay.

Same `gb_C` anchor pattern. Opens the standard Google apps waffle at `ogs.google.com/widget/app`.

---

## Left navigation (role="tab" items)

Keep's left sidebar uses `[role="tab"]` DIV elements (not links) for navigation:

| Tab label   | `aria-label`    | Notes                            |
| ----------- | --------------- | -------------------------------- |
| Notes       | `"Notes"`       | Main note board (default view)   |
| Reminders   | `"Reminders"`   | Notes with active reminders      |
| Edit Labels | `"Edit Labels"` | Label management                 |
| Archive     | `"Archive"`     | Archived notes                   |
| Trash       | `"Trash"`       | Deleted notes (30-day retention) |

**Right-click context:** Right-clicking a `[role="tab"]` item produces the browser's native
context menu only. Keep does not implement a custom JS context menu on nav items.
The probe correctly reported "menu did not appear".

---

## Collaborators (note card toolbar)

**Probe:** `note-collaborators` — click `[role="button"][aria-label="Collaborator"]` after hovering
a note card.

**Source:** Skipped — `waitForMenu` did not detect any menu; the collaborators button opens an
inline modal/dialog (`[role="dialog"]` or custom Polymer panel) not a `[role="menu"]`.

The collaborator dialog shows an email input field for inviting collaborators to the note.

---

## Summary of captures

| Probe                                  | Status  | Items | Notes                                                                                                   |
| -------------------------------------- | ------- | ----- | ------------------------------------------------------------------------------------------------------- |
| `new-note-buttons`                     | skipped | —     | Always-visible compose buttons do not open menus (documented structurally)                              |
| `settings`                             | ok      | 6     | Settings, Enable dark theme, Send feedback, Help, App downloads, Keyboard shortcuts                     |
| `view-toggle`                          | skipped | —     | Toggle action — no menu                                                                                 |
| `account-menu`                         | skipped | —     | iframe overlay — not captured by main-frame harness                                                     |
| `apps-switcher`                        | skipped | —     | iframe overlay — not captured by main-frame harness                                                     |
| `nav-context`                          | skipped | —     | Browser-native context menu only (no DOM menu)                                                          |
| `note-more-menu`                       | ok      | 7     | Delete note, Add label, Add drawing, Make a copy, Show checkboxes, Copy to Google Docs, Version history |
| `note-color-picker`                    | ok      | 12    | Default, Coral, Peach, Sand, Mint, Sage, Fog, Storm, Dusk, Blossom, Clay, Chalk                         |
| `note-collaborators`                   | skipped | —     | Opens dialog/panel, not a `[role="menu"]`                                                               |
| `note-edit-more`                       | ok      | 7     | Same 7 items as note-more-menu (captured from edit modal)                                               |
| `note-edit-reminder`                   | ok      | 4     | Later today, Tomorrow, Next week, Pick date & time                                                      |
| `note-edit-reminder__Pick date & time` | ok      | 4     | Submenu: shows same items with inline time annotations                                                  |
| `note-edit-archive`                    | skipped | —     | Immediate action button — no menu                                                                       |
| `note-edit-pin`                        | skipped | —     | Toggle action button — no menu                                                                          |
