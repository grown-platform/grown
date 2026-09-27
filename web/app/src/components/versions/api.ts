/** Client for /api/v1/versions — version history of Sheets, Slides and
 *  Whiteboards (see internal/versions). */

export type VersionKind = "sheets" | "slides" | "whiteboards";

export interface ObjectVersion {
  id: string;
  author_id: string;
  author_name: string;
  label: string;
  is_auto: boolean;
  size_bytes: number;
  restored_from?: string;
  created_at: string;
  /** Only on getVersion. */
  data?: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`/api/v1/versions/${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) {
    const text = (await resp.text().catch(() => "")).trim();
    throw new Error(text || `HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

export async function listVersions(
  kind: VersionKind,
  id: string,
): Promise<{ versions: ObjectVersion[]; canEdit: boolean }> {
  const r = await call<{ versions?: ObjectVersion[]; can_edit?: boolean }>(`${kind}/${id}`);
  return { versions: r.versions ?? [], canEdit: !!r.can_edit };
}

export function getVersion(kind: VersionKind, id: string, versionId: string): Promise<ObjectVersion> {
  return call<ObjectVersion>(`${kind}/${id}/${versionId}`);
}

/** nameCurrentVersion labels the document's saved state as a version. */
export function nameCurrentVersion(kind: VersionKind, id: string, label: string): Promise<ObjectVersion> {
  return call<ObjectVersion>(`${kind}/${id}`, { method: "POST", body: JSON.stringify({ label }) });
}

export function renameVersion(
  kind: VersionKind,
  id: string,
  versionId: string,
  label: string,
): Promise<ObjectVersion> {
  return call<ObjectVersion>(`${kind}/${id}/${versionId}`, {
    method: "PATCH",
    body: JSON.stringify({ label }),
  });
}

/** restoreVersion writes an old version back to the document (recorded as a
 *  new version) and returns the restored data. */
export function restoreVersion(
  kind: VersionKind,
  id: string,
  versionId: string,
): Promise<{ version: ObjectVersion; data: string }> {
  return call(`${kind}/${id}/${versionId}/restore`, { method: "POST" });
}

/** The collab message that tells other open editors a version was restored
 *  (they reload, so their stale state can't overwrite the restore). Sheets and
 *  Whiteboards tag messages with `type`, Slides with `t`; it carries both. */
export const VERSION_RESTORED_MSG = { type: "versionRestored", t: "versionRestored" } as const;

export function isVersionRestoredMsg(m: unknown): boolean {
  if (!m || typeof m !== "object") return false;
  const o = m as { type?: unknown; t?: unknown };
  return o.type === "versionRestored" || o.t === "versionRestored";
}
