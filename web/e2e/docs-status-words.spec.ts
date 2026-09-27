import { test, expect } from "@playwright/test";
import { createDoc, trashDoc } from "./helpers";
import { openDoc } from "./docs/helpers";

// The status bar's word count follows local typing. It used to be a trailing
// debounce that every keystroke restarted, so it sat at "0 words" for as long
// as someone kept typing (and in screenshots taken right after typing).

test("status bar word count updates while typing", async ({ page }) => {
  const id = await createDoc(page.request, "Word count doc");
  try {
    await openDoc(page, id);
    const words = page.getByTestId("status-words");
    await expect(words).toHaveText("0 words");

    const text =
      "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen";
    const n = text.split(" ").length;
    await page.locator(".ProseMirror").first().click();
    let typingDone = false;
    // ~50 ms between keys: faster than the old 250 ms debounce, so the old
    // count never moved until the typing stopped.
    const typing = page.keyboard.type(text, { delay: 50 }).then(() => {
      typingDone = true;
    });
    await expect(words).not.toHaveText("0 words", { timeout: 4_000 });
    expect(typingDone, "count should update before typing finishes").toBe(false);
    await typing;
    await expect(words).toHaveText(`${n} words`);

    // A new paragraph and more words.
    await page.keyboard.press("Enter");
    await page.keyboard.type("Plus two");
    await expect(words).toHaveText(`${n + 2} words`);
  } finally {
    await trashDoc(page.request, id);
  }
});
