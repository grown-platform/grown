import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

/**
 * Wave 5a — content & markup: true eraser (incl. partial ink erase), more
 * shapes (rounded rect, polygon, polyline, dashed strokes), and richer text
 * (alignment, bullet/numbered lists, line spacing).
 *
 * Data hooks used by these specs (added in EditorPage.tsx):
 *   - [data-annot-id]                — one per annotation (count = annotations)
 *   - [data-annot-kind="ink"]        — ink polylines; [data-ink-points] = point count
 *   - [data-annot-kind="text"]       — text nodes; [data-text-align] /
 *                                      [data-text-list] / [data-text-linespacing]
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - markup (Wave 5a)", () => {
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

  // Drag a rectangle in normalized page coords using the given tool testid.
  async function dragShape(
    page: Page,
    box: () => Promise<{ x: number; y: number; width: number; height: number }>,
    toolId: string,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) {
    await page.getByTestId(toolId).click();
    const b = await box();
    await page.mouse.move(b.x + b.width * x0, b.y + b.height * y0);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * x1, b.y + b.height * y1, { steps: 10 });
    await page.mouse.up();
  }

  test("(a) eraser deletes a clicked shape; undo restores it", async ({ page }) => {
    const { box } = await openBlank(page);

    await dragShape(page, box, "tool-rect", 0.15, 0.15, 0.35, 0.3);
    await dragShape(page, box, "tool-rect", 0.6, 0.6, 0.8, 0.75);
    await expect(page.locator("[data-annot-id]")).toHaveCount(2);

    // Erase the first rect by clicking its centre.
    await page.getByTestId("tool-eraser").click();
    const b = await box();
    await page.mouse.click(b.x + b.width * 0.25, b.y + b.height * 0.225);
    await expect(page.locator("[data-annot-id]")).toHaveCount(1);

    // Undo restores the erased shape.
    await page.getByTestId("editor-undo").click();
    await expect(page.locator("[data-annot-id]")).toHaveCount(2);
  });

  test("(b) eraser splits an ink stroke where it crosses", async ({ page }) => {
    const { box } = await openBlank(page);

    // Draw a horizontal freehand stroke across the middle of the page.
    await page.getByTestId("tool-draw").click();
    let b = await box();
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5, { steps: 15 });
    await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.5, { steps: 15 });
    await page.mouse.up();

    const inks = page.locator('[data-annot-kind="ink"]');
    await expect(inks).toHaveCount(1);
    const before = parseInt((await inks.first().getAttribute("data-ink-points")) || "0", 10);
    expect(before).toBeGreaterThan(2);

    // Erase through the middle → the stroke splits into two separate inks.
    await page.getByTestId("tool-eraser").click();
    await page.getByTestId("eraser-size").fill("20");
    b = await box();
    await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5);

    await expect(inks).toHaveCount(2);
    // Each survivor has fewer points than the original whole stroke.
    const p0 = parseInt((await inks.nth(0).getAttribute("data-ink-points")) || "0", 10);
    const p1 = parseInt((await inks.nth(1).getAttribute("data-ink-points")) || "0", 10);
    expect(p0).toBeLessThan(before);
    expect(p1).toBeLessThan(before);
  });

  test("(c) rounded rect + dashed stroke export re-parses cleanly", async ({ page }) => {
    const { box } = await openBlank(page);

    // Turn on the dashed default, then draw a rounded rectangle.
    await page.getByTestId("tool-rrect").click();
    await page.getByTestId("shape-dash").click();
    await dragShape(page, box, "tool-rrect", 0.25, 0.3, 0.6, 0.6);
    await expect(page.locator("[data-annot-id]")).toHaveCount(1);

    await page.getByTestId("editor-docname").fill("rrect-dashed");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    const bytes = await fs.promises.readFile(await download.path());

    // Structural sanity: still one page, real bytes (rounding/dash are visual).
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  test("(d) text box: center-align + numbered list + 2.0 line spacing", async ({ page }) => {
    const { box } = await openBlank(page);

    await page.getByTestId("tool-text").click();
    const b = await box();
    await page.mouse.click(b.x + b.width * 0.2, b.y + b.height * 0.2);
    const ta = page.getByTestId("editor-textarea");
    await expect(ta).toBeVisible();
    await ta.fill("Alpha\nBeta\nGamma");
    await ta.press("Escape");

    // Apply alignment, numbered list and 2.0 line spacing from the properties panel.
    await page.getByTestId("text-align-center").click();
    await page.getByTestId("text-list-number").click();
    await page.getByTestId("text-line-spacing").selectOption("2");

    // On-screen render reflects the numbered prefixes + settings.
    const textNode = page.locator('[data-annot-kind="text"]');
    await expect(textNode).toContainText("1. Alpha");
    await expect(textNode).toContainText("2. Beta");
    await expect(textNode).toContainText("3. Gamma");
    await expect(textNode).toHaveAttribute("data-text-align", "center");
    await expect(textNode).toHaveAttribute("data-text-list", "number");
    await expect(textNode).toHaveAttribute("data-text-linespacing", "2");

    // Export still succeeds with the rich-text layout.
    await page.getByTestId("editor-docname").fill("rich-text");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    const bytes = await fs.promises.readFile(await download.path());
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
