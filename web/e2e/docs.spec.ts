import { test, expect } from "@playwright/test";
import { createDoc, trashDoc } from "./helpers";
import { openDoc, runCommand } from "./docs/helpers";

// Docs e2e. Runs authenticated (storageState). These exercise the real collab
// path: edits sync over the WebSocket and the backend persists the update log,
// so reload-persistence is genuinely verified (it could not be via an ad-hoc
// CDP tab, whose collab socket never connected).

test.describe.serial("docs", () => {
  test("typed text persists across reload (collab persistence)", async ({
    page,
  }) => {
    const id = await createDoc(page.request, "e2e persist");
    try {
      await openDoc(page, id);
      await page.locator(".ProseMirror").click();
      await page.keyboard.type("The quick brown fox persists.");
      // Allow the collab update to flush to the server.
      await page.waitForTimeout(2500);

      await page.reload();
      await expect(page.locator(".ProseMirror")).toContainText(
        "The quick brown fox persists.",
        { timeout: 15_000 },
      );
    } finally {
      await trashDoc(page.request, id);
    }
  });

  test("insert footnote renders a numbered marker and panel", async ({
    page,
  }) => {
    const id = await createDoc(page.request, "e2e footnote");
    try {
      await openDoc(page, id);
      await page.locator(".ProseMirror").click();
      await page.keyboard.type("Earth is round.");
      await runCommand(page, "Footnote");

      // A [1] marker (CSS counter) appears in the body...
      await expect(page.locator(".footnote-ref")).toHaveCount(1);
      // ...and the Footnotes panel renders at the bottom.
      await expect(page.getByText("Footnotes", { exact: true })).toBeVisible();
      // Type into the auto-focused note.
      await page.keyboard.type("Eratosthenes, c. 240 BC.");
      await expect(page.getByText("Eratosthenes, c. 240 BC.")).toBeVisible();
    } finally {
      await trashDoc(page.request, id);
    }
  });

  test("header content persists across reload", async ({ page }) => {
    const id = await createDoc(page.request, "e2e header");
    try {
      await openDoc(page, id);
      await runCommand(page, "Headers & footers");
      const header = page.locator(".doc-header-region .ProseMirror");
      await expect(header).toBeVisible();
      await header.click();
      await page.keyboard.type("CONFIDENTIAL REPORT");
      await page.waitForTimeout(2500); // flush collab fragment

      await page.reload();
      // The region auto-reveals (its fragment has content) and shows the text.
      await expect(
        page.locator(".doc-header-region").getByText("CONFIDENTIAL REPORT"),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await trashDoc(page.request, id);
    }
  });

  test("suggesting mode marks insertions and deletions", async ({ page }) => {
    const id = await createDoc(page.request, "e2e suggest");
    try {
      await openDoc(page, id);
      await page.locator(".ProseMirror").click();
      await page.keyboard.type("Hello world.");
      await runCommand(page, "Suggesting");

      // New typing becomes a tracked insertion (green underline).
      await page.locator(".ProseMirror").click();
      await page.keyboard.press("End");
      await page.keyboard.type(" Added text.");
      await expect(page.locator(".suggestion-insert").first()).toBeVisible();

      // The Suggestions panel lists the change with Accept/Reject.
      await expect(page.getByText("Suggestions", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Accept all" }),
      ).toBeVisible();
    } finally {
      await trashDoc(page.request, id);
    }
  });
});
