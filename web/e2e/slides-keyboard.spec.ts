import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, createDeck, createDoc, getDeckData, saveDeckData, trashDeck, trashDoc } from "./helpers";
import { openDoc } from "./docs/helpers";

// Slides M13: the editor used with the keyboard only (slide rail as a
// multi-select listbox, F6 between panes, Tab through objects, Enter to
// edit, Esc to leave, arrows to nudge, zoom) and the accessibility surface
// (roles, names, alt text, live announcements, the outline view, the
// shortcut list).

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==";

const text = (id: string, t: string, y: number) => ({ id, type: "text", x: 60, y, w: 500, h: 60, text: t, fontSize: 28, color: "#202124" });
const DECK = {
  slides: [
    {
      id: "a",
      background: "#ffffff",
      elements: [
        { ...text("a1", "Alpha", 40), placeholder: { type: "title" } },
        text("a2", "First point\nSecond point", 140),
        { id: "pic", type: "image", x: 600, y: 200, w: 120, h: 120, src: PNG, alt: "Company logo" },
        { id: "pic2", type: "image", x: 760, y: 200, w: 120, h: 120, src: PNG },
      ],
      notes: "Say hello.",
    },
    { id: "b", background: "#ffffff", elements: [text("b1", "Bravo", 40)] },
    { id: "c", background: "#ffffff", elements: [text("c1", "Charlie", 40)] },
    { id: "d", background: "#ffffff", elements: [text("d1", "Delta", 40)] },
  ],
};

const order = async (page: Page, id: string) => ((await getDeckData(page.request, id))?.slides ?? []).map((s) => s.id).join("");

test("slides: keyboard-only editing and accessibility roles", async ({ page }) => {
  const id = await createDeck(page.request, "e2e keyboard deck");
  try {
    await saveDeckData(page.request, id, DECK);
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    const rail = page.getByRole("listbox", { name: "Slides" });
    await expect(rail).toHaveAttribute("aria-multiselectable", "true");
    const options = rail.getByRole("option");
    await expect(options).toHaveCount(4);
    await expect(options.first()).toHaveAccessibleName("Slide 1 of 4: Alpha");

    // ---- the rail: focus, move, extend, reorder, delete
    await options.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toBeFocused();
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");
    // Ctrl+Up moves Bravo+Charlie up one: a, b, c, d → b, c, a, d.
    await page.keyboard.press("ControlOrMeta+ArrowUp");
    await expect(options.nth(0)).toHaveAccessibleName("Slide 1 of 4: Bravo");
    await expect(options.nth(1)).toHaveAccessibleName("Slide 2 of 4: Charlie");
    await expect.poll(() => order(page, id), { timeout: 15_000 }).toBe("bcad");
    // Ctrl+Shift+Down sends them to the end: a, d, b, c.
    await page.keyboard.press("ControlOrMeta+Shift+ArrowDown");
    await expect.poll(() => order(page, id), { timeout: 15_000 }).toBe("adbc");
    // End, then Delete removes the last slide.
    await page.keyboard.press("End");
    await expect(options.nth(3)).toBeFocused();
    await page.keyboard.press("Delete");
    await expect(options).toHaveCount(3);
    await expect.poll(() => order(page, id), { timeout: 15_000 }).toBe("adb");
    await page.keyboard.press("Home");
    await expect(options.nth(0)).toBeFocused();
    await expect(options.nth(0)).toHaveAttribute("aria-current", "true");

    // ---- F6 to the canvas, Tab through objects, live announcements
    await page.keyboard.press("F6");
    const canvas = page.getByRole("region", { name: "Slide 1 of 3, editing canvas" });
    await expect(canvas).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-el-id="a1"]')).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("canvas-announce")).toHaveText("Title: Alpha, selected");
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-el-id="a2"]')).toHaveAttribute("data-selected", "true");
    // Pictures carry their alt text as the accessible name.
    await expect(page.getByRole("img", { name: "Picture: Company logo" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("canvas-announce")).toHaveText("Picture: Company logo, selected");
    // Arrow keys nudge (2 px).
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    await expect
      .poll(async () => (await getDeckData(page.request, id))?.slides[0].elements.find((e) => e.id === "pic"), { timeout: 15_000 })
      .toMatchObject({ x: 602, y: 210 });
    // Shift+Tab back to the text box; Enter edits it, Esc leaves.
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator('[data-el-id="a2"]')).toHaveAttribute("data-selected", "true");
    await page.keyboard.press("Enter");
    const editor = page.locator('[data-el-id="a2"] [contenteditable="true"]');
    await expect(editor).toBeFocused();
    await page.keyboard.type("Intro ");
    await page.keyboard.press("Escape");
    await expect(canvas).toBeFocused();
    await expect(page.locator('[data-el-id="a2"]')).toHaveAttribute("data-selected", "true");
    await expect
      .poll(async () => (await getDeckData(page.request, id))?.slides[0].elements.find((e) => e.id === "a2")?.text, { timeout: 15_000 })
      .toBe("Intro First point\nSecond point");
    // Esc deselects; F6 goes on to the speaker notes.
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-selected="true"]')).toHaveCount(0);
    await page.keyboard.press("F6");
    await expect(page.getByRole("textbox", { name: "Speaker notes for this slide" })).toBeFocused();
    await page.keyboard.press("F6");
    await expect(options.nth(0)).toBeFocused();

    // ---- zoom and paragraph marks
    await page.keyboard.press("F6");
    const before = (await canvas.boundingBox())!.width;
    await page.keyboard.press("ControlOrMeta+Equal");
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(before);
    await page.keyboard.press("ControlOrMeta+Digit0");
    await expect.poll(async () => Math.round((await canvas.boundingBox())!.width)).toBe(Math.round(before));
    await page.keyboard.press("ControlOrMeta+Shift+Digit8");
    await expect(canvas).toHaveAttribute("data-marks", "");
    const mark = await page.locator('[data-el-id="a2"] [data-para]').first().evaluate((el) => getComputedStyle(el, "::after").content);
    expect(mark).toBe('"¶"');
    await page.keyboard.press("ControlOrMeta+Shift+Digit8");
    await expect(canvas).not.toHaveAttribute("data-marks", "");

    // ---- the shortcut list (Ctrl+/)
    await page.keyboard.press("ControlOrMeta+Slash");
    const sc = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(sc).toBeVisible();
    await sc.getByRole("textbox", { name: "Search shortcuts" }).fill("move selected slides");
    await expect(sc.getByRole("rowheader")).toHaveText(["Move selected slides down / up", "Move selected slides to the end / start"]);
    await page.keyboard.press("Escape");
    await expect(sc).toBeHidden();

    // ---- the outline view and the alt-text check
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: /Outline and accessibility/ }).click();
    const outline = page.getByRole("dialog", { name: "Outline" });
    await expect(outline.getByRole("heading", { level: 3 })).toHaveText([/Alpha/, /Delta/, /Bravo/]);
    await expect(outline.getByTestId("missing-alt").getByRole("listitem")).toHaveText(["Slide 1: Picture"]);
    await expect(outline.getByText("Say hello.")).toBeVisible();
    await outline.getByRole("button", { name: "Go to slide 3" }).click();
    await expect(outline).toBeHidden();
    await expect(options.nth(2)).toHaveAttribute("aria-current", "true");
  } finally {
    await trashDeck(page.request, id);
  }
});

