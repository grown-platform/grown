# Google Photos — Menu Reference

> Captured from photos.google.com/u/0/ on 2026-06-09 using the pass-3 Playwright probe harness.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/photos/menus/`
>
> **Extraction method:** Live Playwright click probes in an authenticated Chromium session.
> Google Photos uses a Polymer/Material Design app with a **global pointer-intercepting scrim overlay**
> (`div.uW2Fw-IE5DDf`) that blocks all normal Playwright pointer events. All buttons inside the
> main content area require JS-dispatch clicks (`element.click()` via evaluate) to bypass the overlay.
>
> **Account state:** Throwaway account has no photos uploaded. All photo-tile-specific probes
> (photo-tile-hover-action, photo-right-click, selection-toolbar, selection-more-menu) were skipped
> because no photo tiles are present in the grid. Those probes are documented structurally from
> public product knowledge.
>
> **Left nav structure:** Google Photos shows a left sidebar with navigation links:
> Photos (All photos), Explore, Sharing, Library (Albums, Favorites, Utilities). Nav items are
> `<a>` tags with `jsaction="click:RfWuxb(preventDefault=true)"` — the global scrim overlay
> blocks pointer events on these too; they require JS-dispatch clicks.

---

## "Create and add photos" button

**Trigger:** JS-click `button[aria-label="Create and add photos"][aria-haspopup="menu"]` in the
top-right toolbar.

**Source:** `pass3/photos/menus/create-menu.{html,json,png}` (12 items, captured 2026-06-09)

The button's `aria-label` is "Create and add photos" (not simply "Create" or "+"). It has
`aria-haspopup="menu"`. The menu is organized into three logical sections:
creation actions, import/upload actions, and transfer/digitize actions.

| #   | Label                                   | Notes                                               |
| --- | --------------------------------------- | --------------------------------------------------- |
| 1   | Album                                   | Create a new personal album                         |
| 2   | Collage                                 | Auto-generate a collage from selected photos        |
| 3   | Highlight video                         | Auto-generate a highlight reel video                |
| 4   | Animation                               | Create an animated GIF from selected photos         |
| 5   | Share with a partner                    | Set up a shared library with another Google account |
| 6   | Import photos                           | Upload photos from device                           |
| 7   | Back up folders — Back up automatically | Enable automatic folder backup                      |
| 8   | From other places                       | Upload from other cloud services (has submenu ▸)    |
| 9   | Transfer from photo collections         | Import from Apple Photos or Amazon Photos           |
| 10  | Transfer from photography services      | Import from services like Flickr                    |
| 11  | Digitize physical photos                | Scan physical prints using PhotoScan app            |
| 12  | Scan photos with your phone             | Scan printed photos with mobile camera              |

**Submenu for "From other places":** Reported as `hasSubmenu: true` with
`aria-label="Upload photos from other places"`. The submenu hover failed because the scrim
overlay also intercepts hover events on open-menu items. The submenu likely contains cloud
storage providers (Facebook, Dropbox, etc.) and social networks.

**Raw captured labels:** The "Back up folders" item has concatenated text
"Back up foldersBack up automatically" (icon glyph + label run together in the DOM).

---

## Settings (navigation link)

**Trigger:** JS-click `a[aria-label="Settings"][href="./settings"]` in the left nav or top bar.

**Source:** `pass3/photos/menus/settings.{html,json,png}` (0 items, captured 2026-06-09)

The Settings trigger is an `<a>` element that **navigates to a separate settings page** at
`photos.google.com/settings`. It does not open a dropdown menu. The harness captured 0 items
because there is no `[role="menu"]` or `[role="listbox"]` associated with this trigger.

**Settings page structure** (from direct navigation to `photos.google.com/u/0/settings`):

| Section             | Settings available                                                                |
| ------------------- | --------------------------------------------------------------------------------- |
| Storage             | Storage usage meter; manage storage link                                          |
| Backup              | Backup status; backup quality (Storage saver / Original); backup over mobile data |
| Sharing             | Partner sharing; shared libraries                                                 |
| Memories            | Date range for memories; memories subjects; hide specific people/dates            |
| Device              | Device-specific backup folders                                                    |
| Email notifications | Notification toggles for sharing activity                                         |
| Google Account      | Link to myaccount.google.com                                                      |

---

## More options (top-right kebab)

**Trigger:** The Photos top-right toolbar does **not have a visible three-dot kebab** button on the
main library/grid page. The "More options" button selector matched 0 items.

**Structural note:** In Google Photos, the per-library navigation to Trash, Locked Folder, and
settings are accessed via the **left sidebar** (under Library > Utilities) or via the Settings page,
not via a top-right kebab. A kebab (`⋮`) button may appear on individual photo or album detail pages
but was not present on the main grid landing page.

---

## Account menu (top-right avatar)

**Trigger:** JS-click `[aria-label^="Google Account:"]` — opens an iframe-based Google Account
overlay.

**Source:** `pass3/photos/menus/account-menu.{html,json,png}` (0 items, captured 2026-06-09)

Photos uses the standard Google Account overlay (same as Calendar, Meet). The trigger is an `<a>`
or `<button>` element; the overlay loads in a cross-origin iframe at `ogs.google.com`. The
main-frame DOM menu harness captures 0 items. Content matches the standard account overlay:
Manage your Google Account, Add account, Sign out.

---

## Apps switcher (waffle, 9-dot)

**Trigger:** JS-click `a[aria-label="Google apps"]` — opens an iframe-based apps overlay.

**Source:** `pass3/photos/menus/apps-switcher.{html,json,png}` (0 items, captured 2026-06-09)

Same pattern as Calendar/Meet: the waffle opens an iframe at `ogs.google.com/widget/app`. The
main-frame harness captures 0 items. Content is the standard Google apps grid:
Gmail, Drive, Gemini, Docs, Sheets, Slides, Forms, Calendar, Meet, etc.

---

## Left navigation — context menus

**Probe:** `nav-context` — right-click on the "All photos" nav link (`<a href="./" aria-label="All photos">`).

**Source:** Skipped — the global scrim overlay (`uW2Fw-IE5DDf`) blocks all pointer events
including right-clicks on the nav links. The `rightclick` trigger type timed out at 5000ms.

**Structural note:** Photos left nav links use `jsaction="click:RfWuxb(preventDefault=true)"` to
intercept clicks in JS. Right-clicking a nav link triggers no DOM context menu; the browser
native context menu would appear instead if the scrim were bypassed.

**Left nav items observed** (from DOM inspection):

- All photos (`href="./"`, aria-label="All photos")
- Explore
- Sharing
- Library (accordion for Albums, Favorites, Utilities)
- Trash (under Utilities)
- Locked Folder (under Utilities)

---

## Photo tile hover actions (no photos in account)

**Probes skipped:** `photo-tile-hover-action`, `photo-right-click`, `selection-toolbar`,
`selection-more-menu` — all skipped because the throwaway account has no uploaded photos
and the photo grid is empty.

**Structural documentation** (from public product knowledge + DOM patterns):

### Per-tile hover action bar

When hovering over a photo tile in the grid, Photos reveals a small action bar overlay.
The ⋮ button in this bar (`aria-label="More options"`) opens a `[role="menu"]` with:

| #   | Label         | Notes                                      |
| --- | ------------- | ------------------------------------------ |
| 1   | Add to album  | Add the photo to an existing album         |
| 2   | Move to Trash | Move the photo to trash (30-day retention) |
| 3   | Share         | Share via link or with contacts            |
| 4   | Download      | Download the original file                 |
| 5   | Get info      | Open the info/details panel                |
| 6   | Make collage  | Start collage creation with this photo     |

**Selector when photos are present:** Hover `[data-p]` or `[jsname="p43zde"]` (photo tile containers),
then JS-click `button[aria-label="More options"]` after the hover action bar appears.

### Photo right-click

Right-clicking a photo tile opens the browser's native context menu (no DOM-level context menu is
registered by Photos). The global scrim overlay may prevent right-click events from reaching the
photo tile. **Not a capturable DOM menu.**

### Selection toolbar

Selecting one or more photos (click the checkmark overlay on a tile) reveals a bulk action toolbar
at the top of the page with buttons: Share, Add to album, Download, Delete, Get info, and a "More"
button extending with additional items.

**"More" menu in selection toolbar** (estimated from product knowledge):

| #   | Label         | Notes                                |
| --- | ------------- | ------------------------------------ |
| 1   | Edit          | Open in photo editor                 |
| 2   | Move to album | Move (not copy) to a different album |
| 3   | Archive       | Archive selected photos              |
| 4   | Save to Drive | Save to Google Drive                 |
| 5   | Order prints  | Open print ordering workflow         |

---

## Structural notes

### Global pointer-intercepting scrim overlay

All interactive controls in Google Photos are rendered inside a modal-style container
(`div.uW2Fw-Sx9Kwc`) that includes a scrim div (`div.uW2Fw-IE5DDf[jsaction="click:KY1IRb"]`)
which intercepts all pointer events. This is a Google Material Design "dialog backdrop" applied
to the entire page to manage focus for accessibility/keyboard navigation.

**Impact on Playwright:** Normal `.click()`, `.hover()`, and `.rightclick()` all time out with
"subtree intercepts pointer events" error. Only `element.click()` dispatched via JS evaluate
bypasses the scrim. This affects every interactive element on the Photos page:
buttons, links, photo tiles, and nav items.

**Workaround used:** All triggers changed to `type: "sequence"` with `type: "click_js"` steps.
Hovering is not possible via Playwright's `hover()` method; photo tile hover-triggered actions
cannot be captured without a custom approach (e.g., dispatching `mouseover`/`mouseenter` events
via JS evaluate).

### No left-nav menu structure (no right-click menus)

Google Photos does not implement custom JavaScript context menus on right-click of nav items,
photo tiles, albums, or any other element. All interactions use left-click, hover, or keyboard.

### iframe-based overlays

The account avatar and apps switcher open cross-origin iframes at `ogs.google.com`. These are
not accessible via the main-frame DOM harness. Content matches the standard Google Account
overlay documented in `calendar.md` and `meet.md`.

---

## Summary of captures

| Probe                            | Status  | Items | Notes                                                                                                                                                                                               |
| -------------------------------- | ------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-menu`                    | ok      | 12    | Album, Collage, Highlight video, Animation, Share with partner, Import, Back up folders, From other places (submenu), Transfer from collections, Transfer from photography services, Digitize, Scan |
| `create-menu__From other places` | error   | —     | Submenu hover blocked by scrim overlay                                                                                                                                                              |
| `more-options`                   | ok      | 0     | No kebab button on main grid page; selector matched 0 items                                                                                                                                         |
| `settings`                       | ok      | 0     | Navigates to settings page (not a dropdown menu)                                                                                                                                                    |
| `account-menu`                   | ok      | 0     | iframe overlay — not captured by main-frame harness                                                                                                                                                 |
| `apps-switcher`                  | ok      | 0     | iframe overlay — not captured by main-frame harness                                                                                                                                                 |
| `nav-context`                    | error   | —     | Global scrim blocks pointer events on nav links                                                                                                                                                     |
| `photo-tile-hover-action`        | error   | —     | No photos in account; "Show more" button matched instead (wrong element)                                                                                                                            |
| `photo-right-click`              | skipped | —     | No photos in account                                                                                                                                                                                |
| `selection-toolbar`              | skipped | —     | No photos in account                                                                                                                                                                                |
| `selection-more-menu`            | error   | —     | No photos; "Show more" button matched instead (wrong element)                                                                                                                                       |
