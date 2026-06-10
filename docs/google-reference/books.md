# Google Books / Play Books — Menu Reference

> Captured from play.google.com/books, play.google.com/store/books, and play.google.com/books/reader
> on 2026-06-08 using the pass-3 Playwright probe harness.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/books_library/menus/`,
> `pass3/books_detail/menus/`, `pass3/books_reader/menus/`
>
> **Book used for detail + reader probes:** _Alice's Adventures in Wonderland_ by Lewis Carroll
> (public domain, free on Play Books — `id=Y7sOAAAAIAAJ`)
> **Reader URL:** `https://play.google.com/books/reader?id=Y7sOAAAAIAAJ&pg=GBS.PP1`
>
> **Extraction method:** Live Playwright click probes in an authenticated Chromium session.
> The Play Books library is an Angular Material app; the reader is a full-page iframe at
> `books.googleusercontent.com` (same-origin accessible via Playwright `page.frames()`).
> Menus in the reader iframe were captured by probing the frame directly.
>
> **Three surfaces probed:**
>
> - Library (`https://play.google.com/books`) — personal book shelf
> - Store detail page (`https://play.google.com/store/books/details/...`) — book product page
> - Reader (`https://play.google.com/books/reader?id=...`) — in-book reading UI

---

## Surface 1: Play Books Library (`play.google.com/books`)

The library is an Angular Material single-page app. The main content area is a shelf grid.
Menus captured: 1 (`book-tile-more`). Other triggers opened inline panels or iframes not
captured by the standard `[role="menu"]` harness.

---

### Book tile "More options" menu

**Trigger:** Click the three-dot vertical menu button on a book tile in the library grid.
The button has `aria-label="More options"` and appears when hovering over a tile.

**Source:** `pass3/books_library/menus/book-tile-more.{html,json,png}` (6 items, captured 2026-06-08)

| #   | Label          | Notes                                             |
| --- | -------------- | ------------------------------------------------- |
| 1   | About the book | Navigate to the book's detail page on Play Store  |
| 2   | Read           | Open the book in the reader                       |
| 3   | Mark finished  | Toggle read-status for the book                   |
| 4   | Hide           | Remove the book from the main shelf view          |
| 5   | Add to shelves | Add book to a custom shelf (submenu not captured) |
| 6   | Export         | Download the book (if DRM allows)                 |

---

### Sidebar navigation (role="menuitem" links)

The left sidebar contains Angular Material nav items with `role="menuitem"`:

| Item       | href            | Notes                             |
| ---------- | --------------- | --------------------------------- |
| Books (0)  | `/books`        | Main library shelf (current page) |
| Series (0) | `/books/series` | Series view                       |
| Hidden     | `/books/hidden` | Books hidden from main shelf      |

The sidebar also has a **Shelves** accordion panel (`mat-expansion-panel-header`, expanded by default)
with a "Create shelf" action button. Clicking the expansion header toggles the panel — it does not
open a `[role="menu"]`.

---

### Library toolbar buttons (not menus)

| Button            | Selector                                               | Function                                          |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------- |
| Search this shelf | `button#filterButton` (aria-label="Search this shelf") | Opens an inline text filter within the shelf grid |
| Upload files      | `button#uploadButton`                                  | Upload local ebook files to the library           |
| Shop for books    | `button:has-text("Shop for books")`                    | Navigates to Play Store books section             |

**No sort dropdown** is present in the library toolbar. Books are displayed in acquisition order.

---

### Account menu (top-right avatar)

**Note:** In the Play Books library, the account avatar is an `<a>` element (class `gb_C gb_5a gb_6`),
unlike the Play Store detail page which uses a `<button>`. The `waitForMenu` harness reported 0 items
because this opens an iframe-based overlay (same pattern as Calendar/Meet). From manual inspection the
overlay content matches the standard Google Account overlay.

---

### Apps switcher (waffle)

The Play Books library uses `<a aria-label="Google apps" class="gb_C">` — opens a standard Google apps
iframe overlay. Not captured by the DOM menu harness (iframe-based). Same content as documented in
`calendar.md` / `meet.md`.

---

## Surface 2: Play Books Store Detail Page

**URL:** `https://play.google.com/store/books/details/Lewis_Carroll_Alice_s_Adventures_in_Wonderland?id=Y7sOAAAAIAAJ`

The Play Store detail page uses a different layout from the library. The account avatar is a `<button>`
not an anchor. The toolbar has fewer items than the library.

