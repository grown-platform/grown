import type { DriveFile, DriveShare, DriveFileVersion } from "./types";
import type { ObjectGrant } from "../../api/directory";

const BASE = "/api/v1/drive";

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

/** List files in a folder. Empty `parent` = org root. */
export async function listFiles(parent: string = ""): Promise<DriveFile[]> {
  const url = parent
    ? `${BASE}/files?parent=${encodeURIComponent(parent)}`
    : `${BASE}/files`;
  const r = await fetch(url, { credentials: "same-origin" });
  const data = await jsonOrThrow<{
    files?: DriveFile[];
    next_page_token?: string;
  }>(r);
  return data.files ?? [];
}

/** Single-file lookup. The gateway returns { file: ... }; unwrap. */
export async function getFile(id: string): Promise<DriveFile> {
  const r = await fetch(`${BASE}/files/${id}`, { credentials: "same-origin" });
  const data = await jsonOrThrow<{ file: DriveFile }>(r);
  return data.file;
}

/** Create folder. Returns the unwrapped DriveFile. */
export async function createFolder(
  name: string,
  parent: string = "",
): Promise<DriveFile> {
  const r = await fetch(`${BASE}/folders`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parent }),
  });
  const data = await jsonOrThrow<{ file: DriveFile }>(r);
  return data.file;
}

/** Rename (patch). Returns the unwrapped DriveFile after the patch. */
export async function renameFile(id: string, name: string): Promise<DriveFile> {
  const r = await fetch(`${BASE}/files/${id}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await jsonOrThrow<{ file: DriveFile }>(r);
  return data.file;
}

/** Move a file into a new parent folder (empty parent = org root). */
export async function moveFile(id: string, parent: string): Promise<DriveFile> {
  const r = await fetch(`${BASE}/files/${id}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent }),
  });
  const data = await jsonOrThrow<{ file: DriveFile }>(r);
  return data.file;
}

/** Make a copy of a file (blob + metadata) in the same folder. Optionally
 *  override the new name; empty = source name + " (copy)". Folders cannot be
 *  copied — the server returns 400. Returns the unwrapped new DriveFile. */
export async function copyFile(id: string, name = ""): Promise<DriveFile> {
  const r = await fetch(`${BASE}/files/${id}:copy`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await jsonOrThrow<{ file: DriveFile }>(r);
  return data.file;
}

/** Move to trash. */
export async function trashFile(id: string): Promise<void> {
  const r = await fetch(`${BASE}/files/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error(`trash failed: ${r.status}`);
}

/** Multipart upload. Returns the flat DriveFile (raw HTTP handler, no wrapper). */
export async function uploadFile(
  file: File,
  parent: string = "",
): Promise<DriveFile> {
  const fd = new FormData();
  fd.append("file", file);
  if (parent) fd.append("parent", parent);
  const r = await fetch(`${BASE}/files/upload`, {
    method: "POST",
    credentials: "same-origin",
    body: fd,
  });
  return jsonOrThrow<DriveFile>(r);
}

/** Helper to build the download URL — the actual stream happens via <img>/<video>/anchor. */
export function downloadURL(id: string): string {
  return `${BASE}/files/${id}/content`;
}

/** Create share. Returns the unwrapped DriveShare. */
export async function createShare(
  fileId: string,
  role: "viewer" | "commenter" | "editor" = "viewer",
): Promise<DriveShare> {
  const r = await fetch(`${BASE}/files/${fileId}/shares`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  const data = await jsonOrThrow<{ share: DriveShare }>(r);
  return data.share;
}

/** List shares for a file. */
export async function listShares(fileId: string): Promise<DriveShare[]> {
  const r = await fetch(`${BASE}/files/${fileId}/shares`, {
    credentials: "same-origin",
  });
  const data = await jsonOrThrow<{ shares?: DriveShare[] }>(r);
  return data.shares ?? [];
}

/** Revoke a share token. */
export async function revokeShare(token: string): Promise<void> {
  const r = await fetch(`${BASE}/shares/${token}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error(`revoke failed: ${r.status}`);
}

// ---- Per-user ACL grants (object_grants) ----

/** List per-user grants on a file. */
export async function listFileGrants(fileId: string): Promise<ObjectGrant[]> {
  const r = await fetch(`${BASE}/files/${fileId}/grants`, {
    credentials: "same-origin",
  });
  const data = await jsonOrThrow<{ grants?: ObjectGrant[] }>(r);
  return data.grants ?? [];
}

/** Grant a grown user a role on a file. */
export async function grantFileAccess(
  fileId: string,
  granteeUserId: string,
  role: string,
): Promise<ObjectGrant | undefined> {
  const r = await fetch(`${BASE}/files/${fileId}/grants`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grantee_user_id: granteeUserId, role }),
  });
  const data = await jsonOrThrow<{ grant?: ObjectGrant }>(r);
  return data.grant;
}

