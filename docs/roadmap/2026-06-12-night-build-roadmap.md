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
- **Org Sync MVP.** Live `/orgsync` page: pick Drive files/folders + Contacts,
  enter a target org slug, review, transfer. Folders recurse (blob copy + new
  rows); caller must admin both orgs. `internal/orgsync/` (synchronous engine +
  `POST /api/v1/orgsync/transfer`). **Next:** add Music/Video, duplicate handling
  (skip/overwrite/merge), async jobs + progress for large transfers, and a
  target-org picker (currently slug entry).

## ✅ PDF editor — underline & strikethrough markup (shipped)
Added Underline + Strikethrough to `EditorPage.tsx` (drag a region → renders/
exports a horizontal line via pdf-lib). **Next (mapped):** eraser, line-end
styles, sticky-note comments, text box w/ border, watermark, redaction flatten,
page thumbnails sidebar.

## ✅ Multiplayer game framework + online Tic-Tac-Toe (shipped)
`internal/gamerooms`: a public, game-agnostic realtime relay — join a room by
code (shared via link) + optional password; the hub broadcasts JSON messages
and tracks presence. Account-free (WS bypasses the auth wall), capped, ephemeral.
Demo game: `/games/multiplayer-tictactoe.html` (create → share link → play).
**Reusable** for any multiplayer game: client generates a room code, connects to
`/api/v1/gamerooms/ws?room=&password=&name=`, and relays game-specific messages.

## ◻️ PBX backend (Asterisk) — foundation laid, disabled
gitops `clusters/homelab/telephony/` has WebRTC-capable Asterisk manifests +
baseline config (ws transport, webrtc endpoint template, demo dialplan, ARI, RTP
range), **intentionally not referenced by the homelab kustomization** so Flux
doesn't deploy it. See its `RUNBOOK.md`. **Remaining (needs the user's input +
testing):** real secrets, image pin, RTP networking (cloudflared can't carry
UDP — needs direct path or TURN), wss ingress, SIP trunk/DIDs, and the grown
**ARI bridge** (`internal/telephony`) to drive the softphone + admin console
from live Asterisk state. This is the one item that genuinely can't be finished
to a working phone system without trunk credentials + live testing.

## Also noted
- `docs_shares` lacks an `expires_at` column — add for parity with drive/video
  share expiry if doc link expiry is wanted.
