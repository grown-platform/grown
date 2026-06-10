# Google Docs Editor — Menu Reference

> Captured from docs.google.com/document/create on 2026-06-08.
> Existing-doc capture: `/document/d/1eI-EvN8K_mOetxawzgyxGIyqSSys_EUj/edit`
> Live probe artifacts: `grown-workspace/research/gworkspace-frontend/pass3/docs_editor/menus/`
>
> **Extraction method:** Live Playwright click/right-click probes (pass-3 harness) against
> an authenticated Chromium session. All menubar items and context menus captured by
> actually opening them on 2026-06-08.
>
> **Disabled items** reflect state at capture time (blank new doc, nothing selected,
> no pending changes). In normal editing all non-grayed items apply.

---

## Menubar structure

The menubar (`id="docs-menubar"`, `role="menubar"`) contains these items in order:

`File` | `Edit` | `View` | `Insert` | `Format` | `Tools` | `Gemini` | `Extensions` | `Help`
(`Accessibility` is hidden unless screen reader is active; `Debug` is developer-only.)

---

## File menu

**Trigger:** Click `id="docs-file-menu"` in menubar (`role="menuitem"`, `aria-haspopup="true"`).

| #   | Label                  | Shortcut | Has submenu | Disabled | Notes                                                      |
| --- | ---------------------- | -------- | ----------- | -------- | ---------------------------------------------------------- |
| 1   | New                    | —        | yes ▸       | —        | New Document / Spreadsheet / Presentation / Form / Drawing |
| 2   | Open                   | Ctrl+O   | —           | —        | Opens Drive file picker                                    |
| 3   | Make a copy            | —        | —           | —        | Duplicates to Drive                                        |
| —   | _separator_            |          |             |          |                                                            |
| 4   | Share                  | —        | yes ▸       | —        | Share dialog / Publish to web / Email as attachment        |
| 5   | Email                  | —        | yes ▸       | —        | Email as attachment / Email collaborators                  |
| 6   | Download               | —        | yes ▸       | —        | See Download submenu below                                 |
| 7   | Approvals              | —        | —           | yes      | Workflow approval requests (Workspace Business+)           |
| —   | _separator_            |          |             |          |                                                            |
| 8   | Rename                 | —        | —           | —        | Renames the document                                       |
| 9   | Move to trash          | —        | —           | yes      | Disabled on blank unsaved doc                              |
| —   | _separator_            |          |             |          |                                                            |
| 10  | Version history        | —        | yes ▸       | yes      | See/restore past versions; disabled on brand-new doc       |
| 11  | Make available offline | —        | —           | —        | Pins doc for offline access                                |
| —   | _separator_            |          |             |          |                                                            |
| 12  | Details                | —        | —           | yes      | Word count, created date, file size                        |
| 13  | Security limitations   | —        | —           | yes      | Information-rights management status                       |
| 14  | Language               | —        | yes ▸       | —        | See Language submenu below                                 |
| 15  | Page setup             | —        | —           | —        | Paper size, orientation, margins, page color               |
| 16  | Print                  | Ctrl+P   | —           | —        | Opens print dialog                                         |

### New → submenu

| #   | Label                 | Notes                                   |
| --- | --------------------- | --------------------------------------- |
| 1   | Document              | New blank Google Doc (opens in new tab) |
| 2   | Spreadsheet           | New blank Google Sheet                  |
| 3   | Presentation          | New blank Google Slides                 |
| 4   | Form                  | New blank Google Form                   |
| 5   | Drawing               | New Google Drawing                      |
| 6   | From template gallery | Opens Docs template gallery             |

### Share → submenu

| #   | Label               | Notes                                               |
| --- | ------------------- | --------------------------------------------------- |
| 1   | Share               | Opens the Share dialog (collaborators, link access) |
| 2   | Publish to web      | Publish as a public web page or embed               |
| 3   | Email as attachment | Send via Gmail as PDF, Word, etc.                   |

### Email → submenu

