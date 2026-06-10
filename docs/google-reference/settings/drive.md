# Drive Settings — Dialog Reference

> Captured from drive.google.com on 2026-06-09 using the pass-3 Playwright settings-walker.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/drive_settings/settings/`
>
> **Extraction method:** Navigate to Drive, press Escape to dismiss any open viewer, click
> `header [aria-label="Settings"]` to open the gear dropdown, click "Settings" menu item,
> wait for the settings panel to render, then click each nav option (role="option") in turn
> and capture the interactive elements.
>
> **Capture status (2026-06-09):** Live captured — settings panel opened successfully.
> General: 37 elements, Notifications: 20 elements, Manage apps: 50 elements.

---

## How to open Drive Settings

1. Click the gear icon in Drive (`header [aria-label="Settings"]` or `aria-label="Settings"`)
2. Click "Settings" from the dropdown menu (item 1 of 4 — others: Restore file versions, Admin console, Keyboard shortcuts)
3. The Settings panel opens on the right side (role="option" navigation on the left)

The settings use role="option" for sidebar navigation (not role="tab").

---

## General tab

**Trigger:** Settings → General (role="option", default active)

**Source:** `pass3/drive_settings/settings/general.json` (37 elements, 2026-06-09)

### Start location

| Setting  | Type  | State at capture |
| -------- | ----- | ---------------- |
| Home     | radio | checked=True     |
| My Drive | radio | checked=False    |

### Workspaces

| Setting         | Type     | State at capture |
| --------------- | -------- | ---------------- |
| Show workspaces | checkbox | checked=True     |

### Appearance

| Setting        | Type  | State at capture |
| -------------- | ----- | ---------------- |
| Light          | radio | checked=True     |
| Dark           | radio | checked=False    |
| Device default | radio | checked=False    |

### Density

| Setting     | Type  | State at capture |
| ----------- | ----- | ---------------- |
| Comfortable | radio | checked=True     |
| Cozy        | radio | checked=False    |
| Compact     | radio | checked=False    |

### File preview behavior

| Setting | Type  | State at capture |
| ------- | ----- | ---------------- |
| New tab | radio | checked=False    |
| Preview | radio | checked=True     |

### Upload conversion

| Setting                                                                                              | Type     | State at capture |
| ---------------------------------------------------------------------------------------------------- | -------- | ---------------- |
| Convert uploads to Google Docs editor format                                                         | checkbox | checked=False    |
| Create, open and edit your recent Google Docs, Sheets, and Slides files even without internet access | checkbox | checked=False    |

### Other settings

| Setting                                                  | Type     | State at capture |
| -------------------------------------------------------- | -------- | ---------------- |
| Show details card when hovering on a file or folder icon | checkbox | checked=True     |
| Allow sounds for first-letters navigation actions        | checkbox | checked=True     |
| Show suggested recipients in the sharing dialog          | checkbox | checked=True     |

### Links

- "Learn more" (context: offline access)
- "Change language settings" (links to Google Account language settings)

---

## Notifications tab

**Trigger:** Settings → Notifications (role="option")

**Source:** `pass3/drive_settings/settings/notifications.json` (20 elements, 2026-06-09)

| Setting                                                                     | Type     | State at capture |
| --------------------------------------------------------------------------- | -------- | ---------------- |
| Get updates about Google Drive items in your browser                        | checkbox | checked=False    |
| Get all updates about Google Drive items via email                          | checkbox | checked=True     |
| Get summaries about recent files shared with you via the Drive Digest email | checkbox | checked=True     |

---

## Manage apps tab

**Trigger:** Settings → Manage apps (role="option")

**Source:** `pass3/drive_settings/settings/manage-apps.json` (50 elements, 2026-06-09)

Shows all connected Google Workspace apps. Each app has:

- An "Options" button (role="button")
- A "Use [App] by default" checkbox (role="checkbox")

Apps listed at capture time (all checked=true, set as default openers):

| App                 | Default?                             |
| ------------------- | ------------------------------------ |
| AppSheet            | Use AppSheet by default ✓            |
| Email Layouts       | Use Email Layouts by default ✓       |
| Gemini (×2)         | Use Gemini by default ✓              |
| Google Apps Script  | Use Google Apps Script by default ✓  |
| Google Colaboratory | Use Google Colaboratory by default ✓ |
| Google Docs         | Use Google Docs by default ✓         |
| Google Drawings     | Use Google Drawings by default ✓     |
| Google Earth        | Use Google Earth by default ✓        |
| Google Forms        | Use Google Forms by default ✓        |
| Google My Maps      | Use Google My Maps by default ✓      |
| Google Sheets       | Use Google Sheets by default ✓       |
| Google Sites        | Use Google Sites by default ✓        |
| Google Slides       | Use Google Slides by default ✓       |
| Google Vids         | Use Google Vids by default ✓         |
| Opal                | Use Opal by default ✓                |

Action at top: "Connect more apps" button (role="button")

---

## Privacy tab

The settings panel includes a "Privacy" option (role="option") in the nav, which was not
captured in this probe (the walker only walks tabs defined in the config: General,
Notifications, Manage apps). Add Privacy to the SETTINGS_TARGETS if needed.
