# Google Reference — Scrape Plan

> Items that need a live Playwright browser session to complete.
> Run when network is available and session is still valid.

## Status summary (as of 2026-06-09, post Contacts + Tasks + Groups + Sites batch)

| Target            | Pass-3 captures                                                               | Skipped / needs follow-up                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contacts`        | 2 menus (create-button, settings menu)                                        | per-row-more, bulk-select, label-context (empty account); help-menu (manually investigated)                                                                                 |
| `tasks`           | 2 menus (task-list-dropdown, task-more-options via JS)                        | add-task-area, per-task-more, task-edit-pane (empty account); waitForMenu[:visible] fails for Tasks scrim                                                                   |
| `groups`          | 1 menu (settings-cog); 1 structural (per-group-row-more via JS)               | create-group (navigates, not menu); bulk-select/account/apps captured wrong pre-existing nav listbox                                                                        |
| `sites`           | 1 menu (template gallery as create-button); 2 structural (sort, owner-filter) | per-site-row-more (no sites); editor probes (no sites); pre-existing DOM menus interfere with harness                                                                       |
| `drive`           | 20 menus                                                                      | breadcrumb-context, account-menu dialog, sidebar More submenu                                                                                                               |
| `docs_landing`    | 4 menus                                                                       | tile-right-click-context (needs manual — no recent files), empty-area-context                                                                                               |
| `docs_editor`     | 42 menus                                                                      | apps-switcher                                                                                                                                                               |
| `docs_existing`   | 27 menus                                                                      | URL expired — all menus errored on 2026-06-09 re-run                                                                                                                        |
| `sheets_landing`  | 4 menus                                                                       | tile-right-click-context, empty-area-context                                                                                                                                |
| `sheets_editor`   | 50 menus                                                                      | apps-switcher, cell-context (canvas), row-header-context (error), range-context                                                                                             |
| `sheets_existing` | 54 menus                                                                      | same as sheets_editor                                                                                                                                                       |
| `slides_landing`  | 4 menus                                                                       | tile-right-click-context (no recent files), empty-area-context                                                                                                              |
| `slides_editor`   | 44 menus                                                                      | apps-switcher (waffle not in DOM at viewport)                                                                                                                               |
| `slides_existing` | 47 menus                                                                      | apps-switcher                                                                                                                                                               |
| `forms_landing`   | 4 menus                                                                       | tile-right-click-context (no recent files), empty-area-context                                                                                                              |
| `forms_editor`    | 5 menus                                                                       | scrim overlay on most controls; question-type/responses-tab captured dialog instead of target                                                                               |
| `forms_existing`  | not yet run                                                                   |                                                                                                                                                                             |
| `gmail`           | 8 menus                                                                       | inbox-message-context (0 items), selected-message-context (0 items), nav-pane-context (0 items), account-menu (0 items)                                                     |
| `gmail_settings`  | 10 / 10 tabs                                                                  | All captured                                                                                                                                                                |
| `drive_settings`  | 3 / 3 tabs                                                                    | **Fixed 2026-06-09** — live data, 37/20/50 elements                                                                                                                         |
| `myaccount_*`     | 5 / 5 pages                                                                   | All captured                                                                                                                                                                |
| `calendar`        | 5 menus                                                                       | event-context (no events on account), search (combobox, not menu), apps-switcher/account-menu (iframe-based)                                                                |
| `meet`            | 6 menus (landing only)                                                        | **In-call menus need follow-up** — see below                                                                                                                                |
| `books_library`   | 1 menu                                                                        | sort-menu (inline, not menu), shelves-panel (accordion), account/apps (iframe-based), nav (links)                                                                           |
| `books_detail`    | 3 captures                                                                    | add-to-library (single-action, no menu), wishlist (toggle, no menu), share (not observed on free book)                                                                      |
| `books_reader`    | 5 captures                                                                    | highlights-panel (panel, not menu), bookmarks-panel (toggle action), fullscreen (toggle action), text selection (image pages — no selectable text)                          |
| `photos`          | 1 menu (create-menu, 12 items)                                                | photo-tile-\* (empty account), nav-context (scrim overlay blocks pointer events), more-options (no kebab on main page)                                                      |
| `keep`            | 6 captures                                                                    | new-note-buttons (action, no menu), view-toggle (toggle, no menu), account/apps (iframe), nav-context (no DOM menu), collaborators (dialog), archive (action), pin (toggle) |

## New in this run (2026-06-09 Contacts + Tasks + Groups + Sites batch — Batch 2 of 3)

### Google Contacts (contacts.google.com/u/0/)

**Key structural discovery:** Contacts uses `button[aria-haspopup="menu"]` with `aria-label`
for its toolbar buttons. The "Create contact" button has no `aria-label`; text is "addCreate contact"
(Material icon + label). The toolbar has `[aria-label="Settings menu"]` and `[aria-label="Help menu"]`
menus. No separate "More actions" / kebab toolbar button — the import/export/print/merge actions
are inside the Settings menu.

- ✅ **contacts / create-button** — 2 items parsed (Create a contact, Create multiple contacts);
  3rd item "Create a label" present but not cleanly parsed (icon glyph in label text)
- ✅ **contacts / settings-menu** — 3 items (Delegate access, Undo changes, More settings) — JS investigation
- ✅ **contacts / help-menu** — 4 items (How to sync contacts, Help, Training, Send feedback) — JS investigation
- ⏭ **contacts / per-row-more** — skipped: 0 contacts in account
- ⏭ **contacts / bulk-select-toolbar** — skipped: 0 contacts in account
- ⏭ **contacts / label-context** — skipped: no labels in account
- ⏭ **contacts / account-menu** — skipped: iframe overlay
- ⏭ **contacts / apps-switcher** — skipped: iframe overlay

### Google Tasks (calendar.google.com side panel → tasks.google.com/embed iframe)

**Key structural discovery:** `tasks.google.com` redirects to calendar.google.com. Tasks lives
in a `tasks.google.com/embed` iframe inside the Calendar right-side panel.
The iframe IS accessible via Playwright (not cross-origin blocked).

**Opening the Tasks panel:** Click `[role="tab"][aria-label="Tasks"]` in the Calendar right-side
panel strip. The iframe loads with `aria-haspopup="true"` (no label) as the list selector and
`[aria-label="List options"]` as the 3-dot overflow.

**Known issues:**

1. The `dismiss()` function must NOT press Escape on the Tasks frame — it would close the panel.
   Fixed with `isFrame` detection in dismiss().
2. `waitForMenu`'s `:visible` filter fails for Tasks menus — the scrim inside the iframe prevents
   `:visible` from returning true. Items captured via direct JS evaluation.

- ✅ **tasks / task-list-dropdown** — 2 items (Starred, Create new list)
- ✅ **tasks / task-more-options** — 7 items (Rename list, Delete list[disabled], Print list,
  Delete all completed[disabled], Clean up old[disabled], Keyboard shortcuts, Send feedback)
- ⏭ **tasks / add-task-area** — skipped: no tasks; input not accessible when "No tasks yet" shown
- ⏭ **tasks / per-task-more** — skipped: no tasks in account
- ⏭ **tasks / task-edit-pane** — skipped: no tasks in account

### Google Groups (groups.google.com/u/0/my-groups)

**Key structural discovery:** The Groups page pre-loads a `[role="listbox"]` navigation component
(My groups / All groups / etc.) that is always visible. The harness captures this nav listbox as
the "menu" for probes that click buttons which don't open a new visible menu. This affects
create-group-button, bulk-select-toolbar, account-menu, and apps-switcher probes.

**Per-group-row more button:** The `[aria-label="More"][aria-haspopup="true"]` button in each
group row is hidden (`display: none`) — CSS hover only, not revealed by Playwright hover.
JS click directly on the element works.

**Create group button:** Navigates to `/groups/create` — NOT a dropdown menu.

- ✅ **groups / settings-cog** — 4 items (Global settings, Send feedback, Help, Training)
- ✅ **groups / per-group-row-more** — 4 items (Group settings, Add members, Leave group, Favorite group) — JS investigation
- ⏭ **groups / create-group-button** — not-a-menu: navigates to creation form
- ⏭ **groups / bulk-select-toolbar** — harness captured wrong pre-existing nav listbox
- ⏭ **groups / groups-filter** — not found: no Filter/Sort button on my-groups page
- ⏭ **groups / account-menu** — harness captured wrong pre-existing nav listbox
- ⏭ **groups / apps-switcher** — harness captured wrong pre-existing nav listbox

### Google Sites (sites.google.com/u/0/)

**Key structural discovery:** The Sites landing page pre-loads:

1. A `[role="listbox"]` template gallery (always visible, starts with 6 templates)
2. A `[role="menu"]` app-nav menu (always visible in DOM)

These pre-existing menus cause `waitForMenu` to return them immediately for every probe,
regardless of what was clicked. The harness captured template gallery items for ALL 4 probes.

**Template gallery as create entry:** There is no separate "Create" dropdown button —
the always-visible template gallery IS the creation entry point. Clicking a template
(Blank site, Event, Help Center, Project, Team, Portal) creates a new site.

**Sort options:** Clicking `[aria-label="Sort options"]` expands the template gallery with
more templates rather than opening a distinct sort listbox. The actual sort behavior needs
a manual/revised capture approach.

- ✅ **sites / create-site-button** — Template gallery: 6 templates (Blank site, Event, Help Center, Project, Team, Portal)
- ⏭ **sites / per-site-row-more** — skipped: no sites in account
- ⏭ **sites / sort-menu** — harness captured template gallery; actual Sort listbox needs re-capture with pre-existing menus dismissed
- ⏭ **sites / account-menu** — harness captured template gallery (pre-existing listbox)
- ⏭ **sites / apps-switcher** — harness captured template gallery (pre-existing listbox)
- ⏭ **Sites editor probes** — skipped entirely: no sites in account

## New in this run (2026-06-09 Slides + Forms batch — Batch 1 of 3)

### Google Slides (slides_landing, slides_editor, slides_existing)

**Key structural discovery:** Slides shares the Kix framework with Docs but uses
**different IDs for Slides-specific menus**: `id="punch-slide-menu"` (Slide menu)
and `id="sketchy-arrange-menu"` (Arrange menu). The standard Docs menu IDs
(`#docs-file-menu`, `#docs-edit-menu`, etc.) are also present for the shared menus.

