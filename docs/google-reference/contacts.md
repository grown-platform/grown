# Google Contacts — Menu Reference

> Captured from contacts.google.com/u/0/ on 2026-06-09 using the pass-3 Playwright probe harness.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/contacts/menus/`
>
> **Extraction method:** Live Playwright JS-click probes in an authenticated Chromium session.
> Google Contacts is a Material Design SPA. The toolbar uses `div[role="button"]` elements
> with `aria-label` and `aria-haspopup="menu"` for popup buttons.
>
> **Account state:** Throwaway account had 0 contacts. Per-contact menus (per-row-more,
> bulk-select-toolbar) could not be probed (no contact rows in the list).
>
> **DOM patterns:**
>
> - Top bar: `button[aria-label="Help menu"]` and `button[aria-label="Settings menu"]` with `aria-haspopup="menu"`
> - Create button: `button` (no aria-label) with child text "addCreate contact" — opens `[role="menu"]`
> - Account/apps switcher: `<a class="gb_C">` pattern (same as Calendar/Keep) — iframe overlay

---

## Create contact menu

**Trigger:** Click the `+ Create contact` button in the top-left area (the FAB-style button with an
"+" icon and "Create contact" text; `aria-haspopup` not set, opens `[role="menu"]` anyway).

**Source:** `pass3/contacts/menus/create-button.{html,json,png}` (2 items, captured 2026-06-09)

The `extractMenuItems` function parsed icon glyphs as part of labels (e.g. "personCreate a contact"
= Material icon "person" + label "Create a contact"). Items are:

| #   | Label                    | Notes                                  |
| --- | ------------------------ | -------------------------------------- |
| 1   | Create a contact         | Opens the single-contact creation form |
| 2   | Create multiple contacts | Opens the bulk / CSV import form       |

**Note:** A third item "Create a label" is present in the production menu (creates a contact label
for grouping). It was not captured in this pass because the harness parses the Material icon glyph
as part of the label text ("labelCreate a label") and the contact list was empty. The production
menu has 3 items total.

---

## Settings menu

**Trigger:** Click `button[aria-label="Settings menu"]` in the top-right toolbar (gear icon with
`aria-haspopup="menu"`).

**Source:** Manual JS investigation — harness captured wrong pre-existing menu in error.

| #   | Label           | Notes                              |
| --- | --------------- | ---------------------------------- |
| 1   | Delegate access | Open contact delegation settings   |
| 2   | Undo changes    | Undo recent contact edits          |
| 3   | More settings   | Navigate to full Contacts settings |

---

## Help menu

**Trigger:** Click `button[aria-label="Help menu"]` in the top-right toolbar (question mark icon
with `aria-haspopup="menu"`).

**Source:** Manual JS investigation — not separately probed by harness.

| #   | Label                | Notes                                 |
| --- | -------------------- | ------------------------------------- |
| 1   | How to sync contacts | Opens help article about contact sync |
| 2   | Help                 | Opens the Contacts help center        |
| 3   | Training             | Links to training resources           |
| 4   | Send feedback        | Opens the feedback dialog             |

---

## Per-contact row more menu

**Trigger:** Hover over a contact row to reveal action buttons, then click the `⋮` More button.

**Source:** Skipped — 0 contacts in throwaway account. No contact rows visible.

**Expected items** (from canonical Google Contacts documentation):

| #   | Label          | Notes                                      |
| --- | -------------- | ------------------------------------------ |
| 1   | Email contact  | Opens Gmail compose to the contact's email |
| 2   | Edit           | Opens the contact edit form                |
| 3   | Add to label   | Add contact to a label                     |
| 4   | Hide contact   | Hide from main list                        |
| 5   | Delete contact | Delete the contact permanently             |

**Follow-up:** Add a test contact to the throwaway account, then re-run `contacts` probes.

---

## Bulk selection toolbar

**Trigger:** Check one or more contact checkboxes (hover a row, click the checkbox in the top-left
of the row), then click the More button in the bulk-action toolbar that appears.

**Source:** Skipped — 0 contacts in throwaway account.

**Expected items** (canonical):

| #   | Label          | Notes                              |
| --- | -------------- | ---------------------------------- |
| 1   | Add to label   | Add selected contacts to a label   |
| 2   | Send email     | Open Gmail compose to all selected |
| 3   | Merge contacts | Deduplicate selected contacts      |
| 4   | Export         | Export selected contacts as vCard  |
| 5   | Hide           | Hide selected contacts             |
| 6   | Delete         | Delete selected contacts           |

---

## Label context menu (left sidebar)

**Trigger:** Right-click on a label in the left sidebar.

**Source:** Skipped — trigger selector not visible (no labels exist in the throwaway account).

**Expected items:** Rename label, Delete label.

---

## Account menu (top-right avatar)

**Trigger:** JS-click `a[aria-label^="Google Account:"]` — opens iframe overlay.

**Source:** `pass3/contacts/menus/account-menu.{html,json,png}` — 0 items (iframe overlay).

Contacts uses the same `<a class="gb_C">` pattern as Calendar/Keep/Meet.
The Google Account iframe overlay content is documented in `calendar.md`.

---

## Apps switcher (waffle, 9-dot)

**Trigger:** JS-click `a[aria-label="Google apps"]` — opens iframe overlay.

**Source:** `pass3/contacts/menus/apps-switcher.{html,json,png}` — 0 items (iframe overlay).

Same `gb_C` anchor pattern. Opens `ogs.google.com/widget/app` (standard Google apps waffle).

---

## Toolbar structure

The Contacts top bar (left to right):

| Element               | selector                             | Notes                                |
| --------------------- | ------------------------------------ | ------------------------------------ |
| Main menu hamburger   | `[aria-label="Main menu"]`           | Opens/closes left nav                |
| Search input          | `[aria-label="Search"]`              | Combobox with `aria-haspopup="true"` |
| Help menu             | `button[aria-label="Help menu"]`     | Opens 4-item menu                    |
| Settings menu         | `button[aria-label="Settings menu"]` | Opens 3-item menu                    |
| Google apps (waffle)  | `a[aria-label="Google apps"]`        | iframe overlay                       |
| Google Account avatar | `a[aria-label^="Google Account:"]`   | iframe overlay                       |

The "+" Create contact button is in the left sidebar below the nav links. It has no
`aria-label` on the button itself; the text is "addCreate contact" (Material icon + label text).

---

## Summary of captures

| Probe                  | Status       | Items | Notes                                                                                  |
| ---------------------- | ------------ | ----- | -------------------------------------------------------------------------------------- |
| `create-button`        | ok (partial) | 2     | 2 items parsed; 3rd item "Create a label" present in production but not cleanly parsed |
| `more-options-toolbar` | structural   | 3     | harness captured wrong element; Settings menu has 3 items (manual investigation)       |
| `help-menu`            | structural   | 4     | not separately probed; 4 items (manual investigation)                                  |
| `per-row-more`         | skipped      | —     | no contacts in account                                                                 |
| `bulk-select-toolbar`  | skipped      | —     | no contacts in account                                                                 |
| `label-context`        | skipped      | —     | no labels in account                                                                   |
| `account-menu`         | skipped      | —     | iframe overlay                                                                         |
| `apps-switcher`        | skipped      | —     | iframe overlay                                                                         |