---

### Account menu (Play Store, top-right)

**Trigger:** JS-click `button[aria-label^="Google Account:"]` (Play Store uses a button, not an anchor).

**Source:** `pass3/books_detail/menus/account-menu.{html,json,png}` (11 items, captured 2026-06-08)

This is the Play Store account menu (different from the library's Google account overlay). It includes
Play-specific items not present in Drive/Calendar:

| #   | Label                      | Notes                                            |
| --- | -------------------------- | ------------------------------------------------ |
| 1   | Manage your Google Account | Links to myaccount.google.com                    |
| 2   | Library & devices          | `play_apps` icon — manage library across devices |
| 3   | Payments & subscriptions   | `payment` icon — manage payment methods          |
| 4   | My Play activity           | `reviews` icon — review history, ratings         |
| 5   | Offers                     | `redeem` icon — Play promotional offers          |
| 6   | Play Pass                  | SVG icon — Play Pass subscription info           |
| 7   | Play Points                | SVG icon — Play Points rewards program           |
| 8   | Personalization in Play    | SVG icon — interest/recommendation settings      |
| 9   | Settings                   | `settings` icon — Play Store settings            |
| 10  | Switch account             | `switch_account` icon — switch Google account    |
| 11  | Sign out                   | `logout` icon                                    |

---

### "More review actions" menu (on review cards)

**Trigger:** Click `button[aria-label="More review actions"]` — the three-dot on a user review card in
the "Ratings and reviews" section.

**Source:** `pass3/books_detail/menus/more-options.{html,json,png}` (1 item, captured 2026-06-08)

| #   | Label              | Notes                                      |
| --- | ------------------ | ------------------------------------------ |
| 1   | Flag inappropriate | Report a review as violating Play policies |

---

### Main CTA button ("Get for free" / "Buy")

**Trigger:** `button[aria-label="Get for free"]` on public-domain titles.

**Structure:** This is a single-action button, **not a dropdown menu**. Clicking it immediately adds
the book to the library and the button label changes. For paid books the equivalent buttons are "Buy"
and "Free sample". The "Free sample" / "Read sample" buttons link directly to the reader URL; they do
not open menus.

There is no dropdown on the CTA button (unlike some Play Store app pages that have a "Buy" +
"More options" split button). The Books detail page uses individual action buttons in a row:
"Get for free" | "Add to wishlist" | "Buy for groups".

---

### "About this ebook" expando

**Trigger:** `button[aria-label="See more information on About this ebook"]` (arrow icon button in the
About section).

**Structure:** Opens a **dialog panel** (not a `[role="menu"]`). The harness captured the dialog
element (0 menu items, but the HTML is saved). The panel shows the full book description.

---

### Share and other missing buttons

A **Share** button was not observed on the Alice detail page. The Play Store Books detail page for
free/public-domain titles shows a reduced action bar. Paid book detail pages may include additional
action buttons (Share, Send as gift). **Not captured — structural gap.**

---

## Surface 3: Play Books Reader

**URL:** `https://play.google.com/books/reader?id=Y7sOAAAAIAAJ&pg=GBS.PP1`

The reader is a full-page `<iframe class="-gb-display">` at `books.googleusercontent.com/books/reader/frame`.
The iframe is cross-origin from `play.google.com` but accessible via Playwright's `page.frames()` API.

The toolbar is a horizontal strip at the top of the iframe with the following buttons (left to right):

| Button                 | aria-label                         | Icon glyph        | Opens                                     |
| ---------------------- | ---------------------------------- | ----------------- | ----------------------------------------- |
| Toggle fullscreen      | `Toggle fullscreen`                | `fullscreen`      | Toggles fullscreen mode (action)          |
| Search                 | `Search`                           | `search`          | Inline search bar (not a menu)            |
| Display settings       | `Display settings`                 | `text_format`     | Dialog: Display options (see below)       |
| Open table of contents | `Open table of contents`           | `toc`             | Side panel: TOC (see below)               |
| Annotations            | `Annotations`                      | `description`     | Side panel: Highlights/notes (skipped)    |
| Add/Remove bookmark    | `Add bookmark` / `Remove bookmark` | `bookmark_border` | Toggle bookmark on current page (skipped) |
| Help and Feedback      | `Help and Feedback`                | `help_outline`    | Dropdown menu (see below)                 |
| More options           | `More options`                     | `more_vert`       | Dropdown menu (see below)                 |
| Previous Page          | `Previous Page`                    | `chevron_left`    | Navigation action                         |
| Next Page              | `Next Page`                        | `chevron_right`   | Navigation action                         |

---

### Display settings dialog

**Trigger:** Click `button[aria-label="Display settings"]` in the reader toolbar.

**Source:** `pass3/books_reader/menus/font-settings.{html,json,png}` (dialog, 0 menu-style items, captured 2026-06-08)

Opens `mat-dialog-container[role="dialog"]` with title "Display options". The harness captured the
dialog HTML (18KB) but extracted 0 items because the dialog uses Angular Material controls rather than
`[role="menuitem"]` items. Full control list from DOM inspection:

| Control     | Type                                            | Options / Values                                |
| ----------- | ----------------------------------------------- | ----------------------------------------------- |
| Dark theme  | `mat-slide-toggle` (`role="switch"`)            | on / off (default: off)                         |
| View        | `mat-select` (`role="combobox"`)                | Flowing text / Original (default: Flowing text) |
| Font        | `mat-select` (`role="combobox"`)                | Original / (other fonts)                        |
| Font size   | Decrease/Increase buttons (`aria-label`)        | Current: 100%                                   |
| Line height | Decrease/Increase buttons (`aria-label`)        | Current: 100%                                   |
| Justify     | `mat-button-toggle-group` (`role="radiogroup"`) | No justification (default) / Justify text       |
| Page layout | `mat-button-toggle-group` (`role="radiogroup"`) | Automatic (default) / Two-page / One-page       |
| Close       | `button[aria-label="Close display options"]`    | Closes dialog                                   |

---

### Table of Contents panel

**Trigger:** Click `button[aria-label="Open table of contents"]` in the reader toolbar.

**Source:** `pass3/books_reader/menus/toc-panel.{html,json,png}` (panel, 0 menu-style items, captured 2026-06-08)

Opens a side panel (not a `[role="menu"]`). The harness captured the panel element but extracted 0 items.
The TOC panel shows chapter/section links for the book. For _Alice's Adventures in Wonderland_ the
chapters are "Down the Rabbit-Hole", "The Pool of Tears", etc.

---

### Search bar

**Trigger:** Click `button[aria-label="Search"]` in the reader toolbar.

**Source:** `pass3/books_reader/menus/search-in-book.{html,json,png}` (inline input, 0 menu-style items, captured 2026-06-08)

Opens an inline search bar within the reader (not a `[role="menu"]`). The harness captured the search
area element. The search bar accepts text queries and shows in-book matches.

---

### More options menu

**Trigger:** Click `button[aria-label="More options"]` (three-dot / `more_vert` icon) in the reader toolbar.

**Source:** `pass3/books_reader/menus/more-menu.{html,json,png}` (2 items, captured 2026-06-08)

| #   | Label (Material icon prefix stripped)  | Notes                                                   |
| --- | -------------------------------------- | ------------------------------------------------------- |
| 1   | About this book                        | Navigates to or opens the book's Play Store detail page |
| 2   | Save annotations to Google Drive — Off | Toggle: save highlights/notes to Google Drive           |

**Raw captured labels** include Material icon name prefix:
`"book About this book"`, `"attach_drive Save annotations to Google Drive Off arrow_forward"`

---

### Help and Feedback menu

**Trigger:** Click `button[aria-label="Help and Feedback"]` (`help_outline` icon) in the reader toolbar.

**Source:** `pass3/books_reader/menus/help-feedback.{html,json,png}` (3 items, captured 2026-06-08)

| #   | Label                       | Notes                                        |
| --- | --------------------------- | -------------------------------------------- |
| 1   | Get help using Play Books   | Links to Play Books Help Center              |
| 2   | Send feedback to Play Books | Opens feedback submission form               |
| 3   | Report a problem with ebook | Report content issue with this specific book |

**Raw captured labels** include Material icon glyphs:
`"help_outlineGet help using Play Books"`, `"feedbackSend feedback to Play Books"`, `"bookReport a problem with ebook"`

---

### Annotations panel

**Trigger:** Click `button[aria-label="Annotations"]` (`description` icon) in the reader toolbar.

**Source:** Skipped (menu did not appear in harness detection) — captured 2026-06-08.

The Annotations panel opens as a side drawer. For an account with no highlights, the panel shows empty
state. The harness's `waitForMenu` did not detect it because it opens as a slide-in panel (not
`[role="menu"]`, `[role="dialog"]`, etc.).

