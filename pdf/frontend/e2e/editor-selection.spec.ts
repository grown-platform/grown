import { expect, test, type Page } from "@playwright/test";

/**
 * Wave 2a — selection & object model: multi-select (shift-click + marquee),
 * group move/delete, internal clipboard (copy/paste), and z-order reordering.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - selection & object model", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders
  // instead (the editor itself needs no backend to load/edit/export).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  // Start a blank doc and return a helper that yields the live canvas box.
  async function openBlank(page: Page) {
    await page.goto("/editor");
    await page.getByTestId("editor-new-blank").click();
    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
    return {
      canvas,
      box: () => canvas.boundingBox().then((b) => b!),
    };
  }

  // Draw a rectangle by dragging from (x0,y0) to (x1,y1) in normalized coords,
  // then tint its stroke so the test can locate it by colour.
  async function drawRect(
    page: Page,
    box: () => Promise<{ x: number; y: number; width: number; height: number }>,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
  ) {
    await page.getByTestId("tool-rect").click();
    const b = await box();
    await page.mouse.move(b.x + b.width * x0, b.y + b.height * y0);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * x1, b.y + b.height * y1, { steps: 8 });
    await page.mouse.up();
    // The freshly-drawn rect is selected → tint via the properties panel.
    await page.getByTestId("shape-stroke-color").fill(color);
  }

  test("(a) shift-click multi-select moves both shapes together", async ({ page }) => {
    const { box } = await openBlank(page);

    await drawRect(page, box, 0.15, 0.15, 0.35, 0.3, "#ff0000");
    await drawRect(page, box, 0.45, 0.15, 0.65, 0.3, "#00ff00");
    await drawRect(page, box, 0.15, 0.55, 0.35, 0.7, "#0000ff");

    const rectA = page.locator('rect[stroke="#ff0000"]');
    const rectB = page.locator('rect[stroke="#00ff00"]');
    const rectC = page.locator('rect[stroke="#0000ff"]');

    // Clear, then build a 2-item selection: click A, shift-click B.
    let b = await box();
    await page.mouse.click(b.x + b.width * 0.9, b.y + b.height * 0.9);
    await page.mouse.click(b.x + b.width * 0.25, b.y + b.height * 0.225);
    await page.keyboard.down("Shift");
    await page.mouse.click(b.x + b.width * 0.55, b.y + b.height * 0.225);
    await page.keyboard.up("Shift");
    await expect(page.getByText("2 selected")).toBeVisible();

    const beforeA = (await rectA.boundingBox())!;
    const beforeB = (await rectB.boundingBox())!;
    const beforeC = (await rectC.boundingBox())!;

    // Drag A → the whole selection (A + B) moves; C stays put.
    b = await box();
    await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.225);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.35, { steps: 10 });
    await page.mouse.up();

    const afterA = (await rectA.boundingBox())!;
    const afterB = (await rectB.boundingBox())!;
    const afterC = (await rectC.boundingBox())!;

    expect(afterA.x).toBeGreaterThan(beforeA.x + 20);
    expect(afterA.y).toBeGreaterThan(beforeA.y + 10);
    expect(afterB.x).toBeGreaterThan(beforeB.x + 20);
    expect(afterB.y).toBeGreaterThan(beforeB.y + 10);
    expect(Math.abs(afterC.x - beforeC.x)).toBeLessThan(3);
    expect(Math.abs(afterC.y - beforeC.y)).toBeLessThan(3);
  });

  test("(b) marquee-select all shapes, then delete clears the canvas", async ({ page }) => {
    const { box } = await openBlank(page);

    await drawRect(page, box, 0.2, 0.2, 0.35, 0.32, "#ff0000");
    await drawRect(page, box, 0.5, 0.2, 0.65, 0.32, "#00ff00");
    await drawRect(page, box, 0.2, 0.5, 0.35, 0.62, "#0000ff");
    await expect(page.locator("[data-annot-id]")).toHaveCount(3);

    // Marquee from the empty top-left corner across all three rects.
    const b = await box();
    await page.mouse.move(b.x + b.width * 0.05, b.y + b.height * 0.05);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.8, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByText("3 selected")).toBeVisible();

    await page.keyboard.press("Delete");
    await expect(page.locator("[data-annot-id]")).toHaveCount(0);
  });

  test("(c) copy + paste adds a shape; undo removes the paste", async ({ page }) => {
    const { box } = await openBlank(page);

    await drawRect(page, box, 0.25, 0.25, 0.5, 0.45, "#ff0000");
    await expect(page.locator("[data-annot-id]")).toHaveCount(1);

    // Click the shape to (re)select it and move focus off the colour input, so
    // the clipboard shortcuts aren't suppressed by the "editing a field" guard.
    const b = await box();
    await page.mouse.click(b.x + b.width * 0.375, b.y + b.height * 0.35);
    await expect(page.getByText("1 selected")).toBeVisible();

    // Internal clipboard copy + paste onto the current page.
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await expect(page.locator("[data-annot-id]")).toHaveCount(2);

    // Undo removes just the paste.
    await page.getByTestId("editor-undo").click();
    await expect(page.locator("[data-annot-id]")).toHaveCount(1);
  });

  test("(d) z-order: send to back / bring to front reorders annotations", async ({ page }) => {
    const { box } = await openBlank(page);

    // Two overlapping rects; blue drawn last → on top (index 1), red index 0.
    await drawRect(page, box, 0.2, 0.2, 0.6, 0.5, "#ff0000");
    await drawRect(page, box, 0.3, 0.3, 0.7, 0.6, "#0000ff");

    const red = page.locator('rect[stroke="#ff0000"]');
    const blue = page.locator('rect[stroke="#0000ff"]');
    await expect(red).toHaveAttribute("data-annot-index", "0");
    await expect(blue).toHaveAttribute("data-annot-index", "1");

    // Blue is selected (just drawn). Send it to back.
    await page.getByTestId("z-back").click();
    await expect(blue).toHaveAttribute("data-annot-index", "0");
    await expect(red).toHaveAttribute("data-annot-index", "1");

    // Bring it back to the front.
    await page.getByTestId("z-front").click();
    await expect(blue).toHaveAttribute("data-annot-index", "1");
    await expect(red).toHaveAttribute("data-annot-index", "0");
  });
});
