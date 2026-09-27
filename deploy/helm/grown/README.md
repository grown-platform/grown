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
Gateway HTTPRoute.

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
  --set image.tag=20260613-150615-2d752d1c \
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
