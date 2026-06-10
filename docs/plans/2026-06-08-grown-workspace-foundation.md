# grown-workspace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the grown-workspace project with a working Nix devshell, a minimal gRPC + REST backend that exposes `/healthz`, a Postgres data store with migration support, and a one-command (`nix run .#dev`) local dev environment driven by process-compose.

**Architecture:** Single Go binary (`cmd/server`) exposes gRPC (port 9000) and a grpc-gateway-generated REST surface (port 8080). Postgres provides storage; migrations are embedded in the binary and run at startup. process-compose supervises Postgres + the server as native processes — no Docker required. The project lives at `/home/lucas/workspace/grown/grown-workspace/` as a sibling of `grown-workspace/` and is its own git repo.

**Tech Stack:** Go 1.22+, gRPC, grpc-gateway, Buf (`buf lint`, `buf generate`), Protobuf, pgx/v5 (Postgres driver), tern (Go migration runner via embedded SQL), Nix flake (`nixpkgs-unstable`), process-compose, Playwright (browser smoke test).

**Spec:** `docs/superpowers/specs/2026-06-08-grown-workspace-v1-design.md`

---

## File Structure

Files this plan creates:

| Path                                                          | Purpose                                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `grown-workspace/.gitignore`                                  | Ignore `result*`, `node_modules/`, `.direnv/`, `gen/` (gen committed later via `nix run .#gen`) |
| `grown-workspace/flake.nix`                                   | Nix flake: devshell + dev runner (`nix run .#dev`)                                              |
| `grown-workspace/flake.lock`                                  | Pinned inputs                                                                                   |
| `grown-workspace/go.mod`, `go.sum`                            | Go module                                                                                       |
| `grown-workspace/buf.yaml`                                    | Buf module config                                                                               |
| `grown-workspace/buf.gen.yaml`                                | Buf codegen config (Go + grpc-gateway + OpenAPI)                                                |
| `grown-workspace/proto/grown/v1/health.proto`                 | Health service definition                                                                       |
| `grown-workspace/gen/go/grown/v1/health.pb.go`                | Generated; not hand-edited                                                                      |
| `grown-workspace/gen/go/grown/v1/health_grpc.pb.go`           | Generated; not hand-edited                                                                      |
| `grown-workspace/gen/go/grown/v1/health.pb.gw.go`             | Generated; not hand-edited                                                                      |
| `grown-workspace/gen/openapi/grown/v1/health.swagger.json`    | Generated                                                                                       |
| `grown-workspace/internal/health/service.go`                  | HealthService implementation                                                                    |
| `grown-workspace/internal/health/service_test.go`             | Tests for HealthService                                                                         |
| `grown-workspace/internal/storage/postgres.go`                | pgx connection pool                                                                             |
| `grown-workspace/internal/storage/migrate.go`                 | Embedded migration runner                                                                       |
| `grown-workspace/internal/storage/migrations/0001_init.sql`   | Initial schema (empty `grown` schema + `schema_migrations` table)                               |
| `grown-workspace/internal/server/server.go`                   | Server wiring: gRPC + grpc-gateway + HTTP                                                       |
| `grown-workspace/cmd/server/main.go`                          | Server entrypoint                                                                               |
| `grown-workspace/deploy/process-compose/process-compose.yaml` | Postgres + server supervisor                                                                    |
| `grown-workspace/deploy/process-compose/data/.gitkeep`        | Holds Postgres data dir at dev time (gitignored)                                                |
| `grown-workspace/web/e2e/health.spec.ts`                      | Playwright smoke test                                                                           |
| `grown-workspace/web/e2e/package.json`                        | Playwright dep for e2e tests                                                                    |
| `grown-workspace/web/e2e/playwright.config.ts`                | Playwright config                                                                               |
| `grown-workspace/internal/health/MODULE.md`                   | Module-level README                                                                             |
| `grown-workspace/internal/storage/MODULE.md`                  | Module-level README                                                                             |
| `grown-workspace/internal/server/MODULE.md`                   | Module-level README                                                                             |

---

## Task 1: Initialize project directory and inner git repo

**Files:**

- Create: `grown-workspace/.gitignore`

- [ ] **Step 1: Create the directory and inner git repo**

```bash
mkdir -p /home/lucas/workspace/grown/grown-workspace
cd /home/lucas/workspace/grown/grown-workspace
git init -q
git config user.email "lpick@pick.haus"
git config user.name "Lucas Pick"
```

- [ ] **Step 2: Write the .gitignore**

Path: `grown-workspace/.gitignore`

```gitignore
# Nix build outputs
result
result-*

# direnv cache
.direnv/

# Process-compose data dirs at dev time (Postgres data, Zitadel state, etc.)
deploy/process-compose/data/*
!deploy/process-compose/data/.gitkeep

# Frontend
node_modules/
web/*/node_modules/

# Generated proto code -- regenerated via `nix run .#gen`. We commit it later
# once the gen pipeline is stable; for now keep it out of git churn.
gen/

