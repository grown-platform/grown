#!/usr/bin/env bash
# Local CI for Pdf
# Usage: ci [OPTIONS]
#
# Options:
#   --no-fail-fast    Continue on failures to see all issues
#   --stage <stage>   Run only a specific stage (sast, test, build, container)
#   --verbose         Show detailed output
#   -h, --help        Show this help message

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
FAIL_FAST=true
VERBOSE=false
STAGE=""
FAILED_CHECKS=()
PASSED_CHECKS=()
declare -A TIMINGS

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
  --no-fail-fast)
    FAIL_FAST=false
    shift
    ;;
  --stage)
    STAGE="$2"
    shift 2
    ;;
  --verbose)
    VERBOSE=true
    shift
    ;;
  -h | --help)
    cat <<'EOF'
Usage: ci [OPTIONS]

Options:
  --no-fail-fast    Continue on failures to see all issues
  --stage <stage>   Run only a specific stage (sast, test, build, container)
  --verbose         Show detailed output
  -h, --help        Show this help message
EOF
    exit 0
    ;;
  *)
    echo -e "${RED}Unknown option: $1${NC}"
    exit 2
    ;;
  esac
done

# Get project root directory
if [[ -n ${PDF_ROOT:-} ]]; then
  ROOT_DIR="$PDF_ROOT"
elif [[ -f "$(dirname "${BASH_SOURCE[0]}")/../flake.nix" ]]; then
  ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
else
  ROOT_DIR="$(pwd)"
fi
cd "$ROOT_DIR"

# Timing functions
start_timer() {
  TIMINGS["$1_start"]=$(date +%s)
}

end_timer() {
  local end_time
  end_time=$(date +%s)
  local start_time="${TIMINGS[$1_start]:-$end_time}"
  TIMINGS["$1"]=$((end_time - start_time))
}

# Logging functions
log_header() {
  echo ""
  echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}${BLUE}  $1${NC}"
  echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_stage() {
  echo ""
  echo -e "${CYAN}▶ $1${NC}"
}

log_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

log_error() {
  echo -e "${RED}✗ $1${NC}"
}

log_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

log_info() {
  echo -e "${BLUE}ℹ $1${NC}"
}

# Run a check and handle failure
run_check() {
  local name="$1"
  shift
  local cmd="$*"

  log_stage "$name"
  start_timer "$name"

  if $VERBOSE; then
    if eval "$cmd"; then
      end_timer "$name"
      log_success "$name (${TIMINGS[$name]}s)"
      PASSED_CHECKS+=("$name")
      return 0
    else
      end_timer "$name"
      log_error "$name failed (${TIMINGS[$name]}s)"
      FAILED_CHECKS+=("$name")
      if $FAIL_FAST; then
        return 1
      fi
      return 0
    fi
  else
    local output
    if output=$(eval "$cmd" 2>&1); then
      end_timer "$name"
      log_success "$name (${TIMINGS[$name]}s)"
      PASSED_CHECKS+=("$name")
      return 0
    else
      end_timer "$name"
      log_error "$name failed (${TIMINGS[$name]}s)"
      echo "$output"
      FAILED_CHECKS+=("$name")
      if $FAIL_FAST; then
        return 1
      fi
      return 0
    fi
  fi
}

# Run multiple checks in parallel
run_parallel() {
  shift # First arg is stage name
  local checks=("$@")
  local pids=()
  local names=()
  local tmpdir
  tmpdir=$(mktemp -d)

  log_stage "Running ${#checks[@]} checks in parallel..."

  for check in "${checks[@]}"; do
    local name="${check%%:*}"
    local cmd="${check#*:}"
    names+=("$name")
    start_timer "$name"

    (
      if eval "$cmd" >"$tmpdir/$name.out" 2>&1; then
        echo "0" >"$tmpdir/$name.exit"
      else
        echo "1" >"$tmpdir/$name.exit"
      fi
    ) &
    pids+=($!)
  done

  local has_failure=false
  for i in "${!pids[@]}"; do
    local pid="${pids[$i]}"
    local name="${names[$i]}"

    wait "$pid" || true
    end_timer "$name"

    local exit_code
    exit_code=$(cat "$tmpdir/$name.exit")

    if [[ $exit_code == "0" ]]; then
      log_success "$name (${TIMINGS[$name]}s)"
      PASSED_CHECKS+=("$name")
    else
      log_error "$name failed (${TIMINGS[$name]}s)"
      if $VERBOSE || [[ $exit_code != "0" ]]; then
        cat "$tmpdir/$name.out"
      fi
      FAILED_CHECKS+=("$name")
      has_failure=true
    fi
  done

  rm -rf "$tmpdir"

  if $has_failure && $FAIL_FAST; then
    return 1
  fi
  return 0
}

