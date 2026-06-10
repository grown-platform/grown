import type { Deck, ListDecksResponse } from "./types";
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

export async function listDecks(): Promise<Deck[]> {
  const r = await jsonFetch<ListDecksResponse>("/slides");
  return r.decks ?? [];
}

export function createDeck(title = ""): Promise<Deck> {
  return jsonFetch<Deck>("/slides", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function getDeck(id: string): Promise<Deck> {
  return jsonFetch<Deck>(`/slides/d/${id}`);
}

export function renameDeck(id: string, title: string): Promise<Deck> {
  return jsonFetch<Deck>(`/slides/d/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function trashDeck(id: string): Promise<void> {
  await jsonFetch<unknown>(`/slides/d/${id}`, { method: "DELETE" });
}

/** saveDeck persists the deck JSON (autosaved by the editor). */
export async function saveDeck(id: string, data: string): Promise<void> {
  await jsonFetch<unknown>(`/slides/d/${id}/data`, {
    method: "PUT",
    body: JSON.stringify({ data }),
  });
}

/** collabURL returns the WebSocket URL for a deck's live-ops channel. */
export function collabURL(id: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/v1/slides/d/${id}/connect`;
}

// ---- Per-user ACL grants (object_grants) ----

/** listDeckGrants returns the per-user grants on a deck. */
export async function listDeckGrants(deckId: string): Promise<ObjectGrant[]> {
  const r = await jsonFetch<{ grants?: ObjectGrant[] }>(
    `/slides/d/${deckId}/grants`,
  );
  return r.grants ?? [];
}

/** grantDeckAccess shares a deck with a grown user at a role. */
export function grantDeckAccess(
  deckId: string,
  granteeUserId: string,
  role: string,
): Promise<{ grant?: ObjectGrant }> {
  return jsonFetch<{ grant?: ObjectGrant }>(`/slides/d/${deckId}/grants`, {
    method: "POST",
    body: JSON.stringify({ grantee_user_id: granteeUserId, role }),
  });
}

/** revokeDeckAccess removes a user's grant on a deck. */
export async function revokeDeckAccess(
  deckId: string,
  granteeUserId: string,
): Promise<void> {
  await jsonFetch<unknown>(`/slides/d/${deckId}/grants/${granteeUserId}`, {
    method: "DELETE",
  });
}

/** listDecksSharedWithMe returns decks shared with the caller (cross-org). */
export async function listDecksSharedWithMe(): Promise<Deck[]> {
  const r = await jsonFetch<{ decks?: Deck[] }>("/slides/shared-with-me");
  return r.decks ?? [];
}
