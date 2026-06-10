# grown-workspace Drive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the Drive app at `/drive` — upload/list/folders/share/preview/trash backed by rustfs + Postgres. Replaces the "Coming Soon" tile.

**Architecture:** rustfs (S3-compatible, Apache 2.0) for blobs running as a process-compose process. Postgres `grown.drive_files` / `grown.drive_shares` for metadata. New `internal/drive/` Go package implementing `DriveService` gRPC. New `web/app/src/pages/drive/` React route as a lazy-loaded chunk. Auth via existing session middleware; share-link tokens are an additional anonymous auth path.

**Tech Stack:** Go 1.25, gRPC + grpc-gateway, pgx/v5, `aws-sdk-go-v2/service/s3` (talking to rustfs), React 18, TypeScript, MUI Joy, `react-dropzone`, `pdfjs-dist`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-08-drive-design.md`
**Builds on:** v0.0.3 (Foundation + Auth + Dashboard).

**Working directory:** `/home/lucas/workspace/grown/grown-workspace/`

---

## File structure

### New backend files

- `internal/storage/migrations/0004_drive_files.sql`
- `internal/storage/migrations/0005_drive_shares.sql`
- `proto/grown/v1/drive.proto`
- `internal/drive/repository.go` + `repository_test.go` + `MODULE.md`
- `internal/drive/blobs.go` + `blobs_test.go`
- `internal/drive/acl.go` + `acl_test.go`
- `internal/drive/service.go`
- `deploy/rustfs/init-bucket.sh`

### Modified backend files

- `flake.nix` (rustfs binary)
- `deploy/process-compose/process-compose.yaml` (rustfs + init-bucket processes; backend deps)
- `internal/server/server.go` (register DriveService, share-token middleware)
- `cmd/server/main.go` (rustfs DSN, blob client init)

### New frontend files

- `web/app/src/pages/drive/types.ts`
- `web/app/src/pages/drive/api.ts`
- `web/app/src/pages/drive/FileList.tsx`
- `web/app/src/pages/drive/UploadZone.tsx`
- `web/app/src/pages/drive/ShareDialog.tsx`
- `web/app/src/pages/drive/FileViewer.tsx`
- `web/app/src/pages/drive/PdfPreview.tsx`
- `web/app/src/pages/drive/index.tsx` (React.lazy entry)

### Modified frontend files

- `web/app/package.json` (`react-dropzone`, `pdfjs-dist`)
- `web/app/src/App.tsx` (lazy-load `/drive` and `/drive/file/:id`)
- `web/app/src/catalog/apps.ts` (flip `drive` to `comingSoon: false`, `to: "/drive"`)
- `web/app/src/pages/ComingSoon.tsx` (route swap handled at App.tsx level — no change here)

### New e2e

- `web/e2e/drive.spec.ts`

---

## Task 1: Add rustfs container to process-compose

**Files:**

- Modify: `deploy/process-compose/process-compose.yaml`
- Modify: `.gitignore` (if needed — exclude `deploy/process-compose/data/rustfs/`)

**Why a container, not a Nix binary:** rustfs is not in nixpkgs. Rather than maintain a fetchurl/build derivation per-arch, we pull the upstream OCI image `rustfs/rustfs:1.0.0-beta.7` (multi-arch: amd64 + arm64) and run it as a process under process-compose using the host's docker daemon. The dev shell already has docker available.

Init-bucket bootstrap is a separate process — see Task 2.

- [ ] **Step 1: Probe the rustfs image's actual env-var / CLI surface**

Before writing the YAML, inspect the image's CMD and supported env-vars (the beta cadence may have renamed things since this plan was written):

```bash
docker pull rustfs/rustfs:1.0.0-beta.7
docker run --rm rustfs/rustfs:1.0.0-beta.7 --help 2>&1 | head -60
docker inspect rustfs/rustfs:1.0.0-beta.7 --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}} {{json .Config.Env}}'
```

Confirm the names of the env-vars / flags for: bind address, console enable + address, root user, root password, data dir. The defaults in Step 2 (RUSTFS_ROOT_USER / RUSTFS_ROOT_PASSWORD / RUSTFS_VOLUMES / RUSTFS_ADDRESS / RUSTFS_CONSOLE_ADDRESS) are starting guesses — adjust to match. Keep the semantics: API on `127.0.0.1:9100`, console on `127.0.0.1:9101`, data persisted to `deploy/process-compose/data/rustfs/`, credentials `grown` / `DevPassword!1`.

- [ ] **Step 2: Add rustfs as a containerized process**

Edit `deploy/process-compose/process-compose.yaml`. Add these processes after `zitadel-create-app` (and before `web-build` / `backend`). Adjust env-var names per Step 1 findings.

```yaml
rustfs-pull:
  command: docker pull rustfs/rustfs:1.0.0-beta.7
  availability:
    restart: "no"

rustfs:
  command: |
    mkdir -p "$PROJECT_ROOT/deploy/process-compose/data/rustfs"
    exec docker run --rm \
      --name grown-rustfs-dev \
      --network host \
      -e RUSTFS_ROOT_USER=grown \
      -e RUSTFS_ROOT_PASSWORD=DevPassword!1 \
      -e RUSTFS_VOLUMES=/data \
      -e RUSTFS_ADDRESS=:9100 \
      -e RUSTFS_CONSOLE_ENABLE=true \
      -e RUSTFS_CONSOLE_ADDRESS=:9101 \
      -v "$PROJECT_ROOT/deploy/process-compose/data/rustfs:/data" \
      rustfs/rustfs:1.0.0-beta.7
  depends_on:
    rustfs-pull:
      condition: process_completed_successfully
  shutdown:
    command: "docker stop -t 5 grown-rustfs-dev >/dev/null 2>&1 || true"
  readiness_probe:
    http_get:
      host: 127.0.0.1
      port: 9100
      path: /minio/health/live
    initial_delay_seconds: 3
    period_seconds: 2
    timeout_seconds: 5
    success_threshold: 1
    failure_threshold: 60
  availability:
    restart: on_failure
```

Choices baked in here:

- `rustfs-pull` is split out so the first-boot ~30s image pull has its own log line instead of stalling the `rustfs` process silently.
- `--network host` so `127.0.0.1:9100` works identically from host and container. Simpler than per-port `-p` bindings, and lines up with how the rest of our dev stack (postgres on 5533, zitadel on 8081) shares localhost.
- `--rm` + explicit `shutdown.command` so a clean process-compose stop leaves no zombie container. The `docker stop` is best-effort (`|| true`).
- Pinned to `1.0.0-beta.7` (not `:latest`). Tag bumps go in their own commits.
- Readiness probe uses `/minio/health/live` — rustfs is API-compatible with MinIO's health endpoint. If the probe never goes green, fall back to a `tcp` probe on `127.0.0.1:9100`.

Update `backend.depends_on` to add `rustfs-init: process_completed_successfully` (the bucket bootstrap is Task 2).

- [ ] **Step 3: Make sure rustfs data dir is gitignored**

Check current `.gitignore`. If `deploy/process-compose/data/` is not already covered (it should be — postgres data lives there too), add:

```
deploy/process-compose/data/
```

- [ ] **Step 4: Verify docker is reachable from the dev shell**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  docker version --format "{{.Server.Version}}" 2>&1 | head -3
'
```

Expected: prints a server version (the host has docker 29.4.2). If `Cannot connect to the Docker daemon` or `command not found`, report BLOCKED — the user needs to ensure docker is reachable.

- [ ] **Step 5: Verify the image runs and exposes the S3 API**

```bash
cd /home/lucas/workspace/grown/grown-workspace
docker rm -f grown-rustfs-probe 2>/dev/null || true
mkdir -p /tmp/grown-rustfs-probe
docker run -d --rm --name grown-rustfs-probe --network host \
  -e RUSTFS_ROOT_USER=grown -e RUSTFS_ROOT_PASSWORD=DevPassword!1 \
  -e RUSTFS_VOLUMES=/data -e RUSTFS_ADDRESS=:9100 \
  -v /tmp/grown-rustfs-probe:/data \
  rustfs/rustfs:1.0.0-beta.7
for i in $(seq 1 30); do
  if curl -fs http://127.0.0.1:9100/minio/health/live >/dev/null 2>&1; then echo "READY"; break; fi
  sleep 1
done
curl -sS -o /dev/null -w "minio-health=%{http_code}\n" http://127.0.0.1:9100/minio/health/live
docker stop -t 3 grown-rustfs-probe >/dev/null 2>&1 || true
rm -rf /tmp/grown-rustfs-probe
```

Expected: `READY` then `minio-health=200`. If the probe path doesn't return 200, adjust the readiness_probe path in Step 2 to whatever rustfs exposes (try `/` or `/health`).

- [ ] **Step 6: Commit**

```bash
git add deploy/process-compose/process-compose.yaml .gitignore
PREK_ALLOW_NO_CONFIG=1 git commit -m "build(dev): run rustfs as containerized dependency under process-compose"
```

---

## Task 2: rustfs init-bucket script

**Files:**

- Create: `deploy/rustfs/init-bucket.sh`

- [ ] **Step 1: Write the script**

Path: `deploy/rustfs/init-bucket.sh`