---

### Bookmark toggle

**Trigger:** Click `button[aria-label="Add bookmark"]` (`bookmark_border` icon) in the reader toolbar.

**Source:** Skipped (menu did not appear) — captured 2026-06-08.

This is a toggle action, not a menu: clicking it adds a bookmark to the current page and the aria-label
changes to "Remove bookmark". The harness correctly reported "menu did not appear" — this button
confirms/completes immediately without opening a menu.

---

### Text selection context menu

**Note:** The Play Books reader renders book pages as `<img>` scans or flowing reflowed HTML inside the
reader iframe. For public-domain Google Books scans, the page content is rendered as images, not
selectable text. Text selection popover (Highlight / Copy / Define / Translate / Search the web) is
only available for reflowed ebooks, not scanned pages.

For the Alice in Wonderland public domain title (`id=Y7sOAAAAIAAJ`), the reader serves
image-scanned pages. The text selection popover was **not attempted** because there is no
selectable text DOM element in the reader frame. A reflowed ebook would need a different test book.

---

## Summary of captures

### books_library

| Probe            | Status  | Items | Notes                                                         |
| ---------------- | ------- | ----- | ------------------------------------------------------------- |
| `sort-menu`      | skipped | —     | Filter button opens inline search, not a menu                 |
| `shelves-panel`  | skipped | —     | Expansion panel, not a menu                                   |
| `book-tile-more` | ok      | 6     | About / Read / Mark finished / Hide / Add to shelves / Export |
| `account-menu`   | skipped | —     | iframe overlay (gb_C anchor) — not captured by menu harness   |
| `apps-switcher`  | skipped | —     | iframe overlay — not captured by menu harness                 |
| `nav-section`    | skipped | —     | Navigation link, not a menu                                   |

