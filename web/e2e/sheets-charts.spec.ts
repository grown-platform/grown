import { test, expect, type Page } from "@playwright/test";
import * as path from "node:path";
import { createSheet, trashSheet, saveSheet, getSheetData } from "./helpers";

// Sheets M10: charts anchored on the grid. A combo chart (revenue columns
// with a linear trendline, margin as a line on a secondary axis) is inserted
// through the chart dialog; inserting a row above it moves the chart down a
// row and shifts its data range; a reload keeps both. A second test lays out
// four chart types on one sheet for a screenshot.

const SHOT = process.env.GROWN_M10_SHOT || path.join("test-results", "sheets-charts", "sheets-m10.png");

type Cell = Record<string, any>;
const num = (v: number, fa = "General"): Cell => ({ v, m: String(v), ct: { fa, t: "n" } });
const txt = (v: string): Cell => ({ v, m: v, ct: { fa: "General", t: "g" } });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const REVENUE = [120, 150, 170, 160, 210, 240];
const MARGIN = [0.18, 0.21, 0.24, 0.2, 0.27, 0.3];

function workbook(charts?: any[]) {
  const celldata: { r: number; c: number; v: Cell }[] = [];
  const put = (r: number, c: number, v: Cell) => celldata.push({ r, c, v });
  put(0, 0, txt("Month"));
  put(0, 1, txt("Revenue"));
  put(0, 2, txt("Margin"));
  MONTHS.forEach((m, i) => {
    put(i + 1, 0, txt(m));
    put(i + 1, 1, num(REVENUE[i]));
    put(i + 1, 2, { v: MARGIN[i], m: `${Math.round(MARGIN[i] * 100)}%`, ct: { fa: "0%", t: "n" } });
  });
  // A second table for the screenshot: scores for a histogram.
  const scores = [52, 58, 61, 64, 66, 68, 70, 71, 73, 74, 76, 77, 79, 81, 83, 85, 88, 91, 95];
  put(0, 14, txt("Score"));
  scores.forEach((s, i) => put(i + 1, 14, num(s)));
  return [{ name: "Sheet1", id: "m10", order: 0, row: 60, column: 30, celldata, ...(charts ? { grownCharts: charts } : {}) }];
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

/** Selects from A1 with the keyboard, extending by (dr, dc). */
async function select(page: Page, dr = 0, dc = 0) {
  const box = page.locator(".fortune-name-box");
  await expect(async () => {
    await page.locator(".fortune-cell-area").click({ position: { x: 30, y: 10 } });
    await expect(box).toHaveText("A1", { timeout: 1_000 });
    for (let i = 0; i < dc; i++) await page.keyboard.press("Shift+ArrowRight");
    for (let i = 0; i < dr; i++) await page.keyboard.press("Shift+ArrowDown");
    if (dr || dc) await expect(box).toHaveText(`A1:${String.fromCharCode(65 + dc)}${dr + 1}`, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.describe.serial("sheets charts", () => {
  test("a combo chart with a trendline stays anchored through a row insert and a reload", async ({ page }) => {
    const id = await createSheet(page.request, "e2e sheets charts");
    try {
      await saveSheet(page.request, id, workbook());
      await openSheet(page, id);

      await select(page, 6, 2);
      await menu(page, "Insert", "Chart");
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Data range")).toHaveValue("A1:C7");
      await pick(page, "Chart type", "Combo");
      await dialog.getByRole("tab", { name: "Series" }).click();
      await pick(page, "Series", "Margin");
      await dialog.getByRole("checkbox", { name: "Plot on secondary axis" }).check();
      await pick(page, "Series", "Revenue");
      await pick(page, "Trendline", "Linear");
      await dialog.getByRole("checkbox", { name: "Show equation" }).check();
      await dialog.getByRole("checkbox", { name: "Show R²" }).check();
      await expect(dialog.locator('[data-mark="trendline"]')).toHaveCount(1);
      await dialog.getByRole("button", { name: "Insert chart" }).click();

      const chart = page.getByTestId("grid-chart");
      await expect(chart).toBeVisible();
      await expect(chart.locator('[data-mark="bar"]')).toHaveCount(6);
      await expect(chart.locator('[data-mark="line"]')).toHaveCount(1);
      await expect(chart.locator('[data-mark="trendline"]')).toHaveCount(1);
      await expect(chart.getByText(/^R² = 0\.\d+/)).toBeVisible();
      await expect
        .poll(async () => {
          const c = (await getSheetData(page.request, id))[0]?.grownCharts?.[0];
          return c && { type: c.type, range: c.range, anchor: [c.anchor?.r, c.anchor?.c], sec: c.series?.[1]?.secondary, trend: c.series?.[0]?.trendline?.type };
        }, { timeout: 20_000 })
        .toEqual({ type: "combo", range: { r0: 0, r1: 6, c0: 0, c1: 2 }, anchor: [0, 4], sec: true, trend: "linear" });
      const before = (await chart.boundingBox())!;

      // Insert a row above row 1: the chart moves down one row, its data range shifts.
      await select(page);
      await menu(page, "Insert", "Row above");
      await expect
        .poll(async () => {
          const c = (await getSheetData(page.request, id))[0]?.grownCharts?.[0];
          return c && { range: c.range, anchor: [c.anchor?.r, c.anchor?.c] };
        }, { timeout: 20_000 })
        .toEqual({ range: { r0: 1, r1: 7, c0: 0, c1: 2 }, anchor: [1, 4] });
      await expect.poll(async () => Math.round((await chart.boundingBox())!.y - before.y)).toBeGreaterThanOrEqual(18);
      // Still the same data (Jan…Jun, one bar each).
      await expect(chart.locator('[data-mark="bar"]')).toHaveCount(6);

      // Reload: same place, same chart.
      await page.reload();
      await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
      const again = page.getByTestId("grid-chart");
      await expect(again).toBeVisible({ timeout: 20_000 });
      await expect(again.locator('[data-mark="bar"]')).toHaveCount(6);
      await expect(again.locator('[data-mark="trendline"]')).toHaveCount(1);
      const after = (await again.boundingBox())!;
      expect(Math.abs(after.y - before.y - 20)).toBeLessThanOrEqual(3);

      // Select it, then Delete removes it.
      await again.click({ position: { x: 60, y: 60 } });
      await page.keyboard.press("Delete");
      await expect(page.getByTestId("grid-chart")).toHaveCount(0);
      await expect.poll(async () => (await getSheetData(page.request, id))[0]?.grownCharts?.length ?? 0, { timeout: 20_000 }).toBe(0);
    } finally {
      await trashSheet(page.request, id);
    }
  });

  test("four chart types on one sheet (screenshot)", async ({ page }) => {
    const range = { r0: 0, r1: 6, c0: 0, c1: 2 };
    const charts = [
      {
        id: "k1", type: "combo", title: "Revenue and margin", range, headerRow: true, labelCol: true, sheetId: "m10",
        series: [{ type: "column", trendline: { type: "linear", showEquation: true, showR2: true } }, { type: "line", secondary: true }],
        yAxis: { title: "Revenue ($k)" }, y2Axis: { numFmt: "0%" },
        anchor: { r: 0, c: 3, dx: 8, dy: 4, w: 440, h: 270 },
      },
      {
        id: "k2", type: "doughnut", title: "Revenue by month", range: { r0: 0, r1: 6, c0: 0, c1: 1 }, headerRow: true, labelCol: true, sheetId: "m10",
        anchor: { r: 0, c: 9, dx: 30, dy: 4, w: 340, h: 270 },
      },
      {
        id: "k3", type: "column", title: "Monthly revenue", range: { r0: 0, r1: 6, c0: 0, c1: 1 }, headerRow: true, labelCol: true, sheetId: "m10",
        dataLabels: true, legend: "none", anchor: { r: 15, c: 3, dx: 8, dy: 4, w: 440, h: 270 },
      },
      {
        id: "k4", type: "histogram", title: "Score distribution", range: { r0: 0, r1: 19, c0: 14, c1: 14 }, headerRow: true, labelCol: false, sheetId: "m10",
        histogram: { binSize: 10 }, anchor: { r: 15, c: 9, dx: 30, dy: 4, w: 340, h: 270 },
      },
    ];
    const id = await createSheet(page.request, "e2e sheets chart gallery");
    try {
      await saveSheet(page.request, id, workbook(charts));
      await page.setViewportSize({ width: 1500, height: 900 });
      await openSheet(page, id);
      await expect(page.getByTestId("grid-chart")).toHaveCount(4, { timeout: 20_000 });
      await expect(page.locator('[data-testid="grid-chart"] [data-mark="slice"]')).toHaveCount(6);
      await page.screenshot({ path: SHOT });
    } finally {
      await trashSheet(page.request, id);
    }
  });
});
