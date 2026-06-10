import type {
  Whiteboard,
  ListWhiteboardsResponse,
  ListWhiteboardsSharedWithMeResponse,
} from "./types";
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

export async function listWhiteboards(): Promise<Whiteboard[]> {
  const r = await jsonFetch<ListWhiteboardsResponse>("/whiteboards");
  return r.whiteboards ?? [];
}

export function createWhiteboard(title = ""): Promise<Whiteboard> {
  return jsonFetch<Whiteboard>("/whiteboards", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function getWhiteboard(id: string): Promise<Whiteboard> {
  return jsonFetch<Whiteboard>(`/whiteboards/d/${id}`);
}

export function renameWhiteboard(
  id: string,
  title: string,
): Promise<Whiteboard> {
  return jsonFetch<Whiteboard>(`/whiteboards/d/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function trashWhiteboard(id: string): Promise<void> {
  await jsonFetch<unknown>(`/whiteboards/d/${id}`, { method: "DELETE" });
}

/** saveWhiteboard persists the scene JSON (autosaved by the editor). */
export async function saveWhiteboard(id: string, data: string): Promise<void> {
  await jsonFetch<unknown>(`/whiteboards/d/${id}/data`, {
    method: "PUT",
    body: JSON.stringify({ data }),
  });
}

/** collabURL returns the WebSocket URL for a board's live-scene channel. */
export function collabURL(id: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/v1/whiteboards/d/${id}/connect`;
}

// ---- Per-user ACL grants (object_grants) ----

/** listBoardGrants returns the per-user grants on a whiteboard. */
export async function listBoardGrants(boardId: string): Promise<ObjectGrant[]> {
  const r = await jsonFetch<{ grants?: ObjectGrant[] }>(
    `/whiteboards/d/${boardId}/grants`,
  );
  return r.grants ?? [];
}

/** grantBoardAccess grants a user a role on a whiteboard. */
export function grantBoardAccess(
  boardId: string,
  granteeUserId: string,
  role: string,
): Promise<{ grant?: ObjectGrant }> {
  return jsonFetch<{ grant?: ObjectGrant }>(
    `/whiteboards/d/${boardId}/grants`,
    {
      method: "POST",
      body: JSON.stringify({
        board_id: boardId,
        grantee_user_id: granteeUserId,
        role,
      }),
    },
  );
}

/** revokeBoardAccess removes a user's grant from a whiteboard. */
export async function revokeBoardAccess(
  boardId: string,
  granteeUserId: string,
): Promise<void> {
  await jsonFetch<unknown>(
    `/whiteboards/d/${boardId}/grants/${granteeUserId}`,
    { method: "DELETE" },
  );
}

/** listWhiteboardsSharedWithMe returns whiteboards shared with the caller (cross-org). */
export async function listWhiteboardsSharedWithMe(): Promise<Whiteboard[]> {
  const r = await jsonFetch<ListWhiteboardsSharedWithMeResponse>(
    "/whiteboards/shared-with-me",
  );
  return r.whiteboards ?? [];
}