# Stage: Static Analysis (SAST + Linting)
stage_sast() {
  log_header "Stage 1: Static Analysis (SAST + Linting)"

  local checks=(
    "treefmt:treefmt --ci"
    "golangci-lint:cd backend && golangci-lint run ./..."
    "eslint:cd frontend && npm run lint"
  )

  run_parallel "sast" "${checks[@]}"
}

# Stage: Unit Tests
stage_test() {
  log_header "Stage 2: Unit Tests"

  local checks=(
    "go-test:cd backend && go test ./... -v"
  )

  run_parallel "test" "${checks[@]}"
}

# Stage: Build Verification
stage_build() {
  log_header "Stage 3: Build Verification"

  run_check "nix-flake-check" "nix flake check"

  if [[ "$(uname)" == "Linux" ]]; then
    run_check "container-build" "nix build .#container --no-link"
  else
    log_warning "Container build skipped (Linux only)"
  fi
}

# Stage: Container Security Scanning
stage_container() {
  log_header "Stage 4: Container Security Scanning"

  if [[ "$(uname)" != "Linux" ]]; then
    log_warning "Container scanning skipped (Linux only)"
    return 0
  fi

  # Build and load container
  log_stage "Building and loading container..."
  nix run .#container.copyTo -- docker-daemon:pdf-ci:latest

  local checks=(
    "trivy:trivy image --severity HIGH,CRITICAL --exit-code 1 pdf-ci:latest"
    "grype:grype pdf-ci:latest --fail-on high"
  )

  run_parallel "container-scan" "${checks[@]}"

  # Cleanup
  docker rmi pdf-ci:latest 2>/dev/null || true
}

# Print summary
print_summary() {
  log_header "CI Summary"

  local total_time=0
  for key in "${!TIMINGS[@]}"; do
    if [[ $key != *"_start" ]]; then
      total_time=$((total_time + TIMINGS[$key]))
    fi
  done

  echo ""
  if [[ ${#PASSED_CHECKS[@]} -gt 0 ]]; then
    echo -e "${GREEN}Passed (${#PASSED_CHECKS[@]}):${NC}"
    for check in "${PASSED_CHECKS[@]}"; do
      echo -e "  ${GREEN}✓${NC} $check"
    done
  fi

  if [[ ${#FAILED_CHECKS[@]} -gt 0 ]]; then
    echo ""
    echo -e "${RED}Failed (${#FAILED_CHECKS[@]}):${NC}"
    for check in "${FAILED_CHECKS[@]}"; do
      echo -e "  ${RED}✗${NC} $check"
    done
  fi

  echo ""
  echo -e "${BOLD}Total time: ${total_time}s${NC}"
  echo ""

  if [[ ${#FAILED_CHECKS[@]} -gt 0 ]]; then
    echo -e "${RED}${BOLD}CI FAILED${NC}"
    return 1
  else
    echo -e "${GREEN}${BOLD}CI PASSED${NC}"
    return 0
  fi
}

# Main execution
main() {
  local start_time
  start_time=$(date +%s)

  log_header "Pdf Local CI"
  echo ""
  log_info "Mode: $(if $FAIL_FAST; then echo 'fail-fast'; else echo 'run-all'; fi)"

  # Run specific stage or all stages
  if [[ -n $STAGE ]]; then
    case "$STAGE" in
    sast)
      stage_sast
      ;;
    test)
      stage_test
      ;;
    build)
      stage_build
      ;;
    container)
      stage_container
      ;;
    *)
      log_error "Unknown stage: $STAGE"
      log_info "Valid stages: sast, test, build, container"
      exit 2
      ;;
    esac
  else
    # Run all stages
    stage_sast || true
    stage_test || true
    stage_build || true
    stage_container || true
  fi

  print_summary
}

main "$@"
