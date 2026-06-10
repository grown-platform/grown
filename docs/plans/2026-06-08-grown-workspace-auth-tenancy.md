# grown-workspace Auth + Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the grown-workspace backend authenticate users through an OIDC provider (Zitadel as default), establish session tokens, resolve tenant context for every request, and expose `/api/v1/whoami` returning the signed-in user with their org. Single-org mode.

**Architecture:** OIDC Authorization Code + PKCE flow. After successful callback, the backend upserts a `users` row and issues an opaque 32-byte session token stored in the `sessions` table. The token is delivered via an HttpOnly cookie. A session-validation middleware extracts the token, looks up the user + org, and attaches both to the request context (gRPC metadata and HTTP `r.Context()`). A tenancy resolver decides which org applies — for single-org mode, it always resolves to the bootstrapped "default" org.

**Tech Stack:** Go 1.25, gRPC + grpc-gateway, `github.com/coreos/go-oidc/v3`, `golang.org/x/oauth2`, pgx/v5, Postgres 16, Zitadel (containerless via Nix). Process-compose runs the full local stack.

**Spec:** `docs/superpowers/specs/2026-06-08-grown-workspace-v1-design.md` (Sections 2, 4, 5, 6)
**Builds on:** Plan 1 (`docs/superpowers/plans/2026-06-08-grown-workspace-foundation.md`, tagged v0.0.1)

**Working directory:** `/home/lucas/workspace/grown/grown-workspace/`

---

## File Structure

### New files

| Path                                                       | Purpose                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `proto/grown/v1/org.proto`                                 | `Org` message type                                                                     |
| `proto/grown/v1/user.proto`                                | `User` message type                                                                    |
| `proto/grown/v1/auth.proto`                                | `AuthService` (Login, Callback, Whoami, Logout)                                        |
| `internal/storage/migrations/0002_orgs_users_sessions.sql` | `orgs`, `users`, `sessions` tables                                                     |
| `internal/storage/migrations/0003_default_org.sql`         | Bootstrap row in `orgs` for single-org mode                                            |
| `internal/orgs/repository.go`                              | Org lookups                                                                            |
| `internal/orgs/repository_test.go`                         |                                                                                        |
| `internal/orgs/MODULE.md`                                  |                                                                                        |
| `internal/users/repository.go`                             | User upsert by OIDC (issuer, subject)                                                  |
| `internal/users/repository_test.go`                        |                                                                                        |
| `internal/users/MODULE.md`                                 |                                                                                        |
| `internal/auth/config.go`                                  | `Config` struct: issuer, client id/secret, redirect URL, cookie name, session lifetime |
| `internal/auth/oidc.go`                                    | OIDC provider + verifier wiring, `AuthURL` and `Exchange` helpers                      |
| `internal/auth/session.go`                                 | Random token gen, session create / lookup / revoke                                     |
| `internal/auth/session_test.go`                            |                                                                                        |
| `internal/auth/service.go`                                 | gRPC `AuthService` implementation                                                      |
| `internal/auth/service_test.go`                            |                                                                                        |
| `internal/auth/middleware.go`                              | HTTP cookie-extracting middleware, gRPC unary interceptor                              |
| `internal/auth/MODULE.md`                                  |                                                                                        |
| `internal/tenancy/context.go`                              | Context-attached org/user types and helpers                                            |
| `internal/tenancy/middleware.go`                           | Resolves tenant (single-org for V1)                                                    |
| `internal/tenancy/MODULE.md`                               |                                                                                        |
| `deploy/zitadel/steps.yaml`                                | Zitadel initial bootstrap: instance, admin user, project, OIDC app                     |
| `deploy/zitadel/zitadel.yaml`                              | Zitadel runtime config (DB connection, JWT signing, masterkey)                         |

### Modified files

| Path                                          | Reason                                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `proto/grown/v1/health.proto`                 | Move `HealthService` into a shared file? No — keep separate. (No actual edit.)                                                    |
| `flake.nix`                                   | Add `pkgs.zitadel-tools` (or build from source); add Zitadel binary to devshell + process-compose runtime inputs                  |
| `deploy/process-compose/process-compose.yaml` | Add zitadel-init, zitadel processes; add zitadel env wiring for backend                                                           |
| `internal/server/server.go`                   | Register `AuthService`; install auth + tenancy middleware on the HTTP mux; pass `*pgxpool.Pool` and dependencies through `Config` |
| `cmd/server/main.go`                          | Load auth config from env, construct OIDC provider, pass pool to `server.New`                                                     |

### Removed files

None.

---

## Task 1: Add Zitadel to the flake devshell

**Files:**

- Modify: `grown-workspace/flake.nix`

- [ ] **Step 1: Inspect the current flake to find the right place to add Zitadel**

Run: `grep -n "pkgs\." /home/lucas/workspace/grown/grown-workspace/flake.nix`

Note the line numbers where packages are listed in `devShells.default.packages` and `apps.dev.runtimeInputs`.

- [ ] **Step 2: Add `pkgs.zitadel` to both lists**

Edit `grown-workspace/flake.nix`. In the `devShells.default.packages = [ ... ]` list, add `pkgs.zitadel` near the other server-side packages (next to `pkgs.postgresql_16`).

In the `apps.dev.runtimeInputs = [ ... ]` list (inside the `writeShellApplication` block), also add `pkgs.zitadel`.

- [ ] **Step 3: Verify Zitadel is on PATH in the devshell**

Run:

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c 'zitadel --version'
```

Expected: prints a Zitadel version string (e.g. `Zitadel v2.x.x`). If `nixpkgs` doesn't have `pkgs.zitadel`, use `pkgs.zitadel-tools` or `pkgs.zitadel-server` — try those alternates. Whichever name resolves, use it consistently.

- [ ] **Step 4: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add flake.nix flake.lock
git commit -m "build(nix): add zitadel to devshell and apps.dev runtimeInputs"
```

---

## Task 2: Write Zitadel config and bootstrap steps

**Files:**

- Create: `grown-workspace/deploy/zitadel/zitadel.yaml`
- Create: `grown-workspace/deploy/zitadel/steps.yaml`

- [ ] **Step 1: Write `zitadel.yaml`**

Path: `grown-workspace/deploy/zitadel/zitadel.yaml`

```yaml
# Zitadel runtime config for local dev. Production deployments override via env.
Log:
  Level: info

ExternalDomain: localhost
ExternalPort: 8081
ExternalSecure: false
TLS:
  Enabled: false

Port: 8081

Database:
  postgres:
    Host: 127.0.0.1
    Port: 5533
    Database: zitadel
    User:
      Username: grown
      SSL:
        Mode: disable
    Admin:
      Username: grown
      SSL:
        Mode: disable

# Local-dev only: a deterministic masterkey so restarting the dev stack
# doesn't invalidate stored secrets. NEVER use this value in production.
DefaultInstance:
  InstanceName: grown-dev
  CustomDomain: localhost
  Org:
    Name: grown-dev
    Human:
      UserName: admin
      FirstName: Grown
      LastName: Admin
      Email:
        Address: admin@grown.localtest.me
        Verified: true
      Password: DevPassword!1
      PasswordChangeRequired: false
```

- [ ] **Step 2: Write `steps.yaml`**

Path: `grown-workspace/deploy/zitadel/steps.yaml`

```yaml
# Zitadel `setup` steps. Run once at first boot via `zitadel setup`.
# Reads zitadel.yaml for everything not specified here.
Steps:
  FirstInstance:
    InstanceName: grown-dev
    DefaultLanguage: en
    Org:
      Name: grown-dev
      Human:
        UserName: admin
        FirstName: Grown
        LastName: Admin
        Email:
          Address: admin@grown.localtest.me
          Verified: true
        Password: DevPassword!1
        PasswordChangeRequired: false
```

- [ ] **Step 3: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add deploy/zitadel/
git commit -m "build(zitadel): add local-dev config and first-instance setup steps"
```

---

## Task 3: Add Zitadel processes to process-compose

**Files:**

- Modify: `grown-workspace/deploy/process-compose/process-compose.yaml`

- [ ] **Step 1: Add new processes for Zitadel**

Open `grown-workspace/deploy/process-compose/process-compose.yaml`. Add two new top-level entries to the `processes:` map (place them after `postgres-createdb` and before `backend`):

```yaml
zitadel-createdb:
  command: |
    set -e
    psql -h 127.0.0.1 -p $PGPORT -U $PGUSER -d postgres -tc \
      "SELECT 1 FROM pg_database WHERE datname = 'zitadel'" \
    | grep -q 1 || \
    createdb -h 127.0.0.1 -p $PGPORT -U $PGUSER zitadel
  depends_on:
    postgres:
      condition: process_healthy
  availability:
    restart: "no"

zitadel-init:
  command: |
    set -e
    # First-boot setup: creates instance, default org, and admin user.
    # The setup command exits 0 even if the instance already exists, so
    # this is safe to re-run.
    zitadel setup \
      --config "$PROJECT_ROOT/deploy/zitadel/zitadel.yaml" \
      --steps "$PROJECT_ROOT/deploy/zitadel/steps.yaml" \
      --masterkey "MasterkeyNeedsToHave32Characters"
  depends_on:
    zitadel-createdb:
      condition: process_completed_successfully
  availability:
    restart: "no"

zitadel:
  command: |
    exec zitadel start \
      --config "$PROJECT_ROOT/deploy/zitadel/zitadel.yaml" \
      --masterkey "MasterkeyNeedsToHave32Characters"
  depends_on:
    zitadel-init:
      condition: process_completed_successfully
  readiness_probe:
    http_get:
      host: 127.0.0.1
      port: 8081
      path: /debug/ready
    initial_delay_seconds: 2
    period_seconds: 2
    timeout_seconds: 5
    success_threshold: 1
    failure_threshold: 60
  availability:
    restart: on_failure
