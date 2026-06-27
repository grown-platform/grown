#!/usr/bin/env bash
# ci/check-updates.sh — REPORT-ONLY dependency-update checker.
#
# Reads ci/versions.toml (the manifest) and, for each tracked image, reports
# whether a newer version exists. It NEVER edits a pin, builds, or deploys —
# it only reads files and queries public registries/APIs.
#
# Usage:
#   ./ci/check-updates.sh           # pretty human-readable report (default)
#   ./ci/check-updates.sh --json    # machine-readable JSON array to stdout
#   ./ci/check-updates.sh --help
#
# Per kind:
#   upstream — queries the recorded check source, finds the newest tag matching
#              tag_filter, compares to the current pin. github_releases uses the
#              GitHub releases API.
#   nix      — reports the root flake.lock nixpkgs rev + lastModified + age, and
#              whether nixos-unstable HEAD is newer; if `nix` is on PATH also
#              `nix eval`s the attribute version the current lock would build.
#   self     — reports CI-built, surfaces any recorded gap (no version
#              tag / deployed as :latest). No upstream check.
#
# Degrades gracefully: a missing tool or a failed network call for ONE source
# is reported (status=error/skipped) and the run continues. Exit is always 0.
#
# Deps: bash, awk, grep, sed; curl + jq for upstream/nix-HEAD checks (optional);
#       nix for the nix-eval detail (optional).
set -uo pipefail

# --------------------------------------------------------------------------- #
# Locate the manifest relative to this script (works from any cwd).
# --------------------------------------------------------------------------- #
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$SCRIPT_DIR/versions.toml"

JSON=0
for arg in "$@"; do
  case "$arg" in
    --json) JSON=1 ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $arg (try --help)" >&2; exit 0 ;;
  esac
done

have() { command -v "$1" >/dev/null 2>&1; }
HAVE_CURL=0; have curl && HAVE_CURL=1
HAVE_JQ=0;   have jq   && HAVE_JQ=1
HAVE_NIX=0;  have nix  && HAVE_NIX=1

CURL() { curl -fsSL --max-time 25 "$@"; }

