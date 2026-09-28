#!/usr/bin/env bash
# Render-invariant tests for the grown chart (object storage: rustfs + the
# legacy-MinIO migration path; the Home Assistant component, its onboarding
# sidecar and integration fetch). Needs `helm` (+ bash/awk/grep); python3, when
# present, also exercises the shipped HA scripts.
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

# cmkey KEY < configmap-doc : print a literal-block (|) data key, de-indented.
cmkey() {
  awk -v key="$1" '
    $0 ~ "^  " key ": [|]" { on = 1; next }
    on && /^  [^ ]/ { on = 0 }
    on && /^[^ ]/ { on = 0 }
    on { sub(/^    /, ""); print }'
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

# ---------------------------------------------------------------------------
echo "== homeAssistant: on by default (0.4.0), switchable off"
out=$(render) || { bad "render defaults"; out=""; }
sts=$(doc StatefulSet "$REL-homeassistant" <<<"$out")
[ -n "$sts" ] && ok || bad "HA StatefulSet rendered by default"
has "$(doc Deployment "$REL-grown" <<<"$out")" 'GROWN_HOMEASSISTANT_URL' "HA tile default set by default"
hasnt "$out" "kind: (Ingress|HTTPRoute)" "default ingress.type=none renders no routes"
out=$(render --set homeAssistant.enabled=false) || { bad "render ha off"; out=""; }
hasnt "$out" 'homeassistant' "homeAssistant.enabled=false: no HA resources"
hasnt "$(doc Deployment "$REL-grown" <<<"$out")" 'GROWN_HOMEASSISTANT_URL' "no HA tile default when disabled"
out=$(render --set homeAssistant.enabled=false --set ingress.type=ingress) || out=""
hasnt "$out" "name: $REL-homeassistant" "no HA ingress when disabled"

echo "== homeAssistant: enabled (ingress)"
out=$(render --set ingress.type=ingress --set ingress.className=nginx \
  --set ingress.tls.enabled=true --set scheme=https --set domain=grown.example.com) || { bad "render ha"; out=""; }
sts=$(doc StatefulSet "$REL-homeassistant" <<<"$out")
has "$sts" 'image: "ghcr\.io/home-assistant/home-assistant:[0-9]{4}\.[0-9]+\.[0-9]+"' "pinned HA stable tag"
hasnt "$sts" 'home-assistant:(latest|stable|dev|beta)' "no floating HA tag"
has "$sts" 'replicas: 1' "single replica"
has "$sts" 'hostNetwork: false' "host network off"
has "$sts" 'allowPrivilegeEscalation: false' "no privilege escalation"
has "$sts" '- ALL' "drops all capabilities"
has "$sts" 'type: RuntimeDefault' "RuntimeDefault seccomp"
has "$sts" 'mountPath: /config' "config volume at /config"
has "$sts" 'containerPort: 8123' "HA port"
has "$sts" 'memory: 1536Mi' "memory limit from values"
has "$sts" 'memory: 384Mi' "small-cluster memory request"
has "$sts" 'volumeClaimTemplates' "PVC for /config"
has "$sts" 'storage: 5Gi' "default HA PVC size"
has "$sts" 'name: seed-config' "seed initContainer"
has "$sts" 'command: \["/bin/sh", "/seed/seed.sh"\]' "initContainer runs the seed script"
svc=$(doc Service "$REL-homeassistant" <<<"$out")
has "$svc" 'port: 8123' "Service on 8123"
has "$svc" 'app.kubernetes.io/component: homeassistant' "Service selects HA"
ing=$(doc Ingress "$REL-homeassistant" <<<"$out")
has "$ing" 'host: "ha\.grown\.example\.com"' "HA host defaults to ha.<domain>"
has "$ing" 'ingressClassName: nginx' "HA ingress uses ingress.className"
has "$ing" 'secretName: grown-tls' "HA TLS falls back to ingress.tls.secretName"
has "$ing" "name: $REL-homeassistant" "ingress backend = HA svc"
app=$(doc Deployment "$REL-grown" <<<"$out")
has "$app" 'name: GROWN_HOMEASSISTANT_URL' "grown gets the HA tile default"
has "$app" 'value: "https://ha\.grown\.example\.com"' "tile default = <scheme>://<ha host>"
cm=$(doc ConfigMap "$REL-homeassistant-seed" <<<"$out")
conf=$(cmkey configuration.yaml <<<"$cm")
has "$conf" '^default_config:' "seed has default_config"
has "$conf" 'use_x_forwarded_for: true' "seed trusts X-Forwarded-For"
has "$conf" '- "10\.0\.0\.0/8"' "seed has default trusted proxies"
has "$conf" 'automation: !include automations.yaml' "seed wires UI automations"
has "$conf" 'use_x_frame_options: false' "seed lets Grown frame HA (iframe)"

echo "== homeAssistant: seed script never clobbers existing config"
seed=$(cmkey seed.sh <<<"$cm")
tmp=$(mktemp -d)
mkdir -p "$tmp/seed" "$tmp/config"
for f in configuration.yaml automations.yaml scripts.yaml scenes.yaml; do cmkey "$f" <<<"$cm" >"$tmp/seed/$f"; done
printf '%s\n' "$seed" >"$tmp/seed/seed.sh"
CONFIG_DIR="$tmp/config" SEED_DIR="$tmp/seed" sh "$tmp/seed/seed.sh" >/dev/null && ok || bad "seed script runs"
cmp -s "$tmp/seed/configuration.yaml" "$tmp/config/configuration.yaml" && ok || bad "first run seeds configuration.yaml"
[ -f "$tmp/config/automations.yaml" ] && ok || bad "first run seeds automations.yaml"
echo "homeassistant: {name: Mine}" >"$tmp/config/configuration.yaml"
echo "- id: mine" >"$tmp/config/automations.yaml"
CONFIG_DIR="$tmp/config" SEED_DIR="$tmp/seed" sh "$tmp/seed/seed.sh" >/dev/null && ok || bad "seed script re-runs"
[ "$(cat "$tmp/config/configuration.yaml")" = "homeassistant: {name: Mine}" ] && ok || bad "existing configuration.yaml untouched"
[ "$(cat "$tmp/config/automations.yaml")" = "- id: mine" ] && ok || bad "existing automations.yaml untouched"
rm -rf "$tmp"

echo "== homeAssistant: overrides + httproute + no ingress"
out=$(render --set ingress.type=httproute --set homeAssistant.host=home.example.net \
  --set homeAssistant.url=https://home.example.net/lovelace/0 --set 'homeAssistant.trustedProxies={10.42.0.0/16}' \
  --set homeAssistant.persistence.size=20Gi --set homeAssistant.persistence.storageClass=fast) || { bad "render ha overrides"; out=""; }
rt=$(doc HTTPRoute "$REL-homeassistant" <<<"$out")
has "$rt" '- "home\.example\.net"' "HTTPRoute uses homeAssistant.host"
has "$rt" 'name: public-gateway' "HTTPRoute parent = ingress.httproute gateway"
has "$(doc Deployment "$REL-grown" <<<"$out")" 'value: "https://home\.example\.net/lovelace/0"' "homeAssistant.url overrides tile default"
conf=$(cmkey configuration.yaml <<<"$(doc ConfigMap "$REL-homeassistant-seed" <<<"$out")")
has "$conf" '- "10\.42\.0\.0/16"' "trustedProxies configurable"
hasnt "$conf" '10\.0\.0\.0/8' "trustedProxies replaced, not merged"
sts=$(doc StatefulSet "$REL-homeassistant" <<<"$out")
has "$sts" 'storage: 20Gi' "HA PVC size configurable"
has "$sts" 'storageClassName: "fast"' "HA storageClass configurable"
out=$(render --set homeAssistant.persistence.existingClaim=ha-config --set homeAssistant.setGrownDefault=false) || out=""
sts=$(doc StatefulSet "$REL-homeassistant" <<<"$out")
has "$sts" 'claimName: ha-config' "existingClaim mounted"
hasnt "$sts" 'volumeClaimTemplates' "no PVC template with existingClaim"
hasnt "$out" "kind: (Ingress|HTTPRoute)" "ingress.type=none renders no HA route"
hasnt "$(doc Deployment "$REL-grown" <<<"$out")" 'GROWN_HOMEASSISTANT_URL' "setGrownDefault=false skips tile default"

# ---------------------------------------------------------------------------
echo "== homeAssistant: onboarding closes the first-run window"
out=$(render) || { bad "render defaults"; out=""; }
osec=$(doc Secret "$REL-homeassistant-owner" <<<"$out")
has "$osec" 'username: "YWRtaW4="' "owner username defaults to admin"
has "$osec" 'password: "[A-Za-z0-9+/=]{40,}"' "generated 32-char owner password"
has "$osec" 'helm.sh/resource-policy": keep' "owner secret kept on uninstall (PVC is too)"
sts=$(doc StatefulSet "$REL-homeassistant" <<<"$out")
has "$sts" 'command: \["python3", "-B", "/seed/onboard.py", "--check"\]' "HA readiness gated on onboarding"
has "$sts" 'name: onboard$' "onboarding sidecar"
has "$sts" 'command: \["python3", "-u", "/seed/onboard.py"\]' "sidecar runs the onboarding loop"
has "$sts" 'value: "http://127.0.0.1:8123"' "sidecar talks to HA over localhost"
has "$sts" "secretKeyRef: \\{ name: $REL-homeassistant-owner, key: password \\}" "sidecar password from owner secret"
has "$sts" 'runAsUser: 65534' "sidecar runs as nobody"
has "$sts" 'readOnlyRootFilesystem: true' "sidecar read-only rootfs"
has "$sts" 'checksum/seed: [0-9a-f]{64}' "pod rolls when scripts change"
side=$(sed -n '/- name: onboard$/,/limits:/p' <<<"$sts")
hasnt "$side" 'mountPath: /config' "sidecar has no access to /config"
out=$(render --set homeAssistant.owner.existingSecret=my-ha-owner) || out=""
[ -z "$(doc Secret "$REL-homeassistant-owner" <<<"$out")" ] && ok || bad "existingSecret skips the generated owner secret"
has "$(doc StatefulSet "$REL-homeassistant" <<<"$out")" 'secretKeyRef: \{ name: my-ha-owner, key: username \}' "existingSecret used by sidecar"
out=$(render --set homeAssistant.onboarding.enabled=false) || out=""
sts=$(doc StatefulSet "$REL-homeassistant" <<<"$out")
hasnt "$sts" 'name: onboard$' "onboarding.enabled=false: no sidecar"
hasnt "$sts" 'onboard.py' "onboarding.enabled=false: plain tcp readiness"
[ -z "$(doc Secret "$REL-homeassistant-owner" <<<"$out")" ] && ok || bad "onboarding off: no owner secret"

echo "== homeAssistant: grown integration fetched from grown on every start"
out=$(render) || out=""
sts=$(doc StatefulSet "$REL-homeassistant" <<<"$out")
has "$sts" 'name: grown-integration' "fetch initContainer"
has "$sts" "value: \"http://$REL-grown\\.$NS\\.svc\\.cluster\\.local:8080/integrations/homeassistant/grown\\.zip\"" "zip URL = grown Service"
has "$sts" 'name: FETCH_TIMEOUT_SECONDS' "bounded wait for grown"
[ "$(grep -n 'name: seed-config' <<<"$sts" | cut -d: -f1)" -lt "$(grep -n 'name: grown-integration' <<<"$sts" | cut -d: -f1)" ] && ok || bad "seed runs before the fetch"
out=$(render --set homeAssistant.grownIntegration.url=http://g.example/grown.zip --set homeAssistant.grownIntegration.fetchTimeoutSeconds=30) || out=""
sts=$(doc StatefulSet "$REL-homeassistant" <<<"$out")
has "$sts" 'value: "http://g\.example/grown\.zip"' "grownIntegration.url override"
has "$sts" 'value: "30"' "fetchTimeoutSeconds override"
out=$(render --set homeAssistant.grownIntegration.enabled=false) || out=""
hasnt "$(doc StatefulSet "$REL-homeassistant" <<<"$out")" 'grown-integration' "grownIntegration.enabled=false: no fetch"
out=$(render --set homeAssistant.http.useXFrameOptions=true) || out=""
hasnt "$(cmkey configuration.yaml <<<"$(doc ConfigMap "$REL-homeassistant-seed" <<<"$out")")" 'use_x_frame_options' "useXFrameOptions=true keeps HA's framing protection"

echo "== homeAssistant: renders for every ingress.type"
for t in none ingress httproute; do
  out=$(render --set ingress.type=$t --set domain=grown.example.com) || { bad "render ingress.type=$t"; continue; }
  [ -n "$(doc StatefulSet "$REL-homeassistant" <<<"$out")" ] && ok || bad "HA StatefulSet with ingress.type=$t"
  case $t in
    none) hasnt "$out" "kind: (Ingress|HTTPRoute)" "type none: no route" ;;
    ingress) [ -n "$(doc Ingress "$REL-homeassistant" <<<"$out")" ] && ok || bad "type ingress: HA Ingress" ;;
    httproute) [ -n "$(doc HTTPRoute "$REL-homeassistant" <<<"$out")" ] && ok || bad "type httproute: HA HTTPRoute" ;;
  esac
