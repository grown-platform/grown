import { test, expect, type Page } from "@playwright/test";
import * as path from "node:path";
import { BASE_URL, createSheet, trashSheet, saveSheet, getSheetData } from "./helpers";

// Sheets M7: autofill (fill handle, Ctrl+D, Fill ▸ Series), the multi-key
// sort dialog, paste special, and row/column structure changes that keep
// formulas, rule ranges and named ranges pointing at the same cells.
//
// FortuneSheet paints to a canvas, so the checks read the saved workbook
// through the API (the editor autosaves 1.5 s after an edit) plus the name
// box, and a screenshot.

const SHOT = process.env.GROWN_M7_SHOT || path.join("test-results", "sheets-structure", "sheets-m7.png");

type Cell = Record<string, any>;
const num = (v: number): Cell => ({ v, m: String(v), ct: { fa: "General", t: "n" } });
const txt = (v: string): Cell => ({ v, m: v, ct: { fa: "General", t: "g" } });

function workbook() {
  const celldata: { r: number; c: number; v: Cell }[] = [];
  const put = (r: number, c: number, v: Cell) => celldata.push({ r, c, v });
  // A1:E2 — fill-handle sources.
  put(0, 0, txt("Monday"));
  put(1, 0, txt("Wednesday"));
  put(0, 1, txt("Jan"));
  put(1, 1, txt("Feb"));
  put(0, 2, num(1));
  put(1, 2, num(3));
  put(0, 3, txt("Item 1"));
  put(1, 3, txt("Item 2"));
  // F1 — a growth series start.
  put(0, 5, num(2));
  // H1 — a formula for Ctrl+D.
  put(0, 7, { f: "=C1*10", v: 10, m: "10", ct: { fa: "General", t: "n" } });
  // J1:L7 — a table to sort by Group, then Score descending.
  const table: [string, number, string][] = [
    ["Ada", 70, "b"],
    ["Brook", 95, "a"],
    ["Cyd", 60, "b"],
    ["Dee", 80, "a"],
    ["Eli", 95, "b"],
    ["Fay", 50, "a"],
  ];
  put(0, 9, txt("Name"));
  put(0, 10, txt("Score"));
  put(0, 11, txt("Group"));
  put(0, 12, txt("Double"));
  table.forEach(([n, s, g], i) => {
    put(i + 1, 9, txt(n));
    put(i + 1, 10, num(s));
    put(i + 1, 11, txt(g));
    put(i + 1, 12, { f: `=K${i + 2}*2`, v: s * 2, m: String(s * 2), ct: { fa: "General", t: "n" } });
  });
  return [
    {
      name: "Sheet1",
      id: "m7",
      order: 0,
      row: 60,
      column: 20,
      config: { columnlen: { 0: 90, 1: 60, 2: 50, 3: 70, 4: 40, 5: 50, 6: 20, 7: 50, 8: 20, 9: 70, 10: 60, 11: 60, 12: 60 } },
      celldata,
      _namedRanges: [{ name: "Scores", range: "K2:K7", sheetName: "Sheet1" }],
      grownCF: [
        {
          id: "cf1",
          type: "cellIs",
          operator: "greaterThan",
          formula1: "90",
          ranges: [{ r1: 1, c1: 10, r2: 6, c2: 10 }],
          priority: 1,
          style: { fill: "#c8e6c9" },
        },
      ],
    },
    {
      name: "Other",
      id: "m7b",
      order: 1,
      row: 20,
      column: 10,
      celldata: [{ r: 0, c: 0, v: { f: "=SUM(Sheet1!K2:K7)", v: 450, m: "450", ct: { fa: "General", t: "n" } } }],
    },
  ];
}

async function openSheet(page: Page, id: string) {
  await page.goto(`/sheets/d/${id}`);
  await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
}

