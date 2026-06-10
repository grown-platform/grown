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

export interface UserPreferences {
  user_id: string;
  org_id: string;
  language: string;
  density: string;
  default_app: string;
  date_format: string;
  time_format: string;
  week_start: string;
  email_notifications: boolean;
  extra: string;
  updated_at: string;
}

export type PreferencesUpdate = Partial<
  Omit<UserPreferences, "user_id" | "org_id" | "updated_at">
> & {
  update_mask?: string[];
};

export function getPreferences(): Promise<UserPreferences> {
  return jsonFetch<UserPreferences>("/me/preferences");
}

export function updatePreferences(
  input: PreferencesUpdate,
): Promise<UserPreferences> {
  return jsonFetch<UserPreferences>("/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
