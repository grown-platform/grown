#!/usr/bin/env bash
# Render-invariant tests for the grown chart (object storage: rustfs + the
# legacy-MinIO migration path). Needs only `helm` (+ bash/awk/grep).
#
#   deploy/helm/grown/tests/render-test.sh
#
# Exits non-zero on the first failed scenario's summary.
set -uo pipefail

CHART="$(cd "$(dirname "$0")/.." && pwd)"
REL=t
NS=grown
fails=0
pass=0

render() { helm template "$REL" "$CHART" -n "$NS" "$@"; }

# doc KIND NAME < manifests : print the single YAML document of that kind+name.
doc() {
  awk -v kind="$1" -v name="$2" '
    function flush() { if (k == kind && n == name) printf "%s", buf; buf = ""; k = ""; n = ""; meta = 0 }
    /^---/ { flush(); next }
    { buf = buf $0 "\n" }
    /^kind: / { k = $2 }
    /^metadata:/ { meta = 1; next }
    meta && /^  name: / && n == "" { n = $2 }
    /^[a-z]/ && !/^metadata:/ { meta = 0 }
    END { flush() }'
}

ok() { pass=$((pass + 1)); }
bad() { echo "  FAIL: $*"; fails=$((fails + 1)); }
has() { grep -qE -- "$2" <<<"$1" && ok || bad "$3 (expected /$2/)"; }
hasnt() { grep -qE -- "$2" <<<"$1" && bad "$3 (unexpected /$2/)" || ok; }

echo "== helm lint"
helm lint "$CHART" >/dev/null && ok || bad "helm lint"

# ---------------------------------------------------------------------------
echo "== defaults: rustfs bundled, no MinIO"
out=$(render) || { bad "render defaults"; out=""; }
hasnt "$out" 'image: "?minio/' "no minio image by default"
hasnt "$out" "name: $REL-minio" "no minio resources by default"
hasnt "$out" 'migrate-from-minio' "no migration job by default"
has "$out" 'image: "rustfs/rustfs:1\.0\.0-beta\.7"' "rustfs image"
sts=$(doc StatefulSet "$REL-rustfs" <<<"$out")
has "$sts" 'value: /data' "RUSTFS_VOLUMES=/data"
has "$sts" 'value: ":9100"' "RUSTFS_ADDRESS=:9100"
has "$sts" 'path: /health' "health probes"
has "$sts" 'runAsUser: 10001' "runs as the image's rustfs uid"
has "$sts" 'fsGroup: 10001' "fsGroup for PVC write access"
has "$sts" 'storage: 20Gi' "default PVC 20Gi"
has "$sts" "name: $REL-rustfs, key: access_key" "rustfs root key from creds secret"
sec=$(doc Secret "$REL-rustfs" <<<"$out")
has "$sec" 'access_key: "[A-Za-z0-9+/=]{8,}"' "generated access key"
has "$sec" 'secret_key: "[A-Za-z0-9+/=]{40,}"' "generated secret key"
has "$sec" 'helm.sh/resource-policy": keep' "creds secret kept on uninstall"
s3=$(doc Secret "$REL-s3" <<<"$out")
has "$s3" "endpoint: \"http://$REL-rustfs\\.$NS\\.svc\\.cluster\\.local:9100\"" "s3 endpoint = rustfs svc"
has "$s3" 'bucket: "grown-default"' "app bucket"
hasnt "$s3" 'access_key|secret_key' "no static keys in s3 secret when rustfs bundled"
app=$(doc Deployment "$REL-grown" <<<"$out")
has "$app" 'GROWN_RUSTFS_ENDPOINT' "app has GROWN_RUSTFS_ENDPOINT"
has "$app" GROWN_RUSTFS_ACCESS_KEY "app has GROWN_RUSTFS_ACCESS_KEY"
[ "$(grep -c "name: $REL-rustfs, key: access_key" <<<"$app")" = 2 ] && ok || bad "app + pdf access keys from $REL-rustfs"
[ "$(grep -c "name: $REL-rustfs, key: secret_key" <<<"$app")" = 2 ] && ok || bad "app + pdf secret keys from $REL-rustfs"
has "$app" 'PDF_STORAGE_ENDPOINT' "pdf app wired to S3"
init=$(doc Job "$REL-rustfs-init" <<<"$out")
has "$init" '"helm.sh/hook": post-install,post-upgrade' "bucket-init is a post-install/upgrade hook"
has "$init" '"helm.sh/hook-delete-policy": before-hook-creation' "bucket-init hook delete policy"
has "$init" 'aws-cli:2\.22\.35' "bucket-init uses AWS CLI image"
has "$init" 'head-bucket --bucket "\$1" 2>/dev/null \|\|' "idempotent head-bucket || create-bucket"
has "$init" 'mkbucket grown-default' "init creates app bucket"
has "$init" 'mkbucket pdf-docs' "init creates pdf bucket"