async function menu(page: Page, top: string, item: string) {
  await page.getByRole("button", { name: top, exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

const colName = (c: number) => String.fromCharCode(65 + c);

/** Selects a cell with the keyboard from A1 (the name box is read-only), then extends by (dr, dc). */
async function select(page: Page, ref: string, dr = 0, dc = 0) {
  const col = ref.charCodeAt(0) - 65;
  const row = Number(ref.slice(1)) - 1;
  const box = page.locator(".fortune-name-box");
  await expect(async () => {
    await page.locator(".fortune-cell-area").click({ position: { x: 30, y: 10 } });
    await expect(box).toHaveText("A1", { timeout: 1_000 });
    for (let i = 0; i < col; i++) await page.keyboard.press("ArrowRight");
    for (let i = 0; i < row; i++) await page.keyboard.press("ArrowDown");
    await expect(box).toHaveText(ref, { timeout: 1_000 });
    for (let i = 0; i < dc; i++) await page.keyboard.press("Shift+ArrowRight");
    for (let i = 0; i < dr; i++) await page.keyboard.press("Shift+ArrowDown");
    if (dr || dc) await expect(box).toHaveText(`${ref}:${colName(col + dc)}${row + dr + 1}`, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

function cellOf(sheet: any, r: number, c: number): Cell | undefined {
  return sheet?.celldata?.find((x: any) => x.r === r && x.c === c)?.v;
}

/** Polls the saved workbook until `fn` holds. */
async function saved<T>(page: Page, id: string, fn: (wb: any[]) => T, want: T) {
  await expect.poll(async () => fn(await getSheetData(page.request, id)), { timeout: 20_000 }).toEqual(want);
}

test.describe.serial("sheets autofill, sort, paste special and structure", () => {
  test("fill handle, fill down, series, sort and paste special", async ({ page }) => {
    const id = await createSheet(page.request, "e2e sheets structure");
    try {
      await saveSheet(page.request, id, workbook());
      await openSheet(page, id);

      // 1. Drag the fill handle of A1:D2 down to row 7.
      await select(page, "A1", 1, 3);
      const handle = page.locator(".luckysheet-cs-fillhandle");
      const hb = (await handle.boundingBox())!;
      const sel = (await page.locator(".luckysheet-cell-selected").first().boundingBox())!;
      const rowH = sel.height / 2;
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + rowH * 2.5, { steps: 5 });
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + rowH * 5.2, { steps: 5 });
      await page.mouse.up();
      await saved(
        page,
        id,
        (wb) => [0, 1, 2, 3].map((c) => [2, 3, 4, 5, 6].map((r) => cellOf(wb[0], r, c)?.m ?? "")),
        [
          ["Friday", "Sunday", "Tuesday", "Thursday", "Saturday"],
          ["Mar", "Apr", "May", "Jun", "Jul"],
          ["5", "7", "9", "11", "13"],
          ["Item 3", "Item 4", "Item 5", "Item 6", "Item 7"],
        ],
      );

      // 2. Ctrl+D copies H1's formula down, relative references moving.
      await select(page, "H1", 3, 0);
      await page.keyboard.press("Control+d");
      await saved(page, id, (wb) => [1, 2, 3].map((r) => cellOf(wb[0], r, 7)?.f), ["=C2*10", "=C3*10", "=C4*10"]);

      // 3. Edit ▸ Fill ▸ Series: growth ×3 from F1 with a stop value of 200.
      await select(page, "F1");
      await menu(page, "Edit", "Series…");
      await page.getByLabel("Series range").fill("F1:F8");
      await page.getByRole("radio", { name: "Columns" }).check();
      await page.getByRole("radio", { name: "Growth" }).check();
      await page.getByLabel("Step value").fill("3");
      await page.getByLabel("Stop value").fill("200");
      await page.getByRole("button", { name: "OK" }).click();
      await saved(
        page,
        id,
        (wb) => [0, 1, 2, 3, 4, 5, 6].map((r) => cellOf(wb[0], r, 5)?.v ?? null),
        [2, 6, 18, 54, 162, null, null],
      );

      // 4. Data ▸ Advanced range sorting: Group A→Z, then Score Z→A.
      await select(page, "J1");
      await menu(page, "Data", "Advanced range sorting options…");
      await page.getByLabel("Range to sort").fill("J1:M7");
      const header = page.getByRole("checkbox", { name: "Data has header row" });
      if (!(await header.isChecked())) await header.check();
      const pickOption = async (label: string, option: string) => {
        await page.getByRole("combobox", { name: label }).click();
        await page.getByRole("option", { name: option, exact: true }).click();
      };
      await pickOption("Sort key 1", "Group (L)");
      await page.getByRole("button", { name: "Add another sort column" }).click();
      await pickOption("Sort key 2", "Score (K)");
      await pickOption("Order 2", "Z → A");
      await page.getByRole("button", { name: "Sort", exact: true }).click();
      await saved(
        page,
        id,
        (wb) => [1, 2, 3, 4, 5, 6].map((r) => [cellOf(wb[0], r, 9)?.v, cellOf(wb[0], r, 12)?.f, cellOf(wb[0], r, 12)?.v]),
        [
          ["Brook", "=K2*2", 190],
          ["Dee", "=K3*2", 160],
          ["Fay", "=K4*2", 100],
          ["Eli", "=K5*2", 190],
          ["Ada", "=K6*2", 140],
          ["Cyd", "=K7*2", 120],
        ],
      );
      await select(page, "A1");
      await page.screenshot({ path: SHOT });

      // 5. Copy C1:C3, paste values transposed at O1 (Paste special dialog), and values only at O3.
      await select(page, "H1", 2, 0);
      await page.keyboard.press("Control+c");
      await select(page, "O1");
      await menu(page, "Edit", "Paste special…");
      await page.getByRole("radio", { name: "Values" }).check();
      await page.getByRole("checkbox", { name: "Transpose" }).check();
      await page.getByRole("button", { name: "Paste", exact: true }).click();
      await select(page, "O3");
      await page.keyboard.press("Control+Shift+v");
      await saved(
        page,
        id,
        (wb) => [
          [14, 15, 16].map((c) => cellOf(wb[0], 0, c)?.v ?? null),
          [2, 3, 4].map((r) => [cellOf(wb[0], r, 14)?.v ?? null, cellOf(wb[0], r, 14)?.f ?? null]),
        ],
        [
          [10, 30, 50],
          [
            [10, null],
            [30, null],
            [50, null],
          ],
        ],
      );
    } finally {
      await trashSheet(page.request, id);
    }
  });

  test("inserting and deleting rows keeps references, rules and names in place", async ({ page }) => {
    const id = await createSheet(page.request, "e2e sheets structure refs");
    try {
      await saveSheet(page.request, id, workbook());
      await openSheet(page, id);

      // Insert a row above row 1 through the menu.
      await select(page, "A1");
      await menu(page, "Insert", "Row above");
      await saved(
        page,
        id,
        (wb) => ({
          h2: cellOf(wb[0], 1, 7)?.f,
          m3: cellOf(wb[0], 2, 12)?.f,
          other: cellOf(wb[1], 0, 0)?.f,
          name: wb[0]._namedRanges?.[0]?.range,
          cf: wb[0].grownCF?.[0]?.ranges?.[0],
        }),
        { h2: "=C2*10", m3: "=K3*2", other: "=SUM(Sheet1!K3:K8)", name: "K3:K8", cf: { r1: 2, c1: 10, r2: 7, c2: 10 } },
      );

      // Delete that row again: everything returns.
      await select(page, "A1");
      await menu(page, "Edit", "Delete row");
      await saved(
        page,
        id,
        (wb) => ({ h1: cellOf(wb[0], 0, 7)?.f, other: cellOf(wb[1], 0, 0)?.f, name: wb[0]._namedRanges?.[0]?.range }),
        { h1: "=C1*10", other: "=SUM(Sheet1!K2:K7)", name: "K2:K7" },
      );
    } finally {
      await trashSheet(page.request, id);
    }
  });

  test("the structure API shifts references server-side", async ({ page }) => {
    const id = await createSheet(page.request, "e2e sheets structure api");
    try {
      await saveSheet(page.request, id, workbook());
      const res = await page.request.post(`${BASE_URL}/api/v1/sheets/d/${id}/structure`, {
        data: { op: { kind: "delete", axis: "col", sheet: "Sheet1", index: 0, count: 1 } },
      });
      expect(res.ok()).toBe(true);
      const wb = await getSheetData(page.request, id);
      expect(cellOf(wb[0], 0, 6)?.f).toBe("=B1*10");
      expect(cellOf(wb[1], 0, 0)?.f).toBe("=SUM(Sheet1!J2:J7)");
      expect(wb[0]._namedRanges?.[0]?.range).toBe("J2:J7");
      expect(cellOf(wb[0], 0, 0)?.v).toBe("Jan");
    } finally {
      await trashSheet(page.request, id);
    }
  });
});
