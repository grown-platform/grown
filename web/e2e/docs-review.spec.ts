import { test, expect, type Page } from "@playwright/test";
import { createDoc, trashDoc } from "./helpers";
import { openDoc } from "./docs/helpers";

// Docs M5: track changes in the real app. Turns tracking on for everyone,
// makes an insertion, a deletion and a formatting change, checks the review
// popover and the grouped change list, switches the four display modes,
// accepts one change and rejects another, then reloads and checks what the
// Yjs log kept (the remaining change and the document-wide tracking).
//
// Set DOCS_M5_SCREENSHOT to a path to save a screenshot of Markup mode with
// the change list.

const editor = (page: Page) => page.locator(".ProseMirror").first();

/** selectText selects `needle` (or, with `collapse`, puts the caret at its
 *  start / end) through the DOM selection, the way a mouse drag would, and
 *  lets ProseMirror's async selectionchange land. */
async function selectText(page: Page, needle: string, collapse?: "start" | "end", offset = 0) {
  await editor(page).focus();
  const ok = await page.evaluate(
    ({ needle, collapse, offset }) => {
      const root = document.querySelector(".ProseMirror") as HTMLElement;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const i = (n.textContent ?? "").indexOf(needle);
        if (i < 0) continue;
        const r = document.createRange();
        const a = i + offset;
        if (collapse === "start") r.setStart(n, a), r.setEnd(n, a);
        else if (collapse === "end") r.setStart(n, a + needle.length), r.setEnd(n, a + needle.length);
        else r.setStart(n, a), r.setEnd(n, a + needle.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      }
      return false;
    },
    { needle, collapse, offset },
  );
  expect(ok, `"${needle}" in the document`).toBe(true);
  await page.waitForTimeout(150);
}

async function setDisplay(page: Page, label: string) {
  await page.getByTestId("review-display").click();
  await page.getByRole("option", { name: new RegExp(`^${label}`) }).click();
}

const card = (page: Page, kind: string) => page.locator(`[data-testid="change-card"][data-kind="${kind}"]`);

