// User-management API client for the Admin console's "Users" section. Talks to
// the admin-gated handler at /api/v1/admin/users*, which proxies the Zitadel
// User API v2 with a service PAT. Plain fetch, same-origin credentials — mirrors
// ./api.ts (the service-toggle client).

const API_BASE = "/api/v1/admin/users";

/** A user as returned by the admin-users handler (flattened Zitadel shape). */
export interface AdminUser {
  id: string;
  username: string;
  givenName: string;
  familyName: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  /** Raw Zitadel state, e.g. "USER_STATE_ACTIVE" / "USER_STATE_INACTIVE". */
  state: string;
  /** True when this user holds the per-org admin role (an org_admins grant).
   *  Computed server-side by joining the Zitadel id to a grown user. */
  isAdmin: boolean;
}

/** Payload for creating a human user. */
export interface CreateUserInput {
  username?: string;
  givenName: string;
  familyName: string;
  email: string;
  /** Secondary address for account recovery + invite delivery (the workspace
   *  mailbox often doesn't exist yet). Stored as Zitadel metadata. */
  recoveryEmail?: string;
  /** Optional initial password (forces change on first login). */
  password?: string;
  /** When true, the email is left unverified so Zitadel can send an invite. */
  sendInvite?: boolean;
}

/** Result of GET /api/v1/admin/whoami — drives admin-only UI affordances. */
export interface AdminWhoAmI {
  isAdmin: boolean;
  /** Bootstrap super-admin (email in GROWN_ADMIN_EMAILS). Stronger than isAdmin;
   *  gates the destructive whole-IdP "Delete from Zitadel" action. */
  isSuperAdmin: boolean;
  /** True when the caller's org is a single-user (personal) org — the Admin app
   *  is hidden entirely in that case. */
  isPersonal: boolean;
  userMgmtEnabled: boolean;
}

/** Reports whether the current user may manage users (non-gated; any member). */
export async function adminWhoAmI(): Promise<AdminWhoAmI> {
  const resp = await fetch("/api/v1/admin/whoami", {
    credentials: "same-origin",
  });
  if (!resp.ok)
    return {
      isAdmin: false,
      isSuperAdmin: false,
      isPersonal: false,
      userMgmtEnabled: false,
    };
  return (await resp.json()) as AdminWhoAmI;
}

/** Partial profile/email update. Only provided fields are changed. */
export interface UpdateUserInput {
  username?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
}

/** Raised when the backend reports the Zitadel service token is unconfigured. */
export class ServiceTokenMissingError extends Error {
  constructor() {
    super("user management requires GROWN_ZITADEL_SERVICE_TOKEN");
    this.name = "ServiceTokenMissingError";
  }
}

/** Raised when the caller lacks admin privileges (403). */
export class ForbiddenError extends Error {
  constructor(message = "admin privileges required") {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  if (resp.status === 503) throw new ServiceTokenMissingError();
  if (resp.status === 403) {
    const body = await resp.json().catch(() => null);
    throw new ForbiddenError(body?.error ?? undefined);
  }
  if (!resp.ok) {
    // Surface the backend's {error} message when present.
    const body = await resp.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${resp.status}`);
  }
  // Some endpoints return {ok:true}; callers that ignore the body still work.
  return (await resp.json().catch(() => ({}))) as T;
}

/** Search/list the org's users. `q` filters by name/email/username (contains). */
export async function listUsers(q = ""): Promise<AdminUser[]> {
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  const r = await request<{ users: AdminUser[] }>(qs);
  return r.users ?? [];
}

/** Create a human user; resolves to the new user id. */
export async function createUser(input: CreateUserInput): Promise<string> {
  const r = await request<{ id: string }>("", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return r.id;
}

/** Update a user's profile/email. */
export async function updateUser(
  id: string,
  input: UpdateUserInput,
): Promise<void> {
  await request<{ ok: boolean }>(`/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** Deactivate a user (blocks login, preserves data). */
export async function deactivateUser(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/${encodeURIComponent(id)}/deactivate`, {
    method: "POST",
  });
}

/** Reactivate a previously deactivated user. */
export async function reactivateUser(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/${encodeURIComponent(id)}/reactivate`, {
    method: "POST",
  });
}

/** Set a new password, or (with empty password) trigger a reset code/email.
 *  Returns any verification code Zitadel hands back for manual relay. */
export async function setPassword(
  id: string,
  password = "",
): Promise<string | undefined> {
  const r = await request<{ ok: boolean; verificationCode?: string }>(
    `/${encodeURIComponent(id)}/password`,
    { method: "POST", body: JSON.stringify({ password }) },
  );
  return r.verificationCode || undefined;
}

/** Remove a user from THIS org only: deletes their grown membership row (and any
 *  org-admin grant). Does NOT delete their Zitadel/IdP account — they keep their
 *  login and any membership in other orgs. */
export async function removeFromOrg(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Hard-delete a user's entire Zitadel/IdP account (irreversible, affects every
 *  org). Super-admin only server-side; a plain org-admin gets 403. */
export async function hardDeleteUser(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/${encodeURIComponent(id)}/zitadel`, {
    method: "DELETE",
  });
}

/** Raised when revoking would remove the org's last admin (HTTP 409). */
export class LastAdminError extends Error {
  constructor(message = "cannot remove the last admin of the org") {
    super(message);
    this.name = "LastAdminError";
  }
}

/** Grant the per-org admin role to a user (by Zitadel id). */
export async function grantAdmin(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/${encodeURIComponent(id)}/admin`, {
    method: "POST",
  });
}

/** Revoke the per-org admin role from a user. Throws LastAdminError on 409. */
export async function revokeAdmin(id: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/${encodeURIComponent(id)}/admin`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (resp.status === 409) {
    const body = await resp.json().catch(() => null);
    throw new LastAdminError(body?.error ?? undefined);
  }
  if (resp.status === 403) {
    const body = await resp.json().catch(() => null);
    throw new ForbiddenError(body?.error ?? undefined);
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${resp.status}`);
  }
}

/** Toggle the admin role for a user, returning the new isAdmin state. */
export async function setAdmin(id: string, next: boolean): Promise<boolean> {
  if (next) await grantAdmin(id);
  else await revokeAdmin(id);
  return next;
}

/** True when the Zitadel state string denotes an active account. */
export function isActive(state: string): boolean {
  return state === "USER_STATE_ACTIVE";
}

/** Human-friendly name for a user row. */
export function userLabel(u: AdminUser): string {
  const full = `${u.givenName} ${u.familyName}`.trim();
  return u.displayName || full || u.username || u.email;
}
