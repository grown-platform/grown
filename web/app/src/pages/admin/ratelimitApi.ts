// ratelimitApi.ts — fetch client for the Admin → Rate limiting panel.
// Mirrors the other admin API modules (honeypotApi, geoApi, analyticsApi): plain
// fetch, no SDK, errors as typed exceptions, credentials same-origin.
//
// Backend: internal/ratelimit, mounted at GET /api/v1/admin/ratelimit. Returns
// the effective limiter config (GROWN_RATELIMIT_*), a counts summary, recent 429
// block events, and the top offending IPs. The data is instance-level (the
// limiter keys on IP, not org). Admin-gated server-side.

export class RateLimitForbiddenError extends Error {
  constructor() {
    super("admin privileges required");
    this.name = "RateLimitForbiddenError";
  }
}

/** Effective limiter configuration (read from GROWN_RATELIMIT_* at boot). */
export interface RateLimitSettings {
  enabled: boolean;
  general_rps: number;
  general_burst: number;
  auth_rps: number;
  auth_burst: number;
  /** What the limiter keys on — currently always "ip". */
  key_by: string;
}

export interface RateLimitCounts {
  total: number;
  last_24h: number;
}

export interface RateLimitBlock {
  id: string;
  ip: string;
  path: string;
  /** Which bucket rejected: "general" | "auth". */
  bucket: string;
  country: string;
  user_agent: string;
  /** RFC3339. */
  created_at: string;
}

export interface RateLimitOffender {
  ip: string;
  count: number;
}

export interface RateLimitResponse {
  settings: RateLimitSettings;
  counts: RateLimitCounts;
  blocks: RateLimitBlock[];
  top_offenders: RateLimitOffender[];
}

/** GET the rate-limit config + recent block events + top offenders. */
export async function getRateLimit(): Promise<RateLimitResponse> {
  const res = await fetch("/api/v1/admin/ratelimit", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (res.status === 403) throw new RateLimitForbiddenError();
  if (!res.ok) {
    let msg = `rate-limit fetch failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      // non-JSON body; keep the status-based message
    }
    throw new Error(msg);
  }
  return res.json() as Promise<RateLimitResponse>;
}
