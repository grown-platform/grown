# Google Workspace UI Reference — Menu Structures

> This reference documents every menu in Google Drive, Docs, Sheets, and Gmail as
> a structured catalog for use when implementing matching menus in grown-workspace
> editor apps. It is intended as a design spec, not a legal copy of any Google code.
> Menu item labels, keyboard shortcuts, and structural layout are functional/factual
> information, not copyrighted expression.

## Capture methodology

The data in this reference was extracted from authenticated browser captures made
on **2026-06-08** using the Playwright harness at
`grown-workspace/research/gworkspace-frontend/playwright/menus.mjs`.

Each target page was navigated with a persistent authenticated profile (throwaway
Google account). Menus were captured by actually clicking/right-clicking triggers
in a live Chromium session. Settings pages were walked tab by tab, with interactive
elements extracted from the rendered DOM.

**Pass-3 capture artifacts** (gitignored, local only):
`grown-workspace/research/gworkspace-frontend/pass3/<target>/menus/`
`grown-workspace/research/gworkspace-frontend/pass3/<target>/settings/`

## Coverage

### Menu docs

| File                | Content                                                                                                                                                    | Method                                 | Menu count                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| `drive.md`          | Drive New, row context, empty-area context, sidebar context, sort, settings menus                                                                          | Live probe (pass-3)                    | 20 captures                                        |
| `docs/landing.md`   | Docs landing page menus                                                                                                                                    | Live probe (pass-3)                    | 4 captures                                         |
| `docs/editor.md`    | Docs editor menubar (File–Help) + body/selection context menus                                                                                             | Live probe (pass-3)                    | 40 captures                                        |
| `sheets/landing.md` | Sheets landing page menus                                                                                                                                  | Live probe (pass-3)                    | 4 captures                                         |
| `sheets/editor.md`  | Sheets editor menubar (File–Help + Data) + toolbar                                                                                                         | Live probe (pass-3)                    | 47 captures                                        |
| `slides/landing.md` | Slides landing page menus                                                                                                                                  | Live probe (pass-3)                    | 4 captures                                         |
| `slides/editor.md`  | Slides editor menubar (File–Help + Slide + Arrange) + canvas/filmstrip context menus                                                                       | Live probe (pass-3)                    | 44 captures (slides_editor) + 47 (slides_existing) |
| `forms/landing.md`  | Forms landing page menus                                                                                                                                   | Live probe (pass-3)                    | 4 captures                                         |
| `forms/editor.md`   | Forms editor header overflow + responses overflow + question type picker + structural docs                                                                 | Live probe (pass-3)                    | 5 captures                                         |
| `gmail.md`          | Gmail compose, settings gear, inbox context menus                                                                                                          | Live probe (pass-3)                    | 6 captures                                         |
| `calendar.md`       | Calendar Create, Settings, View, time slot dialog, sidebar calendar options                                                                                | Live probe (pass-3)                    | 5 captures                                         |
| `meet.md`           | Meet landing: New meeting, Support, Settings, Feedback, apps switcher, account                                                                             | Live probe (pass-3)                    | 6 captures                                         |
| `books.md`          | Play Books library (book tile menu), Store detail (account menu, review more), Reader toolbar (Display settings, TOC, search, more-menu, help-feedback)    | Live probe (pass-3)                    | 7 captures across 3 surfaces                       |
| `photos.md`         | Photos create-menu (12 items), settings navigation, account/apps-switcher overlays; photo-tile probes skipped (empty account)                              | Live probe (pass-3)                    | 1 menu captured; 4 structural                      |
| `keep.md`           | Keep settings gear (6 items), note-more-menu (7), note-color-picker (12 colors), note-edit-more (7), note-edit-reminder (4 + submenu)                      | Live probe (pass-3)                    | 6 captures                                         |
| `contacts.md`       | Contacts create-button (2 items), settings menu (3), help menu (4); per-row/bulk/label probes skipped (empty account)                                      | Live probe (pass-3) + JS investigation | 3 menus documented                                 |
| `tasks.md`          | Tasks side panel (calendar.google.com embed): task-list-dropdown (2), list-options (7); per-task probes skipped (empty account)                            | Live probe (pass-3, tasksFrame)        | 2 captures                                         |
| `groups.md`         | Groups settings-cog (4 items), per-group-row-more (4, JS investigation); create-group navigates to form                                                    | Live probe (pass-3) + JS investigation | 2 menus documented                                 |
| `sites.md`          | Sites template gallery (6 templates captured as create-button); per-site, editor, sort probes skipped/miscaptured (empty account + pre-existing DOM menus) | Live probe (pass-3)                    | 1 capture; editor needs follow-up                  |

### Settings docs

| File                    | Content                                                                    | Method                        | Tabs captured                                          |
| ----------------------- | -------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------ |
| `settings/gmail.md`     | Gmail settings tabs (General–Themes)                                       | Live settings-walker (pass-3) | 10 / 10                                                |
| `settings/drive.md`     | Drive settings dialog tabs                                                 | Live settings-walker (pass-3) | 3 tabs attempted, dialog did not open — canonical docs |
| `settings/myaccount.md` | Google Account settings (personal-info, data, security, sharing, payments) | Live settings-walker (pass-3) | 5 / 5                                                  |

## How to read the tables

Each menu section has a trigger description and an item table:

| #   | Label | Shortcut | Has submenu | Disabled | Notes |
| --- | ----- | -------- | ----------- | -------- | ----- |
| 1   | Open  | Ctrl+O   | —           | —        |       |
| 2   | Share | —        | yes ▸       | —        |       |

- **Label**: the text shown in the menu. Keyboard mnemonics (underlined letters, `(F2)`
  shortcut keys) are stripped; the label shown is the plain display name.
- **Shortcut**: keyboard shortcut shown at the right edge of the menu item.
- **Has submenu**: `yes ▸` if hovering opens a submenu.
- **Disabled**: items marked disabled in the capture (e.g., no selection, no file open).
  In production all items apply; disabled state is context-dependent.
- Separator rows are shown as `---` in prose but omitted from the tables for brevity.

## Re-capture instructions

If the session is still valid:

```
cd grown-workspace/research/gworkspace-frontend/playwright
nix develop --command node menus.mjs <target>
nix develop --command node menus.mjs settings <settings-target>
```

If the session is expired (`STATUS: NEEDS_CONTEXT`):

```
nix develop --command node capture.mjs auth
# sign in, then:
nix develop --command node menus.mjs all
nix develop --command node menus.mjs settings all
```

Valid menu targets: `drive`, `docs_landing`, `docs_editor`, `docs_existing`,
`sheets_landing`, `sheets_editor`, `sheets_existing`,
`slides_landing`, `slides_editor`, `slides_existing`,
`forms_landing`, `forms_editor`, `forms_existing`,
`gmail`, `calendar`, `meet`,
`contacts`, `tasks`, `groups`, `sites`

Valid settings targets: `gmail_settings`, `myaccount_personal`, `myaccount_data`,
`myaccount_security`, `myaccount_sharing`, `myaccount_payments`, `drive_settings`

Artifacts land in `pass3/<target>/menus/` or `pass3/<target>/settings/` (gitignored).
