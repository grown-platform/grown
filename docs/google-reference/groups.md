# Google Groups — Menu Reference

> Captured from groups.google.com/u/0/my-groups on 2026-06-09 using the pass-3 Playwright probe harness.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/groups/menus/`
>
> **Extraction method:** Live Playwright JS-click probes in an authenticated Chromium session.
> Google Groups is a Material-style SPA listing the user's group memberships.
>
> **Account state:** Throwaway account was a member of 1 group: "test" (test@yield-llc.com).
>
> **DOM patterns:**
>
> - Navigation listbox: `[role="listbox"]` containing "My groups / All groups and messages" — always
>   visible on page load. This caused the harness to capture the nav listbox instead of target menus
>   for create-group-button, bulk-select-toolbar, account-menu, and apps-switcher probes.
> - Group rows: `[role="row"]` — header row + one data row per group
> - Per-row more: `[aria-label="More"][aria-haspopup="true"]` inside each group row — hidden by CSS,
>   only accessible via JS click (not hover-revealed in Playwright)
> - Settings gear: opens `[role="menu"]` correctly
>
> **Create group button:** The "Create group" button (`button:has-text("Create group")`) navigates
> to `/groups/create` — it does NOT open a dropdown menu. This is a navigation action, not a menu trigger.

---

## Settings menu (gear icon)

**Trigger:** Click the gear icon button `[aria-label="Settings"]` (or similar Settings button in
the top toolbar). Opens `[role="menu"]`.

**Source:** `pass3/groups/menus/settings-cog.{html,json,png}` (4 items, captured 2026-06-09)

| #   | Label                   | Notes                                     |
| --- | ----------------------- | ----------------------------------------- |
| 1   | Global settings         | Opens global Google Groups admin settings |
| 2   | Send feedback to Google | Opens the feedback dialog                 |
| 3   | Help                    | Opens the Groups help center              |
| 4   | Training                | Links to training resources               |

---

## Per-group row more menu

**Trigger:** Click `[aria-label="More"][aria-haspopup="true"]` inside a group row.
The button is hidden (`display: none`) and not revealed by CSS hover in Playwright —
only accessible via `element.click()` via JS evaluate.

**Source:** Manual JS investigation — harness probe `per-group-row-more` was skipped
(trigger selector not visible after setup hover).

| #   | Label          | Notes                                   |
| --- | -------------- | --------------------------------------- |
| 1   | Group settings | Open the group's settings page          |
| 2   | Add members    | Open the Add members form for the group |
| 3   | Leave group    | Leave the group                         |
| 4   | Favorite group | Add/remove group from Favorites         |

---

## "Create group" button

**Trigger:** Click `button:has-text("Create group")` in the top-left area.

**Source:** `pass3/groups/menus/create-group-button.{html,json,png}` — captured wrong
pre-existing navigation listbox (2 items: My groups / All groups and messages).

**Actual behavior:** The "Create group" button navigates to `https://groups.google.com/u/0/create`
(a multi-step creation form). It does NOT open a dropdown menu. **Not a menu target.**

---

## Bulk selection toolbar

**Trigger:** Check a group's checkbox, then click the more/actions button in the toolbar
that appears.

**Source:** `pass3/groups/menus/bulk-select-toolbar.{html,json,png}` — captured wrong
pre-existing navigation listbox (2 items: My groups / All groups and messages).

**Structural note:** The bulk-select toolbar in Google Groups shows action buttons directly
(no overflow dropdown for the minimal set of groups in this account). Actions visible after
selecting a group:

- Leave (immediately leave the selected group)
- Unsubscribe from email (change subscription)

No separate "More" dropdown was visible with 1 group selected. With multiple groups selected,
a different set of actions may appear.

---

## Groups filter / sort

**Trigger:** Not found — no Filter or Sort dropdown button exists on the `my-groups` page.
The left sidebar has a `[role="listbox"]` navigation (My groups / All groups / Favorite groups /
Starred conversations) which is a nav component, not a filter/sort menu.

**Note:** The "Create folder" item appears in the sidebar nav — it creates a folder for organizing
groups, not a sort operation.

---

## Account menu (top-right avatar)

**Trigger:** JS-click `a[aria-label^="Google Account:"]` — opens iframe overlay.

**Source:** `pass3/groups/menus/account-menu.{html,json,png}` — 2 items captured but these
are the nav listbox items ("My groups", "All groups and messages"), NOT the account iframe.
The iframe overlay could not be detected by the main-frame harness.

Contacts uses the same `<a class="gb_C">` pattern. The Google Account iframe is documented
in `calendar.md`.

---

## Apps switcher (waffle, 9-dot)

**Trigger:** JS-click `a[aria-label="Google apps"]` — opens iframe overlay.

**Source:** `pass3/groups/menus/apps-switcher.{html,json,png}` — 2 items captured but these
are the nav listbox items (same pre-existing nav capture error as account-menu).

The apps switcher iframe content is the standard waffle documented in `calendar.md`.

---

## Left sidebar navigation structure

The Groups left sidebar uses a Material listbox (`[role="listbox"]`) that is always visible
on page load. This is not a menu — it is the primary navigation:

| Item                  | Notes                                 |
| --------------------- | ------------------------------------- |
| My groups             | Your direct group memberships         |
| Recent groups         | Recently visited groups               |
| All groups            | Browse all groups in the domain       |
| Favorite groups       | Groups you have favorited             |
| Create folder         | Create a folder for organizing groups |
| Starred conversations | Messages you have starred             |

Each group membership also appears as a sub-item in "My groups" with an email subscription
settings listbox (`[role="listbox"]` with options: Each email, Digest, Abridged, No email).

---

## Summary of captures

| Probe                 | Status     | Items | Notes                                                                            |
| --------------------- | ---------- | ----- | -------------------------------------------------------------------------------- |
| `create-group-button` | not-a-menu | —     | Navigates to /groups/create; not a dropdown                                      |
| `per-group-row-more`  | structural | 4     | Group settings, Add members, Leave group, Favorite group — from JS investigation |
| `bulk-select-toolbar` | structural | —     | harness captured nav listbox; bulk toolbar shows direct buttons, no overflow     |
| `groups-filter`       | not-found  | —     | No Filter/Sort button on my-groups page                                          |
| `settings-cog`        | ok         | 4     | Global settings, Send feedback, Help, Training                                   |
| `account-menu`        | skipped    | —     | iframe overlay (harness captured wrong nav listbox)                              |
| `apps-switcher`       | skipped    | —     | iframe overlay (harness captured wrong nav listbox)                              |
