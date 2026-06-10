# Google Docs Landing Page — Menu Reference

> Captured from docs.google.com/document/u/0/ on 2026-06-08.
> Live probe artifacts: `grown-workspace/research/gworkspace-frontend/pass3/docs_landing/menus/`
>
> The landing page shows recent documents and a template gallery. There is no
> editor menubar. Menus are limited to tile actions, sort, and the standard
> Google header menus. Sort-options, more-actions-tile, apps-switcher, and account-menu
> confirmed from live capture.

---

## Template gallery toggle

**Trigger:** `aria-label="Template gallery"` button (top of page, shows/hides the template section).

This is a disclosure toggle, not a menu. It expands/collapses the template gallery section
which shows templates grouped by category (Personal, Work, Education, etc.).

---

## Sort options menu

**Trigger:** Click `aria-label="Sort options"` button.

| #   | Label               | Notes            |
| --- | ------------------- | ---------------- |
| 1   | Last opened by me   | Default sort     |
| 2   | Last modified by me |                  |
| 3   | Last modified       |                  |
| 4   | Title               | Alphabetical A–Z |

---

## File tile triple-dot menu

**Trigger:** Click `aria-label="More actions."` on a document tile (appears on hover).

| #   | Label           | Has submenu | Notes                               |
| --- | --------------- | ----------- | ----------------------------------- |
| 1   | Open            | —           | Opens the document                  |
| 2   | Open in new tab | —           |                                     |
| —   | _separator_     |             |                                     |
| 3   | Rename          | —           | Inline rename                       |
| 4   | Move            | —           | Move to folder                      |
| —   | _separator_     |             |                                     |
| 5   | Make a copy     | —           | Duplicates in Drive                 |
| 6   | Download        | yes ▸       | Format choices                      |
| —   | _separator_     |             |                                     |
| 7   | Remove          | —           | Remove from recent list (not trash) |

**Source:** `aria-label="More actions."` and `aria-label="More actions. Popup button."`
confirmed in `pass2/docs_landing/dom.html`. Exact items require live capture.
See `SCRAPE_PLAN.md`.

---

## Owner filter menu

**Trigger:** Click `aria-label="Owner Filter Options"` (filter chips area).

| #   | Label           | Notes   |
| --- | --------------- | ------- |
| 1   | Owned by me     | Default |
| 2   | Not owned by me |         |
| 3   | Owned by anyone |         |

---

## Apps switcher (9-dot waffle)

**Trigger:** `aria-label="Google apps"` (top-right).
Same content as Drive apps switcher — see `drive.md`.

---

## Account menu

**Trigger:** `aria-label^="Google Account:"` avatar (top-right).
Same as Drive account menu — see `drive.md`.

---

## Main menu (hamburger)

**Trigger:** `aria-label="Main menu"` (top-left, opens Google Docs navigation sidebar).

| #   | Label              | Notes                                    |
| --- | ------------------ | ---------------------------------------- |
| 1   | Home               | Docs home                                |
| 2   | Recent             | Recently opened docs                     |
| 3   | Starred            | Starred docs                             |
| 4   | Trash              | Trashed docs                             |
| —   | _separator_        |                                          |
| 5   | Shared drives      | If Workspace plan includes shared drives |
| —   | _separator_        |                                          |
| 6   | Settings           | Docs settings                            |
| 7   | Downloads          | Download Docs for Desktop                |
| 8   | Keyboard shortcuts |                                          |
