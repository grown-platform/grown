import type {
  Contact,
  ContactInput,
  ListContactsResponse,
  ContactGroup,
  ListContactGroupsResponse,
} from "./types";

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

// ---- Contacts ----

export async function listContacts(opts?: {
  groupId?: string;
  starredOnly?: boolean;
}): Promise<Contact[]> {
  const params = new URLSearchParams();
  if (opts?.groupId) params.set("group_id", opts.groupId);
  if (opts?.starredOnly) params.set("starred_only", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";
  const r = await jsonFetch<ListContactsResponse>(`/contacts${qs}`);
  return r.contacts ?? [];
}

export function createContact(input: Partial<ContactInput>): Promise<Contact> {
  return jsonFetch<Contact>("/contacts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateContact(
  id: string,
  input: ContactInput,
): Promise<Contact> {
  return jsonFetch<Contact>(`/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function trashContact(id: string): Promise<void> {
  await jsonFetch<unknown>(`/contacts/${id}`, { method: "DELETE" });
}

export function starContact(id: string, starred: boolean): Promise<Contact> {
  return jsonFetch<Contact>(`/contacts/${id}/star`, {
    method: "POST",
    body: JSON.stringify({ starred }),
  });
}

// ---- Contact groups ----

export async function listContactGroups(): Promise<ContactGroup[]> {
  const r = await jsonFetch<ListContactGroupsResponse>("/contacts/groups");
  return r.groups ?? [];
}

export function createContactGroup(name: string): Promise<ContactGroup> {
  return jsonFetch<ContactGroup>("/contacts/groups", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateContactGroup(
  id: string,
  name: string,
): Promise<ContactGroup> {
  return jsonFetch<ContactGroup>(`/contacts/groups/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function deleteContactGroup(id: string): Promise<void> {
  await jsonFetch<unknown>(`/contacts/groups/${id}`, { method: "DELETE" });
}

export async function addContactsToGroup(
  groupId: string,
  contactIds: string[],
): Promise<void> {
  await jsonFetch<unknown>(`/contacts/groups/${groupId}/members`, {
    method: "POST",
    body: JSON.stringify({ contact_ids: contactIds }),
  });
}

export async function removeContactFromGroup(
  groupId: string,
  contactId: string,
): Promise<void> {
  await jsonFetch<unknown>(`/contacts/groups/${groupId}/members/${contactId}`, {
    method: "DELETE",
  });
}

// ---- vCard ----

export async function exportVCardServer(opts?: {
  contactIds?: string[];
  groupId?: string;
}): Promise<string> {
  const r = await jsonFetch<{ vcf_text: string }>("/contacts/export", {
    method: "POST",
    body: JSON.stringify({
      contact_ids: opts?.contactIds ?? [],
      group_id: opts?.groupId ?? "",
    }),
  });
  return r.vcf_text ?? "";
}

export async function importVCardServer(vcfText: string): Promise<number> {
  const r = await jsonFetch<{ created: number }>("/contacts/import", {
    method: "POST",
    body: JSON.stringify({ vcf_text: vcfText }),
  });
  return r.created ?? 0;
}