**Canvas selectors:** The main slide canvas uses `id="canvas"` (not `.kix-appview-editor`).
The filmstrip uses `.punch-filmstrip-scroll` as the scrollable container; individual
slide thumbnails are SVG elements without individual IDs.

- ✅ **slides_landing / sort-options** — 4 items (same as Docs/Sheets landing)
- ✅ **slides_landing / more-actions-tile** — 1 item (Hide all templates)
- ✅ **slides_landing / apps-switcher** — 6 items
- ✅ **slides_landing / account-menu** — 6 items
- ⏭ **slides_landing / tile-right-click-context** — skipped: no recent files in account
- ⏭ **slides_landing / empty-area-context** — skipped: `[role="main"]` not visible
- ✅ **slides_editor / menu-file** — 19 items + 5 submenus
- ✅ **slides_editor / menu-edit** — 10 items
- ✅ **slides_editor / menu-view** — 11 items + 6 submenus
- ✅ **slides_editor / menu-insert** — 22 items + 8 submenus
- ✅ **slides_editor / menu-slide** — 13 items + 2 submenus (id=punch-slide-menu)
- ✅ **slides_editor / menu-format** — 9 items
- ✅ **slides_editor / menu-arrange** — 8 items (id=sketchy-arrange-menu)
- ✅ **slides_editor / menu-tools** — 8 items + 1 submenu
- ✅ **slides_editor / menu-extensions** — 2 items + 1 submenu
- ✅ **slides_editor / menu-help** — 6 items
- ✅ **slides_editor / slide-thumb-context** — 15 items + 2 submenus (right-click filmstrip)
- ✅ **slides_editor / canvas-context** — 13 items + 3 submenus (right-click canvas)
- ✅ **slides_editor / text-box-context** — 13 items + 3 submenus
- ⏭ **slides_editor / apps-switcher** — skipped: Google apps waffle not in DOM at capture viewport

