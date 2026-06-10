// Client for grown's in-app account security, backed by the Zitadel User API v2
// proxied through the backend at /api/zitadel/v2/users/{id}/*. The backend
// pins {id} to the caller's own oidc_subject, so the caller passes their own id
// (user.oidc_subject) and may only ever touch their own account.

import { serializeAttestationResponse } from "../utils/webauthn";

const PROXY_BASE = "/api/zitadel";

/** zfetch calls the Zitadel proxy. Errors carry the HTTP status in `.message`
 *  (e.g. "Zitadel 400") so callers can branch on it without redirecting. */
async function zfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${PROXY_BASE}${path}`, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });
  if (!resp.ok) throw new Error(`Zitadel ${resp.status}`);
  // Some endpoints (DELETE, verify) return an empty body.
  const text = await resp.text();
  return (text ? JSON.parse(text) : {}) as T;
}

// ---- Profile + auth methods ------------------------------------------------

export type ZitadelUserProfile = {
  user: {
    userId: string;
    username: string;
    preferredLoginName: string;
    human?: {
      profile?: {
        givenName?: string;
        familyName?: string;
        displayName?: string;
      };
      email?: { email?: string; isVerified?: boolean };
      passwordChanged?: string;
    };
  };
};

export type ZitadelAuthMethods = { authMethodTypes?: string[] };

export type ZitadelPasskey = { id: string; name: string; state?: string };
export type ZitadelPasskeysResponse = { result?: ZitadelPasskey[] };

export type AuthMethod = { type: string; name: string };

export type UserSecurityInfo = {
  username: string;
  email: string;
  emailVerified: boolean;
  authMethods: AuthMethod[];
  passkeys: Array<{ id: string; name: string }>;
  passwordChanged?: string;
  hasTotp: boolean;
  hasPassword: boolean;
};

const AUTH_METHOD_NAMES: Record<string, string> = {
  AUTHENTICATION_METHOD_TYPE_PASSWORD: "Password",
  AUTHENTICATION_METHOD_TYPE_PASSKEY: "Passkey",
  AUTHENTICATION_METHOD_TYPE_IDP: "Identity provider",
  AUTHENTICATION_METHOD_TYPE_OTP_SMS: "SMS code",
  AUTHENTICATION_METHOD_TYPE_OTP_EMAIL: "Email code",
  AUTHENTICATION_METHOD_TYPE_TOTP: "Authenticator app",
  AUTHENTICATION_METHOD_TYPE_U2F: "Security key",
};

export function authMethodName(type: string): string {
  return AUTH_METHOD_NAMES[type] ?? type;
}

/** Aggregates the user's profile, auth methods, and (if any) passkeys into a
 *  single view model for the security panel. */
export async function getUserSecurityInfo(
  userId: string,
): Promise<UserSecurityInfo> {
  const profile = await zfetch<ZitadelUserProfile>(`/v2/users/${userId}`);
  const methods = await zfetch<ZitadelAuthMethods>(
    `/v2/users/${userId}/authentication_methods`,
  );
  const types = methods.authMethodTypes ?? [];

  let passkeys: Array<{ id: string; name: string }> = [];
  if (types.includes("AUTHENTICATION_METHOD_TYPE_PASSKEY")) {
    try {
      const list = await zfetch<ZitadelPasskeysResponse>(
        `/v2/users/${userId}/passkeys/_search`,
        {
          method: "POST",
          body: "{}",
        },
      );
      passkeys = (list.result ?? []).map((p) => ({ id: p.id, name: p.name }));
    } catch {
      // Non-fatal: show the method without per-key names.
    }
  }

  return {
    username: profile.user.username,
    email: profile.user.human?.email?.email ?? "",
    emailVerified: profile.user.human?.email?.isVerified ?? false,
    authMethods: types
      .filter((t) => t !== "AUTHENTICATION_METHOD_TYPE_IDP")
      .map((t) => ({ type: t, name: authMethodName(t) })),
    passkeys,
    passwordChanged: profile.user.human?.passwordChanged,
    hasTotp: types.includes("AUTHENTICATION_METHOD_TYPE_TOTP"),
    hasPassword: types.includes("AUTHENTICATION_METHOD_TYPE_PASSWORD"),
  };
}

// ---- Password --------------------------------------------------------------

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await zfetch(`/v2/users/${userId}/password`, {
    method: "POST",
    body: JSON.stringify({
      currentPassword,
      newPassword: { password: newPassword },
    }),
  });
}

// ---- TOTP (authenticator app) ----------------------------------------------

export type StartTotpResponse = { uri: string; secret: string };

export function startTotpRegistration(
  userId: string,
): Promise<StartTotpResponse> {
  return zfetch<StartTotpResponse>(`/v2/users/${userId}/totp`, {
    method: "POST",
    body: "{}",
  });
}

export async function verifyTotpRegistration(
  userId: string,
  code: string,
): Promise<void> {
  await zfetch(`/v2/users/${userId}/totp/verify`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function deleteTotpFactor(userId: string): Promise<void> {
  await zfetch(`/v2/users/${userId}/totp`, { method: "DELETE" });
}

// ---- Passkeys (WebAuthn) ---------------------------------------------------

export type StartPasskeyResponse = {
  passkeyId: string;
  publicKeyCredentialCreationOptions: {
    publicKey?: {
      challenge?: string;
      user?: { id?: string; name?: string; displayName?: string };
      rp?: { id?: string; name?: string };
      pubKeyCredParams?: Array<{ type: string; alg: number }>;
      timeout?: number;
      attestation?: string;
      excludeCredentials?: Array<{ type: string; id: string }>;
      authenticatorSelection?: {
        authenticatorAttachment?: string;
        residentKey?: string;
        requireResidentKey?: boolean;
        userVerification?: string;
      };
    };
    // Some Zitadel responses inline the options without the publicKey wrapper.
    challenge?: string;
    user?: { id?: string; name?: string; displayName?: string };
    rp?: { id?: string; name?: string };
    pubKeyCredParams?: Array<{ type: string; alg: number }>;
    timeout?: number;
    attestation?: string;
    excludeCredentials?: Array<{ type: string; id: string }>;
    authenticatorSelection?: {
      authenticatorAttachment?: string;
      residentKey?: string;
      requireResidentKey?: boolean;
      userVerification?: string;
    };
  };
};

/** Starts passkey registration. The backend proxy injects `domain` (the request
 *  Host) so the WebAuthN RP id always matches grown's own origin. */
export function startPasskeyRegistration(
  userId: string,
): Promise<StartPasskeyResponse> {
  return zfetch<StartPasskeyResponse>(`/v2/users/${userId}/passkeys`, {
    method: "POST",
    body: "{}",
  });
}

export async function verifyPasskeyRegistration(
  userId: string,
  passkeyId: string,
  credential: PublicKeyCredential,
  passkeyName: string,
): Promise<void> {
  await zfetch(`/v2/users/${userId}/passkeys/${passkeyId}`, {
    method: "POST",
    body: JSON.stringify({
      publicKeyCredential: serializeAttestationResponse(credential),
      passkeyName,
    }),
  });
}

export async function deletePasskey(
  userId: string,
  passkeyId: string,
): Promise<void> {
  await zfetch(`/v2/users/${userId}/passkeys/${passkeyId}`, {
    method: "DELETE",
  });
}
