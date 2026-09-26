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
      const texts = deck!.slides[1].elements.filter((e) => e.type === "text");
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
});
