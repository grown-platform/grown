import { test, expect, type Page } from "@playwright/test";
import * as path from "node:path";
import { createSheet, saveSheet, trashSheet } from "./helpers";
import { book, cellOf, fx, num, openSheet, rc, savedMatches, txt, typeAt } from "./sheetsGrid";

// Default horizontal alignment by type (Excel / Google Sheets): numbers and
// dates right, booleans and errors centred, text left, unless the cell has an
// explicit alignment (`ht`). FortuneSheet paints to a canvas, so the spec reads
// where each cell's text ink sits in the canvas pixels. The default is applied
// at render time, so nothing writes `ht` into the saved cells.

const SHOT_DIR = process.env.GROWN_SHOT_DIR || path.join("test-results", "align");

/** Horizontal ink extent of a cell's text, as fractions of the cell width. */
async function ink(page: Page, ref: string): Promise<{ left: number; right: number } | null> {
  const { r, c } = rc(ref);
  return page.evaluate(
    ({ r, c }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(".fortune-sheet-canvas")!;
      const area = document.querySelector<HTMLElement>(".fortune-cell-area")!.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      const sx = canvas.width / cr.width;
      const sy = canvas.height / cr.height;
      // Default column width 73 px + 1 px gridline, row height 19 px + 1 px.
      const x0 = area.left + c * 74 + 2;
      const x1 = area.left + c * 74 + 72;
      const y0 = area.top + r * 20 + 3;
      const y1 = area.top + r * 20 + 17;
      const px = (x: number) => Math.round((x - cr.left) * sx);
      const py = (y: number) => Math.round((y - cr.top) * sy);
      const w = px(x1) - px(x0);
      const h = py(y1) - py(y0);
      const data = canvas.getContext("2d")!.getImageData(px(x0), py(y0), w, h).data;
      let lo = Infinity;
      let hi = -Infinity;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (data[i + 3] > 0 && data[i] + data[i + 1] + data[i + 2] < 300) {
            lo = Math.min(lo, x);
            hi = Math.max(hi, x);
          }
        }
      }
      return lo === Infinity ? null : { left: lo / w, right: (hi + 1) / w };
    },
    { r, c },
  );
}

async function expectAlign(page: Page, ref: string, want: "left" | "center" | "right") {
  await expect(async () => {
    const e = await ink(page, ref);
    expect(e, `${ref} has painted text`).not.toBeNull();
    const mid = (e!.left + e!.right) / 2;
    if (want === "left") expect(e!.left, `${ref} left-aligned`).toBeLessThan(0.15);
    if (want === "right") expect(e!.right, `${ref} right-aligned`).toBeGreaterThan(0.85);
    if (want === "right") expect(e!.left, `${ref} right-aligned`).toBeGreaterThan(0.4);
    if (want === "center") expect(Math.abs(mid - 0.5), `${ref} centred`).toBeLessThan(0.1);
  }).toPass({ timeout: 15_000 });
}

test("numbers right, booleans and errors centred, text left; explicit alignment wins", async ({ page }) => {
  const id = await createSheet(page.request, "e2e default alignment");
  try {
    await saveSheet(
      page.request,
      id,
      book({
        A1: txt("Value"),
        A2: { v: 10 }, // API-saved without m/ct
        A3: num(32),
        A4: fx("=SUM(A2:A3)"), // 42
        A5: fx("=1=1"), // TRUE
        A6: fx("=1/0"),
        A7: fx('=TEXT(DATE(2026,9,26),"yyyy-mm-dd")'),
        B2: { ...num(10), ht: 1 }, // explicit left
        B3: { ...txt("hi"), ht: 2 }, // explicit right
        B4: { ...num(7), ht: 0 }, // explicit centre
      }),
    );
    await openSheet(page, id);
    // Typed in the grid, too.
    await typeAt(page, "C2", "123");
    await typeAt(page, "C3", "abc");
    await typeAt(page, "C4", "TRUE");
    await page.locator(".fortune-cell-area").click({ position: { x: 700, y: 300 } }); // park the selection away

    await expectAlign(page, "A1", "left");
    await expectAlign(page, "A2", "right");
    await expectAlign(page, "A3", "right");
    await expectAlign(page, "A4", "right");
    await expectAlign(page, "A5", "center");
    await expectAlign(page, "A6", "center");
    await expectAlign(page, "A7", "left");
    await expectAlign(page, "B2", "left");
    await expectAlign(page, "B3", "right");
    await expectAlign(page, "B4", "center");
    await expectAlign(page, "C2", "right");
    await expectAlign(page, "C3", "left");
    await expectAlign(page, "C4", "center");
    await page.screenshot({ path: path.join(SHOT_DIR, "default-alignment.png") });

    // The default is not persisted: cells without an alignment still have none.
    await savedMatches(page.request, id, (wb) => {
      const s = wb[0];
      expect(cellOf(s, "C2")?.v).toBe(123);
      for (const ref of ["A2", "A3", "A4", "A5", "A6", "C2", "C3", "C4"]) expect(cellOf(s, ref)?.ht, ref).toBeUndefined();
      expect(cellOf(s, "B2")?.ht).toBe(1);
    });
  } finally {
    await trashSheet(page.request, id);
  }
});