# ---------------------------------------------------------------------------
echo "== 0.1.x value compatibility (minio.bucket / minio.persistence.size)"
out=$(render --set minio.bucket=legacy-bkt --set minio.persistence.size=50Gi --set storageClass=ceph-block) || { bad "render compat"; out=""; }
has "$(doc Secret "$REL-s3" <<<"$out")" 'bucket: "legacy-bkt"' "minio.bucket honoured"
sts=$(doc StatefulSet "$REL-rustfs" <<<"$out")
has "$sts" 'storage: 50Gi' "minio.persistence.size honoured"
has "$sts" 'storageClassName: "ceph-block"' "global storageClass honoured"
out=$(render --set minio.bucket=legacy-bkt --set rustfs.bucket=new-bkt --set rustfs.persistence.size=5Gi --set rustfs.persistence.storageClass=fast) || out=""
has "$(doc Secret "$REL-s3" <<<"$out")" 'bucket: "new-bkt"' "rustfs.bucket overrides"
sts=$(doc StatefulSet "$REL-rustfs" <<<"$out")
has "$sts" 'storage: 5Gi' "rustfs.persistence.size overrides"
has "$sts" 'storageClassName: "fast"' "rustfs.persistence.storageClass overrides"
out=$(render --set rustfs.existingSecret=my-s3) || out=""
[ -z "$(doc Secret "$REL-rustfs" <<<"$out")" ] && ok || bad "existingSecret skips generated secret"
has "$(doc Deployment "$REL-grown" <<<"$out")" 'name: my-s3, key: access_key' "app uses existingSecret"

# ---------------------------------------------------------------------------
echo "== external S3 (rustfs.enabled=false, 0.1.x minio.external.endpoint)"
out=$(render --set rustfs.enabled=false --set minio.external.endpoint=http://ext:9100) || { bad "render external"; out=""; }
[ -z "$(doc StatefulSet "$REL-rustfs" <<<"$out")" ] && ok || bad "no rustfs StatefulSet when disabled"
s3=$(doc Secret "$REL-s3" <<<"$out")
has "$s3" 'endpoint: "http://ext:9100"' "external endpoint"
has "$s3" 'access_key: "grown"' "external keys fall back to minio.accessKey"
has "$(doc Deployment "$REL-grown" <<<"$out")" "name: $REL-s3, key: access_key" "app creds from s3 secret"

# ---------------------------------------------------------------------------
echo "== migration: minio.enabled + migrateFromMinio.enabled"
out=$(render --set minio.enabled=true --set migrateFromMinio.enabled=true) || { bad "render migrate"; out=""; }
msts=$(doc StatefulSet "$REL-minio" <<<"$out")
has "$msts" 'image: "minio/minio:' "legacy MinIO StatefulSet rendered"
has "$msts" 'helm.sh/chart: grown-0\.1\.8' "legacy MinIO pod template frozen at 0.1.8"
has "$msts" 'volumeClaimTemplates' "legacy MinIO keeps its volumeClaimTemplate"
hasnt "$out" "name: $REL-minio-init" "no MinIO bucket-init job"
has "$(doc Secret "$REL-s3" <<<"$out")" "rustfs\\.$NS" "app still points at rustfs during migration"
job=$(doc Job "$REL-migrate-from-minio" <<<"$out")
[ -n "$job" ] && ok || bad "migration Job rendered"
hasnt "$job" 'helm.sh/hook' "migration Job is NOT a hook"
hasnt "$(sed -n '/^  template:/,$p' <<<"$job")" 'helm.sh/chart' "migration pod template has no chart-version label"
has "$job" 'value: "grown-default:grown-default pdf-docs:pdf-docs"' "bucket pairs app + pdf"
has "$job" "value: \"http://$REL-minio\\.$NS\\.svc\\.cluster\\.local:9000\"" "source = legacy MinIO svc"
has "$job" "value: \"http://$REL-rustfs\\.$NS\\.svc\\.cluster\\.local:9100\"" "dest = rustfs svc"
has "$job" "name: $REL-minio, key: MINIO_ROOT_USER" "source creds from MinIO secret"
has "$job" "name: $REL-rustfs, key: access_key" "dest creds from rustfs secret"
has "$job" 'restartPolicy: Never' "one-shot"
cm=$(doc ConfigMap "$REL-migrate-from-minio" <<<"$out")
has "$cm" 'RCLONE" copy "src:\$s" "dst:\$d" -M' "script streams with rclone copy"
has "$cm" 'check "src:\$s" "dst:\$d" --one-way' "script verifies with rclone check"

if helm template "$REL" "$CHART" --set migrateFromMinio.enabled=true >/dev/null 2>&1; then
  bad "migration without a source should fail to render"
else ok; fi
out=$(render --set migrateFromMinio.enabled=true --set migrateFromMinio.source.endpoint=http://old:9000 --set migrateFromMinio.source.existingSecret=old-creds) || out=""
job=$(doc Job "$REL-migrate-from-minio" <<<"$out")
has "$job" 'value: "http://old:9000"' "external MinIO source endpoint"
has "$job" 'name: old-creds, key: access_key' "external MinIO source creds"

# ---------------------------------------------------------------------------
echo "== pdf disabled"
out=$(render --set pdf.enabled=false --set minio.enabled=true --set migrateFromMinio.enabled=true) || { bad "render pdf off"; out=""; }
hasnt "$(doc Deployment "$REL-grown" <<<"$out")" 'PDF_STORAGE' "no pdf storage env"
hasnt "$(doc Job "$REL-rustfs-init" <<<"$out")" 'mkbucket pdf-docs' "no pdf bucket created"
has "$(doc Job "$REL-migrate-from-minio" <<<"$out")" 'value: "grown-default:grown-default"$' "only app bucket migrated"

echo
echo "passed: $pass  failed: $fails"
[ "$fails" -eq 0 ]
