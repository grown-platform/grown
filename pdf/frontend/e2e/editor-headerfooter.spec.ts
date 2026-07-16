import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

/**
 * Wave 3c — headers / footers / page numbers / Bates / date stamps. A
 * document-level config with six token-resolving slots. pdf-lib can't easily
 * extract text, so text-content features are verified via the live preview DOM
 * (`hf-preview`) + a successful, larger export rather than by parsing glyphs.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - headers, footers, page numbers, Bates", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  // Open a fresh blank Letter doc (single page).
  async function openBlank(page: Page) {
    await page.goto("/editor");
    await page.getByTestId("editor-new-blank").click();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
  }

  // Add a second page → 2-page doc.
  async function makeTwoPages(page: Page) {
    const indicator = page.getByTestId("editor-page-indicator");
    await page.getByTestId("page-add").click();
    await expect(indicator).toContainText("/ 2");
    await expect(page.locator(".react-pdf__Page").first()).toBeVisible();
  }

  async function downloadBytes(page: Page): Promise<Uint8Array> {
    await expect(page.getByTestId("editor-download")).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    return fs.promises.readFile(await download.path());
  }

  test("(a) footer page numbers preview + export", async ({ page }) => {
    await openBlank(page);
    await makeTwoPages(page);
    const indicator = page.getByTestId("editor-page-indicator");

    // Baseline export (no header/footer) to size-compare against.
    const baseline = await downloadBytes(page);

    // Go to page 1, configure footer-center = "{page} / {pages}", apply.
    const jump = page.getByTestId("editor-page-jump");
    await jump.fill("1");
    await jump.press("Enter");
    await expect(indicator).toContainText("1 / 2");

    await page.getByTestId("headerfooter-open").click();
    await expect(page.getByTestId("hf-dialog")).toBeVisible();
    await page.getByTestId("hf-footer-center").fill("{page} / {pages}");
    await page.getByTestId("hf-apply").click();

    // Preview resolves for the CURRENT page: "1 / 2" on page 1.
    const preview = page.getByTestId("hf-preview");
    await expect(preview).toBeVisible();
    await expect(page.getByTestId("hf-preview-footer-center")).toHaveText("1 / 2");

    // Navigate to page 2 → "2 / 2".
    await page.getByTestId("editor-next-page").click();
    await expect(indicator).toContainText("2 / 2");
    await expect(page.getByTestId("hf-preview-footer-center")).toHaveText("2 / 2");

    // Export succeeds, stays a valid 2-page PDF, and is larger than baseline
    // (drew text + embedded a font).
    const bytes = await downloadBytes(page);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(2);
    expect(bytes.length).toBeGreaterThan(baseline.length);
  });

  test("(b) Bates numbering resolves per page", async ({ page }) => {
    await openBlank(page);
    await makeTwoPages(page);
    const indicator = page.getByTestId("editor-page-indicator");

    const jump = page.getByTestId("editor-page-jump");
    await jump.fill("1");
    await jump.press("Enter");
    await expect(indicator).toContainText("1 / 2");

    await page.getByTestId("headerfooter-open").click();
    await page.getByTestId("hf-header-right").fill("{bates}");
    await page.getByTestId("hf-bates-prefix").fill("ABC");
    await page.getByTestId("hf-bates-start").fill("100");
    await page.getByTestId("hf-bates-digits").fill("6");
    await page.getByTestId("hf-apply").click();

    // Page 1 (index 0): ABC + zeroPad(100 + 0, 6) = ABC000100.
    await expect(page.getByTestId("hf-preview-header-right")).toHaveText("ABC000100");

    // Page 2 (index 1): ABC000101.
    await page.getByTestId("editor-next-page").click();
    await expect(indicator).toContainText("2 / 2");
    await expect(page.getByTestId("hf-preview-header-right")).toHaveText("ABC000101");

    // Export still succeeds.
    const bytes = await downloadBytes(page);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(2);
  });

  test("(c) range limits the header/footer to selected pages", async ({ page }) => {
    await openBlank(page);
    await makeTwoPages(page);
    const indicator = page.getByTestId("editor-page-indicator");

    const jump = page.getByTestId("editor-page-jump");
    await jump.fill("1");
    await jump.press("Enter");
    await expect(indicator).toContainText("1 / 2");

    await page.getByTestId("headerfooter-open").click();
    await page.getByTestId("hf-footer-left").fill("Confidential");
    await page.getByTestId("hf-range").fill("1");
    await page.getByTestId("hf-apply").click();

    // Present on page 1 (in range).
    await expect(page.getByTestId("hf-preview")).toBeVisible();
    await expect(page.getByTestId("hf-preview-footer-left")).toHaveText("Confidential");

    // Absent on page 2 (out of range).
    await page.getByTestId("editor-next-page").click();
    await expect(indicator).toContainText("2 / 2");
    await expect(page.getByTestId("hf-preview")).toHaveCount(0);
  });
});
