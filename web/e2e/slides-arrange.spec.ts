import { test, expect, type Page } from "@playwright/test";
import {
  BASE_URL,
  createDeck,
  getDeckData,
  saveDeckData,
  trashDeck,
} from "./helpers";

// Slides M2: marquee-select two shapes, align them, group them, drag the
// group (smart guides show at the slide centre), reload, and check the
// group persisted with both members.

const SHOT = process.env.GROWN_SLIDES_M2_SHOT;

const rect = (id: string, x: number, y: number, fill: string) => ({
  id,
  type: "rect",
  x,
  y,
  w: 120,
  h: 80,
  fill,
  stroke: "none",
  strokeWidth: 0,
});

function waitForSave(page: Page, id: string) {
  return page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      r.url().includes(`/api/v1/slides/d/${id}/data`) &&
      r.ok(),
    { timeout: 15_000 },
  );
}

/** Screen position of a logical (960×540) canvas point. */
async function toScreen(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("slide-canvas").boundingBox())!;
  const s = box.width / 960;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function dragLogical(
  page: Page,
  from: [number, number],
  to: [number, number],
  beforeUp?: () => Promise<void>,
) {
  const a = await toScreen(page, ...from);
  const b = await toScreen(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  if (beforeUp) await beforeUp();
  await page.mouse.up();
}

test("marquee select, align, group, move and persist", async ({ page }) => {
  const id = await createDeck(page.request, "e2e slides arrange");
  try {
    await saveDeckData(page.request, id, {
      slides: [
        {
          id: "s1",
          background: "#ffffff",
          elements: [rect("a", 100, 100, "#4285f4"), rect("b", 300, 150, "#ea4335")],
        },
      ],
    });
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    const canvas = page.getByTestId("slide-canvas");
    await expect(canvas.locator('[data-el-id="a"]')).toBeVisible();

    // Rubber-band from empty canvas around both shapes.
    await dragLogical(page, [60, 60], [460, 270]);
    await expect(canvas.locator("[data-selected]")).toHaveCount(2);
    await expect(page.getByTestId("selection-box")).toBeVisible();

    // Arrange ▸ Align ▸ Top: both tops line up with the selection's top.
    let saved = waitForSave(page, id);
    await page.getByRole("button", { name: "Arrange" }).click();
    await page.getByRole("menuitem", { name: "Top", exact: true }).click();
    await saved;
    let deck = await getDeckData(page.request, id);
    expect(deck!.slides[0].elements.map((e) => e.y)).toEqual([100, 100]);

    // Group (Ctrl+G): one selected group holding both shapes.
    saved = waitForSave(page, id);
    await page.keyboard.press("Control+g");
    await saved;
    await expect(canvas.locator('[data-el-type="group"][data-selected]')).toHaveCount(1);
    deck = await getDeckData(page.request, id);
    let els = deck!.slides[0].elements;
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: "group", x: 100, y: 100, w: 320, h: 80 });
    expect(els[0].children.map((c: { id: string }) => c.id)).toEqual(["a", "b"]);

    // Drag the group so its centre lands on the slide centre: the smart
    // guides snap it exactly and are drawn while dragging.
    saved = waitForSave(page, id);
    await dragLogical(page, [150, 140], [150 + 220, 140 + 130], async () => {
      await expect(page.getByTestId("snap-guide").first()).toBeVisible();
      if (SHOT) await page.screenshot({ path: SHOT });
    });
    await saved;
    await expect(page.getByTestId("snap-guide")).toHaveCount(0);

    // Reload: the moved group and its members persisted.
    await page.reload();
    await expect(canvas.locator('[data-el-type="group"]')).toHaveCount(1);
    deck = await getDeckData(page.request, id);
    els = deck!.slides[0].elements;
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: "group", x: 320, y: 230, w: 320, h: 80 });
    expect(
      els[0].children.map((c: { x: number; y: number }) => [c.x, c.y]),
    ).toEqual([
      [320, 230],
      [520, 230],
    ]);

    // Ungroup (Ctrl+Shift+G) gives back the two shapes, both selected.
    await canvas.locator('[data-el-type="group"]').click();
    saved = waitForSave(page, id);
    await page.keyboard.press("Control+Shift+g");
    await saved;
    await expect(canvas.locator("[data-selected]")).toHaveCount(2);
    deck = await getDeckData(page.request, id);
    expect(deck!.slides[0].elements.map((e) => e.id)).toEqual(["a", "b"]);
  } finally {
    await trashDeck(page.request, id);
  }
});
