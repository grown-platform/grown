import { expect, test, type Page } from "@playwright/test";

/**
 * Wave 3a — page & document management: thumbnail sidebar (jump + per-page menu
 * duplicate/delete/rotate/insert + drag-reorder), page-jump input, fit-to-width
 * / fit-page zoom, and unified undo/redo that covers page operations.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - pages, thumbnails, fit & page-op undo", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  // Open a blank doc. `withThumbs` reveals the (collapsed-by-default) sidebar
  // after the main page has rendered.
  async function openBlank(page: Page, withThumbs = false) {
    await page.goto("/editor");
    await page.getByTestId("editor-new-blank").click();
    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    // Only the main page exists at this point, so this is unambiguous.
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
    if (withThumbs) {
      await page.getByTestId("thumb-toggle").click();
      await expect(page.getByTestId("thumb-sidebar")).toBeVisible();
    }
    return { canvas, box: () => canvas.boundingBox().then((b) => b!) };
  }

  // 0-based thumbnail wrappers only (excludes thumb-sidebar/toggle/menu-*).
  const thumbs = (page: Page) => page.getByTestId(/^thumb-\d+$/);

  test("(a) add pages, thumbnails reflect count, click a thumb to jump", async ({ page }) => {
    await openBlank(page, true);
    const indicator = page.getByTestId("editor-page-indicator");

    // New blank starts at 1 page.
    await expect(indicator).toContainText("/ 1");
    await expect(thumbs(page)).toHaveCount(1);

    // Add two pages (each re-serializes the PDF).
    await page.getByTestId("page-add").click();
    await expect(indicator).toContainText("/ 2");
    await page.getByTestId("page-add").click();
    await expect(indicator).toContainText("/ 3");

    // Thumbnail sidebar shows one thumb per page.
    await expect(page.getByTestId("thumb-sidebar")).toBeVisible();
    await expect(thumbs(page)).toHaveCount(3);

    // Click a thumb to jump. Go to page 1, then to page 3 (0-based thumb-2).
    await page.getByTestId("thumb-0").click();
    await expect(indicator).toContainText("1 / 3");
    await page.getByTestId("thumb-2").click();
    await expect(indicator).toContainText("3 / 3");
  });

  test("(b) delete a page with annotations, undo restores page + annotation", async ({ page }) => {
    const { canvas, box } = await openBlank(page, true);
    const indicator = page.getByTestId("editor-page-indicator");

    // Add a second page and land on it.
    await page.getByTestId("page-add").click();
    await expect(indicator).toContainText("2 / 2");
    await expect(page.locator(".react-pdf__Page").first()).toBeVisible();

    // Place a text box on page 2.
    await page.getByTestId("tool-text").click();
    const b = await box();
    await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.3);
    const ta = page.getByTestId("editor-textarea");
    await expect(ta).toBeVisible();
    await ta.fill("Page Two Note");
    await ta.press("Escape");
    await expect(canvas.getByText("Page Two Note")).toBeVisible();

    // Delete page 2 via the thumbnail menu.
    await page.getByTestId("thumb-menu-1").click();
    await page.getByTestId("thumb-delete").click();
    await expect(indicator).toContainText("/ 1");
    await expect(thumbs(page)).toHaveCount(1);
    await expect(canvas.getByText("Page Two Note")).toHaveCount(0);

    // Undo restores BOTH the page and its annotation.
    await page.getByTestId("editor-undo").click();
    await expect(indicator).toContainText("/ 2");
    await expect(thumbs(page)).toHaveCount(2);

    // The annotation lives on page 2 — navigate there and confirm it is back.
    await page.getByTestId("editor-next-page").click();
    await expect(indicator).toContainText("2 / 2");
    await expect(canvas.getByText("Page Two Note")).toBeVisible();
  });

  test("(c) duplicate a page increases the count", async ({ page }) => {
    await openBlank(page, true);
    const indicator = page.getByTestId("editor-page-indicator");
    await expect(thumbs(page)).toHaveCount(1);

    await page.getByTestId("thumb-menu-0").click();
    await page.getByTestId("thumb-duplicate").click();
    await expect(indicator).toContainText("/ 2");
    await expect(thumbs(page)).toHaveCount(2);
  });

  test("(d) page-jump input navigates to the typed page", async ({ page }) => {
    await openBlank(page);
    const indicator = page.getByTestId("editor-page-indicator");

    await page.getByTestId("page-add").click();
    await expect(indicator).toContainText("/ 2");
    await page.getByTestId("page-add").click();
    await expect(indicator).toContainText("3 / 3");

    // Jump back to page 1 via the input.
    const jump = page.getByTestId("editor-page-jump");
    await jump.fill("1");
    await jump.press("Enter");
    await expect(indicator).toContainText("1 / 3");
  });

  test("(e) fit-width changes the zoom from the default", async ({ page }) => {
    await openBlank(page);
    const zoomLevel = page.getByTestId("editor-zoom-level");
    await expect(zoomLevel).toHaveText("100%");

    await page.getByTestId("zoom-fit-width").click();
    await expect(zoomLevel).not.toHaveText("100%");
  });
});
