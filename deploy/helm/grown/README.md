# Grown Workspace — all-in-one Helm chart

Brings up a **complete, self-contained** Grown Workspace instance on any vanilla
Kubernetes cluster — **no operators required**. Everything grown needs is
bundled as plain StatefulSets/Deployments so it runs the same on:

- **kind** on a laptop,
- a **Raspberry Pi 5** cluster (arm64),
- a homelab.

Bundled: **Postgres** (StatefulSet) · **rustfs** S3 storage (StatefulSet +
bucket-init hook Job) · **Zitadel** OIDC (Deployment + auto-provisioning Job) · the
**grown** app (Deployment + optional `bolo-mp` sidecar) · optional Ingress /
Gateway HTTPRoute · **Home Assistant** (StatefulSet, on by default since 0.4.0,
auto-onboarded, with the Grown integration pre-installed).

> **Chart 0.4.0 adds Home Assistant to the default install.** Upgrading from
> 0.3.x? See [Upgrading from 0.3.x](#upgrading-from-03x-to-040-home-assistant).
>
> **Chart 0.2.0 replaced MinIO with rustfs.** Upgrading an existing 0.1.x
> install? Read [Upgrading from 0.1.x](#upgrading-from-01x-minio-to-020-rustfs)
> first: a plain chart bump is refused while the old MinIO is still running.

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

All bundled images (postgres, rustfs, zitadel, alpine/k8s, aws-cli, rclone)
are multi-arch and run on arm64. The grown app image must be built for arm64.

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
  --set image.tag=v0.4.0 \
  --set imagePullSecrets.existingSecret=forgejo-registry \
  # swap bundled deps for production-grade ones:
  --set postgres.externalDsn='postgres://grown:...@grown-db-rw:5432/grown' \
  --set rustfs.enabled=false --set rustfs.external.endpoint=http://rustfs:9100 \
  --set rustfs.external.accessKey=... --set rustfs.external.secretKey=... \
  --set auth.mode=external \
  --set auth.external.issuer=https://auth.example.com \
  --set auth.external.clientId=... --set auth.external.clientSecret=...
```

- **Postgres**: production should run CloudNativePG (CNPG) or a managed DB and
  point `postgres.externalDsn` at it (the bundled single-replica StatefulSet has
  no HA/backups). The homelab uses CNPG (`grown-db` cluster, secret `grown-db-app`).
- **Object storage**: the bundled rustfs is a single-node StatefulSet. To use
  an existing S3 endpoint instead set `rustfs.enabled=false` plus
  `rustfs.external.endpoint` / `accessKey` / `secretKey` (0.1.x's
  `minio.external.endpoint` / `minio.accessKey` / `minio.secretKey` are still
  honoured as fallbacks).
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
| `rustfs.enabled` | `true` | bundle rustfs; false => `rustfs.external.*` |
| `rustfs.bucket` | `""` => `minio.bucket` => `grown-default` | app bucket |
| `rustfs.persistence.size` | `""` => `minio.persistence.size` (20Gi) | rustfs PVC size |
| `rustfs.existingSecret` | `""` | Secret with `access_key`/`secret_key`; empty => generated once |
| `minio.enabled` | `false` | LEGACY: keep a 0.1.x MinIO running for the migration |
| `migrateFromMinio.enabled` | `false` | one-shot MinIO -> rustfs copy Job |
| `pdf.enabled` | `true` | built-in PDF signing app |
| `homeAssistant.enabled` | `true` | run Home Assistant; its URL becomes the HA tile default (below) |
| `homeAssistant.host` | `""` => `ha.<domain>` | HA's own hostname (HA can't live under a sub-path) |
| `homeAssistant.trustedProxies` | RFC1918 + `fd00::/8` | `http.trusted_proxies` seeded into HA's first `configuration.yaml` |
| `homeAssistant.owner.existingSecret` | `""` => generated `<release>-homeassistant-owner` | HA owner `username`/`password` the chart onboards HA with |
| `homeAssistant.onboarding.enabled` | `true` | onboard HA automatically (no open "create owner" page) |
| `homeAssistant.grownIntegration.enabled` | `true` | install the Grown HA integration from grown on every HA start |
| `homeAssistant.http.useXFrameOptions` | `false` | `false` seeds `use_x_frame_options: false` so Grown can iframe HA |
| `grown.libreoffice.enabled` | `false` | legacy .doc/.xls/.ppt import via LibreOffice headless; needs an image with LibreOffice (below) |
| `persistence` sizes / `*.resources` | see values | per-component sizing |

See `values.yaml` for the fully-documented set.

### Optional: LibreOffice import

Grown's default image has no LibreOffice. To accept legacy Word/Excel/
PowerPoint files (`.doc`, `.xls`, `.ppt`, plus `.wpd`, `.dot`, `.xlt`,
`.pps`, `.pot`), build an image that adds it (see the note at the end of the
`Dockerfile`), then:

```yaml
image: { repository: registry.example/grown-libreoffice, tag: v1.2.3 }
grown:
  libreoffice: { enabled: true }
  resources: { limits: { memory: 1Gi } }  # soffice needs ~300 MiB per conversion
```

The server converts uploads to docx/xlsx/pptx with `soffice --headless` and
the browser's normal importers take over. Every run gets its own temp dir
and throwaway profile with macro execution disabled, untrusted links
blocked and external links never updated; input is magic-checked, size-
capped, time-limited (process group killed) and concurrency-limited.
LibreOffice is MPL-2.0 and only exec'd, never linked. `GET
/api/v1/convert/capabilities` reports whether it's active; the UI only
offers legacy formats when it is.

### Home Assistant (default on)

Grown's **Home Assistant** tile is bring-your-own: an org admin sets the
org's HA URL in **Admin > Services > Home Assistant** and the tile appears
(hidden until then). Since 0.4.0 the chart also runs an HA instance by
default; turn it off with `homeAssistant.enabled: false`.

```yaml
homeAssistant:
  enabled: true                           # default
  # host: ha.grown.example.com            # default ha.<domain>
  # trustedProxies: [10.42.0.0/16]        # your pod CIDR / proxy IPs
  # owner: { existingSecret: my-ha-owner } # keys: username, password
  persistence: { size: 5Gi }
```

That renders a single-replica StatefulSet (`ghcr.io/home-assistant/home-assistant`,
pinned tag), a PVC for `/config`, a Service on 8123 and an Ingress/HTTPRoute
for `homeAssistant.host` using the same `ingress.*` settings as grown (make
sure your TLS secret / DNS covers that host). grown gets
`GROWN_HOMEASSISTANT_URL=<scheme>://<host>` (or `homeAssistant.url`), which
the service-settings API reports as the tile URL for every org that hasn't
set its own; org URLs always win. `homeAssistant.setGrownDefault: false`
turns that off. Without the chart component you can still set a
deployment-wide default via `grown.extraEnv` `GROWN_HOMEASSISTANT_URL`.

The pod:

| Container | Kind | Job |
|---|---|---|
| `seed-config` | init | copy `configuration.yaml` & co. into `/config` **only if missing** |
| `grown-integration` | init | install `grown.zip` from the grown Service into `/config/custom_components/grown` (every start) |
| `homeassistant` | main | HA; **Ready only once onboarding's owner step is done** |
| `onboard` | sidecar | create the owner over localhost and finish onboarding (idempotent) |

#### No open onboarding window

A fresh HA serves a first-run page where the **first visitor creates the
owner** account; on a public install whoever gets there first owns your HA.
The chart closes that window itself:

- The `onboard` sidecar polls `http://127.0.0.1:8123` every second and, as
  soon as HA's HTTP server is up, runs HA's onboarding API: `POST
  /api/onboarding/users` with the owner from the Secret, exchanges the auth
  code at `/auth/token`, then completes `core_config`, `analytics` and
  `integration`. If an earlier run stopped half-way it logs in with the
  Secret's credentials (login flow) and finishes the remaining steps. When
  onboarding is already done, a pass is a single `GET /api/onboarding`; it
  re-checks every `onboarding.recheckSeconds`, so a wiped
  `/config/.storage` is re-onboarded too.
- The `homeassistant` container's **readiness probe** is `onboard.py --check`,
  which passes only when the `user` step is done. Until then the pod is
  NotReady, the Service has no endpoints, and neither the Ingress/HTTPRoute
  nor anything else going through the Service can reach the owner page. The
  only thing that could, for the second or so before the sidecar posts, is
  another pod dialling the pod IP directly; add a NetworkPolicy if your
  cluster has untrusted workloads.
- The sidecar runs as `nobody` (65534) with a read-only root filesystem and
  no access to `/config`; it only needs the network.

The owner Secret (`<release>-homeassistant-owner`, keys `username` /
`password`) is generated once with a random 32-character password, reused via
`lookup` on upgrades, and kept on `helm uninstall` (like the PVC holding the
owner it created). Bring your own with `homeAssistant.owner.existingSecret`.
Read the password:

```sh
kubectl -n <ns> get secret <release>-homeassistant-owner -o jsonpath='{.data.password}' | base64 -d
```

Changing the password in HA afterwards is fine: the Secret is only used to
create the owner on a fresh `/config`, or to finish a half-done onboarding.
Set `homeAssistant.onboarding.enabled: false` only if you onboard HA yourself
**before** exposing it.

#### The Grown integration

On every start the `grown-integration` initContainer downloads
`http://<release>-grown.<ns>.svc.cluster.local:8080/integrations/homeassistant/grown.zip`
(served by grown itself, public) into `/config/custom_components/grown`, so
HA always runs the integration version matching the deployed Grown. It retries
for `grownIntegration.fetchTimeoutSeconds` (180) while grown starts, then
**starts HA anyway** (keeping any previously installed copy) and logs it; the
next pod start tries again (on a first install, restart the HA pod once grown
is up). Then, in HA: **Settings > Devices & services > Add integration >
Grown Workspace**, with the Grown URL and a token from Grown's **Settings >
API tokens > "Connect Home Assistant"**. Entities: see
[docs/services/homeassistant.md](../../../docs/services/homeassistant.md#the-grown-integration-for-home-assistant).

#### Config seed and embedding

- **First start only**, `seed-config` copies `configuration.yaml`
  (`default_config:`, `http.use_x_forwarded_for: true` + `trusted_proxies`,
  `http.use_x_frame_options: false`, and the `automations/scripts/scenes`
  includes). Each file is copied only if missing, so the chart **never
  overwrites** your config; changing `trustedProxies` (or the frame option)
  later means editing `/config/configuration.yaml`. HA answers 400 to
  proxied requests from an IP outside `trusted_proxies`.
- **Embedding trade-off:** `use_x_frame_options: false` lets Grown's
  `/homeassistant` page show HA in an iframe, but it also lets **any** site
  frame your HA (clickjacking: a hostile page overlays HA's UI and tricks a
  logged-in user into clicking). Set `homeAssistant.http.useXFrameOptions:
  true` before the first start (or set `use_x_frame_options: true` / remove
  the line in `configuration.yaml` and restart HA) to restore HA's default
  `X-Frame-Options: SAMEORIGIN`; Grown then only links out to HA.

#### Security and limits

- The official image runs as **root** (s6-overlay; HA pip-installs
  integration deps at runtime), so no `runAsNonRoot` or read-only root
  filesystem for HA itself. The chart runs it with **all capabilities
  dropped**, `allowPrivilegeEscalation: false`, RuntimeDefault seccomp and
  **host networking off** (verified on 2026.9.4). If `/config` isn't
  root-owned, add `CHOWN`/`DAC_OVERRIDE`/`FOWNER` to
  `homeAssistant.securityContext.capabilities.add`.
- **Resources:** HA 2026.9 with `default_config` idles at ~300 MiB, so the
  defaults request 50m CPU / 384Mi and cap memory at 1536Mi (the sidecar adds
  ~12 MiB). Raise the limit for heavy integrations.
- **No discovery:** without host networking, mDNS/SSDP/DHCP/Bluetooth
  discovery doesn't work (a harmless `aiodhcpwatcher ... Operation not
  permitted` log line). Add integrations by IP/hostname. If you need
  discovery or USB radios (Zigbee/Z-Wave), run HA outside the cluster, set
  `homeAssistant.enabled: false`, and use the bring-your-own URL instead.
- `helm uninstall` keeps the PVC (`config-<release>-homeassistant-0`) and the
  owner Secret.

See [docs/services/homeassistant.md](../../../docs/services/homeassistant.md).

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

## Upgrading from 0.3.x to 0.4.0 (Home Assistant)

0.4.0 turns `homeAssistant.enabled` on by default, so a plain `helm upgrade`
of a 0.3.x release that never set it **adds** Home Assistant: a StatefulSet,
a 5Gi PVC (`config-<release>-homeassistant-0`), a Service, an
Ingress/HTTPRoute for `ha.<domain>` (when `ingress.type` isn't `none`), the
kept `<release>-homeassistant-owner` Secret, and `GROWN_HOMEASSISTANT_URL` on
grown (so the Home Assistant tile appears for orgs without their own HA URL).
HA is onboarded automatically; see NOTES for the owner password.

- **Don't want it?** Set `homeAssistant.enabled: false` in your values before
  upgrading. Nothing else changes.
- **Already ran it with `homeAssistant.enabled: true` on 0.3.x?** Your
  `/config` PVC is reused. If you already onboarded HA, the sidecar sees
  that and does nothing (the generated owner Secret is then unused). Your
  existing `configuration.yaml` is **not** changed, so Grown's HA page can't
  embed HA until you add `use_x_frame_options: false` under `http:`
  yourself (see the trade-off above).
- Make sure DNS/TLS cover `ha.<domain>` (or set `homeAssistant.host`), and
  that the node pool has ~400 MiB of memory to spare.
- The integration download needs grown 0.4+ (`/integrations/homeassistant/grown.zip`);
  against an older grown image the initContainer logs a 404 and HA starts
  without it.

## Upgrading from 0.1.x (MinIO) to 0.2.0 (rustfs)

MinIO stopped publishing pullable images (`minio/minio`, `minio/mc`: "pull
access denied"), so 0.1.x's bundled object store can't be installed fresh or
rescheduled onto a node that doesn't already have the image cached. 0.2.0
serves S3 from **rustfs** (`rustfs/rustfs:1.0.0-beta.7`, the same build
pick.haus runs) and points grown (`GROWN_RUSTFS_*`) and the PDF app
(`PDF_STORAGE_*`) at it.

What changes on upgrade:

| | 0.1.x | 0.2.0 |
|---|---|---|
| S3 server | `<release>-minio` StatefulSet, :9000 | `<release>-rustfs` StatefulSet, :9100 |
| Data PVC | `data-<release>-minio-0` | `data-<release>-rustfs-0` (new, empty) |
| Credentials | `minio.accessKey/secretKey` (values) | `<release>-rustfs` Secret, generated once and reused (or `rustfs.existingSecret`) |
| Bucket init | `<release>-minio-init` hook | `<release>-rustfs-init` hook (AWS CLI, idempotent) |
| Bucket names | `minio.bucket`, `pdf.bucket` | unchanged (`rustfs.bucket` defaults to `minio.bucket`) |

rustfs starts **empty**; the objects are copied by an optional Job.

### 1. Upgrade with MinIO kept and the migration on

```yaml
minio:
  enabled: true          # keep the old MinIO StatefulSet/Service/Secret
migrateFromMinio:
  enabled: true          # one-shot copy Job
# optional; both default to the 0.1.x values:
# rustfs:
#   persistence: { size: 20Gi, storageClass: ceph-block }
```

The legacy MinIO pod template is kept byte-identical to 0.1.8, so this upgrade
does **not** restart MinIO (important: the image can no longer be pulled).
Budget storage for both PVCs at once (a namespace `ResourceQuota` on
`requests.storage` must fit MinIO + rustfs while migrating).

With Flux's helm-controller, which waits for Jobs by default, either give the
upgrade enough `timeout` for the copy or set `upgrade.disableWaitForJobs: true`,
so a long copy isn't treated as a failed upgrade (and rolled back).

As soon as the upgrade applies, grown writes new objects to rustfs. Objects
that haven't been copied yet read as missing until the Job finishes. To avoid
that window, scale grown to 0 for the copy
(`kubectl scale deploy/<release>-grown --replicas=0`), then scale it back
to `grown.replicas` once the Job completes.

### 2. The migration Job

`<release>-migrate-from-minio` is a plain Job (not a hook), so it runs once
and keeps its logs:

```sh
kubectl -n <ns> logs -f job/<release>-migrate-from-minio
```

It waits for both endpoints (`migrateFromMinio.waitTimeoutSeconds`). Then, for
each bucket pair (`<minio.bucket>:<app bucket>`, plus `<pdf.bucket>` when
`pdf.enabled`), it:

1. logs the object count and bytes on both sides (`BEFORE ...`);
2. `rclone copy -M`: streams each object MinIO -> rustfs through memory. No
   scratch volume, multipart for large objects, Content-Type and user metadata
   preserved, per-request retries, 4 concurrent transfers
   (`migrateFromMinio.transfers`);
3. logs the counts/bytes again (`AFTER ...`) and fails if rustfs has fewer
   objects or bytes than MinIO;
4. runs `rclone check --one-way`, which fails unless every MinIO object is in
   rustfs with the same size, and the same MD5 where both sides expose one.

The Job only succeeds on `MIGRATION COMPLETE: all buckets verified`. rustfs may
hold *more* than MinIO (grown writes there during the copy); that's expected.

**Why rclone, not an `aws s3 cp` loop:** `aws s3 sync` can't span two
endpoints, and a shell loop of `aws s3 cp - | aws s3 cp -` starts two or three
Python CLI processes per object (hours for tens of thousands of files) and
drops Content-Type unless every header is re-plumbed by hand. rclone does the
same object-by-object streaming in one process, concurrently, with metadata,
retries and verification built in. It is also incremental: already-copied
objects are skipped.

**Re-run** (e.g. after a failure, or once more right before cutting MinIO off
to catch stragglers):

```sh
kubectl -n <ns> delete job <release>-migrate-from-minio
flux reconcile helmrelease <release> -n <ns>   # or: helm upgrade ... (same values)
```

Migrating from a MinIO outside the chart: set
`migrateFromMinio.source.endpoint` and `migrateFromMinio.source.existingSecret`
(keys `access_key` / `secret_key`, renameable via `accessKeyKey` /
`secretKeyKey`); `minio.enabled` can then stay false.

### 3. Verify

```sh
kubectl -n <ns> logs job/<release>-migrate-from-minio | grep -E 'BEFORE|AFTER|verified|FAILED'
kubectl -n <ns> get job <release>-migrate-from-minio   # COMPLETIONS 1/1
```

Then, in grown, open a few pre-upgrade files (Drive, Photos, a signed PDF) and
upload a new one.

### 4. Retire MinIO

Once the Job has succeeded and grown looks right:

```yaml
minio:
  enabled: false
  allowRemoval: true     # acknowledges the MinIO StatefulSet may be deleted
migrateFromMinio:
  enabled: false         # removes the finished Job + its ConfigMap
```

Without `allowRemoval`, an upgrade that would delete a still-running
`<release>-minio` StatefulSet fails to render. This protects anyone who just
bumps the chart version.

The MinIO **PVC is never deleted by the chart.** `data-<release>-minio-0`
comes from a StatefulSet `volumeClaimTemplate`: neither `helm upgrade`,
`helm uninstall` nor the StatefulSet controller deletes those PVCs (the chart
sets no `persistentVolumeClaimRetentionPolicy`, so the default `Retain`
applies). Keep it as a backup for as long as you like. Delete it **by hand**
only once all of these hold:

- the migration Job succeeded (`MIGRATION COMPLETE`), ideally after a final
  re-run with grown scaled to 0 or idle;
- grown has run on rustfs long enough that you've seen old files load;
- `minio.enabled=false` has been applied (no pod mounts the PVC).

```sh
kubectl -n <ns> delete pvc data-<release>-minio-0
kubectl -n <ns> delete job <release>-minio-init --ignore-not-found   # 0.1.x leftover hook
```

Rolling back to 0.1.x after the upgrade (`helm rollback`) deletes the rustfs
StatefulSet but not its PVC, and points grown back at MinIO. Anything written
only to rustfs in the meantime stays on `data-<release>-rustfs-0`.

## Validate

```sh
deploy/helm/grown/tests/render-test.sh     # lint + render invariants
helm lint deploy/helm/grown
helm template grown deploy/helm/grown -n grown --set domain=grown.example.com \
  > deploy/manifests/grown.yaml
```

## Uninstall

```sh
helm uninstall grown -n grown
kubectl delete ns grown   # also removes PVCs + the kept OIDC/rustfs secrets
```
