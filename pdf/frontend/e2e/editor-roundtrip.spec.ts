import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Wave 6c — editable round-trip.
 *
 * "Save editable copy" (download-editable) builds a PDF from the BASE bytes
 * WITHOUT flattening the annotations and embeds the live editable model as a
 * JSON file attachment ("grown-editor.json"). On load, EditorPage reads that
 * attachment back via pdfjs `getAttachments()` and restores the annotations as
 * EDITABLE objects (not baked into the page), showing an `editable-restored`
 * notice. The flattened Download (editor-download) never embeds the sidecar, so
 * a flattened file does NOT round-trip.
 *
 * Data hooks: download-editable, editable-restored, editor-file-input,
 *   [data-annot-kind="text"], rect[data-annot-id], restore-draft-no.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - editable round-trip (Wave 6c)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // The /editor route is auth-guarded; seed the redirect-loop breaker so the
      // editor renders without a backend.
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
      // Clear the autosave draft DB on EVERY navigation so the restore-draft
      // prompt never interferes with the editable-sidecar round-trip.
      try {
        indexedDB.deleteDatabase("pdf-editor-drafts");
      } catch {
        /* ignore */
      }
    });
  });

  async function openBlank(page: Page) {
    await page.goto("/editor");
    await page.getByTestId("editor-new-blank").click();
    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
    return canvas;
  }

  // Reload → empty state, dismissing the draft prompt if it ever appears.
  async function resetToEmpty(page: Page) {
    await page.reload();
    const noBtn = page.getByTestId("restore-draft-no");
    if (await noBtn.isVisible().catch(() => false)) await noBtn.click();
    await expect(page.getByTestId("editor-dropzone")).toBeVisible();
  }

  test("annotations survive a save→reopen as EDITABLE objects", async ({ page }) => {
    const canvas = await openBlank(page);
    const box = async () => (await canvas.boundingBox())!;

    // Place a distinctive text box.
    await page.getByTestId("tool-text").click();
    let b = await box();
    await page.mouse.click(b.x + b.width * 0.25, b.y + b.height * 0.25);
    const ta = page.getByTestId("editor-textarea");
    await expect(ta).toBeVisible();
    await ta.fill("RoundTrip123");
    await ta.press("Escape");
    await expect(page.locator('[data-annot-kind="text"]')).toContainText("RoundTrip123");

    // Draw a rectangle.
    await page.getByTestId("tool-rect").click();
    b = await box();
    await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.75, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator("rect[data-annot-id]")).toHaveCount(1);
    await expect(page.locator("[data-annot-id]")).toHaveCount(2);

    // Name the document + save an editable copy, capturing the bytes.
    await page.getByTestId("editor-docname").fill("roundtrip-doc");
    await expect(page.getByTestId("download-editable")).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-editable").click(),
    ]);
    const bytes = await fs.promises.readFile(await download.path());
    expect(bytes.byteLength).toBeGreaterThan(0);

    // Persist to a temp file so we can re-load it through the file input.
    const tmp = path.join(os.tmpdir(), `roundtrip-${Date.now()}.pdf`);
    await fs.promises.writeFile(tmp, bytes);

    // Reset the editor to the empty state, then reopen the saved file.
    await resetToEmpty(page);
    await page.getByTestId("editor-file-input").setInputFiles(tmp);

    // The editable layer is restored: notice appears + both annotations return.
    await expect(page.getByTestId("editable-restored")).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
    await expect(page.locator('[data-annot-kind="text"]')).toContainText("RoundTrip123");
    await expect(page.locator("rect[data-annot-id]")).toHaveCount(1);
    await expect(page.locator("[data-annot-id]")).toHaveCount(2);

    // Prove they are EDITABLE (not flattened into the page): select the text —
    // it gains selection chrome — then delete it, dropping the annotation count.
    await page.locator('[data-annot-kind="text"]').click();
    await expect(page.locator('[data-annot-kind="text"]')).toHaveClass(/ring-2/);
    await page.keyboard.press("Delete");
    await expect(page.locator('[data-annot-kind="text"]')).toHaveCount(0);
    await expect(page.locator("[data-annot-id]")).toHaveCount(1);

    await fs.promises.unlink(tmp).catch(() => {});
  });

  test("a flattened download does NOT round-trip as editable", async ({ page }) => {
    const canvas = await openBlank(page);

    // Place a text box so the flattened export has baked content.
    await page.getByTestId("tool-text").click();
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(b.x + b.width * 0.25, b.y + b.height * 0.25);
    const ta = page.getByTestId("editor-textarea");
    await expect(ta).toBeVisible();
    await ta.fill("Flattened999");
    await ta.press("Escape");
    await expect(page.locator('[data-annot-kind="text"]')).toContainText("Flattened999");

    // Flattened Download (editor-download) — carries NO editable sidecar.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    const bytes = await fs.promises.readFile(await download.path());
    const tmp = path.join(os.tmpdir(), `flat-${Date.now()}.pdf`);
    await fs.promises.writeFile(tmp, bytes);

    await resetToEmpty(page);
    await page.getByTestId("editor-file-input").setInputFiles(tmp);

    // File loads, but there is no sidecar: no restore notice, no editable text.
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
    await expect(page.getByTestId("editable-restored")).toHaveCount(0);
    await expect(page.locator('[data-annot-kind="text"]')).toHaveCount(0);

    await fs.promises.unlink(tmp).catch(() => {});
  });
});
