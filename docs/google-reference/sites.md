# Google Sites — Menu Reference

> Captured from sites.google.com/u/0/ on 2026-06-09 using the pass-3 Playwright probe harness.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/sites/menus/`
>
> **Extraction method:** Live Playwright JS-click probes in an authenticated Chromium session.
> Google Sites is a Material Design SPA (similar structure to Docs/Sheets landing pages).
>
> **Account state:** No existing sites in the throwaway account. Per-site-card probes were skipped.
>
> **DOM patterns:**
>
> - Template gallery: `[role="listbox"]` — always visible on page load, containing template options.
>   This caused all 4 harness probes to capture template items instead of their target menus.
>   Harness fix needed: dismiss pre-existing menus before each probe.
> - Sort options: `[aria-label="Sort options"][aria-haspopup="true"]` (DIV role=button) —
>   clicking expands the template listbox with more templates; actual sort listbox may be embedded.
> - Owner filter: `[aria-label="Owner Filter Options"][aria-haspopup="true"]` — shows ownership filter
> - More actions: `[aria-label="More actions."][aria-haspopup="true"]` — top toolbar
> - App switcher: always-visible `[role="menu"]` in the DOM for the app-nav menu
>
> **Structural limitation:** The Sites landing page pre-loads:
>
> 1. A `[role="listbox"]` template gallery (always visible)
> 2. A `[role="menu"]` app-nav sidebar (always visible)
>    These pre-existing menus cause `waitForMenu` to return them immediately without waiting for
>    a click event. All harness captures reflect the template gallery, not the intended targets.

---

## Create site — Template gallery

**Trigger:** The template gallery is always visible on the Sites landing page. Clicking "Blank site"
or any template in the gallery creates a new site. There is no separate Create button that opens
a dropdown — the gallery IS the create entry point.

**Source:** `pass3/sites/menus/create-site-button.{html,json,png}` — captured the pre-existing
template listbox (6 initially visible templates, captured 2026-06-09)

The template gallery `[role="listbox"]` shows (initially visible, more after expanding):

| Template    | Notes                                |
| ----------- | ------------------------------------ |
| Blank site  | Empty canvas, start from scratch     |
| Event       | Template for event announcements     |
| Help Center | Template for internal knowledge base |
| Project     | Template for project documentation   |
| Team        | Template for team/department pages   |
| Portal      | Template for portal/intranet pages   |

**Additional templates** (visible after clicking "Template gallery" to expand):
Dog Walker, Holiday Party, Photo Portfolio, Restaurant, Salon, Wedding, Family Update, Portfolio,
Graduates, Professors, Class, Club, Student Portfolio, and more.

---

## Sort options

**Trigger:** Click `[aria-label="Sort options"]` (DIV with `aria-haspopup="true"`) in the
"Recent sites" toolbar area.

**Source:** `pass3/sites/menus/sort-menu.{html,json,png}` — captured template listbox (wrong menu).

**Structural note:** When Sort options is clicked, it expands the template gallery to show more
templates rather than opening a distinct sort dropdown. The "Recent sites" list may use a different
sort control. From DOM inspection, the Sites sort options include:

| #   | Label               | Notes                                  |
| --- | ------------------- | -------------------------------------- |
| 1   | Last opened by me   | Sort by last open time (default)       |
| 2   | Last modified by me | Sort by last edit time                 |
| 3   | Last modified       | Sort by last modification (any editor) |
| 4   | Title               | Sort alphabetically by site name       |

**Follow-up:** This needs re-capture with pre-existing menu dismissed.

---

## Owner filter

**Trigger:** Click `[aria-label="Owner Filter Options"]` (DIV with `aria-haspopup="true"`,
visible text "Owned by anyone") in the "Recent sites" toolbar.

**Source:** Not separately captured. From DOM inspection:

| #   | Label           | Notes                            |
| --- | --------------- | -------------------------------- |
| 1   | Owned by anyone | Default filter — shows all sites |
| 2   | Owned by me     | Show only sites you own          |
| 3   | Not owned by me | Show sites shared with you       |

---

## More actions toolbar menu

**Trigger:** Click `[aria-label="More actions."]` (DIV with `aria-haspopup="true"`) in the
toolbar next to the Sort and Owner Filter controls.

**Source:** From manual JS investigation, this opens a menu with navigation/app items
(Sites, Docs, Sheets, Slides, Forms, etc.) — this is the same app-nav menu that is already
pre-loaded in the DOM. **Not a meaningful target** — it appears to be an app-switcher menu.

---

## Per-site card more menu

**Trigger:** Hover over a site card on the landing page, then click the `⋮` button that appears.

**Source:** Skipped — no existing sites in the throwaway account. No site cards visible.

**Expected items** (from canonical Google Sites documentation):

| #   | Label                   | Notes                             |
| --- | ----------------------- | --------------------------------- |
| 1   | Open                    | Open the site for viewing         |
| 2   | Open in new tab         | Open site in a new browser tab    |
| 3   | Move to                 | Move site to a different location |
| 4   | Rename                  | Rename the site                   |
| 5   | Add a shortcut to Drive | Pin site to Google Drive          |
| 6   | Remove                  | Remove site from recent list      |
| 7   | Settings                | Open site settings dialog         |

**Follow-up:** Create a test site in the throwaway account, then re-run `sites` probes.

---

## Sites editor menus (editor probe — not captured)

The Sites editor (accessible by clicking "Open" on an existing site) has a full editing
interface with:

- **Insert pane** (left sidebar): Text box, Image, Embed, Google Drive, Maps, etc.
- **Themes pane** (header toolbar, "Themes" button): Color palette and font selectors
- **Pages pane** (left sidebar tab): Page management
- **More actions menu** (header toolbar `⋮`): Publish, Preview, Version history, Settings, etc.
- **Content block context toolbar**: Appears when clicking any content block, with Edit, Duplicate, Delete

**Source:** Skipped — no existing sites in account. Editor probes require opening a site.

**Follow-up:** Create a test site, open it in editor mode (`https://sites.google.com/u/0/<site-id>/edit`),
then probe the editor menus. Key selectors to try:

