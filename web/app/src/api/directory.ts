// Directory user search + per-object ACL grant helpers, shared by Drive and
// Docs' ShareDialog. The directory endpoint returns the caller's org roster
// (plus live Zitadel matches); grants are keyed by the returned grown user id.

const API_BASE = "/api/v1";

/** Member is one directory search result (a grown user). */
export interface Member {
  id: string;
  name: string;
  email: string;
}

/** ObjectGrant is a per-user ACL grant on a file/doc, with the grantee resolved. */
export interface ObjectGrant {
  grantee_user_id: string;
  grantee_name: string;
  grantee_email: string;
  role: string;
  granted_by: string;
}

/** searchDirectory returns users matching q (empty q = whole roster). */
export async function searchDirectory(q: string): Promise<Member[]> {
  const resp = await fetch(`${API_BASE}/directory?q=${encodeURIComponent(q)}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { members?: Member[] };
  return data.members ?? [];
}