```bash
#!/usr/bin/env bash
# Creates the grown-default bucket inside rustfs on first boot.
# Uses the AWS CLI (since rustfs speaks S3).
set -euo pipefail

ENDPOINT="${RUSTFS_ENDPOINT:-http://127.0.0.1:9100}"
ACCESS="${RUSTFS_ACCESS_KEY:-grown}"
SECRET="${RUSTFS_SECRET_KEY:-DevPassword!1}"
BUCKET="${RUSTFS_BUCKET:-grown-default}"

export AWS_ACCESS_KEY_ID="$ACCESS"
export AWS_SECRET_ACCESS_KEY="$SECRET"
export AWS_DEFAULT_REGION="us-east-1"

# Check if bucket exists. AWS CLI exits non-zero on missing bucket.
if aws --endpoint-url "$ENDPOINT" s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "bucket $BUCKET exists, skipping create"
  exit 0
fi

aws --endpoint-url "$ENDPOINT" s3api create-bucket --bucket "$BUCKET" >/dev/null
echo "bucket $BUCKET created"
```

`chmod +x` it.

- [ ] **Step 2: Add `pkgs.awscli2` to flake's devshell + apps.dev.runtimeInputs**

(Needed for the script. If `awscli2` doesn't resolve, try `awscli`.)

- [ ] **Step 3: Verify by booting the stack briefly**

```bash
cd /home/lucas/workspace/grown/grown-workspace
pgrep -fa 'process-compose.*grown-workspace' | head -1 | awk '{print $1}' | xargs -r kill 2>/dev/null
sleep 3
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  process-compose up --use-uds --tui=false -f deploy/process-compose/process-compose.yaml > /tmp/pc_drive.log 2>&1 &
  SC=$!
  for i in $(seq 1 90); do
    if curl -fs http://127.0.0.1:9100/minio/health/live >/dev/null 2>&1; then break; fi
    sleep 1
  done
  echo "--- rustfs bucket list ---"
  AWS_ACCESS_KEY_ID=grown AWS_SECRET_ACCESS_KEY=DevPassword!1 AWS_DEFAULT_REGION=us-east-1 \
    aws --endpoint-url http://127.0.0.1:9100 s3 ls
  kill $SC; wait $SC 2>/dev/null || true
'
```

Expected: lists `grown-default`.

- [ ] **Step 4: Commit**

```bash
chmod +x deploy/rustfs/init-bucket.sh
git add deploy/rustfs/init-bucket.sh flake.nix
git commit -m "build(rustfs): bootstrap grown-default bucket on first boot"
```

---

## Task 3: drive.proto definitions

**Files:**

- Create: `proto/grown/v1/drive.proto`

- [ ] **Step 1: Write the proto**

Path: `proto/grown/v1/drive.proto`

```proto
syntax = "proto3";

package grown.v1;

import "google/api/annotations.proto";

option go_package = "code.pick.haus/grown/grown/gen/go/grown/v1;grownv1";

// DriveService provides file storage with folders, sharing, and previews.
service DriveService {
  rpc ListFiles(ListFilesRequest) returns (ListFilesResponse) {
    option (google.api.http) = { get: "/api/v1/drive/files" };
  }
  rpc GetFile(GetFileRequest) returns (File) {
    option (google.api.http) = { get: "/api/v1/drive/files/{id}" };
  }
  rpc CreateFolder(CreateFolderRequest) returns (File) {
    option (google.api.http) = {
      post: "/api/v1/drive/folders"
      body: "*"
    };
  }
  rpc UpdateFile(UpdateFileRequest) returns (File) {
    option (google.api.http) = {
      patch: "/api/v1/drive/files/{id}"
      body: "*"
    };
  }
  rpc TrashFile(TrashFileRequest) returns (TrashFileResponse) {
    option (google.api.http) = { delete: "/api/v1/drive/files/{id}" };
  }
  rpc DeleteForever(DeleteForeverRequest) returns (DeleteForeverResponse) {
    option (google.api.http) = { delete: "/api/v1/drive/files/{id}:forever" };
  }
  rpc CreateShare(CreateShareRequest) returns (Share) {
    option (google.api.http) = {
      post: "/api/v1/drive/files/{file_id}/shares"
      body: "*"
    };
  }
  rpc ListShares(ListSharesRequest) returns (ListSharesResponse) {
    option (google.api.http) = { get: "/api/v1/drive/files/{file_id}/shares" };
  }
  rpc RevokeShare(RevokeShareRequest) returns (RevokeShareResponse) {
    option (google.api.http) = { delete: "/api/v1/drive/shares/{token}" };
  }
}

// File represents a folder or a stored file.
message File {
  string id = 1;
  string org_id = 2;
  string owner_id = 3;
  string parent_id = 4;
  string name = 5;
  string mime_type = 6;
  int64 size_bytes = 7;
  bool trashed = 8;
  int64 created_at = 9;
  int64 updated_at = 10;
}

message Share {
  string token = 1;
  string file_id = 2;
  string role = 3; // viewer, commenter, editor
  string created_by = 4;
  int64 created_at = 5;
  int64 expires_at = 6; // 0 means never
}

message ListFilesRequest {
  string parent = 1;
  bool include_trashed = 2;
  int32 page_size = 3;
  string page_token = 4;
}
message ListFilesResponse {
  repeated File files = 1;
  string next_page_token = 2;
}

message GetFileRequest { string id = 1; }

message CreateFolderRequest {
  string name = 1;
  string parent = 2;
}

message UpdateFileRequest {
  string id = 1;
  string name = 2;
  string parent = 3;
  bool restore_from_trash = 4;
}

message TrashFileRequest { string id = 1; }
message TrashFileResponse {}

message DeleteForeverRequest { string id = 1; }
message DeleteForeverResponse {}

message CreateShareRequest {
  string file_id = 1;
  string role = 2;
  int64 expires_at = 3;
}

message ListSharesRequest { string file_id = 1; }
message ListSharesResponse { repeated Share shares = 1; }

message RevokeShareRequest { string token = 1; }
message RevokeShareResponse {}
```

(Note: `UploadFile` and `DownloadFile` are NOT in the proto — they're streaming binary, served by raw HTTP handlers registered alongside the gateway. Task 13 wires those.)

- [ ] **Step 2: Generate + verify**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c 'buf lint && buf generate && go build ./gen/...'
```

- [ ] **Step 3: Commit**

```bash
git add proto/grown/v1/drive.proto
git commit -m "feat(proto): define DriveService"
```

---

## Task 4: Migration 0004 — `drive_files`

**Files:**

- Create: `internal/storage/migrations/0004_drive_files.sql`

- [ ] **Step 1: Write the migration**

Path: `internal/storage/migrations/0004_drive_files.sql`

```sql
-- 0004: Drive files + folders.

CREATE TABLE IF NOT EXISTS grown.drive_files (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    parent_id     UUID REFERENCES grown.drive_files(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
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
```

- [ ] **Step 2: Verify against temp Postgres**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  TMP=$(mktemp -d); export PGDATA=$TMP/pg
  initdb --auth=trust -U postgres -D "$PGDATA" >/dev/null
  pg_ctl -D "$PGDATA" -o "-h 127.0.0.1 -p 25432 -k $TMP" -l "$TMP/log" start
  for i in $(seq 1 20); do pg_isready -h 127.0.0.1 -p 25432 -q && break; sleep 0.5; done
  createdb -h 127.0.0.1 -p 25432 -U postgres grown_test
  export GROWN_TEST_DSN="postgres://postgres@127.0.0.1:25432/grown_test?sslmode=disable"
  go test ./internal/storage/... -v
  psql -h 127.0.0.1 -p 25432 -U postgres -d grown_test -c "\\dt grown.*"
  pg_ctl -D "$PGDATA" stop -m immediate
  rm -rf "$TMP"
'
```

Expected: passes, `\dt` shows `drive_files`.

- [ ] **Step 3: Commit**

```bash
git add internal/storage/migrations/0004_drive_files.sql
git commit -m "feat(storage): migration 0004 — drive_files table"
```

---

## Task 5: Migration 0005 — `drive_shares`

**Files:**

- Create: `internal/storage/migrations/0005_drive_shares.sql`

- [ ] **Step 1: Write the migration**

Path: `internal/storage/migrations/0005_drive_shares.sql`

```sql
-- 0005: Drive shares.

CREATE TABLE IF NOT EXISTS grown.drive_shares (
    token         TEXT PRIMARY KEY,
    file_id       UUID NOT NULL REFERENCES grown.drive_files(id) ON DELETE CASCADE,
    role          TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor')),
    audience      TEXT,
    created_by    UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS drive_shares_file_idx
  ON grown.drive_shares (file_id) WHERE revoked_at IS NULL;
```

- [ ] **Step 2: Verify + commit** (same pattern as Task 4)

```bash
git add internal/storage/migrations/0005_drive_shares.sql
git commit -m "feat(storage): migration 0005 — drive_shares table"
```

---

## Task 6: `internal/drive/repository.go` (TDD)

**Files:**

- Create: `internal/drive/repository.go`
- Create: `internal/drive/repository_test.go`
- Create: `internal/drive/MODULE.md`

- [ ] **Step 1: Write tests first**

Path: `internal/drive/repository_test.go`

```go
package drive

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"code.pick.haus/grown/grown/internal/storage"
)

func setupDB(t *testing.T) (*pgxpool.Pool, string, string) {
	t.Helper()
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS grown CASCADE"); err != nil {
		t.Fatalf("drop: %v", err)
	}
	if err := storage.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	var orgID, userID string
	pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&orgID)
	pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, 'x', 'y', 'z@x', 'Z') RETURNING id::text`,
		orgID,
	).Scan(&userID)
	return pool, orgID, userID
}

func TestRepository_CreateFolder_AndList(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	root, err := r.CreateFolder(ctx, orgID, userID, "", "Projects")
	if err != nil {
		t.Fatalf("create root folder: %v", err)
	}
	if root.Name != "Projects" || root.MimeType != FolderMimeType {
		t.Errorf("unexpected root: %+v", root)
	}

	files, _, err := r.ListChildren(ctx, orgID, "", false, 100, "")
	if err != nil {
		t.Fatalf("list root: %v", err)
	}
	if len(files) != 1 || files[0].ID != root.ID {
		t.Errorf("expected just the new folder, got %+v", files)
	}
}

func TestRepository_CreateFile_AndUpdate(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	f, err := r.CreateFile(ctx, orgID, userID, "", "hello.txt", "text/plain", "blobs/abc", 11)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if f.SizeBytes != 11 || f.StorageKey == nil || *f.StorageKey != "blobs/abc" {
		t.Errorf("unexpected: %+v", f)
	}

	renamed, err := r.UpdateNameOrParent(ctx, orgID, f.ID, "renamed.txt", nil)
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.Name != "renamed.txt" {
		t.Errorf("rename failed: %+v", renamed)
	}
}

func TestRepository_TrashAndDeleteForever(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	f, _ := r.CreateFile(ctx, orgID, userID, "", "ephemeral.txt", "text/plain", "blobs/eph", 4)

	if err := r.Trash(ctx, orgID, f.ID); err != nil {
		t.Fatalf("trash: %v", err)
	}

	// Trashed file no longer in default list.
	files, _, _ := r.ListChildren(ctx, orgID, "", false, 100, "")
	if len(files) != 0 {
		t.Errorf("trashed file still listed: %+v", files)
	}

	// But appears when include_trashed=true.
	files, _, _ = r.ListChildren(ctx, orgID, "", true, 100, "")
	if len(files) != 1 {
		t.Errorf("expected 1 trashed: %+v", files)
	}

	key, err := r.DeleteForever(ctx, orgID, f.ID)
	if err != nil {
		t.Fatalf("delete forever: %v", err)
	}
	if key != "blobs/eph" {
		t.Errorf("returned key: %q want blobs/eph", key)
	}
}
```

- [ ] **Step 2: Run, verify it fails (undefined: NewRepository, etc.)**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go test ./internal/drive/...
```

Expected: build failure.

- [ ] **Step 3: Implement `repository.go`**

Path: `internal/drive/repository.go`

```go
// Package drive provides file storage, sharing, and previews. The blob
// layer talks to a rustfs (S3-compatible) backend; the metadata layer is
// Postgres-backed.
package drive

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FolderMimeType is the special mime type stored on folder rows.
const FolderMimeType = "application/vnd.grown.folder"

// ErrNotFound is returned when no row matches.
var ErrNotFound = errors.New("file not found")

// File mirrors a grown.drive_files row.
type File struct {
	ID         string
	OrgID      string
	OwnerID    string
	ParentID   *string
	Name       string
	MimeType   string
	StorageKey *string
	SizeBytes  int64
	TrashedAt  *time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// Repository is the Postgres-backed metadata layer for Drive.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// CreateFolder inserts a new folder row. Empty parent = org root.
func (r *Repository) CreateFolder(ctx context.Context, orgID, ownerID, parent, name string) (File, error) {
	return r.insert(ctx, orgID, ownerID, parent, name, FolderMimeType, nil, 0)
}

// CreateFile inserts a new file row pointing at an existing blob.
func (r *Repository) CreateFile(ctx context.Context, orgID, ownerID, parent, name, mimeType, storageKey string, size int64) (File, error) {
	k := storageKey
	return r.insert(ctx, orgID, ownerID, parent, name, mimeType, &k, size)
}

func (r *Repository) insert(ctx context.Context, orgID, ownerID, parent, name, mime string, key *string, size int64) (File, error) {
	var parentArg interface{}
	if parent == "" {
		parentArg = nil
	} else {
		parentArg = parent
	}
	var f File
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.drive_files
		   (org_id, owner_id, parent_id, name, mime_type, storage_key, size_bytes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id::text, org_id::text, owner_id::text, parent_id::text, name, mime_type, storage_key, size_bytes, trashed_at, created_at, updated_at`,
		orgID, ownerID, parentArg, name, mime, key, size,
	).Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		return File{}, fmt.Errorf("drive.insert: %w", err)
	}
	return f, nil
}

