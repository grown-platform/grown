# Guacamole Gateway — Phase 1 Design (gateway + `ls`-only sandbox)

**Status:** approved 2026-06-19. Phase 1 of a 3-phase effort (see _Roadmap_).

**Goal:** Stand up an Apache Guacamole clientless SSH/RDP/VNC gateway on the
pick.haus deployment at `guac.pick.haus`, behind Zitadel SSO, and flip grown's
existing Access-page "coming soon" section live. Prove the gateway→target
pipeline end-to-end with exactly one safe target: a locked-down container whose
session can only run `ls` and nothing else.

**Non-goals (Phase 1):** on-demand container desktops (Phase 2), KubeVirt VMs
(Phase 3), pick.haus's real multi-target fleet, grown-managed connections via
Guacamole's REST API, per-org connection scoping. Phase 1 is the foundation
those build on.

---

## Roadmap (context)

All three target types connect through the same gateway, so the gateway + SSO +
Access-page integration is shared foundation.

- **Phase 1 (this doc):** gateway + transparent SSO + Access page live + one
  `ls`-only sandbox target. Deployed live on pick.haus.
- **Phase 2:** on-demand container desktops (Kasm/webtop-style), one per session,
  auto-registered as Guacamole connections, with lifecycle.
- **Phase 3:** KubeVirt VMs (operator + templates), connected via VNC/RDP.

grown (the product/repo) ships the `ls`-only sandbox as the built-in reference
target; pick.haus (the deployment) grows the real fleet in Phases 2–3.

---

## Instance & integration decisions (locked)

- **Host:** `guac.pick.haus`, served from the **pick.haus** instance
  (Kubernetes namespace `grown`).
- **SSO:** transparent — Guacamole's OpenID (OIDC) extension authenticates
  against the bundled Zitadel at `auth.pick.haus`. Users who are already signed
  into the grown suite are silently signed into Guacamole.
- **Integration depth:** _link + transparent SSO_. grown does **not** manage
  Guacamole connections in Phase 1; connections live in Guacamole's own
  Postgres, edited via Guacamole's admin UI. grown's only change is to surface a
  launch tile/button that opens `guac.pick.haus` in a new tab.
- **Deploy:** authored as reviewable manifests under `deploy/`, then applied
  live to the `grown` namespace and verified end-to-end.

---

## Architecture

```
Browser ──(SSO)──> guac.pick.haus ──> Guacamole web ──> guacd ──SSH──> ls-sandbox
                       │                    │
                  Cloudflare           Guacamole
                  tunnel route          Postgres (its own config/users/conns)
                       │
                  Zitadel OIDC (auth.pick.haus)
```

### Components (all in namespace `grown`)

1. **`guacd`** (`guacamole/guacd`) — the native proxy daemon that speaks
   SSH/RDP/VNC to targets. ClusterIP service on `4822`. No ingress.
2. **Guacamole web** (`guacamole/guacamole`) — the Java webapp + OpenID
   extension. Talks to `guacd` and to Postgres. Exposed at `guac.pick.haus`.
3. **Guacamole Postgres** — a small dedicated Postgres holding Guacamole's
   schema (users, connections, history). **Separate** from grown's database to
   keep trust boundaries clean. Single replica, modest PVC.
4. **`ls`-sandbox** — the single Phase 1 target (see below). ClusterIP service
   on `22`, reachable only by `guacd`.
5. **Exposure** — Cloudflare tunnel ingress rule `guac.pick.haus → guacamole web
   service`, plus an external-dns record. No direct internet exposure of `guacd`,
   Postgres, or the sandbox.

### Why a separate Guacamole Postgres

Guacamole's schema and admin accounts are its own concern; co-locating them in
grown's DB would couple unrelated trust domains and complicate grown's
migrations. A tiny dedicated Postgres is the standard Guacamole deployment and
keeps the gateway self-contained.

---

## The `ls`-only sandbox target

A minimal container that is an SSH target, hardened so a session can **only**
run `ls` and nothing else. It is the safe end-to-end test for the pipeline.

### Approach (recommended): custom SSH server, no OS shell

A tiny Go binary using `github.com/gliderlabs/ssh` that:

- Accepts SSH connections (host key generated at build/start; password/keyboard
  auth accepted from any user — the gateway is the trust boundary, and the
  sandbox does nothing sensitive).
- Presents a minimal interactive line loop: prints a prompt, reads a line, and:
  - if the command is exactly `ls` (optionally `ls <one of a fixed allowlist of
    dirs>`) → prints a **canned/ephemeral listing** of a fake in-memory directory
    tree;
  - anything else → prints `permitted: ls only`.
- Implements **no** PTY shell, no exec of real binaries, no file reads, no
  subprocess spawning. There is no `/bin/sh` path to escape to because the
  server never shells out.

This is strictly more locked-down than a real `sshd` because there is no real
shell or filesystem surface at all.

**Rejected alternative:** stock `sshd` + a restricted login shell + `ForceCommand`.
Simpler to assemble but keeps a real shell/coreutils/filesystem in the image, so
a misconfiguration or coreutils quirk could widen the surface. We avoid shipping
a real shell entirely.

### Defense-in-depth container hardening (regardless of approach)

- Runs as a **non-root** user; `allowPrivilegeEscalation: false`; **all
  capabilities dropped**; `seccompProfile: RuntimeDefault`.
