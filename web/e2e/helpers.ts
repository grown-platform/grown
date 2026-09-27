import type { APIRequestContext } from "@playwright/test";
import * as path from "node:path";

// Shared helpers for the e2e specs: the app base URL, the saved-session path,
// and thin wrappers over the JSON API for setting up fixtures (creating
// docs/sheets) without driving the UI. All requests reuse the authenticated
// storageState, so they carry the session cookie automatically.

export const BASE_URL =
  process.env.GROWN_HTTP_URL ?? "http://workspace.localtest.me:8080";

// Where the shared signed-in session is persisted by auth.setup.ts. Kept here
// (a non-test module) so playwright.config.ts can import it without loading a
// file that calls test()/setup().
export const STORAGE_STATE = path.join(
  process.cwd(),
  "playwright/.auth/admin.json",
);

export async function createDoc(
  request: APIRequestContext,
  title = "e2e doc",
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/docs`, {
    data: { title },
  });
  if (!res.ok()) throw new Error(`createDoc failed: ${res.status()}`);
  return (await res.json()).id as string;
}

export async function trashDoc(request: APIRequestContext, id: string) {
  await request.delete(`${BASE_URL}/api/v1/docs/d/${id}`).catch(() => {});
}

export async function createSheet(
  request: APIRequestContext,
  title = "e2e sheet",
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/sheets`, {
    data: { title },
  });
  if (!res.ok()) throw new Error(`createSheet failed: ${res.status()}`);
  return (await res.json()).id as string;
}

export async function trashSheet(request: APIRequestContext, id: string) {
  await request.delete(`${BASE_URL}/api/v1/sheets/d/${id}`).catch(() => {});
}

// saveSheet posts a FortuneSheet workbook (array of sheet objects). The server
// runs the formula engine (RecomputeWorkbook) before persisting, so the saved
// cells carry computed values.
export async function saveSheet(
  request: APIRequestContext,
  id: string,
  workbook: unknown,
) {
  const res = await request.put(`${BASE_URL}/api/v1/sheets/d/${id}/data`, {
    data: { id, data: JSON.stringify(workbook) },
  });
  if (!res.ok()) throw new Error(`saveSheet failed: ${res.status()}`);
}

export async function getSheetData(
  request: APIRequestContext,
  id: string,
): Promise<any[]> {
  const res = await request.get(`${BASE_URL}/api/v1/sheets/d/${id}`);
  if (!res.ok()) throw new Error(`getSheet failed: ${res.status()}`);
  const body = await res.json();
  // The workbook JSON is carried as a string in the `data` field.
  // A sheet that was never saved carries an empty string.
  return JSON.parse(body.data || "[]");
}

// formulaCell builds a single FortuneSheet formula cell datum (1 sheet).
export function workbookWithCells(
  cells: Array<{ r: number; c: number; v?: number | string; f?: string }>,
) {
  return [
    {
      name: "Sheet1",
      celldata: cells.map((c) => ({
        r: c.r,
        c: c.c,
        v: c.f != null ? { f: c.f } : { v: c.v },
      })),
    },
  ];
}

export async function createDeck(
  request: APIRequestContext,
  title = "e2e deck",
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/slides`, {
    data: { title },
  });
  if (!res.ok()) throw new Error(`createDeck failed: ${res.status()}`);
  return (await res.json()).id as string;
}

export async function trashDeck(request: APIRequestContext, id: string) {
  await request.delete(`${BASE_URL}/api/v1/slides/d/${id}`).catch(() => {});
}

// saveDeckData replaces a deck's model ({ slides: [...] }), like the editor's autosave.
export async function saveDeckData(
  request: APIRequestContext,
  id: string,
  deck: unknown,
) {
  const res = await request.put(`${BASE_URL}/api/v1/slides/d/${id}/data`, {
    data: { data: JSON.stringify(deck) },
  });
  if (!res.ok()) throw new Error(`saveDeckData failed: ${res.status()}`);
}

// getDeckData returns the parsed deck model ({ slides: [...] }) or null when
// the deck has never been saved.
export async function getDeckData(
  request: APIRequestContext,
  id: string,
): Promise<{ slides: Array<{ id: string; elements: any[] }> } | null> {
  const res = await request.get(`${BASE_URL}/api/v1/slides/d/${id}`);
  if (!res.ok()) throw new Error(`getDeck failed: ${res.status()}`);
  const body = await res.json();
  return body.data ? JSON.parse(body.data) : null;
}