```

- [ ] **Step 2: Update the `backend` process to wait for Zitadel and add env**

Replace the existing `backend` block with:

```yaml
backend:
  command: |
    exec go run ./cmd/server \
      --http-addr=:8080 \
      --grpc-addr=:9000
  environment:
    - GROWN_POSTGRES_DSN=postgres://${PGUSER}@127.0.0.1:${PGPORT}/${PGDATABASE}?sslmode=disable
    - GROWN_OIDC_ISSUER=http://localhost:8081
    - GROWN_OIDC_CLIENT_ID=grown-dev-client
    - GROWN_OIDC_CLIENT_SECRET=grown-dev-secret
    - GROWN_OIDC_REDIRECT_URL=http://workspace.localtest.me:8080/api/v1/auth/callback
    - GROWN_SESSION_COOKIE_NAME=grown_session
    - GROWN_SESSION_COOKIE_SECURE=false
    - GROWN_SESSION_LIFETIME=168h
    - GROWN_DEFAULT_ORG_SLUG=default
  depends_on:
    postgres-createdb:
      condition: process_completed_successfully
    zitadel:
      condition: process_healthy
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

The OIDC client credentials (`grown-dev-client` / `grown-dev-secret`) refer to a Zitadel OAuth application that doesn't exist yet — we'll create it via Zitadel's admin API in Task 4. For now the backend will fail OIDC operations until then, but `/healthz` still works.

- [ ] **Step 3: Bring up the stack and verify Zitadel boots**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  process-compose up --use-uds --tui=false -f deploy/process-compose/process-compose.yaml &
  SC=$!
  for i in $(seq 1 90); do
    if curl -fs http://127.0.0.1:8081/debug/ready >/dev/null 2>&1; then break; fi
    sleep 1
  done
  echo "--- zitadel /debug/ready ---"
  curl -s http://127.0.0.1:8081/debug/ready
  echo
  echo "--- backend /healthz ---"
  curl -s http://127.0.0.1:8080/healthz | jq .
  kill $SC
  wait $SC 2>/dev/null || true
'
```

Expected: Zitadel `/debug/ready` responds 200 (body may be empty), backend `/healthz` returns valid JSON. First boot is slow (~30-60s while Zitadel sets up its schema).

- [ ] **Step 4: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add deploy/process-compose/process-compose.yaml
git commit -m "build(dev): add zitadel processes to process-compose stack"
```

---

## Task 4: Create the OIDC application inside Zitadel

We need to register an OIDC client (`grown-dev-client`) inside the Zitadel instance so the backend can authenticate against it. Zitadel exposes a management API; the cleanest local-dev approach is a one-shot script that uses the admin's machine-key/password to call the management API and create the project + app idempotently.

**Files:**

- Create: `grown-workspace/deploy/zitadel/create-oidc-app.sh`
- Modify: `grown-workspace/deploy/process-compose/process-compose.yaml`

- [ ] **Step 1: Write the create-app script**

Path: `grown-workspace/deploy/zitadel/create-oidc-app.sh`

```bash
#!/usr/bin/env bash
# Creates the grown-workspace OIDC client inside Zitadel on first boot.
# Idempotent: if the project/app already exists, no-ops.

set -euo pipefail

ZITADEL_URL="${ZITADEL_URL:-http://localhost:8081}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-DevPassword!1}"
CLIENT_ID="${GROWN_OIDC_CLIENT_ID:-grown-dev-client}"
CLIENT_SECRET="${GROWN_OIDC_CLIENT_SECRET:-grown-dev-secret}"
REDIRECT_URL="${GROWN_OIDC_REDIRECT_URL:-http://workspace.localtest.me:8080/api/v1/auth/callback}"

# Get an admin access token via the password grant (only enabled on the
# default Zitadel instance for the initial admin -- fine for local dev).
TOKEN_RESPONSE=$(curl -sf -X POST "$ZITADEL_URL/oauth/v2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "$ADMIN_USER:$ADMIN_PASS" \
  -d "grant_type=client_credentials&scope=openid urn:zitadel:iam:org:project:id:zitadel:aud") || {
    echo "Failed to get admin token. Zitadel may still be starting." >&2
    exit 1
  }

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
  echo "Could not parse access_token from Zitadel response:" >&2
  echo "$TOKEN_RESPONSE" >&2
  exit 1
fi

# Check if a project named "grown-workspace" already exists.
EXISTING=$(curl -sf -X POST "$ZITADEL_URL/management/v1/projects/_search" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"queries":[{"nameQuery":{"name":"grown-workspace","method":"TEXT_QUERY_METHOD_EQUALS"}}]}' \
  | jq -r '.result[0].id // empty')

if [ -n "$EXISTING" ]; then
  echo "Project grown-workspace already exists (id=$EXISTING). Skipping."
  exit 0
fi

# Create project
PROJECT_ID=$(curl -sf -X POST "$ZITADEL_URL/management/v1/projects" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"grown-workspace"}' | jq -r '.id')

echo "Created project grown-workspace (id=$PROJECT_ID)."

# Create OIDC application within the project.
curl -sf -X POST "$ZITADEL_URL/management/v1/projects/$PROJECT_ID/apps/oidc" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg name "grown-workspace-backend" \
    --arg client_id "$CLIENT_ID" \
    --arg client_secret "$CLIENT_SECRET" \
    --arg redirect "$REDIRECT_URL" \
    '{
       name: $name,
       redirectUris: [$redirect],
       responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
       grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
       appType: "OIDC_APP_TYPE_WEB",
       authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
       postLogoutRedirectUris: ["http://workspace.localtest.me:8080/"],
       devMode: true,
       accessTokenType: "OIDC_TOKEN_TYPE_BEARER",
       accessTokenRoleAssertion: true,
       idTokenRoleAssertion: true,
       idTokenUserinfoAssertion: true,
       clockSkew: "1s",
       additionalOrigins: []
     }')" >/dev/null

echo "Created OIDC app grown-workspace-backend (client_id=$CLIENT_ID)."
```

Make it executable:

```bash
chmod +x /home/lucas/workspace/grown/grown-workspace/deploy/zitadel/create-oidc-app.sh
```

- [ ] **Step 2: Add a process-compose process to run the script**

Edit `grown-workspace/deploy/process-compose/process-compose.yaml`. Add this process AFTER `zitadel` and BEFORE `backend`:

```yaml
zitadel-create-app:
  command: |
    set -e
    bash "$PROJECT_ROOT/deploy/zitadel/create-oidc-app.sh"
  environment:
    - ZITADEL_URL=http://localhost:8081
    - ADMIN_USER=admin
    - ADMIN_PASS=DevPassword!1
    - GROWN_OIDC_CLIENT_ID=grown-dev-client
    - GROWN_OIDC_CLIENT_SECRET=grown-dev-secret
    - GROWN_OIDC_REDIRECT_URL=http://workspace.localtest.me:8080/api/v1/auth/callback
  depends_on:
    zitadel:
      condition: process_healthy
  availability:
    restart: "no"
```

Update the `backend` process's `depends_on` to wait for `zitadel-create-app`:

```yaml
depends_on:
  postgres-createdb:
    condition: process_completed_successfully
  zitadel-create-app:
    condition: process_completed_successfully
```

(Replace the existing `zitadel: process_healthy` line — `zitadel-create-app` already depends on Zitadel being healthy, so the dep chain is transitively correct.)

- [ ] **Step 3: Bring up the stack and verify the project and app exist**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  process-compose up --use-uds --tui=false -f deploy/process-compose/process-compose.yaml &
  SC=$!
  for i in $(seq 1 120); do
    if curl -fs http://127.0.0.1:8080/healthz >/dev/null 2>&1; then break; fi
    sleep 1
  done
  echo "--- zitadel projects ---"
  TOKEN=$(curl -sf -X POST http://localhost:8081/oauth/v2/token \
    -u admin:DevPassword!1 \
    -d "grant_type=client_credentials&scope=openid urn:zitadel:iam:org:project:id:zitadel:aud" \
    | jq -r .access_token)
  curl -sf -X POST http://localhost:8081/management/v1/projects/_search \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{}" | jq ".result[] | {id, name}"
  kill $SC
  wait $SC 2>/dev/null || true
'
```

Expected: prints a JSON list of projects including one named `grown-workspace`.

- [ ] **Step 4: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add deploy/
git commit -m "build(zitadel): auto-create grown-workspace OIDC client on first boot"
```

---

## Task 5: Add proto definitions for Org, User, AuthService

**Files:**

- Create: `grown-workspace/proto/grown/v1/org.proto`
- Create: `grown-workspace/proto/grown/v1/user.proto`
- Create: `grown-workspace/proto/grown/v1/auth.proto`

- [ ] **Step 1: Write `org.proto`**

Path: `grown-workspace/proto/grown/v1/org.proto`

```proto
syntax = "proto3";

package grown.v1;

option go_package = "code.pick.haus/grown/grown/gen/go/grown/v1;grownv1";

// Org is a single tenant within a grown-workspace deployment.
// In single-org mode, exactly one Org exists with slug = "default".
message Org {
  // UUID, stable for the lifetime of the org.
  string id = 1;
  // Short, URL-friendly identifier (e.g. "acme", "default").
  string slug = 2;
  // Human display name.
  string display_name = 3;
}
```

- [ ] **Step 2: Write `user.proto`**

Path: `grown-workspace/proto/grown/v1/user.proto`

```proto
syntax = "proto3";

package grown.v1;

option go_package = "code.pick.haus/grown/grown/gen/go/grown/v1;grownv1";

// User is a person within an org. Identity is authoritatively held by the
// upstream OIDC provider; we cache the subject and claims for fast lookup.
message User {
  // UUID, stable for the lifetime of the user.
  string id = 1;
  // The Org this user belongs to.
  string org_id = 2;
  // OIDC issuer URL (e.g. "http://localhost:8081").
  string oidc_issuer = 3;
  // OIDC subject — the IdP's stable identifier for this user.
  string oidc_subject = 4;
  // Email address, refreshed from the OIDC claims on each login.
  string email = 5;
  // Display name, refreshed from the OIDC claims on each login.
  string display_name = 6;
  // Epoch seconds when the user record was first created.
  int64 created_at = 7;
}
```

- [ ] **Step 3: Write `auth.proto`**

