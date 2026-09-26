import { test, expect, type Page } from "@playwright/test";
import { createDoc, trashDoc } from "./helpers";
import { openDoc } from "./docs/helpers";

// Docs find & replace bar and as-you-type AutoCorrect in a real browser
// (unit coverage lives in web/app/src/pages/docs/__tests__). Set
// DOCS_FIND_SCREENSHOT to also save a screenshot of the highlighted matches.

// "Desktop Chrome" reports a Windows platform, so the app expects Ctrl.
const MOD = "Control";
const editor = (page: Page) => page.locator(".ProseMirror").first();
const paragraphs = (page: Page) =>
  editor(page).locator("p").evaluateAll((ps) => ps.map((p) => p.textContent ?? ""));

async function withDoc(page: Page, title: string, body: () => Promise<void>) {
  const id = await createDoc(page.request, title);
  try {
    await openDoc(page, id);
    await editor(page).click();
    await body();
  } finally {
    await trashDoc(page.request, id);
  }
}

test.describe.serial("docs: find & replace and autocorrect", () => {
  test("find highlights matches, steps through them and replaces all", async ({ page }) => {
    await withDoc(page, "e2e find replace", async () => {
      await page.keyboard.type("Cat and cat and CAT. ");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Concat the cat.");

      await page.keyboard.press(`${MOD}+f`);
      const bar = page.getByTestId("docs-find-bar");
      await expect(bar).toBeVisible();
      await expect(page.getByTestId("docs-find-input")).toBeFocused();
      await page.keyboard.type("cat");
      await expect(editor(page).locator(".search-match")).toHaveCount(5);
      await expect(page.getByTestId("docs-find-count")).toContainText("of 5");
      const shot = process.env.DOCS_FIND_SCREENSHOT;
      if (shot) {
        await page.mouse.wheel(0, -2000); // show the whole page, header included
        await page.waitForTimeout(300);
        await page.screenshot({ path: shot });
      }

      await page.keyboard.press("Enter");
      await expect(editor(page).locator(".search-match-current")).toHaveCount(1);
      await expect(page.getByTestId("docs-find-count")).toHaveText("1 of 5");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("docs-find-count")).toHaveText("2 of 5");
      await page.keyboard.press("Shift+Enter");
      await expect(page.getByTestId("docs-find-count")).toHaveText("1 of 5");

      // Whole words drops "Concat"; match case keeps only "cat".
      await page.getByTestId("docs-find-word").click();
      await expect(editor(page).locator(".search-match")).toHaveCount(4);
      await page.getByTestId("docs-find-case").click();
      await expect(editor(page).locator(".search-match")).toHaveCount(2);

      await page.keyboard.press(`${MOD}+h`);
      await page.getByTestId("docs-replace-input").fill("dog");
      await page.getByTestId("docs-replace-all").click();
      await expect(page.getByTestId("docs-replace-note")).toHaveText("Replaced 2");
      await expect(editor(page).locator(".search-match")).toHaveCount(0);
      expect(await paragraphs(page)).toEqual(["Cat and dog and CAT. ", "Concat the dog."]);

      await page.getByTestId("docs-find-close").click();
      await expect(page.getByTestId("docs-find-bar")).toHaveCount(0);
    });
  });

  test("autocorrect turns -- into an em dash and straight quotes into smart quotes", async ({ page }) => {
    await withDoc(page, "e2e autocorrect", async () => {
      await page.keyboard.type('she said "wait--no" and it\'s fine (c) ');
      await expect.poll(() => paragraphs(page)).toEqual(["She said “wait—no” and it’s fine © "]);

      // Backspace right after a correction restores the typed text.
      await page.keyboard.type("(tm)");
      await expect.poll(async () => (await paragraphs(page))[0]).toBe("She said “wait—no” and it’s fine © ™");
      await page.keyboard.press("Backspace");
      await expect.poll(async () => (await paragraphs(page))[0]).toBe("She said “wait—no” and it’s fine © (tm)");
    });
  });
});