# Color only for the pretty report on a TTY.
if [ "$JSON" -eq 0 ] && [ -t 1 ]; then
  C_RST=$'\033[0m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_RED=$'\033[31m'; C_DIM=$'\033[2m'; C_BLD=$'\033[1m'
else
  C_RST=; C_GRN=; C_YEL=; C_RED=; C_DIM=; C_BLD=
fi

# --------------------------------------------------------------------------- #
# Tiny TOML parser for our known [[image]] schema. Emits, per image block, the
# fields as KEY<TAB>VALUE lines, blocks separated by a line "---". Handles only
# `key = "value"` / `key = value` scalars (sufficient for this manifest).
# --------------------------------------------------------------------------- #
parse_manifest() {
  awk '
    /^[[:space:]]*#/ { next }
    /^\[\[image\]\]/ { if (started) print "---"; started=1; next }
    started && /^[[:space:]]*[A-Za-z_]+[[:space:]]*=/ {
      line=$0
      sub(/^[[:space:]]*/, "", line)
      eq=index(line, "=")
      k=substr(line, 1, eq-1); sub(/[[:space:]]+$/, "", k)
      v=substr(line, eq+1);    sub(/^[[:space:]]+/, "", v); sub(/[[:space:]]+$/, "", v)
      # strip surrounding double quotes, unescape \\ -> \
      if (substr(v,1,1)=="\"" && substr(v,length(v),1)=="\"") v=substr(v,2,length(v)-2)
      gsub(/\\\\/, "\\", v)
      print k "\t" v
    }
    END { if (started) print "---" }
  ' "$MANIFEST"
}

# Field accessor over a block stored in the global assoc array F.
get() { printf '%s' "${F[$1]:-}"; }

# --------------------------------------------------------------------------- #
# Upstream version lookups. Each prints the newest tag matching $2 (ERE), or
# nothing. Never error the whole run.
# --------------------------------------------------------------------------- #

# Docker Hub: paginate, collect tag names, filter, sort.
latest_dockerhub() {
  local url="$1" filt="$2" page out names="" body next
  [ "$HAVE_CURL$HAVE_JQ" = "11" ] || { echo "__SKIP__"; return; }
  next="$url?page_size=100"
  for page in 1 2 3; do
    body="$(CURL "$next" 2>/dev/null)" || break
    out="$(printf '%s' "$body" | jq -r '.results[]?.name' 2>/dev/null)" || break
    names="$names"$'\n'"$out"
    next="$(printf '%s' "$body" | jq -r '.next // empty' 2>/dev/null)"
    [ -n "$next" ] || break
  done
  printf '%s\n' "$names" | grep -E "$filt" 2>/dev/null | sort -V | tail -n1
}

# Quay: collect active tag names, filter, newest. MinIO RELEASE.<ISO-timestamp>
# tags are lexicographically chronological, so a plain name sort gives newest.
# (`.hotfix.<sha>` suffixes sort after the plain release of the same date — fine.)
latest_quay() {
  local url="$1" filt="$2" body
  [ "$HAVE_CURL$HAVE_JQ" = "11" ] || { echo "__SKIP__"; return; }
  body="$(CURL "$url?limit=100&onlyActiveTags=true" 2>/dev/null)" || { echo "__SKIP__"; return; }
  printf '%s' "$body" \
    | jq -r '.tags[]?.name' 2>/dev/null \
    | grep -E "$filt" 2>/dev/null \
    | LC_ALL=C sort | tail -n1
}

# GitHub releases: newest non-prerelease tag matching filter.
latest_github_releases() {
  local repo="$1" filt="$2" body
  [ "$HAVE_CURL$HAVE_JQ" = "11" ] || { echo "__SKIP__"; return; }
  body="$(CURL -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$repo/releases?per_page=100" 2>/dev/null)" || { echo "__SKIP__"; return; }
  printf '%s' "$body" \
    | jq -r '.[] | select(.prerelease==false and .draft==false) | .tag_name' 2>/dev/null \
    | grep -E "$filt" 2>/dev/null | sed 's/^v//' | sort -V | tail -n1 | sed 's/^/v/'
}

# Normalize a version for compare (strip leading v).
norm() { printf '%s' "$1" | sed 's/^v//'; }

# --------------------------------------------------------------------------- #
# nix helpers.
# --------------------------------------------------------------------------- #
NIX_HEAD_SHA=""; NIX_HEAD_DATE=""
nix_head_lookup() {
  [ -n "$NIX_HEAD_SHA" ] && return
  [ "$HAVE_CURL$HAVE_JQ" = "11" ] || return
  local body
  body="$(CURL -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/NixOS/nixpkgs/commits/nixos-unstable" 2>/dev/null)" || return
  NIX_HEAD_SHA="$(printf '%s' "$body" | jq -r '.sha // empty' 2>/dev/null)"
  NIX_HEAD_DATE="$(printf '%s' "$body" | jq -r '.commit.committer.date // empty' 2>/dev/null)"
}

# Read locked nixpkgs rev + lastModified from a flake.lock (root node's nixpkgs).
lock_nixpkgs() { # $1 lockfile -> prints "rev<TAB>lastModified"
  local lf="$REPO_ROOT/$1"
  [ -f "$lf" ] || { echo "	"; return; }
  if [ "$HAVE_JQ" = 1 ]; then
    jq -r '
      (.nodes.root.inputs.nixpkgs) as $ref
      | (if ($ref|type)=="string" then $ref else $ref[0] end) as $node
      | .nodes[$node].locked | "\(.rev // "")\t\(.lastModified // "")"
    ' "$lf" 2>/dev/null && return
  fi
  # jq-less fallback: first nixpkgs locked block.
  awk '/"nixpkgs"/{innp=1} innp&&/"rev"/{gsub(/[",]/,"");rev=$2} innp&&/"lastModified"/{gsub(/[",]/,"");lm=$2; print rev"\t"lm; exit}' "$lf"
}

age_days() { # $1 epoch-or-iso  -> integer days since
  local v="$1" then now
  case "$v" in
    ''|null) echo "?"; return ;;
    *[!0-9]*) then="$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "${v%%+*}" +%s 2>/dev/null || date -d "$v" +%s 2>/dev/null || echo 0)" ;;
    *) then="$v" ;;
  esac
  now="$(date +%s)"
  [ "$then" -gt 0 ] 2>/dev/null && echo $(( (now - then) / 86400 )) || echo "?"
}