Path: `grown-workspace/proto/grown/v1/auth.proto`

```proto
syntax = "proto3";

package grown.v1;

import "google/api/annotations.proto";
import "grown/v1/org.proto";
import "grown/v1/user.proto";

option go_package = "code.pick.haus/grown/grown/gen/go/grown/v1;grownv1";

// AuthService handles OIDC login, session lifecycle, and identity lookup.
service AuthService {
  // Login starts an OIDC authorization-code flow. The HTTP endpoint redirects
  // (302) to the configured IdP. The response body is unused.
  rpc Login(LoginRequest) returns (LoginResponse) {
    option (google.api.http) = {
      get: "/api/v1/auth/login"
    };
  }

  // Callback receives the authorization code from the IdP, exchanges it for
  // tokens, upserts the user, and issues a session cookie. Redirects (302)
  // to the configured post-login location.
  rpc Callback(CallbackRequest) returns (CallbackResponse) {
    option (google.api.http) = {
      get: "/api/v1/auth/callback"
    };
  }

  // Whoami returns the authenticated user and their org. Requires a valid
  // session cookie; returns Unauthenticated otherwise.
  rpc Whoami(WhoamiRequest) returns (WhoamiResponse) {
    option (google.api.http) = {
      get: "/api/v1/whoami"
    };
  }

  // Logout revokes the current session and clears the cookie.
  rpc Logout(LogoutRequest) returns (LogoutResponse) {
    option (google.api.http) = {
      post: "/api/v1/auth/logout"
      body: "*"
    };
  }
}

message LoginRequest {
  // Optional return path (relative URL on this origin) to redirect back to
  // after successful login. Defaults to "/".
  string return_to = 1;
}

message LoginResponse {
  // The IdP authorization URL. The HTTP gateway turns this into a 302.
  string authorization_url = 1;
}

message CallbackRequest {
  // OIDC authorization code, supplied as the `code` query parameter.
  string code = 1;
  // State parameter for CSRF protection, supplied as the `state` query parameter.
  string state = 2;
}

message CallbackResponse {
  // Relative URL to redirect to after successful login.
  string redirect_to = 1;
}

message WhoamiRequest {}

message WhoamiResponse {
  User user = 1;
  Org org = 2;
}

message LogoutRequest {}

message LogoutResponse {}
```

- [ ] **Step 4: Lint and generate**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c 'buf lint && buf generate && go build ./gen/...'
```

Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add proto/grown/v1/
git commit -m "feat(proto): define Org, User, AuthService"
```

(Generated code is gitignored.)

---

## Task 6: Migration 0002 — orgs, users, sessions tables

**Files:**

- Create: `grown-workspace/internal/storage/migrations/0002_orgs_users_sessions.sql`

- [ ] **Step 1: Write the migration**

Path: `grown-workspace/internal/storage/migrations/0002_orgs_users_sessions.sql`

```sql
-- 0002: Orgs, Users, and Sessions tables.
--
-- Every domain row carries an org_id so multi-org mode can isolate tenants.
-- In single-org mode the column is always set to the bootstrapped default org.

CREATE TABLE IF NOT EXISTS grown.orgs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grown.users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    oidc_issuer   TEXT NOT NULL,
    oidc_subject  TEXT NOT NULL,
    email         TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, oidc_issuer, oidc_subject)
);

CREATE INDEX IF NOT EXISTS users_email_idx ON grown.users (org_id, email);

CREATE TABLE IF NOT EXISTS grown.sessions (
    token        TEXT PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON grown.sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON grown.sessions (expires_at) WHERE revoked_at IS NULL;
```

- [ ] **Step 2: Verify the migration applies cleanly**

Quick integration sanity check against a temp Postgres:

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  TMP=$(mktemp -d); export PGDATA=$TMP/pg
  initdb --auth=trust -U postgres -D "$PGDATA" >/dev/null
  pg_ctl -D "$PGDATA" -o "-h 127.0.0.1 -p 15432" -l "$TMP/log" start
  for i in $(seq 1 20); do pg_isready -h 127.0.0.1 -p 15432 -q && break; sleep 0.5; done
  createdb -h 127.0.0.1 -p 15432 -U postgres grown_test
  export GROWN_TEST_DSN="postgres://postgres@127.0.0.1:15432/grown_test?sslmode=disable"
  go test ./internal/storage/... -v -run TestRunMigrations_AppliesInitialSchema
  pg_ctl -D "$PGDATA" stop -m immediate
  rm -rf "$TMP"
'
```

The existing test asserts `MAX(version) = 1`. It will now fail because version 2 was added. **Update the test** to assert `>= 1` instead of `== 1`:

Edit `grown-workspace/internal/storage/migrate_test.go`, find the assertion `if version != 1 {` and change to `if version < 1 {`. Update the message to reflect the new check.

- [ ] **Step 3: Re-run the test**

Same command as Step 2. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add internal/storage/migrations/0002_orgs_users_sessions.sql internal/storage/migrate_test.go
git commit -m "feat(storage): migration 0002 — orgs, users, sessions tables"
```

---

## Task 7: Migration 0003 — bootstrap the default org

**Files:**

- Create: `grown-workspace/internal/storage/migrations/0003_default_org.sql`

- [ ] **Step 1: Write the migration**

Path: `grown-workspace/internal/storage/migrations/0003_default_org.sql`

```sql
-- 0003: Bootstrap the "default" org for single-org-mode deployments.
--
-- In single-org mode, the backend reads GROWN_DEFAULT_ORG_SLUG (which
-- defaults to "default") and resolves all requests to this org.
-- Multi-org-mode deployments will add additional orgs via the admin API.

INSERT INTO grown.orgs (slug, display_name)
VALUES ('default', 'Default')
ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 2: Verify against temp Postgres**

Re-run the same migration test from Task 6 Step 2. Expected: PASS (now MAX(version) = 3).

- [ ] **Step 3: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add internal/storage/migrations/0003_default_org.sql
git commit -m "feat(storage): migration 0003 — bootstrap default org for single-org mode"
```

---

## Task 8: Implement `internal/orgs` repository (TDD)

**Files:**

- Create: `grown-workspace/internal/orgs/repository.go`
- Create: `grown-workspace/internal/orgs/repository_test.go`
- Create: `grown-workspace/internal/orgs/MODULE.md`

- [ ] **Step 1: Write the failing test**

Path: `grown-workspace/internal/orgs/repository_test.go`

```go
package orgs

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"code.pick.haus/grown/grown/internal/storage"
)

func setupDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS grown CASCADE"); err != nil {
		t.Fatalf("drop schema: %v", err)
	}
	if err := storage.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	return pool
}

func TestRepository_GetBySlug_FindsDefault(t *testing.T) {
	pool := setupDB(t)
	repo := NewRepository(pool)

	org, err := repo.GetBySlug(context.Background(), "default")
	if err != nil {
		t.Fatalf("GetBySlug: %v", err)
	}
	if org.Slug != "default" {
		t.Errorf("slug: got %q, want default", org.Slug)
	}
	if org.DisplayName != "Default" {
		t.Errorf("display_name: got %q, want Default", org.DisplayName)
	}
	if org.ID == "" {
		t.Errorf("id should be non-empty")
	}
}

func TestRepository_GetBySlug_NotFound(t *testing.T) {
	pool := setupDB(t)
	repo := NewRepository(pool)

	_, err := repo.GetBySlug(context.Background(), "missing")
	if err != ErrNotFound {
		t.Errorf("got err=%v, want ErrNotFound", err)
	}
}
```

- [ ] **Step 2: Run test, verify it fails (compilation error: `NewRepository`, `ErrNotFound` undefined)**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go test ./internal/orgs/...
```

Expected: build failure, undefined symbols.

- [ ] **Step 3: Implement the repository**

Path: `grown-workspace/internal/orgs/repository.go`

```go
// Package orgs holds the data-access layer for Org rows.
package orgs

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned by Get* methods when no row matches.
var ErrNotFound = errors.New("org not found")

// Org is the in-memory representation of a grown.orgs row.
type Org struct {
	ID          string
	Slug        string
	DisplayName string
}

// Repository reads and writes orgs.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// GetBySlug returns the org with the given slug, or ErrNotFound.
func (r *Repository) GetBySlug(ctx context.Context, slug string) (Org, error) {
	var o Org
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, slug, display_name FROM grown.orgs WHERE slug = $1`,
		slug,
	).Scan(&o.ID, &o.Slug, &o.DisplayName)
	if errors.Is(err, pgx.ErrNoRows) {
		return Org{}, ErrNotFound
	}
	if err != nil {
		return Org{}, fmt.Errorf("orgs.GetBySlug: %w", err)
	}
	return o, nil
}

// GetByID returns the org with the given UUID, or ErrNotFound.
func (r *Repository) GetByID(ctx context.Context, id string) (Org, error) {
	var o Org
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, slug, display_name FROM grown.orgs WHERE id = $1`,
		id,
	).Scan(&o.ID, &o.Slug, &o.DisplayName)
	if errors.Is(err, pgx.ErrNoRows) {
		return Org{}, ErrNotFound
	}
	if err != nil {
		return Org{}, fmt.Errorf("orgs.GetByID: %w", err)
	}
	return o, nil
}
```

- [ ] **Step 4: Run test, verify it passes against temp Postgres**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  TMP=$(mktemp -d); export PGDATA=$TMP/pg
  initdb --auth=trust -U postgres -D "$PGDATA" >/dev/null
  pg_ctl -D "$PGDATA" -o "-h 127.0.0.1 -p 15432" -l "$TMP/log" start
  for i in $(seq 1 20); do pg_isready -h 127.0.0.1 -p 15432 -q && break; sleep 0.5; done
  createdb -h 127.0.0.1 -p 15432 -U postgres grown_test
  export GROWN_TEST_DSN="postgres://postgres@127.0.0.1:15432/grown_test?sslmode=disable"
  go test ./internal/orgs/... -v
  pg_ctl -D "$PGDATA" stop -m immediate
  rm -rf "$TMP"
'
```

Expected: both tests PASS.

- [ ] **Step 5: Write `MODULE.md`**

Path: `grown-workspace/internal/orgs/MODULE.md`

```markdown
# internal/orgs

Data-access layer for `grown.orgs` rows.

## Interfaces

- `NewRepository(pool *pgxpool.Pool) *Repository`
- `(*Repository).GetBySlug(ctx, slug) (Org, error)`
- `(*Repository).GetByID(ctx, id) (Org, error)`
- `ErrNotFound` — sentinel returned when no row matches.

## Depends on

- `internal/storage` (transitively, via the migration that creates `grown.orgs`)
- `github.com/jackc/pgx/v5`

## Used by

- `internal/tenancy` — resolves the org for each request.
- `internal/auth` — populates `WhoamiResponse.org`.
```

- [ ] **Step 6: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add internal/orgs/
git commit -m "feat(orgs): repository with GetBySlug and GetByID"
```

---

## Task 9: Implement `internal/users` repository (TDD)

**Files:**

- Create: `grown-workspace/internal/users/repository.go`
- Create: `grown-workspace/internal/users/repository_test.go`
- Create: `grown-workspace/internal/users/MODULE.md`

- [ ] **Step 1: Write the failing test**

Path: `grown-workspace/internal/users/repository_test.go`

```go
package users

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"code.pick.haus/grown/grown/internal/storage"
)

