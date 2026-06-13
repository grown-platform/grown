// API client for the game-room multiplayer admin control plane
// (internal/gamerooms admin handler, mounted at /api/v1/gamerooms/admin/*).
// Every endpoint is admin-gated server-side; these helpers are only invoked
// from the admin panel, which is itself shown only to admins.

const BASE = "/api/v1/gamerooms/admin";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    ...init,
  });
  if (!resp.ok) {
    let msg = `Request failed (${resp.status})`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // non-JSON error body — keep the status-code message
    }
    throw new Error(msg);
  }
  return (await resp.json()) as T;
}

export interface MultiplayerSettings {
  enabled: boolean;
  updated_at: string;
  updated_by: string;
}

export interface SessionPlayer {
  id: string;
  name: string;
  joined_at: string;
}

export interface SessionInfo {
  code: string;
  game: string;
  players: SessionPlayer[];
  player_count: number;
  has_password: boolean;
  listed: boolean;
  created_at: string;
  age_sec: number;
}

export interface AuditEvent {
  id: string;
  event: string;
  room: string;
  game: string;
  peer_id: string;
  peer_name: string;
  actor_email: string;
  detail?: Record<string, unknown>;
  created_at: string;
}

export function getSettings(): Promise<MultiplayerSettings> {
  return req<MultiplayerSettings>("/settings");
}

export function setEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
  return req<{ enabled: boolean }>("/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export function getSessions(): Promise<{ enabled: boolean; sessions: SessionInfo[] }> {
  return req<{ enabled: boolean; sessions: SessionInfo[] }>("/sessions");
}

/** Kick a whole room (omit peerId) or a single peer. */
export function kick(room: string, peerId?: string): Promise<unknown> {
  return req("/kick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room, peer_id: peerId ?? "" }),
  });
}

export function getAudit(filter: {
  event?: string;
  room?: string;
  limit?: number;
}): Promise<{ events: AuditEvent[] }> {
  const q = new URLSearchParams();
  if (filter.event) q.set("event", filter.event);
  if (filter.room) q.set("room", filter.room);
  if (filter.limit) q.set("limit", String(filter.limit));
  const qs = q.toString();
  return req<{ events: AuditEvent[] }>(`/audit${qs ? `?${qs}` : ""}`);
}
