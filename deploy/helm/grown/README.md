# Grown Workspace — all-in-one Helm chart

Brings up a **complete, self-contained** Grown Workspace instance on any vanilla
Kubernetes cluster — **no operators required**. Everything grown needs is
bundled as plain StatefulSets/Deployments so it runs the same on:

- **kind** on a laptop,
- a **Raspberry Pi 5** cluster (arm64),
- a homelab.

Bundled: **Postgres** (StatefulSet) · **MinIO** S3 storage (StatefulSet +
bucket-init Job) · **Zitadel** OIDC (Deployment + auto-provisioning Job) · the
**grown** app (Deployment + optional `bolo-mp` sidecar) · optional Ingress /
Gateway HTTPRoute.

## Quickstart

```sh
helm install grown deploy/helm/grown -n grown --create-namespace \
  --set domain=grown.example.com
```

Watch it come up, then port-forward:

```sh
kubectl get pods -n grown -w
kubectl -n grown port-forward svc/grown-grown 8080:8080
curl http://localhost:8080/healthz
```

Default login (bundled Zitadel admin): **`admin@grown.localtest.me`** /
**`DevPassword!1`**.

### kind (laptop)

```sh
kind create cluster --name grown
helm install grown deploy/helm/grown -n grown --create-namespace \
  --set domain=grown.localtest.me
# default storageClass "" uses kind's `standard` (local-path) — works as-is.
kubectl -n grown port-forward svc/grown-grown 8080:8080
```

### Raspberry Pi 5 / k3s (arm64)

All bundled images (postgres, minio, zitadel, alpine/k8s, minio/mc) are
multi-arch and run on arm64. The grown app image must be built for arm64.

```sh
helm install grown deploy/helm/grown -n grown --create-namespace \
  --set domain=grown.pi.local \
  --set storageClass=local-path \
  --set ingress.type=ingress --set ingress.className=traefik
```

k3s ships Traefik + the `local-path` storageClass; set `storageClass` if the
default differs. The whole stack is single-replica and modestly sized
(adjust `*.resources` for a Pi's memory budget).

### Production / homelab

Use the chart as a base but lean on real infrastructure:

```sh
helm install grown deploy/helm/grown -n grown --create-namespace \
  --set domain=workspace.example.com \
  --set scheme=https \
  --set session.cookieSecure=true \
  --set storageClass=ceph-block \
  --set ingress.type=httproute \
  --set image.tag=20260613-150615-2d752d1c \
  --set imagePullSecrets.existingSecret=forgejo-registry \
  # swap bundled deps for production-grade ones:
  --set postgres.externalDsn='postgres://grown:...@grown-db-rw:5432/grown' \
  --set minio.enabled=false --set minio.external.endpoint=http://rustfs:9100 \
  --set auth.mode=external \
  --set auth.external.issuer=https://auth.example.com \
  --set auth.external.clientId=... --set auth.external.clientSecret=...
```

- **Postgres**: production should run CloudNativePG (CNPG) or a managed DB and
  point `postgres.externalDsn` at it (the bundled single-replica StatefulSet has
  no HA/backups). The homelab uses CNPG (`grown-db` cluster, secret `grown-db-app`).
- **Object storage**: the homelab uses **rustfs** (also S3-compatible). Set
  `minio.enabled=false` and `minio.external.endpoint` to use it; the S3 keys in
  `values.yaml` still apply.
- **Auth**: use `auth.mode=external` with your real Zitadel/OIDC issuer.

## Key values

| Value | Default | Purpose |
|---|---|---|
| `domain` | `grown.localtest.me` | public hostname (redirect URL, ingress host, cookie domain) |
| `scheme` | `http` | `http`/`https` for external URLs |
| `image.repository` / `image.tag` | `code.pick.haus/grown/grown` / appVersion | grown image |
| `storageClass` | `""` (cluster default) | PVC storage class |
| `adminEmails` | `admin@grown.localtest.me` | super-admin allowlist |
| `ingress.type` | `none` | `none` / `ingress` / `httproute` |
| `auth.mode` | `bundled` | `bundled` (in-cluster Zitadel) or `external` |
| `bolo.enabled` | `false` | enable the bolo-mp multiplayer sidecar |
| `postgres.externalDsn` | `""` | use an external Postgres, skip bundled |
| `minio.enabled` | `true` | bundle MinIO; false => `minio.external.endpoint` |
| `pdf.enabled` | `true` | built-in PDF signing app |
| `persistence` sizes / `*.resources` | see values | per-component sizing |

See `values.yaml` for the fully-documented set.

## Zitadel & real login (the sticking point)

With `auth.mode=bundled` the chart **fully automates** the OIDC client: the
Zitadel Deployment runs `start-from-init` (creates the first-instance admin +
bootstrap service account + PAT), and the `grown-zitadel-provision` Job reads
that PAT, creates the grown project/OIDC app, and writes the
`grown-zitadel-secret` (client-id/client-secret). grown picks it up automatically.

**The one caveat** is browser-facing login. grown talks to Zitadel over the
in-cluster Service (`http://grown-zitadel...:8080`), which is the issuer it
hands the browser. For an end-to-end SSO login the user's **browser** must be
able to reach Zitadel at that **same** issuer URL. In-cluster, a laptop browser
can't. To get real login working you have two options:

1. **Expose Zitadel** at a public domain and set `zitadel.externalDomain` /
   `zitadel.externalSecure` plus an Ingress/HTTPRoute for it, so the issuer URL
   is browser-reachable. (Then re-point `auth` accordingly.) Zitadel is strict
   about its `ExternalDomain` matching the URL it's accessed by.
2. **Use `auth.mode=external`** against an already-exposed Zitadel/OIDC issuer
   (the cleanest path for production; this is what the homelab does).

`/healthz` and the whole app stand up regardless; only the login redirect needs
the issuer to be browser-reachable.

## Validate

```sh
helm lint deploy/helm/grown
helm template grown deploy/helm/grown -n grown --set domain=grown.example.com \
  > deploy/manifests/grown.yaml
```

## Uninstall

```sh
helm uninstall grown -n grown
kubectl delete ns grown   # also removes PVCs + the kept OIDC secret
```