- **Read-only root filesystem**; only an `emptyDir` for the host key if needed.
- **No mounts** of secrets/configmaps/host paths.
- **`NetworkPolicy`:** ingress allowed **only from the `guacd` pod** on `:22`;
  **egress deny-all** (the sandbox never needs to reach anything).
- Tiny resource `limits` (e.g. 32Mi/50m) so it can't be used for compute.
- Single replica; stateless; restart-safe.

Net effect: even a total escape of the (shell-less) server reaches an empty,
network-isolated, read-only, unprivileged container.

---

## SSO / OIDC

- Create a **Zitadel OIDC client** for Guacamole (in the pick.haus Zitadel):
  redirect URI `https://guac.pick.haus/`, response type `code`, scopes
  `openid profile email`.
- Configure Guacamole's OpenID extension via env: `OPENID_AUTHORIZATION_ENDPOINT`,
  `OPENID_JWKS_ENDPOINT`, `OPENID_ISSUER`, `OPENID_CLIENT_ID`,
  `OPENID_REDIRECT_URI=https://guac.pick.haus/`, `OPENID_USERNAME_CLAIM_TYPE=email`.
- First-login users are auto-created in Guacamole's DB by the OpenID extension.
  An initial admin (the operator) is granted connection-management rights so the
  `ls`-sandbox connection can be assigned. Connection visibility for other users
  is managed in Guacamole's admin UI (Phase 1 keeps this manual).
- **Provisioning:** mirror the existing `grown-zitadel-provision` Job pattern if
  feasible (a Job that creates the OIDC app and writes a Secret), else a
  documented one-time manual client creation. The implementation plan picks the
  concrete path after inspecting the existing provision Job.

---

## grown Access-page change (small)

- Backend: the `internal/access` handler already surfaces a "coming soon" marker
  for the Guacamole section. Add a config signal — `GROWN_GUAC_URL` (server env)
  surfaced to the SPA (e.g. via the existing config endpoint or a `VITE_GUAC_URL`
  build arg) — that, when set, flips the section from "coming soon" to live.
- Frontend (`web/app/src/pages/access/index.tsx`): when the gateway URL is
  present, render the "Browser terminal & desktop" section as a launch
  tile/button that opens the gateway in a new tab (mirrors the existing
  published-apps launch pattern). When absent, keep the current "coming soon"
  placeholder (so other deployments are unaffected).
- No instance hostname is hardcoded in the repo (consistent with the recent
  pick.haus-host cleanup): the URL comes from config/env, injected per-deploy.

---

## Security model

- **Trust boundary = the gateway.** Reaching a target requires passing Zitadel
  SSO at `guac.pick.haus`. `guacd`, Postgres, and the sandbox have **no**
  ingress except from their intended in-cluster peer.
- The sandbox is deliberately worthless to an attacker (shell-less, empty,
  network-isolated, read-only, unprivileged) so it is safe to expose even on the
  public instance.
- Guacamole admin credentials are OIDC-gated; no default Guacamole password is
  left enabled (the built-in `guacadmin` is disabled/removed once OIDC admin is
  established).
- Cloudflare tunnel terminates TLS; only the Guacamole web service is published.

## Failure / edge handling

- If `GROWN_GUAC_URL` is unset (e.g. grown.haus, other deploys), the Access page
  shows the unchanged "coming soon" section — no broken links.
- If Guacamole/Postgres is down, the gateway host returns its own error; grown
  is unaffected (it only links out).
- OIDC misconfig → Guacamole shows its login error at `guac.pick.haus`; grown
  unaffected.

## Testing & verification

- **Sandbox unit test:** a Go test for the `ls`-only SSH server — assert `ls`
  returns the canned listing and every other command returns the rejection
  string; assert no PTY/exec path exists.
- **Container hardening check:** the manifest sets the documented
  securityContext + NetworkPolicy; verified by reading back the applied objects.
- **End-to-end (live):** browse `guac.pick.haus` → SSO redirects to
  `auth.pick.haus` → back signed in → open the `ls-sandbox` connection → confirm
  `ls` lists, other commands are rejected, and no shell/file access is possible.
- **grown Access page:** with `GROWN_GUAC_URL` set, the section renders a working
  launch button; unset, it shows "coming soon".

## Deployment plan (high level; detailed steps in the implementation plan)

1. Author manifests under `deploy/` (guacd, guacamole web, Guacamole Postgres,
   ls-sandbox + NetworkPolicy, services). Image for the sandbox built and pushed
   to the existing registry (`code.pick.haus/grown/...`).
2. Create the Zitadel OIDC client for Guacamole.
3. Apply to the `grown` namespace; add the Cloudflare tunnel route + external-dns
   record for `guac.pick.haus`.
4. Seed the `ls-sandbox` connection in Guacamole; grant the operator admin.
5. Set `GROWN_GUAC_URL` on the pick.haus grown deployment; ship the Access-page
   change.
6. Verify end-to-end per _Testing_.

## Out of scope (explicit)

- grown.haus gateway (Phase 1 targets pick.haus only; grown.haus keeps "coming
  soon" until a later rollout).
- Any real/interactive target beyond the `ls`-sandbox.
- Connection lifecycle, per-session containers, org scoping, audit surfacing in
  grown's admin — later phases.
