# Bolo Multiplayer — in-cluster hosting RUNBOOK (Milestone 2 draft)

**Status:** DRAFT — do NOT apply. This file documents the exact gitops change the
human applies deliberately (registry push + manifest edit + go-live). Nothing
here is wired into the cluster yet.

The Orona Bolo multiplayer server is an **authoritative, stateful Node WebSocket
game server**: a 50 Hz (20 ms) tick loop advances the shared simulation per room
and broadcasts deltas. All players in a match (`gid`) **must** land on the same
process that owns that room's in-RAM state. See the M1 report §5 for why this
cannot be a stateless relay or run multi-replica behind a round-robin LB.

The image built + smoke-tested in M2 is `bolo-mp:dev` (164 MB, `node:22-alpine`),
built from `~/workspace/_ports/orona/Dockerfile` via `build/docker-build.sh`. It
bundles the compiled sim + the multi-room transport harness (`mp-server.js`) +
the integrated `/games/bolo` client assets, and serves:
- `ws://<host>/match/<gid>` — the authoritative game socket (gid = 20 lowercase
  letters; lazily creates a room, GCs empty rooms after `ROOM_TTL_MS`),
- `/healthz` — liveness,
- the static client (`mp.html` + assets) for standalone use.

In grown, **grown serves the `/games/bolo` assets** from its SPA and only
reverse-proxies the WebSocket: `wss://<grown-host>/bolo-mp/match/<gid>` →
(strip `/bolo-mp`) → this server's `/match/<gid>` (wired via `GROWN_BOLO_MP_URL`).

---

## Recommended shape: SIDECAR in the grown pod  ✅

**grown is single-replica.** Running the Bolo MP server as a **second container in
the grown pod** is the simplest correct option:

- **Automatic gid-stickiness for free.** grown proxies to `127.0.0.1:6173` (same
  pod). Because grown is single-replica, every `/bolo-mp/match/<gid>` for a given
  `gid` necessarily reaches the one-and-only Bolo process — no session affinity,
  no hash-on-gid ingress, no separate Service needed. One process hosts many
  rooms (the server is multi-room).
- **No new ingress.** The WebSocket rides grown's existing ingress (which already
  passes `Connection: Upgrade` for Docs/Sheets/Twenty subscriptions). The browser
  only ever talks to grown's origin; `wss://` is handled by grown's TLS.
- **Shared lifecycle.** Restart/rollout of the pod restarts both; acceptable for
  an MVP (a Bolo restart drops in-flight matches — there's no reconnect yet, same
  as M1).

**Trade-off:** the Bolo server shares the pod's resources and rollout cadence with
grown. For a game whose state is ephemeral and link-gated, that's fine. If/when
Bolo needs independent scaling or its own rollout, promote it to the standalone
Deployment below (the env wiring is identical — only the URL host changes).

### Sidecar manifest snippet