done

echo "== homeAssistant: shipped scripts"
cm=$(doc ConfigMap "$REL-homeassistant-seed" <<<"$(render)")
for f in onboard.py fetch_integration.py; do
  diff -B <(cmkey "$f" <<<"$cm") "$CHART/files/homeassistant/$f" >/dev/null && ok || bad "$f embedded verbatim in the seed ConfigMap"
done
if command -v python3 >/dev/null; then
  tmp=$(mktemp -d)
  for f in onboard.py fetch_integration.py; do
    python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "$CHART/files/homeassistant/$f" && ok || bad "$f parses"
  done
  # Readiness must fail closed when HA is not answering.
  HA_URL=http://127.0.0.1:9 python3 -B "$CHART/files/homeassistant/onboard.py" --check 2>/dev/null && bad "--check passes with HA down" || ok
  # fetch: unreachable grown -> gives up within the timeout and exits 0.
  start=$SECONDS
  GROWN_ZIP_URL=http://127.0.0.1:9/grown.zip CONFIG_DIR="$tmp/cfg" FETCH_TIMEOUT_SECONDS=3 \
    python3 -B "$CHART/files/homeassistant/fetch_integration.py" >/dev/null && ok || bad "fetch exits 0 when grown is down"
  [ $((SECONDS - start)) -le 10 ] && ok || bad "fetch honours FETCH_TIMEOUT_SECONDS"
  # fetch: installs a bundle, replacing (not merging) the old copy.
  src="$CHART/../../../integrations/homeassistant"
  if [ -d "$src/custom_components/grown" ]; then
    (cd "$src" && python3 -c 'import sys,zipfile,os
z=zipfile.ZipFile(sys.argv[1],"w")
for d,_,fs in os.walk("custom_components/grown"):
    for f in fs:
        if "__pycache__" not in d: z.write(os.path.join(d,f))
z.close()' "$tmp/grown.zip")
    mkdir -p "$tmp/cfg/custom_components/grown" && touch "$tmp/cfg/custom_components/grown/stale.py"
    (cd "$tmp" && exec python3 -m http.server 18765 --bind 127.0.0.1 >/dev/null 2>&1) & srv=$!
    sleep 1
    GROWN_ZIP_URL=http://127.0.0.1:18765/grown.zip CONFIG_DIR="$tmp/cfg" FETCH_TIMEOUT_SECONDS=10 \
      python3 -B "$CHART/files/homeassistant/fetch_integration.py" >/dev/null && ok || bad "fetch installs the bundle"
    kill $srv 2>/dev/null
    [ -f "$tmp/cfg/custom_components/grown/manifest.json" ] && ok || bad "manifest.json installed"
    [ ! -e "$tmp/cfg/custom_components/grown/stale.py" ] && ok || bad "old integration files replaced"
  fi
  rm -rf "$tmp"
else
  echo "  (python3 not found: skipping script behaviour checks)"
fi

echo "== NOTES: HA owner password + integration hints"
tmpc=$(mktemp -d)
cp -R "$CHART" "$tmpc/grown"
printf 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: notes-preview\ndata:\n  notes: |\n{{ include (print $.Template.BasePath "/NOTES.txt") . | indent 4 }}\n' >"$tmpc/grown/templates/notes-preview.yaml"
notes=$(helm template "$REL" "$tmpc/grown" -n "$NS" --show-only templates/notes-preview.yaml) || bad "render NOTES"
has "$notes" "get secret $REL-homeassistant-owner -o jsonpath='\\{.data.password\\}' \\| base64 -d" "NOTES: how to read the owner password"
has "$notes" 'Add integration' "NOTES: how to add the Grown integration"
notes=$(helm template "$REL" "$tmpc/grown" -n "$NS" --show-only templates/notes-preview.yaml --set homeAssistant.enabled=false) || notes=""
hasnt "$notes" 'homeassistant-owner' "NOTES: no HA section when disabled"
rm -rf "$tmpc"

echo
echo "passed: $pass  failed: $fails"
[ "$fails" -eq 0 ]