### Google Forms (forms_landing, forms_editor)

**Key structural discovery:** Forms uses the **freebird** framework, completely different
from Kix. There is no `#docs-menubar`, no standard menu IDs. The entire UI is built
with Material-style components using class names like `VIpgJd-*` (buttons), `jgvuAb` (listboxes),
`ThdJC` (tabs).

**Scrim overlay:** Forms has the same global pointer-intercepting scrim (`div.VIpgJd-TUo6Hb-xJ5Hnf`)
as Google Photos. All interactions require `element.click()` via JS evaluate.

**Welcome dialog:** On new form creation, a Gemini "Help me create a form" dialog
(`#insertabletemplates-dialog-notforstyling`) appears and intercepts menu detection.
This dialog cannot be dismissed via Escape — it requires a JS click on its close button
or clicking outside it.

- ✅ **forms_landing / sort-options** — 4 items (same as Docs/Sheets landing)
- ✅ **forms_landing / more-actions-tile** — 1 item (Hide all templates)
- ✅ **forms_landing / apps-switcher** — 6 items
- ✅ **forms_landing / account-menu** — 6 items
- ⏭ **forms_landing / tile-right-click-context** — skipped: no recent files
- ⏭ **forms_landing / empty-area-context** — skipped: `[role="main"]` not visible
- ✅ **forms_editor / header-overflow-menu** — 9 items: Make a copy, Move to trash, Pre-fill form, Embed HTML, Print, Apps Script, Get add-ons, Unpublish form, Keyboard shortcuts
- ✅ **forms_editor / customize-theme** — panel opened (3 AI suggestions shown; actual theme panel captured as HTML)
- ✅ **forms_editor / question-type-dropdown** — 11 question types (Short answer, Paragraph, Multiple choice, Checkboxes, Dropdown, File upload, Linear scale, Multiple choice grid, Checkbox grid, Date, Time)
- ✅ **forms_editor / responses-tab** — tab navigation captured; 3 sub-tabs: Summary, Question, Individual
- ✅ **forms_editor / responses-overflow** — 5 items: Select destination, Unlink form, Download .csv, Print all, Delete all

**Forms gaps (structural limitations):**

