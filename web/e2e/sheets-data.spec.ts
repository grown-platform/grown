import { test, expect, type Page } from "@playwright/test";
import * as path from "node:path";
import { createSheet, trashSheet, saveSheet, getSheetData } from "./helpers";

// Sheets M8: filters, conditional formatting and data validation, applied
// through the menus and dialogs, persisted, and still there after a reload.
// FortuneSheet paints to a canvas, so the checks read the saved model through
// the API, the name box (keyboard navigation skips filtered rows), the
// validation notice, and a screenshot.

const SHOT = process.env.GROWN_M8_SHOT || path.join("test-results", "sheets-data", "sheets-m8.png");

const ROWS: Array<[string, number, number]> = [
  ["Ada", 92, 12],
  ["Brook", 35, -4],
  ["Cyd", 78, 7],
  ["Dee", 51, 3],
  ["Eli", 12, -9],
  ["Fay", 66, 10],
  ["Gus", 88, 5],
  ["Hal", 44, -1],
];

function workbook() {
  const celldata: any[] = [
    { r: 0, c: 0, v: { v: "Name", m: "Name" } },
    { r: 0, c: 1, v: { v: "Score", m: "Score" } },
    { r: 0, c: 2, v: { v: "Trend", m: "Trend" } },
    { r: 0, c: 3, v: { v: "Status", m: "Status" } },
  ];
  ROWS.forEach(([name, score, trend], i) => {
    celldata.push({ r: i + 1, c: 0, v: { v: name, m: name } });
    celldata.push({ r: i + 1, c: 1, v: { v: score, m: String(score), ct: { fa: "General", t: "n" } } });
    celldata.push({ r: i + 1, c: 2, v: { v: trend, m: String(trend), ct: { fa: "General", t: "n" } } });
  });
  return [{ name: "Sheet1", id: "m8", order: 0, row: 40, column: 12, config: { columnlen: { 0: 90, 1: 110, 2: 130, 3: 110 } }, celldata }];
}

async function openSheet(page: Page, id: string) {
  await page.goto(`/sheets/d/${id}`);
  await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
  // Let the post-open selection restore happen before driving the grid.
  await page.waitForTimeout(1_500);
}

async function menu(page: Page, top: string, item: string) {
  await page.getByRole("button", { name: top, exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function pick(page: Page, label: string, option: string) {
  const box = page.getByRole("combobox", { name: label });
  await expect(async () => {
    await box.click();
    await page.getByRole("option", { name: option, exact: true }).click({ timeout: 2_000 });
    await expect(box).toHaveText(option, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

// Column A from the top with the keyboard. The selection can jump back to A1
// while the editor settles (a known issue being fixed separately), so this
// retries from a fresh click.
async function rowsVisitedDown(page: Page, steps: number): Promise<string[]> {
  let seen: string[] = [];
  await expect(async () => {
    await page.locator(".fortune-cell-area").click({ position: { x: 30, y: 10 } });
    await expect(page.locator(".fortune-name-box")).toHaveText("A1", { timeout: 1_000 });
    seen = [];
    for (let i = 0; i < steps; i++) {
      await page.keyboard.press("ArrowDown");
      seen.push((await page.locator(".fortune-name-box").textContent()) ?? "");
    }
    expect(new Set(seen).size).toBe(seen.length);
  }).toPass({ timeout: 20_000 });
  return seen;
}

test("filters, conditional formats and validation persist", async ({ page }) => {
  const id = await createSheet(page.request, "e2e sheets data tools");
  try {
    await saveSheet(page.request, id, workbook());
    await openSheet(page, id);

    // 1. A 3-colour scale on the scores and a data bar on the trend.
    await menu(page, "Format", "Conditional formatting");
    await page.getByRole("button", { name: "Add rule" }).click();
    await page.getByLabel("Apply to range").fill("B2:B9");
    await pick(page, "Format cells if…", "Colour scale");
    await page.getByRole("button", { name: "Save rule" }).click();
    await page.getByRole("button", { name: "Add rule" }).click();
    await page.getByLabel("Apply to range").fill("C2:C9");
    await pick(page, "Format cells if…", "Data bar");
    await page.getByRole("button", { name: "Save rule" }).click();
    await expect(page.getByTestId("cf-rule")).toHaveCount(2);
    await page.getByRole("button", { name: "Done" }).click();

    // 2. A list validation on Status.
    await menu(page, "Data", "Data validation");
    await page.getByLabel("Apply to range").fill("D2:D9");
    await pick(page, "Criteria", "List of items / range");
    await page.getByLabel("Dropdown options").fill("Open,Closed");
    await page.getByRole("button", { name: "Apply" }).click();

    // 3. Filter: scores greater than 50.
    await menu(page, "Data", "Filter by values or condition…");
    await pick(page, "Column", "B — Score");
    await page.getByRole("tab", { name: "Condition" }).click();
    await pick(page, "First condition operator", "Is greater than");
    await page.getByLabel("First condition value").fill("50");
    await page.getByRole("button", { name: "Apply" }).click();

    // Everything is saved on the sheet.
    const hiddenWant = ["2", "5", "8"]; // Brook 35, Eli 12, Hal 44
    await expect
      .poll(
        async () => {
          const s = (await getSheetData(page.request, id))[0] ?? {};
          return {
            cf: (s.grownCF ?? []).map((r: any) => r.type),
            dv: (s.grownDV ?? []).map((r: any) => [r.type, r.formula1]),
            filter: s.grownFilter?.columns?.["1"]?.type ?? null,
            hidden: Object.keys(s.config?.rowhidden ?? {}).sort(),
          };
        },
        { timeout: 20_000 },
      )
      .toEqual({ cf: ["colorScale", "dataBar"], dv: [["list", "Open,Closed"]], filter: "custom", hidden: hiddenWant });

    // Validation: a value outside the list is rejected with a notice.
    await expect(async () => {
      await page.locator(".fortune-cell-area").click({ position: { x: 30, y: 10 } });
      await expect(page.locator(".fortune-name-box")).toHaveText("A1", { timeout: 1_000 });
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowDown");
      await expect(page.locator(".fortune-name-box")).toHaveText("D2", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.keyboard.type("Maybe");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("sheet-notice")).toContainText("Choose a value from the list");

    await page.screenshot({ path: SHOT });

    // Reload: the rules come back and the filter still hides the same rows.
    await openSheet(page, id);
    const s = (await getSheetData(page.request, id))[0];
    expect(s.dataVerification?.["1_3"]?.type).toBe("dropdown");
    expect((s.luckysheet_conditionformat_save ?? []).every((x: any) => x.grownDerived)).toBe(true);
    expect(s.celldata.find((c: any) => c.r === 1 && c.c === 3)).toBeUndefined();
    // Keyboard navigation skips the filtered rows: A1 → A2 → A4 → A5 → A7.
    expect(await rowsVisitedDown(page, 4)).toEqual(["A2", "A4", "A5", "A7"]);
    await menu(page, "Format", "Conditional formatting");
    await expect(page.getByTestId("cf-rule")).toHaveCount(2);
    await expect(page.getByTestId("cf-rule").first()).toContainText("3-colour scale");
  } finally {
    await trashSheet(page.request, id);
  }
});
