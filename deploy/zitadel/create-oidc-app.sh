#!/usr/bin/env bash
# Creates the grown-workspace OIDC client and test user inside Zitadel on first boot.
# Writes deploy/zitadel/data/oidc-client.env with the actual credentials so
# the backend process can read them.
#
# Auth: reads the bootstrap service-account PAT that `zitadel setup` writes
# to deploy/zitadel/data/bootstrap-pat.txt (configured via PatPath in steps.yaml).

set -euo pipefail

ZITADEL_URL="${ZITADEL_URL:-http://localhost:8081}"
REDIRECT_URL="${GROWN_OIDC_REDIRECT_URL:-http://workspace.localtest.me:8080/api/v1/auth/callback}"

# PatPath is relative to the PROJECT_ROOT where `zitadel setup` was run.
PAT_FILE="${PROJECT_ROOT:-.}/deploy/zitadel/data/bootstrap-pat.txt"
CREDS_FILE="${PROJECT_ROOT:-.}/deploy/zitadel/data/oidc-client.env"

# Wait up to 30 s for the PAT file to appear (zitadel setup writes it on first
# boot; on subsequent boots it won't be re-written but the file persists).
for i in $(seq 1 30); do
  if [ -s "$PAT_FILE" ]; then
    break
  fi
  echo "Waiting for bootstrap PAT at $PAT_FILE (attempt $i)..." >&2
  sleep 1
done

if [ ! -s "$PAT_FILE" ]; then
  echo "Bootstrap PAT file not found or empty: $PAT_FILE" >&2
  exit 1
fi

ACCESS_TOKEN=$(tr -d '[:space:]' < "$PAT_FILE")

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Bootstrap PAT is empty." >&2
  exit 1
fi

mkdir -p "$(dirname "$CREDS_FILE")"

# ---------------------------------------------------------------------------
# 1. Provision test user: admin with email admin@grown.localtest.me
# ---------------------------------------------------------------------------
# Check if the test user already exists.
EXISTING_USER=$(curl -sf -X POST "$ZITADEL_URL/v2/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"queries":[{"userNameQuery":{"userName":"admin","method":"TEXT_QUERY_METHOD_EQUALS"}}]}' \
  | jq -r '.result[]? | select(.human != null) | .userId // empty' | head -1)

if [ -n "$EXISTING_USER" ]; then
  echo "Test user admin already exists (id=$EXISTING_USER). Skipping user creation."
else
  echo "Creating test user admin..."

  # Get the default org ID.
  DEFAULT_ORG=$(curl -sf "$ZITADEL_URL/management/v1/orgs/me" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    | jq -r '.org.id')

  # Pre-computed bcrypt-12 hash of "DevPassword!1" (local-dev only).
  # Using a fixed hash avoids the init-code email flow that requires SMTP.
  # The _import endpoint sets the user directly to ACTIVE state.
  BCRYPT_HASH='$2a$12$JfZJYQiQGc1UYEC4.al/Ne6OAFOdLxpzlByX5R./DwiFM/.EhQuze'

  CREATED=$(curl -sf -X POST "$ZITADEL_URL/management/v1/users/human/_import" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "x-zitadel-orgid: $DEFAULT_ORG" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg hash "$BCRYPT_HASH" \
      '{
        "userName": "admin",
        "profile": {
          "firstName": "Grown",
          "lastName": "Admin",
          "displayName": "Grown Admin",
          "preferredLanguage": "en"
        },
        "email": {
          "email": "admin@grown.localtest.me",
          "isEmailVerified": true
        },
        "hashedPassword": {
          "value": $hash
        },
        "passwordChangeRequired": false
      }')")
  EXISTING_USER=$(echo "$CREATED" | jq -r '.userId')
  echo "Created test user admin (id=$EXISTING_USER) in ACTIVE state."
fi

# ---------------------------------------------------------------------------
# 2. Disable MFA requirement in the instance login policy (local-dev only).
#    By default Zitadel enables OTP + U2F second factors which show a mandatory
#    "2-Factor Setup" screen after first login. Remove them so the OIDC flow
#    completes without MFA prompts.
# ---------------------------------------------------------------------------
echo "Configuring login policy (disabling MFA factors for local dev)..."

# Update instance-level policy: no forceMfa, mfaInitSkipLifetime=0 (skip grace).
curl -sf -X PUT "$ZITADEL_URL/admin/v1/policies/login" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "allowUsernamePassword": true,
    "allowRegister": false,
    "allowExternalIdp": false,
    "passwordlessType": "PASSWORDLESS_TYPE_NOT_ALLOWED",
    "passwordCheckLifetime": "864000s",
    "externalLoginCheckLifetime": "864000s",
    "mfaInitSkipLifetime": "2592000s",
    "secondFactorCheckLifetime": "64800s",
    "multiFactorCheckLifetime": "43200s",
    "forceMfa": false,
    "forceMfaLocalOnly": false
  }' >/dev/null || echo "Warning: could not update login policy." >&2

