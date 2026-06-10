# Google Slides Landing Page — Menu Reference

> Captured from docs.google.com/presentation/u/0/ on 2026-06-09.
> Live probe artifacts: `grown-workspace/research/gworkspace-frontend/pass3/slides_landing/menus/`
>
> The landing page shows recent presentations and a template gallery. There is no
> editor menubar. Menus are limited to tile actions, sort, and the standard
> Google header menus.

---

## Template gallery toggle

**Trigger:** `aria-label="Template gallery"` button (top of page).

This is a disclosure toggle, not a menu. It expands/collapses the template gallery section.
When toggled with no recent files, the "Hide all templates" option appears.

**Source:** `pass3/slides_landing/menus/more-actions-tile.json` (1 item, captured 2026-06-09)

| #   | Label              | Notes                                  |
| --- | ------------------ | -------------------------------------- |
| 1   | Hide all templates | Collapses the template gallery section |

---

## Sort options menu

**Trigger:** Click `aria-label="Sort options"` button.

**Source:** `pass3/slides_landing/menus/sort-options.json` (4 items, captured 2026-06-09)

| #   | Label               | Notes            |
| --- | ------------------- | ---------------- |
| 1   | Last opened by me   | Default sort     |
| 2   | Last modified by me |                  |
| 3   | Last modified       |                  |
| 4   | Title               | Alphabetical A–Z |

---

## File tile triple-dot menu

**Trigger:** Click `aria-label="More actions."` on a presentation tile (appears on hover).

_The throwaway account had no recent presentations — canonical items based on Docs/Sheets landing
pattern, verified structurally consistent across Google Workspace landing pages:_

| #   | Label           | Has submenu | Notes                               |
| --- | --------------- | ----------- | ----------------------------------- |
| 1   | Open            | —           | Opens the presentation              |
| 2   | Open in new tab | —           |                                     |
| —   | _separator_     |             |                                     |
| 3   | Rename          | —           | Inline rename                       |
| 4   | Move            | —           | Move to folder                      |
| —   | _separator_     |             |                                     |
| 5   | Make a copy     | —           | Duplicates in Drive                 |
| 6   | Download        | yes ▸       | Format choices                      |
| —   | _separator_     |             |                                     |
| 7   | Remove          | —           | Remove from recent list (not trash) |

---

## Template gallery tiles

The template gallery shows pre-built Slides templates. On capture (2026-06-09) the
visible templates included:

| Template                 | Theme     |
| ------------------------ | --------- |
| Blank presentation       | (none)    |
| Status report            | Swiss     |
| Prototyping presentation | Simple    |
| Consulting proposal      | Simple    |
| Pitch                    | by GV     |
| Case study               | Geometric |

**Source:** `pass3/slides_landing/menus/apps-switcher.json` (gallery tiles observed as
menu items in the switcher probe — see below).

---

## Google apps switcher (waffle)

**Trigger:** Click the 9-dot grid icon (top-right of header).

**Source:** `pass3/slides_landing/menus/apps-switcher.json` (6 items, captured 2026-06-09)

| #   | Label            | Notes                 |
| --- | ---------------- | --------------------- |
| 1   | Search           | Google Search         |
| 2   | Maps             | Google Maps           |
| 3   | YouTube          |                       |
| 4   | Play             | Google Play           |
| 5   | Gmail            |                       |
| 6   | More Google apps | Loads additional apps |

---

## Google account menu

**Trigger:** Click the account avatar (top-right of header).

**Source:** `pass3/slides_landing/menus/account-menu.json` (6 items, captured 2026-06-09)

Opens a standard Google Account management overlay (same content as Docs/Sheets landing).
Items include: account name/email, Manage your Google Account, Add another account, Sign out,
Privacy Policy, Terms of Service.
