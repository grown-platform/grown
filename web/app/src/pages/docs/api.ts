import type { Doc, ListDocsResponse } from "./types";
import type { ObjectGrant } from "../../api/directory";

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

/** listDocs returns the caller's org's documents. */
export async function listDocs(): Promise<Doc[]> {
  const r = await jsonFetch<ListDocsResponse>("/docs");
  return r.docs ?? [];
}

/** createDoc creates a new document and returns it. */
export function createDoc(title = ""): Promise<Doc> {
  return jsonFetch<Doc>("/docs", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

/** getDoc fetches a single document's metadata. */
export function getDoc(id: string): Promise<Doc> {
  return jsonFetch<Doc>(`/docs/d/${id}`);
}

/** renameDoc changes a document's title. */
export function renameDoc(id: string, title: string): Promise<Doc> {
  return jsonFetch<Doc>(`/docs/d/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

/** trashDoc soft-deletes a document. */
export async function trashDoc(id: string): Promise<void> {
  await jsonFetch<unknown>(`/docs/d/${id}`, { method: "DELETE" });
}

/** updatePreview stores a rendered-HTML thumbnail for the home grid. */
export async function updatePreview(id: string, html: string): Promise<void> {
  await jsonFetch<unknown>(`/docs/d/${id}/preview`, {
    method: "PUT",
    body: JSON.stringify({ html }),
  });
}

export interface Share {
  token: string;
  doc_id: string;
  role: string;
  audience?: string;
  created_at: string;
}

export interface ShareInfo {
  doc_id: string;
  role: string;
  title: string;
}

/** createShare issues a share-link token at a role ("viewer"|"editor"). An
 *  optional audience email records who it was invited for. */
export function createShare(
  docId: string,
  role: string,
  audience = "",
): Promise<Share> {
  return jsonFetch<Share>(`/docs/d/${docId}/shares`, {
    method: "POST",
    body: JSON.stringify({ role, audience }),
  });
}

/** setTemplate flags/unflags a document as a gallery template. */
export function setTemplate(id: string, isTemplate: boolean): Promise<Doc> {
  return jsonFetch<Doc>(`/docs/d/${id}/template`, {
    method: "PATCH",
    body: JSON.stringify({ is_template: isTemplate }),
  });
}

/** listShares returns active share tokens for a document. */
export async function listShares(docId: string): Promise<Share[]> {
  const r = await jsonFetch<{ shares: Share[] }>(`/docs/d/${docId}/shares`);
  return r.shares ?? [];
}

/** revokeShare revokes a share token. */
export async function revokeShare(token: string): Promise<void> {
  await jsonFetch<unknown>(`/docs/shares/${token}`, { method: "DELETE" });
}

/** getShare resolves a share token to its document (public, no session). */
export function getShare(token: string): Promise<ShareInfo> {
  return jsonFetch<ShareInfo>(`/docs/share/${token}`);
}

export interface DocVersion {
  id: string;
  doc_id: string;
  author_id: string;
  author_name: string;
  label: string;
  content_html: string;
  is_auto: boolean;
  created_at: string;
}

/** snapshotNow captures the current rendered HTML as a new version. */
export function snapshotNow(
  docId: string,
  contentHtml: string,
  label = "",
  isAuto = false,
): Promise<DocVersion> {
  return jsonFetch<DocVersion>(`/docs/d/${docId}/versions`, {
    method: "POST",
    body: JSON.stringify({ content_html: contentHtml, label, is_auto: isAuto }),
  });
}

/** listVersions returns a document's saved versions, newest first (no content). */
export async function listVersions(docId: string): Promise<DocVersion[]> {
  const r = await jsonFetch<{ versions: DocVersion[] }>(
    `/docs/d/${docId}/versions`,
  );
  return r.versions ?? [];
}

/** getVersion returns a single version including its content_html. */
export function getVersion(
  docId: string,
  versionId: string,
): Promise<DocVersion> {
  return jsonFetch<DocVersion>(`/docs/d/${docId}/versions/${versionId}`);
}

/** restoreVersion records a copy of an older version and returns it (with content). */
export function restoreVersion(
  docId: string,
  versionId: string,
): Promise<DocVersion> {
  return jsonFetch<DocVersion>(
    `/docs/d/${docId}/versions/${versionId}/restore`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export interface DocComment {
  id: string;
  doc_id: string;
  author_id: string;
  author_name: string;
  body: string;
  quote: string;
  anchor_from: number;
  anchor_to: number;
  resolved: boolean;
  created_at: string;
  resolved_at: string;
  parent_comment_id: string;
  /** Replies are nested under top-level comments only (populated by ListComments). */
  replies?: DocComment[];
  updated_at: string;
}

/** listComments returns a document's comments, oldest first. */
export async function listComments(docId: string): Promise<DocComment[]> {
  const r = await jsonFetch<{ comments: DocComment[] }>(
    `/docs/d/${docId}/comments`,
  );
  return r.comments ?? [];
}

/** addComment anchors a new comment to a selection range. */
export function addComment(
  docId: string,
  body: string,
  quote: string,
  anchorFrom: number,
  anchorTo: number,
): Promise<DocComment> {
  return jsonFetch<DocComment>(`/docs/d/${docId}/comments`, {
    method: "POST",
    body: JSON.stringify({
      body,
      quote,
      anchor_from: anchorFrom,
      anchor_to: anchorTo,
    }),
  });
}

/** resolveComment marks a comment thread as resolved. */
export function resolveComment(
  docId: string,
  commentId: string,
): Promise<DocComment> {
  return jsonFetch<DocComment>(
    `/docs/d/${docId}/comments/${commentId}/resolve`,
    {
      method: "PATCH",
      body: JSON.stringify({ resolved: true }),
    },
  );
}

/** reopenComment reopens a previously resolved comment thread. */
export function reopenComment(
  docId: string,
  commentId: string,
): Promise<DocComment> {
  return jsonFetch<DocComment>(
    `/docs/d/${docId}/comments/${commentId}/reopen`,
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
  );
}

/** replyToComment posts a reply under an existing top-level comment. */
export function replyToComment(
  docId: string,
  commentId: string,
  body: string,
): Promise<DocComment> {
  return jsonFetch<DocComment>(
    `/docs/d/${docId}/comments/${commentId}/replies`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
  );
}

/** deleteComment removes a comment (and all its replies). */
export async function deleteComment(
  docId: string,
  commentId: string,
): Promise<void> {
  await jsonFetch<unknown>(`/docs/d/${docId}/comments/${commentId}`, {
    method: "DELETE",
  });
}

// ---- Per-user ACL grants (object_grants) ----

/** listDocGrants returns the per-user grants on a document. */
export async function listDocGrants(docId: string): Promise<ObjectGrant[]> {
  const r = await jsonFetch<{ grants?: ObjectGrant[] }>(
    `/docs/d/${docId}/grants`,
  );
  return r.grants ?? [];
}

/** grantDocAccess shares a document with a grown user at a role. */
export function grantDocAccess(
  docId: string,
  granteeUserId: string,
  role: string,
): Promise<{ grant?: ObjectGrant }> {
  return jsonFetch<{ grant?: ObjectGrant }>(`/docs/d/${docId}/grants`, {
    method: "POST",
    body: JSON.stringify({ grantee_user_id: granteeUserId, role }),
  });
}

/** revokeDocAccess removes a user's grant on a document. */
export async function revokeDocAccess(
  docId: string,
  granteeUserId: string,
): Promise<void> {
  await jsonFetch<unknown>(`/docs/d/${docId}/grants/${granteeUserId}`, {
    method: "DELETE",
  });
}

/** listDocsSharedWithMe returns documents shared with the caller (cross-org). */
export async function listDocsSharedWithMe(): Promise<Doc[]> {
  const r = await jsonFetch<{ docs?: Doc[] }>("/docs/shared-with-me");
  return r.docs ?? [];
}

/** collabURL returns the WebSocket origin + room for a document's Yjs channel.
 *  y-websocket appends "/<room>" to the first arg, yielding
 *  /api/v1/docs/d/<id>/connect. */
export function collabBase(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/v1/docs/d`;
}
