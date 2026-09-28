import { useEffect, useState } from "react";
import type { AppTile } from "./apps";

/** One per-org service setting as returned by GET /api/v1/admin/service-settings
 *  (proto snake_case via the gateway). Services absent from the list are
 *  enabled by default. The server also reports deployment-default URLs here
 *  (e.g. GROWN_HOMEASSISTANT_URL) for services the org hasn't configured. */
export interface OrgServiceSetting {
  service_id: string;
  enabled: boolean;
  external_url?: string;
}

/**
 * applyServiceSettings resolves the static catalog against an org's service
 * settings:
 *   - a non-empty external_url overrides the tile's catalog externalUrl;
 *   - bring-your-own tiles (requiresExternalUrl) are dropped unless they end
 *     up with a URL, since they have no built-in route to fall back to;
 *   - services the org disabled are dropped, except "admin" (so it can be
 *     re-enabled; callers gate the Admin tile separately).
 * `settings` of null means "not loaded / failed": built-in tiles show (fail
 * open) but bring-your-own tiles stay hidden (nothing to link to).
 */
export function applyServiceSettings(
  catalog: readonly AppTile[],
  settings: readonly OrgServiceSetting[] | null,
): AppTile[] {
  const byId = new Map((settings ?? []).map((s) => [s.service_id, s]));
  const out: AppTile[] = [];
  for (const a of catalog) {
    const s = byId.get(a.id);
    if (a.id !== "admin" && s && !s.enabled) continue;
    const url = s?.external_url?.trim();
    const tile = url ? { ...a, externalUrl: url } : a;
    if (tile.requiresExternalUrl && !tile.externalUrl) continue;
    out.push(tile);
  }
  return out;
}

// Dashboard and Header mount together; share one in-flight request between
// them. The promise is dropped once settled so the next page load/navigation
// sees fresh settings (e.g. right after an admin saves a URL).
let inflight: Promise<OrgServiceSetting[] | null> | null = null;

/** fetchServiceSettings loads the caller's org service settings; resolves to
 *  null on any error (unauthenticated, network) so callers can fail open. */
export function fetchServiceSettings(): Promise<OrgServiceSetting[] | null> {
  if (!inflight) {
    inflight = fetch("/api/v1/admin/service-settings", {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { settings?: OrgServiceSetting[] }) => d.settings ?? [])
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** useServiceSettings returns the org's service settings: undefined while
 *  loading, null if the fetch failed (or `enabled` is false, e.g. signed
 *  out), else the list. */
export function useServiceSettings(
  enabled = true,
): OrgServiceSetting[] | null | undefined {
  const [settings, setSettings] = useState<
    OrgServiceSetting[] | null | undefined
  >(undefined);
  useEffect(() => {
    if (!enabled) {
      setSettings(null);
      return;
    }
    let alive = true;
    void fetchServiceSettings().then((s) => {
      if (alive) setSettings(s);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return settings;
}