test.describe("docs track changes", () => {
  test.describe.configure({ mode: "serial" });

  test("track, review, display modes, accept/reject, reload", async ({ page }) => {
    const id = await createDoc(page.request, "e2e review");
    try {
      await openDoc(page, id);
      await editor(page).click();
      await page.keyboard.type("The quick brown fox jumps.");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Second line stays.");

      // Suggesting from the mode chip opens the review panel; then switch
      // tracking on for everyone.
      await page.getByTestId("mode-menu").click();
      await page.getByRole("menuitem", { name: "Suggesting" }).click();
      await expect(page.getByTestId("review-panel")).toBeVisible();
      await expect(page.getByTestId("mode-menu")).toHaveText(/Suggesting/);
      await page.getByTestId("track-changes-menu").click();
      await page.getByTestId("track-on-everyone").click();
      await expect(page.getByTestId("track-changes-menu")).toHaveText(/On for everyone/);

      // Insertion.
      await selectText(page, "fox", "end");
      await page.keyboard.type(" red");
      await expect(editor(page).locator(".suggestion-insert")).toHaveText(" red");
      // Deletion.
      await selectText(page, "quick ");
      await page.keyboard.press("Backspace");
      await expect(editor(page).locator(".suggestion-delete")).toHaveText("quick ");
      // Formatting.
      await selectText(page, "jumps");
      await page.keyboard.press("Control+b");
      await expect(editor(page).locator(".suggestion-format")).toHaveText("jumps");
      await expect(editor(page).locator(".suggestion-format strong, strong .suggestion-format")).toHaveCount(1);
      // A tracked paragraph mark.
      await selectText(page, "Second", "start", 7);
      await page.keyboard.press("Enter");
      await expect(editor(page).locator("[data-para-change-type='insert']")).toHaveCount(1);

      // The grouped change list.
      await expect(page.getByTestId("change-card")).toHaveCount(4);
      await expect(card(page, "insert").filter({ hasText: "red" })).toHaveCount(1);
      await expect(card(page, "insert").filter({ hasText: "Inserted paragraph" })).toHaveCount(1);
      await expect(card(page, "delete")).toContainText("quick");
      await expect(card(page, "format")).toContainText("jumps");

      // The review popover: author and date for the change at the caret.
      await selectText(page, "red", "start", 1);
      const pop = page.getByTestId("review-popover");
      await expect(pop).toBeVisible();
      await expect(page.getByTestId("review-popover-author")).not.toHaveText("");
      await expect(page.getByTestId("review-popover-date")).toContainText("Today");
      await expect(pop).toContainText("Inserted");
      await expect(page.getByTestId("change-count")).toHaveText(/^\d of 4$/);

      // Markup screenshot with the change list.
      const shot = process.env.DOCS_M5_SCREENSHOT;
      if (shot) {
        await page.waitForTimeout(300);
        await page.screenshot({ path: shot, fullPage: false });
      }

      // Display modes.
      await setDisplay(page, "Final");
      await expect(editor(page).locator(".suggestion-delete")).toBeHidden();
      await expect(editor(page).locator(".suggestion-insert")).toBeVisible();
      await expect(editor(page).locator(".suggestion-insert")).toHaveCSS("text-decoration-line", "none");
      await setDisplay(page, "Original");
      await expect(editor(page).locator(".suggestion-insert")).toBeHidden();
      await expect(editor(page).locator(".suggestion-delete")).toBeVisible();
      await expect(editor(page).locator(".suggestion-delete")).toHaveCSS("text-decoration-line", "none");
      await setDisplay(page, "Simple markup");
      await expect(editor(page).locator(".suggestion-delete")).toBeHidden();
      await expect(page.getByTestId("doc-editor")).toHaveClass(/review-simple/);
      await setDisplay(page, "Markup");
      await expect(editor(page).locator(".suggestion-delete")).toBeVisible();

      // Accept the insertion, reject the deletion.
      await card(page, "insert").filter({ hasText: "red" }).getByRole("button", { name: "Accept" }).click();
      await expect(editor(page).locator(".suggestion-insert")).toHaveCount(0);
      await card(page, "delete").getByRole("button", { name: "Reject" }).click();
      await expect(editor(page).locator(".suggestion-delete")).toHaveCount(0);
      await expect(editor(page).locator("p").first()).toHaveText("The quick brown fox red jumps.");
      await expect(page.getByTestId("change-card")).toHaveCount(2);

      // Reload: the remaining changes and "on for everyone" persist.
      await page.waitForTimeout(1000);
      await page.reload();
      await expect(editor(page)).toBeVisible();
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      await expect(editor(page).locator("p").first()).toHaveText("The quick brown fox red jumps.", { timeout: 10_000 });
      await expect(editor(page).locator(".suggestion-format")).toHaveText("jumps");
      await expect(editor(page).locator(".suggestion-format")).toHaveAttribute("data-date", /^\d{4}-\d\d-\d\dT/);
      await expect(editor(page).locator("[data-para-change-type='insert']")).toHaveCount(1);
      await expect(page.getByTestId("mode-menu")).toHaveText(/Suggesting/);
      // Reject the formatting change from the panel's current-change buttons.
      await page.getByTestId("mode-menu").click();
      await page.getByRole("menuitem", { name: "Suggesting" }).click();
      await expect(page.getByTestId("change-card")).toHaveCount(2);
      await page.getByRole("button", { name: "Next change" }).click();
      await expect(page.getByTestId("change-count")).toHaveText("1 of 2");
      await expect(card(page, "format")).toHaveAttribute("data-current", "true");
      await page.getByRole("button", { name: "Reject current change" }).click();
      await expect(editor(page).locator(".suggestion-format")).toHaveCount(0);
      await expect(editor(page).locator("strong")).toHaveCount(0);
      await page.getByRole("button", { name: "Accept all" }).click();
      await expect(page.getByTestId("change-card")).toHaveCount(0);
      await expect(editor(page).locator("p")).toHaveText(["The quick brown fox red jumps.", /^Second\s*$/, /^\s*line stays\.$/]);
    } finally {
      await trashDoc(page.request, id);
    }
  });
});