# Remove OTP and U2F second factors so the 2FA setup screen never appears.
curl -sf -X DELETE \
  "$ZITADEL_URL/admin/v1/policies/login/second_factors/SECOND_FACTOR_TYPE_OTP" \
  -H "Authorization: Bearer $ACCESS_TOKEN" >/dev/null 2>&1 || true
curl -sf -X DELETE \
  "$ZITADEL_URL/admin/v1/policies/login/second_factors/SECOND_FACTOR_TYPE_TOTP" \
  -H "Authorization: Bearer $ACCESS_TOKEN" >/dev/null 2>&1 || true
# Numeric enum values (fallback for enum name differences across versions).
curl -sf -X DELETE \
  "$ZITADEL_URL/admin/v1/policies/login/second_factors/2" \
  -H "Authorization: Bearer $ACCESS_TOKEN" >/dev/null 2>&1 || true
curl -sf -X DELETE \
  "$ZITADEL_URL/admin/v1/policies/login/second_factors/3" \
  -H "Authorization: Bearer $ACCESS_TOKEN" >/dev/null 2>&1 || true
curl -sf -X DELETE \
  "$ZITADEL_URL/admin/v1/policies/login/multi_factors/MULTI_FACTOR_TYPE_U2F_WITH_VERIFICATION" \
  -H "Authorization: Bearer $ACCESS_TOKEN" >/dev/null 2>&1 || true
echo "Login policy configured."

# ---------------------------------------------------------------------------
# 3. Provision OIDC app
# ---------------------------------------------------------------------------
# Check if a project named "grown-workspace" already exists.
EXISTING_PROJECT=$(curl -sf -X POST "$ZITADEL_URL/management/v1/projects/_search" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"queries":[{"nameQuery":{"name":"grown-workspace","method":"TEXT_QUERY_METHOD_EQUALS"}}]}' \
  | jq -r '.result[0].id // empty')

if [ -n "$EXISTING_PROJECT" ]; then
  echo "Project grown-workspace already exists (id=$EXISTING_PROJECT)."
  PROJECT_ID="$EXISTING_PROJECT"

  # Find the existing app.
  EXISTING_APP=$(curl -sf "$ZITADEL_URL/management/v1/projects/$PROJECT_ID/apps/_search" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' \
    | jq -r '.result[]? | select(.name == "grown-workspace-backend") | .id // empty' | head -1)

  if [ -n "$EXISTING_APP" ]; then
    echo "App grown-workspace-backend already exists (id=$EXISTING_APP)."

    # If credentials file is already present, nothing more to do.
    if [ -s "$CREDS_FILE" ]; then
      echo "Credentials file already present at $CREDS_FILE. Nothing to do."
      exit 0
    fi

    # Credentials file is missing: delete the app and recreate to get fresh creds.
    echo "Credentials file missing; deleting app to recreate with fresh credentials."
    curl -sf -X DELETE "$ZITADEL_URL/management/v1/projects/$PROJECT_ID/apps/$EXISTING_APP" \
      -H "Authorization: Bearer $ACCESS_TOKEN" >/dev/null
  fi
else
  # Create project.
  PROJECT_ID=$(curl -sf -X POST "$ZITADEL_URL/management/v1/projects" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"grown-workspace"}' | jq -r '.id')

  echo "Created project grown-workspace (id=$PROJECT_ID)."
fi

# Create OIDC application within the project. Zitadel assigns its own clientId
# and returns the clientSecret only at creation time — capture both.
RESPONSE=$(curl -sf -X POST "$ZITADEL_URL/management/v1/projects/$PROJECT_ID/apps/oidc" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg name "grown-workspace-backend" \
    --arg redirect "$REDIRECT_URL" \
    '{
       name: $name,
       redirectUris: [$redirect],
       responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
       grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
       appType: "OIDC_APP_TYPE_WEB",
       authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
       postLogoutRedirectUris: ["http://workspace.localtest.me:8080/"],
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

# Write credentials for the backend process.
printf 'GROWN_OIDC_CLIENT_ID=%s\nGROWN_OIDC_CLIENT_SECRET=%s\n' \
  "$CLIENT_ID" "$CLIENT_SECRET" > "$CREDS_FILE"

echo "Created OIDC app grown-workspace-backend (client_id=$CLIENT_ID)."
echo "Credentials written to $CREDS_FILE."