# IDE noise
.vscode/
.idea/
*.swp
```

- [ ] **Step 3: Verify .gitignore is correct**

Run: `cd /home/lucas/workspace/grown/grown-workspace && cat .gitignore | head -20`
Expected: prints the file content above.

- [ ] **Step 4: Stage and make the initial commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add .gitignore
git commit -m "chore: initialize grown-workspace project skeleton"
```

Expected output: `[main (root-commit) <sha>] chore: initialize grown-workspace project skeleton`

---

## Task 2: Create the Nix flake with devshell

**Files:**

- Create: `grown-workspace/flake.nix`

- [ ] **Step 1: Write `flake.nix`**

Path: `grown-workspace/flake.nix`

```nix
{
  description = "grown-workspace: self-hosted multi-org workspace platform";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forAll = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAll (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.go_1_22
              pkgs.gopls
              pkgs.golangci-lint
              pkgs.gofumpt
              pkgs.buf
              pkgs.protoc-gen-go
              pkgs.protoc-gen-go-grpc
              pkgs.grpc-gateway
              pkgs.postgresql_16
              pkgs.process-compose
              pkgs.curl
              pkgs.jq
              pkgs.nodejs_22
            ];

            shellHook = ''
              export PROJECT_ROOT="$PWD"
              export PGDATA="$PROJECT_ROOT/deploy/process-compose/data/postgres"
              export PGHOST="$PROJECT_ROOT/deploy/process-compose/data"
              export PGPORT=5432
              export PGUSER=grown
              export PGDATABASE=grown
              echo "grown-workspace devshell ready."
              echo "  go:              $(go version 2>/dev/null | head -1)"
              echo "  buf:             $(buf --version 2>/dev/null)"
              echo "  process-compose: $(process-compose version 2>&1 | head -1)"
              echo
              echo "Run:  nix run .#dev    # bring up the full local stack"
            '';
          };
        }
      );

      apps = forAll (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          dev = pkgs.writeShellApplication {
            name = "grown-dev";
            runtimeInputs = [
              pkgs.process-compose
              pkgs.postgresql_16
              pkgs.go_1_22
              pkgs.coreutils
            ];
            text = ''
              cd "''${PROJECT_ROOT:-$PWD}"
              exec process-compose up -f deploy/process-compose/process-compose.yaml
            '';
          };
        in
        {
          dev = {
            type = "app";
            program = "${dev}/bin/grown-dev";
          };
        }
      );

      formatter = forAll (
        system: (import nixpkgs { inherit system; }).nixfmt-rfc-style
      );
    };
}
```

- [ ] **Step 2: Lock the flake**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add flake.nix
nix --extra-experimental-features 'nix-command flakes' flake lock
```

Expected: creates `flake.lock`. No errors.

- [ ] **Step 3: Verify the devshell builds**

```bash
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c 'go version && buf --version && process-compose version | head -1'
```

Expected output: prints Go 1.22.x, Buf 1.x.x, process-compose vX.Y.Z. No errors.

- [ ] **Step 4: Commit**

```bash
git add flake.nix flake.lock
git commit -m "build(nix): add devshell with go, buf, postgres, process-compose"
```

---

## Task 3: Bootstrap the Go module

**Files:**

- Create: `grown-workspace/go.mod`
- Create: `grown-workspace/go.sum`

- [ ] **Step 1: Initialize the module**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  go mod init code.pick.haus/grown/grown
'
```

Expected: creates `go.mod` with module path `code.pick.haus/grown/grown` and `go 1.22`.

- [ ] **Step 2: Add core dependencies**

```bash
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  go get google.golang.org/grpc@latest
  go get google.golang.org/protobuf@latest
  go get github.com/grpc-ecosystem/grpc-gateway/v2@latest
  go get github.com/jackc/pgx/v5@latest
  go get github.com/jackc/pgx/v5/pgxpool@latest
  go mod tidy
'
```

Expected: `go.mod` and `go.sum` populated. No errors.

- [ ] **Step 3: Verify `go build ./...` works on an empty module**

```bash
nix --extra-experimental-features 'nix-command flakes' develop --command go build ./...
```

Expected: succeeds silently (nothing to build yet).

- [ ] **Step 4: Commit**

```bash
git add go.mod go.sum
git commit -m "build(go): initialize go module with grpc, pgx, grpc-gateway"
```

---

## Task 4: Set up Buf for the proto pipeline

**Files:**

- Create: `grown-workspace/buf.yaml`
- Create: `grown-workspace/buf.gen.yaml`

- [ ] **Step 1: Write `buf.yaml`**

Path: `grown-workspace/buf.yaml`

```yaml
version: v2
modules:
  - path: proto
    name: buf.build/grown/grown
lint:
  use:
    - STANDARD
  except:
    - PACKAGE_VERSION_SUFFIX
breaking:
  use:
    - FILE
```

- [ ] **Step 2: Write `buf.gen.yaml`**

Path: `grown-workspace/buf.gen.yaml`

