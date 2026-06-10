/**
 * API client for the Access feature — published internal apps.
 *
 * All routes live under /api/v1/access/apps.
 * GET    is available to any authenticated org member.
 * POST / PUT / DELETE require org-admin privileges (the server enforces this).
 */

export interface AccessApp {
  id: string;
  org_id: string;
  name: string;
  url: string;
  description: string;
  icon: string;
  created_by: string;
  created_at: string;
}

export interface AccessAppInput {
  name: string;
  url: string;
  description?: string;
  icon?: string;
}

const BASE = "/api/v1/access/apps";

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

/** List all published apps registered for the caller's org. */
export async function listAccessApps(): Promise<AccessApp[]> {
  const data = await req<{ apps: AccessApp[] }>("GET", BASE);
  return data.apps ?? [];
}

/** Register a new published app (admin only). */
export async function createAccessApp(
  input: AccessAppInput,
): Promise<AccessApp> {
  return req<AccessApp>("POST", BASE, input);
}

/** Update a published app by id (admin only). */
export async function updateAccessApp(
  id: string,
  input: AccessAppInput,
): Promise<AccessApp> {
  return req<AccessApp>("PUT", `${BASE}/${id}`, input);
}

/** Delete a published app by id (admin only). */
export async function deleteAccessApp(id: string): Promise<void> {
  await req<unknown>("DELETE", `${BASE}/${id}`);
}
