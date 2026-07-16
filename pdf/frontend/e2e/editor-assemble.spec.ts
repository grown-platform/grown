import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Wave 3b — page templates + assembling from multiple PDFs: sized/orientated
 * blank pages via the blank dialog, merge/import another PDF, extract a page
 * range to a download, and delete a page range (undoable).
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
const PDF_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test/pdfs");
const pdfPath = (name: string) => path.join(PDF_DIR, name);

async function pageCountOf(file: string): Promise<number> {
  const bytes = await fs.promises.readFile(pdfPath(file));
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

test.describe("PDF Editor - assemble (templates, merge, extract, delete-range)", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  // Open a fresh blank Letter doc (single page, thumbnails collapsed).
  async function openBlank(page: Page) {
    await page.goto("/editor");
    await page.getByTestId("editor-new-blank").click();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
  }

  // Load an existing PDF from test/pdfs into the empty-state file input.
  async function openExisting(page: Page, file: string) {
    await page.goto("/editor");
    await page.getByTestId("editor-file-input").setInputFiles(pdfPath(file));
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
  }

  test("(a) new blank A4 landscape via the dialog exports at A4 landscape size", async ({ page }) => {
    await openBlank(page);
    const indicator = page.getByTestId("editor-page-indicator");
    await expect(indicator).toContainText("/ 1");

    // Insert an A4 / landscape blank via the dialog (lands as page 2).
    await page.getByTestId("page-blank-dialog").click();
    await page.getByTestId("blank-size").selectOption("A4");
    await page.getByTestId("blank-orientation").selectOption("landscape");
    await page.getByTestId("blank-confirm").click();
    await expect(indicator).toContainText("/ 2");

    // Drop the initial Letter page so the A4 landscape page becomes page 1.
    await page.getByTestId("editor-prev-page").click();
    await expect(indicator).toContainText("1 / 2");
    await page.getByTestId("page-delete").click();
    await expect(indicator).toContainText("/ 1");

    await expect(page.getByTestId("editor-download")).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    const bytes = await fs.promises.readFile(await download.path());
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
    const { width, height } = out.getPage(0).getSize();
    // A4 landscape ≈ 842 × 595 pt (within ±2pt).
    expect(Math.abs(width - 842)).toBeLessThanOrEqual(2);
    expect(Math.abs(height - 595)).toBeLessThanOrEqual(2);
  });

  test("(b) import merges a second PDF; combined count = P + Q", async ({ page }) => {
    const P = await pageCountOf("sample-contract.pdf");
    const Q = await pageCountOf("nda-agreement.pdf");

    await openExisting(page, "sample-contract.pdf");
    const indicator = page.getByTestId("editor-page-indicator");
    await expect(indicator).toContainText(`/ ${P}`);

    // Merge nda-agreement.pdf into the base via the hidden import input.
    await page.getByTestId("page-import-input").setInputFiles(pdfPath("nda-agreement.pdf"));
    await expect(indicator).toContainText(`/ ${P + Q}`);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    const bytes = await fs.promises.readFile(await download.path());
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(P + Q);
  });

  test("(c) extract a single page from a multi-page doc downloads 1 page", async ({ page }) => {
    await openBlank(page);
    const indicator = page.getByTestId("editor-page-indicator");

    // Make it multi-page (2 pages).
    await page.getByTestId("page-add").click();
    await expect(indicator).toContainText("/ 2");
    await expect(page.locator(".react-pdf__Page").first()).toBeVisible();

    await page.getByTestId("page-extract").click();
    await page.getByTestId("extract-range").fill("1");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("extract-confirm").click(),
    ]);
    const bytes = await fs.promises.readFile(await download.path());
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
  });

  test("(d) delete-range removes pages and undo restores them", async ({ page }) => {
    await openBlank(page);
    const indicator = page.getByTestId("editor-page-indicator");

    // Build a 4-page doc.
    await page.getByTestId("page-add").click();
    await page.getByTestId("page-add").click();
    await page.getByTestId("page-add").click();
    await expect(indicator).toContainText("/ 4");

    // Delete pages 2-3 (two pages) → 2 remain.
    await page.getByTestId("page-delete-range").click();
    await page.getByTestId("delete-range").fill("2-3");
    await page.getByTestId("delete-range-confirm").click();
    await expect(indicator).toContainText("/ 2");

    // Undo restores all 4 pages.
    await page.getByTestId("editor-undo").click();
    await expect(indicator).toContainText("/ 4");
  });
});
