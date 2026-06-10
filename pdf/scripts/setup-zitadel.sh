#!/usr/bin/env bash
set -euo pipefail

# Setup script for Zitadel OIDC application
# This script uses the PAT generated during Zitadel bootstrap to create
# a project and OIDC application for the Pdf backend.

ZITADEL_URL="${ZITADEL_URL:-http://localhost:8094}"
PAT_FILE="${PAT_FILE:-.zitadel/admin.pat}"
CREDENTIALS_FILE="${CREDENTIALS_FILE:-.zitadel/credentials.env}"

PROJECT_NAME="Pdf"
APP_NAME="Pdf Backend"

# Redirect URIs for local development
REDIRECT_URI_LOCAL="http://localhost:8085/auth/callback"
REDIRECT_URI_BACKEND="http://localhost:5173/auth/callback"

# Post-logout redirect URIs (redirect to frontend after logout)
POST_LOGOUT_URI_LOCAL="http://localhost:5173"
POST_LOGOUT_URI_BACKEND="http://localhost:8080"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# Wait for PAT file to be created by Zitadel
wait_for_pat() {
  log_info "Waiting for PAT file at $PAT_FILE..."
  local max_attempts=60
  local attempt=0

  while [ ! -f "$PAT_FILE" ] || [ ! -s "$PAT_FILE" ]; do
    attempt=$((attempt + 1))
    if [ $attempt -ge $max_attempts ]; then
      log_error "Timed out waiting for PAT file."
      log_error "The PAT is only created on first Zitadel initialization."
      log_error "To fix: stop process-compose, run 'rm -rf .zitadel/', then restart."
      exit 1
    fi
    sleep 2
  done

  log_info "PAT file found"
}

# Wait for Zitadel to be ready
wait_for_zitadel() {
  log_info "Waiting for Zitadel to be ready..."
  local max_attempts=30
  local attempt=0

  while ! curl -sf "${ZITADEL_URL}/debug/healthz" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ $attempt -ge $max_attempts ]; then
      log_error "Timed out waiting for Zitadel"
      exit 1
    fi
    sleep 2
  done

  log_info "Zitadel is ready"
}

# Read the PAT
get_pat() {
  cat "$PAT_FILE" | tr -d '\n'
}

# Find existing project by name
find_project() {
  local pat="$1"

  local response
  response=$(curl -s -X POST "${ZITADEL_URL}/management/v1/projects/_search" \
    -H "Authorization: Bearer ${pat}" \
    -H "Content-Type: application/json" \
    -d "{\"queries\": [{\"nameQuery\": {\"name\": \"${PROJECT_NAME}\", \"method\": \"TEXT_QUERY_METHOD_EQUALS\"}}]}")

  echo "$response" | jq -r '.result[0].id // empty'
}

# Create a project
create_project() {
  local pat="$1"

  # Check if project already exists
  local existing_id
  existing_id=$(find_project "$pat")

  if [ -n "$existing_id" ]; then
    log_warn "Project already exists with ID: $existing_id"
    echo "$existing_id"
    return 0
  fi

  log_info "Creating project: $PROJECT_NAME"

  local response
  response=$(curl -s -X POST "${ZITADEL_URL}/management/v1/projects" \
    -H "Authorization: Bearer ${pat}" \
    -H "Content-Type: application/json" \
    -d "{
            \"name\": \"${PROJECT_NAME}\",
            \"projectRoleAssertion\": true,
            \"projectRoleCheck\": false,
            \"hasProjectCheck\": false,
            \"privateLabelingSetting\": \"PRIVATE_LABELING_SETTING_UNSPECIFIED\"
        }")

  local project_id
  project_id=$(echo "$response" | jq -r '.id // empty')

  if [ -z "$project_id" ]; then
    log_error "Failed to create project: $response"
    exit 1
  fi

  log_info "Created project with ID: $project_id"
  echo "$project_id"
}

# Find existing app by name, returns "app_id:client_id" or empty
find_app() {
  local pat="$1"
  local project_id="$2"

  local response
  response=$(curl -s -X POST "${ZITADEL_URL}/management/v1/projects/${project_id}/apps/_search" \
    -H "Authorization: Bearer ${pat}" \
    -H "Content-Type: application/json" \
    -d '{}')

  local app_id client_id
  app_id=$(echo "$response" | jq -r ".result[] | select(.name == \"${APP_NAME}\") | .id" 2>/dev/null || echo "")
  client_id=$(echo "$response" | jq -r ".result[] | select(.name == \"${APP_NAME}\") | .oidcConfig.clientId" 2>/dev/null || echo "")

  if [ -n "$app_id" ] && [ -n "$client_id" ]; then
    echo "${app_id}:${client_id}"
  fi
}

