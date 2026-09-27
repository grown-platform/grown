#!/bin/sh
# One-shot MinIO -> rustfs object copy (grown chart, migrateFromMinio).
#
# Remotes come from the environment (RCLONE_CONFIG_SRC_* / RCLONE_CONFIG_DST_*),
# so no config file is written. BUCKET_PAIRS is a space-separated list of
# "srcbucket:dstbucket". Objects are streamed by rclone (no local staging).
# Exit status: 0 only if every source bucket verifies in the destination.
set -u

WAIT_TIMEOUT="${WAIT_TIMEOUT:-600}"
RCLONE="${RCLONE:-rclone}"
: "${BUCKET_PAIRS:?BUCKET_PAIRS is required}"

log() { echo "[migrate $(date -u +%H:%M:%S)] $*"; }

# wait_remote NAME: until the remote answers an authenticated bucket listing
# (each probe fails fast; the deadline is wall-clock).
wait_remote() {
  deadline=$(( $(date +%s) + WAIT_TIMEOUT ))
  until "$RCLONE" lsf "$1:" --dirs-only --retries 1 --low-level-retries 1 \
      --contimeout 5s --timeout 15s >/dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      log "ERROR: $1 endpoint not reachable/authorised after ${WAIT_TIMEOUT}s:"
      "$RCLONE" lsf "$1:" --dirs-only --retries 1 --low-level-retries 1 \
        --contimeout 5s --timeout 15s 2>&1 | tail -3
      return 1
    fi
    sleep 5
  done
  log "$1 endpoint ready"
}

# bucket_exists REMOTE BUCKET
bucket_exists() { "$RCLONE" lsf "$1:" --dirs-only 2>/dev/null | grep -qx "$2/"; }

# size REMOTE BUCKET -> prints "COUNT BYTES" ("0 0" when the bucket is absent)
size() {
  if ! bucket_exists "$1" "$2"; then echo "0 0"; return 0; fi
  out=$("$RCLONE" size "$1:$2" --json) || return 1
  c=$(echo "$out" | sed -n 's/.*"count":\([0-9]*\).*/\1/p')
  b=$(echo "$out" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
  [ -n "$c" ] && [ -n "$b" ] || return 1
  echo "$c $b"
}

wait_remote src || exit 1
wait_remote dst || exit 1

failed=0
for pair in $BUCKET_PAIRS; do
  s="${pair%%:*}"; d="${pair#*:}"
  [ -n "$d" ] || d="$s"
  if ! bucket_exists src "$s"; then
    log "source bucket '$s' does not exist on MinIO: nothing to copy, skipping"
    continue
  fi
  r=$(size src "$s") || { log "ERROR: cannot size src:$s"; failed=1; continue; }; set -- $r
  sc=$1; sb=$2
  r=$(size dst "$d") || { log "ERROR: cannot size dst:$d"; failed=1; continue; }; set -- $r
  log "$s -> $d: BEFORE source=$sc objects/$sb bytes, destination=$1 objects/$2 bytes"

  if ! "$RCLONE" copy "src:$s" "dst:$d" -M \
      --retries 5 --low-level-retries 10 \
      --stats 30s --stats-one-line --stats-log-level NOTICE; then
    log "ERROR: rclone copy $s -> $d failed"; failed=1; continue
  fi

  r=$(size src "$s") || { log "ERROR: cannot size src:$s"; failed=1; continue; }; set -- $r
  sc=$1; sb=$2
  r=$(size dst "$d") || { log "ERROR: cannot size dst:$d"; failed=1; continue; }; set -- $r
  dc=$1; db=$2
  log "$s -> $d: AFTER  source=$sc objects/$sb bytes, destination=$dc objects/$db bytes"

  # The destination may legitimately hold MORE (grown already writes to rustfs
  # during the migration), never less.
  if [ "$dc" -lt "$sc" ] || [ "$db" -lt "$sb" ]; then
    log "ERROR: $d has fewer objects/bytes than $s"; failed=1; continue
  fi
  # Every source object must exist in the destination with the same size (and
  # MD5 where both sides expose one).
  if ! "$RCLONE" check "src:$s" "dst:$d" --one-way; then
    log "ERROR: rclone check $s -> $d reported differences"; failed=1; continue
  fi
  log "$s -> $d: verified OK"
done

if [ "$failed" -ne 0 ]; then
  log "MIGRATION FAILED (see errors above). Safe to re-run: delete the Job and reconcile."
  exit 1
fi
log "MIGRATION COMPLETE: all buckets verified"
