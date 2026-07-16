import { expect, test, type Page } from "@playwright/test";

/**
 * Wave 6a — persistence & polish:
 *   (a) autosave a draft to IndexedDB, then restore (or discard) it after reload
 *   (b) keyboard-shortcuts help overlay
 *   (c) arrow-key nudge of the selection
 *
 * Data hooks (added in EditorPage.tsx / draftDb.ts):
 *   - [data-testid="draft-status"] with [data-draft-state="saving|saved|idle"]
 *   - restore-draft-prompt / restore-draft-yes / restore-draft-no
 *   - shortcuts-open / shortcuts-dialog / shortcuts-close
 *   - [data-annot-id] with [data-annot-x] on shape nodes
 *
 * The autosave DB name is "pdf-editor-drafts" (see DRAFT_DB_NAME). We clear it
 * ONCE at the start of each test (not on every navigation) so a draft written
 * before a reload survives to prove the restore flow. Each Playwright test runs
 * in its own browser context, so IndexedDB is already isolated between tests —
 * this clear is belt-and-suspenders and, crucially, keeps a leftover draft from
 * ever popping the restore prompt in the other (fresh-doc) editor specs.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - persistence (Wave 6a)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // The /editor route is auth-guarded; seed the redirect-loop breaker so the
      // editor renders without a backend. (Runs on every navigation.)
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
      // Clear the draft DB exactly once per context (the flag lives in
      // sessionStorage, which survives reloads) so a draft written mid-test is
      // NOT wiped by the reload we use to exercise the restore prompt.
      if (!sessionStorage.getItem("__idbCleared")) {
        sessionStorage.setItem("__idbCleared", "1");
        try {
          indexedDB.deleteDatabase("pdf-editor-drafts");
        } catch {
          /* ignore */
        }
      }
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

  test("(a) autosave a draft, then restore / discard across reloads", async ({ page }) => {
    await openBlank(page);

    // Place a text box with distinctive content.
    await page.getByTestId("tool-text").click();
    const canvas = page.getByTestId("editor-canvas");
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(b.x + b.width * 0.25, b.y + b.height * 0.25);
    const ta = page.getByTestId("editor-textarea");
    await expect(ta).toBeVisible();
    await ta.fill("PersistMe12345");
    await ta.press("Escape");
    await expect(page.locator('[data-annot-kind="text"]')).toContainText("PersistMe12345");

    // Wait for the debounced autosave to report a saved draft.
    await expect(page.getByTestId("draft-status")).toHaveAttribute("data-draft-state", "saved", { timeout: 6000 });

    // Reload → the restore prompt appears (draft exists + nothing loaded).
    await page.reload();
    await expect(page.getByTestId("restore-draft-prompt")).toBeVisible();

    // Restore → the text box comes back on the canvas.
    await page.getByTestId("restore-draft-yes").click();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await expect(page.locator('[data-annot-kind="text"]')).toContainText("PersistMe12345");

    // Reload again, this time DISCARD → land in the empty state, no restore.
    await page.reload();
    await expect(page.getByTestId("restore-draft-prompt")).toBeVisible();
    await page.getByTestId("restore-draft-no").click();
    await expect(page.getByTestId("restore-draft-prompt")).toHaveCount(0);
    await expect(page.getByTestId("editor-dropzone")).toBeVisible();
    await expect(page.locator('[data-annot-kind="text"]')).toHaveCount(0);

    // A further reload must NOT re-offer the discarded draft.
    await page.reload();
    await expect(page.getByTestId("editor-dropzone")).toBeVisible();
    await expect(page.getByTestId("restore-draft-prompt")).toHaveCount(0);
  });

  test("(b) shortcuts help overlay lists the shortcuts", async ({ page }) => {
    await openBlank(page);

    await page.getByTestId("shortcuts-open").click();
    const dialog = page.getByTestId("shortcuts-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Undo");
    await expect(dialog).toContainText("Redo");
    await expect(dialog).toContainText("Nudge");

    await page.getByTestId("shortcuts-close").click();
    await expect(dialog).toHaveCount(0);

    // Pressing "?" reopens it (real browsers emit key "?" for Shift+/).
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-dialog")).toHaveCount(0);
  });

  test("(c) arrow keys nudge the selected shape", async ({ page }) => {
    const { box } = await openBlank(page);

    // Draw a rectangle (auto-selected on commit; tool returns to select).
    await page.getByTestId("tool-rect").click();
    const b = await box();
    await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5, { steps: 10 });
    await page.mouse.up();

    const shape = page.locator("[data-annot-id]").first();
    await expect(shape).toHaveAttribute("data-annot-x", /.+/);
    const x0 = parseFloat((await shape.getAttribute("data-annot-x")) || "0");

    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");

    const x1 = parseFloat((await shape.getAttribute("data-annot-x")) || "0");
    expect(x1).toBeGreaterThan(x0);
  });
});