```yaml
version: v2
managed:
  enabled: true
inputs:
  - directory: proto
plugins:
  - remote: buf.build/protocolbuffers/go
    out: gen/go
    opt:
      - paths=source_relative
  - remote: buf.build/grpc/go
    out: gen/go
    opt:
      - paths=source_relative
      - require_unimplemented_servers=false
  - remote: buf.build/grpc-ecosystem/gateway
    out: gen/go
    opt:
      - paths=source_relative
      - generate_unbound_methods=true
  - remote: buf.build/grpc-ecosystem/openapiv2
    out: gen/openapi
```

- [ ] **Step 3: Verify `buf lint` runs on an empty proto tree**

```bash
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  mkdir -p proto/grown/v1
  buf lint
'
```

Expected: succeeds with no output (no protos yet → nothing to lint).

- [ ] **Step 4: Commit**

```bash
git add buf.yaml buf.gen.yaml
git commit -m "build(buf): add buf module + codegen config for go/grpc/gateway"
```

---

## Task 5: Define the Health service proto and generate code

**Files:**

- Create: `grown-workspace/proto/grown/v1/health.proto`
- Create (generated): `grown-workspace/gen/go/grown/v1/health.pb.go`
- Create (generated): `grown-workspace/gen/go/grown/v1/health_grpc.pb.go`
- Create (generated): `grown-workspace/gen/go/grown/v1/health.pb.gw.go`

- [ ] **Step 1: Write the proto file**

Path: `grown-workspace/proto/grown/v1/health.proto`

```proto
syntax = "proto3";

package grown.v1;

import "google/api/annotations.proto";

option go_package = "code.pick.haus/grown/grown/gen/go/grown/v1;grownv1";

// HealthService reports backend liveness and build information.
service HealthService {
  // Check returns build/version info and confirms the backend is up.
  rpc Check(CheckRequest) returns (CheckResponse) {
    option (google.api.http) = {
      get: "/healthz"
    };
  }
}

message CheckRequest {}

message CheckResponse {
  // Semver build version, e.g. "0.1.0".
  string version = 1;
  // Git commit SHA the binary was built from.
  string commit = 2;
  // Seconds since the process started.
  int64 uptime_seconds = 3;
}
```

- [ ] **Step 2: Lint the proto**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command buf lint
```

Expected: no errors.

- [ ] **Step 3: Generate code from proto**

```bash
nix --extra-experimental-features 'nix-command flakes' develop --command buf generate
```

Expected: creates `gen/go/grown/v1/health.pb.go`, `gen/go/grown/v1/health_grpc.pb.go`, `gen/go/grown/v1/health.pb.gw.go`, and `gen/openapi/grown/v1/health.swagger.json`. No errors.

- [ ] **Step 4: Verify the generated code compiles**

```bash
nix --extra-experimental-features 'nix-command flakes' develop --command go build ./gen/...
```

Expected: succeeds silently.

- [ ] **Step 5: Commit**

```bash
git add proto/grown/v1/health.proto
git commit -m "feat(proto): define HealthService.Check"
```

(Generated code is gitignored — regenerated by `buf generate` on demand.)

---

## Task 6: Implement the HealthService (test-first)

**Files:**

- Test: `grown-workspace/internal/health/service_test.go`
- Create: `grown-workspace/internal/health/service.go`
- Create: `grown-workspace/internal/health/MODULE.md`

- [ ] **Step 1: Write the failing test**

Path: `grown-workspace/internal/health/service_test.go`

```go
package health

import (
	"context"
	"testing"
	"time"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
)

func TestCheck_ReturnsVersionAndCommit(t *testing.T) {
	startedAt := time.Now().Add(-3 * time.Second)
	svc := NewService("1.2.3", "abc1234", startedAt)

	resp, err := svc.Check(context.Background(), &grownv1.CheckRequest{})
	if err != nil {
		t.Fatalf("Check returned error: %v", err)
	}

	if resp.GetVersion() != "1.2.3" {
		t.Errorf("version: got %q, want %q", resp.GetVersion(), "1.2.3")
	}
	if resp.GetCommit() != "abc1234" {
		t.Errorf("commit: got %q, want %q", resp.GetCommit(), "abc1234")
	}
	if resp.GetUptimeSeconds() < 3 || resp.GetUptimeSeconds() > 5 {
		t.Errorf("uptime_seconds: got %d, want roughly 3", resp.GetUptimeSeconds())
	}
}
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go test ./internal/health/...
```

Expected: FAIL because `NewService` is undefined.

- [ ] **Step 3: Implement the minimal service**

Path: `grown-workspace/internal/health/service.go`

```go
// Package health implements the HealthService gRPC API.
//
// HealthService reports backend version and uptime so operators and orchestrators
// (e.g. Kubernetes liveness probes, process-compose) can confirm the server is up.
package health

import (
	"context"
	"time"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
)

// Service implements grownv1.HealthServiceServer.
type Service struct {
	grownv1.UnimplementedHealthServiceServer

	version   string
	commit    string
	startedAt time.Time
}