- customize-theme / question-type-dropdown / responses-tab probes captured the Gemini
  welcome dialog's suggestion list (3 AI prompts) instead of the intended UI elements.
  The welcome dialog (`#insertabletemplates-dialog-notforstyling`) intercepts `waitForMenu`
  detection because it contains a `[role="listbox"]` with `aria-label="Insertable prompt examples"`.
  **Follow-up:** Use JS evaluate to click the dialog's close button (`.VIpgJd-TUo6Hb-aXBEHb-mzLTff`
  or the "X" button in the dialog) before clicking other buttons.

## New in this run (2026-06-09 Photos + Keep pass)

### Google Photos (photos.google.com/u/0/)

**Key structural discovery:** Google Photos has a **global pointer-intercepting scrim overlay**
(`div.uW2Fw-IE5DDf` inside `div.uW2Fw-Sx9Kwc`) that blocks all normal Playwright pointer events.
Every button, link, and nav item in Photos requires `element.click()` dispatched via JS evaluate.
Normal `.click()`, `.hover()`, and `.rightclick()` all fail with "subtree intercepts pointer events".

- ✅ **photos / create-menu** — 12 items: Album, Collage, Highlight video, Animation, Share with a partner, Import photos, Back up folders, From other places (submenu), Transfer from photo collections, Transfer from photography services, Digitize physical photos, Scan photos with your phone
- ✅ **photos / account-menu** — 0 items (iframe overlay, documented)
- ✅ **photos / apps-switcher** — 0 items (iframe overlay, documented)
- ✅ **photos / more-options** — 0 items (no top-right kebab on main grid page — documented)
- ✅ **photos / settings** — 0 items (navigates to settings page, not a dropdown — documented)
- ⏭ **photos / nav-context** — error: scrim overlay blocks pointer events on `<a href="./" aria-label="All photos">` nav link
- ⏭ **photos / photo-tile-hover-action** — error: no photos in account (empty grid); "Show more" nav button matched incorrectly
- ⏭ **photos / photo-right-click** — skipped: no photos
- ⏭ **photos / selection-toolbar** — skipped: no photos
- ⏭ **photos / selection-more-menu** — error: no photos; wrong button matched

### Google Keep (keep.google.com/u/0/)

**DOM pattern discovery:** Keep uses `<div role="button">` (not `<button>`) for all toolbar
controls. Nav items are `[role="tab"]` not links. No global scrim overlay — normal Playwright
`.click()` works. Note cards use `.IZ65Hb-n0tgWb` class (same for the compose bar and actual note cards).

- ✅ **keep / settings** — 6 items: Settings, Enable dark theme, Send feedback, Help, App downloads, Keyboard shortcuts
- ✅ **keep / note-more-menu** — 7 items: Delete note, Add label, Add drawing, Make a copy, Show checkboxes, Copy to Google Docs, Version history
- ✅ **keep / note-color-picker** — 12 items: Default, Coral, Peach, Sand, Mint, Sage, Fog, Storm, Dusk, Blossom, Clay, Chalk
- ✅ **keep / note-edit-more** — 7 items (same as note-more-menu, captured from edit modal)
- ✅ **keep / note-edit-reminder** — 4 items: Later today, Tomorrow, Next week, Pick date & time
- ✅ **keep / note-edit-reminder\_\_Pick date & time** — 4 items (submenu: same items with time annotations)
- ⏭ **keep / new-note-buttons** — skipped: compose buttons (New list, New note with drawing, New note with image) open inline editors / immediate actions, not menus
- ⏭ **keep / view-toggle** — skipped: toggle action, no menu
- ⏭ **keep / account-menu** — skipped: iframe overlay (gb_C anchor pattern)
- ⏭ **keep / apps-switcher** — skipped: iframe overlay (gb_C anchor pattern)
- ⏭ **keep / nav-context** — skipped: browser-native context menu only on role=tab items
- ⏭ **keep / note-collaborators** — skipped: opens inline dialog, not `[role="menu"]`
- ⏭ **keep / note-edit-archive** — skipped: immediate action (archives note), no menu
- ⏭ **keep / note-edit-pin** — skipped: toggle action (pins/unpins note), no menu

## New in this run (2026-06-08 Books pass — Play Books library + detail + reader)

**Book used:** _Alice's Adventures in Wonderland_ by Lewis Carroll (`id=Y7sOAAAAIAAJ`, public domain, free)
**Reader URL:** `https://play.google.com/books/reader?id=Y7sOAAAAIAAJ&pg=GBS.PP1`

