import type { Sheet, ListSheetsResponse } from "./types";
import type { ObjectGrant } from "../../api/directory";

const API_BASE = "/api/v1";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

export async function listSheets(): Promise<Sheet[]> {
  const r = await jsonFetch<ListSheetsResponse>("/sheets");
  return r.sheets ?? [];
}

export function createSheet(title = ""): Promise<Sheet> {
  return jsonFetch<Sheet>("/sheets", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function getSheet(id: string): Promise<Sheet> {
  return jsonFetch<Sheet>(`/sheets/d/${id}`);
}

export function renameSheet(id: string, title: string): Promise<Sheet> {
  return jsonFetch<Sheet>(`/sheets/d/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function trashSheet(id: string): Promise<void> {
  await jsonFetch<unknown>(`/sheets/d/${id}`, { method: "DELETE" });
}

/** saveSheet persists the workbook JSON (autosaved by the editor). */
export async function saveSheet(id: string, data: string): Promise<void> {
  await jsonFetch<unknown>(`/sheets/d/${id}/data`, {
    method: "PUT",
    body: JSON.stringify({ data }),
  });
}

/** collabURL returns the WebSocket URL for a sheet's live-ops channel. */
export function collabURL(id: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/v1/sheets/d/${id}/connect`;
}

// ---- Per-user ACL grants (object_grants) ----

/** listSheetGrants returns the per-user grants on a sheet. */
export async function listSheetGrants(sheetId: string): Promise<ObjectGrant[]> {
  const r = await jsonFetch<{ grants?: ObjectGrant[] }>(
    `/sheets/d/${sheetId}/grants`,
  );
  return r.grants ?? [];
}

/** grantSheetAccess shares a sheet with a grown user at a role. */
export function grantSheetAccess(
  sheetId: string,
  granteeUserId: string,
  role: string,
): Promise<{ grant?: ObjectGrant }> {
  return jsonFetch<{ grant?: ObjectGrant }>(`/sheets/d/${sheetId}/grants`, {
    method: "POST",
    body: JSON.stringify({ grantee_user_id: granteeUserId, role }),
  });
}

/** revokeSheetAccess removes a user's grant on a sheet. */
export async function revokeSheetAccess(
  sheetId: string,
  granteeUserId: string,
): Promise<void> {
  await jsonFetch<unknown>(`/sheets/d/${sheetId}/grants/${granteeUserId}`, {
    method: "DELETE",
  });
}

/** listSheetsSharedWithMe returns sheets shared with the caller (cross-org). */
export async function listSheetsSharedWithMe(): Promise<Sheet[]> {
  const r = await jsonFetch<{ sheets?: Sheet[] }>("/sheets/shared-with-me");
  return r.sheets ?? [];
}