// NewService constructs a HealthService with the given build identity and start time.
func NewService(version, commit string, startedAt time.Time) *Service {
	return &Service{
		version:   version,
		commit:    commit,
		startedAt: startedAt,
	}
}

// Check returns version, commit, and uptime.
func (s *Service) Check(_ context.Context, _ *grownv1.CheckRequest) (*grownv1.CheckResponse, error) {
	return &grownv1.CheckResponse{
		Version:        s.version,
		Commit:         s.commit,
		UptimeSeconds:  int64(time.Since(s.startedAt).Seconds()),
	}, nil
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
nix --extra-experimental-features 'nix-command flakes' develop --command go test ./internal/health/... -v
```

Expected: `PASS: TestCheck_ReturnsVersionAndCommit`.

- [ ] **Step 5: Write the MODULE.md**

Path: `grown-workspace/internal/health/MODULE.md`

```markdown
# internal/health

HealthService gRPC implementation. Reports build version, commit SHA, and uptime.

## Interfaces

- `NewService(version, commit string, startedAt time.Time) *Service` — constructor
- Implements `grownv1.HealthServiceServer` (one method: `Check`)

## Depends on

- `gen/go/grown/v1` — generated proto types

## Used by

- `internal/server` — registers the service on the gRPC server and gateway
```

- [ ] **Step 6: Commit**

```bash
git add internal/health/
git commit -m "feat(health): implement HealthService.Check"
```

---

## Task 7: Wire gRPC + grpc-gateway + HTTP server (test-first via http test)

**Files:**

- Create: `grown-workspace/internal/server/server.go`
- Create: `grown-workspace/internal/server/server_test.go`
- Create: `grown-workspace/internal/server/MODULE.md`
- Create: `grown-workspace/cmd/server/main.go`

- [ ] **Step 1: Write the failing test**

Path: `grown-workspace/internal/server/server_test.go`

```go
package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHealthzReturnsJSON(t *testing.T) {
	srv := New(Config{
		Version:   "test",
		Commit:    "deadbeef",
		StartedAt: time.Now(),
	})

	ts := httptest.NewServer(srv.HTTPHandler())
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status: got %d, want 200", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("not valid JSON: %v\nbody: %s", err, body)
	}
	if out["version"] != "test" {
		t.Errorf("version field: got %v, want test", out["version"])
	}
	if out["commit"] != "deadbeef" {
		t.Errorf("commit field: got %v, want deadbeef", out["commit"])
	}
	// Field name must be snake_case (proto convention), not lowerCamelCase.
	if _, ok := out["uptime_seconds"]; !ok {
		t.Errorf("expected snake_case field uptime_seconds, got keys: %v", keysOf(out))
	}
}

func keysOf(m map[string]any) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	return ks
}
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go test ./internal/server/...
```

Expected: FAIL because `New`, `Config`, `HTTPHandler` are undefined.

- [ ] **Step 3: Implement the server wiring**

Path: `grown-workspace/internal/server/server.go`

```go
// Package server wires gRPC and the grpc-gateway HTTP surface together
// for the grown-workspace backend.
package server

import (
	"context"
	"net/http"
	"time"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/encoding/protojson"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/health"
)

// Config bundles the runtime identity of the server.
type Config struct {
	Version   string
	Commit    string
	StartedAt time.Time
}

// Server holds the gRPC server and the HTTP/REST gateway mux.
type Server struct {
	grpc *grpc.Server
	mux  *runtime.ServeMux
}

// New constructs a Server with all services registered, ready to be served.
// HTTP handlers are registered on the gateway in-process (no self-dial).
//
// The marshaler uses proto field names (snake_case) so the JSON surface matches
// our proto definitions exactly — `uptime_seconds`, not `uptimeSeconds`.
func New(cfg Config) *Server {
	grpcSrv := grpc.NewServer()
	healthSvc := health.NewService(cfg.Version, cfg.Commit, cfg.StartedAt)
	grownv1.RegisterHealthServiceServer(grpcSrv, healthSvc)

	mux := runtime.NewServeMux(
		runtime.WithMarshalerOption(runtime.MIMEWildcard, &runtime.JSONPb{
			MarshalOptions: protojson.MarshalOptions{
				UseProtoNames:   true,
				EmitUnpopulated: true,
			},
			UnmarshalOptions: protojson.UnmarshalOptions{
				DiscardUnknown: true,
			},
		}),
	)
	_ = grownv1.RegisterHealthServiceHandlerServer(context.Background(), mux, healthSvc)

	return &Server{grpc: grpcSrv, mux: mux}
}

// HTTPHandler returns the HTTP/REST handler (driven by grpc-gateway).
func (s *Server) HTTPHandler() http.Handler {
	return s.mux
}

