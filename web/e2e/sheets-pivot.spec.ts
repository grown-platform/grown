import { test, expect, type Page } from "@playwright/test";
import * as path from "node:path";
import { createSheet, trashSheet, saveSheet, getSheetData } from "./helpers";

// Sheets M9: a pivot table built in the dialog (two row fields, a column
// field, % of grand total) is written onto the grid, follows an edit of its
// source, refuses typing into its cells, and answers GETPIVOTDATA on the
// server. FortuneSheet paints to a canvas, so the checks read the saved
// workbook through the API; a screenshot shows the pivot on the grid.

const SHOT = process.env.GROWN_M9_SHOT || path.join("test-results", "sheets-pivot", "sheets-m9.png");

const HEAD = ["Region", "Gender", "Style", "Units", "Price"];
const ROWS: [string, string, string, number, number][] = [
  ["East", "Boy", "Tee", 12, 11.04],
  ["East", "Boy", "Golf", 12, 13],
  ["East", "Boy", "Fancy", 12, 11.96],
  ["East", "Girl", "Tee", 10, 11.27],
  ["East", "Girl", "Golf", 10, 12.12],
  ["East", "Girl", "Fancy", 10, 13.74],
  ["West", "Boy", "Tee", 11, 11.44],
  ["West", "Boy", "Golf", 11, 12.63],
  ["West", "Boy", "Fancy", 11, 12.06],
  ["West", "Girl", "Tee", 15, 13.42],
  ["West", "Girl", "Golf", 15, 11.48],
];

function workbook() {
  const celldata: any[] = HEAD.map((h, c) => ({ r: 0, c, v: { v: h, m: h } }));
  ROWS.forEach((row, i) =>
    row.forEach((v, c) =>
      celldata.push({ r: i + 1, c, v: typeof v === "number" ? { v, m: String(v), ct: { fa: "General", t: "n" } } : { v, m: v } }),
    ),
  );
  return [{ name: "Sheet1", id: "m9", order: 0, row: 40, column: 16, celldata }];
}

async function openSheet(page: Page, id: string) {
  await page.goto(`/sheets/d/${id}`);
  await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
}

// Select a cell with the keyboard, starting from A1.
async function goTo(page: Page, ref: string) {
  const col = ref.replace(/\d+/g, "").charCodeAt(0) - 65;
  const row = Number(ref.replace(/\D+/g, "")) - 1;
  const box = page.locator(".fortune-name-box");
  await expect(async () => {
    await page.locator(".fortune-cell-area").click({ position: { x: 30, y: 10 } });
    await expect(box).toHaveText("A1", { timeout: 1_000 });
    for (let i = 0; i < col; i++) await page.keyboard.press("ArrowRight");
    for (let i = 0; i < row; i++) await page.keyboard.press("ArrowDown");
    await expect(box).toHaveText(ref, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

async function pick(page: Page, label: string, option: string) {
  const box = page.getByRole("combobox", { name: label }).first();
  await box.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

function cellAt(saved: any[], r: number, c: number): any {
  return saved[0].celldata.find((cd: any) => cd.r === r && cd.c === c)?.v;
}

async function savedWhere(page: Page, id: string, check: (saved: any[]) => boolean) {
  let saved: any[] = [];
  await expect(async () => {
    saved = await getSheetData(page.request, id);
    expect(check(saved)).toBe(true);
  }).toPass({ timeout: 20_000 });
  return saved;
}

test("pivot table on the grid: build, refresh on edit, guard, GETPIVOTDATA", async ({ page }) => {
  const id = await createSheet(page.request, "e2e sheets pivot");
  try {
    await saveSheet(page.request, id, workbook());
    await openSheet(page, id);
    await goTo(page, "A1");

    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await page.getByRole("menuitem", { name: "Pivot table" }).click();
    const dialog = page.getByRole("dialog", { name: "Create pivot table" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Data range").fill("Sheet1!A1:E12");
    for (const f of ["Region", "Gender"]) {
      await dialog.getByRole("combobox", { name: "Add row field" }).click();
      await page.getByRole("option", { name: f, exact: true }).click();
    }
    await dialog.getByRole("combobox", { name: "Add column field" }).click();
    await page.getByRole("option", { name: "Style", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Add value field" }).click();
    await page.getByRole("option", { name: "Price", exact: true }).click();
    await pick(page, "Show as", "% of grand total");
    await dialog.getByRole("radio", { name: "Existing sheet" }).check();
    await dialog.getByLabel("Pivot location").fill("Sheet1!H1");
    // The preview shows the report before it is placed.
    await expect(dialog.getByTestId("pivot-table")).toContainText("Grand Total");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog).toBeHidden();

    // The report sits at H1:L9: caption, header, East/Boy/Girl, West/Boy/Girl, total.
    const H = 7;
    let saved = await savedWhere(page, id, (s) => cellAt(s, 8, H + 4)?.m === "100.00%");
    expect(cellAt(saved, 0, H)?.v).toBe("Sum of Price");
    expect(cellAt(saved, 1, H)?.v).toBe("Row Labels");
    expect([1, 2, 3, 4].map((c) => cellAt(saved, 1, H + c)?.v)).toEqual(["Fancy", "Golf", "Tee", "Grand Total"]);
    expect([2, 3, 4, 5, 6, 7, 8].map((r) => cellAt(saved, r, H)?.v)).toEqual(["East", "Boy", "Girl", "West", "Boy", "Girl", "Grand Total"]);
    expect(cellAt(saved, 2, H + 4)?.m).toBe("54.51%");
    expect(cellAt(saved, 5, H + 4)?.m).toBe("45.49%");
    const stored = saved[0].grownPivots?.[0];
    expect(stored?.rows).toEqual([0, 1]);
    expect(stored?.cols).toEqual([2]);
    expect(stored?.output).toMatchObject({ r0: 0, c0: H, rows: 9, cols: 5 });

    // Editing the source refreshes the pivot: East/Boy/Tee 11.04 → 111.04.
    await goTo(page, "E2");
    await page.keyboard.type("111.04");
    await page.keyboard.press("Enter");
    saved = await savedWhere(page, id, (s) => cellAt(s, 2, H + 4)?.m === "73.94%");
    expect(cellAt(saved, 3, H + 3)?.m).toBe("47.42%"); // East/Boy/Tee = 111.04 / 234.16
    expect(cellAt(saved, 8, H + 4)?.m).toBe("100.00%");

    // Refresh all changes nothing more.
    await page.getByRole("button", { name: /Pivots \(1\)/ }).click();
    await page.getByRole("button", { name: "Refresh all" }).click();
    await expect(page.getByTestId("pivot-card")).toContainText("73.94%");
    await page.keyboard.press("Escape");

    // Typing into the pivot is refused.
    await goTo(page, "L9");
    await page.keyboard.type("5");
    await page.keyboard.press("Enter");
    await expect(page.getByText("You can't change this part of a pivot table", { exact: false })).toBeVisible();

    // GETPIVOTDATA on the server reads the stored report.
    await goTo(page, "A15");
    await page.keyboard.type('=GETPIVOTDATA("Price",H1,"Region","West")');
    await page.keyboard.press("Enter");
    saved = await savedWhere(page, id, (s) => typeof cellAt(s, 14, 0)?.v === "number");
    expect(cellAt(saved, 14, 0)?.v).toBeCloseTo(61.03 / 234.16, 6);
    expect(cellAt(saved, 8, H + 4)?.m).toBe("100.00%");

    await goTo(page, "A1");
    await page.screenshot({ path: SHOT });
  } finally {
    await trashSheet(page.request, id);
  }
});
