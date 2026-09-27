import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BASE_URL, getSheetData } from "../helpers";

// Shared helpers for the Sheets integration specs: the real File ▸ Download
// and File ▸ Import UI, Drive upload → Open with Sheets → "Open in Sheets",
// and a few model readers. FortuneSheet paints to a canvas, so the specs read
// the saved workbook through the API.

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";
export const CSV_MIME = "text/csv";

export function sheetNamed(wb: any[], name: string): any {
  return wb.find((s) => s.name === name);
}

export function cellAt(sheet: any, ref: string): any {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
  const r = Number(m[2]) - 1;
  return sheet?.celldata?.find((x: any) => x.r === r && x.c === c - 1)?.v;
}

/** File ▸ Download ▸ <label>; returns the downloaded bytes and file name. */
export async function downloadAs(page: Page, label: string): Promise<{ bytes: Buffer; name: string }> {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("button", { name: "Download" }).click();
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("menuitem", { name: label }).click(),
  ]);
  return { bytes: await readFile((await dl.path())!), name: dl.suggestedFilename() };
}

/** File ▸ Import with "Create new spreadsheet"; returns the new spreadsheet id. */
export async function importAsNew(page: Page, name: string, buffer: Buffer, mimeType: string): Promise<string> {
  const before = page.url();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Import/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import file" });
  await dialog.getByTestId("import-file-input").setInputFiles({ name, mimeType, buffer });
  await expect(dialog.getByTestId("import-summary")).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("radio", { name: "Create new spreadsheet" }).check();
  await dialog.getByRole("button", { name: "Import data" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => page.url(), { timeout: 20_000 }).not.toBe(before);
  const id = page.url().split("/sheets/d/")[1];
  expect(id).toBeTruthy();
  return id;
}

/** Uploads a file to My Drive through the Drive page's upload input. */
export async function driveUpload(page: Page, name: string, buffer: Buffer, mimeType: string): Promise<string> {
  await page.goto(`${BASE_URL}/drive`);
  await expect(page.getByText("My Drive").first()).toBeVisible({ timeout: 20_000 });
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/v1/drive/files/upload") && r.request().method() === "POST"),
    page.getByTestId("drive-upload-input").setInputFiles({ name, mimeType, buffer }),
  ]);
  expect(resp.ok(), `upload ${resp.status()}`).toBeTruthy();
  const id = (await resp.json()).id as string;
  await expect(page.getByTestId(`file-row-${id}`)).toBeVisible({ timeout: 15_000 });
  return id;
}

/** Row menu ▸ Open with ▸ Sheets, then "Open in Sheets"; returns the new spreadsheet id. */
export async function openInSheetsFromDrive(page: Page, fileId: string): Promise<string> {
  await page.getByTestId(`row-menu-${fileId}`).click();
  await page.getByTestId(`open-with-${fileId}`).click();
  await page.getByRole("menuitem", { name: "Sheets", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/sheets/${fileId}$`));
  await page.getByTestId("open-in-sheets").click();
  await page.waitForURL(/\/sheets\/d\/[^/]+$/, { timeout: 30_000 });
  await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
  return page.url().split("/sheets/d/")[1];
}

/** Trashes a Drive file, then deletes it for good. */
export async function purgeDriveFile(request: APIRequestContext, id: string) {
  await request.delete(`${BASE_URL}/api/v1/drive/files/${id}`).catch(() => {});
  await request.delete(`${BASE_URL}/api/v1/drive/files/${id}:forever`).catch(() => {});
}

/** Polls the saved workbook until `check` passes. */
export async function savedWb(request: APIRequestContext, id: string, check: (wb: any[]) => void, timeout = 20_000): Promise<any[]> {
  let wb: any[] = [];
  await expect(async () => {
    wb = await getSheetData(request, id);
    check(wb);
  }).toPass({ timeout });
  return wb;
}