// GRPC returns the underlying *grpc.Server (for callers that want to Serve directly).
func (s *Server) GRPC() *grpc.Server {
	return s.grpc
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
nix --extra-experimental-features 'nix-command flakes' develop --command go test ./internal/server/... -v
```

Expected: `PASS: TestHealthzReturnsJSON`.

- [ ] **Step 5: Write the MODULE.md**

Path: `grown-workspace/internal/server/MODULE.md`

```markdown
# internal/server

Wires gRPC services and the grpc-gateway HTTP surface into one `*Server`.
The HTTP gateway is registered in-process (no self-dial) for V1 — when we add
auth interceptors that need a real network path, we switch to a dialed gateway.

## Interfaces

- `New(cfg Config) *Server`
- `(*Server).HTTPHandler() http.Handler` — for an external `http.Server` to use
- `(*Server).GRPC() *grpc.Server` — for an external listener to `grpc.Server.Serve(lis)` on

## Depends on

- `internal/health`
- `gen/go/grown/v1`

## Used by

- `cmd/server` — the binary entrypoint
```

- [ ] **Step 6: Write the server entrypoint**

Path: `grown-workspace/cmd/server/main.go`

```go
// Command server runs the grown-workspace backend: gRPC on 9000, HTTP/REST on 8080.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"code.pick.haus/grown/grown/internal/server"
)

var (
	// Set via -ldflags at build time. Defaults are for `go run`.
	version = "0.0.0-dev"
	commit  = "unknown"
)