| #   | Label               | Notes                           |
| --- | ------------------- | ------------------------------- |
| 1   | Email as attachment | Send to self or others          |
| 2   | Email collaborators | Compose to everyone with access |

### Download → submenu

| #   | Label                      | Notes |
| --- | -------------------------- | ----- |
| 1   | Microsoft Word (.docx)     |       |
| 2   | OpenDocument Format (.odt) |       |
| 3   | Rich Text Format (.rtf)    |       |
| 4   | PDF Document (.pdf)        |       |
| 5   | Plain Text (.txt)          |       |
| 6   | Web Page (.html, zipped)   |       |
| 7   | EPUB Publication (.epub)   |       |
| 8   | Markdown (.md)             |       |

### Version history → submenu

| #   | Label                | Shortcut         | Notes                         |
| --- | -------------------- | ---------------- | ----------------------------- |
| 1   | Name current version | —                |                               |
| 2   | See version history  | Ctrl+Alt+Shift+H | Opens version history sidebar |

### Language → submenu

Opens a scrollable list of ~80 languages. The selected language affects the spell-checker
and hyphenation rules. Languages include (non-exhaustive):
`Afrikaans`, `Català`, `Čeština`, `Dansk`, `Deutsch`, `English (United States)`,
`English (United Kingdom)`, `Español`, `Français`, `Italiano`, `日本語`, `한국어`,
`Nederlands`, `Norsk`, `Polski`, `Português`, `Română`, `Русский`, `Svenska`,
`Türkçe`, `中文（简体）`, `中文（繁體）`.

---

## Edit menu

**Trigger:** Click `id="docs-edit-menu"`.

| #   | Label                    | Shortcut     | Has submenu | Disabled | Notes                          |
| --- | ------------------------ | ------------ | ----------- | -------- | ------------------------------ |
| 1   | Undo                     | Ctrl+Z       | —           | —        |                                |
| 2   | Redo                     | Ctrl+Y       | —           | —        |                                |
| —   | _separator_              |              |             |          |                                |
| 3   | Cut                      | Ctrl+X       | —           | yes      | Disabled when nothing selected |
| 4   | Copy                     | Ctrl+C       | —           | yes      | Disabled when nothing selected |
| 5   | Paste                    | Ctrl+V       | —           | —        |                                |
| 6   | Paste without formatting | Ctrl+Shift+V | —           | —        |                                |
| —   | _separator_              |              |             |          |                                |
| 7   | Select all               | Ctrl+A       | —           | —        |                                |
| 8   | Delete                   | —            | —           | yes      | Disabled when nothing selected |
| —   | _separator_              |              |             |          |                                |
| 9   | Find and replace         | Ctrl+H       | —           | —        | Opens Find and Replace dialog  |

---

## View menu

**Trigger:** Click `id="docs-view-menu"`.

| #   | Label                            | Shortcut               | Has submenu | Notes                                           |
| --- | -------------------------------- | ---------------------- | ----------- | ----------------------------------------------- |
| 1   | Mode                             | —                      | yes ▸       | Editing / Suggesting / Viewing                  |
| 2   | Comments                         | —                      | yes ▸       | Show / Hide comments panel                      |
| 3   | Collapse tabs & outlines sidebar | Ctrl+Alt+A, Ctrl+Alt+H | —           | Toggle label changes to "Expand" when collapsed |
| —   | _separator_                      |                        |             |                                                 |
| 4   | Show print layout                | —                      | —           | Toggle between print-layout and pageless view   |
| 5   | Show ruler                       | —                      | —           | Toggle the ruler above the document             |
| 6   | Show equation toolbar            | —                      | —           | Show/hide the math equation toolbar             |
| 7   | Show non-printing characters     | Ctrl+Shift+P           | —           | Show paragraph marks, spaces, tabs              |
| —   | _separator_                      |                        |             |                                                 |
| 8   | Full screen                      | —                      | —           | Browser full screen (F11 equivalent)            |

### Mode → submenu