// Copy/paste through the system clipboard: elements between two decks (the
// internal payload), then the same copy pasted into a Grown doc as rich
// HTML, and HTML from the doc pasted back as a formatted text box.
test("slides: copy between decks and to/from Docs", async ({ page }) => {
  const a = await createDeck(page.request, "e2e clip source");
  const b = await createDeck(page.request, "e2e clip target");
  const doc = await createDoc(page.request, "e2e clip doc");
  const rich = {
    ...text("rich", "Bold and plain", 300),
    runs: [{ text: "Bold", bold: true }, { text: " and plain" }],
  };
  try {
    await saveDeckData(page.request, a, { slides: [{ id: "a", background: "#ffffff", elements: [rich] }] });
    await saveDeckData(page.request, b, { slides: [{ id: "b", background: "#ffffff", elements: [] }] });
    await page.goto(`${BASE_URL}/slides/d/${a}`);
    await page.locator('[data-el-id="rich"]').click();
    await page.keyboard.press("ControlOrMeta+c");

    // Another deck: the element arrives with its runs.
    await page.goto(`${BASE_URL}/slides/d/${b}`);
    await page.getByTestId("slide-canvas").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("ControlOrMeta+v");
    await expect
      .poll(async () => (await getDeckData(page.request, b))?.slides[0].elements.map((e) => ({ text: e.text, runs: e.runs })), { timeout: 15_000 })
      .toEqual([{ text: "Bold and plain", runs: [{ text: "Bold", bold: true }, { text: " and plain" }] }]);

    // A doc: the HTML flavour keeps the bold.
    await openDoc(page, doc);
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+v");
    await expect(page.locator(".ProseMirror strong")).toHaveText("Bold");
    await expect(page.locator(".ProseMirror")).toContainText("Bold and plain");

    // Back from the doc: its first paragraph pasted into a deck keeps the bold.
    await page.keyboard.press("ControlOrMeta+ArrowUp");
    for (let i = 0; i < "Bold and plain".length; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("ControlOrMeta+c");
    await page.goto(`${BASE_URL}/slides/d/${b}`);
    await page.getByTestId("slide-canvas").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("ControlOrMeta+v");
    await expect
      .poll(async () => {
        const els = (await getDeckData(page.request, b))?.slides[0].elements ?? [];
        return els.map((e) => [e.text, e.runs?.[0]?.text, !!e.runs?.[0]?.bold]);
      }, { timeout: 15_000 })
      .toEqual([
        ["Bold and plain", "Bold", true],
        ["Bold and plain", "Bold", true],
      ]);
  } finally {
    await trashDeck(page.request, a);
    await trashDeck(page.request, b);
    await trashDoc(page.request, doc);
  }
});
