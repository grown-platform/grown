import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BASE_URL } from "../helpers";

// Shared helpers for the Slides/Whiteboard integration specs.

export function waitForDeckSave(page: Page, id: string) {
  return page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/api/v1/slides/d/${id}/data`) && r.ok(),
    { timeout: 15_000 },
  );
}

export async function openDeck(page: Page, id: string) {
  await page.goto(`${BASE_URL}/slides/d/${id}`);
  await expect(page.getByRole("textbox", { name: "Presentation title" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** File ▸ Download ▸ <label>; returns the downloaded bytes and file name. */
export async function downloadFromFileMenu(page: Page, label: RegExp): Promise<{ bytes: Buffer; name: string }> {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByText("Download", { exact: true }).click();
  const dl = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("menuitem", { name: label }).click();
  const d = await dl;
  const bytes = await readFile((await d.path())!);
  await d.delete();
  return { bytes, name: d.suggestedFilename() };
}

/** Upload a file through Drive's page-level upload input; returns the Drive file id. */
export async function driveUpload(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<string> {
  await page.goto(`${BASE_URL}/drive`);
  await expect(page.getByText("My Drive").first()).toBeVisible();
  const resp = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/api/v1/drive/files/upload"),
    { timeout: 30_000 },
  );
  await page.getByTestId("drive-upload-input").setInputFiles({ name, mimeType, buffer });
  const r = await resp;
  expect(r.ok()).toBeTruthy();
  const id = (await r.json()).id as string;
  await expect(page.getByTestId(`file-row-${id}`)).toBeVisible({ timeout: 10_000 });
  return id;
}

/** Select a Drive row, "Open file" in the details panel (routes to the
 *  file's editor, here the Slides placeholder at /slides/:fileId), then the
 *  placeholder's "Open in Slides" button. Returns the new deck's id.
 *  (The row menu's nested "Open with" submenu does not open under
 *  Playwright clicks, so the details panel is the reliable UI path.) */
export async function driveOpenIn(page: Page, fileId: string, route: string): Promise<string> {
  await page.getByTestId(`file-row-${fileId}`).click();
  await expect(page.getByTestId("file-details-panel")).toBeVisible();
  await page.getByTestId("panel-open-file").click();
  await page.waitForURL(new RegExp(`/${route}/${fileId}$`));
  await page.getByTestId(`open-in-${route}`).click();
  await page.waitForURL(new RegExp(`/${route}/d/[^/]+$`), { timeout: 30_000 });
  return page.url().split("/").pop()!;
}

export async function driveDelete(request: APIRequestContext, id: string) {
  await request.delete(`${BASE_URL}/api/v1/drive/files/${id}`).catch(() => {});
  await request.delete(`${BASE_URL}/api/v1/drive/files/${id}:forever`).catch(() => {});
}
