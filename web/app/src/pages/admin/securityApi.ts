// securityApi.ts — fetch client for the Admin → Security console.
// Mirrors the other admin API modules (analyticsApi, usersApi): plain fetch,
// no SDK, errors as typed exceptions, credentials same-origin.
//
// Backend: internal/adminsecurity, mounted at /api/v1/admin/security/*. All
// routes are admin-gated server-side and org-scoped to the caller's Zitadel org
// via the resolved resourceOwner (x-zitadel-orgid) — never cross-org.

export class SecurityForbiddenError extends Error {
  constructor() {
    super("admin privileges required");
    this.name = "SecurityForbiddenError";
  }
}

/** Thrown when GROWN_ZITADEL_SERVICE_TOKEN is unset (handler returns 503). */
export class SecurityUnavailableError extends Error {
  constructor() {
    super("security policies require a Zitadel service token");
    this.name = "SecurityUnavailableError";
  }
}

export interface PasswordPolicy {
  min_length: number;
  has_uppercase: boolean;
  has_lowercase: boolean;
  has_number: boolean;
  has_symbol: boolean;
  is_default: boolean;
}

export interface LoginPolicy {
  force_mfa: boolean;
  force_mfa_local_only: boolean;
  allow_username_password: boolean;
  passwordless_type: string;
  allow_domain_discovery: boolean;
  second_factors: string[] | null;
  multi_factors: string[] | null;
  is_default: boolean;
}

export interface LockoutPolicy {
  max_password_attempts: number;
  max_otp_attempts: number;
  is_default: boolean;
}

export interface PoliciesResponse {
  org_id: string;
  collected_at: string;
  password: PasswordPolicy;
  login: LoginPolicy;
  lockout: LockoutPolicy;
  errors?: Record<string, string>;
}

export interface IDPInfo {
  id: string;
  name: string;
  type: string;
  state: string;
  owner: string;
}

export interface IDPsResponse {
  org_id: string;
  idps: IDPInfo[];
}

const BASE = "/api/v1/admin/security";

async function handle<T>(res: Response, label: string): Promise<T> {
  if (res.status === 403) throw new SecurityForbiddenError();
  if (res.status === 503) throw new SecurityUnavailableError();
  if (!res.ok) {
    let msg = `${label} failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/** Read all of the org's current Zitadel security policies in one call. */
export async function getPolicies(): Promise<PoliciesResponse> {
  const res = await fetch(`${BASE}/policies`, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  return handle<PoliciesResponse>(res, "load policies");
}

/** Read the org's configured identity providers (read-only, for SSO cards). */
export async function getIDPs(): Promise<IDPsResponse> {
  const res = await fetch(`${BASE}/idps`, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  return handle<IDPsResponse>(res, "load identity providers");
}

/** Update password complexity. Returns the freshly-read policy. */
export async function putPassword(
  p: Pick<
    PasswordPolicy,
    | "min_length"
    | "has_uppercase"
    | "has_lowercase"
    | "has_number"
    | "has_symbol"
  >,
): Promise<PasswordPolicy> {
  const res = await fetch(`${BASE}/password`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  return handle<PasswordPolicy>(res, "save password policy");
}

/** Update 2-step / MFA enforcement on the login policy. */
export async function putMFA(p: {
  force_mfa: boolean;
  force_mfa_local_only: boolean;
}): Promise<LoginPolicy> {
  const res = await fetch(`${BASE}/mfa`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  return handle<LoginPolicy>(res, "save MFA policy");
}

/** Update lockout thresholds (Login challenges). */
export async function putLockout(p: {
  max_password_attempts: number;
  max_otp_attempts: number;
}): Promise<LockoutPolicy> {
  const res = await fetch(`${BASE}/lockout`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  return handle<LockoutPolicy>(res, "save lockout policy");
}

/** Update passwordless settings on the login policy. */
export async function putPasswordless(p: {
  passwordless_type: string;
  allow_domain_discovery: boolean;
}): Promise<LoginPolicy> {
  const res = await fetch(`${BASE}/passwordless`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  return handle<LoginPolicy>(res, "save passwordless policy");
}

/** Human-readable label for a Zitadel passwordlessType enum. */
export const PASSWORDLESS_OPTIONS: { value: string; label: string }[] = [
  { value: "PASSWORDLESS_TYPE_NOT_ALLOWED", label: "Not allowed" },
  { value: "PASSWORDLESS_TYPE_ALLOWED", label: "Allowed (passkeys)" },
];
