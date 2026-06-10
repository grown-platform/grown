import type { ServiceSetting, ServiceSettings } from "./types";

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

/** Fetch the org's explicit per-service toggles. Services absent from the
 *  returned list are enabled by default. */
export async function getServiceSettings(): Promise<ServiceSetting[]> {
  const r = await jsonFetch<ServiceSettings>("/admin/service-settings");
  return r.settings ?? [];
}

/** Upsert a batch of {service_id, enabled} toggles; returns the full updated set. */
export async function setServiceSettings(
  settings: ServiceSetting[],
): Promise<ServiceSetting[]> {
  const r = await jsonFetch<ServiceSettings>("/admin/service-settings", {
    method: "PUT",
    body: JSON.stringify({ settings }),
  });
  return r.settings ?? [];
}
