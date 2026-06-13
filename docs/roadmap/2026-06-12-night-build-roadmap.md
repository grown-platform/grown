# Night build — roadmap & status (2026-06-12)

Status of the large batch requested. **Shipped** items are deployed to
workspace.pick.haus; **TODO** items are multi-day builds captured here with their
architecture so they start ahead.

## ✅ Shipped tonight
- **Expiring share links (Drive).** Optional expiry (never/1h/1d/7d/30d) on link
  creation; backend already enforced `expires_at` on lookup; list filters expired;
  details panel shows each link's expiry.
- **Per-user API tokens with scopes.** `grw_…` bearer tokens, scope grammar
  (`*` / `<service>` / `<service>:read`), enforced in the auth middleware; managed
  under Settings → API tokens. `internal/apitokens/`.
- **Cloud Import tests.** Suite green; minimal `.ics` / `.vcf` / Takeout-zip
  packages provided for interactive UI testing. (Gaps: mail import is counted but
  skipped in v1; photos route to Immich.)

## TODO — Org Sync (cross-org data transfer)
Transfer Drive files / Contacts / Music / Video between orgs with a review &
select UI. Architecture (no `buf` — REST + side tables):
- **Migration `008x_orgsync.sql`:** `grown.orgsync_requests` (source/target org,
  status, scope JSON) + `grown.orgsync_jobs` (one row/item: type, source_id,
  target_id, status).
- **`internal/orgsync/`:** `requests_repo.go`, `jobs_repo.go`, `service.go` (the
  transfer engine), `handler.go` (REST).
- **Copy primitives (all exist, org-scoped by `org_id`):**
  - Drive: `drive.Repository.Get/CreateFile/CreateFolder` + `Blobs.Get/Put`
    (stream src blob → new key → new row in target org; recurse folders).
  - Contacts: `contacts.Repository.Get/Create` (Fields struct copy).
  - Music: `music.Repository.ListTracks/CreateTrack` + blob copy.
  - Video: `video.Repository` + blob copy.
- **Endpoints:** `POST /api/v1/orgsync/transfer` (selected items + target),
  `GET /api/v1/orgsync/requests`, `POST …/{id}/approve`.
- **Multi-org caveat:** each user has exactly one `org_id`; multi-account
  switching exists (`internal/multiaccounts`). Transfer is initiated/approved by a
  source-org admin; target receives. Duplicate handling = skip/overwrite/merge.
- **Frontend:** `web/app/src/pages/orgsync/` + flip `orgsync.comingSoon=false` in
  `web/app/src/catalog/apps.ts`. Browse source items with checkboxes → review →
  transfer → progress from `orgsync_jobs`.

## TODO — Self-hosted PBX backend (Asterisk)
Biggest item (infra, multi-day). Behind the existing Telephony admin console
(front-end scaffold today). Plan: deploy Asterisk (PJSIP) in-cluster via gitops,
a WebRTC↔SIP gateway for the browser softphone, dialplan + extensions sourced
from Contacts/org, and a Go bridge mapping the admin console + softphone WS to
Asterisk ARI/AMI. Optional deployment (flag-gated). Not started.

## TODO — PDF editor: Acrobat-style toolbar
Main editor: `pdf/frontend/src/features/editor/pages/EditorPage.tsx` (react-pdf +
pdf-lib). Current tools: select/text/draw/highlight/rect/ellipse/line/arrow/
whiteout/image. Add (pattern: tool type → button → mouse handlers → SVG render →
pdf-lib export):
- Tier 1: eraser, text underline/strikethrough, line-end styles.
- Tier 2: sticky-note comments, text box w/ border, pressure-ish freehand.
- Tier 3: watermark, redaction flatten, page thumbnails sidebar, cloud/callout.
The annotate path also uses tibui `<PDFEditor>` (`features/documents/EditDocumentPage.tsx`)
whose `tools` prop can be extended.

## TODO — Multiplayer game framework (coffeetable pattern)
Reuse the lightweight realtime architecture from `coffeetable` for a multiplayer
game with a **join-by-share-link** (room code) and **optional password**. Pattern:
a signaling/state WS hub keyed by room code (cf. `internal/meet/hub.go`,
`internal/telephony` hubs), a room table (code + optional password hash + expiry),
a `/games/<game>?room=<code>` join link, and a thin game client. Generalize so the
same room+join+password layer serves multiple multiplayer games. The coffeetable
env "didn't fully work" — salvage its transport/state-sync layer, not its game.

## Also noted
- `docs_shares` lacks an `expires_at` column — add for parity with drive/video
  share expiry if doc link expiry is wanted.
