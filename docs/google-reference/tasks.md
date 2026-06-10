# Google Tasks — Menu Reference

> Captured from the Tasks side panel on calendar.google.com/calendar/u/0/r on 2026-06-09
> using the pass-3 Playwright probe harness (tasksFrame mode).
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/tasks/menus/`
>
> **There is no standalone Google Tasks web app.**
> `tasks.google.com` redirects to `calendar.google.com`. The Tasks UI lives inside a
> `tasks.google.com/embed` iframe embedded in the Calendar right-side panel.
>
> **Access method:**
>
> 1. Navigate to `https://calendar.google.com/calendar/u/0/r`
> 2. Click the `[role="tab"][aria-label="Tasks"]` tab in the right-side panel strip
> 3. The Tasks iframe (`tasks.google.com/embed/?origin=https://calendar.google.com&...`) loads
>
> **Extraction method:** Probes use `tasksFrame: true` to target the Tasks iframe directly.
> Playwright Frame objects share the parent page keyboard but the iframe is accessible
> (same-origin via `tasks.google.com`).
>
> **DOM patterns in the Tasks iframe:**
>
> - Task list selector: `[aria-haspopup="true"]:not([aria-label])` — unlabelled button showing current list name
> - List options 3-dot: `[aria-label="List options"][aria-haspopup="true"]`
> - Open Tasks Fullscreen: `[aria-label="Open Tasks Fullscreen"]`
> - Close Tasks: `[aria-label="Close Tasks"]`
> - Active tasks: `[aria-label="Active tasks"]` — the task list container
> - Completed tasks: `[aria-label="Completed tasks section"]`
> - Add a task: text "Add a task" visible when the list is empty but no interactive selector exposed
>
> **Known limitation:** The Tasks iframe uses a pointer-intercepting scrim inside the iframe.
> `[role="menu"]:visible` returns `false` even when the menu is open and has items.
> The harness's `waitForMenu` relies on `:visible` filtering, so it fails.
> Menu items were captured via direct `document.querySelector('[role="menu"]')` without `:visible`.
>
> **Account state:** No tasks in "My Tasks". Only "My Tasks" and "Starred" lists exist.

---

## Task list selector dropdown

**Trigger:** Click the unlabelled `[aria-haspopup="true"]:not([aria-label])` button at the top
of the Tasks panel (shows current list name "My Tasks").

**Source:** `pass3/tasks/menus/task-list-dropdown.{html,json,png}` (2 items, captured 2026-06-09)

The dropdown lists all task lists plus the "Create new list" option. With a fresh account
("My Tasks" + "Starred") the dropdown shows:

| #   | Label           | Notes                                  |
| --- | --------------- | -------------------------------------- |
| 1   | Starred         | The "Starred" tasks list               |
| 2   | Create new list | Opens a prompt to name a new task list |

**Note:** "My Tasks" itself is not listed (it is the currently selected list). With more lists,
each list name appears as a menu item above "Create new list".

---

## List options menu (3-dot)

**Trigger:** Click `[aria-label="List options"]` (the ⋮ overflow button next to the list name in
the Tasks panel header). Item has `aria-haspopup="true"`.

**Source:** `pass3/tasks/menus/task-more-options.{html,json,png}` (7 items, captured 2026-06-09)

| #   | Label                      | Disabled | Notes                             |
| --- | -------------------------- | -------- | --------------------------------- |
| 1   | Rename list                | —        | Rename the current task list      |
| 2   | Delete list                | yes      | Default list cannot be deleted    |
| 3   | Print list                 | —        | Print the current task list       |
| 4   | Delete all completed tasks | yes      | Disabled when no completed tasks  |
| 5   | Clean up old tasks         | yes      | Disabled when no old tasks        |
| 6   | Keyboard shortcuts         | —        | Open keyboard shortcuts reference |
| 7   | Send feedback to Google    | —        | Open feedback dialog              |

