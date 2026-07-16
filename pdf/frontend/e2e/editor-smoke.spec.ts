import { expect, test } from "@playwright/test";

/**
 * Editor smoke test: empty state -> new blank -> place & type text ->
 * undo removes it -> redo brings it back.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - smoke", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders
  // instead (the editor itself needs no backend to load/edit/export).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  test("place text, then undo/redo it", async ({ page }) => {
    await page.goto("/editor");

    // Empty state.
    await expect(page.getByRole("heading", { name: "PDF Editor" })).toBeVisible();
    const newBlank = page.getByTestId("editor-new-blank");
    await expect(newBlank).toBeVisible();

    // Start a blank document.
    await newBlank.click();

    // The interactive canvas + a rendered pdf.js page.
    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();

    // Select the text tool and click the page to drop a text box.
    await page.getByTestId("tool-text").click();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);

    // Type into the inline textarea, then blur to commit.
    const textarea = page.getByTestId("editor-textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("Hello E2E");
    await textarea.press("Escape");

    // The committed text renders on the page (scope to the canvas so we don't
    // also match the copy shown in the properties panel textarea).
    await expect(canvas.getByText("Hello E2E")).toBeVisible();

    // Undo removes it.
    await page.getByTestId("editor-undo").click();
    await expect(canvas.getByText("Hello E2E")).toHaveCount(0);

    // Redo brings it back.
    await page.getByTestId("editor-redo").click();
    await expect(canvas.getByText("Hello E2E")).toBeVisible();
  });
});
