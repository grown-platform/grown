#!/usr/bin/env bash
# Creates the pdf (PDF editor & sign) OIDC client inside grown's Zitadel so
# the integrated PDF app shares the same single sign-on. Writes
# deploy/zitadel/data/pdf-oidc.env with PDF_AUTH_CLIENT_ID/SECRET for
# the pdf-backend process to read.
#
# Reuses the bootstrap service-account PAT that `zitadel setup` writes to
# deploy/zitadel/data/bootstrap-pat.txt (same as create-oidc-app.sh). The login
# policy / MFA disabling is already handled by create-oidc-app.sh, so this only
# provisions the project + app.

set -euo pipefail

ZITADEL_URL="${ZITADEL_URL:-http://localhost:8081}"
# Redirect comes back through grown's origin and is reverse-proxied to the
# pdf-backend (/pdf-api/* → backend /*, so /pdf-api/auth/callback → /auth/callback).
REDIRECT_URL="${PDF_REDIRECT_URL:-http://workspace.localtest.me:8080/pdf-api/auth/callback}"
POST_LOGOUT_URL="${PDF_POST_LOGOUT_URL:-http://workspace.localtest.me:8080/pdf/}"

PAT_FILE="${PROJECT_ROOT:-.}/deploy/zitadel/data/bootstrap-pat.txt"
CREDS_FILE="${PROJECT_ROOT:-.}/deploy/zitadel/data/pdf-oidc.env"

for i in $(seq 1 30); do
  [ -s "$PAT_FILE" ] && break
  echo "Waiting for bootstrap PAT at $PAT_FILE (attempt $i)..." >&2
  sleep 1
done
if [ ! -s "$PAT_FILE" ]; then
  echo "Bootstrap PAT file not found or empty: $PAT_FILE" >&2
  exit 1
fi
ACCESS_TOKEN=$(tr -d '[:space:]' < "$PAT_FILE")
mkdir -p "$(dirname "$CREDS_FILE")"

# If creds already exist, nothing to do (idempotent across restarts).
if [ -s "$CREDS_FILE" ] && grep -q "PDF_AUTH_CLIENT_ID=" "$CREDS_FILE"; then
  echo "pdf OIDC credentials already present at $CREDS_FILE. Nothing to do."
  exit 0
fi

# Find or create the "pdf" project.
PROJECT_ID=$(curl -sf -X POST "$ZITADEL_URL/management/v1/projects/_search" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"queries":[{"nameQuery":{"name":"pdf","method":"TEXT_QUERY_METHOD_EQUALS"}}]}' \
  | jq -r '.result[0].id // empty')

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(curl -sf -X POST "$ZITADEL_URL/management/v1/projects" \
    -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d '{"name":"pdf"}' | jq -r '.id')
  echo "Created project pdf (id=$PROJECT_ID)."
else
  echo "Project pdf already exists (id=$PROJECT_ID)."
  # Remove any stale app so we get fresh credentials matching this CREDS_FILE.
  STALE=$(curl -sf "$ZITADEL_URL/management/v1/projects/$PROJECT_ID/apps/_search" \
    -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" -d '{}' \
    | jq -r '.result[]? | select(.name == "pdf-backend") | .id // empty' | head -1)
  if [ -n "$STALE" ]; then
    curl -sf -X DELETE "$ZITADEL_URL/management/v1/projects/$PROJECT_ID/apps/$STALE" \
      -H "Authorization: Bearer $ACCESS_TOKEN" >/dev/null || true
  fi
fi

RESPONSE=$(curl -sf -X POST "$ZITADEL_URL/management/v1/projects/$PROJECT_ID/apps/oidc" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -n --arg name "pdf-backend" --arg redirect "$REDIRECT_URL" --arg logout "$POST_LOGOUT_URL" \
    '{
       name: $name,
       redirectUris: [$redirect],
       responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
       grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
       appType: "OIDC_APP_TYPE_WEB",
       authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
       postLogoutRedirectUris: [$logout],
       devMode: true,
       accessTokenType: "OIDC_TOKEN_TYPE_BEARER",
       accessTokenRoleAssertion: true,
       idTokenRoleAssertion: true,
       idTokenUserinfoAssertion: true,
       clockSkew: "1s",
       additionalOrigins: []
     }')")

CLIENT_ID=$(echo "$RESPONSE" | jq -r '.clientId')
CLIENT_SECRET=$(echo "$RESPONSE" | jq -r '.clientSecret')
if [ -z "$CLIENT_ID" ] || [ "$CLIENT_ID" = "null" ]; then
  echo "Failed to extract clientId from Zitadel response: $RESPONSE" >&2
  exit 1
fi

printf 'PDF_AUTH_CLIENT_ID=%s\nPDF_AUTH_CLIENT_SECRET=%s\n' \
  "$CLIENT_ID" "$CLIENT_SECRET" > "$CREDS_FILE"
echo "Created OIDC app pdf-backend (client_id=$CLIENT_ID). Credentials written to $CREDS_FILE."
