# Guacamole Desktops — Phase 2 Design (on-demand container desktops)

**Status:** approved 2026-06-19. Phase 2 of the Guacamole effort (Phase 1 =
gateway + `ls`-only sandbox). **Depends on Phase 1 being deployed** (a running
Guacamole with a reachable REST API + admin token).

**Goal:** Let a signed-in member launch an **on-demand container desktop** from
grown's Access page. grown provisions a container per the chosen flavor + mode,
registers a Guacamole connection pointing at it, and hands the user a link to
open it. Idle sessions are reaped. **pick.haus only**, with internet egress,
behind quotas + caps.

## Decisions (locked)

- **Flavors (all three):** a small catalog —
  - `linux-desktop` — full XFCE desktop over VNC (e.g. `lscr.io/linuxserver/webtop`).
  - `browser` — single-app hardened browser over VNC (e.g. a Kasm browser image).
  - `terminal` — a real dev/ops shell container over SSH (NOT the `ls`-sandbox).
- **Modes (both):** each launch is **ephemeral** (fresh, discarded on
  disconnect/idle) or **persistent** (per-(user,flavor) home on a PVC; the pod is
  removed when idle and recreated on next launch, the PVC survives).
- **Scope:** enabled on **pick.haus only** (`GROWN_DESKTOPS_ENABLED`). Any
  signed-in org member may launch (subject to quota). Desktops run in a dedicated
  **`grown-desktops`** namespace with a ResourceQuota + LimitRange.
- **Network:** desktops get **internet egress** but are **blocked from
  cluster-internal services** except the path Guacamole/guacd needs to reach them
  (NetworkPolicy).
- **Orchestration transport:** grown talks to the **Kubernetes REST API directly**
  (in-cluster ServiceAccount token), matching grown's thin-HTTP-client style — no
  `client-go` dependency.

## Architecture

```
Access page ──launch(flavor,mode)──> grown /api/v1/desktops
                                        │
        ┌───────────────────────────────┼─────────────────────────────┐
        ▼                               ▼                              ▼
  k8s REST (SA token)            Guacamole REST API            desktop_sessions
  create PVC? + Pod + Svc        create connection +           (Postgres side-table)
  in grown-desktops              grant launching user
        │                               │
        ▼                               ▼
  desktop pod (VNC/SSH) <──guacd── Guacamole ──link──> user's browser
        ▲
   reaper: idle pods removed (ephemeral) / stopped (persistent, PVC kept)
```

## Components (all new, package `internal/desktops`)

1. **`catalog.go`** — the flavor catalog as pure data + helpers. Each `Flavor`:
   `id, name, description, image, protocol (vnc|ssh), port, defaultResources,
   persistentPath (home dir to PVC-mount), needsEgress`. Pure, table-tested.
2. **`kube.go`** — a thin Kubernetes REST client over the in-cluster config
   (`KUBERNETES_SERVICE_HOST`, the SA token + CA at
   `/var/run/secrets/kubernetes.io/serviceaccount/`). Methods: `EnsurePVC`,
   `CreatePod`, `CreateService`, `GetPod`, `DeletePod`, `DeleteService`,
   `PodReadyAddress`. JSON over HTTPS; no client-go. Errors are explicit; callers
   decide retries.
3. **`guac.go`** — a Guacamole REST API client: `Authenticate` (admin token),
   `CreateConnection(name, protocol, host, port, params)`,
   `GrantConnectionToUser`, `DeleteConnection`. Token-cached.
4. **`repository.go`** — `desktop_sessions` CRUD (see schema).
5. **`provisioner.go`** — orchestrates a single launch/stop: resolve flavor →
   (persistent) ensure PVC → create Pod+Service → wait Ready → create+grant Guac
   connection → persist the session row → return the open-URL. `Stop` tears the
   pod/service (+ connection) down; persistent keeps the PVC.
6. **`service.go`** — request-level API used by the handler: `ListFlavors`,
   `Launch(user, flavorID, mode)`, `ListSessions(user)`, `Stop(user, sessionID)`.
   Enforces per-user/namespace caps before provisioning.
7. **`handler.go`** — HTTP routes under `/api/v1/desktops` (mounted inside grown
   auth like `internal/access`): `GET /flavors`, `GET /sessions`,
   `POST /launch`, `POST /sessions/{id}/stop`. Disabled (404) unless
   `GROWN_DESKTOPS_ENABLED`.
8. **`reaper.go`** — a goroutine loop: every interval, find sessions whose
   `last_seen_at` is older than the idle TTL and Stop them. "last seen" is
   refreshed by a lightweight heartbeat from the Access page while a session card
   is open, and/or by polling Guacamole's active-tunnels API (best-effort).

## Data model — `grown.desktop_sessions` (migration `0092`)

```sql
CREATE TABLE grown.desktop_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
  flavor        TEXT NOT NULL,                 -- catalog id
  mode          TEXT NOT NULL,                 -- 'ephemeral' | 'persistent'
  pod_name      TEXT NOT NULL DEFAULT '',
  pvc_name      TEXT NOT NULL DEFAULT '',      -- persistent only
  guac_conn_id  TEXT NOT NULL DEFAULT '',      -- Guacamole connection identifier
  state         TEXT NOT NULL DEFAULT 'starting', -- starting|running|stopped|error
  open_url      TEXT NOT NULL DEFAULT '',      -- deep link into Guacamole
  detail        TEXT NOT NULL DEFAULT '',      -- error context
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX desktop_sessions_user_idx ON grown.desktop_sessions (user_id);
CREATE INDEX desktop_sessions_lastseen_idx ON grown.desktop_sessions (last_seen_at)
  WHERE state IN ('starting','running');
```

