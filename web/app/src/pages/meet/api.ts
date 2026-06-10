import type { MeetRoom, ListMeetRoomsResponse } from "./types";

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

export async function listRooms(): Promise<MeetRoom[]> {
  const r = await jsonFetch<ListMeetRoomsResponse>("/meet/rooms");
  return r.rooms ?? [];
}

export function createRoom(name: string): Promise<MeetRoom> {
  return jsonFetch<MeetRoom>("/meet/rooms", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function deleteRoom(id: string): Promise<void> {
  await jsonFetch<unknown>(`/meet/rooms/${id}`, { method: "DELETE" });
}

/**
 * createMeeting creates a new meeting via the codes surface and returns a
 * MeetRoom with a `code` field (e.g. "abc-defg-hij").
 */
export function createMeeting(name: string): Promise<MeetRoom> {
  return jsonFetch<MeetRoom>("/meet/codes", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/**
 * resolveCode resolves a short meeting code to a MeetRoom, or throws on
 * 404 (code not found) / 400 (invalid format).
 */
export function resolveCode(code: string): Promise<MeetRoom> {
  return jsonFetch<MeetRoom>(`/meet/codes/${encodeURIComponent(code)}`);
}

/** Opens a WebSocket for signaling in a Meet room. */
export function openSignalSocket(roomId: string): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(
    `${proto}://${window.location.host}/api/v1/meet/rooms/${roomId}/connect`,
  );
}

/** Returns the shareable link for a meeting code. */
export function meetingLink(code: string): string {
  return `${window.location.origin}/meet/${code}`;
}
