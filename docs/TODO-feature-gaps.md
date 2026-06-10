# grown-workspace — Feature Gaps & Unimplemented UI

Living backlog generated from two research passes (2026-06-09):

1. **Unimplemented / placeholder UI audit** — buttons, menu items, and panels that
   render but don't do anything yet (below).
2. **Google + Linear feature-gap scan** — capabilities present in the reference
   products (Google Workspace, Linear) but missing/partial in grown _(appended
   when that scan completes)_.

Legitimate disabled states (invalid form, loading, empty-list, permission-gated)
are intentionally excluded.

---

## 1. Unimplemented / placeholder UI

### Summary counts

| App                                                  | Unimplemented items            |
| ---------------------------------------------------- | ------------------------------ |
| admin                                                | 1                              |
| books                                                | 1 (help/feedback group)        |
| calendar                                             | 1 (4 event types)              |
| contacts                                             | 2 (settings + help groups)     |
| docs                                                 | ~16 menu items                 |
| drive                                                | ~12 (row-menu + details-panel) |
| EditorPlaceholder (sheets/docs/slides/pdf file-open) | 4 routes                       |
| forms                                                | 2 (5 menu items)               |
| mail                                                 | 3 (compose + settings groups)  |
| music                                                | 1 (help group)                 |
| photos                                               | 1 (4 create options)           |
| sheets                                               | ~60 menu items                 |
| slides                                               | ~70 menu items                 |
| video                                                | 1 (help group)                 |

### admin

- [ ] **Branding customization** — `web/app/src/pages/admin/index.tsx:656` — "Logo and accent color… Coming soon."; permanently-disabled "Customize branding" button (no handler).

### books

- [ ] **Help / Send feedback / Report a problem** — `web/app/src/pages/books/Library.tsx:128-130`, `web/app/src/pages/books/Reader.tsx:230-232` — disabled placeholders. Also `Reader.tsx:249` "Save annotations to Drive — Off" stub.

### calendar

- [ ] **Create-menu non-event types** — `web/app/src/pages/calendar/index.tsx:155-158` — `Task`, `Out of office`, `Focus time`, `Appointment schedule` disabled (only plain Event works).

### contacts

- [ ] **Settings menu** — `web/app/src/pages/contacts/index.tsx:244-246` — `Delegate access`, `Undo changes`, `More settings`.
- [ ] **Help menu** — `web/app/src/pages/contacts/index.tsx:252-255` — `How to sync contacts`, `Help`, `Training`, `Send feedback`.

### docs

- [ ] **Disabled menu placeholders** — `web/app/src/pages/docs/MenuBar.tsx:145-230` — `Suggesting`, `Show ruler`, `Show non-printing characters`, `Building blocks`, `Smart chips`, `Drawing`, `Chart`, `Page break`, `Footnote`, `Headers & footers`, `Spelling and grammar`, `Citations`, `Line numbers`, `Translate document`, `Voice typing (soon)`, `Preferences`, `Accessibility`.
- [ ] **"Available offline"** doc-list item — `web/app/src/pages/docs/DocList.tsx:181`.

### drive

- [ ] **Row context-menu placeholders** — `web/app/src/pages/drive/RowMenuItems.tsx:129,172,176,196,200,219,227` — `Ask Gemini`, `Approvals`, `Organize` submenu, File-information extras, `Labels`.
- [ ] **File details panel tabs** — `web/app/src/pages/drive/FileDetailsPanel.tsx:167,170` — `Activity`, `Approvals` tabs disabled.
- [ ] **"Apply label"** — `web/app/src/pages/drive/FileDetailsPanel.tsx:335,339` — "No labels yet. Labels are a follow-up."

### drive — file-open editors

- [ ] **Per-type editor placeholders** — `web/app/src/pages/EditorPlaceholder.tsx:134` via `App.tsx` — `/sheets/:id`, `/docs/:id`, `/slides/:id`, `/pdf/:id` opened from Drive show "{app} editor is coming soon" + read-only preview. (The standalone `/docs/*`, `/sheets/*`, `/slides/*` apps are real; only the Drive file-open variants stub out.)

### forms

- [ ] **Overflow menu** — `web/app/src/pages/forms/FormEditor.tsx:275,278` — `Embed HTML`, `Keyboard shortcuts`.
- [ ] **Question options** — `web/app/src/pages/forms/FormEditor.tsx:611-613` — `Description`, `Shuffle option order`, `Go to section based on answer`. Also `FormResponses.tsx:123-124` — `Select destination for responses`, `Unlink form`.

