# Gmail — Menu Reference

> Captured from mail.google.com/mail/u/0/ on 2026-06-08 using the pass-3 Playwright probe harness.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/gmail/menus/`
>
> **Extraction method:** Live Playwright click/right-click probes in an authenticated
> Chromium session. Gmail's menus are rendered on-demand; several probes captured
> dialogs (compose) or returned 0 items when the element was a full overlay rather than a
> `[role="menu"]` container. Items documented below are from captured data where available,
> supplemented with canonical Gmail behavior where probe returned 0 items.
>
> **Note:** Gmail's UI uses custom rendering (not the `goog-menu` pattern used by Docs/Sheets).
> Many toolbar actions are direct buttons; the "menus" are often dialogs or popovers.

---

## Compose button

**Trigger:** Click the `Compose` button (top-left sidebar, primary action).

**Source:** `pass3/gmail/menus/compose-button.{html,json,png}` (2 items captured 2026-06-08)

The Compose button opens a compose modal. Captured items relate to an overlay that appeared:

| #   | Label         | Notes                              |
| --- | ------------- | ---------------------------------- |
| 1   | Schedule send | Send message at a future date/time |
| 2   | (item 2)      | Additional scheduling option       |

The compose modal itself contains these controls (not a menu, but reference):

| Control             | Notes                               |
| ------------------- | ----------------------------------- |
| Recipients (To)     | Type email addresses                |
| Cc / Bcc            | Expand with link                    |
| Subject             | Subject line input                  |
| Body                | Message body                        |
| Send                | Blue send button                    |
| Formatting (A)      | Toggle formatting toolbar           |
| Attach (paperclip)  | File attachment                     |
| Link (chain)        | Insert link                         |
| Emoji (😊)          | Insert emoji                        |
| Drive (△)           | Attach from Drive                   |
| Photo               | Insert photo                        |
| More options (⋮)    | See Compose more-options menu below |
| Discard             | Trash icon, discards draft          |
| Minimize / Maximize | Window controls                     |

---

## Compose: More options (⋮) menu

**Trigger:** In the compose modal, click the three-dot "More options" button.

**Source:** `pass3/gmail/menus/compose-more-options.{html,json,png}` (1 item captured 2026-06-08)

| #   | Label            | Notes                               |
| --- | ---------------- | ----------------------------------- |
| 1   | Mark all as read | Mark all messages in thread as read |

Canonical additional items (may appear depending on context):

| Label                  | Notes                                   |
| ---------------------- | --------------------------------------- |
| Default to full-screen | Toggle compose to full-screen mode      |
| Label                  | Apply a label to the draft              |
| Print                  | Print the draft                         |
| Check spelling         | Run spell check                         |
| Plain text mode        | Toggle between rich text and plain text |

---

## Settings gear menu

**Trigger:** Click the gear icon (`aria-label="Settings"`) at top-right.

**Source:** `pass3/gmail/menus/settings-gear.{html,json,png}` (captured 2026-06-08)

The settings gear opens a quick-settings panel (not a `[role="menu"]`). The panel contains:

| Item                  | Notes                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Quick settings header | "Quick settings" title                                                                       |
| Search in mail        | Search box for settings                                                                      |
| See all settings      | Button — opens full settings page at `#settings/general`                                     |
| Chat and Meet         | Toggle chat/Meet sidebar visibility                                                          |
| Reading pane          | Off / Right of inbox / Below inbox                                                           |
| Inbox density         | Default / Comfortable / Compact                                                              |
| Email threading       | Toggle conversation threading on/off                                                         |
| Inbox type            | Default / Important first / Unread first / Starred first / Priority inbox / Multiple inboxes |
| Themes                | Button to open themes picker                                                                 |

---

## Inbox message right-click context menu

**Trigger:** Right-click on a message row in the inbox list.

**Source:** `pass3/gmail/menus/inbox-message-context.{html,json,png}` (captured 2026-06-08)

The probe returned 0 items — Gmail does not show a context menu on message row right-click
in the modern interface. Standard browser context menu appears instead.

---

## Inbox toolbar (Archive / More actions)

