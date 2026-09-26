import { test, expect, type APIRequestContext } from "@playwright/test";
import { createSheet, trashSheet, saveSheet, getSheetData } from "./helpers";

// Cross-sheet references, defined names and the recalc round-trip (Sheets M1).
// The server engine computes Sheet2!A1 / 'Quoted name'!A1 / named ranges on
// save and through POST …/recalc; renaming a tab in the grid rewrites the
// formulas that refer to it.

const BASE_URL = process.env.GROWN_HTTP_URL || "http://workspace.localtest.me:8080";

function twoSheetWorkbook() {
  return [
    {
      name: "Sheet1",
      id: "s1",
      order: 0,
      _namedRanges: [{ name: "Rate", range: "Inputs!B1", sheetId: "s2", sheetName: "Inputs" }],
      celldata: [
        { r: 0, c: 0, v: { f: "=Inputs!A1*2" } },
        { r: 1, c: 0, v: { f: "=SUM('Inputs'!A1:A3)*Rate" } },
        { r: 2, c: 0, v: { f: "=ROWS(Inputs!A:A)" } },
      ],
    },
    {
      name: "Inputs",
      id: "s2",
      order: 1,
      celldata: [
        { r: 0, c: 0, v: { v: 21 } },
        { r: 1, c: 0, v: { v: 1 } },
        { r: 2, c: 0, v: { v: 2 } },
        { r: 0, c: 1, v: { v: 10 } },
      ],
    },
  ];
}

function cellOf(wb: any[], sheet: string, r: number, c: number): any {
  const sh = wb.find((s) => s.name === sheet);
  return sh?.celldata?.find((cd: any) => cd.r === r && cd.c === c)?.v;
}

async function recalc(request: APIRequestContext, id: string, wb: unknown) {
  const res = await request.post(`${BASE_URL}/api/v1/sheets/d/${id}/recalc`, {
    data: { data: JSON.stringify(wb) },
  });
  expect(res.ok(), `recalc status ${res.status()}`).toBeTruthy();
  return (await res.json()).cells as Array<{ sheetId: string; r: number; c: number; v: unknown }>;
}

test.describe.serial("sheets cross-sheet references", () => {
  test("save computes cross-sheet refs, quoted names and defined names", async ({ page }) => {
    const id = await createSheet(page.request, "e2e cross-sheet");
    try {
      await saveSheet(page.request, id, twoSheetWorkbook());
      const saved = await getSheetData(page.request, id);
      expect(cellOf(saved, "Sheet1", 0, 0)?.v).toBe(42);
      expect(cellOf(saved, "Sheet1", 1, 0)?.v).toBe(240);
      expect(cellOf(saved, "Sheet1", 2, 0)?.v).toBe(1048576);

      const cells = await recalc(page.request, id, twoSheetWorkbook());
      const a1 = cells.find((c) => c.sheetId === "s1" && c.r === 0 && c.c === 0);
      expect(a1?.v).toBe(42);
    } finally {
      await trashSheet(page.request, id);
    }
  });

  test("renaming a tab rewrites formulas that refer to it", async ({ page }) => {
    const id = await createSheet(page.request, "e2e rename tab");
    try {
      await saveSheet(page.request, id, twoSheetWorkbook());
      await page.goto(`/sheets/d/${id}`);
      await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
      // A1 is selected on open: its formula shows in the formula bar.
      await expect(page.locator(".fortune-fx-input")).toContainText("=Inputs!A1*2");

      const tab = page.locator(".luckysheet-sheets-item-name", { hasText: "Inputs" });
      await tab.dblclick();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("Rates 2026");
      await page.keyboard.press("Enter");
      await expect(page.locator(".luckysheet-sheets-item-name", { hasText: "Rates 2026" })).toBeVisible();

      // The autosave persists the rewritten formulas and named range, and the
      // server still computes them.
      await expect
        .poll(
          async () => {
            const wb = await getSheetData(page.request, id);
            return [
              cellOf(wb, "Sheet1", 0, 0)?.f,
              cellOf(wb, "Sheet1", 1, 0)?.f,
              cellOf(wb, "Sheet1", 1, 0)?.v,
              wb[0]?._namedRanges?.[0]?.range,
            ];
          },
          { timeout: 15_000 },
        )
        .toEqual(["='Rates 2026'!A1*2", "=SUM('Rates 2026'!A1:A3)*Rate", 240, "'Rates 2026'!B1"]);
      // Back on Sheet1, A1's formula reads the new name.
      await page.locator(".luckysheet-sheets-item-name", { hasText: "Sheet1" }).click();
      await expect(page.locator(".fortune-fx-input")).toContainText("='Rates 2026'!A1*2");
    } finally {
      await trashSheet(page.request, id);
    }
  });
});