### mail

- [ ] **Compose toolbar** — `web/app/src/pages/mail/Compose.tsx:158,167,168` — `Formatting`, `Insert from Drive`, `Insert photo`.
- [ ] **Compose overflow** — `web/app/src/pages/mail/Compose.tsx:176-178` — `Schedule send`, `Plain text mode`, `Print`.
- [ ] **Settings menu** — `web/app/src/pages/mail/index.tsx:329-333` — `See all settings`, `Reading pane`, `Inbox density`, `Inbox type`, `Themes`.

### music

- [ ] **Help menu** — `web/app/src/pages/music/MusicLibrary.tsx:97-99` — `Supported formats`, `Help`, `Send feedback`.

### photos

- [ ] **Create menu** — `web/app/src/pages/photos/index.tsx:241-244` — `Collage`, `Highlight video`, `Animation`, `Share with a partner`.

### sheets

- [ ] **~60 disabled menu placeholders** — `web/app/src/pages/sheets/SheetMenuBar.tsx:83-282` — incl. `Paste special`, `Pivot table`, `Chart`, `Conditional formatting`, `Data validation`, `Named ranges`, `Protect sheets and ranges`, `Filter views`, `Macros`, `Apps Script`, `Version history`, `Make available offline`, etc. (full enumeration in git history of this audit).

### slides

- [ ] **~70 disabled menu placeholders** — `web/app/src/pages/slides/SlideMenuBar.tsx:70-249` — incl. `Find and replace`, `Animation`, `Table`, `Chart`, `Video`, `Audio`, `Theme builder`, `Align/Distribute`, `Group/Ungroup`, `Version history`, `Convert to video`, `Print preview`, etc.

### video

- [ ] **Help menu** — `web/app/src/pages/video/VideoLibrary.tsx:83-85` — `Supported formats`, `Help`, `Send feedback`.

### Checked & clean

- No `TODO`/`FIXME`/`XXX`/`HACK` comments in `web/app/src`.
- No no-op `() => {}` inline onClick handlers.
- No `comingSoon: true` catalog entries remain (all apps shipped). `ComingSoon.tsx` route exists but is unreachable from the catalog.
- chat, keep, sites, groups, whiteboard, live, meet, projects have functional action handlers — no dead buttons.
- All `window.alert(...)` usages are legitimate (errors / info dialogs), not stubs.

---

## 2. Feature-gap scan vs Google Workspace + Linear

Reference captures live in `docs/google-reference/` (committed) and `research/` (local-only).
**No Linear reference was captured** — the Projects gaps below are from general Linear
product knowledge, not captured research.

### Top 20 highest-impact gaps (whole suite)

