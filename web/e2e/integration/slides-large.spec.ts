import { test, expect } from "@playwright/test";
import { BASE_URL, createDeck, getDeckData, saveDeckData, trashDeck } from "../helpers";
import { waitForDeckSave } from "./slides-helpers";

// Large-content smoke: a 60-slide deck (title, bullets, a shape and a table
// on every slide) loads, the filmstrip scrolls to the end, and an edit on
// the last slide saves, each within a generous bound. Timings are logged as
// `[timing] slides-60 …`.

const N = 60;

function bigDeck() {
  return {
    slides: Array.from({ length: N }, (_, i) => ({
      id: `s${i + 1}`,
      background: i % 2 ? "#ffffff" : "#f1f3f4",
      notes: `Notes for slide ${i + 1}`,
      elements: [
        { id: `t${i + 1}`, type: "text", x: 60, y: 40, w: 840, h: 80, text: `Slide ${i + 1} title`, fontSize: 40, bold: true, color: "#202124", fontFamily: "Arial" },
        {
          id: `b${i + 1}`,
          type: "text",
          x: 60,
          y: 140,
          w: 420,
          h: 240,
          text: "First point\nSecond point\nThird point",
          list: "bullet",
          fontSize: 22,
          color: "#3c4043",
          fontFamily: "Arial",
        },
        { id: `p${i + 1}`, type: "shape", preset: "star5", x: 520, y: 150, w: 120, h: 120, fill: "#fbbc04", stroke: "#b06000", strokeWidth: 2 },
        {
          id: `g${i + 1}`,
          type: "table",
          x: 520,
          y: 300,
          w: 380,
          h: 120,
          fontSize: 14,
          table: { rows: 3, cols: 2, cells: [["Row", "Value"], ["a", String(i)], ["b", String(i * 2)]] },
        },
      ],
    })),
  };
}

test("60-slide deck: load, scroll the filmstrip, edit the last slide", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  const id = await createDeck(page.request, "e2e integration 60 slides");
  try {
    await saveDeckData(page.request, id, bigDeck());

    const t0 = Date.now();
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    await expect(page.getByTestId("slide-thumb")).toHaveCount(N, { timeout: 20_000 });
    await expect(page.getByTestId("slide-canvas").getByText("Slide 1 title")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
    const load = Date.now() - t0;

    const t1 = Date.now();
    const last = page.getByTestId("slide-thumb").nth(N - 1);
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expect(page.getByTestId("slide-canvas").getByText(`Slide ${N} title`)).toBeVisible();
    await expect(last).toBeInViewport();
    const scroll = Date.now() - t1;

    const t2 = Date.now();
    await page.getByTestId("slide-canvas").locator(`[data-el-id="t${N}"]`).dblclick();
    await page.keyboard.press("ControlOrMeta+End");
    await page.waitForTimeout(100);
    await page.keyboard.type(" edited");
    const saved = waitForDeckSave(page, id);
    await page.keyboard.press("Escape");
    await saved;
    const edit = Date.now() - t2;

    const d = await getDeckData(page.request, id);
    expect(d!.slides).toHaveLength(N);
    expect(d!.slides[N - 1].elements[0].text).toBe(`Slide ${N} title edited`);
    await expect(last).toContainText(`Slide ${N} title edited`);

    console.log(`[timing] slides-60 load=${load}ms scroll+select=${scroll}ms edit+save=${edit}ms`);
    test.info().annotations.push({ type: "timing", description: `slides-60 load=${load}ms scroll=${scroll}ms edit=${edit}ms` });
    expect(load, "load to interactive").toBeLessThan(10_000);
    expect(scroll, "filmstrip scroll + select").toBeLessThan(5_000);
    expect(edit, "edit + autosave").toBeLessThan(10_000);
  } finally {
    await trashDeck(page.request, id);
  }
});