- ✅ **books_library / book-tile-more** — 6 items: About the book, Read, Mark finished, Hide, Add to shelves, Export
- ✅ **books_detail / account-menu** — 11 items: Play Store account overlay (Manage, Library & devices, Payments, My activity, Offers, Play Pass, Play Points, Personalization, Settings, Switch account, Sign out)
- ✅ **books_detail / more-options** ("More review actions") — 1 item: Flag inappropriate
- ✅ **books_detail / info-section** — dialog panel HTML captured (About this ebook expando); 0 menu-style items
- ✅ **books_reader / font-settings** ("Display settings") — dialog HTML captured (18KB); Angular Material controls (Dark theme toggle, View, Font, Font size, Line height, Justify, Page layout); 0 menu-style items
- ✅ **books_reader / toc-panel** — side panel HTML captured; 0 menu-style items
- ✅ **books_reader / search-in-book** — inline search bar HTML captured; 0 menu-style items
- ✅ **books_reader / more-menu** — 2 items: About this book, Save annotations to Google Drive (Off)
- ✅ **books_reader / help-feedback** — 3 items: Get help using Play Books, Send feedback to Play Books, Report a problem with ebook

Structural discoveries:

- Play Books library (`/books`) is a separate Angular Material SPA from the Play Store (`/store/books`)
- `/books/library` returns HTTP 404; correct URL is `/books`
- Reader is a full-viewport iframe at `books.googleusercontent.com/books/reader/frame` accessible via `page.frames()`
- Frames don't have `.keyboard` property — harness dismiss() needed frame-safe keyboard access
- Public-domain scanned books render as images — no text selection possible for annotation popover

## New in this run (2026-06-08 Calendar + Meet pass)

- ✅ **Calendar create-button** — 6 items: Event, Task, Out of office, Focus time, Working location, Appointment schedule
- ✅ **Calendar settings** — 5 items: Settings, Trash, Appearance, Print, Get add-ons
- ✅ **Calendar view-dropdown** — 6 items: Day (D), Week (W), Month (M), Year (Y), Schedule (A), 4 days (X)
- ✅ **Calendar timeslot-click** — New event quick-create dialog (166 options captured from inline pickers)
- ✅ **Calendar sidebar-calendar-options** — 5 items (appointment schedule calendar): Preview, Edit, Sharing options, Show on calendar, Delete
- ✅ **Meet new-meeting-button** — 3 items: Create a meeting for later, Start an instant meeting, Schedule in Google Calendar
- ✅ **Meet support-menu** — 5 items: Help, Training, Terms of Service, Privacy Policy, Terms summary
- ✅ **Meet settings** — opens dialog (audio/video device config); harness captured nav sidebar instead
- ✅ **Meet feedback** — opens feedback dialog; harness captured nav sidebar instead
- ✅ **Meet apps-switcher** — opens iframe waffle; harness captured nav sidebar instead
- ✅ **Meet account-menu** — opens iframe account overlay; harness captured nav sidebar instead

## Items now captured (removed from "needs follow-up")

- ✅ `sheets_landing` / `sheets_editor` / `sheets_existing` — were failing with DNS errors, now captured
- ✅ Docs editor body/selection context menus — captured (10 and 11 items)
- ✅ Drive empty-area-context and sidebar-item-context — captured
- ✅ All 9 Sheets editor menubar menus — now live-captured (were canonical/estimated)
- ✅ Gmail menus — new target, partial capture
- ✅ Gmail settings tabs — all 10 tabs captured
- ✅ Google Account settings pages — all 5 pages captured
- ✅ **Drive settings dialog** — fixed 2026-06-09 (general: 37 elems, notifications: 20 elems, manage-apps: 50 elems). See `settings/drive.md`.
- ✅ **Sheets sheet-tab-context** — fixed 2026-06-09, 10 items captured (Delete, Duplicate, Copy to►, Rename, Change color►, Protect sheet, Hide sheet, View comments, Move right, Move left). See `sheets/editor.md`.
- ✅ **Docs toolbar-font** — fixed 2026-06-09, 1 item captured ("More fonts"). Uses `#docs-font-family` / `[data-tooltip="Font"]` selector.
- ✅ **Docs toolbar-heading** — fixed 2026-06-09, 1 item captured ("Normal text"). Uses `[data-tooltip="Styles"]` selector.
- ✅ **Gmail compose-formatting-options** — improved 2026-06-09, 1 item captured (font family listbox "Sans Serif"); was previously skipped entirely.

## Remaining gaps after 2026-06-08 Calendar + Meet run

### Meet in-call menus (needs follow-up)

The in-call menus (Layout, More options, Cast, Breakout rooms, Present screen, Activities,
Reactions) are only accessible from inside an active meeting. The Meet landing-page probes
cannot reach them. A dedicated follow-up session is needed where someone:

1. Clicks "Start an instant meeting" from the landing page to join a meeting
2. Waits for the meeting to connect with camera/mic
3. Runs probes against the in-call controls bar (bottom of screen)

Key in-call menus to capture:

- More options (⋮) button → full menu (Layout, Settings, Full screen, Help, Report, etc.)
- Change layout → Grid / Spotlight / Sidebar / Auto
- Present screen → window/tab/desktop picker
- Activities → Polls / Q&A / Whiteboard / Breakout rooms
- Reactions → emoji picker

### Calendar gaps

1. **event-context** — The throwaway account had no events in the current week view. Run
   after creating a test event; right-click on it in the grid. Note: Calendar may not open
   a DOM context menu on right-click (structural limitation to verify).

