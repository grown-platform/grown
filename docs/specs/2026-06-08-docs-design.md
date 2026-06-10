# Docs sub-project design

**Status:** Approved
**Date:** 2026-06-08
**Author:** Lucas Pick
**Parent spec:** `docs/specs/2026-06-08-grown-workspace-v1-design.md` (Phase 3)
**Sibling:** `docs/specs/2026-06-08-drive-design.md` (Drive owns blob storage; in-flight on PR #1 `mvp-drive`)

## Goals

Replace the Docs "Coming Soon" tile with a working **real-time collaborative** rich-text
editor. A user signs in, clicks Docs, sees their documents, opens one, and types; a second
browser on the same document sees edits live with remote cursors and presence. Documents are
persisted to Drive's blob storage (rustfs) as canonical snapshots.

## What Google Docs actually is (from the capture)

Analysis of `research/pass2/docs_editor/capture.har`:

- **Editor engine: "Kix"** (`docs.client_js_prod` + `KixCss`). Proprietary, **canvas-rendered** —
  it paints text to `<canvas>` and runs its own layout engine (hence `POST .../font/getmetadata`
  for font metrics). No `contenteditable`. No OSS equivalent exists.
- **Realtime: Operational Transformation (OT)** over **BrowserChannel** (pre-WebSocket streaming):
  `POST/GET /document/d/<id>/bind` (the persistent session), `.../save` (model mutations),
  `.../docos/p/sync` (comments), `.../test` / `.../tasks` / `.../uiready` (channel probe + Apps
  Script bootstrap).

A literal 1:1 rewrite of Kix (canvas layout engine + OT + streaming channel) is a multi-year
effort. We instead mirror Google's **architecture and protocol _shape_** while building on the
closest battle-tested OSS substrate. Canvas was rejected because it forces re-implementing text
layout, caret, selection, IME, spellcheck, find, copy/paste, and a parallel a11y DOM in JS — it
is only faster at extreme document scale, and no snappier (often slower) for MVP-scale docs.

## Non-goals (this sub-project)

- Canvas rendering / a bespoke layout engine (DOM/ProseMirror instead).
- Operational Transformation (we use CRDT — Yjs).
- Comments / suggestions / Apps Script (later).
- Pagination, page setup, print layout, export to `.docx` (HTML/PDF export only for MVP).
- Offline editing.

## Tech stack

| Concern            | Choice                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| Editor surface     | **TipTap** (ProseMirror), DOM/contenteditable, React                   |
| Realtime model     | **Yjs** (CRDT) via `y-prosemirror`                                     |
| Realtime transport | **WebSocket** (`y-protocols` sync + awareness), our own Go hub         |
| Presence/cursors   | Yjs **awareness** protocol                                             |
| Metadata           | Postgres (`grown` schema)                                              |
| Hot update log     | Postgres `grown.docs_updates` (BYTEA Yjs updates)                      |
| Canonical snapshot | rustfs blob (S3 API), later a Drive `drive_files` row                  |
| Blob client (Go)   | `aws-sdk-go-v2/service/s3` (matches Drive's `internal/drive/blobs.go`) |
| API                | gRPC + grpc-gateway REST at `/api/v1/docs/*`; WebSocket for collab     |
| Frontend           | React + TS + Vite + MUI Joy; new `web/app/src/pages/docs/` lazy chunk  |

## Architecture

```
Browser  /docs (lazy React route — mirrors Google's bundle organization)
  ├── DocList    — your documents
  └── DocEditor  — TipTap(ProseMirror) + Toolbar + Presence
        │  WebSocket  /api/v1/docs/d/{id}/connect   (faithful analog of Google's /bind)
        ▼
Backend (Go)
  ├── internal/docs/  service.go, repository.go, collab.go, snapshots.go, blobs.go
  ├── DocsService (gRPC) + grpc-gateway REST  /api/v1/docs/*
  └── WS hub per doc id: relay Yjs sync + awareness, append updates
        ▼
Postgres grown.docs_documents (metadata) + grown.docs_updates (Yjs update log)
rustfs (S3 :9100)  ← canonical .ydoc + HTML snapshot   (→ Drive drive_files later)
```

### Realtime collab

- One Yjs document per doc. Client binds TipTap ↔ Yjs with `y-prosemirror`.
- Go WebSocket hub keyed by doc id relays binary Yjs **sync** and **awareness** messages between
  connected clients, and appends each sync update to `grown.docs_updates`.
- On connect, the server replays the latest snapshot (from rustfs, when present) plus the tail of
  `docs_updates` so a joining client converges to current state.
- A debounced compaction merges the update log into a single Yjs state, writes the `.ydoc` blob +
  an exported HTML snapshot to rustfs, advances `snapshot_seq`, and truncates merged updates.

### Storage coupling to Drive

Drive (PR #1 `mvp-drive`) owns blob storage but its `internal/drive/` service is not yet written.
To avoid blocking, `internal/docs` writes snapshots directly to the **same rustfs bucket** Drive
uses (`grown-default`), under a `docs/{id}/...` key prefix, behind a small `blobPort` interface.
When `DriveService` lands, a snapshot becomes a `drive_files` row whose `storage_key` is that exact
key, and `docs_documents.drive_file_id` is populated — minimal rework. Re-check `origin/mvp-drive`
before final integration.

## Data model

```sql
-- 0006: Docs documents (metadata; content = Yjs updates + snapshot blob)
CREATE TABLE IF NOT EXISTS grown.docs_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    title         TEXT NOT NULL DEFAULT 'Untitled document',
    drive_key     TEXT,                 -- storage_key of canonical snapshot in rustfs
    drive_file_id UUID,                 -- set once Drive's DriveService owns the row
    snapshot_seq  BIGINT NOT NULL DEFAULT 0,
    trashed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS docs_documents_org_idx
  ON grown.docs_documents (org_id, owner_id) WHERE trashed_at IS NULL;

-- 0007: Hot Yjs update log (compacted into snapshots, then truncated)
CREATE TABLE IF NOT EXISTS grown.docs_updates (
    id          BIGSERIAL PRIMARY KEY,
    doc_id      UUID NOT NULL REFERENCES grown.docs_documents(id) ON DELETE CASCADE,
    update_blob BYTEA NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS docs_updates_doc_idx ON grown.docs_updates (doc_id, id);
```

## API surface (`proto/grown/v1/docs.proto`)

| RPC / channel | HTTP/WS                                   | Purpose                                            |
| ------------- | ----------------------------------------- | -------------------------------------------------- |
| `ListDocs`    | `GET /api/v1/docs`                        | Documents in the caller's org (non-trashed).       |
| `CreateDoc`   | `POST /api/v1/docs`                       | New empty doc → id.                                |
| `GetDoc`      | `GET /api/v1/docs/d/{id}`                 | Metadata.                                          |
| `RenameDoc`   | `PATCH /api/v1/docs/d/{id}`               | Title change.                                      |
| `TrashDoc`    | `DELETE /api/v1/docs/d/{id}`              | Soft delete (`trashed_at`).                        |
| `ExportDoc`   | `GET /api/v1/docs/d/{id}/export?fmt=html` | Snapshot export.                                   |
| **collab**    | `WS /api/v1/docs/d/{id}/connect`          | Yjs sync + awareness. Auth-gated; not via gateway. |

The WebSocket route is registered as a raw HTTP handler ahead of the grpc-gateway mux (gateway
cannot serve WS), wrapped by the same `auth.HTTPMiddleware` so `UserFromContext`/`OrgFromContext`
gate access.

## Frontend bundle layout

```
web/app/src/pages/docs/
  index.tsx     — lazy entry / route boundary
  DocList.tsx   — document list + "New document"
  DocEditor.tsx — TipTap surface + page chrome
  Toolbar.tsx   — bold/italic/headings/lists/links
  Presence.tsx  — remote cursors + avatar stack (awareness)
  collab.ts     — Yjs doc + WebSocket provider wiring
  api.ts        — typed REST wrappers (mirrors api/client.ts)
  types.ts      — TS types matching docs.proto
```

Catalog flip: `docs` tile `comingSoon: true → false`; route `/coming-soon/docs → /docs`. Loaded as
a code-split chunk so the dashboard doesn't ship editor/Yjs code until Docs is opened.

## Backend layout (`internal/docs/`)

```
internal/docs/
  service.go      — gRPC handlers (List/Create/Get/Rename/Trash/Export)
  repository.go   — pgx CRUD for docs_documents / docs_updates
  collab.go       — per-doc WebSocket hub: relay sync+awareness, append updates
  snapshots.go    — debounced compaction → rustfs blob via blobPort
  blobs.go        — S3 (aws-sdk-go-v2) client to rustfs; swap to DriveService later
  *_test.go       — TDD: repository, collab relay, snapshot round-trip
```

## Local run (process-compose) & nix

- **No new process** for Docs — it's WebSocket + REST on the existing `backend` Go process.
- rustfs is the only external dep; it comes from `mvp-drive`'s process-compose additions
  (`rustfs-pull` + `rustfs`, the upstream OCI image — rustfs is not in nixpkgs). If `mvp-drive`
  is not merged when we run, add the same blocks here and reconcile on merge.
- **Phase A** ships runnable with **no rustfs**: collab persists to Postgres (`docs_updates`) and
  reload restores from the log. **Phase B** adds rustfs snapshot compaction.
- nix: TipTap/Yjs are npm deps (handled by `web-build`); Go deps via go.mod. **No flake change.**

## Done criteria (Docs MVP)

1. Docs tile loads `/docs` and shows the document list (empty-state ok).
2. "New document" creates a doc and opens `/docs/d/{id}` in the TipTap editor.
3. Typing autosaves; reload restores content (update-log → state round-trip).
4. Two browsers on the same doc see each other's edits live, with remote cursors + presence.
5. Rename and trash work; `export?fmt=html` returns the document HTML.
6. (Phase B) snapshot blob lands in rustfs under `docs/{id}/...`.
7. Backend tests: `repository_test.go`, `collab_test.go`, `snapshots_test.go` (TDD).
8. E2E `web/e2e/docs.spec.ts`: sign in → /docs → new doc → type → second context sees the text.
9. v0.0.x tag (after Drive's tag).

## Open questions

| #   | Question                                                                              | Default if unanswered                                                                              |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Yjs WS transport: implement `y-websocket` server protocol in Go, or use a Go Yjs lib? | Implement the `y-protocols` sync+awareness framing directly in Go; treat updates as opaque binary. |
| 2   | One bucket per org (`grown-default`) with `docs/` prefix, or a dedicated docs bucket? | Reuse the org bucket with a `docs/{id}/` prefix (aligns with Drive).                               |
| 3   | Snapshot compaction trigger                                                           | Debounce: N seconds idle or M updates, whichever first.                                            |
| 4   | Max document size for MVP                                                             | Soft — not enforced in Phase A.                                                                    |
