import { expect, test, type Page } from "@playwright/test";

/**
 * Wave 2a (advanced) — internal clipboard cut/paste + cross-page paste.
 *   (a) Cut (Ctrl+X) removes the selected shape; Paste (Ctrl+V) brings it back
 *       on the current page (count restored).
 *   (b) Copy on page 1, navigate to page 2, Paste → the clone lands on page 2
 *       (the paste always targets the CURRENT page).
 *
 * The canvas only renders annotations for the current page, so a per-page
 * count is a faithful "is it on this page" assertion.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - clipboard advanced (cut / cross-page paste)", () => {
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

  // Draw a rectangle from (x0,y0)→(x1,y1) in normalized canvas coords.
  async function drawRect(
    page: Page,
    box: () => Promise<{ x: number; y: number; width: number; height: number }>,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) {
    await page.getByTestId("tool-rect").click();
    const b = await box();
    await page.mouse.move(b.x + b.width * x0, b.y + b.height * y0);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * x1, b.y + b.height * y1, { steps: 8 });
    await page.mouse.up();
  }

  test("(a) cut removes the shape; paste restores it on the current page", async ({ page }) => {
    const { box } = await openBlank(page);
    const annots = page.locator("[data-annot-id]");

    await drawRect(page, box, 0.25, 0.25, 0.5, 0.45);
    await expect(annots).toHaveCount(1);

    // Click the shape to (re)select it and move focus off any input so the
    // clipboard shortcuts aren't suppressed by the "editing a field" guard.
    const b = await box();
    await page.mouse.click(b.x + b.width * 0.375, b.y + b.height * 0.35);
    await expect(page.getByText("1 selected")).toBeVisible();

    // Cut → the shape is removed from the page.
    await page.keyboard.press("Control+x");
    await expect(annots).toHaveCount(0);

    // Paste → the cut shape returns on the current page.
    await page.keyboard.press("Control+v");
    await expect(annots).toHaveCount(1);
  });

  test("(b) copy on page 1, paste on page 2 lands the clone on page 2", async ({ page }) => {
    const { box } = await openBlank(page);
    const indicator = page.getByTestId("editor-page-indicator");
    // Only the CURRENT page's annotations are ever in the DOM (shapes live in a
    // page-scoped SVG layer), so a page-wide count is a per-page assertion.
    const annots = page.locator("[data-annot-id]");

    // Draw + select a rectangle on the (stable) initial page 1, then copy it.
    await drawRect(page, box, 0.25, 0.25, 0.5, 0.45);
    const b = await box();
    await page.mouse.click(b.x + b.width * 0.375, b.y + b.height * 0.35);
    await expect(page.getByText("1 selected")).toBeVisible();
    await expect(annots).toHaveCount(1);
    await page.keyboard.press("Control+c");

    // Add a second page (navigation lands on page 2, which is empty).
    await page.getByTestId("page-add").click();
    await expect(indicator).toContainText("2 / 2");
    await expect(page.locator(".react-pdf__Page").first()).toBeVisible();
    await expect(annots).toHaveCount(0);

    // Paste → the clone lands on the current page (page 2).
    await page.keyboard.press("Control+v");
    await expect(annots).toHaveCount(1);

    // The original still lives on page 1 (copy, not move).
    await page.getByTestId("editor-prev-page").click();
    await expect(indicator).toContainText("1 / 2");
    await expect(annots).toHaveCount(1);
  });
});
