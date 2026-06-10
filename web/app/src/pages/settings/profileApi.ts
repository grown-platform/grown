// API client for the self-service Profile editor at /api/v1/me/profile.
// Talks to internal/profile.Handler — GET reads current values from Zitadel,
// PATCH writes changed fields back (email changes trigger a verification email).

export interface ProfileData {
  given_name: string;
  family_name: string;
  username: string;
  phone: string;
  phone_verified: boolean;
  email: string;
  email_verified: boolean;
}

export interface PatchProfileInput {
  given_name?: string;
  family_name?: string;
  username?: string;
  phone?: string;
  email?: string;
}

export interface PatchProfileResult {
  ok: boolean;
  email_verification_sent?: boolean;
  email?: string;
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(msg) as Error & { status: number };
    err.status = resp.status;
    throw err;
  }
  return (await resp.json()) as T;
}

/** Fetch the caller's current profile from Zitadel. */
export async function getProfile(): Promise<ProfileData> {
  return jsonFetch<ProfileData>("/api/v1/me/profile");
}

/**
 * Apply a partial profile update to Zitadel.
 * - Email changes cause Zitadel to send a verification link (isEmailVerified:false).
 * - Username conflicts return a 409 — callers should check err.status === 409.
 */
export async function patchProfile(
  input: PatchProfileInput,
): Promise<PatchProfileResult> {
  return jsonFetch<PatchProfileResult>("/api/v1/me/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
