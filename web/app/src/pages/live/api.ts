import type {
  LiveStream,
  ListStreamsResponse,
  StreamFilter,
  CreateStreamInput,
  UpdateStreamInput,
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

export function createStream(input: CreateStreamInput): Promise<LiveStream> {
  return jsonFetch<LiveStream>("/live/streams", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listStreams(
  filter: StreamFilter = "all",
): Promise<LiveStream[]> {
  const r = await jsonFetch<ListStreamsResponse>(
    `/live/streams?filter=${encodeURIComponent(filter)}`,
  );
  return r.streams ?? [];
}

export function getStream(id: string): Promise<LiveStream> {
  return jsonFetch<LiveStream>(`/live/streams/${id}`);
}

export function updateStream(
  id: string,
  input: UpdateStreamInput,
): Promise<LiveStream> {
  return jsonFetch<LiveStream>(`/live/streams/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteStream(id: string): Promise<void> {
  await jsonFetch<unknown>(`/live/streams/${id}`, { method: "DELETE" });
}

export function endStream(id: string): Promise<LiveStream> {
  return jsonFetch<LiveStream>(`/live/streams/${id}/end`, {
    method: "POST",
    body: "{}",
  });
}
