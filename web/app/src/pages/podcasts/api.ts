/**
 * Podcasts API — typed wrappers over the grown podcasts backend. Mirrors the
 * music/api.ts jsonFetch pattern. All routes are auth-walled (same-origin
 * session cookie).
 */
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

export interface Subscription {
  id: string;
  org_id: string;
  user_id: string;
  feed_url: string;
  title: string;
  author: string;
  artwork_url: string;
  created_at: string;
}

export interface Episode {
  guid: string;
  title: string;
  description: string;
  audio_url: string;
  duration: string;
  published: string; // RFC3339 or ""
  image: string;
}

export interface Feed {
  title: string;
  author: string;
  image: string;
  episodes: Episode[];
}

export interface SubscribeInput {
  feed_url: string;
  title?: string;
  author?: string;
  artwork_url?: string;
}

export async function listSubscriptions(): Promise<Subscription[]> {
  const r = await jsonFetch<{ subscriptions?: Subscription[] }>(
    "/podcasts/subscriptions",
  );
  return r.subscriptions ?? [];
}

export async function subscribe(input: SubscribeInput): Promise<Subscription> {
  const r = await jsonFetch<{ subscription: Subscription }>(
    "/podcasts/subscriptions",
    { method: "POST", body: JSON.stringify(input) },
  );
  return r.subscription;
}

export async function unsubscribe(id: string): Promise<void> {
  await jsonFetch<unknown>(`/podcasts/subscriptions/${id}`, {
    method: "DELETE",
  });
}

/** getFeed fetches + parses an RSS feed through grown's SSRF-guarded proxy. */
export function getFeed(url: string): Promise<Feed> {
  return jsonFetch<Feed>(`/podcasts/feed?url=${encodeURIComponent(url)}`);
}