For **persistent** mode the PVC name is deterministic
(`desk-<userid8>-<flavor>`), so a relaunch re-attaches the same home.

## Pod / connection shape

- **Pod** (namespace `grown-desktops`): one container from the flavor image,
  resource `requests`/`limits` from the flavor (capped by the namespace
  LimitRange), `securityContext` non-root where the image allows, a generated VNC
  password (or SSH host) injected via env/secret, persistent home mounted from the
  PVC when in persistent mode. Label `grown-desktop-session=<id>` for reaping.
- **Service** (ClusterIP) fronting the pod's VNC/SSH port so guacd has a stable
  address.
- **Guac connection**: `vnc` (host=`<svc>.grown-desktops.svc`, port, password) or
  `ssh`. Granted to the launching user (mapped by email/username, same convention
  as Phase 1 OIDC). The `open_url` deep-links to that connection.

## grown integration (Access page)

A new **Desktops** section above the existing Phase 1 launch button (only when
`GROWN_DESKTOPS_ENABLED`):
- a flavor picker (3 cards) + an ephemeral/persistent toggle + "Launch";
- a list of the user's running sessions with **Open** (new tab → `open_url`) and
  **Stop**;
- while a session card is mounted, a periodic `POST /sessions/{id}/heartbeat`
  refreshes `last_seen_at` so the reaper doesn't kill an actively-watched desktop.

## Configuration

- `GROWN_DESKTOPS_ENABLED=true` (pick.haus only).
- `GROWN_GUAC_API_URL` + `GROWN_GUAC_ADMIN_USER`/`GROWN_GUAC_ADMIN_PASSWORD` (or a
  Guacamole API token) — for the REST client.
- `GROWN_DESKTOPS_NAMESPACE=grown-desktops`, `GROWN_DESKTOPS_IDLE_TTL=30m`,
  `GROWN_DESKTOPS_MAX_PER_USER=2`.
- Unset/disabled ⇒ the whole subsystem is inert (handler 404s, no Access section)
  — same no-op-when-unconfigured convention as the rest of grown.

## Cluster manifests — `deploy/desktops/`

- `00-namespace.yaml` — `grown-desktops` ns.
- `10-rbac.yaml` — a Role in `grown-desktops` (pods, pods/log, services,
  persistentvolumeclaims: create/get/list/delete) + a RoleBinding to grown's
  ServiceAccount (so grown's in-cluster SA can orchestrate). grown's SA name is
  confirmed during implementation.
- `20-quota.yaml` — `ResourceQuota` (cap total desktop CPU/mem/PVCs) +
  `LimitRange` (per-pod default + max).
- `30-networkpolicy.yaml` — default-deny, then allow: ingress from `guacd` (ns
  `grown`) to the VNC/SSH ports; egress to the internet (deny RFC1918 +
  cluster-internal) for `needsEgress` flavors.

No custom images to build — all flavors are off-the-shelf public images.

## Security

- Desktops are isolated in their own namespace with quota/limits; a runaway or
  hostile desktop can't exhaust the cluster or reach internal services.
- grown's RBAC is scoped to `grown-desktops` only (no cluster-wide power).
- The Guacamole admin credential lives only in grown's server env/secret; the
  REST client is the single consumer.
- Per-user cap (`MAX_PER_USER`) + the namespace quota bound blast radius and cost.
- Persistent PVCs are per-(user,flavor) and never shared across users.

## Failure / edge handling

- Pod fails to become Ready within a timeout ⇒ session `state=error` with detail;
  the partial pod/PVC/connection are cleaned up; the UI shows the error.
- Guacamole REST unreachable ⇒ launch fails fast, pod is torn down (no orphan).
- Reaper is idempotent: Stop on an already-gone pod/connection is a no-op.
- Disabled instance (grown.haus) ⇒ no Desktops section, handler 404.

## Testing

- **`catalog_test.go`** — flavor lookups, defaults, validation.
- **`guac_test.go`** — REST client against an `httptest` fake Guacamole (auth +
  create/grant/delete connection request shapes).
- **`kube_test.go`** — k8s REST client against an `httptest` fake API server
  (PVC/Pod/Service create + ready-address parsing).
- **`provisioner_test.go`** — launch/stop happy path + cleanup-on-failure, using
  fake guac + fake kube + an in-memory sessions store (interface-injected, like
  Phase 1's webhookStore).
- **`reaper_test.go`** — idle selection + Stop calls, with a fake clock.
- **Frontend** — Access page typechecks; Desktops section renders flavors,
  launch/stop wire to the API.
- **Live e2e (after Phase 1 is deployed):** launch each flavor → Guacamole opens
  the desktop; stop tears it down; idle reap works; persistent relaunch re-attaches
  the home.

## Out of scope (Phase 2)

- KubeVirt VMs (Phase 3).
- Multi-org connection scoping inside Guacamole beyond per-user grants.
- GPU desktops, audio, clipboard policy, file upload/download tuning.
- Autoscaling node pools for desktop load.

## Implementation order

1. Migration `0092` + `repository.go` (+ test).
2. `catalog.go` (+ test).
3. `guac.go` REST client (+ httptest test).
4. `kube.go` REST client (+ httptest test).
5. `provisioner.go` + `service.go` (+ provisioner test with fakes).
6. `reaper.go` (+ test).
7. `handler.go` + server wiring + config env.
8. Access-page Desktops section.
9. `deploy/desktops/` manifests.
10. Build/test green; live verification deferred to post-Phase-1-deploy.