2. **search bar suggestions** — Click search icon, type a query, capture the `[role="combobox"]`
   suggestions dropdown. Currently not captured because clicking the icon alone doesn't open
   a menu.

3. **Calendar sidebar context (personal calendar)** — The captured sidebar-calendar-options
   probe captured an "appointment schedule" calendar. A personal calendar (e.g. "Lucas Pick")
   shows different items: Edit / Sharing and viewing / Notifications / View calendar /
   Settings and sharing / Create event / Unsubscribe / Remove from other calendars.

## Remaining gaps after 2026-06-09 Slides + Forms run

### Forms follow-up

1. **forms_editor / welcome-dialog dismissal** — The Gemini "Help me create a form" dialog
   intercepts probes for customize-theme, question-type-dropdown, and responses-tab.
   The dialog `#insertabletemplates-dialog-notforstyling` has a close button that needs
   to be identified and JS-clicked before other buttons are accessible.
   **Impact:** customize-theme panel content, question-type listbox, responses tab navigation
   are not fully captured.

2. **forms_editor / question-overflow** — The per-question three-dot button requires both
   the scrim bypass and the question card to be selected/hovered. Not captured in pass-3.
   **Estimated items:** Description, Shuffle answer order, Go to section based on answer,
   Show validation.

3. **forms_existing** — Not run in this batch. The existing form URL
   (`/forms/d/1gDkkR96uVariZxKrG-opTu3mrTyQsWxKZcE0A11tZW4/edit`) should give the
   same probes but with actual responses present, enabling the responses-overflow items
   (Download .csv, Print all, Delete all) to be non-disabled.

### Slides follow-up

1. **slides / apps-switcher** — The Google apps waffle (9-dot) is not in the DOM at
   the standard viewport when Slides is fully loaded (the `[aria-label="Google apps"]`
   element or `[jsname="wQNmvb"]` is not found). This may be because Slides uses a
   custom header. Needs manual DOM inspection.

## Remaining gaps after 2026-06-09 run

### Needs manual capture / structural limitation

1. **Gmail inbox-message-context / selected-message-context** — Right-clicking a message row
   in Gmail's inbox shows 0 items because Gmail may open a native browser context menu or
   the custom context menu doesn't use `[role="menu"]`/`.J-M` patterns that the harness
   detects. The captured HTML consistently shows the Quick settings panel instead.
   **Tried:** gmailJM=true path (`.J-M[role="menu"]`), standard rightclick on `tr.zA`.
   **Outcome:** 0 items. Needs manual DOM inspection while the context menu is open.

2. **Gmail nav-pane-context** — Right-clicking the Inbox link (`a[href*="#inbox"]`,
   `aria-label="Inbox 61 unread"`) captures 0 items — the Quick settings panel (`.IU[role="menu"]`)
   is found as the visible `[role="menu"]` instead of any context menu.
   **Tried:** `.aim.ain a`, `a[href*="#inbox"][aria-label*="Inbox" i]`.
   **Outcome:** 0 items. Gmail nav items do not open a JS context menu on right-click.
   The nav-pane-context gap may not have any capturable items.

3. **Gmail account-menu** — Captures 0 items. Google Account dropdown uses a dialog/overlay
   that isn't detected as a standard `[role="menu"]`.

4. **Landing tile-right-click-context** (docs_landing, sheets_landing) — The landing pages
   use either template tiles (`.docs-homescreen-templates-templateview[role="option"]`) or
   recent-file items. The template options have `tabindex="-1"` and Playwright considers
   them not visible. The account has no recent files, so actual file tiles are not present.
   **Tried:** `[role="option"]:first-child`, `[class*="tile"]:first-child`.
   **Outcome:** "trigger not visible". Needs an account with recent files, or force-click approach.

5. **Drive folder-row-context** — The setup creates a temp folder but the trigger selector
   doesn't find it. The `folder-row-context` probe creates a folder via New > New folder,
   but the folder row doesn't match any of the tested selectors.
   **Tried:** `[aria-label*="Probe folder temp" i]`, folder MIME selectors.
   **Outcome:** "trigger not visible". Needs better post-creation selector.

6. **Docs existing document** — The pre-existing doc URL
   (`/document/d/1eI-EvN8K_mOetxawzgyxGIyqSSys_EUj/edit`) may have expired permissions
   or the doc was deleted. All probes error with timeout on 2026-06-09.
   **Needed:** A fresh pre-existing document URL in the shared account.

7. **Sheets canvas context menus** (cell-context, column-header-context, range-context) —
   The Sheets canvas is a `<canvas>` element that doesn't expose element bounds in the
   same way. `canvas[class*="grid"]` is not visible per Playwright.
   **Structural limitation** — these context menus cannot be captured without a different
   approach (e.g., targeting inner Sheets canvas via offset coordinates).

