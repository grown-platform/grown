import { test, expect } from "@playwright/test";
import { createSheet, getSheetData, saveSheet, trashSheet } from "../helpers";
import { cellAt } from "./sheets-helpers";

// Large-content smoke: a 10,000-row sheet (4 columns plus a SUM over the
// whole column) loads, scrolls to the bottom and takes an edit within
// generous bounds. Timings are printed as `[timing] sheets-10k …`.

const ROWS = 10_000;
const LIMIT_MS = 10_000;

function bigWorkbook() {
  const celldata: any[] = [];
  const put = (r: number, c: number, v: any) => celldata.push({ r, c, v });
  ["Id", "Value", "Label", "Flag"].forEach((h, c) => put(0, c, { v: h, m: h, ct: { fa: "General", t: "g" } }));
  for (let i = 1; i < ROWS; i++) {
    put(i, 0, { v: i, m: String(i), ct: { fa: "General", t: "n" } });
    put(i, 1, { v: i % 100, m: String(i % 100), ct: { fa: "General", t: "n" } });
    put(i, 2, { v: `row ${i}`, m: `row ${i}`, ct: { fa: "General", t: "g" } });
    put(i, 3, { v: i % 2 === 0 ? "even" : "odd", m: i % 2 === 0 ? "even" : "odd", ct: { fa: "General", t: "g" } });
  }
  put(0, 5, { f: `=SUM(B2:B${ROWS})` });
  return [{ name: "Big", id: "big", order: 0, row: ROWS + 20, column: 12, celldata }];
}

test("sheets: a 10k-row sheet loads, scrolls and edits in bounded time", async ({ page }) => {
  test.setTimeout(180_000);
  const id = await createSheet(page.request, "e2e sheets 10k rows");
  try {
    let t = Date.now();
    await saveSheet(page.request, id, bigWorkbook());
    const seed = Date.now() - t;
    const expectedSum = Array.from({ length: ROWS - 1 }, (_, i) => (i + 1) % 100).reduce((a, b) => a + b, 0);
    expect(cellAt((await getSheetData(page.request, id))[0], "F1")?.v).toBe(expectedSum);

    // Load: grid painted, socket live and the name box answering a click.
    t = Date.now();
    await page.goto(`/sheets/d/${id}`);
    await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: LIMIT_MS });
    await expect(page.getByText("live", { exact: true })).toBeVisible({ timeout: LIMIT_MS });
    const box = page.locator(".fortune-name-box");
    await expect(async () => {
      await page.locator(".fortune-cell-area").click({ position: { x: 30, y: 30 } });
      await expect(box).toHaveText("A2", { timeout: 500 });
    }).toPass({ timeout: LIMIT_MS });
    const load = Date.now() - t;

    // Scroll: jump to the last row with Ctrl+↓, then wheel back up a screen.
    t = Date.now();
    await page.keyboard.press("Control+ArrowDown");
    await expect(box).toHaveText(`A${ROWS}`, { timeout: LIMIT_MS });
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, -2_000);
    await page.mouse.wheel(0, 2_000);
    const scroll = Date.now() - t;

    // Edit the last row: B10000 = 1000 (was 99); the saved SUM follows.
    t = Date.now();
    await page.keyboard.press("ArrowRight");
    await expect(box).toHaveText(`B${ROWS}`);
    await page.keyboard.type("1000");
    await page.keyboard.press("Enter");
    await expect(async () => {
      const s = (await getSheetData(page.request, id))[0];
      expect(cellAt(s, `B${ROWS}`)?.v).toBe(1000);
      expect(cellAt(s, "F1")?.v).toBe(expectedSum - ((ROWS - 1) % 100) + 1000);
    }).toPass({ timeout: LIMIT_MS + 5_000 });
    const edit = Date.now() - t;

    console.log(`[timing] sheets-10k seed=${seed}ms load=${load}ms scroll=${scroll}ms edit+save=${edit}ms`);
    test.info().annotations.push({ type: "timing", description: `sheets-10k load=${load}ms scroll=${scroll}ms edit+save=${edit}ms` });
    expect(load).toBeLessThan(LIMIT_MS);
    expect(scroll).toBeLessThan(LIMIT_MS);
    // Includes the editor's 1.5 s autosave debounce and the server recalc.
    expect(edit).toBeLessThan(LIMIT_MS + 5_000);
  } finally {
    await trashSheet(page.request, id);
  }
});
