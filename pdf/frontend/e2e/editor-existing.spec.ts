import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PDF = path.resolve(__dirname, "../../test/pdfs/sample-contract.pdf");

/**
 * Load a real existing PDF, annotate it (highlight + text), rotate a page,
 * export, and verify the exported bytes against the source with pdf-lib.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - edit existing PDF", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders
  // instead (the editor itself needs no backend to load/edit/export).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  test("annotate and rotate a real PDF, then verify export", async ({ page }) => {
    // Sanity: the source fixture exists.
    expect(fs.existsSync(SOURCE_PDF)).toBe(true);
    const sourceBytes = await fs.promises.readFile(SOURCE_PDF);
    const source = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
    const sourcePageCount = source.getPageCount();

    await page.goto("/editor");

    // Load the existing PDF through the hidden file input.
    await page.getByTestId("editor-file-input").setInputFiles(SOURCE_PDF);

    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();

    const box = () => canvas.boundingBox().then((b) => b!);

    // Add a highlight by dragging with the highlight tool.
    await page.getByTestId("tool-highlight").click();
    let b = await box();
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.3, { steps: 8 });
    await page.mouse.up();

    // Add a text box.
    await page.getByTestId("tool-text").click();
    b = await box();
    await page.mouse.click(b.x + b.width * 0.2, b.y + b.height * 0.5);
    const ta = page.getByTestId("editor-textarea");
    await expect(ta).toBeVisible();
    await ta.fill("Reviewed by E2E");
    await ta.press("Escape");
    await expect(canvas.getByText("Reviewed by E2E")).toBeVisible();

    // Rotate the current page (rebuilds the underlying PDF).
    await page.getByTestId("page-rotate").click();
    // Wait for the rebuild to finish (download re-enables) and re-render.
    await expect(page.getByTestId("editor-download")).toBeEnabled();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();

    // Download and capture the file.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    const savedPath = await download.path();
    const outBytes = await fs.promises.readFile(savedPath);

    // Re-parse the export and compare against the source.
    const out = await PDFDocument.load(outBytes, { ignoreEncryption: true });
    expect(out.getPageCount()).toBe(sourcePageCount);
    // Annotations were added, so the export should be larger than the source.
    expect(outBytes.byteLength).toBeGreaterThan(sourceBytes.byteLength);
  });
});
