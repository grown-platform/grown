import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, createDeck, getDeckData, trashDeck } from "./helpers";

// Slides M7: a new deck starts from the title layout (prompts in empty
// placeholders); Ctrl+Enter walks the placeholders and adds a slide after
// the last; a theme from the gallery restyles the placeholders; a layout
// change; Skip slide; slide numbers; reload; the slideshow skips the
// hidden slide. GROWN_SLIDES_M7_SHOT saves a screenshot of a themed deck
// across several layouts.

const SHOT = process.env.GROWN_SLIDES_M7_SHOT;

type Deck = {
  theme?: { id: string; colors: Record<string, string>; fonts: { major: string } };
  hf?: { sldNum?: boolean };
  slides: Array<{ id: string; layout?: string; hidden?: boolean; elements: any[] }>;
};

function waitForSave(page: Page, id: string) {
  return page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/api/v1/slides/d/${id}/data`) && r.ok(),
    { timeout: 15_000 },
  );
}

async function deck(page: Page, id: string): Promise<Deck> {
  return (await getDeckData(page.request, id)) as unknown as Deck;
}

/** Type into a placeholder: double-click it, type, leave with Esc. */
async function fill(page: Page, id: string, nth: number, text: string) {
  const canvas = page.getByTestId("slide-canvas");
  const el = canvas.locator('[data-el-type="text"]').nth(nth);
  await el.dblclick();
  await page.keyboard.type(text);
  const saved = waitForSave(page, id);
  await page.keyboard.press("Escape");
  await saved;
}

// The same OnlyOffice case as layouts.test.ts (one tag, so the parity
// count isn't inflated); this e2e also covers theme, layout, skip slide and
// reload.
test("oo:slide/shortcuts/shortcuts.js#Check actions for objects with placeholder", async ({ page }) => {
  const id = await createDeck(page.request, "e2e slides theme");
  try {
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    const canvas = page.getByTestId("slide-canvas");
    // Title layout: two empty placeholders showing prompts.
    await expect(canvas.getByTestId("ph-prompt")).toHaveCount(2);
    await expect(canvas.getByText("Click to add title")).toBeVisible();

    await fill(page, id, 0, "Theme test");
    let d = await deck(page, id);
    expect(d.slides[0].layout).toBe("title");
    expect(d.slides[0].elements[0]).toMatchObject({ text: "Theme test", placeholder: { type: "ctrTitle" } });

    // Ctrl+Enter: title → subtitle; on the last placeholder, a new slide
    // (title and content) with its first placeholder selected.
    await canvas.locator('[data-el-type="text"]').first().click();
    await page.keyboard.press("Control+Enter");
    await expect(canvas.locator('[data-el-type="text"]').nth(1)).toHaveAttribute("data-selected", "true");
    let saved = waitForSave(page, id);
    await page.keyboard.press("Control+Enter");
    await saved;
    await expect(page.getByTestId("slide-thumb")).toHaveCount(2);
    await expect(canvas.locator('[data-el-type="text"]').first()).toHaveAttribute("data-selected", "true");
    d = await deck(page, id);
    expect(d.slides[1].layout).toBe("obj");
    expect(d.slides[1].elements.map((e) => e.placeholder.type)).toEqual(["title", "body"]);

    // Theme gallery: Coral restyles the placeholders (colour + heading font).
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Theme", exact: true }).click();
    saved = waitForSave(page, id);
    await page.getByRole("button", { name: "Theme Coral" }).click();
    await saved;
    d = await deck(page, id);
    expect(d.theme!.id).toBe("coral");
    const title = d.slides[0].elements[0];
    expect(title.fontFamily).toBe("Georgia");
    expect(title.color).toBe(d.theme!.colors.dk1);

    // Layout ▸ Two content on slide 2: title kept, two bodies.
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    saved = waitForSave(page, id);
    await page.getByRole("button", { name: "Layout Two content" }).click();
    await saved;
    d = await deck(page, id);
    expect(d.slides[1].layout).toBe("twoObj");
    expect(d.slides[1].elements.map((e) => e.placeholder.type)).toEqual(["title", "body", "body"]);

    // Slide ▸ Skip slide hides slide 2; Insert ▸ Slide numbers switches numbers on.
    saved = waitForSave(page, id);
    await page.getByRole("button", { name: "Slide", exact: true }).click();
    await page.getByRole("menuitem", { name: /Skip slide/ }).click();
    await saved;
    await expect(page.getByTestId("slide-hidden")).toHaveCount(1);
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await page.getByRole("menuitem", { name: "Slide numbers…" }).click();
    await page.getByRole("checkbox", { name: "Slide number" }).check();
    saved = waitForSave(page, id);
    await page.getByRole("button", { name: "Apply to all" }).click();
    await saved;
    await expect(canvas.locator('[data-hf="hf-sldNum"]')).toHaveText("2");

    // Reload: everything persisted.
    await page.reload();
    await expect(page.getByTestId("slide-thumb")).toHaveCount(2);
    await expect(page.getByTestId("slide-hidden")).toHaveCount(1);
    d = await deck(page, id);
    expect(d.theme!.id).toBe("coral");
    expect(d.slides.map((s) => !!s.hidden)).toEqual([false, true]);
    expect(d.hf!.sldNum).toBe(true);
    await expect(canvas.getByText("Theme test")).toBeVisible();
    await expect(canvas.locator('[data-hf="hf-sldNum"]')).toHaveText("1");

    // The slideshow skips the hidden slide: one slide to show.
    await page.getByRole("button", { name: "Present" }).click();
    await expect(page.getByText("1 / 1 · Esc to exit")).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await trashDeck(page.request, id);
  }
});

test("a themed deck across several layouts", async ({ page }) => {
  const id = await createDeck(page.request, "e2e slides theme gallery");
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    const canvas = page.getByTestId("slide-canvas");
    await expect(canvas.getByTestId("ph-prompt")).toHaveCount(2);
    await fill(page, id, 0, "Focus");
    await fill(page, id, 1, "A theme, eight layouts");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Theme", exact: true }).click();
    let saved = waitForSave(page, id);
    await page.getByRole("button", { name: "Theme Focus" }).click();
    await saved;

    const add = async (layout: string, texts: string[]) => {
      await page.getByRole("button", { name: "New slide with layout" }).click();
      const s = waitForSave(page, id);
      await page.getByRole("button", { name: `Layout ${layout}` }).click();
      await s;
      for (let i = 0; i < texts.length; i++) await fill(page, id, i, texts[i]);
    };
    await add("Section header", ["Part one", "Why themes matter"]);
    await add("Two content", ["Compare", "Colours come from the theme", "Fonts too"]);
    await add("Comparison", ["Before / after", "Before", "Hard-coded colours", "After", "Theme references"]);
    await add("Content with caption", ["Caption", "Layouts are data", "Applied by copying"]);

    // A shape in a theme colour, and a gradient background on one slide.
    await page.getByRole("button", { name: "Rectangle" }).click();
    await page.getByRole("button", { name: "Theme fill colour" }).click();
    saved = waitForSave(page, id);
    await page.locator('[data-ref="accent2"]').click();
    await saved;
    const d = await deck(page, id);
    expect(d.theme!.id).toBe("focus");
    expect(d.slides.map((s) => s.layout)).toEqual(["title", "secHead", "twoObj", "twoTxTwoObj", "objTx"]);
    const rect = d.slides[4].elements.find((e) => e.type === "rect");
    expect(rect.themeRefs).toEqual({ fill: "accent2" });

    await page.keyboard.press("Escape");
    await page.getByTestId("slide-thumb").nth(3).click();
    await expect(canvas.getByText("Before / after")).toBeVisible();
    if (SHOT) await page.screenshot({ path: SHOT });
  } finally {
    await trashDeck(page.request, id);
  }
});
