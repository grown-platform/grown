import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PDF = path.resolve(__dirname, "../../test/pdfs/sample-contract.pdf");
// A genuine 2-page PDF so crop-all can be proven across multiple pages.
const MULTI_PDF = path.resolve(__dirname, "../../test/pdfs/multi-party-agreement.pdf");

/**
 * Wave 8 / 3c (advanced) — page-level export edge cases:
 *   (a) Crop RESET restores the full page: crop page 1, apply, then re-enter
 *       crop mode and Reset → the exported CropBox is back to the MediaBox.
 *   (b) crop-all: with "Apply to all pages" checked, EVERY page of a multi-page
 *       doc gets the reduced CropBox on export.
 *   (c) Header/footer Bates targeted to a page RANGE only renders on the pages
 *       in range (preview present on page 2, absent on page 1).
 *
 * Crop/CropBox is asserted by re-parsing the exported bytes with pdf-lib; the
 * Bates range is asserted via the live `hf-preview` DOM (pdf-lib can't easily
 * extract drawn glyph text).
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - pages advanced (crop reset / crop-all / Bates range)", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  async function loadFile(page: Page, file: string) {
    await page.goto("/editor");
    await page.getByTestId("editor-file-input").setInputFiles(file);
    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
    return { canvas, box: () => canvas.boundingBox().then((b) => b!) };
  }

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

  // Drag a crop rectangle over the inner half of the current page.
  async function dragCropRect(page: Page) {
    const canvas = page.getByTestId("editor-canvas");
    const b = (await canvas.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.75, b.y + b.height * 0.75, { steps: 10 });
    await page.mouse.up();
    // The overlay reflects the dragged (~0.5 × 0.5) area.
    const rectNode = page.getByTestId("crop-rect");
    await expect(rectNode).toBeAttached();
    expect(parseFloat((await rectNode.getAttribute("data-crop-w"))!)).toBeGreaterThan(0.3);
    expect(parseFloat((await rectNode.getAttribute("data-crop-h"))!)).toBeGreaterThan(0.3);
  }

  test("(a) crop then RESET restores the full-page CropBox on export", async ({ page }) => {
    expect(fs.existsSync(CONTRACT_PDF)).toBe(true);
    await loadFile(page, CONTRACT_PDF);

    // Crop page 1 and apply (crop mode closes after Apply).
    await page.getByTestId("page-crop").click();
    await dragCropRect(page);
    await page.getByTestId("crop-apply").click();
    await expect(page.getByTestId("crop-panel")).toHaveCount(0);

    // Sanity: the applied crop really did shrink the CropBox.
    const cropped = await PDFDocument.load(await downloadBytes(page), { ignoreEncryption: true });
    const cm = cropped.getPage(0).getMediaBox();
    const cc = cropped.getPage(0).getCropBox();
    expect(cc.width).toBeLessThan(cm.width - 1);
    expect(cc.height).toBeLessThan(cm.height - 1);

    // Re-enter crop mode and Reset → the stored crop is cleared for this page.
    await page.getByTestId("page-crop").click();
    await expect(page.getByTestId("crop-panel")).toBeVisible();
    await page.getByTestId("crop-reset").click();

    const out = await PDFDocument.load(await downloadBytes(page), { ignoreEncryption: true });
    const media = out.getPage(0).getMediaBox();
    const crop = out.getPage(0).getCropBox();
    // With no stored crop, the CropBox falls back to the full MediaBox.
    expect(Math.abs(crop.width - media.width)).toBeLessThan(1);
    expect(Math.abs(crop.height - media.height)).toBeLessThan(1);
  });

  test("(b) crop-all reduces the CropBox on EVERY page of a multi-page doc", async ({ page }) => {
    expect(fs.existsSync(MULTI_PDF)).toBe(true);
    await loadFile(page, MULTI_PDF);
    await expect(page.getByTestId("editor-page-indicator")).toContainText("/ 2");

    await page.getByTestId("page-crop").click();
    // Apply the drawn crop to all pages.
    await page.getByTestId("crop-all").check();
    await dragCropRect(page);
    await page.getByTestId("crop-apply").click();

    const out = await PDFDocument.load(await downloadBytes(page), { ignoreEncryption: true });
    expect(out.getPageCount()).toBe(2);
    for (const i of [0, 1]) {
      const media = out.getPage(i).getMediaBox();
      const crop = out.getPage(i).getCropBox();
      expect(crop.width).toBeLessThan(media.width - 1);
      expect(crop.height).toBeLessThan(media.height - 1);
      expect(crop.width).toBeGreaterThan(0);
      expect(crop.height).toBeGreaterThan(0);
    }
  });

  test("(c) Bates footer targeted to page 2 only previews on page 2, not page 1", async ({ page }) => {
    await openBlank(page);
    // Add a second page → a 2-page doc.
    const indicator = page.getByTestId("editor-page-indicator");
    await page.getByTestId("page-add").click();
    await expect(indicator).toContainText("/ 2");
    await expect(page.locator(".react-pdf__Page").first()).toBeVisible();

    // Start on page 1.
    const jump = page.getByTestId("editor-page-jump");
    await jump.fill("1");
    await jump.press("Enter");
    await expect(indicator).toContainText("1 / 2");

    // Footer-center {bates}, prefix "X", start 5, 4 digits, RANGE "2" only.
    await page.getByTestId("headerfooter-open").click();
    await expect(page.getByTestId("hf-dialog")).toBeVisible();
    await page.getByTestId("hf-footer-center").fill("{bates}");
    await page.getByTestId("hf-bates-prefix").fill("X");
    await page.getByTestId("hf-bates-start").fill("5");
    await page.getByTestId("hf-bates-digits").fill("4");
    await page.getByTestId("hf-range").fill("2");
    await page.getByTestId("hf-apply").click();

    // Page 1 is OUT of range → no header/footer preview is rendered at all.
    await expect(indicator).toContainText("1 / 2");
    await expect(page.getByTestId("hf-preview")).toHaveCount(0);

    // Page 2 is IN range → Bates = prefix + zeroPad(start + pageIndex, digits).
    // pageIndex for page 2 is 1, so "X" + zeroPad(5 + 1, 4) = "X0006".
    await page.getByTestId("editor-next-page").click();
    await expect(indicator).toContainText("2 / 2");
    await expect(page.getByTestId("hf-preview")).toBeVisible();
    await expect(page.getByTestId("hf-preview-footer-center")).toHaveText("X0006");

    // Export still yields a valid 2-page PDF.
    const out = await PDFDocument.load(await downloadBytes(page));
    expect(out.getPageCount()).toBe(2);
  });
});