// Get fetches one file (any state).
func (r *Repository) Get(ctx context.Context, orgID, id string) (File, error) {
	var f File
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, org_id::text, owner_id::text, parent_id::text, name, mime_type, storage_key, size_bytes, trashed_at, created_at, updated_at
		 FROM grown.drive_files
		 WHERE org_id = $1 AND id = $2`,
		orgID, id,
	).Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return File{}, ErrNotFound
	}
	if err != nil {
		return File{}, fmt.Errorf("drive.Get: %w", err)
	}
	return f, nil
}

// ListChildren returns rows under `parent` (empty = root). `pageToken` is the
// last-seen file ID for cursor pagination (V1: simple, not stable across
// concurrent inserts — acceptable for the dashboard).
func (r *Repository) ListChildren(ctx context.Context, orgID, parent string, includeTrashed bool, pageSize int, pageToken string) ([]File, string, error) {
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 100
	}
	var parentClause string
	var args []interface{}
	args = append(args, orgID)
	if parent == "" {
		parentClause = "parent_id IS NULL"
	} else {
		args = append(args, parent)
		parentClause = "parent_id = $2"
	}
	trashClause := "trashed_at IS NULL"
	if includeTrashed {
		trashClause = "TRUE"
	}
	tokenClause := ""
	if pageToken != "" {
		args = append(args, pageToken)
		tokenClause = fmt.Sprintf("AND id > $%d", len(args))
	}
	query := fmt.Sprintf(
		`SELECT id::text, org_id::text, owner_id::text, parent_id::text, name, mime_type, storage_key, size_bytes, trashed_at, created_at, updated_at
		 FROM grown.drive_files
		 WHERE org_id = $1 AND %s AND %s %s
		 ORDER BY id
		 LIMIT %d`,
		parentClause, trashClause, tokenClause, pageSize+1,
	)
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, "", fmt.Errorf("drive.ListChildren: %w", err)
	}
	defer rows.Close()

	out := make([]File, 0, pageSize)
	for rows.Next() {
		var f File
		if err := rows.Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, "", err
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	next := ""
	if len(out) > pageSize {
		next = out[pageSize-1].ID
		out = out[:pageSize]
	}
	return out, next, nil
}

// UpdateNameOrParent renames or moves a file. Pass empty strings / nil to leave fields alone.
func (r *Repository) UpdateNameOrParent(ctx context.Context, orgID, id string, name string, parent *string) (File, error) {
	setClauses := []string{"updated_at = now()"}
	args := []interface{}{orgID, id}
	if name != "" {
		args = append(args, name)
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", len(args)))
	}
	if parent != nil {
		if *parent == "" {
			setClauses = append(setClauses, "parent_id = NULL")
		} else {
			args = append(args, *parent)
			setClauses = append(setClauses, fmt.Sprintf("parent_id = $%d", len(args)))
		}
	}
	query := fmt.Sprintf(
		`UPDATE grown.drive_files SET %s
		 WHERE org_id = $1 AND id = $2
		 RETURNING id::text, org_id::text, owner_id::text, parent_id::text, name, mime_type, storage_key, size_bytes, trashed_at, created_at, updated_at`,
		joinComma(setClauses),
	)
	var f File
	err := r.pool.QueryRow(ctx, query, args...).Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return File{}, ErrNotFound
	}
	if err != nil {
		return File{}, fmt.Errorf("drive.Update: %w", err)
	}
	return f, nil
}

// Trash sets trashed_at = now().
func (r *Repository) Trash(ctx context.Context, orgID, id string) error {
	res, err := r.pool.Exec(ctx,
		`UPDATE grown.drive_files SET trashed_at = now() WHERE org_id = $1 AND id = $2 AND trashed_at IS NULL`,
		orgID, id,
	)
	if err != nil {
		return fmt.Errorf("drive.Trash: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Restore clears trashed_at.
func (r *Repository) Restore(ctx context.Context, orgID, id string) error {
	res, err := r.pool.Exec(ctx,
		`UPDATE grown.drive_files SET trashed_at = NULL WHERE org_id = $1 AND id = $2 AND trashed_at IS NOT NULL`,
		orgID, id,
	)
	if err != nil {
		return fmt.Errorf("drive.Restore: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteForever removes the row, returning the storage_key so the caller can
// also delete the blob. Returns empty string for folders.
func (r *Repository) DeleteForever(ctx context.Context, orgID, id string) (string, error) {
	var key *string
	err := r.pool.QueryRow(ctx,
		`DELETE FROM grown.drive_files WHERE org_id = $1 AND id = $2 RETURNING storage_key`,
		orgID, id,
	).Scan(&key)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("drive.DeleteForever: %w", err)
	}
	if key == nil {
		return "", nil
	}
	return *key, nil
}

func joinComma(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}
```

- [ ] **Step 4: Run tests, all 3 PASS**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  TMP=$(mktemp -d); export PGDATA=$TMP/pg
  initdb --auth=trust -U postgres -D "$PGDATA" >/dev/null
  pg_ctl -D "$PGDATA" -o "-h 127.0.0.1 -p 25432 -k $TMP" -l "$TMP/log" start
  for i in $(seq 1 20); do pg_isready -h 127.0.0.1 -p 25432 -q && break; sleep 0.5; done
  createdb -h 127.0.0.1 -p 25432 -U postgres grown_test
  export GROWN_TEST_DSN="postgres://postgres@127.0.0.1:25432/grown_test?sslmode=disable"
  go test ./internal/drive/... -v
  pg_ctl -D "$PGDATA" stop -m immediate
  rm -rf "$TMP"
'
```

- [ ] **Step 5: MODULE.md**

Path: `internal/drive/MODULE.md`

```markdown
# internal/drive

Drive's data-access + business logic. Metadata in Postgres (`grown.drive_files`,
`grown.drive_shares`); blobs in rustfs (S3 API).