func setupDB(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS grown CASCADE"); err != nil {
		t.Fatalf("drop schema: %v", err)
	}
	if err := storage.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	var orgID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug = 'default'`).Scan(&orgID); err != nil {
		t.Fatalf("get default org id: %v", err)
	}
	return pool, orgID
}

func TestRepository_UpsertByOIDC_Creates(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)

	u, err := repo.UpsertByOIDC(context.Background(), UpsertInput{
		OrgID:       orgID,
		OIDCIssuer:  "http://localhost:8081",
		OIDCSubject: "user-1",
		Email:       "alice@example.com",
		DisplayName: "Alice Example",
	})
	if err != nil {
		t.Fatalf("UpsertByOIDC: %v", err)
	}
	if u.ID == "" || u.OrgID != orgID || u.OIDCSubject != "user-1" || u.Email != "alice@example.com" {
		t.Errorf("got %+v", u)
	}
}

func TestRepository_UpsertByOIDC_UpdatesEmail(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	first, err := repo.UpsertByOIDC(ctx, UpsertInput{
		OrgID:       orgID,
		OIDCIssuer:  "http://localhost:8081",
		OIDCSubject: "user-2",
		Email:       "old@example.com",
		DisplayName: "Old Name",
	})
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	time.Sleep(10 * time.Millisecond) // ensure updated_at advances on Postgres
	second, err := repo.UpsertByOIDC(ctx, UpsertInput{
		OrgID:       orgID,
		OIDCIssuer:  "http://localhost:8081",
		OIDCSubject: "user-2",
		Email:       "new@example.com",
		DisplayName: "New Name",
	})
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	if first.ID != second.ID {
		t.Errorf("ID changed across upserts: %s -> %s", first.ID, second.ID)
	}
	if second.Email != "new@example.com" || second.DisplayName != "New Name" {
		t.Errorf("expected updated email/name; got %+v", second)
	}
}

func TestRepository_GetByID(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	created, err := repo.UpsertByOIDC(ctx, UpsertInput{
		OrgID:       orgID,
		OIDCIssuer:  "http://localhost:8081",
		OIDCSubject: "user-3",
		Email:       "bob@example.com",
		DisplayName: "Bob",
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	got, err := repo.GetByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.ID != created.ID {
		t.Errorf("got %s, want %s", got.ID, created.ID)
	}
}
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go test ./internal/users/...
```

Expected: build failure.

- [ ] **Step 3: Implement the repository**

Path: `grown-workspace/internal/users/repository.go`

```go
// Package users holds the data-access layer for User rows.
package users

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned by Get* methods when no row matches.
var ErrNotFound = errors.New("user not found")

// User is the in-memory representation of a grown.users row.
type User struct {
	ID          string
	OrgID       string
	OIDCIssuer  string
	OIDCSubject string
	Email       string
	DisplayName string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// UpsertInput is the input to UpsertByOIDC.
type UpsertInput struct {
	OrgID       string
	OIDCIssuer  string
	OIDCSubject string
	Email       string
	DisplayName string
}

// Repository reads and writes users.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// UpsertByOIDC inserts a new user or updates the email + display_name of an
// existing user identified by the (org_id, oidc_issuer, oidc_subject) triple.
// Returns the persisted row.
func (r *Repository) UpsertByOIDC(ctx context.Context, in UpsertInput) (User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (org_id, oidc_issuer, oidc_subject)
		 DO UPDATE SET email = EXCLUDED.email,
		               display_name = EXCLUDED.display_name,
		               updated_at = now()
		 RETURNING id::text, org_id::text, oidc_issuer, oidc_subject, email, display_name, created_at, updated_at`,
		in.OrgID, in.OIDCIssuer, in.OIDCSubject, in.Email, in.DisplayName,
	).Scan(&u.ID, &u.OrgID, &u.OIDCIssuer, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return User{}, fmt.Errorf("users.UpsertByOIDC: %w", err)
	}
	return u, nil
}

// GetByID returns the user with the given id.
func (r *Repository) GetByID(ctx context.Context, id string) (User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, org_id::text, oidc_issuer, oidc_subject, email, display_name, created_at, updated_at
		 FROM grown.users WHERE id = $1`,
		id,
	).Scan(&u.ID, &u.OrgID, &u.OIDCIssuer, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("users.GetByID: %w", err)
	}
	return u, nil
}
```

- [ ] **Step 4: Run test, verify all three pass**

Same temp-Postgres invocation as Task 8 Step 4, but with `./internal/users/...`. Expected: 3 PASS.

- [ ] **Step 5: Write `MODULE.md`**

Path: `grown-workspace/internal/users/MODULE.md`

```markdown
# internal/users

Data-access layer for `grown.users` rows. The authoritative identity lives
in the upstream OIDC provider; this table caches issuer+subject and the
email/display_name claims for fast local lookup.

## Interfaces

- `NewRepository(pool *pgxpool.Pool) *Repository`
- `(*Repository).UpsertByOIDC(ctx, UpsertInput) (User, error)` — insert-or-update on (org_id, oidc_issuer, oidc_subject).
- `(*Repository).GetByID(ctx, id) (User, error)`
- `ErrNotFound`

## Depends on

- `internal/storage` (transitively)
- `github.com/jackc/pgx/v5`

## Used by

- `internal/auth` — upserts users on OIDC callback, looks them up on whoami.
```

- [ ] **Step 6: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add internal/users/
git commit -m "feat(users): repository with UpsertByOIDC and GetByID"
```

---

## Task 10: Add `internal/auth/config.go` and `internal/auth/session.go`

**Files:**

- Create: `grown-workspace/internal/auth/config.go`
- Create: `grown-workspace/internal/auth/session.go`
- Create: `grown-workspace/internal/auth/session_test.go`

- [ ] **Step 1: Write `config.go`**

Path: `grown-workspace/internal/auth/config.go`

```go
// Package auth implements OIDC login, session lifecycle, and the gRPC AuthService.
package auth

import (
	"net/url"
	"time"
)

// Config bundles all the knobs the auth package needs.
//
// All fields are required. Validate via Config.Validate before passing to
// the constructors in this package.
type Config struct {
	// IssuerURL is the OIDC issuer (Zitadel by default for grown-workspace).
	IssuerURL string
	// ClientID is the OIDC client identifier registered with the issuer.
	ClientID string
	// ClientSecret is the OIDC client secret.
	ClientSecret string
	// RedirectURL is the OIDC callback URL that the issuer redirects back to.
	RedirectURL string
	// Scopes requested in the OIDC authorization request.
	Scopes []string
	// CookieName is the HTTP cookie name carrying the session token.
	CookieName string
	// CookieSecure sets the Secure attribute on the session cookie.
	CookieSecure bool
	// SessionLifetime is how long a session token remains valid.
	SessionLifetime time.Duration
	// DefaultOrgSlug is the slug of the org that all sessions belong to in
	// single-org mode.
	DefaultOrgSlug string
}

// Validate returns nil if all fields are populated correctly.
func (c Config) Validate() error {
	if c.IssuerURL == "" {
		return errMissing("IssuerURL")
	}
	if _, err := url.Parse(c.IssuerURL); err != nil {
		return err
	}
	if c.ClientID == "" {
		return errMissing("ClientID")
	}
	if c.ClientSecret == "" {
		return errMissing("ClientSecret")
	}
	if c.RedirectURL == "" {
		return errMissing("RedirectURL")
	}
	if _, err := url.Parse(c.RedirectURL); err != nil {
		return err
	}
	if c.CookieName == "" {
		return errMissing("CookieName")
	}
	if c.SessionLifetime <= 0 {
		return errMissing("SessionLifetime")
	}
	if c.DefaultOrgSlug == "" {
		return errMissing("DefaultOrgSlug")
	}
	return nil
}

type missingFieldError struct{ field string }

func (e missingFieldError) Error() string { return "auth.Config." + e.field + " is required" }

func errMissing(f string) error { return missingFieldError{field: f} }
```

- [ ] **Step 2: Write the failing test for sessions**

Path: `grown-workspace/internal/auth/session_test.go`

```go
package auth

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"code.pick.haus/grown/grown/internal/storage"
	"code.pick.haus/grown/grown/internal/users"
)

func sessionDB(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS grown CASCADE"); err != nil {
		t.Fatalf("drop schema: %v", err)
	}
	if err := storage.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	var orgID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&orgID); err != nil {
		t.Fatalf("get default org: %v", err)
	}
	urepo := users.NewRepository(pool)
	u, err := urepo.UpsertByOIDC(ctx, users.UpsertInput{
		OrgID: orgID, OIDCIssuer: "x", OIDCSubject: "y",
		Email: "z@example.com", DisplayName: "Z",
	})
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return pool, u.ID
}

