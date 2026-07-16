import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

/**
 * Build a polished multi-page PDF from scratch, download it, and re-parse the
 * exported bytes with pdf-lib to prove real, structurally-valid PDF output.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - from scratch", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders
  // instead (the editor itself needs no backend to load/edit/export).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  test("compose a 2-page PDF and verify the exported bytes", async ({ page }) => {
    await page.goto("/editor");

    await page.getByTestId("editor-new-blank").click();
    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();

    // Add a second page so the doc is multi-page.
    await page.getByTestId("page-add").click();
    await expect(page.getByTestId("editor-page-indicator")).toContainText("/ 2");
    await expect(page.locator(".react-pdf__Page")).toBeVisible();

    const box = () => canvas.boundingBox().then((b) => b!);

    // Title text box (large font).
    await page.getByTestId("tool-text").click();
    let b = await box();
    await page.mouse.click(b.x + b.width * 0.2, b.y + b.height * 0.15);
    let ta = page.getByTestId("editor-textarea");
    await expect(ta).toBeVisible();
    await ta.fill("Project Report");
    await ta.press("Escape");
    await expect(canvas.getByText("Project Report")).toBeVisible();
    // Bump the font size via the properties slider (large title).
    await page.getByTestId("text-size").fill("40");

    // Body text box.
    await page.getByTestId("tool-text").click();
    b = await box();
    await page.mouse.click(b.x + b.width * 0.2, b.y + b.height * 0.45);
    ta = page.getByTestId("editor-textarea");
    await expect(ta).toBeVisible();
    await ta.fill("Prepared automatically by the E2E suite.");
    await ta.press("Escape");
    await expect(canvas.getByText("Prepared automatically by the E2E suite.")).toBeVisible();

    // Draw a rectangle.
    await page.getByTestId("tool-rect").click();
    b = await box();
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.75, { steps: 8 });
    await page.mouse.up();

    // Draw a line.
    await page.getByTestId("tool-line").click();
    b = await box();
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.85);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.85, { steps: 8 });
    await page.mouse.up();

    // Name the document.
    const nameInput = page.getByTestId("editor-docname");
    await nameInput.fill("scratch-report");

    // Download and capture the file.
    await expect(page.getByTestId("editor-download")).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    const savedPath = await download.path();
    const bytes = await fs.promises.readFile(savedPath);

    // Re-parse the exported PDF to prove it is real and 2 pages.
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(2);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
