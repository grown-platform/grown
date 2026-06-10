// WebAuthn helpers for passkey registration against the Zitadel User API v2
// (proxied through grown's backend). Zitadel encodes the binary challenge/id
// fields as base64url strings; the browser WebAuthn API needs ArrayBuffers, so
// we transcode at the boundary.

import type { StartPasskeyResponse } from "../api/security";

/** base64url string → ArrayBuffer (challenge, credential ids, user handle). */
export function base64UrlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  const binary = atob(base64 + "=".repeat(padLen));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** ArrayBuffer → base64url string (for serializing the attestation response). */
export function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Transform Zitadel's credential-creation options into the browser-native
 *  shape accepted by navigator.credentials.create(). */
export function transformCredentialCreationOptions(
  zitadelOptions: StartPasskeyResponse["publicKeyCredentialCreationOptions"],
): PublicKeyCredentialCreationOptions {
  const options = zitadelOptions.publicKey ?? zitadelOptions;
  if (!options.challenge || !options.user?.id) {
    throw new Error("Invalid credential options received from server");
  }
  return {
    challenge: base64UrlToBuffer(options.challenge),
    rp: options.rp as PublicKeyCredentialRpEntity,
    user: {
      id: base64UrlToBuffer(options.user.id),
      name: options.user.name ?? "",
      displayName: options.user.displayName ?? "",
    },
    pubKeyCredParams: (options.pubKeyCredParams ??
      []) as PublicKeyCredentialParameters[],
    timeout: options.timeout,
    attestation: options.attestation as
      | AttestationConveyancePreference
      | undefined,
    excludeCredentials: options.excludeCredentials?.map((cred) => ({
      type: cred.type as PublicKeyCredentialType,
      id: base64UrlToBuffer(cred.id),
    })),
    authenticatorSelection: options.authenticatorSelection as
      | AuthenticatorSelectionCriteria
      | undefined,
  };
}

/** Serialize a registration credential (attestation) for the verify call. */
export function serializeAttestationResponse(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    type: credential.type,
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      attestationObject: arrayBufferToBase64Url(response.attestationObject),
    },
  };
}
