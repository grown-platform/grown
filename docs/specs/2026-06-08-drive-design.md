# Drive sub-project design

**Status:** Draft
**Date:** 2026-06-08
**Author:** Lucas Pick
**Parent spec:** `docs/superpowers/specs/2026-06-08-grown-workspace-v1-design.md` (Phase 1)
**Builds on:** v0.0.3 (Foundation + Auth + Dashboard)

## Goals

Replace the Drive "Coming Soon" tile with a working file-storage app. Users sign in, click Drive, see their files in a folder tree, can upload/download/share/preview/trash files. Other Workspace apps (Docs, Sheets, Slides, Photos) will store their content as files in Drive — Drive is the foundation for the rest of the editor program.

## Non-goals (this sub-project)

- Real-time collaboration on file contents (that's per-editor).
- OCR / full-text search (later — separate spec).
- Versioning / file history (later).
- Mobile apps / desktop sync clients.
- CSE / client-side encryption (later — separate spec).
- WOPI endpoints for Office editor integration (deferred to the Editors sub-project, even though Drive owns the storage).

## Tech stack

| Concern            | Choice                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------- |
| Blob storage       | **rustfs** (S3-compatible, Apache 2.0, Rust) running as a process in our local stack    |
| Blob client (Go)   | `github.com/aws/aws-sdk-go-v2` with `s3` service client (rustfs is S3 API compatible)   |
| Metadata           | Postgres (existing instance) under the `grown` schema                                   |
| API                | Native gRPC + grpc-gateway REST at `/api/v1/drive/*`                                    |
| Frontend           | React + TypeScript + Vite + MUI Joy (existing app); new `web/app/src/pages/drive/` tree |
| PDF preview        | `pdfjs-dist` (Apache 2.0)                                                               |
| Video preview      | native `<video>` element (or `shaka-player` later if we need adaptive streaming)        |
| Image preview      | native `<img>` with browser-native zoom                                                 |
| File upload UX     | `react-dropzone` (MIT) for drag-and-drop                                                |
| Icons by extension | Material Symbols (already in the app) + extension → icon-name map                       |

## Architecture

### High-level

```
Browser
  └── /drive (React route)
       ├── FileList view (browse + upload + share)
       └── FileViewer view (preview by mime type)
                |
                | HTTP / grpc-gateway
                v
Backend (Go) /api/v1/drive/*
  ├── DriveService (gRPC)
  ├── internal/drive/
  │     ├── repository.go    (Postgres CRUD for files/folders/shares)
  │     ├── service.go       (gRPC handlers)
  │     ├── blobs.go         (S3-API blob put/get/delete via rustfs)
  │     └── acl.go           (sharing + permission checks)
  └── routes:
        /api/v1/drive/files                  list/create/move
        /api/v1/drive/files/{id}             get/update/delete
        /api/v1/drive/files/{id}/content     stream blob up/down
        /api/v1/drive/files/{id}/shares      list/create/revoke share links
        /api/v1/drive/share/{token}          public access to a shared file
        |
        v
rustfs (S3 API on :9100)        Postgres (existing :5533)
  └── one bucket per org           └── grown.drive_files
      (default: grown-default)         grown.drive_shares
                                       grown.drive_trash
```

### Data model

Three new tables under the existing `grown` schema. Migrations `0004` and `0005`.

```sql
-- 0004: Drive files + folders.

CREATE TABLE IF NOT EXISTS grown.drive_files (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    parent_id     UUID REFERENCES grown.drive_files(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    -- "folder" is a special mime type. Folders have NULL storage_key and size_bytes=0.
    -- Files have a key into the org's rustfs bucket.
    storage_key   TEXT,
    size_bytes    BIGINT NOT NULL DEFAULT 0,
    trashed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, parent_id, name)
);

CREATE INDEX IF NOT EXISTS drive_files_parent_idx
  ON grown.drive_files (org_id, parent_id) WHERE trashed_at IS NULL;
CREATE INDEX IF NOT EXISTS drive_files_owner_idx
  ON grown.drive_files (org_id, owner_id);
CREATE INDEX IF NOT EXISTS drive_files_trash_idx
  ON grown.drive_files (org_id, trashed_at) WHERE trashed_at IS NOT NULL;

-- 0005: Sharing.

CREATE TABLE IF NOT EXISTS grown.drive_shares (
    token         TEXT PRIMARY KEY,
    file_id       UUID NOT NULL REFERENCES grown.drive_files(id) ON DELETE CASCADE,
    role          TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor')),
    -- NULL audience = anyone with link. Future: per-user/per-group rows.
    audience      TEXT,
    created_by    UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS drive_shares_file_idx
  ON grown.drive_shares (file_id) WHERE revoked_at IS NULL;
```

### API surface

Proto definitions go in `proto/grown/v1/drive.proto`. RPCs:

| RPC             | HTTP                                                               | Purpose                                                                         |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `ListFiles`     | `GET /api/v1/drive/files?parent=...`                               | List files in a folder. Empty `parent` = org root. Pagination via `page_token`. |
| `GetFile`       | `GET /api/v1/drive/files/{id}`                                     | File metadata.                                                                  |
| `CreateFolder`  | `POST /api/v1/drive/files` (body: `{type:"folder", name, parent}`) | New folder.                                                                     |
| `UpdateFile`    | `PATCH /api/v1/drive/files/{id}`                                   | Rename, move (`parent_id`), restore from trash.                                 |
| `TrashFile`     | `DELETE /api/v1/drive/files/{id}`                                  | Soft delete (sets `trashed_at`).                                                |
| `DeleteForever` | `DELETE /api/v1/drive/files/{id}?permanent=true`                   | Hard delete + remove blob from rustfs.                                          |
| `UploadFile`    | `POST /api/v1/drive/files/{id}/content` (multipart)                | Replace blob; sets `mime_type`, `size_bytes`.                                   |
| `DownloadFile`  | `GET /api/v1/drive/files/{id}/content`                             | Stream blob (sets `Content-Type`, `Content-Disposition`).                       |
| `CreateShare`   | `POST /api/v1/drive/files/{id}/shares`                             | Issue share token.                                                              |
| `ListShares`    | `GET /api/v1/drive/files/{id}/shares`                              | Active shares for a file.                                                       |
| `RevokeShare`   | `DELETE /api/v1/drive/shares/{token}`                              | Revoke share.                                                                   |
| `OpenShare`     | `GET /api/v1/drive/share/{token}`                                  | Public: redirects to viewer with file metadata.                                 |

### Upload strategy

V1: client uploads via a single `POST /api/v1/drive/files/{id}/content` multipart request. The Go handler streams the body straight to rustfs `PutObject` (no buffering to disk; memory bounded). Maximum file size enforced at handler entry: **100 MB hardcoded for V1**, configurable via `GROWN_DRIVE_MAX_BYTES`.

V2 (out of scope here): multipart S3 uploads for >100 MB files. The S3 SDK supports it natively; we'd just need a `BeginUpload`/`PartUpload`/`CompleteUpload` RPC trio. Worth a follow-up task ID before MVP ships.

### Sharing model

Three roles map to permission checks in the API:

- `viewer` — can `GetFile`, `DownloadFile`. Cannot edit metadata or content.
- `commenter` — currently same as viewer (real comments are an editor concern, deferred).
- `editor` — full access except DeleteForever and share-management.

Share tokens are 32-byte random hex, identical to session tokens. Public access flows through the same `internal/auth` middleware; an anonymous-with-share request gets a synthetic `User` with role = share's role, no `OIDCSubject`.

### Frontend bundle organization

The captured `drive_fe` ships ~11 MB across three lazy chunks (`drive_fe_b`, `drive_fe_core`, `drive_fe_RsR2Mc`) with hashed module names. The pattern we mirror in our own code:

- `web/app/src/pages/drive/index.tsx` — top-level lazy entry. React.lazy boundary.
- `web/app/src/pages/drive/FileList.tsx` — the file/folder grid + sidebar.
- `web/app/src/pages/drive/FileViewer.tsx` — content preview for the open-file URL.
- `web/app/src/pages/drive/UploadZone.tsx` — drag-and-drop overlay using `react-dropzone`.
- `web/app/src/pages/drive/ShareDialog.tsx` — share-link modal.
- `web/app/src/pages/drive/api.ts` — typed fetch wrappers calling our REST endpoints. Mirrors `api/client.ts` shape.
- `web/app/src/pages/drive/types.ts` — hand-written TypeScript types matching the proto messages.

Loaded as a code-split chunk so the dashboard tile doesn't ship Drive code until clicked. The catalog's `comingSoon: true` flag flips to `false` for `drive` and the tile's `to=` prop changes from `/coming-soon/drive` to `/drive`.

### File viewer (apps-fileview equivalent)

Routes:

- `/drive` — file list (org root or `?folder=<id>`).
- `/drive/file/<id>` — viewer for a single file.

Viewer dispatches on mime type:

| MIME                         | Renderer                                                  | OSS lib                            |
| ---------------------------- | --------------------------------------------------------- | ---------------------------------- |
| `application/pdf`            | `<PdfPreview />` rendering each page via `pdfjs-dist`     | pdf.js                             |
| `image/*`                    | native `<img>` in a zoom/pan wrapper                      | (none)                             |
| `video/*`                    | native `<video controls>`                                 | (shaka-player follow-up if needed) |
| `audio/*`                    | native `<audio controls>`                                 | (none)                             |
| `text/*`, `application/json` | `<TextPreview />` with monospace + line numbers           | (none)                             |
| anything else                | `<UnsupportedPreview />` — shows mime + a Download button | (none)                             |

The viewer is a separate React-lazy boundary from `FileList`, so a user opening only a PDF doesn't load all of Drive's chrome until they navigate back.

## Done criteria for the Drive MVP

Drive ships when:

1. From the dashboard, clicking the Drive tile loads `/drive` and shows the org root with at least the "(empty)" empty-state.
2. Drag-and-drop upload puts a real file into rustfs, creates a `drive_files` row, and renders the new tile in the list.
3. Clicking a PDF/image/video file loads `/drive/file/<id>` and previews it.
4. Creating a folder, renaming it, dragging a file into it, and unrolling the path back to root all work.
5. Share dialog issues a token; opening `/drive/share/<token>` in a private browser session renders the file's viewer.
6. Trashing a file removes it from the list but it still exists in `drive_files` with `trashed_at` set; restoring works; permanent delete removes the blob from rustfs.
7. Backend unit tests: `internal/drive/repository_test.go`, `internal/drive/service_test.go` (TDD).
8. E2E `web/e2e/drive.spec.ts`: sign-in → /drive → upload a fixture PNG → see tile → click tile → see preview → trash → confirm gone.
9. v0.0.4 tag.

## Open questions

| #   | Question                                                                                      | Default if unanswered                                                                  |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Single rustfs bucket per org, or one shared bucket with `org_id/` prefix?                     | One bucket per org. Cleaner blast-radius, easy to back up per tenant.                  |
| 2   | Should we ship the rustfs binary via Nix (like Postgres / Zitadel) or fetch it at first boot? | Nix. Determinism.                                                                      |
| 3   | Max upload size for V1                                                                        | 100 MB. Configurable via env.                                                          |
| 4   | Public unauthenticated share URLs — accessible without login?                                 | Yes, via dedicated `share/{token}` route. The middleware sees the path and skips auth. |
| 5   | Folder size — should `drive_files.size_bytes` for folders be recursive total or 0?            | 0. Computed lazily in the API if needed.                                               |
| 6   | Anti-virus scanning on upload                                                                 | Out of scope V1. ClamAV integration is a follow-up.                                    |

## Estimated effort

~30 tasks across the implementation plan. Realistic compressed timeline with focused LLM-assisted execution: **1–2 days of wall-clock work** to a Done-criteria MVP, allowing for the TDD + two-stage review cadence we've established.

## Next step

Write the Drive implementation plan (`docs/superpowers/plans/2026-06-08-drive.md`) and execute it via subagent-driven-development.
