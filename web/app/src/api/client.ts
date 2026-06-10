import type {
  WhoamiResponse,
  WhoamiResult,
  SearchResponse,
  AccountInfo,
  DemoLoginCapability,
} from "./types";

const API_BASE = "/api/v1";

/** loginURL returns the backend URL that initiates the OIDC flow. */
export function loginURL(): string {
  return `${API_BASE}/auth/login`;
}

/**
 * demoLoginCapability probes the backend to see whether the demo-login button
 * should be shown. Returns null when the endpoint is unavailable or demo mode
 * is disabled, so callers can safely hide the button without error handling.
 */
export async function demoLoginCapability(): Promise<DemoLoginCapability | null> {
  try {
    const resp = await fetch(`${API_BASE}/auth/demo-login`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as DemoLoginCapability;
    return data.enabled ? data : null;
  } catch {
    return null;
  }
}

/**
 * whoami fetches the currently-authenticated user. Returns a discriminated
 * union so callers can pattern-match on the auth state explicitly rather
 * than throwing on 401 (which is a normal flow control case).
 */
export async function whoami(): Promise<WhoamiResult> {
  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/whoami`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }
  if (resp.status === 401) return { status: "unauthenticated" };
  if (!resp.ok) {
    return { status: "error", message: `HTTP ${resp.status}` };
  }
  const data = (await resp.json()) as WhoamiResponse;
  return { status: "ok", data };
}

/**
 * search performs a unified cross-app search within the caller's org.
 * Returns grouped results across Drive, Docs, Sheets, Slides, Contacts,
 * Keep, Calendar, and Mail.
 */
export async function search(
  query: string,
  limit = 50,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ query, limit: String(limit) });
  const resp = await fetch(`${API_BASE}/search?${params}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`search failed: HTTP ${resp.status}`);
  }
  return resp.json() as Promise<SearchResponse>;
}

/** logout revokes the current session. Success-on-200 only — callers may
 *  refresh the page or navigate away afterwards. */
export async function logout(): Promise<void> {
  const resp = await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!resp.ok) {
    throw new Error(`logout failed: HTTP ${resp.status}`);
  }
}

// ── Avatar ─────────────────────────────────────────────────────────────────

/** Upload a new avatar. `file` is the selected image File. Returns the avatar URL. */
export async function uploadAvatar(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`${API_BASE}/me/avatar`, {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  if (!resp.ok) {
    const err = await resp
      .json()
      .catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as { avatar_url?: string };
  return data.avatar_url ?? `${API_BASE}/me/avatar`;
}

/** Delete the current user's avatar. */
export async function deleteAvatar(): Promise<void> {
  const resp = await fetch(`${API_BASE}/me/avatar`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!resp.ok) throw new Error(`delete avatar failed: HTTP ${resp.status}`);
}

// ── Multi-account switching ─────────────────────────────────────────────────

/** List all accounts the browser has signed into. */
export async function listAccounts(): Promise<AccountInfo[]> {
  const resp = await fetch(`${API_BASE}/me/accounts`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) return [];
  const data = (await resp.json()) as { accounts?: AccountInfo[] };
  return data.accounts ?? [];
}

/** Switch to a different signed-in account (no OIDC redirect). Resolves on success. */
export async function activateAccount(sessionId: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/me/accounts/${sessionId}/activate`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!resp.ok) throw new Error(`activate account failed: HTTP ${resp.status}`);
}

/** Remove one account from this browser's list, optionally signing it out. */
export async function removeAccount(
  sessionId: string,
): Promise<{ signed_out: boolean }> {
  const resp = await fetch(`${API_BASE}/me/accounts/${sessionId}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!resp.ok) throw new Error(`remove account failed: HTTP ${resp.status}`);
  return resp.json() as Promise<{ signed_out: boolean }>;
}
