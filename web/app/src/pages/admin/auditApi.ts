// Audit-log API client for the Admin console's "Audit log" section. Talks to
// the admin-gated handler at GET /api/v1/admin/audit, which lists the caller's
// org's audit events (newest first). Plain fetch, same-origin credentials —
// mirrors ./api.ts and ./usersApi.ts.

const API_BASE = "/api/v1/admin/audit";

/** One audit event as returned by the backend handler. */
export interface AuditEvent {
  id: string;
  actor_email: string;
  actor_id?: string;
  service: string;
  action: string;
  resource_type: string;
  resource_id: string;
  /** Full gRPC method, or "HTTPVERB /path" for raw routes. */
  method: string;
  /** "ok" | "error". */
  status: string;
  /** Free-form context (gRPC code, http_status, …). */
  detail?: Record<string, unknown>;
  ip: string;
  user_agent: string;
  /** RFC3339 timestamp. */
  created_at: string;
}

/** Filters accepted by the listing endpoint. All optional. */
export interface AuditFilter {
  service?: string;
  /** Exact actor email. */
  actor?: string;
  action?: string;
  limit?: number;
  /** Keyset cursor: only events strictly older than this RFC3339 timestamp.
   *  Drives "load more" paging (pass the oldest row's created_at). */
  before?: string;
}

/** Raised when the caller lacks admin privileges (403). */
export class ForbiddenError extends Error {
  constructor(message = "admin privileges required") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** List audit events for the caller's org, newest first, applying the filter. */
export async function listAuditEvents(
  filter: AuditFilter = {},
): Promise<AuditEvent[]> {
  const params = new URLSearchParams();
  if (filter.service?.trim()) params.set("service", filter.service.trim());
  if (filter.actor?.trim()) params.set("actor", filter.actor.trim());
  if (filter.action?.trim()) params.set("action", filter.action.trim());
  if (filter.before?.trim()) params.set("before", filter.before.trim());
  params.set("limit", String(filter.limit ?? 100));

  const resp = await fetch(`${API_BASE}?${params.toString()}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (resp.status === 403) {
    const body = await resp.json().catch(() => null);
    throw new ForbiddenError(body?.error ?? undefined);
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${resp.status}`);
  }
  const data = (await resp.json().catch(() => ({}))) as {
    events?: AuditEvent[];
  };
  return data.events ?? [];
}
