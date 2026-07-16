import { expect, test } from "@playwright/test";

/**
 * Wave 9 — accessibility pass. Verifies the additive ARIA/focus work:
 *  (a) the tool palette is a semantic toolbar and its buttons expose an
 *      accessible name + toggle state (aria-pressed) that tracks selection.
 *  (b) a modal dialog is announced as a dialog, moves focus inside on open,
 *      and Escape closes it and returns focus to the opener.
 *
 * Editor-only; no backend. See other editor specs for the auth-bypass note.
 */
test.describe("PDF Editor - accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
    await page.goto("/editor");
    // The toolbar/dialogs only render once a document is loaded.
    await page.getByTestId("editor-new-blank").click();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
  });

  test("toolbar exposes role, accessible names and aria-pressed", async ({ page }) => {
    const toolbar = page.getByRole("toolbar", { name: "Editor tools" });
    await expect(toolbar).toBeVisible();

    // The text tool is reachable by its accessible name.
    const textTool = toolbar.getByRole("button", { name: "Text", exact: true });
    await expect(textTool).toBeVisible();

    // Not selected initially (default tool is Select).
    await expect(textTool).toHaveAttribute("aria-pressed", "false");
    const selectTool = toolbar.getByRole("button", { name: "Select", exact: true });
    await expect(selectTool).toHaveAttribute("aria-pressed", "true");

    // Selecting it flips aria-pressed.
    await textTool.click();
    await expect(textTool).toHaveAttribute("aria-pressed", "true");
    await expect(selectTool).toHaveAttribute("aria-pressed", "false");
  });

  test("metadata dialog: role, modal, focus-in and Escape restores focus", async ({ page }) => {
    const opener = page.getByTestId("metadata-open");
    await opener.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    // Focus moved into the dialog on open.
    const focusInside = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(focusInside).toBe(true);

    // Escape closes it and returns focus to the opener button.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("metadata-dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});