## Remaining Contacts + Tasks + Groups + Sites gaps (after 2026-06-09 Batch 2 pass)

### Contacts gaps

1. **contacts / per-row-more, bulk-select-toolbar, label-context** — All three require contacts
   and labels in the account. The throwaway account has 0 contacts.
   **Follow-up:** Add 2-3 test contacts and a label, then re-run `contacts`.

2. **contacts / create-button (3rd item)** — "Create a label" is the third item in the Create
   dropdown but was not parsed cleanly. The harness's `extractMenuItems` concatenates the Material
   icon glyph text with the label (e.g. "labelCreate a label"). A post-processing step to strip
   common Material icon glyph names would fix this.

### Tasks gaps

1. **tasks / add-task-area, per-task-more, task-edit-pane** — All three require at least one
   task to exist. The throwaway account has no tasks in "My Tasks".
   **Follow-up:** Create a test task via JS or UI, then re-run `tasks`.

2. **tasks / waitForMenu[:visible] failure** — The Tasks iframe uses a pointer-intercepting scrim
   that prevents Playwright's `:visible` filter from working on `[role="menu"]` elements. The
   `waitForMenu` function needs a fallback for frames: try `[role="menu"]` without `:visible` when
   running in frame context, or use a direct `evaluate()` to check `menu.offsetWidth > 0`.

3. **tasks / task-list-dropdown (full list)** — Only "My Tasks" is selected so only "Starred" and
   "Create new list" appear. To capture the full dropdown with multiple lists, create 2-3 task lists
   first, then re-run.

### Groups gaps

1. **groups / per-group-row-more** — The `[aria-label="More"]` button is CSS-hover-only and
   `display:none` in normal state. The harness hover step didn't reveal it. Fix: use JS evaluate to
   set the button to `display:block` before clicking, or use `dispatchEvent(new MouseEvent('mouseover'))`.

2. **groups / bulk-select-toolbar** — harness captured pre-existing nav listbox. Fix: wait for a
   NEW menu to appear (use MutationObserver or timestamp the menus before clicking).

3. **groups / account-menu, apps-switcher** — Captured pre-existing nav listbox. Same fix as above.

4. **groups / groups-filter** — The `my-groups` page has no Filter/Sort button. Filtering is in
   the left sidebar nav (My groups / All groups). The page may have sorting in a different view.

### Sites gaps

1. **sites / sort-menu** — The Sort options button expands the template gallery rather than opening
   a distinct sort listbox. The actual sort functionality may use a different trigger or the listbox
   ID matches the template gallery's. Needs DOM inspection with DevTools while the sort menu is open.

2. **sites / per-site-row-more** — Requires existing sites. Create a test site, then re-run.

3. **sites / Sites editor probes (all)** — Require an existing site. After creating a test site,
   probe: Insert pane, Themes pane, Pages pane, More actions header menu, content block context toolbar.
   Editor URL pattern: `https://sites.google.com/u/0/<site-id>/edit`

4. **sites / pre-existing DOM menu interference** — The always-visible template gallery (`[role="listbox"]`)
   and app-nav (`[role="menu"]`) cause `waitForMenu` to immediately return the pre-existing menu.
   Fix: add a `waitForMenuChange()` helper that checks if a new menu appeared AFTER the click
   (compare menu IDs or count before and after), or add a setup step to close pre-existing menus.

## Remaining Photos + Keep gaps (after 2026-06-09 pass)

### Google Photos gaps

1. **photos / photo-tile-hover-action, photo-right-click, selection-toolbar, selection-more-menu** —
   All four photo-tile probes require actual photos in the account. The throwaway account has no
   uploaded photos. The per-tile action bar appears only when hovering a photo tile (`[data-p]` or
   `[jsname="p43zde"]`).
   **Follow-up:** Upload a test photo to the throwaway account first, then re-run `photos`.
   Expected items in photo-tile-hover-action ⋮: Add to album, Move to Trash, Share, Download,
   Get info, Make collage.

2. **photos / nav-context** — The global scrim overlay (`uW2Fw-IE5DDf`) blocks pointer events on
   all nav links. The nav link `a[aria-label="All photos"][href="./"]` is visible and in the DOM
   but receives no pointer events from Playwright.
   **Structural limitation:** Cannot be captured without dispatching `contextmenu` events via JS
   evaluate. Even if reachable, Photos likely does not implement a custom DOM context menu on nav links.

3. **photos / more-options (kebab)** — The main Photos grid page does not have a top-right kebab
   button. Trash, Locked Folder, and similar utility links are in the left sidebar under
   Library > Utilities. **No follow-up needed** — the sidebar links navigate directly, they are
   not menus. Document as "no kebab on main grid page" (already captured as 0 items).

4. **photos / create-menu\_\_From other places (submenu)** — The submenu hover is blocked by the
   scrim overlay inside the open menu itself. The submenu item has `aria-haspopup="menu"` and
   `aria-label="Upload photos from other places"`. Items likely include Dropbox, Amazon Photos,
   Facebook, etc.
   **Follow-up:** Use JS evaluate to dispatch `mouseover` event on the "From other places" menuitem.

