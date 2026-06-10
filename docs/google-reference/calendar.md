# Calendar — Menu Reference

> Captured from calendar.google.com/calendar/u/0/r on 2026-06-08 using the pass-3 Playwright probe harness.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/calendar/menus/`
>
> **Extraction method:** Live Playwright click/right-click probes in an authenticated Chromium session.
> Calendar uses custom JS event handlers throughout — right-clicking any area of the grid does not
> produce a DOM `[role="menu"]` element; only left-clicks trigger Calendar's own menus and dialogs.
> The waffle (apps switcher) and account avatar open iframes rather than DOM menus; those are
> documented from the iframe frame content.

---

## + Create button

**Trigger:** Click the `+ Create` button in the top-left toolbar (the large primary action button, not the "Create" tooltip that appears when hovering a date cell in the grid).

**Source:** `pass3/calendar/menus/create-button.{html,json,png}` (6 items, captured 2026-06-08)

| #   | Label                | Shortcut | Has submenu | Notes                                                      |
| --- | -------------------- | -------- | ----------- | ---------------------------------------------------------- |
| 1   | Event                | —        | —           | Opens the new-event quick-create form or full event editor |
| 2   | Task                 | —        | —           | Create a Google Task visible on the calendar               |
| 3   | Out of office        | —        | —           | Block time and decline meetings automatically              |
| 4   | Focus time           | —        | —           | Block calendar time for focused work                       |
| 5   | Working location     | —        | —           | Set office / home / other for the day                      |
| 6   | Appointment schedule | —        | —           | Create a bookable appointment schedule page                |

---

## Settings gear menu

**Trigger:** Click the gear icon button (`aria-label="Settings menu"`) in the top-right toolbar.

**Source:** `pass3/calendar/menus/settings.{html,json,png}` (5 items, captured 2026-06-08)

| #   | Label       | Shortcut | Has submenu | Notes                                          |
| --- | ----------- | -------- | ----------- | ---------------------------------------------- |
| 1   | Settings    | —        | —           | Opens full Calendar settings page              |
| 2   | Trash       | —        | —           | Opens the Calendar trash (deleted events)      |
| 3   | Appearance  | —        | —           | Density and color settings                     |
| 4   | Print       | —        | —           | Print current calendar view                    |
| 5   | Get add-ons | —        | —           | Opens G Suite Marketplace for Calendar add-ons |

---

## View selector dropdown

**Trigger:** Click the view-name button in the top toolbar (shows current view, e.g. "Week", with a dropdown arrow). The button has `aria-haspopup="menu"`.

**Source:** `pass3/calendar/menus/view-dropdown.{html,json,png}` (6 items, captured 2026-06-08)

The view labels include the keyboard shortcut character appended (e.g. "DayD" = Day + shortcut D).

| #   | Label    | Shortcut | Notes                  |
| --- | -------- | -------- | ---------------------- |
| 1   | Day      | D        | Day view               |
| 2   | Week     | W        | Week view (default)    |
| 3   | Month    | M        | Month view             |
| 4   | Year     | Y        | Year view              |
| 5   | Schedule | A        | Agenda / Schedule view |
| 6   | 4 days   | X        | Custom 4-day view      |

---

## Time slot click — New event quick dialog

**Trigger:** Left-click on any empty area of the main week-view grid (the large content area to the right of the sidebar).

**Source:** `pass3/calendar/menus/timeslot-click.{html,json,png}` (dialog, captured 2026-06-08)

Left-clicking an empty time slot opens the **New event quick-create dialog** (`[role="dialog"]`). This is not a menu; it is a full-featured dialog with multiple inline selectors.

The dialog captured 166 `[role="option"]` elements corresponding to the inline dropdown pickers within the form. Key controls (not a flat menu list):

| Control             | Options / Notes                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Title input         | Free-text event name                                                                                                          |
| Start time picker   | 15-minute increments from 12:00am to 11:45pm (96 options)                                                                     |
| Duration picker     | 0 mins to 23.5 hrs in 30-minute increments (relative to start)                                                                |
| Repeat dropdown     | Does not repeat / Daily / Weekly on [day] / Monthly on the [nth day] / Annually on [date] / Every weekday (Mon–Fri) / Custom… |
| Status              | Busy / Free                                                                                                                   |
| Visibility          | Default visibility / Public / Private                                                                                         |
| Notification        | When event starts / 5 min before / 10 min / 15 min / 30 min / 1 hour / 1 day / Custom…                                        |
| More options button | Opens full event editor                                                                                                       |
| Save button         | Saves event to calendar                                                                                                       |

---

## Sidebar calendar options menu

**Trigger:** Hover over a calendar in the "My calendars" or "Other calendars" sidebar list. A three-dot button (`aria-label="Options for <calendar name>"`) appears on the right side of the item. Click that button.

**Source:** `pass3/calendar/menus/sidebar-calendar-options.{html,json,png}` (5 items, captured 2026-06-08)

The calendar captured was "30 min with Lucas" (an appointment schedule calendar).

| #   | Label            | Has submenu | Notes                                     |
| --- | ---------------- | ----------- | ----------------------------------------- |
| 1   | Preview          | —           | Preview the calendar's booking page       |
| 2   | Edit             | —           | Edit the calendar or appointment schedule |
| 3   | Sharing options  | —           | Open sharing / permissions settings       |
| 4   | Show on calendar | —           | Toggle calendar visibility                |
| 5   | Delete           | —           | Delete the calendar                       |

**Note:** The exact items depend on the calendar type (personal calendar vs. appointment schedule vs. subscribed calendar). A personal calendar would show: Edit / Sharing and viewing / Notifications / View calendar / Settings and sharing / Create event / Unsubscribe / Remove from other calendars.

---

## Skipped / not-a-menu probes

### event-context (right-click on event)

Calendar does not open a DOM context menu on right-click of event chips. Right-clicking on the grid produces only browser-level tooltips and no `[role="menu"]` element. **Skip — structural limitation.** The throwaway account also had no events in the current week view.

### search

Clicking the search icon (`button.belXNd[aria-label="Search"]`) expands a combobox text input (`[role="combobox"]`) in the top bar. This is not a menu. Suggestions appear after typing. **Not captured as a menu.**

### apps-switcher / account-menu

The waffle icon and account avatar both open iframe-based overlays (`ogs.google.com`). These are not captured by the standard `waitForMenu` harness (which looks for `[role="menu"]`, `[role="listbox"]`, etc. in the main frame). The iframe content is documented from manual frame inspection:

**Apps switcher (waffle) iframe contents** (`ogs.google.com/widget/app`):
Account, Admin, Gmail, Drive, Gemini, Docs, Sheets, Slides, Forms, Calendar, Meet, and more Google apps with navigation links.

**Account menu iframe contents** (`ogs.google.com/widget/account`):

- Managed by [domain] (org info)
- Admin console link
- Manage your Google Account
- Add recovery phone prompt
- Add account
- Sign out
- Privacy Policy / Terms of Service