## Interfaces

- `Repository` — metadata CRUD: CreateFolder, CreateFile, Get, ListChildren, UpdateNameOrParent, Trash, Restore, DeleteForever.
- `Blobs` — blob layer (Task 7): Put, Get, Delete.
- `ACL` — share-token CRUD + permission checks (Task 8).
- `Service` — gRPC `DriveService` (Tasks 9–12).

## Depends on

- `internal/storage` (migrations + pool)
- `github.com/jackc/pgx/v5`
- `github.com/aws/aws-sdk-go-v2`

## Used by

- `internal/server` — registers DriveService on the gateway.
- `cmd/server` — constructs the blob client + repository.
```

- [ ] **Step 6: Commit**

```bash
git add internal/drive/repository.go internal/drive/repository_test.go internal/drive/MODULE.md
git commit -m "feat(drive): repository — folder/file CRUD with trash semantics"
```

---

## Task 7: `internal/drive/blobs.go` — S3 client

**Files:**

- Create: `internal/drive/blobs.go`
- Create: `internal/drive/blobs_test.go`

- [ ] **Step 1: Add aws-sdk-go-v2 dependencies**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  go get github.com/aws/aws-sdk-go-v2@latest
  go get github.com/aws/aws-sdk-go-v2/config@latest
  go get github.com/aws/aws-sdk-go-v2/credentials@latest
  go get github.com/aws/aws-sdk-go-v2/service/s3@latest
  go mod tidy
'
```

- [ ] **Step 2: Write test**

Path: `internal/drive/blobs_test.go`

```go
package drive

import (
	"context"
	"io"
	"os"
	"strings"
	"testing"
)

func skipUnlessRustfs(t *testing.T) {
	t.Helper()
	if os.Getenv("GROWN_RUSTFS_ENDPOINT") == "" {
		t.Skip("GROWN_RUSTFS_ENDPOINT not set; skipping blob integration test")
	}
}

func newTestBlobs(t *testing.T) *Blobs {
	t.Helper()
	skipUnlessRustfs(t)
	b, err := NewBlobs(context.Background(), BlobsConfig{
		Endpoint:  os.Getenv("GROWN_RUSTFS_ENDPOINT"),
		AccessKey: os.Getenv("GROWN_RUSTFS_ACCESS_KEY"),
		SecretKey: os.Getenv("GROWN_RUSTFS_SECRET_KEY"),
		Bucket:    os.Getenv("GROWN_RUSTFS_BUCKET"),
		Region:    "us-east-1",
	})
	if err != nil {
		t.Fatalf("NewBlobs: %v", err)
	}
	return b
}

func TestBlobs_PutGetDelete(t *testing.T) {
	b := newTestBlobs(t)
	ctx := context.Background()

	body := "hello, drive"
	if err := b.Put(ctx, "test/hello.txt", "text/plain", int64(len(body)), strings.NewReader(body)); err != nil {
		t.Fatalf("Put: %v", err)
	}

	rc, _, _, err := b.Get(ctx, "test/hello.txt")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	out, _ := io.ReadAll(rc)
	rc.Close()
	if string(out) != body {
		t.Errorf("got %q, want %q", out, body)
	}

	if err := b.Delete(ctx, "test/hello.txt"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
}
```

- [ ] **Step 3: Implement `blobs.go`**

Path: `internal/drive/blobs.go`

```go
package drive

import (
	"context"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// BlobsConfig configures the S3 client.
type BlobsConfig struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	Region    string
}

// Blobs wraps an S3 client targeting rustfs (or any S3-compatible store).
type Blobs struct {
	client *s3.Client
	bucket string
}

// NewBlobs constructs an S3 client.
func NewBlobs(ctx context.Context, cfg BlobsConfig) (*Blobs, error) {
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	awsCfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(cfg.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, "")),
	)
	if err != nil {
		return nil, fmt.Errorf("aws config: %w", err)
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.Endpoint)
		o.UsePathStyle = true
	})
	return &Blobs{client: client, bucket: cfg.Bucket}, nil
}

// Put uploads a blob. `size` is set as Content-Length if positive.
func (b *Blobs) Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error {
	in := &s3.PutObjectInput{
		Bucket:      aws.String(b.bucket),
		Key:         aws.String(key),
		Body:        body,
		ContentType: aws.String(mimeType),
	}
	if size > 0 {
		in.ContentLength = aws.Int64(size)
	}
	_, err := b.client.PutObject(ctx, in)
	if err != nil {
		return fmt.Errorf("s3.Put %s: %w", key, err)
	}
	return nil
}

// Get streams a blob. Caller must Close the returned ReadCloser.
// Returns (body, contentType, size, error).
func (b *Blobs) Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error) {
	out, err := b.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, "", 0, fmt.Errorf("s3.Get %s: %w", key, err)
	}
	mime := ""
	if out.ContentType != nil {
		mime = *out.ContentType
	}
	size := int64(0)
	if out.ContentLength != nil {
		size = *out.ContentLength
	}
	return out.Body, mime, size, nil
}

// Delete removes a blob. Idempotent.
func (b *Blobs) Delete(ctx context.Context, key string) error {
	_, err := b.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("s3.Delete %s: %w", key, err)
	}
	return nil
}
```

- [ ] **Step 4: Run test against running rustfs**

```bash
cd /home/lucas/workspace/grown/grown-workspace
# rustfs needs to be running (from process-compose).
GROWN_RUSTFS_ENDPOINT=http://127.0.0.1:9100 \
GROWN_RUSTFS_ACCESS_KEY=grown \
GROWN_RUSTFS_SECRET_KEY=DevPassword!1 \
GROWN_RUSTFS_BUCKET=grown-default \
nix --extra-experimental-features 'nix-command flakes' develop --command go test ./internal/drive/... -run TestBlobs -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/drive/blobs.go internal/drive/blobs_test.go go.mod go.sum
git commit -m "feat(drive): S3 blob client (Put/Get/Delete via aws-sdk-go-v2)"
```

---

## Task 8: `internal/drive/acl.go` — sharing + permission checks

**Files:**

- Create: `internal/drive/acl.go`
- Create: `internal/drive/acl_test.go`

- [ ] **Step 1: Write test**

Path: `internal/drive/acl_test.go`

```go
package drive

import (
	"context"
	"testing"
	"time"
)

func TestACL_CreateAndLookup(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	acl := NewACL(pool)
	ctx := context.Background()

	file, _ := repo.CreateFile(ctx, orgID, userID, "", "x.txt", "text/plain", "blobs/x", 1)

	tok, err := acl.CreateShare(ctx, file.ID, userID, "viewer", time.Time{})
	if err != nil {
		t.Fatalf("CreateShare: %v", err)
	}
	if len(tok) != 64 {
		t.Errorf("token length %d, want 64", len(tok))
	}

	share, err := acl.LookupShare(ctx, tok)
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if share.Role != "viewer" || share.FileID != file.ID {
		t.Errorf("unexpected: %+v", share)
	}
}

func TestACL_Revoke(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	acl := NewACL(pool)
	ctx := context.Background()
	file, _ := repo.CreateFile(ctx, orgID, userID, "", "y.txt", "text/plain", "blobs/y", 1)

	tok, _ := acl.CreateShare(ctx, file.ID, userID, "viewer", time.Time{})
	if err := acl.RevokeShare(ctx, tok); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	if _, err := acl.LookupShare(ctx, tok); err != ErrShareRevoked {
		t.Errorf("got %v, want ErrShareRevoked", err)
	}
}
```

- [ ] **Step 2: Implement `acl.go`**

Path: `internal/drive/acl.go`

```go
package drive

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrShareNotFound = errors.New("share not found")
	ErrShareRevoked  = errors.New("share revoked")
	ErrShareExpired  = errors.New("share expired")
)

// Share mirrors a grown.drive_shares row.
type Share struct {
	Token     string
	FileID    string
	Role      string
	CreatedBy string
	CreatedAt time.Time
	ExpiresAt *time.Time
	RevokedAt *time.Time
}

type ACL struct {
	pool *pgxpool.Pool
}

func NewACL(pool *pgxpool.Pool) *ACL { return &ACL{pool: pool} }

func (a *ACL) CreateShare(ctx context.Context, fileID, createdBy, role string, expiresAt time.Time) (string, error) {
	if role != "viewer" && role != "commenter" && role != "editor" {
		return "", fmt.Errorf("invalid role: %q", role)
	}
	tok, err := newShareToken()
	if err != nil {
		return "", err
	}
	var exp interface{}
	if !expiresAt.IsZero() {
		exp = expiresAt
	}
	_, err = a.pool.Exec(ctx,
		`INSERT INTO grown.drive_shares (token, file_id, role, created_by, expires_at) VALUES ($1, $2, $3, $4, $5)`,
		tok, fileID, role, createdBy, exp,
	)
	if err != nil {
		return "", fmt.Errorf("acl.CreateShare: %w", err)
	}
	return tok, nil
}

func (a *ACL) LookupShare(ctx context.Context, token string) (Share, error) {
	var s Share
	err := a.pool.QueryRow(ctx,
		`SELECT token, file_id::text, role, created_by::text, created_at, expires_at, revoked_at
		 FROM grown.drive_shares WHERE token = $1`,
		token,
	).Scan(&s.Token, &s.FileID, &s.Role, &s.CreatedBy, &s.CreatedAt, &s.ExpiresAt, &s.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Share{}, ErrShareNotFound
	}
	if err != nil {
		return Share{}, fmt.Errorf("acl.LookupShare: %w", err)
	}
	if s.RevokedAt != nil {
		return s, ErrShareRevoked
	}
	if s.ExpiresAt != nil && time.Now().After(*s.ExpiresAt) {
		return s, ErrShareExpired
	}
	return s, nil
}

func (a *ACL) ListSharesForFile(ctx context.Context, fileID string) ([]Share, error) {
	rows, err := a.pool.Query(ctx,
		`SELECT token, file_id::text, role, created_by::text, created_at, expires_at, revoked_at
		 FROM grown.drive_shares
		 WHERE file_id = $1 AND revoked_at IS NULL
		 ORDER BY created_at DESC`,
		fileID,
	)
	if err != nil {
		return nil, fmt.Errorf("acl.List: %w", err)
	}
	defer rows.Close()
	var out []Share
	for rows.Next() {
		var s Share
		if err := rows.Scan(&s.Token, &s.FileID, &s.Role, &s.CreatedBy, &s.CreatedAt, &s.ExpiresAt, &s.RevokedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (a *ACL) RevokeShare(ctx context.Context, token string) error {
	res, err := a.pool.Exec(ctx,
		`UPDATE grown.drive_shares SET revoked_at = now() WHERE token = $1 AND revoked_at IS NULL`,
		token,
	)
	if err != nil {
		return fmt.Errorf("acl.Revoke: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrShareNotFound
	}
	return nil
}

func newShareToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
```