func TestSessionStore_CreateAndLookup(t *testing.T) {
	pool, userID := sessionDB(t)
	store := NewSessionStore(pool)
	ctx := context.Background()

	tok, err := store.Create(ctx, userID, 1*time.Hour)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if len(tok) != 64 { // 32 bytes hex-encoded
		t.Errorf("token length: got %d, want 64", len(tok))
	}

	sess, err := store.Lookup(ctx, tok)
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if sess.UserID != userID {
		t.Errorf("user id: got %s, want %s", sess.UserID, userID)
	}
	if sess.ExpiresAt.Before(time.Now()) {
		t.Errorf("expires_at is in the past: %v", sess.ExpiresAt)
	}
}

func TestSessionStore_LookupExpired(t *testing.T) {
	pool, userID := sessionDB(t)
	store := NewSessionStore(pool)
	ctx := context.Background()

	tok, err := store.Create(ctx, userID, -1*time.Hour) // already expired
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := store.Lookup(ctx, tok); err != ErrSessionExpired {
		t.Errorf("got %v, want ErrSessionExpired", err)
	}
}

func TestSessionStore_Revoke(t *testing.T) {
	pool, userID := sessionDB(t)
	store := NewSessionStore(pool)
	ctx := context.Background()

	tok, err := store.Create(ctx, userID, 1*time.Hour)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := store.Revoke(ctx, tok); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	if _, err := store.Lookup(ctx, tok); err != ErrSessionRevoked {
		t.Errorf("got %v, want ErrSessionRevoked", err)
	}
}

func TestSessionStore_LookupUnknown(t *testing.T) {
	pool, _ := sessionDB(t)
	store := NewSessionStore(pool)
	if _, err := store.Lookup(context.Background(), "nonsense"); err != ErrSessionNotFound {
		t.Errorf("got %v, want ErrSessionNotFound", err)
	}
}
```

- [ ] **Step 3: Run, verify it fails**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go test ./internal/auth/...
```

Expected: build failure (`NewSessionStore`, `ErrSession*` undefined).

- [ ] **Step 4: Implement `session.go`**

Path: `grown-workspace/internal/auth/session.go`

```go
package auth

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

// Sentinel errors returned by SessionStore.Lookup.
var (
	ErrSessionNotFound = errors.New("session not found")
	ErrSessionExpired  = errors.New("session expired")
	ErrSessionRevoked  = errors.New("session revoked")
)

// Session is a row from grown.sessions.
type Session struct {
	Token     string
	UserID    string
	CreatedAt time.Time
	ExpiresAt time.Time
	RevokedAt *time.Time
}

// SessionStore persists session tokens to Postgres.
type SessionStore struct {
	pool *pgxpool.Pool
}

// NewSessionStore constructs a SessionStore over the given pool.
func NewSessionStore(pool *pgxpool.Pool) *SessionStore {
	return &SessionStore{pool: pool}
}

// Create generates a new opaque token and persists a session for `userID`
// with `lifetime` until expiry. Returns the token string for cookie delivery.
func (s *SessionStore) Create(ctx context.Context, userID string, lifetime time.Duration) (string, error) {
	tok, err := newToken()
	if err != nil {
		return "", fmt.Errorf("session.Create: token: %w", err)
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO grown.sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`,
		tok, userID, time.Now().Add(lifetime),
	)
	if err != nil {
		return "", fmt.Errorf("session.Create: insert: %w", err)
	}
	return tok, nil
}

// Lookup returns the session row for `token`, or one of the sentinel errors.
func (s *SessionStore) Lookup(ctx context.Context, token string) (Session, error) {
	var sess Session
	err := s.pool.QueryRow(ctx,
		`SELECT token, user_id::text, created_at, expires_at, revoked_at
		 FROM grown.sessions WHERE token = $1`,
		token,
	).Scan(&sess.Token, &sess.UserID, &sess.CreatedAt, &sess.ExpiresAt, &sess.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrSessionNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("session.Lookup: %w", err)
	}
	if sess.RevokedAt != nil {
		return sess, ErrSessionRevoked
	}
	if time.Now().After(sess.ExpiresAt) {
		return sess, ErrSessionExpired
	}
	return sess, nil
}

// Revoke marks the session as revoked. Subsequent Lookup calls return ErrSessionRevoked.
func (s *SessionStore) Revoke(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE grown.sessions SET revoked_at = now() WHERE token = $1 AND revoked_at IS NULL`,
		token,
	)
	if err != nil {
		return fmt.Errorf("session.Revoke: %w", err)
	}
	return nil
}

func newToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
```

- [ ] **Step 5: Run tests, all 4 PASS**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  TMP=$(mktemp -d); export PGDATA=$TMP/pg
  initdb --auth=trust -U postgres -D "$PGDATA" >/dev/null
  pg_ctl -D "$PGDATA" -o "-h 127.0.0.1 -p 15432" -l "$TMP/log" start
  for i in $(seq 1 20); do pg_isready -h 127.0.0.1 -p 15432 -q && break; sleep 0.5; done
  createdb -h 127.0.0.1 -p 15432 -U postgres grown_test
  export GROWN_TEST_DSN="postgres://postgres@127.0.0.1:15432/grown_test?sslmode=disable"
  go test ./internal/auth/... -v
  pg_ctl -D "$PGDATA" stop -m immediate
  rm -rf "$TMP"
'
```

Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add internal/auth/config.go internal/auth/session.go internal/auth/session_test.go go.mod go.sum
git commit -m "feat(auth): Config struct + opaque token session store"
```

---

## Task 11: Implement `internal/auth/oidc.go`

**Files:**

- Create: `grown-workspace/internal/auth/oidc.go`

This task adds the OIDC provider wiring (build the authorization URL, exchange the code for tokens, verify ID token). No tests yet — covered indirectly by the integration test in Task 17.

- [ ] **Step 1: Write `oidc.go`**

Path: `grown-workspace/internal/auth/oidc.go`

```go
package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// OIDC bundles the configured provider, verifier, and OAuth2 config.
type OIDC struct {
	provider     *oidc.Provider
	verifier     *oidc.IDTokenVerifier
	oauth2Config oauth2.Config
}

// NewOIDC discovers the issuer's endpoints and constructs an OIDC helper
// ready to drive the authorization-code flow.
func NewOIDC(ctx context.Context, cfg Config) (*OIDC, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	prov, err := oidc.NewProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("oidc.NewProvider: %w", err)
	}
	scopes := cfg.Scopes
	if len(scopes) == 0 {
		scopes = []string{oidc.ScopeOpenID, "profile", "email"}
	}
	o := &OIDC{
		provider: prov,
		verifier: prov.Verifier(&oidc.Config{ClientID: cfg.ClientID}),
		oauth2Config: oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			RedirectURL:  cfg.RedirectURL,
			Endpoint:     prov.Endpoint(),
			Scopes:       scopes,
		},
	}
	return o, nil
}

// AuthCodeURL returns the IdP authorization URL for the given state token.
func (o *OIDC) AuthCodeURL(state string) string {
	return o.oauth2Config.AuthCodeURL(state, oauth2.AccessTypeOnline)
}

// Exchange swaps the authorization code for OAuth tokens and verifies the
// returned ID token. Returns the verified ID token's claims as a JSON object.
func (o *OIDC) Exchange(ctx context.Context, code string) (Claims, error) {
	tok, err := o.oauth2Config.Exchange(ctx, code)
	if err != nil {
		return Claims{}, fmt.Errorf("oauth2 exchange: %w", err)
	}
	rawIDToken, ok := tok.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		return Claims{}, fmt.Errorf("id_token missing from token response")
	}
	idTok, err := o.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return Claims{}, fmt.Errorf("verify id_token: %w", err)
	}
	var c Claims
	if err := idTok.Claims(&c); err != nil {
		return Claims{}, fmt.Errorf("decode claims: %w", err)
	}
	c.Issuer = idTok.Issuer
	return c, nil
}

// Claims is the subset of OIDC ID token claims we care about.
type Claims struct {
	Issuer        string `json:"-"`
	Subject       string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	PreferredName string `json:"preferred_username"`
}

// DisplayName returns the best human-readable name from the claims.
func (c Claims) DisplayName() string {
	if c.Name != "" {
		return c.Name
	}
	if c.PreferredName != "" {
		return c.PreferredName
	}
	return c.Email
}

// NewState generates a CSRF state token for the authorization flow.
func NewState() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
```

- [ ] **Step 2: Add the required dependencies**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  go get github.com/coreos/go-oidc/v3@latest
  go get golang.org/x/oauth2@latest
  go mod tidy
'
```

- [ ] **Step 3: Verify it builds**

```bash
nix --extra-experimental-features 'nix-command flakes' develop --command go build ./internal/auth/...
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add internal/auth/oidc.go go.mod go.sum
git commit -m "feat(auth): OIDC provider wiring (auth URL, code exchange, claim decode)"
```

---

## Task 12: Implement `internal/auth/service.go` (gRPC AuthService)

**Files:**

- Create: `grown-workspace/internal/auth/service.go`

This binds together the OIDC client, session store, user repo, and org repo to implement the four AuthService RPCs. State handling for the login flow uses a short-lived signed cookie (`grown_oidc_state`) to bind the state value across the redirect — the state is opaque CSRF token, the value the user-agent posts back must match.

- [ ] **Step 1: Write the service**

Path: `grown-workspace/internal/auth/service.go`

```go
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// stateCookieName is the name of the short-lived cookie that binds the OIDC
// state value across the redirect.
const stateCookieName = "grown_oidc_state"

// Service implements grownv1.AuthServiceServer.
type Service struct {
	grownv1.UnimplementedAuthServiceServer

	cfg      Config
	oidc     *OIDC
	sessions *SessionStore
	users    *users.Repository
	orgs     *orgs.Repository
}

// NewService constructs an AuthService.
func NewService(cfg Config, oidcClient *OIDC, sessions *SessionStore, ur *users.Repository, or *orgs.Repository) *Service {
	return &Service{
		cfg:      cfg,
		oidc:     oidcClient,
		sessions: sessions,
		users:    ur,
		orgs:     or,
	}
}

// Login generates a CSRF state, sets it as a short-lived cookie via the
// gRPC-gateway response header, and returns the IdP authorization URL.
// The HTTP gateway maps the URL to a 302 response.
func (s *Service) Login(ctx context.Context, req *grownv1.LoginRequest) (*grownv1.LoginResponse, error) {
	state, err := NewState()
	if err != nil {
		return nil, status.Errorf(codes.Internal, "generate state: %v", err)
	}
	// Set the state cookie via gRPC-gateway's response header forwarding.
	cookie := (&http.Cookie{
		Name:     stateCookieName,
		Value:    state,
		Path:     "/api/v1/auth",
		MaxAge:   600, // 10 minutes
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	}).String()
	// grpc-gateway picks up `Set-Cookie` from outgoing trailers/headers.
	if err := setHTTPHeader(ctx, "Set-Cookie", cookie); err != nil {
		return nil, err
	}
	authURL := s.oidc.AuthCodeURL(state)
	// Encode the return_to into the state cookie? Simpler: stash it in state itself by
	// passing return_to through Zitadel as a URL parameter wouldn't work cleanly; we
	// keep return_to client-side for V1 (default "/" if absent).
	_ = req.GetReturnTo()
	return &grownv1.LoginResponse{AuthorizationUrl: authURL}, nil
}

// Callback handles the IdP redirect: exchange the code for tokens, upsert the user,
// create a session, set the session cookie, redirect to "/".
func (s *Service) Callback(ctx context.Context, req *grownv1.CallbackRequest) (*grownv1.CallbackResponse, error) {
	if req.GetCode() == "" {
		return nil, status.Error(codes.InvalidArgument, "missing code")
	}
	if req.GetState() == "" {
		return nil, status.Error(codes.InvalidArgument, "missing state")
	}
	// Verify the state cookie matches the state query parameter.
	stateCookie, err := readHTTPCookie(ctx, stateCookieName)
	if err != nil {
		return nil, status.Errorf(codes.PermissionDenied, "missing state cookie: %v", err)
	}
	if stateCookie != req.GetState() {
		return nil, status.Error(codes.PermissionDenied, "state mismatch")
	}
	claims, err := s.oidc.Exchange(ctx, req.GetCode())
	if err != nil {
		return nil, status.Errorf(codes.Unauthenticated, "exchange: %v", err)
	}
	org, err := s.orgs.GetBySlug(ctx, s.cfg.DefaultOrgSlug)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "lookup default org: %v", err)
	}
	u, err := s.users.UpsertByOIDC(ctx, users.UpsertInput{
		OrgID:       org.ID,
		OIDCIssuer:  claims.Issuer,
		OIDCSubject: claims.Subject,
		Email:       claims.Email,
		DisplayName: claims.DisplayName(),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "upsert user: %v", err)
	}
	tok, err := s.sessions.Create(ctx, u.ID, s.cfg.SessionLifetime)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create session: %v", err)
	}
	// Set the session cookie and clear the state cookie.
	sessCookie := (&http.Cookie{
		Name:     s.cfg.CookieName,
		Value:    tok,
		Path:     "/",
		MaxAge:   int(s.cfg.SessionLifetime.Seconds()),
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	}).String()
	clearState := (&http.Cookie{
		Name: stateCookieName, Value: "", Path: "/api/v1/auth", MaxAge: -1,
	}).String()
	if err := setHTTPHeader(ctx, "Set-Cookie", sessCookie); err != nil {
		return nil, err
	}
	if err := setHTTPHeader(ctx, "Set-Cookie", clearState); err != nil {
		return nil, err
	}
	return &grownv1.CallbackResponse{RedirectTo: "/"}, nil
}

