// honeypotApi.ts — fetch client for the Admin → Security / Honeypot console.
// Mirrors the other admin API modules (geoApi, analyticsApi): plain fetch, no
// SDK, errors as typed exceptions, credentials same-origin.
//
// Backend: internal/honeypot, mounted at /api/v1/admin/honeypot (GET recent
// alerts + counts, DELETE to clear/acknowledge). The alerts are instance-level
// (NOT per-org) — they are tripped by unauthenticated probers hitting decoy
// paths or a hidden form field. Admin-gated server-side.

export class HoneypotForbiddenError extends Error {
  constructor() {
    super("admin privileges required");
    this.name = "HoneypotForbiddenError";
  }
}

/** Kind of trap that fired. */
export type HoneypotKind = "decoy_path" | "form_bot" | string;

export interface HoneypotAlert {
  id: string;
  kind: HoneypotKind;
  /** Requested path (decoy_path). */
  path: string;
  method: string;
  /** Best-effort client IP (XFF / CF-Connecting-IP). */
  ip: string;
  /** CF-IPCountry, when present. */
  country: string;
  user_agent: string;
  /** Free-form context (e.g. the hidden field name). */
  detail: string;
  /** RFC3339. */
  created_at: string;
}

export interface HoneypotCounts {
  total: number;
  /** Alerts in the trailing 24h — drives the dashboard red badge. */
  last_24h: number;
  /** All-time count per kind. */
  by_kind: Record<string, number>;
}

export interface HoneypotResponse {
  alerts: HoneypotAlert[];
  counts: HoneypotCounts;
}

async function parseError(res: Response): Promise<never> {
  if (res.status === 403) throw new HoneypotForbiddenError();
  let msg = `request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) msg = body.error;
  } catch {
    // non-JSON body; keep the status-based message
  }
  throw new Error(msg);
}

/** GET recent honeypot alerts + counts. */
export async function getHoneypot(): Promise<HoneypotResponse> {
  const res = await fetch("/api/v1/admin/honeypot", {
    credentials: "same-origin",
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as HoneypotResponse;
}

/** DELETE all alerts (clear / acknowledge); returns the number removed. */
export async function clearHoneypot(): Promise<number> {
  const res = await fetch("/api/v1/admin/honeypot", {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) await parseError(res);
  const body = (await res.json()) as { cleared?: number };
  return body.cleared ?? 0;
}

/** Just the counts — cheap, best-effort fetch for the dashboard badge. Returns
 *  null on any failure (forbidden, network) so the badge simply hides. */
export async function getHoneypotCounts(): Promise<HoneypotCounts | null> {
  try {
    const r = await getHoneypot();
    return r.counts;
  } catch {
    return null;
  }
}

/** Human label for a trap kind. */
export function kindLabel(kind: HoneypotKind): string {
  switch (kind) {
    case "decoy_path":
      return "Decoy path";
    case "form_bot":
      return "Form bot";
    default:
      return kind || "—";
  }
}
