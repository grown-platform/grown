// API client for the Admin console's Org settings, Branding, and Sessions
// sections. Talks to the admin-gated, org-scoped handler at /api/v1/admin/org*,
// /api/v1/admin/sessions*, plus the member routes /api/v1/org/branding and
// /api/v1/me/sessions. Plain fetch, same-origin credentials — mirrors ./api.ts.

/** Raised when the backend denies the caller admin privileges (HTTP 403). */
export class ForbiddenError extends Error {
  constructor() {
    super("admin privileges required");
    this.name = "ForbiddenError";
  }
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  if (resp.status === 403) throw new ForbiddenError();
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  return (await resp.json()) as T;
}

// ---- Org rename ------------------------------------------------------------

export interface OrgIdentity {
  id: string;
  slug: string;
  display_name: string;
}

/** Rename the caller's org (display_name). Slug stays stable server-side. */
export async function renameOrg(displayName: string): Promise<OrgIdentity> {
  const r = await jsonFetch<{ org: OrgIdentity }>("/api/v1/admin/org", {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  });
  return r.org;
}

// ---- Branding --------------------------------------------------------------

export interface BrandingInfo {
  accent_color: string;
  has_logo: boolean;
  product_name: string;
}

/** Fetch the org's branding for editing (admin route). */
export async function getAdminBranding(): Promise<BrandingInfo> {
  return jsonFetch<BrandingInfo>("/api/v1/admin/org/branding");
}

/** Fetch the active org branding for the SPA at load (any member). */
export async function getActiveBranding(): Promise<BrandingInfo> {
  return jsonFetch<BrandingInfo>("/api/v1/org/branding");
}

/** Set (or clear, with "") the org's accent color. */
export async function setAccentColor(accentColor: string): Promise<void> {
  await jsonFetch("/api/v1/admin/org/branding", {
    method: "PATCH",
    body: JSON.stringify({ accent_color: accentColor }),
  });
}

/** Set (or clear, with "") the org's product name (the top-left brand label). */
export async function setProductName(productName: string): Promise<void> {
  await jsonFetch("/api/v1/admin/org/branding", {
    method: "PATCH",
    body: JSON.stringify({ product_name: productName }),
  });
}

/** Upload a logo image (multipart). Returns the updated branding info. */
export async function uploadLogo(file: File): Promise<BrandingInfo> {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch("/api/v1/admin/org/branding/logo", {
    method: "POST",
    credentials: "same-origin",
    body: form, // browser sets multipart Content-Type + boundary
  });
  if (resp.status === 403) throw new ForbiddenError();
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return getAdminBranding();
}

/** Remove the org's logo. */
export async function clearLogo(): Promise<void> {
  await jsonFetch("/api/v1/admin/org/branding/logo", { method: "DELETE" });
}

/** Absolute URL of the org's logo blob (cache-busted by the caller via a key). */
export const ORG_LOGO_URL = "/api/v1/org/branding/logo";

// ---- Sessions --------------------------------------------------------------

export interface SessionRow {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  created_at: string;
  expires_at: string;
  last_seen_at?: string;
  ip: string;
  user_agent: string;
  active: boolean;
  revoked: boolean;
  current: boolean;
}

/** List every session in the caller's org (admin). */
export async function listOrgSessions(): Promise<SessionRow[]> {
  const r = await jsonFetch<{ sessions: SessionRow[] }>(
    "/api/v1/admin/sessions",
  );
  return r.sessions ?? [];
}

/** Revoke a session by its public id (admin, org-scoped). */
export async function revokeOrgSession(id: string): Promise<void> {
  await jsonFetch(`/api/v1/admin/sessions/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
  });
}

/** List the caller's own sessions (any member). */
export async function listOwnSessions(): Promise<SessionRow[]> {
  const r = await jsonFetch<{ sessions: SessionRow[] }>("/api/v1/me/sessions");
  return r.sessions ?? [];
}

/** Sign out one of the caller's own devices. */
export async function revokeOwnSession(id: string): Promise<void> {
  await jsonFetch(`/api/v1/me/sessions/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
  });
}