# --------------------------------------------------------------------------- #
# Process the manifest.
# --------------------------------------------------------------------------- #
JSON_ROWS=()
add_json() { # key kind current latest status
  JSON_ROWS+=( "$(printf '{"key":"%s","kind":"%s","current":"%s","latest":"%s","status":"%s"}' \
    "$1" "$2" "$3" "$4" "$5")" )
}

pp() { [ "$JSON" -eq 0 ] && printf '%b\n' "$*"; }

pp "${C_BLD}grown dependency-update report${C_RST}  ${C_DIM}($(date -u +%Y-%m-%dT%H:%M:%SZ))${C_RST}"
[ "$HAVE_CURL" = 1 ] || pp "${C_YEL}note: curl not found — upstream/nix-HEAD checks skipped${C_RST}"
[ "$HAVE_JQ" = 1 ]   || pp "${C_YEL}note: jq not found — upstream/nix-HEAD checks skipped${C_RST}"
[ "$HAVE_NIX" = 1 ]  || pp "${C_DIM}note: nix not found — nix attribute versions not evaluated${C_RST}"
pp ""

if [ ! -f "$MANIFEST" ]; then
  pp "${C_RED}manifest not found: $MANIFEST${C_RST}"
  [ "$JSON" -eq 1 ] && echo "[]"
  exit 0
fi

