import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PDF = path.resolve(__dirname, "../../test/pdfs/sample-contract.pdf");

/**
 * Wave 8 — three independent editor features:
 *   (a) Page crop — draw a crop rect, Apply, and the export carries a smaller
 *       CropBox than the page MediaBox (non-destructive, via pdf-lib setCropBox).
 *   (b) Line / arrowhead styles — a selected line's arrowheads are configurable
 *       (none/start/end/both); the on-screen SVG reflects the choice via a
 *       `data-line-arrows` hook, and the export stays a valid PDF.
 *   (c) Configurable highlight color — a swatch palette drives NEW highlights;
 *       the drawn highlight renders in the chosen color (`data-annot-fill`).
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - crop + line styles + highlight color", () => {
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
    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
    return { canvas, box: () => canvas.boundingBox().then((b) => b!) };
  }

  async function downloadBytes(page: Page) {
    await expect(page.getByTestId("editor-download")).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    const savedPath = await download.path();
    return fs.promises.readFile(savedPath!);
  }

  test("(a) crop a real page → export CropBox is smaller than the MediaBox", async ({ page }) => {
    expect(fs.existsSync(SOURCE_PDF)).toBe(true);

    await page.goto("/editor");
    await page.getByTestId("editor-file-input").setInputFiles(SOURCE_PDF);

    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
    const box = () => canvas.boundingBox().then((b) => b!);

    // Enter crop mode and drag out an inner-half crop rectangle.
    await page.getByTestId("page-crop").click();
    const b = await box();
    await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.75, b.y + b.height * 0.75, { steps: 10 });
    await page.mouse.up();

    // The crop rect overlay reflects the dragged area (~0.5 × 0.5 normalized).
    const rectNode = page.getByTestId("crop-rect");
    await expect(rectNode).toBeAttached();
    expect(parseFloat((await rectNode.getAttribute("data-crop-w"))!)).toBeGreaterThan(0.3);
    expect(parseFloat((await rectNode.getAttribute("data-crop-h"))!)).toBeGreaterThan(0.3);

    // Apply the crop, then export.
    await page.getByTestId("crop-apply").click();
    const bytes = await downloadBytes(page);
    expect(bytes.length).toBeGreaterThan(0);

    const out = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const p0 = out.getPage(0);
    const media = p0.getMediaBox();
    const crop = p0.getCropBox();
    // Both dimensions of the crop must be meaningfully smaller than the page.
    expect(crop.width).toBeLessThan(media.width - 1);
    expect(crop.height).toBeLessThan(media.height - 1);
    expect(crop.width).toBeGreaterThan(0);
    expect(crop.height).toBeGreaterThan(0);
  });

  test("(b) line with both arrowheads → SVG reflects it, export valid", async ({ page }) => {
    const { box } = await openBlank(page);

    // Draw an arrow (auto-selected, tool → select afterwards).
    await page.getByTestId("tool-arrow").click();
    const b = await box();
    await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.55, { steps: 10 });
    await page.mouse.up();

    // Default (arrow tool) resolves to an end arrowhead.
    const lineNode = page.locator("[data-line-arrows]").first();
    await expect(lineNode).toHaveAttribute("data-line-arrows", "end");

    // Switch to both endpoints via the line-arrows control.
    await expect(page.getByTestId("line-arrows")).toBeVisible();
    await page.getByTestId("line-arrow-both").click();
    await expect(page.locator("[data-line-arrows]").first()).toHaveAttribute("data-line-arrows", "both");

    // Also verify none / start toggles update the hook.
    await page.getByTestId("line-arrow-none").click();
    await expect(page.locator("[data-line-arrows]").first()).toHaveAttribute("data-line-arrows", "none");
    await page.getByTestId("line-arrow-both").click();

    const bytes = await downloadBytes(page);
    expect(bytes.length).toBeGreaterThan(0);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
  });

  test("(c) pick a green highlight color → drawn highlight renders green", async ({ page }) => {
    const { box } = await openBlank(page);

    await page.getByTestId("tool-highlight").click();
    await expect(page.getByTestId("highlight-color")).toBeVisible();
    await page.getByTestId("highlight-color-green").click();

    const b = await box();
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.36, { steps: 10 });
    await page.mouse.up();

    // The committed highlight carries the chosen green fill.
    const hl = page.locator('[data-annot-kind="highlight"]').first();
    await expect(hl).toBeAttached();
    expect(((await hl.getAttribute("data-annot-fill")) ?? "").toLowerCase()).toBe("#69f0ae");
    // And its rendered SVG fill is the green value too.
    expect(((await hl.getAttribute("fill")) ?? "").toLowerCase()).toBe("#69f0ae");

    const bytes = await downloadBytes(page);
    expect(bytes.length).toBeGreaterThan(0);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
  });
});