- [ ] **Step 3: Run tests, all PASS**

(Same temp-Postgres harness as Task 6.)

- [ ] **Step 4: Commit**

```bash
git add internal/drive/acl.go internal/drive/acl_test.go
git commit -m "feat(drive): share tokens with role + revoke + lookup"
```

---

## Task 9: `internal/drive/service.go` — gRPC handlers (file ops)

**Files:**

- Create: `internal/drive/service.go`

This task implements all gRPC methods. Streaming upload/download stay as separate HTTP handlers in Task 11.

- [ ] **Step 1: Write the service**

Path: `internal/drive/service.go`

```go
package drive

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.DriveServiceServer.
type Service struct {
	grownv1.UnimplementedDriveServiceServer
	repo  *Repository
	acl   *ACL
	blobs *Blobs
}

func NewService(repo *Repository, acl *ACL, blobs *Blobs) *Service {
	return &Service{repo: repo, acl: acl, blobs: blobs}
}

func (s *Service) ListFiles(ctx context.Context, req *grownv1.ListFilesRequest) (*grownv1.ListFilesResponse, error) {
	org, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.PermissionDenied, "no org")
	}
	if _, ok := auth.UserFromContext(ctx); !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	files, next, err := s.repo.ListChildren(ctx, org.ID, req.GetParent(), req.GetIncludeTrashed(), int(req.GetPageSize()), req.GetPageToken())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list: %v", err)
	}
	out := make([]*grownv1.File, 0, len(files))
	for _, f := range files {
		out = append(out, toProto(f))
	}
	return &grownv1.ListFilesResponse{Files: out, NextPageToken: next}, nil
}

func (s *Service) GetFile(ctx context.Context, req *grownv1.GetFileRequest) (*grownv1.File, error) {
	org, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.PermissionDenied, "no org")
	}
	if _, ok := auth.UserFromContext(ctx); !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	f, err := s.repo.Get(ctx, org.ID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "file not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get: %v", err)
	}
	return toProto(f), nil
}

func (s *Service) CreateFolder(ctx context.Context, req *grownv1.CreateFolderRequest) (*grownv1.File, error) {
	org, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetName() == "" {
		return nil, status.Error(codes.InvalidArgument, "name required")
	}
	f, err := s.repo.CreateFolder(ctx, org.ID, user.ID, req.GetParent(), req.GetName())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create folder: %v", err)
	}
	return toProto(f), nil
}

func (s *Service) UpdateFile(ctx context.Context, req *grownv1.UpdateFileRequest) (*grownv1.File, error) {
	org, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetRestoreFromTrash() {
		if err := s.repo.Restore(ctx, org.ID, req.GetId()); err != nil {
			return nil, status.Errorf(codes.Internal, "restore: %v", err)
		}
	}
	var parentPtr *string
	if req.GetParent() != "" {
		p := req.GetParent()
		parentPtr = &p
	}
	f, err := s.repo.UpdateNameOrParent(ctx, org.ID, req.GetId(), req.GetName(), parentPtr)
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "file not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update: %v", err)
	}
	return toProto(f), nil
}

func (s *Service) TrashFile(ctx context.Context, req *grownv1.TrashFileRequest) (*grownv1.TrashFileResponse, error) {
	org, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.Trash(ctx, org.ID, req.GetId()); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, status.Error(codes.NotFound, "file not found")
		}
		return nil, status.Errorf(codes.Internal, "trash: %v", err)
	}
	return &grownv1.TrashFileResponse{}, nil
}

func (s *Service) DeleteForever(ctx context.Context, req *grownv1.DeleteForeverRequest) (*grownv1.DeleteForeverResponse, error) {
	org, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	key, derr := s.repo.DeleteForever(ctx, org.ID, req.GetId())
	if errors.Is(derr, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "file not found")
	}
	if derr != nil {
		return nil, status.Errorf(codes.Internal, "delete: %v", derr)
	}
	if key != "" {
		if err := s.blobs.Delete(ctx, key); err != nil {
			// Metadata is gone; blob delete best-effort. Log via gRPC error code
			// for now (V1).
			return nil, status.Errorf(codes.DataLoss, "blob delete: %v", err)
		}
	}
	return &grownv1.DeleteForeverResponse{}, nil
}

func (s *Service) CreateShare(ctx context.Context, req *grownv1.CreateShareRequest) (*grownv1.Share, error) {
	_, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	role := req.GetRole()
	if role == "" {
		role = "viewer"
	}
	var exp time.Time
	if e := req.GetExpiresAt(); e > 0 {
		exp = time.Unix(e, 0)
	}
	tok, cerr := s.acl.CreateShare(ctx, req.GetFileId(), user.ID, role, exp)
	if cerr != nil {
		return nil, status.Errorf(codes.InvalidArgument, "create share: %v", cerr)
	}
	share, lerr := s.acl.LookupShare(ctx, tok)
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "lookup share: %v", lerr)
	}
	return shareToProto(share), nil
}

func (s *Service) ListShares(ctx context.Context, req *grownv1.ListSharesRequest) (*grownv1.ListSharesResponse, error) {
	_, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	shares, lerr := s.acl.ListSharesForFile(ctx, req.GetFileId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list shares: %v", lerr)
	}
	out := make([]*grownv1.Share, 0, len(shares))
	for _, sh := range shares {
		out = append(out, shareToProto(sh))
	}
	return &grownv1.ListSharesResponse{Shares: out}, nil
}

func (s *Service) RevokeShare(ctx context.Context, req *grownv1.RevokeShareRequest) (*grownv1.RevokeShareResponse, error) {
	_, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if rerr := s.acl.RevokeShare(ctx, req.GetToken()); rerr != nil {
		if errors.Is(rerr, ErrShareNotFound) {
			return nil, status.Error(codes.NotFound, "share not found")
		}
		return nil, status.Errorf(codes.Internal, "revoke: %v", rerr)
	}
	return &grownv1.RevokeShareResponse{}, nil
}

func (s *Service) requireAuth(ctx context.Context) (auth.OrgFromContextReturn, auth.UserFromContextReturn, error) {
	// Cannot reference the auth types via aliases — keep the same pattern as the
	// other services that use UserFromContext/OrgFromContext directly.
	user, uok := auth.UserFromContext(ctx)
	if !uok {
		return _zeroOrg(), _zeroUser(), status.Error(codes.Unauthenticated, "no session")
	}
	org, ook := auth.OrgFromContext(ctx)
	if !ook {
		return _zeroOrg(), user, status.Error(codes.PermissionDenied, "no org")
	}
	return org, user, nil
}
```

**Stop.** The `auth.OrgFromContextReturn`/`UserFromContextReturn` and `_zeroOrg`/`_zeroUser` symbols aren't real — they're a placeholder the implementer needs to either replace with the real types from `internal/auth` and `internal/orgs`/`internal/users`, or restructure the helper. Simpler approach: inline the checks at each call site instead of factoring `requireAuth`. The implementer should choose what compiles cleanly. The pattern shown elsewhere in the file (`if _, ok := auth.UserFromContext(ctx); !ok { ... }`) works directly.

Also add helpers:

```go
func toProto(f File) *grownv1.File {
	parent := ""
	if f.ParentID != nil {
		parent = *f.ParentID
	}
	trashed := f.TrashedAt != nil
	return &grownv1.File{
		Id:        f.ID,
		OrgId:     f.OrgID,
		OwnerId:   f.OwnerID,
		ParentId:  parent,
		Name:      f.Name,
		MimeType:  f.MimeType,
		SizeBytes: f.SizeBytes,
		Trashed:   trashed,
		CreatedAt: f.CreatedAt.Unix(),
		UpdatedAt: f.UpdatedAt.Unix(),
	}
}

func shareToProto(s Share) *grownv1.Share {
	exp := int64(0)
	if s.ExpiresAt != nil {
		exp = s.ExpiresAt.Unix()
	}
	return &grownv1.Share{
		Token:     s.Token,
		FileId:    s.FileID,
		Role:      s.Role,
		CreatedBy: s.CreatedBy,
		CreatedAt: s.CreatedAt.Unix(),
		ExpiresAt: exp,
	}
}

// newStorageKey returns a deterministic-by-input but unpredictable blob key.
// Format: blobs/<random-16-hex>/<random-16-hex>
func newStorageKey() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "blobs/" + hex.EncodeToString(buf[:8]) + "/" + hex.EncodeToString(buf[8:]), nil
}
```

