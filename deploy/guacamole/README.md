# Guacamole gateway — Phase 1 deployment bundle

Apache Guacamole clientless SSH/RDP/VNC gateway for the **pick.haus** instance
(namespace `grown`), served at **`guac.pick.haus`** behind Zitadel SSO, with one
safe target: the `ls`-only sandbox (`cmd/ls-sandbox`).

Design: `docs/superpowers/specs/2026-06-19-guacamole-gateway-phase1-design.md`.

> This repo can't reach your gitops/Flux repo or Cloudflare, so the steps marked
> **[gitops]** / **[cloudflare]** are yours to wire. Everything else is here.

## Components (apply in order)

| File | What |
| --- | --- |
| `00-postgres.yaml` | dedicated Postgres for Guacamole's own config |
| `10-initdb-job.yaml` | one-shot Job that loads Guacamole's schema (idempotent) |
| `20-guacd.yaml` | the `guacd` proxy daemon (internal only) |
| `30-guacamole.yaml` | the Guacamole webapp + OIDC config (served at `guac.pick.haus`) |
| `40-ls-sandbox.yaml` | the `ls`-only target + NetworkPolicy |

## Prerequisites

1. **Sandbox image:** merging `cmd/ls-sandbox/**` to `main` triggers
   `.forgejo/workflows/ls-sandbox.yaml`, which builds + pushes
   `code.pick.haus/grown/ls-sandbox:latest`. Confirm it's in the registry before
   applying `40-ls-sandbox.yaml`.
2. **Pull secret:** `40-...` uses the existing `forgejo-registry` pull secret in
   `grown` (already present).
3. **Postgres password:** replace the placeholder in `00-postgres.yaml` with a
   real secret (sealed-secret / SOPS) in gitops.

## Step A — Zitadel OIDC client for Guacamole

Guacamole's OpenID extension uses the **implicit** flow (it reads an `id_token`
from the redirect fragment), so create a **public** OIDC app (no client secret).
Run against the in-cluster Zitadel (note the required `Host` header — bundled
Zitadel rejects API calls without it):

```sh
# Token: reuse the bootstrap PAT the grown-zitadel-provision Job uses
# (shared PVC, /shared/bootstrap-pat.txt), or a Zitadel PAT with org.write.
ZITADEL=http://zitadel.zitadel.svc.cluster.local:8080
HOST=auth.pick.haus
TOKEN=...   # bootstrap PAT
api() { curl -s -H "Host: $HOST" -H "Authorization: Bearer $TOKEN" \
             -H "Content-Type: application/json" "$@"; }

# find the existing "grown" project id (created by grown's own provisioning)
PID=$(api -X POST "$ZITADEL/management/v1/projects/_search" \
        -d '{"queries":[{"nameQuery":{"name":"grown","method":"TEXT_QUERY_METHOD_EQUALS"}}]}' \
      | jq -r '.result[0].id')

# create the public (implicit, id_token) OIDC app for Guacamole
CID=$(api -X POST "$ZITADEL/management/v1/projects/$PID/apps/oidc" -d '{
  "name":"guacamole",
  "redirectUris":["https://guac.pick.haus/"],
  "responseTypes":["OIDC_RESPONSE_TYPE_ID_TOKEN"],
  "grantTypes":["OIDC_GRANT_TYPE_IMPLICIT"],
  "appType":"OIDC_APP_TYPE_USER_AGENT",
  "authMethodType":"OIDC_AUTH_METHOD_TYPE_NONE",
  "postLogoutRedirectUris":["https://guac.pick.haus/"]
}' | jq -r '.clientId')

# store the client id for 30-guacamole.yaml
kubectl -n grown create secret generic guac-zitadel-secret \
  --from-literal=client-id="$CID" --dry-run=client -o yaml | kubectl apply -f -
```

(For gitops, capture `guac-zitadel-secret` as a sealed-secret instead of applying
imperatively.)

## Step B — Cloudflare tunnel route  **[gitops]**

Add this ingress rule to the gitops-managed `cloudflared` ConfigMap (ns
`network`), above the catch-all 404 rule:

```yaml
- hostname: "guac.pick.haus"
  service: http://guacamole.grown.svc.cluster.local:8080
```

## Step C — Cloudflare hostname  **[cloudflare]**

Ensure `guac.pick.haus` is published on the tunnel (Cloudflare dashboard →
the tunnel's Public Hostnames), so Cloudflare issues the edge TLS cert and CNAMEs
it to the tunnel — same as the other `*.pick.haus` hosts.

## Step D — Apply the manifests  **[gitops]**

Drop `deploy/guacamole/*.yaml` into the path your Flux Kustomization reconciles
for the `grown` namespace. Order is encoded in the filenames (00 → 40).

## Step E — Seed the `ls`-sandbox connection

Once `guac.pick.haus` loads and you've logged in via SSO, in Guacamole's admin
(Settings → Connections) create an **SSH** connection:

- **Hostname:** `ls-sandbox`  **Port:** `2222`
- **Username/Password:** anything (the sandbox accepts any; it's the gateway that
  authenticates you)

Assign it to the users/groups who should see it. (Phase 2+ will manage
connections programmatically; Phase 1 keeps this manual.)

## Step F — Flip grown's Access page live

Set `GROWN_GUAC_URL=https://guac.pick.haus/` on the pick.haus `grown` deployment.
The Access page's "Browser terminal & desktop" section switches from "coming
soon" to a launch button (see the `internal/access` + `web/app/src/pages/access`
change in this branch). Unset on other deploys → unchanged "coming soon".

## Verify

1. Browse `https://guac.pick.haus/` → redirected to `auth.pick.haus` → back,
   signed in (no Guacamole login prompt).
2. Open the `ls-sandbox` connection → a terminal opens; `ls` lists the fake tree;
   every other command returns `permitted: ls only`; no shell/file access.
3. grown Access page shows a working "Open browser terminal" button.
