# Drive — Menu Reference

> Captured from drive.google.com on 2026-06-08 using the pass-3 Playwright probe harness.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/drive/menus/`
>
> **Extraction method:** Live Playwright click/right-click probes in an authenticated
> Chromium session. All menus documented here were captured by actually opening them
> (not from static DOM). Items tagged `[disabled]` were in a disabled state at capture
> time (e.g., no selection, no clipboard content, etc.).

---

## New button (top-left sidebar)

**Trigger:** Click the `+ New` button in the left sidebar.

**Source:** `pass3/drive/menus/new-button.{html,json,png}` (captured 2026-06-08)

| #   | Label         | Shortcut     | Has submenu | Disabled | Notes                                                           |
| --- | ------------- | ------------ | ----------- | -------- | --------------------------------------------------------------- |
| 1   | New folder    | Alt+C then F | —           | —        | Creates a new folder                                            |
| 2   | File upload   | Alt+C then U | —           | —        | Opens OS file picker                                            |
| 3   | Folder upload | Alt+C then I | —           | —        | Opens OS folder picker                                          |
| 4   | New project   | —            | —           | —        | Creates a new project workspace                                 |
| 5   | Google Docs   | —            | yes ▸       | —        | Blank doc / From template                                       |
| 6   | Google Sheets | —            | yes ▸       | —        | Blank sheet / From template                                     |
| 7   | Google Slides | —            | yes ▸       | —        | Blank presentation / From template                              |
| 8   | Google Vids   | —            | —           | —        | New Google Vids video                                           |
| 9   | Google Forms  | —            | yes ▸       | —        | Blank form / Blank quiz / From template                         |
| 10  | More          | —            | yes ▸       | —        | Google Drawings, My Maps, Sites, Apps Script, Connect more apps |

### More → submenu

| #   | Label              | Notes                     |
| --- | ------------------ | ------------------------- |
| 1   | Google Drawings    |                           |
| 2   | Google My Maps     |                           |
| 3   | Google Sites       |                           |
| 4   | Google Apps Script |                           |
| 5   | Connect more apps  | Opens G Suite Marketplace |

---

## Row right-click context menu

**Trigger:** Right-click on a file row in the list view.

**Source:** `pass3/drive/menus/row-context.{html,json,png}` (captured 2026-06-08)

| #   | Label                  | Shortcut      | Has submenu | Disabled | Notes                                  |
| --- | ---------------------- | ------------- | ----------- | -------- | -------------------------------------- |
| 1   | Open with              | —             | yes ▸       | —        | Preview, Google apps, connected apps   |
| 2   | Download               | —             | —           | —        |                                        |
| 3   | Rename                 | Ctrl+Alt+E    | —           | —        |                                        |
| 4   | Make a copy            | Ctrl+C Ctrl+V | —           | —        | Duplicates in same folder              |
| 5   | Ask Gemini             | —             | —           | —        | AI assistant for file (badge: New)     |
| 6   | Share                  | —             | yes ▸       | —        | Share / Get link / Email collaborators |
| 7   | Organize               | —             | yes ▸       | —        | Move / Add shortcut / Starred          |
| 8   | File information       | —             | yes ▸       | —        | Details / Activity                     |
| 9   | Make available offline | —             | —           | yes      | Disabled — offline not available       |
| 10  | Move to trash          | Delete        | —           | —        |                                        |

### Organize → submenu

| #   | Label                    | Notes                            |
| --- | ------------------------ | -------------------------------- |
| 1   | Open with                |                                  |
| 2   | Download                 |                                  |
| 3   | Rename                   |                                  |
| 4   | Make a copy              |                                  |
| 5   | Ask Gemini               |                                  |
| 6   | Create an audio overview | AI-generated audio summary (New) |
| 7   | Share                    |                                  |
| 8   | Organize                 |                                  |
| 9   | File information         |                                  |
| 10  | Move to trash            |                                  |

**Source:** `pass3/drive/menus/row-context__organize.{html,json,png}`

---

## Row triple-dot (⋮) menu

**Trigger:** Click the `⋮` "More actions" button on hover on a file row.

**Source:** `pass3/drive/menus/row-more-actions.{html,json,png}` (captured 2026-06-08)

| #   | Label                  | Shortcut      | Has submenu | Disabled | Notes      |
| --- | ---------------------- | ------------- | ----------- | -------- | ---------- |
| 1   | Open with              | —             | yes ▸       | —        |            |
| 2   | Download               | —             | —           | —        |            |
| 3   | Rename                 | Ctrl+Alt+E    | —           | —        |            |
| 4   | Make a copy            | Ctrl+C Ctrl+V | —           | —        |            |
| 5   | Ask Gemini             | —             | —           | —        | Badge: New |
| 6   | Share                  | —             | yes ▸       | —        |            |
| 7   | Organize               | —             | yes ▸       | —        |            |
| 8   | File information       | —             | yes ▸       | —        |            |
| 9   | Make available offline | —             | —           | yes      |            |
| 10  | Move to trash          | Delete        | —           | —        |            |

---

## Empty area right-click context menu

**Trigger:** Right-click on the empty area in the file grid (not on any row).

**Source:** `pass3/drive/menus/empty-area-context.{html,json,png}` (captured 2026-06-08)

Same 10 items as row-context; items are file-agnostic. Includes "Create an audio overview" (New badge) which was also observed.

| #   | Label                    | Has submenu | Disabled | Notes |
| --- | ------------------------ | ----------- | -------- | ----- |
| 1   | Open with                | yes ▸       | —        |       |
| 2   | Download                 | —           | —        |       |
| 3   | Rename                   | —           | —        |       |
| 4   | Make a copy              | —           | —        |       |
| 5   | Ask Gemini               | —           | —        | New   |
| 6   | Create an audio overview | —           | —        | New   |
| 7   | Share                    | yes ▸       | —        |       |
| 8   | Organize                 | yes ▸       | —        |       |
| 9   | File information         | yes ▸       | —        |       |
| 10  | Move to trash            | —           | —        |       |

---

## Sidebar "My Drive" right-click context menu

**Trigger:** Right-click on "My Drive" in the left sidebar.

**Source:** `pass3/drive/menus/sidebar-item-context.{html,json,png}` (captured 2026-06-08)

| #   | Label              | Has submenu | Notes                          |
| --- | ------------------ | ----------- | ------------------------------ |
| 1   | New folder         | —           | Alt+C then F                   |
| 2   | File upload        | —           | Alt+C then U                   |
| 3   | Folder upload      | —           | Alt+C then I                   |
| 4   | Suggest file moves | —           | AI-powered organize suggestion |
| 5   | New project        | —           |                                |
| 6   | Google Docs        | yes ▸       |                                |
| 7   | Google Sheets      | yes ▸       |                                |
| 8   | Google Slides      | yes ▸       |                                |
| 9   | Google Vids        | —           |                                |
| 10  | Google Forms       | yes ▸       |                                |
| 11  | More               | yes ▸       |                                |

---

## Sort menu

**Trigger:** Click the `Sort` button in the toolbar (`aria-label="Sort"`).

**Source:** `pass3/drive/menus/sort-menu.{html,json,png}` (14 items captured 2026-06-08)

The sort menu has three sections: Sort by, Sort direction, Folders.

**Sort by:**

| Option              | Notes |
| ------------------- | ----- |
| Name                |       |
| Date modified       |       |
| Date modified by me |       |
| Date opened by me   |       |

**Sort direction:**

| Option |
| ------ |
| A to Z |
| Z to A |

**Folders:**

| Option           | Notes                     |
| ---------------- | ------------------------- |
| On top           | Folders shown above files |
| Mixed with files |                           |

---

## Settings (cog) menu

**Trigger:** Click `aria-label="Settings"` button (top-right toolbar).

**Source:** `pass3/drive/menus/settings.{html,json,png}` (4 items captured 2026-06-08)

| #   | Label                 | Has submenu | Notes                                                       |
| --- | --------------------- | ----------- | ----------------------------------------------------------- |
| 1   | Settings              | —           | Opens Settings dialog (General, Notifications, Manage Apps) |
| 2   | Restore file versions | —           | Bulk version restore tool                                   |
| 3   | Admin console         | —           | Link to admin.google.com (admins only)                      |
| 4   | Keyboard shortcuts    | —           | Shows keyboard shortcuts overlay                            |

---

## Apps switcher (9-dot waffle)

**Trigger:** Click the 9-dot grid icon `aria-label="Google apps"` (top-right).

Shows a grid of Google products. Context-dependent based on Workspace plan.

---

## Account / profile menu

**Trigger:** Click the account avatar (top-right, `aria-label^="Google Account:"`).

Opens a Google account chooser / profile card overlay:

| Section                    | Content                                                |
| -------------------------- | ------------------------------------------------------ |
| Account header             | Name, email, avatar, "Manage your Google Account" link |
| Account tiles              | All signed-in accounts (can switch)                    |
| Sign in to another account | Link                                                   |
| Sign out                   | Link                                                   |

---

## Help & Support menu

**Trigger:** Click `aria-label="Help & Support"` link in left nav.

| #   | Label                   | Notes                               |
| --- | ----------------------- | ----------------------------------- |
| 1   | Help & Support          | Opens Help Center in new tab        |
| 2   | Training                | Google Workspace training resources |
| 3   | Terms and Policy        | Legal docs                          |
| 4   | Send feedback to Google | Feedback form                       |
