# Grown Workspace — Visual Service Documentation

Auto-generated visual documentation for every app and service in **grown-workspace**. Every screenshot below was **live-captured** with Playwright (Chromium) — none are mockups.

> Generated on 2026-06-13 from a local run of the full stack. Do not treat this directory as committed source; it is review output.

## Capture status (honest)

### Tier 1 — Static arcade games — FULLY CAPTURED
- **109 / 109 games** rendered and screenshot at desktop + mobile (218 PNGs).
- Served from `web/app/public` via a local threaded HTTP server on port **8099** (non-colliding).
- Includes the three native ports: **Bolo** (Orona), **Mighty Mike** (Power Pete), **Maelstrom** (SDL → WASM) — all rendered actual game frames.
- See **[games.md](games.md)** for the full gallery.

### Tier 2 — Full-stack apps — MOSTLY CAPTURED (29 / 31 routes; 2 blocked)
Brought up the whole stack with `process-compose` (postgres, Zitadel, RustFS, web-build, the Go backend serving the SPA + API at `http://workspace.localtest.me:8080`, plus Twenty CRM). Authenticated through **Zitadel SSO** (the in-app password login returns 503 in dev — see notes) as `admin@grown.localtest.me`, persisted the session, and screenshot every route.

**Rendered live & authenticated (29):** drive, mail, calendar, docs, sheets, slides, photos, chat, music, tasks, video, tickets, contacts, meet, whiteboard, forms, keep, projects, sites, books, live, groups, telephony, orgsync, cloudimport, vpn, access, settings, admin.

**Failed / blocked (2):**
- **pdf** — the PDF app's backend never started: `process-compose` runs `cd $PROJECT_ROOT/pdf/backend`, but that directory does not exist in this checkout (only `pdf/frontend`). So `pdf-backend` (:8085) and `pdf-frontend` (:5173) are both down, and the in-app `/pdf/` route rendered blank. No screenshot kept.
- **crm (Twenty)** — Twenty's container started cleanly ("Nest application successfully started"), but it uses Docker `--network host` to bind port **3000**, which was **already held by a pre-existing local `node` process** (an unrelated Bolo/Orona dev server). The CRM proxy at `crm.workspace.localtest.me:8080` therefore served that other app, not Twenty. Left the foreign process alone; no valid CRM screenshot kept.

### Stack bring-up notes
- `nix run .#dev` **fails standalone**: the dev app does `cd "${PROJECT_ROOT:-$PWD}"` but never exports `PROJECT_ROOT`/`PG*` (those are only set by the devshell `shellHook`). Run standalone, `$PROJECT_ROOT` is empty, so RustFS mounts `/data` (root) and dies with `Permission denied`, and Docker volumes get bogus `/deploy/...` paths. **Fix used:** run `process-compose` *inside* `nix develop` so the env is exported.
- In-app **password login → 503**: `PasswordLogin` requires a Zitadel service-token client (`GROWN_ZITADEL_SERVICE_TOKEN`), which is empty in the dev compose, so `h.zitadel == nil`. Demo login is disabled too. **SSO/OIDC is the only working login path** in this config.
- `/docs/` is shadowed by a static product site (`web/app/public/docs/index.html`) on direct load; the real Docs app was captured via in-SPA client-side navigation.

## Service index

| Service | Description | Page |
|---|---|---|
| **drive** | App launcher home + files (landing page after sign-in) | [drive.md](drive.md) |
| **mail** | Webmail — inbox, labels, embedded chat rail | [mail.md](mail.md) |
| **calendar** | Week/month calendar with multiple calendars & events | [calendar.md](calendar.md) |
| **docs** | Collaborative rich-text documents + templates | [docs.md](docs.md) |
| **sheets** | Collaborative spreadsheets + templates | [sheets.md](sheets.md) |
| **slides** | Presentation editor & deck library | [slides.md](slides.md) |
| **photos** | Photo library (object-storage backed) | [photos.md](photos.md) |
| **chat** | Real-time team chat — channels & DMs | [chat.md](chat.md) |
| **music** | Music library, player & radio | [music.md](music.md) |
| **tasks** | Personal task lists, integrated with Calendar | [tasks.md](tasks.md) |
| **video** | YouTube-style video product | [video.md](video.md) |
| **tickets** | Helpdesk ticketing (+ public submit portal) | [tickets.md](tickets.md) |
| **contacts** | Address book for people & orgs | [contacts.md](contacts.md) |
| **meet** | WebRTC video meetings lobby | [meet.md](meet.md) |
| **whiteboard** | Collaborative infinite canvas | [whiteboard.md](whiteboard.md) |
| **forms** | Survey / form builder | [forms.md](forms.md) |
| **keep** | Notes & checklists | [keep.md](keep.md) |
| **projects** | Project / issue tracking boards | [projects.md](projects.md) |
| **sites** | Website builder | [sites.md](sites.md) |
| **books** | E-book reading library | [books.md](books.md) |
| **live** | Live streaming (RTMP/HLS/WebRTC) | [live.md](live.md) |
| **groups** | Mailing lists & discussion groups | [groups.md](groups.md) |
| **telephony** | Cloud phone system / softphone | [telephony.md](telephony.md) |
| **orgsync** | Directory synchronization | [orgsync.md](orgsync.md) |
| **cloudimport** | Import files from external clouds | [cloudimport.md](cloudimport.md) |
| **vpn** | VPN / private network access | [vpn.md](vpn.md) |
| **access** | Access control & permissions | [access.md](access.md) |
| **settings** | Per-user workspace settings | [settings.md](settings.md) |
| **admin** | Org admin console (members, services, audit, security) | [admin.md](admin.md) |
| **games** | 109 static browser games (arcade/puzzle/card/board/word/casino/kids + 3 native ports) | [games.md](games.md) |
| **pdf** | PDF editor & e-sign (reverse-proxied) | _blocked — backend dir missing_ |
| **crm** | Twenty CRM (Host-proxied subdomain) | _blocked — port 3000 collision_ |

---

**Totals:** 109 games (×2 viewports) + 29 app routes (desktop) + 10 app mobile shots. Screenshots live under [`screenshots/`](screenshots/) (apps) and [`screenshots/games/`](screenshots/games/).
