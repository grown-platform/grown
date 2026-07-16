import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

/**
 * Wave 4b — signatures / initials / date / Fill & Sign. A typed signature is
 * rendered to a PNG and placed as an image annotation (baking into the exported
 * PDF via pdf-lib's embed path); a date stamp is a text annotation; quick Fill &
 * Sign stamps are vector marks.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - signing & Fill & Sign", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  async function openBlank(page: Page) {
    await page.goto("/editor");
    await page.getByTestId("editor-new-blank").click();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
  }

  async function downloadBytes(page: Page): Promise<Buffer> {
    await expect(page.getByTestId("editor-download")).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    return fs.promises.readFile(await download.path());
  }

  async function clickCanvas(page: Page, fx: number, fy: number) {
    const canvas = page.getByTestId("editor-canvas");
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  }

  test("(a) typed signature places an image annotation and bakes into the export", async ({ page }) => {
    await openBlank(page);

    // Baseline: an empty blank doc's exported size.
    const baseBytes = await downloadBytes(page);
    const base = await PDFDocument.load(baseBytes);
    expect(base.getPageCount()).toBe(1);

    // Signature tool → Create dialog → Type "Jane Doe" → confirm → place mode.
    await page.getByTestId("tool-signature").click();
    await expect(page.getByTestId("sig-dialog")).toBeVisible();
    await page.getByTestId("sig-tab-type").click();
    await page.getByTestId("sig-type-input").fill("Jane Doe");
    await page.getByTestId("sig-confirm").click();
    await expect(page.getByTestId("sig-dialog")).toBeHidden();

    // Click the page to drop the signature as an image annotation.
    await clickCanvas(page, 0.4, 0.4);
    const imgAnnot = page.getByTestId("editor-canvas").locator("div[data-annot-id] img");
    await expect(imgAnnot).toHaveCount(1);

    // Export: the embedded PNG makes the file meaningfully larger than baseline.
    const sigBytes = await downloadBytes(page);
    const out = await PDFDocument.load(sigBytes);
    expect(out.getPageCount()).toBe(1);
    expect(sigBytes.byteLength).toBeGreaterThan(baseBytes.byteLength + 1000);
  });

  test("(b) date tool stamps today's date as editable text", async ({ page }) => {
    await openBlank(page);

    const today = new Date().toLocaleDateString();

    await page.getByTestId("tool-date").click();
    await clickCanvas(page, 0.3, 0.3);

    // The date renders as a text annotation on the canvas.
    await expect(page.getByTestId("editor-canvas").getByText(today, { exact: false })).toBeVisible();
  });

  test("(c) Fill & Sign checkmark stamp adds a vector annotation", async ({ page }) => {
    await openBlank(page);

    const annots = page.locator("[data-annot-id]");
    await expect(annots).toHaveCount(0);

    // Reveal the quick-fill toolbar, pick the checkmark, drop it on the page.
    await page.getByTestId("toggle-fillsign").click();
    await expect(page.getByTestId("fillsign-toolbar")).toBeVisible();
    await page.getByTestId("stamp-check").click();
    await clickCanvas(page, 0.5, 0.5);

    await expect(annots).toHaveCount(1);

    // The mark bakes into a downloadable PDF.
    const bytes = await downloadBytes(page);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
