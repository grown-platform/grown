import type {
  Note,
  NoteInput,
  ListNotesResponse,
  ListRemindersResponse,
  ListSharedWithMeResponse,
  ListGrantsResponse,
  GrantResponse,
  KeepLabel,
  ListLabelsResponse,
} from "./types";
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

export interface ListNotesOptions {
  archived?: boolean;
  labelId?: string;
}

export async function listNotes(opts?: ListNotesOptions): Promise<Note[]> {
  const params = new URLSearchParams();
  if (opts?.archived) params.set("archived", "true");
  if (opts?.labelId) params.set("label_id", opts.labelId);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const r = await jsonFetch<ListNotesResponse>(`/keep/notes${qs}`);
  return r.notes ?? [];
}

export function createNote(input: Partial<NoteInput>): Promise<Note> {
  return jsonFetch<Note>("/keep/notes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateNote(id: string, input: NoteInput): Promise<Note> {
  return jsonFetch<Note>(`/keep/notes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function trashNote(id: string): Promise<void> {
  await jsonFetch<unknown>(`/keep/notes/${id}`, { method: "DELETE" });
}

// ---- Reminders ----

export async function listReminders(): Promise<Note[]> {
  const r = await jsonFetch<ListRemindersResponse>("/keep/reminders");
  return r.notes ?? [];
}

export function setReminder(id: string, remindAt: string): Promise<Note> {
  return jsonFetch<Note>(`/keep/notes/${id}/reminder`, {
    method: "PATCH",
    body: JSON.stringify({ remind_at: remindAt }),
  });
}

export async function clearReminder(id: string): Promise<Note> {
  return jsonFetch<Note>(`/keep/notes/${id}/reminder`, { method: "DELETE" });
}

// ---- Sharing / grants ----

export async function listSharedWithMe(): Promise<Note[]> {
  const r = await jsonFetch<ListSharedWithMeResponse>("/keep/shared-with-me");
  return r.notes ?? [];
}

export async function listNoteGrants(noteId: string): Promise<ObjectGrant[]> {
  const r = await jsonFetch<ListGrantsResponse>(`/keep/notes/${noteId}/grants`);
  return r.grants ?? [];
}

export async function grantNoteAccess(
  noteId: string,
  granteeUserId: string,
  role: string,
): Promise<ObjectGrant | void> {
  const r = await jsonFetch<GrantResponse>(`/keep/notes/${noteId}/grants`, {
    method: "POST",
    body: JSON.stringify({ grantee_user_id: granteeUserId, role }),
  });
  return r.grant;
}

export async function revokeNoteAccess(
  noteId: string,
  granteeUserId: string,
): Promise<void> {
  await jsonFetch<unknown>(`/keep/notes/${noteId}/grants/${granteeUserId}`, {
    method: "DELETE",
  });
}

// ---- Labels (managed) ----

export async function listLabels(): Promise<KeepLabel[]> {
  const r = await jsonFetch<ListLabelsResponse>("/keep/labels");
  return r.labels ?? [];
}

export async function createLabel(name: string): Promise<KeepLabel> {
  return jsonFetch<KeepLabel>("/keep/labels", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function deleteLabel(id: string): Promise<void> {
  await jsonFetch<unknown>(`/keep/labels/${id}`, { method: "DELETE" });
}

export async function applyLabel(
  noteId: string,
  labelId: string,
): Promise<void> {
  await jsonFetch<unknown>(`/keep/notes/${noteId}/labels/${labelId}`, {
    method: "POST",
    body: "{}",
  });
}

export async function removeLabel(
  noteId: string,
  labelId: string,
): Promise<void> {
  await jsonFetch<unknown>(`/keep/notes/${noteId}/labels/${labelId}`, {
    method: "DELETE",
  });
}

export async function archiveNote(id: string): Promise<Note> {
  return jsonFetch<Note>(`/keep/notes/${id}/archive`, {
    method: "POST",
    body: "{}",
  });
}

export async function unarchiveNote(id: string): Promise<Note> {
  return jsonFetch<Note>(`/keep/notes/${id}/unarchive`, {
    method: "POST",
    body: "{}",
  });
}
