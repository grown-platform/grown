import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

/**
 * Wave 7 — annotation rotation. Rectangular annotations (box shapes, image,
 * text, stamp) carry an optional `rotation` (degrees, clockwise, about the
 * center). A rotate handle above the selection drags to rotate; Shift snaps to
 * 15°. Rotation defaults to 0 and, when 0, exports byte-identically to before.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - annotation rotation", () => {
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

  // Drag the rotate handle so the pointer sits at `targetDeg` around the given
  // screen-space center. rotation = atan2(dy,dx)+90°, so the pointer for angle T
  // is at (cos(T-90°), sin(T-90°)); the resulting rotation is independent of the
  // drag start point (it is derived from the pointer position, not the delta).
  async function rotateViaHandle(page: Page, cx: number, cy: number, targetDeg: number) {
    const handle = page.getByTestId("rotate-handle");
    await expect(handle).toBeVisible();
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    const a = ((targetDeg - 90) * Math.PI) / 180;
    const R = 120;
    await page.mouse.move(cx + R * Math.cos(a), cy + R * Math.sin(a), { steps: 12 });
    await page.mouse.up();
  }

  // Screen-space center of the single annotation node (call BEFORE rotating so
  // the bbox is still axis-aligned = the true center).
  async function annotCenter(page: Page) {
    const node = page.locator("[data-annot-id]").first();
    const bb = (await node.boundingBox())!;
    return { cx: bb.x + bb.width / 2, cy: bb.y + bb.height / 2 };
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

  test("(a) rotate a rectangle ~45°, export stays a valid 1-page PDF", async ({ page }) => {
    const { box } = await openBlank(page);

    // Draw a rectangle (it is auto-selected, tool → select).
    await page.getByTestId("tool-rect").click();
    const b = await box();
    await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5, { steps: 8 });
    await page.mouse.up();

    const rect = page.locator("[data-annot-id]").first();
    await expect(rect).toHaveAttribute("data-annot-rotation", "0");

    // Rotate to ~45° via the on-canvas handle.
    const { cx, cy } = await annotCenter(page);
    await rotateViaHandle(page, cx, cy, 45);

    const rotVal = parseFloat((await rect.getAttribute("data-annot-rotation"))!);
    expect(Math.abs(rotVal - 45)).toBeLessThan(8);

    // Export must not throw and must yield a real single-page PDF.
    const bytes = await downloadBytes(page);
    expect(bytes.length).toBeGreaterThan(0);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
  });

  test("(b) rotate a text box ~90°, download succeeds", async ({ page }) => {
    const { canvas, box } = await openBlank(page);

    // Place a text box "ROT" (stays selected after commit).
    await page.getByTestId("tool-text").click();
    const b = await box();
    await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.35);
    const ta = page.getByTestId("editor-textarea");
    await expect(ta).toBeVisible();
    await ta.fill("ROT");
    await ta.press("Escape");
    await expect(canvas.getByText("ROT")).toBeVisible();

    const textNode = page.locator('[data-annot-kind="text"]').first();
    await expect(textNode).toHaveAttribute("data-annot-rotation", "0");

    const { cx, cy } = await annotCenter(page);
    await rotateViaHandle(page, cx, cy, 90);

    const rotVal = parseFloat((await textNode.getAttribute("data-annot-rotation"))!);
    expect(Math.abs(rotVal - 90)).toBeLessThan(8);

    const bytes = await downloadBytes(page);
    expect(bytes.length).toBeGreaterThan(0);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
  });

  test("(c) non-rotated shape defaults to 0 and still exports (regression)", async ({ page }) => {
    const { box } = await openBlank(page);

    await page.getByTestId("tool-rect").click();
    const b = await box();
    await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.45, { steps: 8 });
    await page.mouse.up();

    // Rotation defaults to 0 (no handle interaction).
    const rect = page.locator("[data-annot-id]").first();
    await expect(rect).toHaveAttribute("data-annot-rotation", "0");

    // A shape with rotation 0 must still export to a valid single-page PDF.
    const bytes = await downloadBytes(page);
    expect(bytes.length).toBeGreaterThan(0);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
  });
});
