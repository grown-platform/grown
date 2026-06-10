import type {
  Extension,
  DirectoryEntry,
  ListDirectoryResponse,
  CallRecord,
  ListCallHistoryResponse,
} from "./types";

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

/** Returns the caller's extension, provisioning one on first access. */
export function getMyExtension(): Promise<Extension> {
  return jsonFetch<Extension>("/telephony/extension");
}

/** Lists org members (excluding self) with extension + online status. */
export async function listDirectory(): Promise<DirectoryEntry[]> {
  const r = await jsonFetch<ListDirectoryResponse>("/telephony/directory");
  return r.entries ?? [];
}

/** Lists the caller's recent calls. */
export async function listCallHistory(): Promise<CallRecord[]> {
  const r = await jsonFetch<ListCallHistoryResponse>("/telephony/calls");
  return r.calls ?? [];
}

/** Outcome logged when a call ends. */
export interface LogCallInput {
  peer_id: string;
  direction: "outgoing" | "incoming";
  status: "completed" | "missed" | "rejected";
  started_at: string;
  ended_at: string;
}

/** Records a finished call in the call history. Best-effort; never throws. */
export async function logCall(input: LogCallInput): Promise<void> {
  try {
    await fetch(`${API_BASE}/telephony/calls/log`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    // Logging is non-critical — ignore failures.
  }
}

/** Opens a WebSocket to the telephony signaling hub. */
export function openSignalSocket(): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(
    `${proto}://${window.location.host}/api/v1/telephony/connect`,
  );
}
