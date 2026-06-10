#!/usr/bin/env bash
# Creates the Twenty (CRM) OIDC client inside grown's Zitadel so the integrated
# Twenty app shares the same single sign-on. Writes
# deploy/zitadel/data/twenty-oidc.env with TWENTY_OIDC_CLIENT_ID / _SECRET /
# _ISSUER for the operator to paste into Twenty's Settings -> Security -> SSO UI
# (Twenty configures OIDC providers in-app, not via env — see WIRING.md).
#
# Reuses the bootstrap service-account PAT that `zitadel setup` writes to
# deploy/zitadel/data/bootstrap-pat.txt (same as create-pdf-oidc-app.sh).
# The login policy / MFA disabling is already handled by create-oidc-app.sh, so
# this only provisions the project + app.
#
# Twenty's OIDC callback path is fixed at /auth/oidc/callback on Twenty's
# SERVER_URL origin. Because grown reverse-proxies the CRM subdomain straight to
# Twenty at root, that origin is the public subdomain
# http://crm.workspace.localtest.me:8080, so the redirect URI is
# http://crm.workspace.localtest.me:8080/auth/oidc/callback.

set -euo pipefail

ZITADEL_URL="${ZITADEL_URL:-http://localhost:8081}"
# Issuer that Twenty's SSO config must point at. This is grown's Zitadel.
ISSUER_URL="${TWENTY_OIDC_ISSUER:-http://localhost:8081}"
# Twenty's OIDC callback (fixed path /auth/oidc/callback on its SERVER_URL).
REDIRECT_URL="${TWENTY_REDIRECT_URL:-http://crm.workspace.localtest.me:8080/auth/oidc/callback}"
# After logout Twenty returns the user to its own origin.
POST_LOGOUT_URL="${TWENTY_POST_LOGOUT_URL:-http://crm.workspace.localtest.me:8080/}"

PAT_FILE="${PROJECT_ROOT:-.}/deploy/zitadel/data/bootstrap-pat.txt"
CREDS_FILE="${PROJECT_ROOT:-.}/deploy/zitadel/data/twenty-oidc.env"

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
if [ -s "$CREDS_FILE" ] && grep -q "TWENTY_OIDC_CLIENT_ID=" "$CREDS_FILE"; then
  echo "twenty OIDC credentials already present at $CREDS_FILE. Nothing to do."
  exit 0
fi

# Find or create the "twenty" project.
PROJECT_ID=$(curl -sf -X POST "$ZITADEL_URL/management/v1/projects/_search" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"queries":[{"nameQuery":{"name":"twenty","method":"TEXT_QUERY_METHOD_EQUALS"}}]}' \
  | jq -r '.result[0].id // empty')

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(curl -sf -X POST "$ZITADEL_URL/management/v1/projects" \
    -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d '{"name":"twenty"}' | jq -r '.id')
  echo "Created project twenty (id=$PROJECT_ID)."
else
  echo "Project twenty already exists (id=$PROJECT_ID)."
  # Remove any stale app so we get fresh credentials matching this CREDS_FILE.
  STALE=$(curl -sf "$ZITADEL_URL/management/v1/projects/$PROJECT_ID/apps/_search" \
    -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" -d '{}' \
    | jq -r '.result[]? | select(.name == "twenty-crm") | .id // empty' | head -1)
  if [ -n "$STALE" ]; then
    curl -sf -X DELETE "$ZITADEL_URL/management/v1/projects/$PROJECT_ID/apps/$STALE" \
      -H "Authorization: Bearer $ACCESS_TOKEN" >/dev/null || true
  fi
fi

RESPONSE=$(curl -sf -X POST "$ZITADEL_URL/management/v1/projects/$PROJECT_ID/apps/oidc" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -n --arg name "twenty-crm" --arg redirect "$REDIRECT_URL" --arg logout "$POST_LOGOUT_URL" \
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

printf 'TWENTY_OIDC_ISSUER=%s\nTWENTY_OIDC_CLIENT_ID=%s\nTWENTY_OIDC_CLIENT_SECRET=%s\n' \
  "$ISSUER_URL" "$CLIENT_ID" "$CLIENT_SECRET" > "$CREDS_FILE"
echo "Created OIDC app twenty-crm (client_id=$CLIENT_ID). Credentials written to $CREDS_FILE."
echo "Paste these into Twenty: Settings -> Security -> SSO -> New (OIDC)."
echo "  Issuer:        $ISSUER_URL"
echo "  Client ID:     $CLIENT_ID"
echo "  Client Secret: (see $CREDS_FILE)"