/** Revoke a user's grant on a file. */
export async function revokeFileAccess(
  fileId: string,
  granteeUserId: string,
): Promise<void> {
  const r = await fetch(`${BASE}/files/${fileId}/grants/${granteeUserId}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error(`revoke access failed: ${r.status}`);
}

/** List files shared with the caller (cross-org "Shared with me"). */
export async function listSharedWithMe(): Promise<DriveFile[]> {
  const r = await fetch(`${BASE}/shared-with-me`, {
    credentials: "same-origin",
  });
  const data = await jsonOrThrow<{ files?: DriveFile[] }>(r);
  return data.files ?? [];
}

/** Star a file for the current user. */
export async function starFile(fileId: string): Promise<void> {
  const r = await fetch(`${BASE}/files/${fileId}/star`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error(`star failed: ${r.status}`);
}

/** Unstar a file for the current user. */
export async function unstarFile(fileId: string): Promise<void> {
  const r = await fetch(`${BASE}/files/${fileId}/star`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error(`unstar failed: ${r.status}`);
}

/** List starred files for the current user. */
export async function listStarred(): Promise<DriveFile[]> {
  const r = await fetch(`${BASE}/starred`, { credentials: "same-origin" });
  const data = await jsonOrThrow<{ files?: DriveFile[] }>(r);
  return data.files ?? [];
}

/** List recent files (across folders, ordered by last modified). */
export async function listRecent(): Promise<DriveFile[]> {
  const r = await fetch(`${BASE}/recent`, { credentials: "same-origin" });
  const data = await jsonOrThrow<{ files?: DriveFile[] }>(r);
  return data.files ?? [];
}

/** List trashed files for the caller's org. */
export async function listTrash(): Promise<DriveFile[]> {
  const r = await fetch(`${BASE}/trash`, { credentials: "same-origin" });
  const data = await jsonOrThrow<{ files?: DriveFile[] }>(r);
  return data.files ?? [];
}

/** Restore a trashed file. */
export async function restoreFile(id: string): Promise<void> {
  const r = await fetch(`${BASE}/files/${id}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restore_from_trash: true }),
  });
  if (!r.ok) throw new Error(`restore failed: ${r.status}`);
}

/** Permanently delete a file (must already be trashed). */
export async function deleteForever(id: string): Promise<void> {
  const r = await fetch(`${BASE}/files/${id}:forever`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error(`delete forever failed: ${r.status}`);
}

// ---- File versions ----

/** List the version history for a file, most-recent first. */
export async function listFileVersions(
  fileId: string,
): Promise<DriveFileVersion[]> {
  const r = await fetch(`${BASE}/files/${fileId}/versions`, {
    credentials: "same-origin",
  });
  const data = await jsonOrThrow<{ versions?: DriveFileVersion[] }>(r);
  return data.versions ?? [];
}

/** Restore a prior version as the current content. Returns the updated file. */
export async function restoreFileVersion(
  fileId: string,
  versionId: string,
): Promise<DriveFile> {
  const r = await fetch(
    `${BASE}/files/${fileId}/versions/${versionId}:restore`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  const data = await jsonOrThrow<{ file: DriveFile }>(r);
  return data.file;
}

/** Download URL for a specific version's content. */
export function versionDownloadURL(fileId: string, versionId: string): string {
  return `${BASE}/files/${fileId}/versions/${versionId}/content`;
}

/** Replace the content of an existing file (creates a version of the old content). */
export async function replaceFileContent(
  fileId: string,
  file: File,
): Promise<DriveFile> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("file_id", fileId);
  const r = await fetch(`${BASE}/files/upload`, {
    method: "POST",
    credentials: "same-origin",
    body: fd,
  });
  return jsonOrThrow<DriveFile>(r);
}