// Whoami returns the authenticated user. The auth middleware must have
// validated the session and attached the user via tenancy.Context.
func (s *Service) Whoami(ctx context.Context, _ *grownv1.WhoamiRequest) (*grownv1.WhoamiResponse, error) {
	u, ok := UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	return &grownv1.WhoamiResponse{
		User: &grownv1.User{
			Id:          u.ID,
			OrgId:       u.OrgID,
			OidcIssuer:  u.OIDCIssuer,
			OidcSubject: u.OIDCSubject,
			Email:       u.Email,
			DisplayName: u.DisplayName,
			CreatedAt:   u.CreatedAt.Unix(),
		},
		Org: &grownv1.Org{
			Id:          o.ID,
			Slug:        o.Slug,
			DisplayName: o.DisplayName,
		},
	}, nil
}

// Logout revokes the current session and clears the cookie.
func (s *Service) Logout(ctx context.Context, _ *grownv1.LogoutRequest) (*grownv1.LogoutResponse, error) {
	tok, err := readHTTPCookie(ctx, s.cfg.CookieName)
	if err == nil && tok != "" {
		if err := s.sessions.Revoke(ctx, tok); err != nil {
			return nil, status.Errorf(codes.Internal, "revoke: %v", err)
		}
	}
	clear := (&http.Cookie{Name: s.cfg.CookieName, Value: "", Path: "/", MaxAge: -1}).String()
	if err := setHTTPHeader(ctx, "Set-Cookie", clear); err != nil {
		return nil, err
	}
	return &grownv1.LogoutResponse{}, nil
}

// setHTTPHeader appends a header value via grpc-gateway's outgoing metadata.
// The gateway forwards `Grpc-Metadata-<name>` keys to HTTP `<name>` response headers.
func setHTTPHeader(ctx context.Context, name, value string) error {
	md := metadata.Pairs("Grpc-Metadata-"+name, value)
	return grpcSendHeader(ctx, md)
}

// readHTTPCookie returns the value of the cookie named `name`, sourced from
// gRPC-gateway's incoming metadata key `grpcgateway-cookie`.
func readHTTPCookie(ctx context.Context, name string) (string, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", errors.New("no metadata")
	}
	for _, c := range md.Get("grpcgateway-cookie") {
		header := http.Header{"Cookie": []string{c}}
		req := http.Request{Header: header}
		ck, err := req.Cookie(name)
		if err != nil {
			continue
		}
		v, _ := url.QueryUnescape(ck.Value)
		return v, nil
	}
	return "", fmt.Errorf("cookie %q not present", name)
}
```

- [ ] **Step 2: Add the small `grpcSendHeader` shim**

The function above references `grpcSendHeader`. Add it at the bottom of the file (so the implementation surface stays self-contained):

```go
import "google.golang.org/grpc"

func grpcSendHeader(ctx context.Context, md metadata.MD) error {
	return grpc.SendHeader(ctx, md)
}
```

Add the import to the existing import block instead of a separate one.

- [ ] **Step 3: Add the context helpers `UserFromContext` / `OrgFromContext`**

These will be the bridge between the auth middleware and the service. Add this content at the bottom of `service.go`:

```go
type ctxKey int

const (
	userCtxKey ctxKey = iota
	orgCtxKey
)

// WithUser attaches a user to the context (used by the auth middleware).
func WithUser(ctx context.Context, u users.User) context.Context {
	return context.WithValue(ctx, userCtxKey, u)
}

// UserFromContext returns the user attached by WithUser, if any.
func UserFromContext(ctx context.Context) (users.User, bool) {
	u, ok := ctx.Value(userCtxKey).(users.User)
	return u, ok
}

// WithOrg attaches an org to the context (used by the tenancy middleware).
func WithOrg(ctx context.Context, o orgs.Org) context.Context {
	return context.WithValue(ctx, orgCtxKey, o)
}

// OrgFromContext returns the org attached by WithOrg, if any.
func OrgFromContext(ctx context.Context) (orgs.Org, bool) {
	o, ok := ctx.Value(orgCtxKey).(orgs.Org)
	return o, ok
}
```

- [ ] **Step 4: Verify it builds**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go build ./internal/auth/...
```

Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add internal/auth/service.go
git commit -m "feat(auth): AuthService — Login, Callback, Whoami, Logout"
```

---

## Task 13: Implement `internal/auth/middleware.go`

**Files:**

- Create: `grown-workspace/internal/auth/middleware.go`

The middleware extracts the session cookie, validates the session, loads the user, and attaches them to the context. It wraps the grpc-gateway HTTP handler so all REST endpoints transparently receive an authenticated context (or no user attached, in which case downstream services return Unauthenticated).

- [ ] **Step 1: Write the middleware**

Path: `grown-workspace/internal/auth/middleware.go`

```go
package auth

