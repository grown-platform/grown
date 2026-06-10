const API_BASE = "/api/v1";

export interface Notification {
  id: string;
  org_id: string;
  user_id: string;
  type: string;
  actor_user_id: string;
  title: string;
  body: string;
  target_url: string;
  read: boolean;
  created_at: string;
}

export interface ListNotificationsResponse {
  notifications: Notification[];
  next_page_token: string;
}

export interface UnreadCountResponse {
  count: number;
}

/** Fetch the latest notifications (newest first). */
export async function listNotifications(
  pageToken?: string,
  pageSize = 20,
): Promise<ListNotificationsResponse> {
  const params = new URLSearchParams();
  if (pageToken) params.set("page_token", pageToken);
  params.set("page_size", String(pageSize));
  const resp = await fetch(`${API_BASE}/notifications?${params}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`listNotifications: HTTP ${resp.status}`);
  return resp.json() as Promise<ListNotificationsResponse>;
}

/** Fetch the unread notification count. */
export async function unreadCount(): Promise<number> {
  const resp = await fetch(`${API_BASE}/notifications/unread-count`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`unreadCount: HTTP ${resp.status}`);
  const data = (await resp.json()) as UnreadCountResponse;
  // The gateway emits the int64 as a string (EmitUnpopulated=true + int64 JSON = string).
  return typeof data.count === "string"
    ? parseInt(data.count, 10)
    : (data.count ?? 0);
}

/** Mark a single notification as read. */
export async function markRead(id: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/notifications/${id}/read`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!resp.ok) throw new Error(`markRead: HTTP ${resp.status}`);
}

/** Mark all notifications as read. */
export async function markAllRead(): Promise<void> {
  const resp = await fetch(`${API_BASE}/notifications/read-all`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!resp.ok) throw new Error(`markAllRead: HTTP ${resp.status}`);
}

/** Delete a notification. */
export async function deleteNotification(id: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/notifications/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!resp.ok) throw new Error(`deleteNotification: HTTP ${resp.status}`);
}

/** Returns a human-readable relative time string (e.g. "3 minutes ago"). */
export function relativeTime(isoString: string): string {
  const then = new Date(isoString).getTime();
  const diffMs = Date.now() - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(isoString).toLocaleDateString();
}