| #   | Label      | Notes                                |
| --- | ---------- | ------------------------------------ |
| 1   | Editing    | Direct edit mode (default)           |
| 2   | Suggesting | All edits become tracked suggestions |
| 3   | Viewing    | Read-only mode (hides toolbar)       |

### Comments → submenu

| #   | Label                  | Notes                                |
| --- | ---------------------- | ------------------------------------ |
| 1   | Show comments          | Toggle comments sidebar              |
| 2   | Show suggested changes | Toggle suggestion markup in document |

---

## Insert menu

**Trigger:** Click `id="docs-insert-menu"`.

| #   | Label                 | Shortcut   | Has submenu | Disabled | Notes                                                                |
| --- | --------------------- | ---------- | ----------- | -------- | -------------------------------------------------------------------- |
| 1   | Image                 | —          | yes ▸       | —        | Upload from computer / URL / Google Photos / Drive / Camera / By URL |
| 2   | Table                 | —          | yes ▸       | —        | Insert grid picker (up to 20×20)                                     |
| 3   | Building blocks       | —          | yes ▸       | —        | Email draft, Meeting notes, Product roadmap, etc.                    |
| 4   | Smart chips           | —          | yes ▸       | —        | @-mention people, Dates, Files, Map, Finance, Places                 |
| 5   | Audio buttons New     | —          | yes ▸       | —        | Audio recording buttons (new feature)                                |
| 6   | eSignature fields     | —          | —           | —        | Insert signature request fields                                      |
| 7   | Link                  | Ctrl+K     | —           | —        | Insert hyperlink                                                     |
| 8   | Drawing               | —          | yes ▸       | —        | Create new / Insert from Drive                                       |
| 9   | Chart                 | —          | yes ▸       | —        | Bar / Column / Line / Pie / From Sheets                              |
| 10  | Symbols               | —          | yes ▸       | —        | Special characters / Emoji / Math                                    |
| —   | _separator_           |            |             |          |                                                                      |
| 11  | Tab                   | Shift+F11  | —           | —        | Insert a new document tab                                            |
| 12  | Horizontal line       | —          | —           | —        |                                                                      |
| 13  | Break                 | —          | yes ▸       | —        | Page break / Section break / Column break                            |
| 14  | Bookmark              | —          | —           | —        | Inserts a named anchor                                               |
| 15  | Page elements Updated | —          | yes ▸       | —        | Header, Footer, Page number, footnote, etc.                          |
| —   | _separator_           |            |             |          |                                                                      |
| 16  | Comment               | Ctrl+Alt+M | —           | yes      | Disabled when nothing selected                                       |

### Image → submenu

| #   | Label                | Notes                   |
| --- | -------------------- | ----------------------- |
| 1   | Upload from computer | OS file picker          |
| 2   | Search the web       | Google Image Search     |
| 3   | Drive                | Pick from Google Drive  |
| 4   | Photos               | Pick from Google Photos |
| 5   | By URL               | Paste image URL         |
| 6   | Camera               | Use webcam              |

### Building blocks → submenu

| #   | Label                  | Notes |
| --- | ---------------------- | ----- |
| 1   | Email draft            |       |
| 2   | Email reply draft      |       |
| 3   | Meeting notes          |       |
| 4   | Video call notes       |       |
| 5   | Product launch         |       |
| 6   | Review tracker         |       |
| 7   | Project assets         |       |
| 8   | Launch content tracker |       |
| 9   | Content calendar       |       |

### Smart chips → submenu

| #   | Label       | Notes                                                      |
| --- | ----------- | ---------------------------------------------------------- |
| 1   | People      | @mention — creates a person chip linked to Google Contacts |
| 2   | Meeting     | Calendar event chip                                        |
| 3   | Date        | Date chip (shows formatted date)                           |
| 4   | Place       | Maps location chip                                         |
| 5   | Finance     | Stock ticker chip                                          |
| 6   | File        | Links to a Drive file inline                               |
| 7   | From Sheets | Pull data from a spreadsheet                               |
| 8   | Variable    | Reusable variable across doc                               |
| 9   | Dropdown    | Inline dropdown selector                                   |