func main() {
	httpAddr := flag.String("http-addr", ":8080", "HTTP/REST listen address")
	grpcAddr := flag.String("grpc-addr", ":9000", "gRPC listen address")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	startedAt := time.Now()
	srv := server.New(server.Config{Version: version, Commit: commit, StartedAt: startedAt})

	httpServer := &http.Server{
		Addr:              *httpAddr,
		Handler:           srv.HTTPHandler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	grpcLis, err := net.Listen("tcp", *grpcAddr)
	if err != nil {
		logger.Error("listen gRPC", "err", err)
		os.Exit(1)
	}

	go func() {
		logger.Info("serving gRPC", "addr", *grpcAddr)
		if err := srv.GRPC().Serve(grpcLis); err != nil && !errors.Is(err, net.ErrClosed) {
			logger.Error("gRPC serve", "err", err)
		}
	}()

	go func() {
		logger.Info("serving HTTP", "addr", *httpAddr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP serve", "err", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	logger.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
	srv.GRPC().GracefulStop()
}
```

- [ ] **Step 7: Smoke-test the server end-to-end**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  go run ./cmd/server &
  SERVER_PID=$!
  sleep 2
  echo "--- GET /healthz ---"
  curl -s http://127.0.0.1:8080/healthz | tee /tmp/grown-health.json
  echo
  echo "--- jq check ---"
  jq -e ".version == \"0.0.0-dev\" and .commit == \"unknown\"" /tmp/grown-health.json
  kill $SERVER_PID
  wait $SERVER_PID 2>/dev/null || true
'
```

Expected output: JSON body with `version`, `commit`, `uptime_seconds`. `jq` exits 0 (assertion passed).

- [ ] **Step 8: Commit**

```bash
git add internal/server/ cmd/server/
git commit -m "feat(server): wire gRPC + grpc-gateway + HTTP entrypoint"
```

---

## Task 8: Add Postgres connection + embedded migrations

**Files:**

- Create: `grown-workspace/internal/storage/postgres.go`
- Create: `grown-workspace/internal/storage/migrate.go`
- Create: `grown-workspace/internal/storage/migrate_test.go`
- Create: `grown-workspace/internal/storage/migrations/0001_init.sql`
- Create: `grown-workspace/internal/storage/MODULE.md`

- [ ] **Step 1: Write the initial migration**

Path: `grown-workspace/internal/storage/migrations/0001_init.sql`

```sql
-- Initial schema for grown-workspace.
--
-- We isolate all our tables under a `grown` schema (not `public`) so a shared
-- Postgres instance can host multiple apps without clashing.

CREATE SCHEMA IF NOT EXISTS grown;

CREATE TABLE IF NOT EXISTS grown.schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write the failing migration test**

Path: `grown-workspace/internal/storage/migrate_test.go`

```go
package storage

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestRunMigrations_AppliesInitialSchema exercises the runner against a real
// Postgres pointed at by GROWN_TEST_DSN. The migration must create the
// schema_migrations row for version 1.
func TestRunMigrations_AppliesInitialSchema(t *testing.T) {
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping integration test")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	// Clean any prior state so the test is idempotent.
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS grown CASCADE"); err != nil {
		t.Fatalf("drop schema: %v", err)
	}

	if err := RunMigrations(ctx, pool); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	var version int
	if err := pool.QueryRow(ctx, "SELECT MAX(version) FROM grown.schema_migrations").Scan(&version); err != nil {
		t.Fatalf("query: %v", err)
	}
	if version != 1 {
		t.Errorf("schema_migrations.max(version): got %d, want 1", version)
	}
}
```

- [ ] **Step 3: Write the connection helper**

Path: `grown-workspace/internal/storage/postgres.go`

```go
// Package storage provides the Postgres connection pool and the migration runner.
package storage

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool connects to Postgres using the given DSN and returns a connection pool.
func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("pgxpool.New: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return pool, nil
}
```

- [ ] **Step 4: Write the migration runner**

Path: `grown-workspace/internal/storage/migrate.go`

```go
package storage

import (
	"context"
	"embed"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type migration struct {
	version int
	name    string
	sql     string
}

// RunMigrations applies any pending migrations from the embedded migrations/ tree
// to the database. Idempotent: already-applied migrations are skipped.
func RunMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	migs, err := loadMigrations()
	if err != nil {
		return err
	}

	// Ensure the schema_migrations table exists before reading it. We do this by
	// always running migration 0001 — which is idempotent (CREATE TABLE IF NOT EXISTS).
	for _, m := range migs {
		if m.version != 1 {
			continue
		}
		if _, err := pool.Exec(ctx, m.sql); err != nil {
			return fmt.Errorf("apply migration %04d: %w", m.version, err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO grown.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`,
			m.version); err != nil {
			return fmt.Errorf("record migration %04d: %w", m.version, err)
		}
		break
	}

	// Now read which versions have been applied and run the rest in order.
	rows, err := pool.Query(ctx, `SELECT version FROM grown.schema_migrations`)
	if err != nil {
		return fmt.Errorf("read schema_migrations: %w", err)
	}
	applied := map[int]bool{}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return err
		}
		applied[v] = true
	}
	rows.Close()

	for _, m := range migs {
		if applied[m.version] {
			continue
		}
		if _, err := pool.Exec(ctx, m.sql); err != nil {
			return fmt.Errorf("apply migration %04d_%s: %w", m.version, m.name, err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO grown.schema_migrations (version) VALUES ($1)`,
			m.version); err != nil {
			return fmt.Errorf("record migration %04d: %w", m.version, err)
		}
	}
	return nil
}

func loadMigrations() ([]migration, error) {
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return nil, err
	}
	migs := make([]migration, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		// Filename format: 0001_init.sql  → version 1, name "init"
		parts := strings.SplitN(strings.TrimSuffix(e.Name(), ".sql"), "_", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("malformed migration filename: %s", e.Name())
		}
		v, err := strconv.Atoi(parts[0])
		if err != nil {
			return nil, fmt.Errorf("migration filename version not numeric: %s", e.Name())
		}
		data, err := migrationsFS.ReadFile("migrations/" + e.Name())
		if err != nil {
			return nil, err
		}
		migs = append(migs, migration{version: v, name: parts[1], sql: string(data)})
	}
	sort.Slice(migs, func(i, j int) bool { return migs[i].version < migs[j].version })
	return migs, nil
}
```

- [ ] **Step 5: Run the test against a temporary Postgres**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  # Spin up a one-off Postgres on a unix socket so we do not collide with anything.
  TMPDIR=$(mktemp -d)
  export PGDATA="$TMPDIR/pg"
  export PGHOST="$TMPDIR"
  export PGPORT=15432
  initdb --auth=trust --username=postgres -D "$PGDATA" >/dev/null
  pg_ctl -D "$PGDATA" -o "-k $TMPDIR -h 127.0.0.1 -p $PGPORT" -l "$TMPDIR/pg.log" start
  createdb -h 127.0.0.1 -p $PGPORT -U postgres grown_test
  export GROWN_TEST_DSN="postgres://postgres@127.0.0.1:$PGPORT/grown_test?sslmode=disable"
  go test ./internal/storage/... -v -run TestRunMigrations_AppliesInitialSchema
  pg_ctl -D "$PGDATA" stop -m immediate
  rm -rf "$TMPDIR"
'
```

Expected: `PASS: TestRunMigrations_AppliesInitialSchema`.

- [ ] **Step 6: Write the MODULE.md**

Path: `grown-workspace/internal/storage/MODULE.md`

```markdown
# internal/storage

Postgres connection pool + embedded migration runner.

## Interfaces

- `NewPool(ctx, dsn) (*pgxpool.Pool, error)` — connect and verify with Ping
- `RunMigrations(ctx, pool) error` — apply any unapplied embedded migrations, idempotent

## Migrations

SQL files live in `migrations/` and are embedded via `go:embed`. Filename format: `NNNN_name.sql` (zero-padded numeric version, underscore, descriptive name). Numbers must be unique and sequential.

## Depends on

- `github.com/jackc/pgx/v5`
- `github.com/jackc/pgx/v5/pgxpool`

## Used by

- `cmd/server` — calls `NewPool` and `RunMigrations` at startup
```

- [ ] **Step 7: Commit**

```bash
git add internal/storage/
git commit -m "feat(storage): add pgx pool + embedded migration runner"
```

---

## Task 9: Wire storage into the server entrypoint

**Files:**

- Modify: `grown-workspace/cmd/server/main.go`

- [ ] **Step 1: Modify `cmd/server/main.go` to connect to Postgres and run migrations at startup**

Replace `grown-workspace/cmd/server/main.go` with:

```go
// Command server runs the grown-workspace backend: gRPC on 9000, HTTP/REST on 8080.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"code.pick.haus/grown/grown/internal/server"
	"code.pick.haus/grown/grown/internal/storage"
)

var (
	// Set via -ldflags at build time. Defaults are for `go run`.
	version = "0.0.0-dev"
	commit  = "unknown"
)

func main() {
	httpAddr := flag.String("http-addr", ":8080", "HTTP/REST listen address")
	grpcAddr := flag.String("grpc-addr", ":9000", "gRPC listen address")
	dsn := flag.String("postgres-dsn", os.Getenv("GROWN_POSTGRES_DSN"), "Postgres DSN (env: GROWN_POSTGRES_DSN)")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	if *dsn == "" {
		logger.Error("postgres DSN is required (--postgres-dsn or GROWN_POSTGRES_DSN)")
		os.Exit(1)
	}

	startupCtx, startupCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer startupCancel()

	pool, err := storage.NewPool(startupCtx, *dsn)
	if err != nil {
		logger.Error("connect postgres", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := storage.RunMigrations(startupCtx, pool); err != nil {
		logger.Error("run migrations", "err", err)
		os.Exit(1)
	}
	logger.Info("migrations applied")

	startedAt := time.Now()
	srv := server.New(server.Config{Version: version, Commit: commit, StartedAt: startedAt})

	httpServer := &http.Server{
		Addr:              *httpAddr,
		Handler:           srv.HTTPHandler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	grpcLis, err := net.Listen("tcp", *grpcAddr)
	if err != nil {
		logger.Error("listen gRPC", "err", err)
		os.Exit(1)
	}

	go func() {
		logger.Info("serving gRPC", "addr", *grpcAddr)
		if err := srv.GRPC().Serve(grpcLis); err != nil && !errors.Is(err, net.ErrClosed) {
			logger.Error("gRPC serve", "err", err)
		}
	}()

	go func() {
		logger.Info("serving HTTP", "addr", *httpAddr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP serve", "err", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	logger.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
	srv.GRPC().GracefulStop()
}
```

- [ ] **Step 2: Verify the binary still builds**

```bash
nix --extra-experimental-features 'nix-command flakes' develop --command go build ./cmd/server
```

Expected: succeeds silently.

- [ ] **Step 3: Commit**

```bash
git add cmd/server/main.go
git commit -m "feat(server): connect to Postgres and run migrations at startup"
```

---

## Task 10: Set up process-compose for local dev

**Files:**

- Create: `grown-workspace/deploy/process-compose/process-compose.yaml`
- Create: `grown-workspace/deploy/process-compose/data/.gitkeep`

- [ ] **Step 1: Create the data directory placeholder**

```bash
cd /home/lucas/workspace/grown/grown-workspace
mkdir -p deploy/process-compose/data
touch deploy/process-compose/data/.gitkeep
```

- [ ] **Step 2: Write `process-compose.yaml`**

Path: `grown-workspace/deploy/process-compose/process-compose.yaml`

```yaml
version: "0.5"

processes:
  postgres-init:
    command: |
      set -e
      if [ ! -f "$PGDATA/PG_VERSION" ]; then
        initdb --auth=trust --username=$PGUSER -D "$PGDATA" --encoding=UTF8 --locale=C
      fi
    availability:
      restart: "no"

  postgres:
    command: |
      exec postgres \
        -D "$PGDATA" \
        -k "$PGHOST" \
        -h 127.0.0.1 \
        -p "$PGPORT"
    depends_on:
      postgres-init:
        condition: process_completed_successfully
    readiness_probe:
      exec:
        command: pg_isready -h 127.0.0.1 -p $PGPORT -U $PGUSER
      initial_delay_seconds: 1
      period_seconds: 1
      timeout_seconds: 5
      success_threshold: 1
      failure_threshold: 30
    availability:
      restart: on_failure

  postgres-createdb:
    command: |
      set -e
      psql -h 127.0.0.1 -p $PGPORT -U $PGUSER -d postgres -tc \
        "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" \
      | grep -q 1 || \
      createdb -h 127.0.0.1 -p $PGPORT -U $PGUSER "$PGDATABASE"
    depends_on:
      postgres:
        condition: process_healthy
    availability:
      restart: "no"

  backend:
    command: |
      exec go run ./cmd/server \
        --http-addr=:8080 \
        --grpc-addr=:9000
    environment:
      - GROWN_POSTGRES_DSN=postgres://${PGUSER}@127.0.0.1:${PGPORT}/${PGDATABASE}?sslmode=disable
    depends_on:
      postgres-createdb:
        condition: process_completed_successfully
    readiness_probe:
      http_get:
        host: 127.0.0.1
        port: 8080
        path: /healthz
      initial_delay_seconds: 2
      period_seconds: 2
      timeout_seconds: 5
      success_threshold: 1
      failure_threshold: 30
    availability:
      restart: on_failure
```

- [ ] **Step 3: Bring up the stack**

In one terminal:

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' run .#dev
```

Expected: process-compose TUI shows `postgres` running and `backend` ready. The first run will initdb (~5s).

- [ ] **Step 4: From a second terminal, hit `/healthz` and verify**

```bash
curl -s http://127.0.0.1:8080/healthz | jq .
```

Expected output (something like):

```json
{
  "version": "0.0.0-dev",
  "commit": "unknown",
  "uptime_seconds": 12
}
```

- [ ] **Step 5: Stop the stack (Ctrl+C in the process-compose terminal) and commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add deploy/
git commit -m "build(dev): add process-compose stack (postgres + backend)"
```

---

## Task 11: Browser smoke test via Playwright

**Files:**

- Create: `grown-workspace/web/e2e/package.json`
- Create: `grown-workspace/web/e2e/playwright.config.ts`
- Create: `grown-workspace/web/e2e/health.spec.ts`

- [ ] **Step 1: Write `package.json`**

Path: `grown-workspace/web/e2e/package.json`

```json
{
  "name": "grown-workspace-e2e",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test"
  },
  "dependencies": {
    "@playwright/test": "1.59.1"
  }
}
```

- [ ] **Step 2: Write `playwright.config.ts`**

Path: `grown-workspace/web/e2e/playwright.config.ts`

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.GROWN_HTTP_URL ?? "http://127.0.0.1:8080",
  },
  reporter: [["list"]],
});
```

- [ ] **Step 3: Write the failing smoke test**

Path: `grown-workspace/web/e2e/health.spec.ts`

```typescript
import { test, expect } from "@playwright/test";