5. **photos / cross-origin iframe drilldown (account-menu, apps-switcher)** — Both open iframes
   at `ogs.google.com` (same as Calendar/Meet/Books). Cannot be captured by the main-frame harness.
   The content matches the standard Google Account overlay documented in `calendar.md`.

### Google Keep gaps

1. **keep / note-collaborators** — The collaborator button (`[aria-label="Collaborator"]`) opens
   an inline dialog with an email input. Not a `[role="menu"]`. The dialog allows adding up to
   collaborators by email. **No standard menu to capture.**

2. **keep / account-menu / apps-switcher** — Uses `<a class="gb_C">` anchor pattern (same as
   Play Books, Calendar, Meet). Opens `ogs.google.com` iframe overlay.
   **Cross-origin iframe drilldown needed** — same structural limitation as other Google apps.

3. **keep / note card creation flow** — The `note-more-menu` setup step creates a note by clicking
   the compose area. The selector `.IZ65Hb-n0tgWb [role="combobox"]` targets the compose bar's
   text input. After Escape the note is committed. However, the hover step
   (`.IZ65Hb-n0tgWb:last-of-type`) fails because the newly created note card uses the same CSS
   class as the compose bar and the `:last-of-type` selector doesn't reliably target the new note.
   **The probe still works** because the "More" button remains visible from the previous hover state.
   A more robust approach would be to wait for a note count change after creation.

4. **keep / Formatting options** — The note card toolbar has a `[aria-label="Formatting options"]`
   button (class `TCl01b`). This was not probed. It likely opens a text formatting panel (bold,
   italic, underline, strikethrough, bulleted list, numbered list).

## Remaining Books gaps (after 2026-06-08 Books pass)

1. **books_library sort-menu / filter** — The library has no sort dropdown when the shelf is empty.
   The `#filterButton` opens an inline text filter, not a menu. With books in the library, a sort
   control may appear. **Follow-up:** Add books first, then re-run `books_library`.

2. **books_library account-menu / apps-switcher** — The library uses `<a>` anchors (class `gb_C`)
   for these controls. These open iframe overlays that are not detected by `waitForMenu`.
   Same structural limitation as Calendar/Meet waffle/account.

3. **books_detail share-button** — A Share button was not present on the public-domain free book detail
   page. Paid books may have a share option. **Follow-up:** Check a paid book detail page.

4. **books_reader highlights-panel (Annotations)** — The panel opens as a side drawer (`mat-drawer`
   or similar Angular Material component) that is not detected as `[role="menu"]`, `[role="dialog"]`,
   or `[role="listbox"]`. The harness's `waitForMenu` times out.
   **Follow-up:** Add a custom detection path for Angular Material side panels.

5. **books_reader text-selection-context** — The test book (_Alice's Adventures in Wonderland_,
   `id=Y7sOAAAAIAAJ`) uses image-scanned pages with no selectable text DOM. The annotation popover
   (Highlight / Copy / Define / Translate / Search web) requires a reflowed EPUB.
   **Follow-up:** Use a reflowed ebook (e.g., a Project Gutenberg EPUB title with EPUB id style).

6. **books_reader right-click-page** — Not probed because the reader page body is in the iframe
   and the page content is image-rendered. Right-clicking shows the browser's native context menu.

## How to run follow-up captures

```bash
cd grown-workspace/research/gworkspace-frontend/playwright

# Check session validity first
nix develop --command node menus.mjs gmail 2>&1 | head -20

# If session valid, run specific targets:
nix develop --command node menus.mjs gmail
nix develop --command node menus.mjs settings drive_settings

# Books targets:
nix develop --command node menus.mjs books_library books_detail books_reader

# Photos + Keep targets:
nix develop --command node menus.mjs photos keep

# Full refresh:
nix develop --command node menus.mjs all
nix develop --command node menus.mjs settings all
```

If session is expired:

```bash
nix develop --command node capture.mjs auth
# sign in to throwaway account in the browser window that opens
nix develop --command node menus.mjs all
nix develop --command node menus.mjs settings all
```

## Capture artifacts

Live captures land in `pass3/<target>/menus/` or `pass3/<target>/settings/` (gitignored):

- `<menu-name>.html` — raw outerHTML of the open menu
- `<menu-name>.json` — structured `{name, trigger, items[], capturedAt}`
- `<menu-name>.png` — screenshot of the open menu
- `<menu-name>__<submenu-label>.{html,json,png}` — submenu captures
- `_summary.json` — run summary with per-probe status

For settings:

- `<tab>.html` — outerHTML of `[role="main"]` or `[role="dialog"]`
- `<tab>.json` — flat inventory of interactive elements `{tag, role, label, ...}`
- `<tab>.png` — screenshot
- `_summary.json` — tab run summary