declare -A F
process_block() {
  local key kind current status latest src
  key="$(get key)"; kind="$(get kind)"; current="$(get current)"
  [ -n "$key" ] || return
  latest="-"; status="up-to-date"; src=""

  case "$kind" in
    upstream)
      local ct="$(get check_type)" filt="$(get tag_filter)"
      case "$ct" in
        dockerhub) src="$(get check_url)"; latest="$(latest_dockerhub "$src" "$filt")" ;;
        quay)      src="$(get check_url)"; latest="$(latest_quay "$src" "$filt")" ;;
        ghcr)      src="$(get check_url)"; latest="$(latest_dockerhub "$src" "$filt")" ;;
        github_releases) src="github:$(get check_repo)/releases"; latest="$(latest_github_releases "$(get check_repo)" "$filt")" ;;
        none)      latest="-"; status="manual"; src="$(get notes)" ;;
        *)         latest="-"; status="unknown-source" ;;
      esac
      if [ "$status" = "manual" ]; then
        pp "  ${C_DIM}MANUAL${C_RST}     $key  ${C_DIM}$current — no queryable source (bump by hand)${C_RST}"
      elif [ "$latest" = "__SKIP__" ] || { [ -z "$latest" ] && [ "$HAVE_CURL$HAVE_JQ" != "11" ]; }; then
        latest="-"; status="skipped"
        pp "  ${C_YEL}SKIPPED${C_RST}    $key  ${C_DIM}(curl/jq missing or offline)${C_RST}"
      elif [ -z "$latest" ]; then
        latest="-"; status="error"
        pp "  ${C_YEL}NO-DATA${C_RST}    $key  ${C_DIM}(query returned no matching tags — $src)${C_RST}"
      elif [ "$(norm "$latest")" = "$(norm "$current")" ]; then
        status="up-to-date"
        pp "  ${C_GRN}UP-TO-DATE${C_RST} $key  $current"
      else
        # Decide direction with version sort (newest of the two == latest?).
        local newer; newer="$(printf '%s\n%s\n' "$(norm "$current")" "$(norm "$latest")" | sort -V | tail -n1)"
        if [ "$newer" = "$(norm "$current")" ]; then
          status="up-to-date"
          pp "  ${C_GRN}UP-TO-DATE${C_RST} $key  $current  ${C_DIM}(latest seen: $latest)${C_RST}"
        else
          status="update"
          pp "  ${C_YEL}UPDATE${C_RST}     $key  ${C_BLD}$current -> $latest${C_RST}  ${C_DIM}$src${C_RST}"
        fi
      fi
      ;;

    nix)
      local lock="$(get lock_file)" attr="$(get nix_attr)" rev lm age headnote ev
      IFS=$'\t' read -r rev lm < <(lock_nixpkgs "$lock")
      age="$(age_days "$lm")"
      nix_head_lookup
      headnote=""
      if [ -n "$NIX_HEAD_SHA" ] && [ -n "$rev" ]; then
        if [ "${NIX_HEAD_SHA:0:12}" = "${rev:0:12}" ]; then
          headnote="lock == nixos-unstable HEAD"
          status="up-to-date"
        else
          headnote="nixos-unstable HEAD is newer (${NIX_HEAD_SHA:0:8}, ${NIX_HEAD_DATE})"
          status="lock-behind-head"
        fi
      else
        headnote="HEAD unknown (curl/jq missing or offline)"
        status="skipped"
      fi
      latest="${rev:0:8}@${lm}"
      ev=""
      if [ "$HAVE_NIX" = 1 ] && [ -n "$attr" ]; then
        ev="$(nix eval --raw "nixpkgs#${attr}.version" 2>/dev/null \
          || nix eval --raw "${REPO_ROOT}#legacyPackages.x86_64-linux.${attr}.version" 2>/dev/null \
          || true)"
      fi
      [ -n "$ev" ] && current="$attr=$ev" || current="$attr (eval skipped)"
      pp "  ${C_DIM}NIX${C_RST}        $key  lock=${rev:0:8} (${lock}) age=${age}d  ${C_DIM}${headnote}${C_RST}"
      [ -n "$ev" ] && pp "             ${C_DIM}current lock builds $attr $ev — bump via \`nix flake update\`${C_RST}"
      local g="$(get gap)"; [ -n "$g" ] && pp "             ${C_YEL}gap: $g — nix image not published with a version tag${C_RST}"
      ;;

    self)
      latest="-"; status="ci-built"
      local g="$(get gap)"
      if [ -n "$g" ]; then
        status="gap:$g"
        pp "  ${C_YEL}SELF/GAP${C_RST}   $key  ${C_BLD}gap: $g${C_RST}  ${C_DIM}$(get notes)${C_RST}"
      else
        pp "  ${C_DIM}SELF${C_RST}       $key  ${C_DIM}CI-built ($(get pin_file)); no upstream check${C_RST}"
      fi
      ;;

    *) status="unknown-kind"; pp "  ${C_RED}?${C_RST}          $key  unknown kind '$kind'" ;;
  esac

  add_json "$key" "$kind" "$current" "$latest" "$status"
}

# Drive: feed blocks to process_block.
while IFS= read -r line; do
  if [ "$line" = "---" ]; then
    [ "${#F[@]}" -gt 0 ] && process_block
    F=(); continue
  fi
  k="${line%%	*}"; v="${line#*	}"
  F["$k"]="$v"
done < <(parse_manifest)
[ "${#F[@]}" -gt 0 ] && process_block

if [ "$JSON" -eq 1 ]; then
  printf '[\n'
  for i in "${!JSON_ROWS[@]}"; do
    printf '  %s' "${JSON_ROWS[$i]}"
    [ "$i" -lt $(( ${#JSON_ROWS[@]} - 1 )) ] && printf ','
    printf '\n'
  done
  printf ']\n'
else
  pp ""
  pp "${C_DIM}report-only — no files were changed. Re-run with --json for machine output.${C_RST}"
fi

exit 0