test("GET /healthz returns version + commit + uptime_seconds", async ({
  request,
}) => {
  const res = await request.get("/healthz");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty("version");
  expect(body).toHaveProperty("commit");
  expect(body).toHaveProperty("uptime_seconds");
  expect(typeof body.uptime_seconds).toBe("number");
});
```

- [ ] **Step 4: Add Playwright to the Nix flake's devshell**

Edit `grown-workspace/flake.nix`. In the `packages = [ ... ]` block of the default devshell, add `pkgs.playwright-driver` and `pkgs.playwright-driver.browsers`. In `shellHook`, add:

```nix
export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1
```

(Place these inside the `shellHook = ''...''` literal, between the existing exports and the `echo` line.)

- [ ] **Step 5: Install Playwright dependencies**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/e2e
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm install --omit=optional --no-fund --no-audit
```

Expected: `added <N> packages` and no errors.

- [ ] **Step 6: Run the smoke test against the running stack**

In one terminal, bring up the stack:

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' run .#dev
```

Wait until `backend` is ready. In a second terminal:

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/e2e
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm test
```

Expected: `1 passed (<...>ms)`. Stop the stack with Ctrl+C in the first terminal.

- [ ] **Step 7: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add flake.nix flake.lock web/
git commit -m "test(e2e): add playwright smoke test for /healthz"
```

---

## Task 12: Tag v0.0.1 and write the README pointer

**Files:**

- Modify: `grown-workspace/flake.nix` (no change; tagging only)

- [ ] **Step 1: Verify the tree is clean and the test suite passes**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git status --short
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  go vet ./...
  go test ./internal/health/... ./internal/server/...
  buf lint
'
```