**Structural note:** The "Delete list" item shows the tooltip "Default list can't be deleted" as
inline text in the DOM (appended to the item label). The harness captures it as
"Delete listDefault list can't be deleted" — the clean label is "Delete list".

---

## Per-task more actions menu

**Trigger:** Hover a task row, then click `[aria-label="More task actions"]` (the ⋮ button that
appears on the right side of the task row on hover).

**Source:** Skipped — throwaway account has no tasks. The `[aria-label="Active tasks"]` container
showed "No tasks yet" with zero task rows.

**Expected items** (from canonical Google Tasks documentation):

| #   | Label         | Notes                                                |
| --- | ------------- | ---------------------------------------------------- |
| 1   | Add a subtask | Add a sub-item under this task                       |
| 2   | Move to       | Move task to another list (submenu)                  |
| 3   | Edit details  | Open the task detail pane                            |
| 4   | Indent        | Indent the task (make it a subtask of the one above) |
| 5   | Unindent      | Unindent (promote subtask to top level)              |
| 6   | Delete task   | Delete this task                                     |

**Follow-up:** Create a test task in "My Tasks", then re-run `tasks` probes to capture
the per-task more menu.

---

## Task detail pane "More" menu

**Trigger:** Click a task title to open the task detail pane (expands inline or opens a side
panel), then click the `⋮` More button inside the detail pane.

**Source:** Skipped — no tasks in account.

**Expected items:** Same as per-task more menu above (Add a subtask, Move to, Delete task).

---

## Sort menu

**Trigger:** There is no separate Sort button in the Tasks side panel. The List options menu
(above) contains sort-related items indirectly. Sorting by date or other criteria is
accessible within the task list header.

**Note:** From DOM inspection, no `[aria-label*="Sort" i]` button exists in the Tasks iframe.
Sort order for tasks is configured via the List options menu or Google Tasks settings (accessible
via `[aria-label="Open Tasks Fullscreen"]` → Google Tasks full web app).

---

## "Add a task" input area

**Trigger:** Click the "Add a task" input area at the bottom of the Active tasks section.
The area shows the placeholder "Add a task" and reveals two quick-action icons on focus:
a Date/time icon and a Subtask icon.

**Source:** Skipped — the add-task input is not accessible via JS click when the task list
is empty and "No tasks yet" placeholder is showing. The input uses a custom element without
a `[placeholder]` or `[aria-label="Add a task"]` attribute.

**Structural documentation:** When a task is being added, the expanded input shows:

| Button    | `aria-label`    | Notes                           |
| --------- | --------------- | ------------------------------- |
| Date/time | `Add date/time` | Opens the task date/time picker |
| Subtask   | `Add subtask`   | Adds a subtask inline           |

---

## Panel action buttons (always-visible)

The Tasks panel header contains:

| Button                | `aria-label`            | Notes                                           |
| --------------------- | ----------------------- | ----------------------------------------------- |
| Task list selector    | (no label)              | Shows current list name; `aria-haspopup="true"` |
| List options          | `List options`          | Opens the 7-item list menu                      |
| Open Tasks Fullscreen | `Open Tasks Fullscreen` | Opens full Google Tasks web app in new tab      |
| Close Tasks           | `Close Tasks`           | Closes the Tasks side panel                     |

---

## Summary of captures

| Probe                | Status      | Items | Notes                                                                             |
| -------------------- | ----------- | ----- | --------------------------------------------------------------------------------- |
| `task-list-dropdown` | ok          | 2     | Starred, Create new list (My Tasks not shown — it's the current list)             |
| `task-more-options`  | ok (manual) | 7     | Captured via direct JS; harness's waitForMenu[:visible] failed due to Tasks scrim |
| `add-task-area`      | skipped     | —     | No tasks in account; add-task input not accessible                                |
| `per-task-more`      | skipped     | —     | No tasks in account                                                               |
| `task-edit-pane`     | skipped     | —     | No tasks in account                                                               |
| `sort-menu`          | structural  | —     | No Sort button in Tasks panel; sort is in List options                            |
