import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, createDeck, getDeckData, trashDeck } from "./helpers";

// Slides smoke test: open a fresh deck, add a slide and a text box, and check
// the autosave (debounced PUT …/data) persisted both.

async function openDeck(page: Page, id: string) {
  await page.goto(`${BASE_URL}/slides/d/${id}`);
  await expect(
    page.getByRole("textbox", { name: "Presentation title" }),
  ).toBeVisible();
}

function waitForSave(page: Page, id: string) {
  return page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      r.url().includes(`/api/v1/slides/d/${id}/data`) &&
      r.ok(),
    { timeout: 15_000 },
  );
}

test.describe.serial("slides", () => {
  test("add slide and text box autosave", async ({ page }) => {
    const id = await createDeck(page.request, "e2e slides smoke");
    try {
      await openDeck(page, id);

      // New slide (thumbnail rail button) → a second slide appears.
      const saved1 = waitForSave(page, id);
      await page.getByRole("button", { name: "New slide" }).first().click();
      await saved1;

      // Insert a text box on the new slide.
      const saved2 = waitForSave(page, id);
      await page.getByRole("button", { name: "Text box" }).click();
      await saved2;

      const deck = await getDeckData(page.request, id);
      expect(deck?.slides).toHaveLength(2);
      // The new slide has the "Title and content" placeholders (M7) and the box.
      const els = deck!.slides[1].elements as Array<{ type: string; text?: string; placeholder?: { type: string } }>;
      expect(els.filter((e) => e.placeholder).map((e) => e.placeholder!.type)).toEqual(["title", "body"]);
      const texts = els.filter((e) => e.type === "text" && !e.placeholder);
      expect(texts).toHaveLength(1);
      expect(texts[0].text).toBe("Text");

      // Reload: still two slides.
      await page.reload();
      await expect(
        page.getByRole("textbox", { name: "Presentation title" }),
      ).toBeVisible();
      const again = await getDeckData(page.request, id);
      expect(again?.slides).toHaveLength(2);
    } finally {
      await trashDeck(page.request, id);
    }
  });

  test("canvas keyboard shortcuts: duplicate, undo/redo, copy/paste, save", async ({
    page,
  }) => {
    const id = await createDeck(page.request, "e2e slides shortcuts");
    const textCount = async () => {
      const deck = await getDeckData(page.request, id);
      // A fresh deck has no saved data until the first autosave.
      const els = deck?.slides[0]?.elements ?? [];
      return els.filter((e) => e.type === "text").length;
    };
    try {
      await openDeck(page, id);
      // Insert a text box; it becomes the selection (not in text-edit mode).
      let saved = waitForSave(page, id);
      await page.getByRole("button", { name: "Text box" }).click();
      await saved;
      const base = (await textCount()) - 1; // the slide's placeholder boxes

      saved = waitForSave(page, id);
      await page.keyboard.press("Control+d");
      await saved;
      expect(await textCount()).toBe(base + 2);

      saved = waitForSave(page, id);
      await page.keyboard.press("Control+z");
      await saved;
      expect(await textCount()).toBe(base + 1);

      saved = waitForSave(page, id);
      await page.keyboard.press("Control+Shift+z");
      await saved;
      expect(await textCount()).toBe(base + 2);

      saved = waitForSave(page, id);
      await page.keyboard.press("Control+c");
      await page.keyboard.press("Control+v");
      await saved;
      expect(await textCount()).toBe(base + 3);

      // Ctrl+S saves straight away (no 1.2 s debounce, no browser dialog).
      const start = Date.now();
      saved = waitForSave(page, id);
      await page.keyboard.press("Control+s");
      await saved;
      expect(Date.now() - start).toBeLessThan(1000);
    } finally {
      await trashDeck(page.request, id);
    }
  });
});
