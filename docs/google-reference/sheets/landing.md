# Google Sheets Landing Page — Menu Reference

> Captured from docs.google.com/spreadsheets/u/0/ on 2026-06-08.
> Live probe artifacts: `grown-workspace/research/gworkspace-frontend/pass3/sheets_landing/menus/`
>
> The landing page shows recent spreadsheets and a template gallery.
> Structure is identical to the Docs landing page; same menu patterns apply.
> Sort-options, more-actions-tile, apps-switcher, and account-menu confirmed from live capture.

---

## Template gallery toggle

**Trigger:** `aria-label="Template gallery"` button.

Expands/collapses the template gallery section with Sheets templates grouped by category:

- Personal (Monthly budget, Annual budget, To-do list, Wedding planner, etc.)
- Work (Project schedule, Employee schedule, Expense report, Sales CRM, etc.)
- Education (Grade book, Class schedule, etc.)

---

## Sort options menu

**Trigger:** `aria-label="Sort options"` button.

**Source:** `pass3/sheets_landing/menus/sort-options.{html,json,png}` (4 items, captured 2026-06-08)

| #   | Label               | Notes            |
| --- | ------------------- | ---------------- |
| 1   | Last opened by me   | Default          |
| 2   | Last modified by me |                  |
| 3   | Last modified       |                  |
| 4   | Title               | Alphabetical A–Z |

---

## File tile triple-dot menu

**Trigger:** `aria-label="More actions."` or `aria-label="More actions. Popup button."` on a tile.

**Source:** `pass3/sheets_landing/menus/more-actions-tile.{html,json,png}` (captured 2026-06-08)

Note: The more-actions-tile probe returned 1 item ("Hide all templates") — this indicates the
probe clicked a templates-area action button rather than an individual file tile. The tile
right-click-context probe was skipped (trigger not visible at capture time). Canonical items:

| #   | Label           | Has submenu | Notes                                     |
| --- | --------------- | ----------- | ----------------------------------------- |
| 1   | Open            | —           |                                           |
| 2   | Open in new tab | —           |                                           |
| —   | _separator_     |             |                                           |
| 3   | Rename          | —           |                                           |
| 4   | Move            | —           |                                           |
| —   | _separator_     |             |                                           |
| 5   | Make a copy     | —           |                                           |
| 6   | Download        | yes ▸       | Format choices (xlsx, csv, pdf, ods, tsv) |
| —   | _separator_     |             |                                           |
| 7   | Remove          | —           | Remove from recent list                   |

---

## Owner filter menu

**Trigger:** `aria-label="Owner Filter Options"`.

| #   | Label           | Notes   |
| --- | --------------- | ------- |
| 1   | Owned by me     | Default |
| 2   | Not owned by me |         |
| 3   | Owned by anyone |         |

---

## View toggle

**Trigger:** `aria-label="Grid view"` or list/grid toggle buttons.

| #   | Label     | Notes                     |
| --- | --------- | ------------------------- |
| 1   | Grid view | Tile layout with previews |
| 2   | List view | Row layout with details   |

---

## Apps switcher / Account menu

Same as Drive and Docs landing pages — see `../drive.md`.

---

## Create new spreadsheet (FAB)

**Trigger:** `aria-label="Create new spreadsheet"` floating action button (+ icon, bottom-right).

Single action — creates a new blank spreadsheet immediately, navigates to editor.
No menu is shown; it is a direct action button.
