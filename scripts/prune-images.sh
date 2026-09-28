#!/bin/sh
# Prune old grown container images from the Forgejo registry so it can't fill
# the Forgejo volume (it did on 2026-09-28: 360 versions, 19 GiB).
#
# Keeps:
#   - `latest` and every release tag (v*)
#   - the newest $KEEP_NEWEST date tags (YYYYMMDD-HHMMSS-<sha>, what Flux deploys)
#   - every date tag from the last $KEEP_DAYS days
#   - the newest date tag of each calendar month (long-range rollback points)
# Deletes everything else: older date tags, old short-sha tags, and untagged
# sha256:... manifests left behind whenever :latest moves. Forgejo's
# cleanup_packages cron then frees the unreferenced blobs.
#
# Env: FORGEJO_URL, OWNER, PACKAGE, TOKEN (write:package), DRY_RUN=1 to list only.
set -eu
FORGEJO_URL=${FORGEJO_URL:-https://code.pick.haus}
OWNER=${OWNER:-grown}
PACKAGE=${PACKAGE:-grown}
KEEP_NEWEST=${KEEP_NEWEST:-60}
KEEP_DAYS=${KEEP_DAYS:-30}
DRY_RUN=${DRY_RUN:-0}
api="$FORGEJO_URL/api/v1/packages/$OWNER"
auth=""
[ -n "${TOKEN:-}" ] && auth="Authorization: token $TOKEN"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
page=1
while :; do
  curl -fsS ${auth:+-H "$auth"} "$api?type=container&limit=50&page=$page" > "$tmp/p$page.json"
  [ "$(jq length "$tmp/p$page.json")" -eq 0 ] && break
  page=$((page + 1))
done
jq -r --arg n "$PACKAGE" -s 'add | .[] | select(.name == $n) | .version' "$tmp"/p*.json | sort -u > "$tmp/all"

grep -E '^[0-9]{8}-[0-9]{6}-' "$tmp/all" | sort -r > "$tmp/dated" || true
cutoff=$(date -u -d "@$(( $(date -u +%s) - KEEP_DAYS * 86400 ))" +%Y%m%d 2>/dev/null \
  || date -u -v-"${KEEP_DAYS}"d +%Y%m%d)
{
  grep -E '^(latest|v.*)$' "$tmp/all" || true
  head -n "$KEEP_NEWEST" "$tmp/dated"
  awk -v c="$cutoff" 'substr($0,1,8) >= c' "$tmp/dated"
  awk '{m=substr($0,1,6)} !(m in seen) {seen[m]=1; print}' "$tmp/dated"
} | sort -u > "$tmp/keep"
grep -vxF -f "$tmp/keep" "$tmp/all" > "$tmp/delete" || true

echo "versions: $(wc -l < "$tmp/all")  keep: $(wc -l < "$tmp/keep")  delete: $(wc -l < "$tmp/delete")"
[ "$DRY_RUN" = 1 ] && { sed 's/^/would delete /' "$tmp/delete"; exit 0; }
[ -n "${TOKEN:-}" ] || { echo "TOKEN is required to delete" >&2; exit 1; }
fail=0
while read -r v; do
  # sha256:... versions contain a colon; URL-encode it.
  enc=$(printf %s "$v" | sed 's/:/%3A/g')
  if curl -fsS -X DELETE -H "$auth" "$api/container/$PACKAGE/$enc" >/dev/null; then
    echo "deleted $v"
  else
    echo "FAILED  $v" >&2; fail=$((fail + 1))
  fi
done < "$tmp/delete"
[ "$fail" -eq 0 ] || { echo "$fail deletions failed" >&2; exit 1; }