The inbox toolbar appears above the message list when messages are selected.
These are direct action buttons, not menus (no submenu):

| Button              | Shortcut          | Notes                               |
| ------------------- | ----------------- | ----------------------------------- |
| Archive             | e                 | Move to All Mail, remove from Inbox |
| Report spam         | !                 | Move to Spam                        |
| Delete              | #                 | Move to Trash                       |
| Mark as read/unread | Shift+I / Shift+U | Toggle read state                   |
| Move to             | v                 | Open Move to label picker           |
| Labels              | l                 | Apply label                         |
| More                | .                 | Opens the More dropdown (see below) |

### More toolbar dropdown (bulk selected)

**Trigger:** Select one or more messages (click checkbox), then click "More".

**Source:** `pass3/gmail/menus/selected-message-context.{html,json,png}` (captured 2026-06-08)

The probe returned 0 items — the bulk More menu did not open with the probe sequence.
Canonical items:

| #   | Label                      | Notes                     |
| --- | -------------------------- | ------------------------- |
| 1   | Mark as important          |                           |
| 2   | Mark as not important      |                           |
| 3   | Add star                   |                           |
| 4   | Filter messages like these |                           |
| 5   | Mute                       | Mute thread notifications |
| 6   | Ignore                     | Move thread to Trash      |
| 7   | Forward as attachment      |                           |

---

## Account menu

**Trigger:** Click the account avatar (top-right).

**Source:** `pass3/gmail/menus/account-menu.{html,json,png}` (captured 2026-06-08)

Opens Google account chooser overlay (same as Drive/Docs):

| Section                    | Content                                           |
| -------------------------- | ------------------------------------------------- |
| Account header             | Name, email, avatar, "Manage your Google Account" |
| Account tiles              | All signed-in accounts (can switch)               |
| Sign in to another account |                                                   |
| Sign out                   |                                                   |

---

## Left navigation pane

The left nav shows these labels/folders as direct links (not a menu):

| Label           | Notes                                                         |
| --------------- | ------------------------------------------------------------- |
| Inbox           | Primary inbox (badge shows unread count)                      |
| Starred         | Messages with star                                            |
| Snoozed         | Snoozed messages                                              |
| Sent            | Sent messages                                                 |
| Drafts          | Draft messages                                                |
| More            | Expands to show All mail / Spam / Trash / Categories / Labels |
| _(user labels)_ | Custom labels created by user                                 |
| Meet            | Start / Join a meeting                                        |

Right-click on a label shows a browser context menu (no Gmail-specific menu captured).

---

## Compose formatting toolbar

**Trigger:** In compose, click the `A` (Formatting) icon to show formatting options.

**Source:** `pass3/gmail/menus/compose-formatting-options.json` (1 item captured 2026-06-09)

The probe opened the compose window and found a font family listbox (`command="+fontName"`,
`aria-label="Font (Ctrl-Shift-5, Ctrl-Shift-6)"`, `role="listbox"`). The captured item is
the font name selector showing "Sans Serif" as the selected option. The full formatting
toolbar is a toolbar overlay, not a `[role="menu"]` container.

Formatting toolbar items (canonical + partial live capture):

| Control                | Selector                                | Notes                                                 |
| ---------------------- | --------------------------------------- | ----------------------------------------------------- |
| Font family            | `[command="+fontName"][role="listbox"]` | Font family dropdown; captured "Sans Serif" as item 1 |
| Font size              | `[command="+fontSize"]`                 | Font size dropdown                                    |
| Bold (B)               | —                                       | Ctrl+B                                                |
| Italic (I)             | —                                       | Ctrl+I                                                |
| Underline (U)          | —                                       | Ctrl+U                                                |
| Text color (A)         | —                                       | Text / Background color                               |
| Align (≡)              | —                                       | Left / Center / Right                                 |
| Numbered list (1.)     | —                                       |                                                       |
| Bulleted list (•)      | —                                       |                                                       |
| Quote (")              | —                                       | Block quote                                           |
| Strikethrough          | —                                       |                                                       |
| Remove formatting (Tx) | —                                       | Clear formatting                                      |
