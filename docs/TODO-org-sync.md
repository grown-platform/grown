# TODO — Org Sync service (cross-org / cross-platform data transfer)

Status: **planned** (coming-soon tile shipped; backend not built).
Tile: `orgsync` ("Org Sync"), `/coming-soon/orgsync`. Icon `SyncAlt`, accent `#0CA678`.

## What it will do

A dedicated service to **transfer and sync data between organizations and platforms**, with
fine-grained control and no duplicates.

### Core capabilities

- **Library transfer**: copy Books, Music, Videos, Contacts (and other app data) from another
  grown org or an external platform into the current org.
- **Specific Drive folder transfers**: select exact Drive folders (and their nested contents)
  to bring over — not just whole apps.
- **Selective copy**: choose per item-type and per-folder what to include/exclude, with a
  preview of what will move before committing.
- **Duplicate-aware**: detect items that already exist in the destination (by checksum/title/
  external id) and skip them so nothing is copied twice.
- **Transfer-request approvals**: a transfer must be _requested_ and _approved by the source
  org's admin_ before any data leaves the source org (consent + audit trail).
- **Sync invites & connections**: invite another org/platform to connect; manage ongoing
  (optionally two-way) sync relationships, including pause/revoke.

## Design sketch (when built)

- New `internal/orgsync/` service: a transfer-job model (`org_sync_transfers`, `org_sync_items`,
  `org_sync_connections`/invites with approval state), reusing per-app repositories via injected
  interfaces (like cloudimport) to read source items + write destination items.
- Dedup keys per type (drive: blob checksum + path; books/music/videos: checksum or
  title+artist; contacts: email).
- Approval flow: source-admin approves a transfer request before the worker runs; notify via
  the notifications service + Resend email.
- Cross-platform: adapters (start with grown↔grown; later external platforms via their APIs).
- Frontend `web/app/src/pages/orgsync/`: connection list, new-transfer wizard (pick source →
  pick what to copy incl. specific Drive folders → preview/dedup report → request), and an
  approvals inbox.
- Migration: `org_sync_*` tables (next free number at build time).