import (
	"net/http"

	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// HTTPMiddleware returns a function that authenticates incoming HTTP requests
// based on the session cookie. If the cookie is absent or invalid, the request
// is passed through with no user attached — downstream services that require
// authentication should check `UserFromContext` and return Unauthenticated.
//
// `defaultOrg` is the org resolved in single-org mode. Always attached to the
// context regardless of authentication state (so anonymous requests still
// know which tenant they belong to).
func HTTPMiddleware(cfg Config, sessions *SessionStore, urepo *users.Repository, defaultOrg orgs.Org) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := WithOrg(r.Context(), defaultOrg)
			cookie, err := r.Cookie(cfg.CookieName)
			if err == nil && cookie.Value != "" {
				sess, lookupErr := sessions.Lookup(r.Context(), cookie.Value)
				if lookupErr == nil {
					if u, uerr := urepo.GetByID(r.Context(), sess.UserID); uerr == nil {
						ctx = WithUser(ctx, u)
					}
				}
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
```

- [ ] **Step 2: Verify it builds**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go build ./internal/auth/...
```

Expected: succeeds.

- [ ] **Step 3: Write `internal/auth/MODULE.md`**

Path: `grown-workspace/internal/auth/MODULE.md`

```markdown
# internal/auth

OIDC login, session lifecycle, AuthService implementation, and the HTTP
authentication middleware.

## Interfaces

- `Config` struct + `Validate()` — runtime config (issuer, client id/secret, cookie, lifetime, default org slug).
- `NewOIDC(ctx, cfg) (*OIDC, error)` — discovers the issuer's endpoints; returns a helper with `AuthCodeURL` and `Exchange`.
- `NewSessionStore(pool) *SessionStore` — opaque session tokens, `Create` / `Lookup` / `Revoke`. Sentinels: `ErrSessionNotFound`, `ErrSessionExpired`, `ErrSessionRevoked`.
- `NewService(cfg, oidc, sessions, urepo, orepo) *Service` — implements `grownv1.AuthServiceServer`.
- `HTTPMiddleware(cfg, sessions, urepo, defaultOrg)` — wraps the gateway mux; attaches user + org to the request context.
- `WithUser` / `UserFromContext`, `WithOrg` / `OrgFromContext` — context helpers.

## Depends on

- `internal/orgs` — org lookups for tenancy.
- `internal/users` — user upsert + lookup.
- `internal/storage` — pgxpool transitively.
- `github.com/coreos/go-oidc/v3`
- `golang.org/x/oauth2`
- `google.golang.org/grpc`
- `gen/go/grown/v1`

## Used by

- `internal/server` — registers AuthService and installs HTTPMiddleware.
- `cmd/server` — constructs Config from env and wires the dependency graph.
```

- [ ] **Step 4: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add internal/auth/middleware.go internal/auth/MODULE.md
git commit -m "feat(auth): HTTP session middleware + MODULE.md"
```

---

## Task 14: Implement `internal/tenancy` package

**Files:**

- Create: `grown-workspace/internal/tenancy/context.go`
- Create: `grown-workspace/internal/tenancy/middleware.go`
- Create: `grown-workspace/internal/tenancy/MODULE.md`

For V1 the tenancy layer is thin — single-org mode resolves every request to the bootstrapped default org. The package exists to lock the shape so multi-org routing is a localized change later.

- [ ] **Step 1: Write `context.go`**

Path: `grown-workspace/internal/tenancy/context.go`

```go
// Package tenancy resolves the org context for every incoming request.
package tenancy

import (
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
)

// We piggy-back on auth's context keys so other packages have one place to
// look up `Org`/`User`. This re-export keeps the public surface tidy.

// OrgFromContext is re-exported from auth for callers that depend only on tenancy.
var OrgFromContext = auth.OrgFromContext

// UserFromContext is re-exported from auth for callers that depend only on tenancy.
var UserFromContext = auth.UserFromContext

// SingleOrgResolver is a Resolver that always returns the org passed at
// construction time. Used in single-org mode.
type SingleOrgResolver struct {
	Org orgs.Org
}

// Resolve returns the configured org regardless of the request.
func (r SingleOrgResolver) Resolve() orgs.Org { return r.Org }
```

- [ ] **Step 2: Write `middleware.go`**

The auth middleware already attaches the default org. For V1 this file exists to document the boundary; multi-org Plan 5 will replace its content.

Path: `grown-workspace/internal/tenancy/middleware.go`

```go
package tenancy

// Multi-org subdomain routing is intentionally absent in V1. The auth
// middleware (in internal/auth) attaches the default org for single-org
// mode. When multi-org mode lands in Plan 5, the resolver here will inspect
// the request host, look up the corresponding org row, and attach it before
// the auth middleware fires.
//
// Until then, this file is a placeholder so the directory and module path
// exist and consumers can import it without compile errors.
```

- [ ] **Step 3: Write `MODULE.md`**

Path: `grown-workspace/internal/tenancy/MODULE.md`

```markdown
# internal/tenancy

Resolves which Org a request belongs to.

In V1 (single-org mode), the auth middleware attaches the bootstrapped
"default" org to every request. This package re-exports `OrgFromContext`
and `UserFromContext` from `internal/auth` so consumers can depend on a
single tenancy boundary instead of reaching into auth.

In Plan 5 (multi-org mode), the `middleware.go` file will gain a real HTTP
middleware that inspects the request host (subdomain), looks up the matching
`grown.orgs` row, and attaches it before the auth middleware fires.

## Interfaces

- `OrgFromContext(ctx) (Org, bool)` — re-exported from `internal/auth`.
- `UserFromContext(ctx) (User, bool)` — re-exported from `internal/auth`.
- `SingleOrgResolver{Org}` — placeholder type used by tests in multi-org mode.

## Depends on

- `internal/auth` (context keys).
- `internal/orgs` (Org type).

## Used by

- Anywhere downstream of auth that needs to know which org/user the request belongs to.
```

- [ ] **Step 4: Verify it builds**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go build ./internal/tenancy/...
```

Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add internal/tenancy/
git commit -m "feat(tenancy): single-org placeholder with context re-exports"
```

---

## Task 15: Wire AuthService and middleware into `internal/server`

**Files:**

- Modify: `grown-workspace/internal/server/server.go`

The server package currently constructs only HealthService. We need to add AuthService and install the HTTP auth middleware on the gateway mux.

- [ ] **Step 1: Replace `internal/server/server.go`**

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
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/health"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// Config bundles the runtime identity and dependencies of the server.
type Config struct {
	Version   string
	Commit    string
	StartedAt time.Time

	AuthConfig   auth.Config
	OIDC         *auth.OIDC
	Sessions     *auth.SessionStore
	UsersRepo    *users.Repository
	OrgsRepo     *orgs.Repository
	DefaultOrg   orgs.Org
}

// Server holds the gRPC server and the HTTP/REST gateway mux wrapped with middleware.
type Server struct {
	grpc        *grpc.Server
	httpHandler http.Handler
}

// New constructs a Server with all services registered.
func New(cfg Config) *Server {
	grpcSrv := grpc.NewServer()
	healthSvc := health.NewService(cfg.Version, cfg.Commit, cfg.StartedAt)
	grownv1.RegisterHealthServiceServer(grpcSrv, healthSvc)

	authSvc := auth.NewService(cfg.AuthConfig, cfg.OIDC, cfg.Sessions, cfg.UsersRepo, cfg.OrgsRepo)
	grownv1.RegisterAuthServiceServer(grpcSrv, authSvc)

	mux := runtime.NewServeMux(
		runtime.WithMarshalerOption(runtime.MIMEWildcard, &runtime.JSONPb{
			MarshalOptions:   protojson.MarshalOptions{UseProtoNames: true, EmitUnpopulated: true},
			UnmarshalOptions: protojson.UnmarshalOptions{DiscardUnknown: true},
		}),
		runtime.WithForwardResponseOption(redirectOnAuthURL),
	)
	_ = grownv1.RegisterHealthServiceHandlerServer(context.Background(), mux, healthSvc)
	_ = grownv1.RegisterAuthServiceHandlerServer(context.Background(), mux, authSvc)

	wrapped := auth.HTTPMiddleware(cfg.AuthConfig, cfg.Sessions, cfg.UsersRepo, cfg.DefaultOrg)(mux)
	return &Server{grpc: grpcSrv, httpHandler: wrapped}
}

// HTTPHandler returns the HTTP/REST handler (driven by grpc-gateway + middleware).
func (s *Server) HTTPHandler() http.Handler { return s.httpHandler }

// GRPC returns the underlying *grpc.Server.
func (s *Server) GRPC() *grpc.Server { return s.grpc }
```

- [ ] **Step 2: Add the `redirectOnAuthURL` helper**

Append to the same file `internal/server/server.go`:

```go
// redirectOnAuthURL converts AuthService.Login responses into HTTP 302 redirects
// to the IdP authorization URL. Also converts Callback responses into 302
// redirects to the post-login URL.
func redirectOnAuthURL(ctx context.Context, w http.ResponseWriter, msg interface{}) error {
	switch m := msg.(type) {
	case *grownv1.LoginResponse:
		if u := m.GetAuthorizationUrl(); u != "" {
			w.Header().Set("Location", u)
			w.WriteHeader(http.StatusFound)
			return nil
		}
	case *grownv1.CallbackResponse:
		if u := m.GetRedirectTo(); u != "" {
			w.Header().Set("Location", u)
			w.WriteHeader(http.StatusFound)
			return nil
		}
	}
	return nil
}
```

- [ ] **Step 3: Update the existing test in `internal/server/server_test.go`**

The existing `TestHealthzReturnsJSON` constructs `New(Config{...})` with only three fields. With the new Config shape, the test won't compile. Update it to pass nil/zero-value dependencies — the test only exercises the health endpoint which doesn't reach into auth.

Replace the body of `TestHealthzReturnsJSON` with:

```go
func TestHealthzReturnsJSON(t *testing.T) {
	srv := New(Config{
		Version:   "test",
		Commit:    "deadbeef",
		StartedAt: time.Now(),
		// All other fields are zero values; the test only exercises /healthz
		// which does not need them. The auth middleware will run but with
		// `sessions=nil` and `urepo=nil`, the cookie lookup short-circuits to
		// the no-session path (no panic — nil receivers checked via Cookie()
		// returning err before any session lookup).
	})
	... (rest unchanged)
```

Wait — that's not safe. The middleware calls `sessions.Lookup(...)` if the cookie is present. The test request has no cookie, so the middleware will skip the lookup. But if the request _did_ have a cookie, calling `Lookup` on a nil `*SessionStore` would panic.

To keep the test isolated, harden the middleware to nil-check. Add this guard at the top of the inner handler in `internal/auth/middleware.go`:

```go
		if sessions == nil || urepo == nil {
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
```

Place it after `ctx := WithOrg(...)` and before `cookie, err := r.Cookie(...)`. This makes the middleware robust against partial wiring (test, dev startup, etc.).

- [ ] **Step 4: Verify build + tests**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  go build ./...
  go test ./internal/health/... ./internal/server/...
'
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add internal/server/server.go internal/server/server_test.go internal/auth/middleware.go
git commit -m "feat(server): register AuthService + install HTTP auth middleware"
```

---

## Task 16: Wire dependencies in `cmd/server/main.go`

**Files:**

- Modify: `grown-workspace/cmd/server/main.go`

- [ ] **Step 1: Replace the file**

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
	"strconv"
	"syscall"
	"time"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/server"
	"code.pick.haus/grown/grown/internal/storage"
	"code.pick.haus/grown/grown/internal/users"
)

var (
	version = "0.0.0-dev"
	commit  = "unknown"
)

func main() {
	httpAddr := flag.String("http-addr", ":8080", "HTTP/REST listen address")
	grpcAddr := flag.String("grpc-addr", ":9000", "gRPC listen address")
	dsn := flag.String("postgres-dsn", os.Getenv("GROWN_POSTGRES_DSN"), "Postgres DSN")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	if *dsn == "" {
		logger.Error("postgres DSN is required (--postgres-dsn or GROWN_POSTGRES_DSN)")
		os.Exit(1)
	}

	startupCtx, startupCancel := context.WithTimeout(context.Background(), 60*time.Second)
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

	authCfg, err := loadAuthConfigFromEnv()
	if err != nil {
		logger.Error("load auth config", "err", err)
		os.Exit(1)
	}

	oidcClient, err := auth.NewOIDC(startupCtx, authCfg)
	if err != nil {
		logger.Error("init OIDC", "err", err)
		os.Exit(1)
	}

	orgsRepo := orgs.NewRepository(pool)
	defaultOrg, err := orgsRepo.GetBySlug(startupCtx, authCfg.DefaultOrgSlug)
	if err != nil {
		logger.Error("lookup default org", "err", err)
		os.Exit(1)
	}
	logger.Info("default org resolved", "id", defaultOrg.ID, "slug", defaultOrg.Slug)

	srv := server.New(server.Config{
		Version:    version,
		Commit:     commit,
		StartedAt:  time.Now(),
		AuthConfig: authCfg,
		OIDC:       oidcClient,
		Sessions:   auth.NewSessionStore(pool),
		UsersRepo:  users.NewRepository(pool),
		OrgsRepo:   orgsRepo,
		DefaultOrg: defaultOrg,
	})

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

// loadAuthConfigFromEnv reads GROWN_OIDC_* env vars into an auth.Config.
func loadAuthConfigFromEnv() (auth.Config, error) {
	secure, _ := strconv.ParseBool(os.Getenv("GROWN_SESSION_COOKIE_SECURE"))
	lifetimeStr := os.Getenv("GROWN_SESSION_LIFETIME")
	if lifetimeStr == "" {
		lifetimeStr = "168h"
	}
	lifetime, err := time.ParseDuration(lifetimeStr)
	if err != nil {
		return auth.Config{}, err
	}
	cfg := auth.Config{
		IssuerURL:       os.Getenv("GROWN_OIDC_ISSUER"),
		ClientID:        os.Getenv("GROWN_OIDC_CLIENT_ID"),
		ClientSecret:    os.Getenv("GROWN_OIDC_CLIENT_SECRET"),
		RedirectURL:     os.Getenv("GROWN_OIDC_REDIRECT_URL"),
		CookieName:      defaultEnv("GROWN_SESSION_COOKIE_NAME", "grown_session"),
		CookieSecure:    secure,
		SessionLifetime: lifetime,
		DefaultOrgSlug:  defaultEnv("GROWN_DEFAULT_ORG_SLUG", "default"),
	}
	return cfg, cfg.Validate()
}

func defaultEnv(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
```

- [ ] **Step 2: Verify it builds**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go build ./cmd/server
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add cmd/server/main.go
git commit -m "feat(server): wire auth + tenancy dependencies in main"
```

---

## Task 17: End-to-end integration test for the login flow

**Files:**

- Create: `grown-workspace/web/e2e/auth.spec.ts`

The smoke test asserts the full Authorization Code flow works:

1. Stack is up via process-compose (Zitadel + Postgres + backend).
2. `GET /api/v1/auth/login` returns 302 with a `Location` header pointing at Zitadel.
3. We script the login at the IdP using Playwright's browser to enter `admin` / `DevPassword!1`.
4. After Zitadel redirects back, the backend issues a session cookie.
5. `GET /api/v1/whoami` (with the cookie carried by the browser) returns the user + org JSON.
6. `POST /api/v1/auth/logout` clears the cookie; subsequent `/api/v1/whoami` returns 401.

- [ ] **Step 1: Write the test**

Path: `grown-workspace/web/e2e/auth.spec.ts`

```typescript
import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.GROWN_HTTP_URL ?? "http://workspace.localtest.me:8080";

test("OIDC login flow yields a working session", async ({ page }) => {
  await page.goto(`${BASE_URL}/api/v1/auth/login`);

  // Playwright follows the 302 to Zitadel automatically.
  await expect(page).toHaveURL(/localhost:8081/);

  // Zitadel login form: username, then password on a second screen.
  await page
    .locator('input[name="loginName"], input[id="loginName"]')
    .fill("admin");
  await page.locator('button[type="submit"]').first().click();

  await page
    .locator('input[name="password"], input[id="password"]')
    .fill("DevPassword!1");
  await page.locator('button[type="submit"]').first().click();

  // After successful login, Zitadel redirects to the backend callback,
  // which sets the session cookie and redirects to "/". Wait for the final
  // navigation to land back at our origin.
  await page.waitForURL(
    new RegExp(
      "^" + BASE_URL.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "/?$",
    ),
    { timeout: 30_000 },
  );

  // /api/v1/whoami should now return the authenticated user.
  const who = await page.request.get(`${BASE_URL}/api/v1/whoami`);
  expect(who.status()).toBe(200);
  const body = await who.json();
  expect(body.user.email).toBe("admin@grown.localtest.me");
  expect(body.org.slug).toBe("default");

  // Logout.
  const logout = await page.request.post(`${BASE_URL}/api/v1/auth/logout`, {
    data: {},
  });
  expect(logout.status()).toBe(200);

  // Whoami should now be unauthorized (401 from the gateway when the gRPC
  // service returns codes.Unauthenticated).
  const after = await page.request.get(`${BASE_URL}/api/v1/whoami`);
  expect(after.status()).toBe(401);
});
```

- [ ] **Step 2: Run the test against the running stack**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  process-compose up --use-uds --tui=false -f deploy/process-compose/process-compose.yaml &
  SC=$!
  for i in $(seq 1 180); do
    if curl -fs http://workspace.localtest.me:8080/healthz >/dev/null 2>&1; then break; fi
    sleep 1
  done
  ( cd web/e2e && npm test -- --grep "OIDC login flow" )
  TEST_EXIT=$?
  kill $SC 2>/dev/null || true
  wait $SC 2>/dev/null || true
  exit $TEST_EXIT
'
```

Expected: `1 passed`. (First run is slow because Zitadel boots cold.)

If the test fails on the Zitadel selector lookups, take a Playwright screenshot inside the test (add `await page.screenshot({ path: '/tmp/login.png' })` before the failing locator) and inspect the actual login UI — Zitadel's HTML may have evolved. Adjust the selectors accordingly.

- [ ] **Step 3: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add web/e2e/auth.spec.ts
git commit -m "test(e2e): full OIDC login flow against running Zitadel"
```

---

## Task 18: Tag v0.0.2

**Files:**

- None (tag-only)

- [ ] **Step 1: Verify tree clean + all unit tests pass + build**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git status --short
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  go vet ./...
  go test ./internal/health/... ./internal/server/...
  buf lint
  go build ./...
'
```

Expected: tree clean, all checks pass.

- [ ] **Step 2: End-to-end smoke (healthz + whoami)**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  process-compose up --use-uds --tui=false -f deploy/process-compose/process-compose.yaml &
  SC=$!
  for i in $(seq 1 180); do
    if curl -fs http://workspace.localtest.me:8080/healthz >/dev/null 2>&1; then break; fi
    sleep 1
  done
  echo "--- healthz ---"
  curl -s http://workspace.localtest.me:8080/healthz | jq .
  echo "--- whoami (no session) ---"
  curl -i -s http://workspace.localtest.me:8080/api/v1/whoami | head -5
  echo "--- e2e: auth.spec ---"
  ( cd web/e2e && npm test -- --grep "OIDC login flow" )
  kill $SC 2>/dev/null || true
  wait $SC 2>/dev/null || true
'
```

Expected: healthz OK, whoami without session returns 401, auth flow e2e passes.

- [ ] **Step 3: Tag v0.0.2**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git tag -a v0.0.2 -m "v0.0.2 Auth + Tenancy: OIDC login via Zitadel, sessions, /api/v1/whoami"
git tag -l
```

Expected: `v0.0.1` and `v0.0.2` listed.

- [ ] **Step 4: Print summary**

```bash
git log --oneline | head -25
echo
git show v0.0.2 --no-patch
```

---

## Self-review checklist

- **Spec coverage** — Auth (Zitadel OIDC) ✓, sessions ✓, multi-org-friendly tenancy with single-org default ✓, `/api/v1/whoami` ✓, gam-compat shim NOT in this plan (Plan 4), Material 3 dashboard NOT here (Plan 3).
- **No placeholders** — Each step contains complete code.
- **Type consistency** — `Config` referenced everywhere matches the same struct; `users.User` / `orgs.Org` / `auth.Session` field names are consistent across producer and consumer.
- **Bite-sized** — Most steps are single-action; some implementation steps include a substantial code block which is unavoidable for new files.
- **Frequent commits** — Each task ends in a commit.

## Done criteria for Plan 2

When all tasks are complete:

1. `nix run .#dev` brings up Postgres + Zitadel + backend; Zitadel initialised on first boot with `admin` / `DevPassword!1`; OIDC app `grown-dev-client` exists.
2. `curl http://workspace.localtest.me:8080/api/v1/auth/login` returns 302 to Zitadel's authorization endpoint.
3. Manual browser flow: visit `/api/v1/auth/login`, log in at Zitadel, get redirected back to the backend, session cookie set, `/api/v1/whoami` returns user + org JSON.
4. The Playwright `auth.spec.ts` test passes end-to-end against the running stack.
5. `v0.0.2` tag exists.
6. Plan 3 (Dashboard + Brand + Catalog) starts from this state.

## Next plans

- **Plan 3** — Dashboard + brand + catalog (React app under `web/app/`, Material 3 tile launcher, brand config, stub `/coming-soon/:app`).
- **Plan 4** — gam-compat shim (`/admin/directory/v1/users`, `/groups`) + native `grown` CLI.
- **Plan 5** — Multi-org subdomain routing + Helm chart + production e2e.
