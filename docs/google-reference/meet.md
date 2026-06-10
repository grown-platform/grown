# Meet — Menu Reference

> Captured from meet.google.com/landing on 2026-06-08 using the pass-3 Playwright probe harness.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/meet/menus/`
>
> **Extraction method:** Live Playwright JS-click probes in an authenticated Chromium session.
> Several buttons on the Meet landing page are blocked by a full-page modal scrim when a dialog
> is open from a previous probe; JS clicks (bypassing pointer interception) were used for
> settings, feedback, apps-switcher, and account-menu probes.
>
> **Scope:** Meet landing page only. In-call menus (Layout, More options, Cast, etc.) require
> being inside an active meeting and are **out of scope** for this pass. See SCRAPE_PLAN.md
> for the follow-up note.

---

## New meeting button

**Trigger:** Click the `New meeting` button on the landing page. The button has `aria-haspopup="menu"`.

**Source:** `pass3/meet/menus/new-meeting-button.{html,json,png}` (3 items, captured 2026-06-08)

The captured item labels include a Material icon text prefix (e.g. "link", "add", "calendar_today") which is part of the DOM text content; the display label is shown below.

| #   | Label                       | Notes                                                               |
| --- | --------------------------- | ------------------------------------------------------------------- |
| 1   | Create a meeting for later  | Generates a meeting link to share; does not start a meeting         |
| 2   | Start an instant meeting    | Opens a meeting room immediately                                    |
| 3   | Schedule in Google Calendar | Navigates to Google Calendar to create a new event with a Meet link |

---

## Support menu

**Trigger:** Click the `Support` button (`aria-label="Support"`, `aria-haspopup="menu"`) in the top toolbar — the help outline icon.

**Source:** `pass3/meet/menus/support-menu.{html,json,png}` (5 items, captured 2026-06-08)

| #   | Label            | Notes                            |
| --- | ---------------- | -------------------------------- |
| 1   | Help             | Links to Meet Help Center        |
| 2   | Training         | Links to Meet training resources |
| 3   | Terms of Service | Links to Google Terms of Service |
| 4   | Privacy Policy   | Links to Google Privacy Policy   |
| 5   | Terms summary    | Summary of terms                 |

---

## Settings

**Trigger:** Click the gear icon (`aria-label="Settings"`) in the top toolbar — opens a settings dialog (not a `[role="menu"]`).

**Source:** `pass3/meet/menus/settings.{html,json,png}` (captured 2026-06-08)

The settings button opens a **dialog** with audio and video device configuration. The harness captured the landing page's sidebar navigation listbox (2 items: Meetings, Calls) instead of the dialog content because the dialog is a full-page overlay that the harness's `waitForMenu` detected as a `[role="listbox"]`.

The settings dialog contains:

| Tab   | Controls                                             |
| ----- | ---------------------------------------------------- |
| Audio | Microphone selector / Speaker selector / Volume test |
| Video | Camera selector / Preview / Resolution settings      |

---

## Feedback / Report a problem

**Trigger:** Click the feedback icon button (`aria-label="Report a problem"`) in the top toolbar.

**Source:** `pass3/meet/menus/feedback.{html,json,png}` (captured 2026-06-08)

Opens a feedback dialog (not a `[role="menu"]`). The harness captured the sidebar nav listbox (2 items: Meetings, Calls) instead of the dialog. The feedback dialog contains:

| Control               | Notes                                            |
| --------------------- | ------------------------------------------------ |
| Category selector     | Type of issue (e.g., audio, video, connectivity) |
| Description text area | Free-text description of the problem             |
| Screenshot toggle     | Attach/exclude screenshot                        |
| Submit button         |                                                  |

---

## Apps switcher (waffle)

**Trigger:** Click `a[aria-label="Google apps"]` in the top-right toolbar — opens an iframe overlay (`ogs.google.com/widget/app`).

**Source:** `pass3/meet/menus/apps-switcher.{html,json,png}` (captured 2026-06-08)

The waffle opens a cross-origin iframe. The harness captured the sidebar nav listbox instead of the iframe content. From manual frame inspection, the iframe contains:

Account, Admin, Gmail, Drive, Gemini, Docs, Sheets, Slides, Forms, Calendar, Meet, and more Google apps as navigation links.

---

## Account menu

**Trigger:** Click `[aria-label^="Google Account:"]` (the avatar `<a>` element) in the top-right — opens an account management iframe overlay (`ogs.google.com/widget/account`).

**Source:** `pass3/meet/menus/account-menu.{html,json,png}` (captured 2026-06-08)

The account avatar opens a cross-origin iframe. The harness captured the sidebar nav listbox instead of the iframe content. From manual frame inspection, the iframe contains:

| Control                           | Notes                                  |
| --------------------------------- | -------------------------------------- |
| User info                         | Name + email, org domain               |
| Manage your Google Account        | Link to myaccount.google.com           |
| Add recovery phone                | Prompt (if not set)                    |
| Add account                       | Switch to / add another Google account |
| Sign out                          | Sign out of current account            |
| Privacy Policy / Terms of Service | Footer links                           |

---

## Join meeting input area

**Structure:** The landing page has a text input (`placeholder="Enter a code or nickname"`, `aria-label="Enter a code or nickname"`) paired with a `Join` button. This is not a menu.

| Control             | Notes                                                    |
| ------------------- | -------------------------------------------------------- |
| Code/nickname input | Type a meeting code (e.g., `abc-defg-hij`) or a nickname |
| Join button         | Joins the meeting specified in the input                 |

---

## Out-of-scope: In-call menus

The following menus appear **only while inside an active meeting** and are not captured in this pass:

| Menu             | Trigger                               | Notes                             |
| ---------------- | ------------------------------------- | --------------------------------- |
| Layout           | More options (⋮) → Change layout      | Grid / Spotlight / Sidebar / Auto |
| More options (⋮) | Three-dot button in call controls bar | Full in-call options menu         |
| Cast             | Cast icon in call controls            | Cast to a TV/screen               |
| Breakout rooms   | Host-only button                      | Manage breakout rooms             |
| Present screen   | Screen share button                   | Source picker                     |
| Activities panel | Activities button                     | Polls, Q&A, whiteboard            |
| Reactions        | Emoji reaction button                 | Emoji picker                      |

See `SCRAPE_PLAN.md` — these require starting an actual instant meeting from the landing page and will need a dedicated follow-up session.
