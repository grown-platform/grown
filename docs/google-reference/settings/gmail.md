# Gmail Settings — Tab Reference

> Captured from mail.google.com/mail/u/0/#settings/<tab> on 2026-06-08
> using the pass-3 Playwright settings-walker harness.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/gmail_settings/settings/`
>
> **Extraction method:** Navigated to each settings tab URL fragment, waited for render,
> then extracted all interactive elements (inputs, selects, buttons, links, checkboxes)
> from `[role="main"]`. The JSON inventory counts are element counts, not settings counts.
>
> Settings are accessed via: Settings gear → See all settings → tab.

---

## Tab navigation

Gmail settings uses hash-fragment navigation. Tabs (in order):

| Tab                           | Fragment               | Element count |
| ----------------------------- | ---------------------- | ------------- |
| General                       | `#settings/general`    | 19            |
| Labels                        | `#settings/labels`     | 11            |
| Inbox                         | `#settings/inbox`      | 4             |
| Accounts                      | `#settings/accounts`   | 2             |
| Filters and blocked addresses | `#settings/filters`    | 4             |
| Forwarding and POP/IMAP       | `#settings/forwarding` | 19            |
| Chat and Meet                 | `#settings/chat`       | 3             |
| Advanced                      | `#settings/advanced`   | 11            |
| Add-ons                       | `#settings/addons`     | 3             |
| Themes                        | `#settings/themes`     | 101           |

**Source:** `pass3/gmail_settings/settings/_summary.json` (all 10 tabs: 10 ok, 0 errors)

---

## General tab

**Source:** `pass3/gmail_settings/settings/general.{html,json,png}`

Key settings on the General tab (in order of appearance):

| Setting            | Type           | Notes                                                                                                                                                                                                                                                                                                                       |
| ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language           | select         | Gmail display language. Options: Afrikaans, Azərbaycanca, Bahasa Indonesia, Bahasa Melayu, Català, Čeština, Cymraeg, Dansk, Deutsch, English (US), Español, Français, Italiano, 日本語, 한국어, Nederlands, Norsk, Polski, Português, Română, Русский, Svenska, Türkçe, Українська, 中文（简体）, 中文（繁體）, + many more |
| Max page size      | select         | Conversations per page: 5 / 10 / 20 / 30                                                                                                                                                                                                                                                                                    |
| Smart Compose      | links/checkbox | Smart Compose suggestions; Feedback link                                                                                                                                                                                                                                                                                    |
| Keyboard shortcuts | checkbox       | Enable keyboard shortcuts                                                                                                                                                                                                                                                                                                   |
| Save Changes       | button         | Commit changes                                                                                                                                                                                                                                                                                                              |
| Cancel             | button         | Discard changes                                                                                                                                                                                                                                                                                                             |

---

## Labels tab

**Source:** `pass3/gmail_settings/settings/labels.{html,json,png}`

| Control          | Notes                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Checkboxes (10)  | Show/hide system labels: Inbox, Starred, Snoozed, Sent, Drafts, All Mail, Spam, Trash, Categories, etc. |
| Create new label | Button — opens label creation dialog                                                                    |

---

## Inbox tab

**Source:** `pass3/gmail_settings/settings/inbox.{html,json,png}`

| Setting      | Type   | Options                                                                                      |
| ------------ | ------ | -------------------------------------------------------------------------------------------- |
| Inbox type   | select | Default / Important first / Unread first / Starred first / Priority Inbox / Multiple Inboxes |
| Save Changes | button |                                                                                              |
| Cancel       | button |                                                                                              |

---

## Accounts and Import tab

**Source:** `pass3/gmail_settings/settings/accounts.{html,json,png}`

| Setting                 | Notes                       |
| ----------------------- | --------------------------- |
| Google Account settings | Link → myaccount.google.com |
| Learn more              | Help documentation link     |

The accounts tab delegates most configuration to Google Account settings.

---

## Filters and Blocked Addresses tab

**Source:** `pass3/gmail_settings/settings/filters.{html,json,png}`

| Control                    | Notes                                  |
| -------------------------- | -------------------------------------- |
| Export                     | Export filters as XML                  |
| Delete                     | Delete selected filters                |
| Checkbox                   | Select all / select individual filters |
| Unblock selected addresses | Remove addresses from blocklist        |

The main content is a list of existing filters and blocked senders (empty at capture time).

---

## Forwarding and POP/IMAP tab

**Source:** `pass3/gmail_settings/settings/forwarding.{html,json,png}`

| Setting                         | Type     | Notes                                 |
| ------------------------------- | -------- | ------------------------------------- |
| Language (carry-over)           | select   | Same language selector as General tab |
| Page size (carry-over)          | select   |                                       |
| Smart Compose feedback          | link     |                                       |
| Keyboard shortcuts (carry-over) | checkbox |                                       |
| (Multiple learn-more links)     | links    | For forwarding, POP, IMAP settings    |
| Save Changes                    | button   |                                       |
| Cancel                          | button   |                                       |

Note: The forwarding tab HTML appears to have included the General tab content due to
navigation timing. The HTML source at `forwarding.html` contains full settings page content.

---

## Chat and Meet tab

**Source:** `pass3/gmail_settings/settings/chat.{html,json,png}`

| Control              | Notes                               |
| -------------------- | ----------------------------------- |
| Manage chat settings | Button — opens Google Chat settings |
| Save Changes         | button                              |
| Cancel               | button                              |

---

## Advanced tab

**Source:** `pass3/gmail_settings/settings/advanced.{html,json,png}`

| Setting                | Type   | Notes                                                                                     |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------- |
| (7 radio buttons)      | radio  | Advanced features: Templates, Auto-advance, Custom keyboard shortcuts, Preview pane, etc. |
| (1 learn-more link)    | link   |                                                                                           |
| (2 more radio buttons) | radio  | Additional advanced options                                                               |
| Save Changes           | button |                                                                                           |
| Cancel                 | button |                                                                                           |

Advanced features controlled by radio buttons (enable/disable):

- **Templates** (Canned Responses) — Save/reuse common replies
- **Auto-advance** — Move to next conversation after archive/delete
- **Custom keyboard shortcuts** — Remap keyboard shortcuts
- **Preview pane** — Enable preview pane for message reading
- **Right-side chat** — Move chat to right side of screen

---

## Add-ons tab

**Source:** `pass3/gmail_settings/settings/addons.{html,json,png}`

| Control                   | Notes                                  |
| ------------------------- | -------------------------------------- |
| Manage                    | Button — opens add-ons management page |
| install developer add-ons | Link — Google Workspace Marketplace    |
| Apps Script               | Link — Apps Script editor              |

The tab shows installed Gmail add-ons (empty at capture time).

---

## Themes tab

**Source:** `pass3/gmail_settings/settings/themes.{html,json,png}`

| Control                  | Notes                                                |
| ------------------------ | ---------------------------------------------------- |
| Close banner             | Button — dismiss promotional banner                  |
| Theme checkboxes (50)    | Select a theme image (light, dark, landscapes, etc.) |
| Not starred toggles (50) | Star/unstar individual theme options                 |

The themes tab shows a grid of ~50 theme thumbnails. Each can be selected to change the
Gmail background.