- Insert pane: `[aria-label="Insert"]` or `.vYRXB` sidebar panel
- Themes pane: `[aria-label="Themes"]` header button
- Pages pane: `[aria-label="Pages"]` sidebar tab
- More actions: `[aria-label="More actions"], [aria-label="More"]` header button

---

## Template gallery toggle

**Trigger:** Click `[aria-label="Template gallery"]` DIV button to expand/collapse the full
template gallery grid.

**Source:** Toggle action — does not open a `[role="menu"]`. Toggles the visibility of the
template gallery grid below the recently-used templates row.

---

## Account menu (top-right avatar)

**Trigger:** JS-click `a[aria-label^="Google Account:"]` — opens iframe overlay.

**Source:** `pass3/sites/menus/account-menu.{html,json,png}` — 6 items captured but these
are template names from the pre-existing gallery listbox. Not the intended menu.

Sites uses the `<a class="gb_C">` pattern. The Google Account iframe is documented in `calendar.md`.

---

## Apps switcher (waffle, 9-dot)

**Trigger:** JS-click `a[aria-label="Google apps"]` — opens iframe overlay.

**Source:** `pass3/sites/menus/apps-switcher.{html,json,png}` — 6 items captured but these
are template names from the pre-existing gallery listbox. Not the intended menu.

---

## Summary of captures

| Probe                     | Status     | Items | Notes                                                                                        |
| ------------------------- | ---------- | ----- | -------------------------------------------------------------------------------------------- |
| `create-site-button`      | partial    | 6     | Template gallery captured correctly (Blank site + 5 templates); it IS the create entry point |
| `per-site-row-more`       | skipped    | —     | No sites in account                                                                          |
| `sort-menu`               | needs-fix  | —     | Captured template gallery; Sort listbox needs pre-existing menu dismissal                    |
| `owner-filter`            | structural | 3     | Owned by anyone, Owned by me, Not owned by me — from DOM inspection                          |
| `template-gallery-toggle` | not-a-menu | —     | Toggle action, not a dropdown                                                                |
| `account-menu`            | skipped    | —     | iframe overlay (harness captured wrong pre-existing menu)                                    |
| `apps-switcher`           | skipped    | —     | iframe overlay (harness captured wrong pre-existing menu)                                    |
| Sites editor probes       | skipped    | —     | No sites in account; all editor probes require an existing site                              |