1. **[sheets] Formula/calculation engine** — cells store text+formatting only; `=SUM()` is inert text. Biggest single functional hole.
2. **[meet] In-call text chat** — absent (all "message" tokens are WebRTC signaling).
3. **[meet] SFU media (scalability)** — mesh-only; won't scale to large calls.
4. **[keep] Reminders (time/location)** — core Keep feature, missing.
5. **[forms] Quiz mode (points/answer keys/grading)** — missing entirely.
6. **[sheets] Charts & pivot tables** — not rendered.
7. **[calendar] Sharing & multiple/subscribed calendars** — missing.
8. **[calendar] Guest invites + RSVP via email** — events don't actually invite anyone.
9. **[mail] Real send/receive backend** — UI-complete; delivery pending (Mailcow spec only, #53).
10. **[chat] Threads, reactions, @-mentions, DMs** — channels-only today.
11. **[projects] Cycles/sprints** — defining Linear feature, absent.
12. **[forms] Section branching ("go to section based on answer")** — unsupported.
13. **[photos] Photo editing (crop/adjust/filters)** — missing.
14. **[docs] Smart chips & building blocks** — missing.
15. **[forms] Response summary charts** — only a raw count today.
16. **[drive] Recent/Starred/Shared-with-me navigation** — "Recent" is disabled; others absent.
17. **[keep] Note collaborators (sharing)** — no shared notes.
18. **[projects] Sub-issues + roadmap/milestones** — hierarchy & planning missing.
19. **[meet] Recording + live captions** — missing.
20. **[mail] Rich-text/HTML compose** — plain-text-only compose.

### By app (PARTIAL = partly there, MISSING = absent)

**sheets** — formula engine (MISSING, #1) · charts/pivot/timeline (MISSING) · filters & filter views & slicers (MISSING) · conditional formatting & data validation/dropdown/checkbox (MISSING) · number-format application (PARTIAL) · named/protected ranges (MISSING).

**meet** — in-call chat (MISSING) · SFU (PARTIAL, mesh) · reactions/emoji (MISSING) · recording & captions/transcription (MISSING) · layout switching spotlight/sidebar/auto (PARTIAL) · breakout rooms/polls/Q&A (MISSING) · Calendar→Meet-link on event (PARTIAL).

**forms** — quiz mode (MISSING) · section branching (MISSING) · response summary charts (PARTIAL) · theming/header image (MISSING) · link-to-Sheet/pre-fill/embed HTML (MISSING) · file-upload & grid question types (PARTIAL).

**calendar** — event types Task/OOO/Focus/Working-location/Appointment (MISSING) · calendar sharing/permissions/secondary/subscribed (MISSING) · guest invite + RSVP delivery (PARTIAL) · Tasks panel (MISSING) · year/schedule/4-day views (PARTIAL).

**keep** — reminders (MISSING) · collaborators (MISSING) · drawing & image notes (MISSING/PARTIAL) · copy-to-Docs/version history (MISSING). _(Strong: checklists, 12 colors, labels, pin, archive.)_

**photos** — editing crop/rotate/adjust/filters (MISSING) · collage/animation/highlight video (MISSING) · sharing & partner sharing/shared albums (MISSING) · search/Explore people/places/things (MISSING). _(Base: albums, favorites, upload, trash.)_

**chat** — threaded replies (MISSING) · reactions (MISSING) · @-mentions (MISSING) · DMs 1:1/group (MISSING) · message editing (PARTIAL, delete exists). _(Base: channels, spaces, emoji, attachments.)_

**projects** _(Linear, from knowledge)_ — cycles/sprints (MISSING) · sub-issues/hierarchy (MISSING) · roadmap & milestones (MISSING) · saved/custom views (PARTIAL) · triage inbox & workflow-state config (MISSING). _(Strong base: issues, teams, projects, labels, priority, status, assignee, estimates, board, command palette.)_

**docs** — suggesting mode/tracked changes (PARTIAL) · smart chips & building blocks (MISSING) · doc tabs/bookmarks/outline (PARTIAL/MISSING) · publish-to-web/email-as-attachment (PARTIAL). _(Strong base: menubar, Yjs collab+presence, comments, version history, 8 download formats, templates, share.)_

**slides** — per-element animations (PARTIAL, transitions done) · theme builder/change theme/apply layout (PARTIAL/MISSING) · speaker spotlight webcam + audio/video embed (MISSING). _(Strong base: canvas, shapes, present mode, transitions, notes, Yjs collab, PPTX/PDF export.)_

**drive** — Recent (disabled)/Starred/Shared-with-me/Shared drives (PARTIAL/MISSING) · full search (PARTIAL) · storage quota display (MISSING). _(Strong base: list, folders, breadcrumb, context menus, share/revoke, copy/trash, previews.)_

**mail** — real send/receive backend (PARTIAL, #53) · rich-text/HTML compose (MISSING) · schedule send (PARTIAL/MISSING) · advanced inbox types (PARTIAL). _(Good: threads, labels, star, snooze, filters.)_

**groups** — email-list delivery / digest subscriptions (MISSING). _(Base: groups, members, topics, posts.)_

**sites** — publish flow & published rendering (PARTIAL) · rich content blocks embed/maps/Drive/collapsible + themes (PARTIAL).

**contacts** — delegation / "Other contacts" auto-collection (MISSING). _(Strong: labels, import/export, merge/dedup, vCard — near parity.)_

**books** — highlights/annotations/bookmarks sync (MISSING). _(Strong: EPUB/CBZ/TXT/PDF readers, TOC, upload.)_

> Theme across the suite: the editor apps have strong **menu-bar parity** and real
> collaboration; the gaps are deep functionality (formulas, charts, smart chips,
> animations). Several apps are UI-rich but **backend-thin** — Calendar events don't
> send invites, Mail composes but doesn't deliver, Groups post but don't email.

---

## 3. Admin console — Google Admin (admin.google.com) parity

grown's Admin app today = per-org service on/off toggles + a Zitadel-backed Users
console (search/create/deactivate/reset-password) + an audit-log viewer. Google
Admin does much more; the backend currently has **no real role concept** (see the
`TODO(admin)` in `internal/adminusers/handler.go:authorize` — it falls back to a
`GROWN_ADMIN_EMAILS` allowlist, else any member). Areas to build toward, to be
informed by the captured `docs/google-reference/` bundles:

- [ ] **Roles & RBAC** — define admin roles (super-admin, user-management, groups, services, help-desk) and assign them per user; replace the email-allowlist fallback. Map to Zitadel roles/grants where possible. _(prereq for most below)_
- [ ] **Org units (OUs)** — hierarchical grouping of users; apply settings/service-availability per OU (extends the existing per-org service toggles to per-OU).
- [ ] **Add user with secondary/recovery email + invite** — _(in progress)._
- [ ] **Bulk user ops** — CSV upload/provision, bulk suspend/delete/move-OU.
- [ ] **Groups administration** — create/manage groups, membership, access type (ties into the Groups app email-delivery gap).
- [ ] **Security policies** — enforce 2FA, password policy, session length, login challenges (Zitadel policy APIs).
- [ ] **Devices / sessions** — list & revoke active sessions; (mobile device mgmt out of scope).
- [ ] **Reports & audit** — sign-in/audit reports beyond the current raw log (the audit viewer is a base).
- [ ] **Domains & branding** — verified domains, org logo/accent (ties to the disabled "Customize branding" admin button).
- [ ] **App/service settings per OU** — extend service-settings to be OU-scoped + per-service config.

---

## 4. Exhaustive per-service feature checklist (vs docs/google-reference/)

Granular item-by-item audit of every grown app against its captured reference.
`[x]` implemented · `[~]` partial/stub · `[ ]` missing. Counts are directional.

### Per-app completion summary

| App                            | Impl | Partial | Missing |        % done |
| ------------------------------ | ---: | ------: | ------: | ------------: |
| Drive                          |   26 |       6 |      28 |          ~43% |
| Docs editor                    |   70 |      12 |      78 |          ~44% |
| Sheets editor                  |   48 |       8 |      84 |          ~34% |
| Slides editor                  |   40 |       6 |      64 |          ~36% |
| Forms editor                   |   30 |       5 |      22 |          ~53% |
| Gmail/Mail                     |   32 |       7 |      38 |          ~42% |
| Calendar                       |   22 |       5 |      28 |          ~40% |
| Contacts                       |   20 |       3 |      10 |          ~61% |
| Keep                           |   18 |       4 |       8 |          ~60% |
| Meet                           |   14 |       4 |      18 |          ~39% |
| Photos                         |   16 |       3 |      22 |          ~39% |
| Groups                         |   12 |       3 |      12 |          ~44% |
| Sites                          |   14 |       4 |      16 |          ~41% |
| Books                          |   18 |       4 |      14 |          ~50% |
| Tasks                          |    0 |       1 |      14 | ~0% (unbuilt) |
| Settings (Drive/Gmail/Account) |    4 |       6 |      40 |           ~8% |

### Highest-value missing items by app (from the granular audit)

- **Drive**: Sort-by menu; Trash/Starred/Recent/Shared-with-me views (RPCs exist, no UI); folder upload; storage meter; Drive settings dialog.
- **Docs**: Suggesting/track-changes; comment replies/threads; smart chips; building blocks; image upload (URL-only today); charts; columns; document tabs; publish-to-web.
- **Sheets**: paste-special; charts; pivot tables; conditional formatting; data validation; named/protected ranges; version history; filter views/slicers; data cleanup.
- **Slides**: find&replace; element animations; table/chart/video/audio insert; align/distribute; group/ungroup; themes/layouts; version history.
- **Forms**: file-upload/time/grid question types; sections + answer-branching; quiz mode; theme/header-image; publish/embed/prefill modal; link-to-Sheets.
- **Mail**: rich-text compose toolbar; schedule send; real external delivery (#53); full settings tabs; categories/multiple-inboxes; mark-important/filters-like-these.
- **Calendar**: Task/OOO/Focus/Appointment event types; reminders/notifications; Busy/Free + visibility; year/schedule/4-day views; calendar sharing/subscribe; mini-month nav.
- **Contacts**: address/birthday/website fields; bulk send-email; label rename/delete; Other-contacts/Directory views. (near-parity otherwise)
- **Keep**: reminders; collaborators; drawing/image notes; copy-to-Docs; version history; trash view; dark theme.
- **Meet**: in-call chat; reactions/raise-hand; participants roster; layout switch; breakouts; background blur; recording; device-settings pre-join.
- **Photos**: photo editor (crop/adjust/filters); collage/animation/highlight; sharing/partner; Explore/search; trash/archive.
- **Groups**: add/remove members UI; per-member subscription modes; email-to-group; group settings.
- **Sites**: template gallery; themes pane; richer content blocks (Drive/Maps/ToC/collapsible); version history; nav/header/footer config.
- **Books**: table-of-contents panel; highlights/annotations; text-selection popover; custom shelves; series/hidden views.
- **Tasks**: entirely unbuilt — no app/proto/CRUD (Calendar has only a disabled toggle).
- **Settings**: Drive settings dialog, full Gmail settings tabs, and Google-Account pages are almost entirely absent.

> Cross-cutting absent across editors: multi-account chooser, per-editor apps-switcher,
> Suggesting mode, publish-to-web. Intentionally out of scope for self-hosted: Gemini/AI,
> Apps Script/Add-ons marketplace, Approvals, Activity dashboard, offline pinning.
> Note: Meet's real WebRTC (camera/mic/screen-share/multi-party) exceeds the landing-only
> reference; Contacts & Keep are the most complete apps (~60%).

---

## 5. Org provisioning & cross-service admin (requested)

- [ ] **Per-org admin role (RBAC)** — replace the email-allowlist-only model; admins assignable in-app per org; first user in an org becomes its admin; only admins create orgs. _(in progress)_
- [ ] **Auto-provision a Forgejo org** when a grown org is created (Forgejo API `POST /orgs` with an admin token; name derived from org slug). Integration point: the org-create hook.
- [ ] **grown-org admin ⇒ Forgejo-org admin** — when a user is granted grown-org admin, add them as an owner/admin of the matching Forgejo org (Forgejo API team/membership). Needs a Forgejo admin token (reuse the `forgejo-registry`/a PAT) + grown-user→Forgejo-user mapping (by email/username).

## 6. Admin: org settings & branding (requested)

- [ ] **Edit org name** — Admin → Org settings page to rename the org (UpdateOrg backend; orgs.Repository has the row). Surfaces in the avatar dropdown org line.
- [ ] **Org branding** — logo + accent color per org (wire the disabled "Customize branding" button in admin/index.tsx; persist org branding fields; BrandProvider already exists in web/app/src/brand/Brand.tsx — load per-org branding at session start).

## 7. Personal users + per-object sharing (foundational, requested)

This shifts grown from strict org-isolation toward an ownership + ACL model.

- [ ] **Personal (non-org) users** — each personal user gets an auto-created personal org (sole member, no admin UI). New sign-ups default to a personal org unless invited into a team org. Onboarding flow decides org vs personal.
- [ ] **Per-object grant ACL** — `object_grants(object_type, object_id, grantee_user_id, role, granted_by, created_at)`. Generalizes Drive's invite-by-email + share links to all apps (docs/sheets/slides/files/etc.), granting _named logged-in users_ (directory picker), with roles (viewer/commenter/editor).
- [ ] **"Shared with me" per app** — every app's list/read query becomes "in my org OR granted to me"; add a Shared-with-me view. This is the cross-org visibility change (the hard part).
- [ ] **Share UI** — a unified share dialog (user picker + role) reused across apps, replacing/augmenting the link-only flow. Tie into the earlier "per-user roles on Drive/Docs/Sheets" request.
- [ ] **Notifications** — notify a user when an object is shared with them.

## 8. Multi-account sessions (Google /u/0, /u/1 style)

- [ ] grown is single-session today (one cookie); "Sign in with a different account" replaces the active account. Build **simultaneous multi-session**: store N session tokens (per logged-in account) + an active-account pointer; an account switcher in the avatar menu lists all logged-in accounts and switches without re-auth; "Add account" runs OIDC (prompt=select_account) and APPENDS a session. Optional `/u/N/` or `authuser` indexing. Auth middleware resolves the active session.

## 9. Auth & profile experience (requested)

- [ ] **In-app login UI** — authenticate at workspace.pick.haus with grown's OWN login form (username/password, MFA) instead of redirecting to Zitadel's hosted UI. Use Zitadel **Session API v2 / Login API** from the backend (reference: the ../agility project does this). Keep OIDC as fallback.
- [ ] **Multi-account in avatar dropdown** — surface the simultaneously-signed-in accounts (the ones Zitadel's account chooser shows) inside grown's avatar menu and switch between them in-app (ties to §8 multi-session). Today they exist at the Zitadel layer but grown only tracks one.
- [ ] **Profile avatar** — let a user upload/set their profile picture (store in blob storage; show in the avatar button + menu + across the app instead of the initial). Part of the user-profiles concept.

## 10. Admin: session & login audit (Google-Admin-style)

- [ ] **Capture login context** — record IP + user-agent (+ city/ASN best-effort) at session creation in the OIDC Callback; add columns to grown.sessions (ip, user_agent, last_seen_at) or a login_events table. The audit subsystem (internal/audit) + sessions table (internal/auth/session.go) are the base.
- [ ] **Admin → Sessions/Logins view** — list logins per user with timestamp, IP, agent, location, active/revoked; filter by user; show currently-active sessions. Extends the existing Admin audit viewer.
- [ ] **Remote session revoke** — let an admin (and the user themselves, in Security) sign out a specific session (sessions.Revoke already exists; wire UI + endpoint).
- [ ] Ties into the broader Admin-console expansion (org settings, branding, RBAC, audit) — see §3 admin-console parity.

## 11. Org mode + Users scoping + user profile (requested refinements)

- [ ] **Org mode = single-user vs multi-user** — org settings toggle. Single-user ⇒ HIDE the admin/Users page entirely (no admin concept). Multi-user ⇒ show Users.
- [ ] **Users list = org members only** — the Admin Users list must show only users who are members of THIS org (grown.users WHERE org_id, joined to Zitadel by oidc_subject), NOT a global Zitadel search. (Apply when integrating the admin-console work.)
- [ ] **User profile page** (under avatar) — set profile avatar + personal info (name, etc.). Part of auth/profile §9.
- [ ] **Profile ↔ Zitadel sync** — some profile fields (name, email, picture) should read from / write back to Zitadel's stored user info via the Zitadel User API (the adminusers handler already proxies it).

## 12. Twenty/CRM deploy — parked (needs compatible Postgres)

Twenty was deployed but crash-loops on two DB issues:

- [ ] CNPG `twenty-db-superuser` secret URI has dbname `*` (superuser isn't db-scoped) → `database "*" does not exist`. Point PG_DATABASE_URL at the `default` db (twenty-db-app uri) or build the URL with the right dbname.
- [ ] Twenty requires Postgres **extensions** (pg_graphql / wrappers) the vanilla CNPG image lacks → migrations fail even with the right db. Needs a Twenty-compatible Postgres image, or pre-created extensions via CNPG `postInitApplicationSQL` (uuid-ossp ok; pg_graphql is NOT in vanilla postgres).
- [ ] Dragonfly thread cap fixed (`--proactor_threads=2`); keep that.
- [ ] After it boots: add Cloudflare Published Application Route `crm.pick.haus` → public-gateway-istio:443 (Origin Server Name crm.pick.haus); configure the OIDC provider in Twenty Settings for Zitadel SSO.
      Disabled in the aggregator + namespace deleted until a focused effort provides the DB.

## 13. Auth/profile workstream — DECISIONS LOCKED (next, after org-scoping merges)

- **Multi-account switcher (avatar dropdown)**: switch IN-APP via Zitadel **Session API v2** (no redirect). grown lists the browser's Zitadel sessions (the /ui/v2/login/accounts set), shows each account in the avatar menu, and swaps the active grown session to the chosen Zitadel session. "Add account" = OIDC prompt=select_account, APPENDS not replaces. (Backend: a session-multiplexing layer; grown session ↔ Zitadel session id.)
- **Profile settings page (avatar → Profile)**: **Zitadel is the source of truth, two-way sync**. Avatar + name/email/info read from Zitadel; edits write back via the User API (the adminusers handler already proxies Zitadel v2). Avatar upload → set on the Zitadel user (or blob + Zitadel metadata if avatar upload isn't on the User API).
- Cannot run in parallel with the org-scoping build (both edit auth/whoami/server.go) — sequenced right after it.
