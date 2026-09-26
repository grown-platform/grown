#!/usr/bin/env bash
# Local dev stack without Nix: Postgres + Zitadel + rustfs in Docker, the Go
# backend and the vite build native. Serves http://workspace.localtest.me:8080
# (login admin / DevPassword!1), the same target web/e2e expects.
#
#   deploy/local/stack.sh up [TREE]      start deps, build TREE, run backend
#   deploy/local/stack.sh deploy [TREE]  rebuild web + backend from TREE, restart
#   deploy/local/stack.sh backend [TREE] restart backend only (skip web build)
#   deploy/local/stack.sh status | logs | down | nuke
#
# TREE defaults to this checkout, so any git worktree can be deployed onto the
# one shared stack. State lives in $GROWN_LOCAL_DATA (default ~/.grown-local)
# so it survives across worktrees; `nuke` deletes it.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export GROWN_LOCAL_DATA="${GROWN_LOCAL_DATA:-$HOME/.grown-local}"
DATA="$GROWN_LOCAL_DATA"
COMPOSE=(docker compose -f "$HERE/compose.yaml")
URL="http://workspace.localtest.me:8080"

log() { printf '\033[1;32m[stack]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[stack]\033[0m %s\n' "$*" >&2; exit 1; }

tree_root() {
  local t="${1:-$HERE/../..}"
  t="$(cd "$t" && git rev-parse --show-toplevel)" || die "not a git tree: ${1:-}"
  [ -e "$t/gen/go" ] || die "$t has no gen/ (run 'nix run .#gen' or symlink the main checkout's gen/)"
  echo "$t"
}

wait_http() { # url name tries
  for _ in $(seq 1 "${3:-90}"); do
    curl -sf -o /dev/null "$1" && return 0
    sleep 2
  done
  die "$2 not ready at $1"
}

deps_up() {
  mkdir -p "$DATA"/{postgres,rustfs,bin} "$DATA/root/deploy/zitadel/data"
  log "starting postgres, zitadel, rustfs"
  "${COMPOSE[@]}" up -d
  wait_http http://127.0.0.1:8081/debug/ready zitadel
  wait_http http://127.0.0.1:9100/health rustfs 60
  local t="$1"
  if [ ! -s "$DATA/root/deploy/zitadel/data/oidc-client.env" ]; then
    log "provisioning OIDC app + admin user"
    # /debug/ready flips before first-boot setup finishes, so the first call
    # can fail on a fresh instance; the script is idempotent, so retry.
    for i in 1 2 3 4 5; do
      PROJECT_ROOT="$DATA/root" ZITADEL_URL=http://localhost:8081 \
        GROWN_OIDC_REDIRECT_URL="$URL/api/v1/auth/callback" \
        bash "$t/deploy/zitadel/create-oidc-app.sh" && break
      [ "$i" = 5 ] && die "OIDC provisioning failed"
      log "provisioning attempt $i failed; retrying"; sleep 5
    done
  fi
  RUSTFS_ENDPOINT=http://127.0.0.1:9100 RUSTFS_BUCKET=grown-default \
    bash "$t/deploy/rustfs/init-bucket.sh"
}

build_web() {
  log "building web from $1"
  (cd "$1/web/app" && npm run -s build >"$DATA/web-build.log" 2>&1) ||
    { tail -30 "$DATA/web-build.log"; die "web build failed"; }
}

stop_backend() {
  if [ -s "$DATA/backend.pid" ] && kill -0 "$(cat "$DATA/backend.pid")" 2>/dev/null; then
    kill "$(cat "$DATA/backend.pid")"
    for _ in $(seq 1 20); do kill -0 "$(cat "$DATA/backend.pid")" 2>/dev/null || break; sleep 0.5; done
  fi
  rm -f "$DATA/backend.pid"
}

start_backend() {
  local t="$1"
  log "building backend from $t"
  (cd "$t" && go build -o "$DATA/bin/grown" ./cmd/server) || die "go build failed"
  stop_backend
  local creds="$DATA/root/deploy/zitadel/data/oidc-client.env"
  (
    [ -s "$creds" ] && { set -a; . "$creds"; set +a; }
    export GROWN_POSTGRES_DSN="postgres://grown@127.0.0.1:5533/grown?sslmode=disable"
    export GROWN_OIDC_ISSUER=http://localhost:8081
    export GROWN_OIDC_REDIRECT_URL="$URL/api/v1/auth/callback"
    export GROWN_SESSION_COOKIE_NAME=grown_session GROWN_SESSION_COOKIE_SECURE=false
    export GROWN_SESSION_COOKIE_DOMAIN=workspace.localtest.me GROWN_SESSION_LIFETIME=168h
    export GROWN_DEFAULT_ORG_SLUG=default
    export GROWN_RUSTFS_ENDPOINT=http://127.0.0.1:9100 GROWN_RUSTFS_ACCESS_KEY=grown
    export GROWN_RUSTFS_SECRET_KEY='DevPassword!1' GROWN_RUSTFS_BUCKET=grown-default
    export GROWN_ZITADEL_API_URL=http://localhost:8081
    cd "$t"
    nohup "$DATA/bin/grown" --http-addr=:8080 --grpc-addr=:9000 \
      --static-dir="$t/web/app/dist" >"$DATA/backend.log" 2>&1 &
    echo $! >"$DATA/backend.pid"
  )
  wait_http "http://127.0.0.1:8080/healthz" backend 30 ||
    { tail -30 "$DATA/backend.log"; exit 1; }
  echo "$t" >"$DATA/deployed-tree"
  log "backend up: $URL  (tree: $t @ $(git -C "$t" rev-parse --short HEAD))"
}

cmd="${1:-status}"; shift || true
case "$cmd" in
  up)      t="$(tree_root "${1:-}")"; deps_up "$t"; build_web "$t"; start_backend "$t" ;;
  deploy)  t="$(tree_root "${1:-}")"; build_web "$t"; start_backend "$t" ;;
  backend) t="$(tree_root "${1:-}")"; start_backend "$t" ;;
  status)
    "${COMPOSE[@]}" ps --format '{{.Service}}: {{.State}}'
    if curl -sf -o /dev/null http://127.0.0.1:8080/healthz; then
      echo "backend: up ($(cat "$DATA/deployed-tree" 2>/dev/null))"
    else echo "backend: down"; fi ;;
  logs)    tail -n "${1:-100}" -f "$DATA/backend.log" ;;
  down)    stop_backend; "${COMPOSE[@]}" down ;;
  nuke)    stop_backend; "${COMPOSE[@]}" down -v; rm -rf "$DATA" ;;
  *)       die "unknown command: $cmd (up|deploy|backend|status|logs|down|nuke)" ;;
esac