Add this container to the grown pod's Deployment `spec.template.spec.containers`
(drop into the gitops repo's grown Deployment). Replace the image ref with the
pushed tag (see go-live).

```yaml
# --- add to the grown Deployment's containers: list -------------------------
- name: bolo-mp
  image: code.pick.haus/grown/bolo-mp:<TAG>   # e.g. :2026-06-13 or a digest
  imagePullPolicy: IfNotPresent
  ports:
    - name: bolo-mp
      containerPort: 6173
  env:
    - name: PORT
      value: "6173"
    # The container ships its own copy of the /games/bolo assets, so WEBROOT can
    # stay at the image default (/app/webroot). It only serves the WS in-cluster;
    # the static assets come from grown's SPA. Leaving the default is harmless.
    - name: ROOM_TTL_MS
      value: "300000"     # GC empty rooms after 5 min
    - name: MAX_ROOMS
      value: "200"
  readinessProbe:
    httpGet: { path: /healthz, port: 6173 }
    initialDelaySeconds: 3
    periodSeconds: 5
  livenessProbe:
    httpGet: { path: /healthz, port: 6173 }
    initialDelaySeconds: 10
    periodSeconds: 15
  resources:
    requests: { cpu: "50m", memory: "64Mi" }
    limits:   { cpu: "500m", memory: "256Mi" }
```

### Env wiring on the grown container (same pod)

Add one env var to the **grown** container in the same Deployment so its
`/bolo-mp/*` reverse-proxy targets the sidecar on localhost:

```yaml
# --- add to the grown container's env: list ---------------------------------
- name: GROWN_BOLO_MP_URL
  value: "http://127.0.0.1:6173"
```

That's the whole wiring. grown's `/bolo-mp/*` handler (already merged into
`internal/server/server.go`) strips the prefix and proxies, including the WS
upgrade. No Service, no Ingress change.

---

## Alternative: standalone single-replica Deployment + Service

Use this only if Bolo needs its own rollout/scaling independent of grown. Keep
**`replicas: 1`** (stateful, sticky). To scale past one pod you'd need hash-on-gid
routing at the ingress (out of scope for the MVP).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bolo-mp
  namespace: grown          # same namespace as grown
spec:
  replicas: 1               # STATEFUL: do not increase without gid-sticky routing
  strategy:
    type: Recreate          # never run two replicas at once (would split rooms)
  selector:
    matchLabels: { app: bolo-mp }
  template:
    metadata:
      labels: { app: bolo-mp }
    spec:
      containers:
        - name: bolo-mp
          image: code.pick.haus/grown/bolo-mp:<TAG>
          ports: [{ name: bolo-mp, containerPort: 6173 }]
          env:
            - { name: PORT, value: "6173" }
            - { name: ROOM_TTL_MS, value: "300000" }
            - { name: MAX_ROOMS, value: "200" }
          readinessProbe: { httpGet: { path: /healthz, port: 6173 }, periodSeconds: 5 }
          livenessProbe:  { httpGet: { path: /healthz, port: 6173 }, periodSeconds: 15 }
          resources:
            requests: { cpu: "50m", memory: "64Mi" }
            limits:   { cpu: "500m", memory: "256Mi" }
---
apiVersion: v1
kind: Service
metadata:
  name: bolo-mp
  namespace: grown
spec:
  selector: { app: bolo-mp }
  ports: [{ name: bolo-mp, port: 6173, targetPort: 6173 }]
```

Then point grown at the Service DNS instead of localhost:

```yaml
# --- on the grown container's env: ---
- name: GROWN_BOLO_MP_URL
  value: "http://bolo-mp.grown.svc.cluster.local:6173"
```

---

## Go-live steps (the human runs these — deliberately)

1. **Build the image** (already smoke-tested locally as `bolo-mp:dev`):
   ```sh
   cd ~/workspace/_ports/orona
   GROWN_BOLO_ASSETS=~/workspace/itpick/grown-workspace/web/app/public/games/bolo \
     build/docker-build.sh code.pick.haus/grown/bolo-mp:2026-06-13
   ```
   (The build script rsyncs the grown `/games/bolo` assets into the context so the
   image's WEBROOT is self-contained, then `docker build`s.)

2. **Push to the registry** (`code.pick.haus`, the Forgejo registry grown uses):
   ```sh
   docker login code.pick.haus            # if not already
   docker push code.pick.haus/grown/bolo-mp:2026-06-13
   ```
   Prefer pinning by digest in the manifest for immutability.

3. **gitops edit** (in the gitops repo, NOT here):
   - **Sidecar (recommended):** add the `bolo-mp` container snippet to the grown
     Deployment's `containers:` and add `GROWN_BOLO_MP_URL=http://127.0.0.1:6173`
     to the grown container's `env:`.
   - **Standalone:** add the Deployment+Service manifest and set
     `GROWN_BOLO_MP_URL=http://bolo-mp.grown.svc.cluster.local:6173`.

4. **Ship the grown app change.** The grown server changes (the `/bolo-mp` proxy +
   env field) and the web changes (`play.html` online UI + the patched
   `bolo-bundle.js`) go out in the next grown image build/deploy. The `/bolo-mp`
   proxy is a no-op (returns 502) until `GROWN_BOLO_MP_URL` is set and the server
   is up, so the order of (3) and (4) is not load-bearing — single-player Bolo is
   unaffected throughout.

5. **Verify in-cluster:**
   ```sh
   # liveness through grown's ingress:
   curl -fsS https://<grown-host>/bolo-mp/healthz        # -> ok
   ```
   Then open two browsers at
   `https://<grown-host>/games/bolo/play.html` → **Play Online** → **Create game
   & get link** → share the link to the second browser. Both should join the same
   Everard Island match and see each other's tanks move (the M2 smoke-test, but
   in-cluster over `wss://`).

---

## Notes / caveats

- **Asset/IP:** GPL v2 + © 1993 Stuart Cheshire art/audio (see `NOTICE`). Fine for
  a **private** instance; **blocks any public deploy** until art is cleared or
  replaced. Keep Bolo behind grown's account wall at the *page* level even though
  the WS itself is link-gated.
- **No reconnect/persistence:** a dropped socket loses the tank; a pod restart
  drops all in-flight matches. Acceptable for the MVP (matches are casual + link-
  gated). Reconnect/lobby/room-TTL tuning are future work.
- **Scaling:** one pod hosts many rooms. To exceed one pod you need gid-sticky
  ingress (hash-on-path) or a lobby that assigns rooms to pods — explicitly out of
  scope here; keep `replicas: 1`.
- **Map:** Everard Island only (M1 parity). `MAP_FILE`/`MapIndex` can generalize
  later.
```
