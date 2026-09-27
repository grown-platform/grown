import { expect, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BASE_URL } from "../helpers";

// Shared helpers for the Docs integration specs (web/e2e/integration/docs-*).

/** The document body (the header/footer margin editors are also .ProseMirror). */
export const editor = (page: Page) =>
  page.locator(".ProseMirror:not(.margin-editor .ProseMirror)").first();

/** Top-level menu → item by test id or menu item name. */
export async function menu(page: Page, top: string, item: string | RegExp, byTestId = false) {
  await page.getByRole("button", { name: top, exact: true }).first().click();
  if (byTestId && typeof item === "string") await page.getByTestId(item).click();
  else await page.getByRole("menuitem", { name: item }).first().click();
}

/** Selects `needle` (or puts the caret at its start/end) through the DOM
 *  selection, then lets ProseMirror's async selectionchange land (docs.md,
 *  "Known flaky e2e": the async-selection race). */
export async function selectText(page: Page, needle: string, collapse?: "start" | "end") {
  await editor(page).focus();
  const ok = await page.evaluate(
    ({ needle, collapse }) => {
      const root = document.querySelector(".ProseMirror:not(.margin-editor .ProseMirror)") as HTMLElement;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n.textContent ?? "").indexOf(needle);
        if (i < 0) continue;
        const a = collapse === "end" ? i + needle.length : i;
        const b = collapse === "start" ? i : i + needle.length;
        window.getSelection()!.setBaseAndExtent(n, collapse ? a : i, n, collapse ? a : b);
        return true;
      }
      return false;
    },
    { needle, collapse },
  );
  expect(ok, `"${needle}" in the document`).toBe(true);
  await page.waitForTimeout(150);
}

/** Opens File ▸ Download ▸ <label> and returns the download bytes and name. */
export async function downloadAs(page: Page, label: string): Promise<{ bytes: Buffer; name: string }> {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByText("Download", { exact: true }).click();
  const [download]: [Download, void] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("menuitem", { name: label }).click(),
  ]);
  const bytes = await readFile((await download.path())!);
  return { bytes, name: download.suggestedFilename() };
}

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  md: "text/markdown",
  html: "text/html",
  txt: "text/plain",
  epub: "application/epub+zip",
  pdf: "application/pdf",
};
export const mimeFor = (name: string) => MIME[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

/** Imports a file from the Docs home (the Import button) and waits for the
 *  new document to be connected. Returns its id. */
export async function importFromHome(page: Page, name: string, buffer: Buffer): Promise<string> {
  // A hard load of /docs serves the public documentation site; the Docs
  // home is reached client-side from the launcher.
  await page.goto(`${BASE_URL}/`);
  await page.getByTestId("tile-docs").click();
  await expect(page.getByTestId("docs-import")).toBeVisible();
  await page.getByTestId("docs-import-input").setInputFiles({ name, mimeType: mimeFor(name), buffer });
  await page.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
  await expect(editor(page)).toBeVisible();
  return page.url().split("/").pop()!;
}

/** Uploads a file through Drive's UI and returns its Drive file id. */
export async function uploadToDrive(page: Page, name: string, buffer: Buffer): Promise<string> {
  await page.goto(`${BASE_URL}/`);
  await page.getByTestId("tile-drive").click();
  await page.waitForURL(`${BASE_URL}/drive`);
  const uploaded = page.waitForResponse(
    (r) => r.url().includes("/api/v1/drive/files/upload") && r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByTestId("drive-upload-input").setInputFiles({ name, mimeType: mimeFor(name), buffer });
  const res = await uploaded;
  expect(res.ok(), `upload ${name}: ${res.status()}`).toBeTruthy();
  const row = page.locator('[data-testid^="file-row-"]', { hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  return (await row.getAttribute("data-testid"))!.replace("file-row-", "");
}

/** Drive: open the row (double-click → the mapped editor route, the same
 *  handler as the row menu's Open with ▸ Docs) → EditorPlaceholder →
 *  "Open in Docs" → the new document. Returns the new doc id. */
export async function openInDocsFromDrive(page: Page, fileId: string): Promise<string> {
  await page.getByTestId(`file-row-${fileId}`).locator("p").first().dblclick();
  await page.waitForURL(new RegExp(`/docs/${fileId}$`));
  await page.getByTestId("open-in-docs").click();
  await page.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
  await expect(editor(page)).toBeVisible();
  return page.url().split("/").pop()!;
}

/** Trash and permanently delete a Drive file (best effort). */
export async function purgeDriveFile(page: Page, id: string) {
  await page.request.delete(`${BASE_URL}/api/v1/drive/files/${id}`).catch(() => {});
  await page.request.delete(`${BASE_URL}/api/v1/drive/files/${id}:forever`).catch(() => {});
}

/** Pastes HTML into the body as a clipboard paste would. */
export async function pasteHtml(page: Page, html: string) {
  await editor(page).click();
  await page.evaluate((h) => {
    const dt = new DataTransfer();
    dt.setData("text/html", h);
    dt.setData("text/plain", "x");
    document
      .querySelector(".ProseMirror:not(.margin-editor .ProseMirror)")!
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, html);
}

/** A small PNG drawn in the page. */
export async function makePng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 80;
    const g = c.getContext("2d")!;
    g.fillStyle = "#1a73e8";
    g.fillRect(0, 0, 120, 80);
    g.fillStyle = "#fbbc04";
    g.fillRect(30, 20, 60, 40);
    return c.toDataURL("image/png").split(",")[1];
  });
  return Buffer.from(b64, "base64");
}
