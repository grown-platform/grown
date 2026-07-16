import { expect, test, type Page } from "@playwright/test";

/**
 * Wave 2b — arrange: align & distribute, full-perimeter resize handles
 * (corner aspect-lock), and snapping/guides.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - align, distribute, resize & snap", () => {
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

  // Draw a rectangle by dragging (normalized coords), then tint its stroke so
  // the test can locate it by colour.
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
    await page.getByTestId("shape-stroke-color").fill(color);
  }

  const numAttr = async (loc: ReturnType<Page["locator"]>, name: string) =>
    parseFloat((await loc.getAttribute(name))!);

  test("(a) align-left makes two rects share a left edge", async ({ page }) => {
    const { box } = await openBlank(page);
    await drawRect(page, box, 0.2, 0.2, 0.35, 0.32, "#ff0000");
    await drawRect(page, box, 0.5, 0.5, 0.65, 0.62, "#00ff00");

    const rectA = page.locator('rect[stroke="#ff0000"]');
    const rectB = page.locator('rect[stroke="#00ff00"]');

    // Select both: click A, shift-click B.
    const b = await box();
    await page.mouse.click(b.x + b.width * 0.275, b.y + b.height * 0.26);
    await page.keyboard.down("Shift");
    await page.mouse.click(b.x + b.width * 0.575, b.y + b.height * 0.56);
    await page.keyboard.up("Shift");
    await expect(page.getByText("2 selected")).toBeVisible();

    await page.getByTestId("align-left").click();

    const xA = await numAttr(rectA, "data-annot-x");
    const xB = await numAttr(rectB, "data-annot-x");
    expect(Math.abs(xA - xB)).toBeLessThan(0.001);
  });

  test("(b) distribute-h equalizes center gaps of three rects", async ({ page }) => {
    const { box } = await openBlank(page);
    // Three equal-width rects with uneven horizontal spacing, same band.
    await drawRect(page, box, 0.08, 0.4, 0.2, 0.52, "#ff0000");
    await drawRect(page, box, 0.4, 0.4, 0.52, 0.52, "#00ff00");
    await drawRect(page, box, 0.78, 0.4, 0.9, 0.52, "#0000ff");

    // Marquee-select all three from an empty corner.
    const b = await box();
    await page.mouse.move(b.x + b.width * 0.02, b.y + b.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.98, b.y + b.height * 0.65, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByText("3 selected")).toBeVisible();

    await page.getByTestId("distribute-h").click();

    const rects = [
      page.locator('rect[stroke="#ff0000"]'),
      page.locator('rect[stroke="#00ff00"]'),
      page.locator('rect[stroke="#0000ff"]'),
    ];
    const centers: number[] = [];
    for (const r of rects) {
      centers.push((await numAttr(r, "data-annot-x")) + (await numAttr(r, "data-annot-w")) / 2);
    }
    centers.sort((p, q) => p - q);
    const gap1 = centers[1] - centers[0];
    const gap2 = centers[2] - centers[1];
    expect(Math.abs(gap1 - gap2)).toBeLessThan(0.002);
  });

  test("(c) dragging the east handle widens without changing height", async ({ page }) => {
    const { box } = await openBlank(page);
    // Snap off so the resize geometry is deterministic.
    await page.getByTestId("toggle-snap").click();
    await drawRect(page, box, 0.2, 0.3, 0.35, 0.5, "#ff0000");

    const rect = page.locator('rect[stroke="#ff0000"]');
    const w0 = await numAttr(rect, "data-annot-w");
    const h0 = await numAttr(rect, "data-annot-h");

    const handle = page.getByTestId("resize-e");
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 80, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();

    const w1 = await numAttr(rect, "data-annot-w");
    const h1 = await numAttr(rect, "data-annot-h");
    expect(w1).toBeGreaterThan(w0 + 0.05);
    expect(Math.abs(h1 - h0)).toBeLessThan(0.005);
  });

  test("(d) shift + corner resize preserves the aspect ratio", async ({ page }) => {
    const { box } = await openBlank(page);
    await page.getByTestId("toggle-snap").click(); // off
    await drawRect(page, box, 0.25, 0.25, 0.45, 0.4, "#ff0000");

    const rect = page.locator('rect[stroke="#ff0000"]');
    const ratio0 = (await numAttr(rect, "data-annot-w")) / (await numAttr(rect, "data-annot-h"));

    const handle = page.getByTestId("resize-se");
    const hb = (await handle.boundingBox())!;
    await page.keyboard.down("Shift");
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + hb.height / 2 + 40, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up("Shift");

    const ratio1 = (await numAttr(rect, "data-annot-w")) / (await numAttr(rect, "data-annot-h"));
    // Ratio preserved (within a small epsilon) even though we dragged mostly
    // horizontally — aspect-lock drove height from width.
    expect(Math.abs(ratio1 - ratio0)).toBeLessThan(0.02);
    // Sanity: it actually grew.
    expect(await numAttr(rect, "data-annot-w")).toBeGreaterThan(0.2 + 0.03);
  });

  test("(e) snapping aligns a dragged rect's left edge to another's", async ({ page }) => {
    const { box } = await openBlank(page);
    // Reference rect (top) and a second rect (bottom) of the SAME width.
    await drawRect(page, box, 0.3, 0.2, 0.45, 0.32, "#ff0000");
    await drawRect(page, box, 0.55, 0.55, 0.7, 0.67, "#00ff00");

    const rectA = page.locator('rect[stroke="#ff0000"]');
    const rectB = page.locator('rect[stroke="#00ff00"]');
    const xA = await numAttr(rectA, "data-annot-x");

    // Drag rectB so its left edge lands ~3px to the right of rectA's left edge;
    // with snap ON (default) it should snap exactly onto xA.
    const b = await box();
    const bLeftStart = 0.55;
    const target = xA + 3 / b.width; // 3px short of A's left, inside the 6px threshold
    const dragDxPx = (target - bLeftStart) * b.width;
    const startCx = b.x + b.width * (0.55 + 0.075); // rectB center x
    const startCy = b.y + b.height * (0.55 + 0.06); // rectB center y

    await page.mouse.move(startCx, startCy);
    await page.mouse.down();
    await page.mouse.move(startCx + dragDxPx, startCy, { steps: 12 });
    await page.mouse.up();

    const xBafter = await numAttr(rectB, "data-annot-x");
    expect(Math.abs(xBafter - xA)).toBeLessThan(0.001);
  });
});