### books_detail

| Probe                   | Status  | Items | Notes                                                      |
| ----------------------- | ------- | ----- | ---------------------------------------------------------- |
| `add-to-library-or-buy` | skipped | —     | Single-action button, no dropdown                          |
| `wishlist-button`       | skipped | —     | Toggle button, no menu                                     |
| `more-options`          | ok      | 1     | "More review actions" → Flag inappropriate                 |
| `account-menu`          | ok      | 11    | Play Store account overlay (not iframe-based on this page) |
| `info-section`          | ok      | 0     | Dialog panel captured (HTML saved), no menu-style items    |

### books_reader

| Probe               | Status  | Items | Notes                                                                   |
| ------------------- | ------- | ----- | ----------------------------------------------------------------------- |
| `font-settings`     | ok      | 0     | Display options dialog captured (HTML saved), Angular Material controls |
| `toc-panel`         | ok      | 0     | TOC side panel captured (HTML saved)                                    |
| `highlights-panel`  | skipped | —     | Panel did not open as detectable menu element                           |
| `bookmarks-panel`   | skipped | —     | Toggle action button, no menu                                           |
| `search-in-book`    | ok      | 0     | Inline search bar captured (HTML saved)                                 |
| `more-menu`         | ok      | 2     | About this book / Save annotations to Drive                             |
| `help-feedback`     | ok      | 3     | Get help / Send feedback / Report a problem                             |
| `fullscreen-toggle` | skipped | —     | Toggle action, no menu                                                  |

---

## Structural notes

### Play Books library vs Play Store

The personal library at `play.google.com/books` is a separate Angular Material SPA from the Play Store
(`play.google.com/store/books`). They share the same Google account but have different UI frameworks:

- Library: Angular Material components, `mat-mdc-*` class names, navigation uses `role="menuitem"` anchors
- Store: Material Design Web components, `VfPpkd-*` and gmat class names, account uses `<button>` for avatar

### Reader iframe architecture

The reader at `play.google.com/books/reader?id=...` is a thin outer shell that loads the actual reader
UI in a full-viewport iframe (`<iframe class="-gb-display">`) from `books.googleusercontent.com/books/reader/frame`.
The iframe is accessible via Playwright's `page.frames()` because the outer page and iframe share the
same browser context. All reader toolbar interactions must target the iframe frame, not the outer page.

### Text selection and image-scanned books

Books from the Google Books digitization project (scanned PDFs with `AAAAYAAJ` or `AAAAQAAJ` style IDs)
render as image pages in the reader. These cannot have text selection. Reflowed EPUB ebooks (IDs ending
`QAAJ`, `BAQBAJ`, etc.) support text selection and the annotation/highlight popover. The text selection
popover was not captured in this pass.