Expected: `git status` shows clean. `go vet`, `go test`, `buf lint` all succeed.

- [ ] **Step 2: Tag v0.0.1**

```bash
git tag -a v0.0.1 -m "v0.0.1 Foundation: nix run .#dev brings up Postgres + backend with /healthz"
git tag -l
```

Expected: `v0.0.1` appears in the tag list.

- [ ] **Step 3: Print the success summary**

```bash
git log --oneline
```

Expected: ~10 commits, ending with the most recent feature commit. Tag `v0.0.1` points at the latest commit.

---

## Self-review checklist (run before handoff)

- Spec coverage: foundational scaffolding ✓, Go + React stack scaffolded (Go side here; React in Plan 3) ✓, Postgres data layer ✓, Nix flake ✓, process-compose ✓, Playwright e2e ✓, repo structure ✓. Items deferred to later plans: auth, tenancy, dashboard UI, gam-compat, brand, multi-org routing, Helm chart.
- No placeholders.
- Types consistent: `Service`, `Config`, `Server`, `Pool`, `RunMigrations` are used consistently in tests and production code.
- Every file path is absolute or clearly relative to `grown-workspace/`.
- Frequent commits: one per task at minimum, 12 commits total expected.

---

## Done criteria for Plan 1

When all tasks are complete:

1. `grown-workspace/` exists as its own git repo with a clean tree.
2. `nix develop` from `grown-workspace/` enters a devshell with Go, Buf, Postgres, process-compose, and Playwright available.
3. `nix run .#dev` brings up Postgres (with an `initdb`-bootstrapped data dir) and the backend server. The backend connects to Postgres and applies migrations.
4. `curl http://127.0.0.1:8080/healthz` returns JSON with `version`, `commit`, `uptime_seconds`.
5. Playwright smoke test passes against the running stack.
6. `v0.0.1` tag exists.

Plan 2 (Auth + Tenancy) starts from this state.
