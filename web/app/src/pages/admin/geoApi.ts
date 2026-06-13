// geoApi.ts — fetch client for the Admin → Region access console.
// Mirrors the other admin API modules (analyticsApi, securityApi, usersApi):
// plain fetch, no SDK, errors as typed exceptions, credentials same-origin.
//
// Backend: internal/geoaccess, mounted at /api/v1/admin/geo (GET + PUT). The
// policy is instance-level (NOT per-org) — it gates edge access to the whole
// site against Cloudflare's CF-IPCountry header. Admin-gated server-side.

export class GeoForbiddenError extends Error {
  constructor() {
    super("admin privileges required");
    this.name = "GeoForbiddenError";
  }
}

/** Policy mode. `off` disables filtering entirely (the default). */
export type GeoMode = "off" | "block" | "allow";

export interface GeoPolicy {
  mode: GeoMode;
  /** ISO 3166-1 alpha-2 codes (upper-case) the mode applies to. */
  countries: string[];
  /** RFC3339, empty until first saved. */
  updated_at: string;
  /** Acting admin email of the last change. */
  updated_by: string;
}

async function parseError(res: Response): Promise<never> {
  if (res.status === 403) throw new GeoForbiddenError();
  let msg = `request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) msg = body.error;
  } catch {
    // non-JSON body; keep the status-based message
  }
  throw new Error(msg);
}

/** GET the current geo access policy. */
export async function getGeoPolicy(): Promise<GeoPolicy> {
  const res = await fetch("/api/v1/admin/geo", {
    credentials: "same-origin",
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as GeoPolicy;
}

/** PUT a new geo access policy; returns the persisted policy. */
export async function setGeoPolicy(
  mode: GeoMode,
  countries: string[],
): Promise<GeoPolicy> {
  const res = await fetch("/api/v1/admin/geo", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, countries }),
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as GeoPolicy;
}

/** A few common ISO alpha-2 presets offered as one-click chips in the UI. */
export const COUNTRY_PRESETS: { code: string; name: string }[] = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "RU", name: "Russia" },
  { code: "CN", name: "China" },
  { code: "IN", name: "India" },
  { code: "BR", name: "Brazil" },
  { code: "AU", name: "Australia" },
];

/** Parse a free-text comma/space/newline-separated list into ISO codes. */
export function parseCountryInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const c = part.trim().toUpperCase();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}