### Break → submenu

| #   | Label                      | Notes      |
| --- | -------------------------- | ---------- |
| 1   | Page break                 | Ctrl+Enter |
| 2   | Section break (next page)  |            |
| 3   | Section break (continuous) |            |
| 4   | Column break               |            |

### Chart → submenu

| #   | Label       | Notes                                 |
| --- | ----------- | ------------------------------------- |
| 1   | Bar         |                                       |
| 2   | Column      |                                       |
| 3   | Line        |                                       |
| 4   | Pie         |                                       |
| 5   | From Sheets | Links a live chart from a spreadsheet |

---

## Format menu

**Trigger:** Click `id="docs-format-menu"`.

| #   | Label                     | Shortcut | Has submenu | Disabled | Notes                                                       |
| --- | ------------------------- | -------- | ----------- | -------- | ----------------------------------------------------------- |
| —   | _separator_               |          |             |          | Left-to-right / Right-to-left are toggled items above this  |
| 1   | Text                      | —        | yes ▸       | —        | Bold, Italic, Underline, Strikethrough, Superscript, etc.   |
| 2   | Paragraph styles          | —        | yes ▸       | —        | Normal text / Heading 1–6 / Title / Subtitle                |
| 3   | Align & indent            | —        | yes ▸       | —        | Left, Center, Right, Justified; Indentation controls        |
| 4   | Line & paragraph spacing  | —        | yes ▸       | —        | Single, 1.15, 1.5, Double; paragraph spacing                |
| 5   | Columns                   | —        | yes ▸       | —        | 1, 2, 3 columns; column options                             |
| 6   | Bullets & numbering       | —        | yes ▸       | —        | Bulleted list, Numbered list, Checklist                     |
| —   | _separator_               |          |             |          |                                                             |
| 7   | Headers & footers         | —        | —           | —        | Opens header/footer options dialog                          |
| 8   | Page numbers              | —        | —           | —        | Insert page numbers (position and format)                   |
| 9   | Page orientation          | —        | —           | —        | Portrait / Landscape                                        |
| 10  | Switch to Pageless format | —        | —           | —        | Toggle between paginated and pageless layout                |
| —   | _separator_               |          |             |          |                                                             |
| 11  | Table                     | —        | yes ▸       | yes      | Format table (disabled when cursor not in table)            |
| 12  | Image                     | —        | yes ▸       | yes      | Wrap text, Position, Size (disabled when no image selected) |
| 13  | Borders & lines           | —        | yes ▸       | yes      | Paragraph borders (disabled when not applicable)            |
| —   | _separator_               |          |             |          |                                                             |
| 14  | Clear formatting          | Ctrl+\   | —           | —        | Remove all formatting from selection                        |

### Text → submenu

| #   | Label                    | Shortcut     | Notes                                    |
| --- | ------------------------ | ------------ | ---------------------------------------- |
| 1   | Bold                     | Ctrl+B       |                                          |
| 2   | Italic                   | Ctrl+I       |                                          |
| 3   | Underline                | Ctrl+U       |                                          |
| 4   | Strikethrough            | Alt+Shift+5  |                                          |
| 5   | Superscript              | Ctrl+.       |                                          |
| 6   | Subscript                | Ctrl+,       |                                          |
| —   | _separator_              |              |                                          |
| 7   | Size: Increase font size | Ctrl+Shift+. |                                          |
| 8   | Size: Decrease font size | Ctrl+Shift+, |                                          |
| —   | _separator_              |              |                                          |
| 9   | Capitalization           | —            | UPPERCASE, lowercase, Title Case, Toggle |

### Paragraph styles → submenu

