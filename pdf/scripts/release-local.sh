#!/usr/bin/env bash
# Local release script for Pdf
# Usage: release-local <command> [args]
#
# Commands:
#   build             Build container locally
#   dev               Build and push with timestamp+commit tag
#   tag <version>     Build and push with specific version tag

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Get project root
if [[ -n ${PDF_ROOT:-} ]]; then
  ROOT_DIR="$PDF_ROOT"
else
  ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
cd "$ROOT_DIR"

log_info() { echo -e "${BLUE}ℹ $1${NC}"; }
log_success() { echo -e "${GREEN}✓ $1${NC}"; }
log_error() { echo -e "${RED}✗ $1${NC}"; }

show_help() {
  cat <<'EOF'
Usage: release-local <command> [args]

Commands:
  build             Build container locally (no push)
  dev               Build and push with timestamp+commit tag
  tag <version>     Build and push with specific version tag

Examples:
  release-local build          # Just build locally
  release-local dev            # Push with auto-generated dev tag
  release-local tag 1.0.0      # Push with version 1.0.0
EOF
}

cmd_build() {
  log_info "Building container..."
  nix build .#container --no-link
  log_success "Container built successfully"

  # Show image info
  local image_name
  image_name=$(nix eval --raw .#container.imageName)
  local image_tag
  image_tag=$(nix eval --raw .#container.imageTag)
  log_info "Image: ${image_name}:${image_tag}"
}

cmd_dev() {
  # Generate timestamp+commit version
  local timestamp
  timestamp=$(date -u +"%Y%m%d-%H%M%S")
  local commit
  commit=$(git rev-parse --short HEAD)
  local version="${timestamp}-${commit}"

  log_info "Building with version: $version"
  echo "$version" > version.txt

  # Build and push
  log_info "Building container..."
  nix build .#container --no-link

  log_info "Pushing to registry..."
  nix run .#container.copyToRegistry

  log_success "Pushed image with tag: $version"

  # Reset version.txt
  git checkout version.txt 2>/dev/null || true
}

cmd_tag() {
  local version="$1"

  if [[ -z "$version" ]]; then
    log_error "Version required for tag command"
    show_help
    exit 1
  fi

  log_info "Building with version: $version"
  echo "$version" > version.txt

  # Build and push
  log_info "Building container..."
  nix build .#container --no-link

  log_info "Pushing to registry..."
  nix run .#container.copyToRegistry

  log_success "Pushed image with tag: $version"

  # Optionally create git tag
  read -rp "Create git tag $version? [y/N] " create_tag
  if [[ "$create_tag" =~ ^[Yy]$ ]]; then
    git tag -a "$version" -m "Release $version"
    git push origin "$version"
    log_success "Created and pushed git tag: $version"
  fi
}

# Main
case "${1:-}" in
  build)
    cmd_build
    ;;
  dev)
    cmd_dev
    ;;
  tag)
    cmd_tag "${2:-}"
    ;;
  -h|--help|"")
    show_help
    ;;
  *)
    log_error "Unknown command: $1"
    show_help
    exit 1
    ;;
esac