# Create an OIDC application
create_oidc_app() {
  local pat="$1"
  local project_id="$2"

  # Check if app already exists (returns "app_id:client_id")
  local existing
  existing=$(find_app "$pat" "$project_id")

  if [ -n "$existing" ]; then
    local app_id="${existing%%:*}"
    local client_id="${existing##*:}"
    log_warn "Application already exists with ID: $app_id"
    log_info "Regenerating client secret..."
    regenerate_secret "$pat" "$project_id" "$app_id" "$client_id"
    return 0
  fi

  log_info "Creating OIDC application: $APP_NAME"

  local response
  response=$(curl -s -X POST "${ZITADEL_URL}/management/v1/projects/${project_id}/apps/oidc" \
    -H "Authorization: Bearer ${pat}" \
    -H "Content-Type: application/json" \
    -d "{
            \"name\": \"${APP_NAME}\",
            \"redirectUris\": [\"${REDIRECT_URI_LOCAL}\", \"${REDIRECT_URI_BACKEND}\"],
            \"postLogoutRedirectUris\": [\"${POST_LOGOUT_URI_LOCAL}\", \"${POST_LOGOUT_URI_BACKEND}\"],
            \"responseTypes\": [\"OIDC_RESPONSE_TYPE_CODE\"],
            \"grantTypes\": [\"OIDC_GRANT_TYPE_AUTHORIZATION_CODE\", \"OIDC_GRANT_TYPE_REFRESH_TOKEN\"],
            \"appType\": \"OIDC_APP_TYPE_WEB\",
            \"authMethodType\": \"OIDC_AUTH_METHOD_TYPE_BASIC\",
            \"version\": \"OIDC_VERSION_1_0\",
            \"devMode\": true,
            \"accessTokenType\": \"OIDC_TOKEN_TYPE_BEARER\",
            \"accessTokenRoleAssertion\": true,
            \"idTokenRoleAssertion\": true,
            \"idTokenUserinfoAssertion\": true
        }")

  local client_id
  local client_secret
  client_id=$(echo "$response" | jq -r '.clientId // empty')
  client_secret=$(echo "$response" | jq -r '.clientSecret // empty')

  if [ -z "$client_id" ] || [ -z "$client_secret" ]; then
    log_error "Failed to create OIDC app: $response"
    exit 1
  fi

  log_info "Created OIDC app with client ID: $client_id"
  save_credentials "$client_id" "$client_secret"
}

# Regenerate client secret for existing app
regenerate_secret() {
  local pat="$1"
  local project_id="$2"
  local app_id="$3"
  local client_id="$4"

  local response
  response=$(curl -s -X POST "${ZITADEL_URL}/management/v1/projects/${project_id}/apps/${app_id}/oidc_config/_generate_client_secret" \
    -H "Authorization: Bearer ${pat}" \
    -H "Content-Type: application/json" \
    -d "{}")

  local client_secret
  client_secret=$(echo "$response" | jq -r '.clientSecret // empty')

  if [ -z "$client_secret" ]; then
    log_error "Failed to regenerate client secret: $response"
    exit 1
  fi

  log_info "Regenerated secret for client ID: $client_id"
  save_credentials "$client_id" "$client_secret"
}

# Save credentials to file
save_credentials() {
  local client_id="$1"
  local client_secret="$2"

  mkdir -p "$(dirname "$CREDENTIALS_FILE")"

  cat >"$CREDENTIALS_FILE" <<EOF
# Zitadel OIDC credentials - generated by setup-zitadel.sh
# Do not commit this file to version control

PDF_AUTH_CLIENT_ID=${client_id}
PDF_AUTH_CLIENT_SECRET=${client_secret}
EOF

  chmod 600 "$CREDENTIALS_FILE"
  log_info "Credentials saved to $CREDENTIALS_FILE"
}

# Add localhost as trusted domain
add_trusted_domain() {
  local pat="$1"
  local domain="$2"

  log_info "Adding trusted domain: $domain"

  local response
  response=$(curl -s -X POST "${ZITADEL_URL}/admin/v1/trusted_domains" \
    -H "Authorization: Bearer ${pat}" \
    -H "Content-Type: application/json" \
    -d "{\"domain\": \"${domain}\"}")

  # Check if already exists (code 9 = ALREADY_EXISTS in gRPC)
  local code message
  code=$(echo "$response" | jq -r '.code // empty')
  message=$(echo "$response" | jq -r '.message // empty')
  if [ "$code" = "9" ] || [[ $message == *"AlreadyExists"* ]]; then
    log_warn "Trusted domain already exists: $domain"
    return 0
  fi

  # If there's any error code, fail
  if [ -n "$code" ]; then
    log_error "Failed to add trusted domain: $response"
    return 1
  fi

  log_info "Added trusted domain: $domain"
}

main() {
  log_info "Starting Zitadel setup for Pdf..."

  # Ensure .zitadel directory exists
  mkdir -p .zitadel

  wait_for_zitadel
  wait_for_pat

  local pat
  pat=$(get_pat)

  # Add trusted domains
  add_trusted_domain "$pat" "localhost"

  local project_id
  project_id=$(create_project "$pat")

  create_oidc_app "$pat" "$project_id"

  log_info ""
  log_info "Zitadel setup complete!"
  log_info ""
  log_info "You can now login at: ${ZITADEL_URL}/ui/console"
  log_info "  Username: admin"
  log_info "  Password: Admin123!"
}

main "$@"