| #   | Label       | Shortcut   | Notes                      |
| --- | ----------- | ---------- | -------------------------- |
| 1   | Normal text | Ctrl+Alt+0 | Removes heading formatting |
| 2   | Title       | —          | Document title style       |
| 3   | Subtitle    | —          | Document subtitle style    |
| 4   | Heading 1   | Ctrl+Alt+1 |                            |
| 5   | Heading 2   | Ctrl+Alt+2 |                            |
| 6   | Heading 3   | Ctrl+Alt+3 |                            |
| 7   | Heading 4   | Ctrl+Alt+4 |                            |
| 8   | Heading 5   | Ctrl+Alt+5 |                            |
| 9   | Heading 6   | Ctrl+Alt+6 |                            |
| —   | _separator_ |            |                            |
| 10  | Options     | —          | Save/use as default styles |

### Align & indent → submenu

| #   | Label               | Shortcut     | Notes                             |
| --- | ------------------- | ------------ | --------------------------------- |
| 1   | Left                | Ctrl+Shift+L |                                   |
| 2   | Center              | Ctrl+Shift+E |                                   |
| 3   | Right               | Ctrl+Shift+R |                                   |
| 4   | Justified           | Ctrl+Shift+J |                                   |
| —   | _separator_         |              |                                   |
| 5   | Increase indent     | Ctrl+]       |                                   |
| 6   | Decrease indent     | Ctrl+[       |                                   |
| 7   | Indentation options | —            | Dialog for precise indent control |

### Line & paragraph spacing → submenu

| #   | Label                         | Notes                                          |
| --- | ----------------------------- | ---------------------------------------------- |
| 1   | Single                        | 1.0                                            |
| 2   | 1.15                          |                                                |
| 3   | 1.5                           |                                                |
| 4   | Double                        | 2.0                                            |
| —   | _separator_                   |                                                |
| 5   | Add space before paragraph    |                                                |
| 6   | Remove space before paragraph |                                                |
| 7   | Add space after paragraph     |                                                |
| 8   | Remove space after paragraph  |                                                |
| —   | _separator_                   |                                                |
| 9   | Custom spacing                | Opens dialog                                   |
| 10  | Keep lines together           | Prevents paragraph from splitting across pages |
| 11  | Prevent single lines          | No orphan/widow lines                          |

### Bullets & numbering → submenu

| #   | Label         | Notes                               |
| --- | ------------- | ----------------------------------- |
| 1   | Bulleted list | —                                   |
| 2   | Numbered list | —                                   |
| 3   | Checklist     | Interactive checkbox items          |
| —   | _separator_   |                                     |
| 4   | List options  | Dialog for custom bullets/numbering |

---

## Tools menu

**Trigger:** Click `id="docs-tools-menu"`.

| #   | Label                  | Shortcut               | Has submenu | Disabled | Notes                                                |
| --- | ---------------------- | ---------------------- | ----------- | -------- | ---------------------------------------------------- |
| 1   | Spelling and grammar   | —                      | yes ▸       | —        | Check spelling / Add word to dictionary              |
| 2   | Word count             | Ctrl+Shift+C           | —           | —        | Words, characters, pages                             |
| 3   | Review suggested edits | Ctrl+Alt+O, Ctrl+Alt+U | —           | —        | Accept/reject all suggestions                        |
| 4   | Compare documents      | —                      | —           | yes      | Compare with another Doc (requires a doc to compare) |
| 5   | Citations              | —                      | —           | —        | Manage bibliography citations                        |
| 6   | eSignature             | —                      | —           | —        | Request signatures                                   |
| 7   | Tasks                  | —                      | —           | —        | Open Tasks sidebar                                   |
| 8   | Variables              | —                      | —           | —        | Manage document variables                            |
| 9   | Line numbers           | —                      | —           | —        | Show/hide line numbers                               |
| 10  | Linked objects         | —                      | —           | —        | Manage charts/tables linked from Sheets              |
| 11  | Dictionary             | Ctrl+Shift+Y           | —           | —        | Lookup selected word                                 |
| —   | _separator_            |                        |             |          |                                                      |
| 12  | Translate document     | —                      | —           | —        | Machine-translate entire doc to another language     |
| 13  | Voice typing           | Ctrl+Shift+S           | —           | —        | Speech-to-text input                                 |
| 14  | Audio New              | —                      | yes ▸       | —        | Audio recording tools (new feature)                  |
| 15  | Gemini                 | —                      | —           | —        | Opens Gemini AI sidebar                              |
| —   | _separator_            |                        |             |          |                                                      |
| 16  | Notification settings  | —                      | —           | —        | Email notifications for comments/changes             |
| 17  | Preferences            | —                      | —           | —        | Autocorrect, smart quotes, substitutions             |
| 18  | Accessibility          | —                      | —           | —        | Screen reader settings                               |
| —   | _separator_            |                        |             |          |                                                      |
| 19  | Activity dashboard     | —                      | —           | yes      | View tracking (Workspace Business+)                  |

### Spelling and grammar → submenu

| #   | Label                          | Shortcut   | Notes                    |
| --- | ------------------------------ | ---------- | ------------------------ |
| 1   | Spell check                    | Ctrl+Alt+X | Highlights errors inline |
| 2   | Personal dictionary            | —          | Add/manage custom words  |
| 3   | Show spelling suggestions      | —          | Autocorrect suggestions  |
| 4   | Show grammar suggestions       | —          |                          |
| 5   | Check document for suggestions | —          | Full document scan       |

---

## Extensions menu

**Trigger:** Click `id="docs-extensions-menu"`.

| #   | Label       | Has submenu | Notes                                     |
| --- | ----------- | ----------- | ----------------------------------------- |
| 1   | Add-ons     | yes ▸       | Manage add-ons / Open G Suite Marketplace |
| 2   | Apps Script | —           | Opens the bound Google Apps Script editor |

### Add-ons → submenu

| #   | Label                           | Notes                                       |
| --- | ------------------------------- | ------------------------------------------- |
| 1   | Get add-ons                     | Opens G Suite Marketplace                   |
| 2   | Manage add-ons                  | Opens installed add-ons manager             |
| —   | (installed add-ons listed here) | Each installed add-on appears as a sub-item |

---

## Help menu

**Trigger:** Click `id="docs-help-menu"`.

| #   | Label              | Shortcut | Notes                               |
| --- | ------------------ | -------- | ----------------------------------- |
| 1   | Search the menus   | Alt+/    | Search all menu items by name       |
| —   | _separator_        |          |                                     |
| 2   | Docs Help          | —        | Opens Google Docs Help Center       |
| 3   | Training           | —        | Google Workspace training resources |
| 4   | Updates            | —        | What's new in Google Docs           |
| —   | _separator_        |          |                                     |
| 5   | Help Docs improve  | —        | Send feedback to Google             |
| —   | _separator_        |          |                                     |
| 6   | Keyboard shortcuts | Ctrl+/   | Opens keyboard shortcuts overlay    |

---

## Accessibility menu (screen-reader mode)

**Trigger:** Click `id="docs-screenreader-menu"` (visible only when screen reader detected).

| #   | Label                      | Has submenu      | Disabled | Notes                                                    |
| --- | -------------------------- | ---------------- | -------- | -------------------------------------------------------- |
| 1   | Verbalize to screen reader | yes ▸            | yes      | Navigation announcements (disabled in non-SR mode)       |
| 2   | Edits                      | yes ▸            | yes      | Navigate through edits/changes                           |
| 3   | Comments                   | yes ▸            | —        | Navigate through comments                                |
| 4   | Footnote                   | yes ▸            | —        | Navigate through footnotes                               |
| 5   | Headings                   | yes ▸            | —        | Navigate through headings                                |
| 6   | Graphics                   | yes ▸            | —        | Navigate through images/drawings                         |
| 7   | List                       | yes ▸            | —        | Navigate through lists                                   |
| 8   | Link                       | yes ▸            | —        | Navigate through hyperlinks                              |
| 9   | Table                      | yes ▸            | —        | Navigate through tables                                  |
| 10  | Section                    | yes ▸            | —        | Navigate through sections                                |
| 11  | Tabs                       | yes ▸            | yes      | Navigate through doc tabs (disabled on single-tab docs)  |
| 12  | Misspelling                | yes ▸            | —        | Navigate through misspelled words                        |
| 13  | Formatting                 | yes ▸            | —        | Navigate through formatting changes                      |
| 14  | Bookmarks                  | yes ▸            | —        | Navigate through bookmarks                               |
| 15  | Show live edits            | Ctrl+Alt+Shift+R | yes      | Verbalize real-time collab changes (Workspace Business+) |

---

## Toolbar dropdowns

### Font family dropdown

**Trigger:** Click the font name shown in the toolbar (after the undo/redo buttons).
`#docs-font-family` / `[aria-label="Font"][role="listbox"]` / `[data-tooltip="Font"]`

**Source:** `pass3/docs_editor/menus/toolbar-font.json` (live captured 2026-06-09; 1 item extracted = "More fonts")

The full font list is a scrollable virtual list; only the first visible item is captured as a DOM
`[role="option"]`. The list includes:

- "More fonts" entry (opens font picker dialog)
- Recently used fonts (pinned at top)
- Alphabetical list: Arial, Arial Black, Calibri, Cambria, Comic Sans MS, Courier New,
  Georgia, Impact, Lucida Handwriting, Lucida Sans, Palatino, Tahoma, Times New Roman,
  Trebuchet MS, Verdana, + many more.

### Font size dropdown

**Trigger:** Click the size number in the toolbar.
`aria-label="Font size"` / `aria-label^="Font size list"`

Common sizes listed (click or type):
8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96

### Heading style / Paragraph styles dropdown

**Trigger:** Click the style dropdown (shows "Normal text", "Heading 1", etc.).
`[data-tooltip="Styles"]` / `[aria-label="Styles"][role="listbox"]` / `#docs-paragraph-styles-menu`

**Source:** `pass3/docs_editor/menus/toolbar-heading.json` (live captured 2026-06-09; 1 item extracted = "Normal text")

The full list (same as Format → Paragraph styles → submenu):
Normal text, Title, Subtitle, Heading 1 through Heading 6.

---

## Toolbar buttons (reference)

Non-dropdown toolbar items (left to right):

| Label            | Shortcut     | Notes                                     |
| ---------------- | ------------ | ----------------------------------------- |
| Undo             | Ctrl+Z       |                                           |
| Redo             | Ctrl+Y       |                                           |
| Print            | Ctrl+P       |                                           |
| Paint format     | —            | Copy formatting with click                |
| Zoom %           | —            | Dropdown with preset zoom levels          |
| Font             | —            | Dropdown                                  |
| Font size        | —            | Dropdown                                  |
| Bold             | Ctrl+B       | Toggle button                             |
| Italic           | Ctrl+I       | Toggle button                             |
| Underline        | Ctrl+U       | Toggle button                             |
| Text color       | —            | Color picker                              |
| Highlight color  | —            | Color picker                              |
| Insert link      | Ctrl+K       |                                           |
| Insert comment   | Ctrl+Alt+M   |                                           |
| Insert image     | —            |                                           |
| Align left       | Ctrl+Shift+L | Toggle                                    |
| Center           | Ctrl+Shift+E | Toggle                                    |
| Align right      | Ctrl+Shift+R | Toggle                                    |
| Justified        | Ctrl+Shift+J | Toggle                                    |
| Line spacing     | —            | Dropdown                                  |
| Checklist        | —            | Toggle                                    |
| Bulleted list    | —            | Toggle                                    |
| Numbered list    | —            | Toggle                                    |
| Decrease indent  | Ctrl+[       |                                           |
| Increase indent  | Ctrl+]       |                                           |
| Clear formatting | Ctrl+\       |                                           |
| Editing mode     | —            | Dropdown (Editing / Suggesting / Viewing) |

---

## Share button (top-right)

**Trigger:** Click the blue `Share` button (top-right of editor).

Opens a full Share dialog (not a menu). The dialog sections:

| Section               | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| People with access    | List of current collaborators and their roles (Editor / Commenter / Viewer) |
| Add people and groups | Input field to add email addresses                                          |
| General access        | Restricted / Anyone with the link (Viewer / Commenter / Editor)             |
| Copy link             | Button to copy the shareable link                                           |
| Done / Share          | Save and close                                                              |

---

## Version history sidebar

**Trigger:** File → Version history → See version history (Ctrl+Alt+Shift+H).

Not a menu, but a panel:

- Shows date/time of each saved version
- Named versions appear with their custom name
- Click a version to preview it
- "Restore this version" button appears in preview

---

## Comments / activity panel

**Trigger:** Comments icon in top-right (speech bubble) or via View → Comments.

Not a menu — it's a sidebar panel showing all comments in the document with reply threads.

---

## Document body right-click context menu (no selection)

**Trigger:** Right-click anywhere in the document body when nothing is selected.

**Source:** `pass3/docs_editor/menus/body-context.{html,json,png}` (10 items, captured 2026-06-08)

| #   | Label                    | Shortcut     | Has submenu | Disabled | Notes                                               |
| --- | ------------------------ | ------------ | ----------- | -------- | --------------------------------------------------- |
| 1   | Cut                      | Ctrl+X       | —           | yes      | Disabled — nothing selected                         |
| 2   | Copy                     | Ctrl+C       | —           | yes      | Disabled — nothing selected                         |
| 3   | Paste                    | Ctrl+V       | —           | —        |                                                     |
| 4   | Paste without formatting | Ctrl+Shift+V | —           | —        |                                                     |
| 5   | Delete                   | —            | —           | yes      | Disabled — nothing selected                         |
| 6   | Help me write            | —            | —           | —        | Gemini AI writing assistant (badge: New)            |
| 7   | Suggest edits            | —            | —           | —        | Toggle suggestion mode                              |
| 8   | Insert link              | Ctrl+K       | —           | —        |                                                     |
| 9   | Format options           | —            | yes ▸       | —        | Opens Format Options sidebar (size, position, etc.) |
| 10  | Clear formatting         | Ctrl+\       | —           | —        |                                                     |

---

## Document body right-click context menu (with selection)

**Trigger:** Select text (Ctrl+A or drag), then right-click.

**Source:** `pass3/docs_editor/menus/selection-context.{html,json,png}` (11 items, captured 2026-06-08)

| #   | Label                    | Shortcut     | Has submenu | Disabled | Notes                                                  |
| --- | ------------------------ | ------------ | ----------- | -------- | ------------------------------------------------------ |
| 1   | Cut                      | Ctrl+X       | —           | —        | Now enabled (text selected)                            |
| 2   | Copy                     | Ctrl+C       | —           | —        | Now enabled                                            |
| 3   | Paste                    | Ctrl+V       | —           | —        |                                                        |
| 4   | Paste without formatting | Ctrl+Shift+V | —           | —        |                                                        |
| 5   | Delete                   | —            | —           | —        | Now enabled                                            |
| 6   | Suggest edits            | —            | —           | —        | "Help me write" replaced by this when text is selected |
| 7   | Insert link              | Ctrl+K       | —           | —        |                                                        |
| 8   | Save to Keep             | —            | —           | —        | Saves selection to Google Keep                         |
| 9   | Change page to landscape | —            | —           | —        | Appears when selection spans a page                    |
| 10  | Format options           | —            | yes ▸       | —        |                                                        |
| 11  | Clear formatting         | Ctrl+\       | —           | —        |                                                        |

**Key difference from no-selection context:** Cut/Copy/Delete are enabled; "Save to Keep" appears; "Help me write" is replaced.

---

## Account menu

**Trigger:** Click the account avatar (top-right, `aria-label^="Google Account:"`).

**Source:** `pass3/docs_editor/menus/account-menu.{html,json,png}` (captured 2026-06-08)

Opens a Google account chooser / profile card overlay (same as Drive account menu).
