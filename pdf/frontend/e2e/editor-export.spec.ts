import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

/**
 * Wave 6b — export options. Two flows:
 *  (a) document metadata → applied to the exported PDF Info dictionary.
 *  (b) render a page to a PNG image and download it.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - export (metadata + image)", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  test("document metadata is written into the exported PDF", async ({ page }) => {
    await page.goto("/editor");

    await page.getByTestId("editor-new-blank").click();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();

    // Open the metadata dialog from the side card and set title + author.
    await page.getByTestId("metadata-open").click();
    await expect(page.getByTestId("metadata-dialog")).toBeVisible();
    await page.getByTestId("meta-title").fill("My Report");
    await page.getByTestId("meta-author").fill("Jane");
    await page.getByTestId("metadata-apply").click();
    await expect(page.getByTestId("metadata-dialog")).toBeHidden();

    // Download and re-parse the exported bytes.
    await expect(page.getByTestId("editor-download")).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    const savedPath = await download.path();
    const bytes = await fs.promises.readFile(savedPath);

    const out = await PDFDocument.load(bytes);
    expect(out.getTitle()).toBe("My Report");
    expect(out.getAuthor()).toBe("Jane");
  });

  test("export the current page as a PNG image", async ({ page }) => {
    await page.goto("/editor");

    await page.getByTestId("editor-new-blank").click();
    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();

    // Place a text box so the page has visible content to rasterize.
    await page.getByTestId("tool-text").click();
    const b = await canvas.boundingBox().then((box) => box!);
    await page.mouse.click(b.x + b.width * 0.2, b.y + b.height * 0.2);
    const ta = page.getByTestId("editor-textarea");
    await expect(ta).toBeVisible();
    await ta.fill("Snapshot me");
    await ta.press("Escape");
    await expect(canvas.getByText("Snapshot me")).toBeVisible();

    // Open the image-export dialog (PNG / current page are the defaults) and go.
    await page.getByTestId("export-image-open").click();
    await expect(page.getByTestId("export-image-dialog")).toBeVisible();
    await page.getByTestId("export-image-format").selectOption("png");
    await page.getByTestId("export-image-scope").selectOption("current");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-image-confirm").click(),
    ]);
    expect(download.suggestedFilename().endsWith(".png")).toBe(true);

    const savedPath = await download.path();
    const bytes = await fs.promises.readFile(savedPath);
    expect(bytes.byteLength).toBeGreaterThan(0);
    // PNG magic bytes: 0x89 'P' 'N' 'G'.
    expect(bytes[0]).toBe(0x89);
    expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  });
});