- [ ] **Step 2: Verify it builds**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go build ./internal/drive/...
```

The `requireAuth` helper above doesn't compile as-is — implementer must replace it with direct inline checks (as the placeholder note describes).

- [ ] **Step 3: Commit**

```bash
git add internal/drive/service.go
git commit -m "feat(drive): DriveService gRPC handlers (file ops + share lifecycle)"
```

---

## Task 10: Upload + Download HTTP handlers

**Files:**

- Modify: `internal/drive/service.go` (add raw HTTP handlers)
- Modify: `internal/server/server.go` (mount the handlers)

- [ ] **Step 1: Add upload + download handlers in `service.go`**

Add to `internal/drive/service.go`:

```go
import (
	"net/http"
	"strings"
)

// UploadHandler accepts a multipart upload at POST /api/v1/drive/files/upload.
// Form fields: file (required, the blob), parent (optional, folder id).
func (s *Service) UploadHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user, uok := auth.UserFromContext(ctx)
		org, ook := auth.OrgFromContext(ctx)
		if !uok || !ook {
			http.Error(w, "no session", http.StatusUnauthorized)
			return
		}
		if err := r.ParseMultipartForm(110 * 1024 * 1024); err != nil {
			http.Error(w, "parse multipart: "+err.Error(), http.StatusBadRequest)
			return
		}
		parent := r.FormValue("parent")
		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "missing file part", http.StatusBadRequest)
			return
		}
		defer file.Close()

		key, err := newStorageKey()
		if err != nil {
			http.Error(w, "internal", http.StatusInternalServerError)
			return
		}

		mime := header.Header.Get("Content-Type")
		if mime == "" {
			mime = "application/octet-stream"
		}
		if err := s.blobs.Put(ctx, key, mime, header.Size, file); err != nil {
			http.Error(w, "blob put: "+err.Error(), http.StatusInternalServerError)
			return
		}

		f, err := s.repo.CreateFile(ctx, org.ID, user.ID, parent, header.Filename, mime, key, header.Size)
		if err != nil {
			_ = s.blobs.Delete(ctx, key) // rollback
			http.Error(w, "metadata: "+err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = writeFileJSON(w, f)
	})
}

// DownloadHandler streams the blob for a file the caller can access.
// GET /api/v1/drive/files/{id}/content
func (s *Service) DownloadHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		// Path: /api/v1/drive/files/{id}/content
		const prefix = "/api/v1/drive/files/"
		const suffix = "/content"
		path := r.URL.Path
		if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
			http.NotFound(w, r)
			return
		}
		id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
		org, ook := auth.OrgFromContext(ctx)
		if !ook {
			http.Error(w, "no org", http.StatusUnauthorized)
			return
		}
		if _, uok := auth.UserFromContext(ctx); !uok {
			http.Error(w, "no session", http.StatusUnauthorized)
			return
		}
		f, ferr := s.repo.Get(ctx, org.ID, id)
		if errors.Is(ferr, ErrNotFound) {
			http.NotFound(w, r)
			return
		}
		if ferr != nil {
			http.Error(w, "lookup: "+ferr.Error(), http.StatusInternalServerError)
			return
		}
		if f.StorageKey == nil {
			http.Error(w, "not a file", http.StatusBadRequest)
			return
		}
		body, mime, size, gerr := s.blobs.Get(ctx, *f.StorageKey)
		if gerr != nil {
			http.Error(w, "blob get: "+gerr.Error(), http.StatusInternalServerError)
			return
		}
		defer body.Close()
		w.Header().Set("Content-Type", mime)
		if size > 0 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", strings.ReplaceAll(f.Name, "\"", "\\\"")))
		_, _ = io.Copy(w, body)
	})
}

func writeFileJSON(w http.ResponseWriter, f File) error {
	p := toProto(f)
	enc := json.NewEncoder(w)
	return enc.Encode(map[string]interface{}{
		"id":         p.GetId(),
		"org_id":     p.GetOrgId(),
		"owner_id":   p.GetOwnerId(),
		"parent_id":  p.GetParentId(),
		"name":       p.GetName(),
		"mime_type":  p.GetMimeType(),
		"size_bytes": p.GetSizeBytes(),
		"trashed":    p.GetTrashed(),
		"created_at": p.GetCreatedAt(),
		"updated_at": p.GetUpdatedAt(),
	})
}
```

(Add `"encoding/json"`, `"fmt"`, `"io"` to the imports.)

- [ ] **Step 2: Verify builds**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go build ./internal/drive/...
```

- [ ] **Step 3: Commit**

```bash
git add internal/drive/service.go
git commit -m "feat(drive): multipart upload + streaming download HTTP handlers"
```

---

## Task 11: Wire DriveService + handlers into `server.go`

**Files:**

- Modify: `internal/server/server.go`

- [ ] **Step 1: Modify Config + New()**

Add `Drive *drive.Service` to the `Config` struct (after `DefaultOrg`).

In `New()`, after registering AuthService:

```go
if cfg.Drive != nil {
    grownv1.RegisterDriveServiceServer(grpcSrv, cfg.Drive)
}
```

After registering gateway handlers:

```go
if cfg.Drive != nil {
    _ = grownv1.RegisterDriveServiceHandlerServer(context.Background(), mux, cfg.Drive)
}
```

In the final router HandlerFunc, BEFORE delegating to `authWrapped`, handle upload and download URLs that the gateway can't:

```go
router := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    // Drive's binary endpoints aren't gRPC-gateway routes; mount them directly.
    if cfg.Drive != nil {
        if r.URL.Path == "/api/v1/drive/files/upload" && r.Method == http.MethodPost {
            authWrappedDriveUpload := auth.HTTPMiddleware(cfg.AuthConfig, cfg.Sessions, cfg.UsersRepo, cfg.DefaultOrg)(cfg.Drive.UploadHandler())
            authWrappedDriveUpload.ServeHTTP(w, r)
            return
        }
        if strings.HasPrefix(r.URL.Path, "/api/v1/drive/files/") && strings.HasSuffix(r.URL.Path, "/content") && r.Method == http.MethodGet {
            authWrappedDriveDownload := auth.HTTPMiddleware(cfg.AuthConfig, cfg.Sessions, cfg.UsersRepo, cfg.DefaultOrg)(cfg.Drive.DownloadHandler())
            authWrappedDriveDownload.ServeHTTP(w, r)
            return
        }
    }
    if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" {
        authWrapped.ServeHTTP(w, r)
        return
    }
    static.ServeHTTP(w, r)
})
```

Add `"code.pick.haus/grown/grown/internal/drive"` to the imports.

- [ ] **Step 2: Modify `cmd/server/main.go`**

After constructing OrgsRepo and DefaultOrg, build the Drive blobs client + repository + service:

```go
blobs, err := drive.NewBlobs(startupCtx, drive.BlobsConfig{
    Endpoint:  os.Getenv("GROWN_RUSTFS_ENDPOINT"),
    AccessKey: os.Getenv("GROWN_RUSTFS_ACCESS_KEY"),
    SecretKey: os.Getenv("GROWN_RUSTFS_SECRET_KEY"),
    Bucket:    defaultEnv("GROWN_RUSTFS_BUCKET", "grown-default"),
    Region:    "us-east-1",
})
if err != nil {
    logger.Error("init drive blobs", "err", err)
    os.Exit(1)
}

driveSvc := drive.NewService(
    drive.NewRepository(pool),
    drive.NewACL(pool),
    blobs,
)
```

In the `server.Config{...}` literal, add `Drive: driveSvc,`.

Add `"code.pick.haus/grown/grown/internal/drive"` to imports.

- [ ] **Step 3: Add rustfs env vars to process-compose backend block**

Edit `deploy/process-compose/process-compose.yaml`. In `backend.environment`, add:

```yaml
- GROWN_RUSTFS_ENDPOINT=http://127.0.0.1:9100
- GROWN_RUSTFS_ACCESS_KEY=grown
- GROWN_RUSTFS_SECRET_KEY=DevPassword!1
- GROWN_RUSTFS_BUCKET=grown-default
```

- [ ] **Step 4: Build + smoke test**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c 'go build ./... && go test ./internal/health/... ./internal/server/... ./internal/auth/... ./cmd/server/...'
```

- [ ] **Step 5: Commit**

```bash
git add internal/server/server.go cmd/server/main.go deploy/process-compose/process-compose.yaml
git commit -m "feat(server): register DriveService + mount upload/download routes"
```

---

## Task 12: Frontend `api.ts` + `types.ts`

**Files:**

- Create: `web/app/src/pages/drive/types.ts`
- Create: `web/app/src/pages/drive/api.ts`

- [ ] **Step 1: Add npm deps**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm install --no-fund --no-audit react-dropzone@^14 pdfjs-dist@^4
```

- [ ] **Step 2: Write `types.ts`**

Path: `web/app/src/pages/drive/types.ts`

```typescript
export interface DriveFile {
  id: string;
  org_id: string;
  owner_id: string;
  parent_id: string;
  name: string;
  mime_type: string;
  size_bytes: string; // protojson int64 as string
  trashed: boolean;
  created_at: string;
  updated_at: string;
}

export interface DriveShare {
  token: string;
  file_id: string;
  role: "viewer" | "commenter" | "editor";
  created_by: string;
  created_at: string;
  expires_at: string;
}

export const FOLDER_MIME = "application/vnd.grown.folder";

export function isFolder(f: DriveFile): boolean {
  return f.mime_type === FOLDER_MIME;
}
```

- [ ] **Step 3: Write `api.ts`**

Path: `web/app/src/pages/drive/api.ts`

