import { test, expect, type Page } from "@playwright/test";
import * as path from "node:path";
import { createSheet, trashSheet, saveSheet, getSheetData } from "./helpers";

// Number formats (Sheets M6): cells render through numberFormat.ts, computed
// cells get their display text from the Go port, typed input is parsed, and
// Format ▸ Number applies presets and custom codes.
//
// FortuneSheet paints the grid on a canvas; its screen-reader region
// (#sr-selection) announces "<column>. <row> <display text>" of the focused
// cell, the same `m` the canvas paints.

const SHOT_DIR = process.env.GROWN_SHOT_DIR || path.join("test-results", "numfmt");

const ACCOUNTING = '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)';

// [value or formula, format, expected display text]
const ROWS: Array<[number | string, string, string]> = [
  [1234.5, "#,##0.00", "1,234.50"],
  [-1234.5, ACCOUNTING, "$(1,234.50)"],
  [0.125, "0.0%", "12.5%"],
  [45293, "yyyy-mm-dd", "2024-01-02"],
  [45293.75, "dddd, mmmm d, yyyy h:mm AM/PM", "Tuesday, January 2, 2024 6:00 PM"],
  [1.5, "[h]:mm", "36:00"],
  [1.75, "# ?/?", "1 3/4"],
  [123456789012, "General", "1.23457E+11"],
  [1234567, '[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', "1.2M"],
  [-42, "0;[Red](0)", "(42)"],
  ['=TEXT(0.5,"0%")', "General", "50%"],
  ["=A1*2", "#,##0.00", "2,469.00"],
  ["=59+1", "d-mmm-yyyy", "29-Feb-1900"], // the 1900 system's fictitious leap day
];

function workbook() {
  return [
    {
      name: "Sheet1",
      id: "nf1",
      order: 0,
      config: { columnlen: { 0: 260 } },
      celldata: ROWS.map(([v, fa], r) => ({
        r,
        c: 0,
        v:
          typeof v === "string"
            ? { f: v, ct: { fa, t: "n" } }
            : { v, ct: { fa, t: fa.includes("y") || fa.includes("h") ? "d" : "n" } },
      })),
    },
  ];
}

// Select a cell with the keyboard, starting from A1 (the name box is read-only).
async function goTo(page: Page, ref: string) {
  const col = ref.replace(/\d+/g, "").charCodeAt(0) - 65;
  const row = Number(ref.replace(/\D+/g, "")) - 1;
  await page.locator(".fortune-cell-area").click({ position: { x: 30, y: 10 } });
  await expect(page.locator(".fortune-name-box")).toHaveText("A1");
  const box = page.locator(".fortune-name-box");
  const letter = (c: number) => String.fromCharCode(65 + c);
  for (let i = 1; i <= col; i++) {
    await page.keyboard.press("ArrowRight");
    await expect(box).toHaveText(`${letter(i)}1`);
  }
  for (let i = 1; i <= row; i++) {
    await page.keyboard.press("ArrowDown");
    await expect(box).toHaveText(`${letter(col)}${i + 1}`);
  }
}

async function srText(page: Page, ref: string, want: string, timeout?: number) {
  const col = ref.replace(/\d+/g, "");
  const row = ref.replace(/\D+/g, "");
  await expect(page.locator("#sr-selection")).toHaveText(`${col}. ${row} ${want}`, { timeout });
}

// A check that navigates is retried while the editor settles after opening.
async function checkCell(page: Page, ref: string, want: string) {
  await expect(async () => {
    await goTo(page, ref);
    await srText(page, ref, want, 1_000);
  }).toPass({ timeout: 20_000 });
}

async function openSheet(page: Page, id: string) {
  await page.goto(`/sheets/d/${id}`);
  await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
}

test.describe.serial("sheets number formats", () => {
  test("a sheet with various formats renders its display text", async ({ page }) => {
    const id = await createSheet(page.request, "e2e number formats");
    try {
      await saveSheet(page.request, id, workbook());
      // The server engine writes the formula cells' display text with the port.
      const saved = await getSheetData(page.request, id);
      const cell = (r: number) => saved[0].celldata.find((cd: any) => cd.r === r && cd.c === 0)?.v;
      expect(cell(10)?.m).toBe("50%");
      expect(cell(11)?.m).toBe("2,469.00");
      expect(cell(12)?.m).toBe("29-Feb-1900");

      await openSheet(page, id);
      for (let r = 0; r < ROWS.length; r++) await checkCell(page, `A${r + 1}`, ROWS[r][2]);
      await goTo(page, "C2");
      await page.screenshot({ path: path.join(SHOT_DIR, "sheets-number-formats.png") });
    } finally {
      await trashSheet(page.request, id);
    }
  });

  test("typed input and Format > Number", async ({ page }) => {
    const id = await createSheet(page.request, "e2e typed numbers");
    try {
      await openSheet(page, id);
      const typed: Array<[string, string, string]> = [
        ["B1", "1,234.5", "1,234.50"],
        ["B2", "12.5%", "12.50%"],
        ["B3", "(3)", "-3"],
        ["B4", "Jan 15, 2023", "15-Jan-23"],
        ["B5", "1 1/2", "1 1/2"],
        ["B6", "14:30", "14:30"],
      ];
      for (const [ref, text, want] of typed) {
        await goTo(page, ref);
        await page.keyboard.type(text);
        await page.keyboard.press("Enter");
        await checkCell(page, ref, want);
      }

      // Format > Number > Accounting on B1.
      await goTo(page, "B1");
      await page.getByRole("button", { name: "Format", exact: true }).click();
      await page.locator('[data-numfmt="accounting"]').click();
      await checkCell(page, "B1", "$1,234.50");

      // Format > Number > Custom number format.
      await goTo(page, "B2");
      await page.getByRole("button", { name: "Format", exact: true }).click();
      await page.getByRole("menuitem", { name: "Custom number format…" }).click();
      const code = page.getByLabel("Format code");
      await expect(code).toHaveValue("0.00%");
      await code.fill('0.0%" growth"');
      await expect(page.getByTestId("numfmt-preview").first()).toHaveText("12.5% growth");
      await page.screenshot({ path: path.join(SHOT_DIR, "sheets-number-format-dialog.png") });
      await page.getByRole("button", { name: "Apply" }).click();
      await checkCell(page, "B2", "12.5% growth");
      await page.screenshot({ path: path.join(SHOT_DIR, "sheets-number-formats-typed.png") });

      // The autosave carries the parsed values and formats.
      await expect
        .poll(
          async () => {
            const data = await getSheetData(page.request, id);
            const cells = (data[0]?.celldata ?? []) as any[];
            const at = (r: number) => cells.find((cd) => cd.r === r && cd.c === 1)?.v;
            return [at(0)?.v, at(0)?.ct?.fa, at(1)?.v, at(1)?.ct?.fa, at(4)?.v];
          },
          { timeout: 20_000 },
        )
        .toEqual([1234.5, ACCOUNTING, 0.125, '0.0%" growth"', 1.5]);
    } finally {
      await trashSheet(page.request, id);
    }
  });
});
