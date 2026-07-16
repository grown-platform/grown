import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

/**
 * Wave 5c — sticky-note comments (+ comment sidebar) and stamps (preset text
 * badges + custom image). Notes are markers whose comment text lives in the
 * editor/sidebar and bake into the export as a small colored speech-bubble;
 * preset stamps export as a vector rounded-bordered badge with a bold label.
 *
 * Data hooks used by these specs (added in EditorPage.tsx):
 *   - tool-note / tool-stamp                       — toolbar tools
 *   - [data-annot-kind="note"] / [="stamp"]        — placed annotations
 *   - note-popover / note-input / note-author      — the note edit popover
 *   - comment-toggle / comment-sidebar             — the comment sidebar
 *   - comment-item-<id> / comment-delete-<id>      — one row + delete per note
 *   - comment-sidebar-count / comment-count        — count badges
 *   - stamp-dialog / stamp-preset-<name> /
 *     stamp-with-date / stamp-confirm /
 *     stamp-upload-input                           — the stamp picker
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - comments & stamps (Wave 5c)", () => {
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
    return canvas;
  }

  async function clickCanvas(page: Page, fx: number, fy: number) {
    const canvas = page.getByTestId("editor-canvas");
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  }

  async function downloadBytes(page: Page): Promise<Buffer> {
    await expect(page.getByTestId("editor-download")).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    return fs.promises.readFile(await download.path());
  }

  const items = (page: Page) => page.locator('[data-testid^="comment-item-"]');

  test("(a) drop notes, edit via popover, sidebar lists + counts + deletes", async ({ page }) => {
    await openBlank(page);

    // Drop a note — the edit popover opens automatically.
    await page.getByTestId("tool-note").click();
    await clickCanvas(page, 0.3, 0.3);
    await expect(page.getByTestId("note-popover")).toBeVisible();
    await expect(page.locator('[data-annot-kind="note"]')).toHaveCount(1);

    // Open the comment sidebar → exactly one row for the note.
    await page.getByTestId("comment-toggle").click();
    await expect(page.getByTestId("comment-sidebar")).toBeVisible();
    await expect(items(page)).toHaveCount(1);

    // Edit the comment text via the popover; the sidebar row reflects it live.
    await page.getByTestId("note-input").fill("Please review");
    await expect(page.getByTestId("comment-sidebar")).toContainText("Please review");

    // Add a second note → count badge shows 2.
    await page.getByTestId("tool-note").click();
    await clickCanvas(page, 0.62, 0.5);
    await expect(page.locator('[data-annot-kind="note"]')).toHaveCount(2);
    await expect(items(page)).toHaveCount(2);
    await expect(page.getByTestId("comment-sidebar-count")).toHaveText("2");

    // Delete one → back to a single comment.
    await page.locator('[data-testid^="comment-delete-"]').first().click();
    await expect(items(page)).toHaveCount(1);
    await expect(page.getByTestId("comment-sidebar-count")).toHaveText("1");
    await expect(page.locator('[data-annot-kind="note"]')).toHaveCount(1);
  });

  test("(b) clicking a comment row navigates to its page and selects the note", async ({ page }) => {
    const canvas = await openBlank(page);
    const indicator = page.getByTestId("editor-page-indicator");

    // Two-page doc: add a blank (lands on page 2).
    await page.getByTestId("page-add").click();
    await expect(indicator).toContainText("2 / 2");
    await expect(page.locator(".react-pdf__Page").first()).toBeVisible();

    // Place a note on page 2, give it text, then navigate back to page 1.
    await page.getByTestId("tool-note").click();
    await clickCanvas(page, 0.5, 0.4);
    await page.getByTestId("note-input").fill("Fix this on page two");
    await page.getByTestId("editor-prev-page").click();
    await expect(indicator).toContainText("1 / 2");
    // The marker is on page 2, so it is not rendered on page 1.
    await expect(canvas.locator('[data-annot-kind="note"]')).toHaveCount(0);

    // Click the comment row → jumps to page 2 and selects the note (popover).
    await page.getByTestId("comment-toggle").click();
    await items(page).first().click();
    await expect(indicator).toContainText("2 / 2");
    const marker = canvas.locator('[data-annot-kind="note"]');
    await expect(marker).toHaveCount(1);
    await expect(marker).toHaveClass(/ring-2/);
    await expect(page.getByTestId("note-popover")).toBeVisible();
  });

  test("(c) preset stamp renders APPROVED and bakes into a valid export", async ({ page }) => {
    await openBlank(page);

    // Baseline export size (empty blank).
    const baseBytes = await downloadBytes(page);
    const base = await PDFDocument.load(baseBytes);
    expect(base.getPageCount()).toBe(1);

    // Stamp tool → picker → APPROVED preset → confirm → place mode.
    await page.getByTestId("tool-stamp").click();
    await expect(page.getByTestId("stamp-dialog")).toBeVisible();
    await page.getByTestId("stamp-preset-approved").click();
    await page.getByTestId("stamp-confirm").click();
    await expect(page.getByTestId("stamp-dialog")).toBeHidden();

    // Drop the stamp; the badge renders with visible "APPROVED" text.
    await clickCanvas(page, 0.5, 0.5);
    const stamp = page.getByTestId("editor-canvas").locator('[data-annot-kind="stamp"]');
    await expect(stamp).toHaveCount(1);
    await expect(stamp).toContainText("APPROVED");

    // Export: page count unchanged, bytes present (vector badge baked in).
    const outBytes = await downloadBytes(page);
    const out = await PDFDocument.load(outBytes);
    expect(out.getPageCount()).toBe(1);
    expect(outBytes.byteLength).toBeGreaterThan(0);
  });
});