```typescript
import type { DriveFile, DriveShare } from "./types";

const BASE = "/api/v1/drive";

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export async function listFiles(parent: string = ""): Promise<DriveFile[]> {
  const url = parent ? `${BASE}/files?parent=${parent}` : `${BASE}/files`;
  const r = await fetch(url, { credentials: "same-origin" });
  const data = await jsonOrThrow<{ files?: DriveFile[] }>(r);
  return data.files ?? [];
}

export async function getFile(id: string): Promise<DriveFile> {
  const r = await fetch(`${BASE}/files/${id}`, { credentials: "same-origin" });
  return jsonOrThrow<DriveFile>(r);
}

export async function createFolder(
  name: string,
  parent: string = "",
): Promise<DriveFile> {
  const r = await fetch(`${BASE}/folders`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parent }),
  });
  return jsonOrThrow<DriveFile>(r);
}

export async function renameFile(id: string, name: string): Promise<DriveFile> {
  const r = await fetch(`${BASE}/files/${id}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return jsonOrThrow<DriveFile>(r);
}

export async function trashFile(id: string): Promise<void> {
  const r = await fetch(`${BASE}/files/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error(`trash failed: ${r.status}`);
}

export async function uploadFile(
  file: File,
  parent: string = "",
): Promise<DriveFile> {
  const fd = new FormData();
  fd.append("file", file);
  if (parent) fd.append("parent", parent);
  const r = await fetch(`${BASE}/files/upload`, {
    method: "POST",
    credentials: "same-origin",
    body: fd,
  });
  return jsonOrThrow<DriveFile>(r);
}

export function downloadURL(id: string): string {
  return `${BASE}/files/${id}/content`;
}

export async function createShare(
  fileId: string,
  role: "viewer" | "commenter" | "editor" = "viewer",
): Promise<DriveShare> {
  const r = await fetch(`${BASE}/files/${fileId}/shares`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  return jsonOrThrow<DriveShare>(r);
}

export async function listShares(fileId: string): Promise<DriveShare[]> {
  const r = await fetch(`${BASE}/files/${fileId}/shares`, {
    credentials: "same-origin",
  });
  const data = await jsonOrThrow<{ shares?: DriveShare[] }>(r);
  return data.shares ?? [];
}

export async function revokeShare(token: string): Promise<void> {
  const r = await fetch(`${BASE}/shares/${token}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error(`revoke failed: ${r.status}`);
}
```

- [ ] **Step 4: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/package.json web/app/package-lock.json web/app/src/pages/drive/types.ts web/app/src/pages/drive/api.ts
git commit -m "feat(web): Drive API client + types"
```

---

## Frontend reference material (applies to Tasks 13–16)

When implementing the Drive UI, **match Google Drive's layout, menu names, and
navigation patterns as closely as possible** so the product feels familiar.
**Do NOT copy or translate Google's frontend code** — captures are inspection-
only architectural reference. Layout, naming, and UX patterns are fair game.

**Capture artifacts** (read-only — these live outside this repo, in the sibling
`grown-workspace` checkout, which keeps them out of grown-workspace's git):

- `/home/lucas/workspace/grown/grown-workspace/research/gworkspace-frontend/findings-drive.md`
  — synthesized findings: what the UI looks like, layout, components, menu names.
- `/home/lucas/workspace/grown/grown-workspace/research/gworkspace-frontend/pass2/drive/`
  — raw artifacts: `dom.html` (live HTML at capture time), `requests.json`,
  `runtime.json`, `console.json`. **No `.har` — too big to grep usefully; skip it.**

**Look-and-feel goals:**

- Top app bar: brand on left, search in the middle, apps switcher + user avatar on right.
- Left sidebar: "New" button at top, then nav items in this order — **My Drive**,
  **Computers** (skip — out of scope), **Shared with me**, **Recent**, **Starred**
  (skip if not in MVP), **Trash**, **Storage**.
- Main content area: breadcrumbs at top, then file/folder grid or list view
  (toggle in upper-right). Hover state highlights row. Double-click opens.
- Right-click context menu items: **Open / Open with**, **Share**, **Get link**,
  **Rename**, **Move to**, **Add to Starred**, **Download**, **Remove** (i.e. trash).
- Modal for sharing matches Google's structure: people-or-groups field on top,
  general-access section below ("Restricted" / "Anyone with the link").
- New-button dropdown items: **New folder**, **File upload**, **Folder upload**,
  **Google Docs / Sheets / Slides** (we'll wire these later — for MVP, just the
  folder + file-upload items).

Use these as a guide for component naming, route structure, and copy. When in
doubt, **read `findings-drive.md` first** — it has the structural notes already
extracted from the captures.

---

## Task 13: FileList page

**Files:**

- Create: `web/app/src/pages/drive/FileList.tsx`

- [ ] **Step 1: Write the component**

Path: `web/app/src/pages/drive/FileList.tsx`

```typescript
import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams, Link as RouterLink } from "react-router-dom";
import { Box, Container, Typography, Button, IconButton, Sheet, Stack } from "@mui/joy";
import * as Icons from "@mui/icons-material";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { listFiles, createFolder, trashFile, uploadFile, isFolder } from "./api";
import type { DriveFile } from "./types";
import { UploadZone } from "./UploadZone";

interface FileListProps {
  user: User;
}

export function FileList({ user }: FileListProps) {
  const [params] = useSearchParams();
  const parent = params.get("folder") ?? "";
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const f = await listFiles(parent);
      setFiles(f);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [parent]);

  useEffect(() => { refresh(); }, [refresh]);

  const onUploaded = useCallback(() => { refresh(); }, [refresh]);

  const onNewFolder = useCallback(async () => {
    const name = prompt("Folder name:");
    if (!name) return;
    try {
      await createFolder(name, parent);
      await refresh();
    } catch (e) {
      alert("Create failed: " + (e as Error).message);
    }
  }, [parent, refresh]);

  const onTrash = useCallback(async (id: string) => {
    if (!confirm("Move to trash?")) return;
    try {
      await trashFile(id);
      await refresh();
    } catch (e) {
      alert("Trash failed: " + (e as Error).message);
    }
  }, [refresh]);

  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography level="h2">Drive</Typography>
          <Stack direction="row" gap={1}>
            <Button startDecorator={<Icons.CreateNewFolder />} variant="soft" onClick={onNewFolder}>New folder</Button>
            <UploadZone parent={parent} onUploaded={(file) => { uploadFile(file, parent).then(onUploaded).catch((e) => alert(e.message)); }} />
          </Stack>
        </Stack>

        {error && <Typography color="danger" sx={{ mb: 2 }}>{error}</Typography>}
        {busy && <Typography sx={{ opacity: 0.6 }}>Loading…</Typography>}
        {!busy && files.length === 0 && (
          <Sheet variant="soft" sx={{ p: 4, textAlign: "center", borderRadius: "md" }}>
            <Typography level="body-md">No files in this folder yet.</Typography>
            <Typography level="body-sm" sx={{ opacity: 0.7 }}>Drag a file onto this page or click Upload.</Typography>
          </Sheet>
        )}

        <Box sx={{ display: "grid", gap: 0.5 }}>
          {files.map((f) => (
            <Sheet
              key={f.id}
              variant="outlined"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                p: 1.5,
                borderRadius: "sm",
                "&:hover": { bgcolor: "background.level1" },
              }}
            >
              {isFolder(f) ? (
                <RouterLink to={`/drive?folder=${f.id}`} style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, color: "inherit", textDecoration: "none" }}>
                  <Icons.Folder color="primary" />
                  <Typography sx={{ fontWeight: 500 }}>{f.name}</Typography>
                </RouterLink>
              ) : (
                <RouterLink to={`/drive/file/${f.id}`} style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, color: "inherit", textDecoration: "none" }}>
                  <Icons.InsertDriveFile />
                  <Box>
                    <Typography sx={{ fontWeight: 500 }}>{f.name}</Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.6 }}>{formatBytes(Number(f.size_bytes))}</Typography>
                  </Box>
                </RouterLink>
              )}
              <IconButton variant="plain" size="sm" onClick={() => onTrash(f.id)} title="Move to trash" data-testid={`trash-${f.id}`}>
                <Icons.Delete />
              </IconButton>
            </Sheet>
          ))}
        </Box>

        <Button sx={{ mt: 3 }} variant="plain" component={RouterLink} to="/" startDecorator={<Icons.ArrowBack />}>
          Back to dashboard
        </Button>
      </Container>
    </>
  );
}

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
```

- [ ] **Step 2: Commit (will fail to build until UploadZone exists; build at Task 14)**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/src/pages/drive/FileList.tsx
git commit -m "feat(web): Drive FileList — folder navigation + trash + upload trigger"
```

---

## Task 14: UploadZone (react-dropzone)

**Files:**

- Create: `web/app/src/pages/drive/UploadZone.tsx`

- [ ] **Step 1: Write the component**

Path: `web/app/src/pages/drive/UploadZone.tsx`

```typescript
import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@mui/joy";
import * as Icons from "@mui/icons-material";

interface UploadZoneProps {
  parent: string;
  onUploaded: (file: File) => void;
}

export function UploadZone({ onUploaded }: UploadZoneProps) {
  const onDrop = useCallback((accepted: File[]) => {
    for (const f of accepted) onUploaded(f);
  }, [onUploaded]);

  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  });

  return (
    <div {...getRootProps()} style={{ outline: "none" }}>
      <input {...getInputProps()} />
      <Button startDecorator={<Icons.CloudUpload />} variant="solid" onClick={open}>
        {isDragActive ? "Drop to upload" : "Upload"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npx tsc -b
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/src/pages/drive/UploadZone.tsx
git commit -m "feat(web): Drive UploadZone with react-dropzone"
```

---

## Task 15: FileViewer + PDF/image/video preview

**Files:**

- Create: `web/app/src/pages/drive/FileViewer.tsx`
- Create: `web/app/src/pages/drive/PdfPreview.tsx`

- [ ] **Step 1: PdfPreview component**

Path: `web/app/src/pages/drive/PdfPreview.tsx`

```typescript
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Vite-friendly worker URL.
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface PdfPreviewProps {
  url: string;
}

export function PdfPreview({ url }: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.display = "block";
          canvas.style.margin = "8px auto";
          canvas.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
          container.appendChild(canvas);
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          if (cancelled) return;
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <div role="alert" style={{ padding: 16, color: "red" }}>PDF load failed: {error}</div>;
  return <div ref={containerRef} style={{ padding: 16 }} />;
}
```

- [ ] **Step 2: FileViewer dispatcher**

Path: `web/app/src/pages/drive/FileViewer.tsx`

```typescript
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Button, Typography, Container } from "@mui/joy";
import * as Icons from "@mui/icons-material";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { getFile, downloadURL } from "./api";
import type { DriveFile } from "./types";
import { PdfPreview } from "./PdfPreview";

interface FileViewerProps {
  user: User;
}

export function FileViewer({ user }: FileViewerProps) {
  const { id = "" } = useParams<{ id: string }>();
  const [file, setFile] = useState<DriveFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    getFile(id).then((f) => { if (!cancelled) setFile(f); }).catch((e) => setError((e as Error).message));
    return () => { cancelled = true; };
  }, [id]);

  if (error) return (
    <>
      <Header user={user} />
      <Container sx={{ py: 4 }}>
        <Typography color="danger">{error}</Typography>
        <Button onClick={() => navigate("/drive")} variant="plain" startDecorator={<Icons.ArrowBack />}>Back</Button>
      </Container>
    </>
  );
  if (!file) return (
    <>
      <Header user={user} />
      <Container sx={{ py: 4 }}><Typography sx={{ opacity: 0.7 }}>Loading…</Typography></Container>
    </>
  );

  const url = downloadURL(file.id);
  const m = file.mime_type;

  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
          <Box>
            <Typography level="h3">{file.name}</Typography>
            <Typography level="body-sm" sx={{ opacity: 0.6 }}>{m}</Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button component="a" href={url} download={file.name} variant="soft" startDecorator={<Icons.Download />}>Download</Button>
            <Button onClick={() => navigate("/drive")} variant="plain" startDecorator={<Icons.ArrowBack />}>Back</Button>
          </Box>
        </Box>
        <Box sx={{ bgcolor: "background.level1", borderRadius: "md", minHeight: 400 }}>
          {m === "application/pdf" && <PdfPreview url={url} />}
          {m.startsWith("image/") && <img src={url} alt={file.name} style={{ maxWidth: "100%", display: "block", margin: "0 auto" }} />}
          {m.startsWith("video/") && <video src={url} controls style={{ width: "100%", maxHeight: "80vh" }} />}
          {m.startsWith("audio/") && <audio src={url} controls style={{ width: "100%", padding: 16 }} />}
          {(m.startsWith("text/") || m === "application/json") && (
            <iframe src={url} title={file.name} style={{ width: "100%", height: "80vh", border: 0 }} />
          )}
          {!m.startsWith("image/") && !m.startsWith("video/") && !m.startsWith("audio/") && !m.startsWith("text/") && m !== "application/pdf" && m !== "application/json" && (
            <Box sx={{ p: 6, textAlign: "center" }}>
              <Typography level="body-md">No preview available for this file type.</Typography>
              <Button sx={{ mt: 2 }} component="a" href={url} download={file.name} variant="solid">Download {file.name}</Button>
            </Box>
          )}
        </Box>
      </Container>
    </>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npx tsc -b
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/src/pages/drive/PdfPreview.tsx web/app/src/pages/drive/FileViewer.tsx
git commit -m "feat(web): Drive FileViewer + PDF/image/video/audio/text preview"
```

---

## Task 16: Wire Drive into routes + flip catalog tile

**Files:**

- Modify: `web/app/src/App.tsx`
- Modify: `web/app/src/catalog/apps.ts`

- [ ] **Step 1: Add Drive routes**

In `App.tsx`, add to the `<Routes>` block (after the existing routes, before `<Route path="*" element={<NotFound />} />`):

```tsx
<Route path="/drive" element={<FileList user={auth.user} />} />
<Route path="/drive/file/:id" element={<FileViewer user={auth.user} />} />
```

And import them at the top:

```tsx
import { FileList } from "./pages/drive/FileList";
import { FileViewer } from "./pages/drive/FileViewer";
```

- [ ] **Step 2: Update catalog**

In `web/app/src/catalog/apps.ts`, find the `drive` entry and change `comingSoon: true` to `comingSoon: false`.

Also update `Tile.tsx` so that when `comingSoon === false`, the link target is `/${app.id}` instead of `/coming-soon/${app.id}`. Change:

```tsx
to={`/coming-soon/${app.id}`}
```

To:

```tsx
to={app.comingSoon ? `/coming-soon/${app.id}` : `/${app.id}`}
```

- [ ] **Step 3: Build + commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm run build
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/src/App.tsx web/app/src/catalog/apps.ts web/app/src/components/Tile.tsx
git commit -m "feat(web): wire Drive routes and flip drive tile to live"
```

---

## Task 17: E2E test

**Files:**

- Create: `web/e2e/drive.spec.ts`

- [ ] **Step 1: Write the test**

Path: `web/e2e/drive.spec.ts`

```typescript
import { test, expect } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";

const BASE_URL =
  process.env.GROWN_HTTP_URL ?? "http://workspace.localtest.me:8080";
const FIXTURE = path.join("/tmp", "drive-fixture.txt");

test.beforeAll(() => {
  fs.writeFileSync(FIXTURE, "hello from drive e2e test\n");
});

test.afterAll(() => {
  try {
    fs.unlinkSync(FIXTURE);
  } catch {}
});

test.describe.serial("drive", () => {
  test("login + click drive tile + upload + see file + preview + trash", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto(`${BASE_URL}/`);
    await page.getByTestId("sign-in-button").click();
    await page
      .locator('input[name="loginName"], input[id="loginName"]')
      .fill("admin");
    await page.locator('button[type="submit"]').first().click();
    await page
      .locator('input[name="password"], input[id="password"]')
      .fill("DevPassword!1");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(
      new RegExp(
        "^" + BASE_URL.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "/?$",
      ),
      { timeout: 30_000 },
    );

    await page.getByTestId("tile-drive").click();
    await page.waitForURL(`${BASE_URL}/drive`);

    // Upload via the file input.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURE);

    // The list should refresh and show our file. Match by filename text.
    await expect(page.getByText("drive-fixture.txt")).toBeVisible({
      timeout: 10_000,
    });

    // Click to preview.
    await page.getByText("drive-fixture.txt").click();
    await expect(page).toHaveURL(/\/drive\/file\//);

    // Back to drive.
    await page.getByRole("button", { name: /^Back$/ }).click();
    await page.waitForURL(`${BASE_URL}/drive`);

    // Trash it.
    page.once("dialog", (d) => d.accept()); // confirm() prompt
    const row = page.locator("text=drive-fixture.txt").first();
    const trashBtn = row
      .locator("xpath=ancestor::*[contains(@class,'MuiSheet-root')][1]")
      .locator('[data-testid^="trash-"]');
    await trashBtn.click();
    await expect(page.getByText("drive-fixture.txt")).toHaveCount(0, {
      timeout: 5_000,
    });
  });
});
```

(The XPath ancestor selector is brittle; if it fails the implementer should adjust to a stable selector based on what the rendered DOM actually emits.)

- [ ] **Step 2: Bring up the stack and run the test**

```bash
cd /home/lucas/workspace/grown/grown-workspace
pgrep -fa 'process-compose.*grown-workspace' | head -1 | awk '{print $1}' | xargs -r kill 2>/dev/null
sleep 3
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  process-compose up --use-uds --tui=false -f deploy/process-compose/process-compose.yaml > /tmp/pc_drive.log 2>&1 &
  SC=$!
  trap "kill $SC 2>/dev/null; wait $SC 2>/dev/null || true" EXIT
  for i in $(seq 1 240); do
    if curl -fs http://workspace.localtest.me:8080/healthz >/dev/null 2>&1; then break; fi
    sleep 1
  done
  ( cd web/e2e && npm test -- --grep "drive" )
'
```

- [ ] **Step 3: Commit**

```bash
git add web/e2e/drive.spec.ts
git commit -m "test(e2e): Drive sign-in -> upload -> preview -> trash"
```

---

## Task 18: Tag v0.0.4

- [ ] **Step 1: Final verification**

Stop stack, run all unit tests + buf lint + go build + web build + e2e suite. Same pattern as v0.0.3 final verification.

- [ ] **Step 2: Tag**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git tag -a v0.0.4 -m "v0.0.4 Drive: file storage with rustfs + Postgres metadata, upload/preview/share/trash"
git tag -l
```

---

## Done criteria

1. `nix run .#dev` brings up Postgres + Zitadel + rustfs + web-build + backend.
2. From the dashboard, the Drive tile is no longer "Coming soon" — clicking it loads `/drive`.
3. Upload, list, folder navigation, file preview (PDF/image/video), trash all work in the browser.
4. All unit tests pass; `web/e2e/drive.spec.ts` passes end-to-end.
5. `v0.0.4` tagged.

## Next plans

- **Plan 5: Docs** (Lexical-based editor + save to Drive). Builds on this Drive infrastructure.
