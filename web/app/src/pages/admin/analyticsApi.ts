// analyticsApi.ts — fetch client for GET /api/v1/admin/analytics.
// Mirrors the other admin API modules (usersApi, auditApi, orgApi): plain
// fetch, no SDK, errors as typed exceptions.

export class AnalyticsForbiddenError extends Error {
  constructor() {
    super("admin privileges required");
    this.name = "AnalyticsForbiddenError";
  }
}

export interface UserStats {
  total_members: number;
  total_admins: number;
  active_last_7_days: number;
  active_last_30_days: number;
  /** Whether a public demo user is configured (GROWN_DEMO_USERNAME set). */
  demo_configured: boolean;
  /** Distinct IPs that have signed in as the demo user. */
  demo_unique_ips: number;
}

export interface StorageStats {
  drive_bytes: number;
  photo_bytes: number;
  video_bytes: number;
  music_bytes: number;
  mail_attachment_bytes: number;
  total_bytes: number;
}

export interface AppStats {
  drive_files: number;
  drive_files_new_7d: number;
  docs: number;
  docs_new_7d: number;
  sheets: number;
  sheets_new_7d: number;
  slides: number;
  slides_new_7d: number;
  whiteboards: number;
  whiteboards_new_7d: number;
  keep_notes: number;
  keep_notes_new_7d: number;
  calendar_events: number;
  calendar_events_new_7d: number;
  contacts: number;
  contacts_new_7d: number;
  mail_messages: number;
  mail_messages_new_7d: number;
  photos: number;
  photos_new_7d: number;
  videos: number;
  videos_new_7d: number;
  music_tracks: number;
  music_tracks_new_7d: number;
  books: number;
  books_new_7d: number;
  sites: number;
  sites_new_7d: number;
  groups: number;
  groups_new_7d: number;
  project_issues: number;
  project_issues_new_7d: number;
  forms: number;
  forms_new_7d: number;
  meet_rooms: number;
  live_streams: number;
  chat_channels: number;
  chat_messages: number;
}

export interface AnalyticsResponse {
  org_id: string;
  collected_at: string;
  users: UserStats;
  storage: StorageStats;
  apps: AppStats;
}

export async function getAnalytics(): Promise<AnalyticsResponse> {
  const res = await fetch("/api/v1/admin/analytics", {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (res.status === 403) throw new AnalyticsForbiddenError();
  if (!res.ok) {
    let msg = `analytics fetch failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json() as Promise<AnalyticsResponse>;
}

/** formatBytes converts a byte count to a human-readable string (KiB/MiB/GiB). */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}
