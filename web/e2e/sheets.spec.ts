import { test, expect } from "@playwright/test";
import {
  createSheet,
  trashSheet,
  saveSheet,
  getSheetData,
  workbookWithCells,
} from "./helpers";

// Sheets e2e via the JSON API. Saving a workbook runs the server-side formula
// engine (RecomputeWorkbook) before persisting, so the round-trip deterministically
// verifies computed results — including the LAMBDA / dynamic-array functions.

// deepValues collects every primitive leaf in a parsed JSON structure, so the
// assertions don't depend on the exact FortuneSheet cell shape.
function deepValues(node: unknown, out: Array<string | number> = []) {
  if (node == null) return out;
  if (typeof node === "number" || typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const v of node) deepValues(v, out);
  } else if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>))
      deepValues(v, out);
  }
  return out;
}

test.describe.serial("sheets formula engine", () => {
  test("computes SUM, LAMBDA, array-expansion and text formulas", async ({
    page,
  }) => {
    const id = await createSheet(page.request, "e2e formulas");
    try {
      const wb = workbookWithCells([
        { r: 0, c: 0, f: "=SUM(111,222)" }, // 333
        { r: 1, c: 0, f: "=LAMBDA(x,x*x)(9)" }, // 81
        { r: 2, c: 0, f: "=SUM(SEQUENCE(4))" }, // 10 (array expands)
        { r: 3, c: 0, f: '=UPPER("grown")' }, // GROWN
        { r: 4, c: 0, f: '=TEXTSPLIT("a|b|c","|")' }, // a b c (spills)
      ]);
      await saveSheet(page.request, id, wb);

      const saved = await getSheetData(page.request, id);
      const values = deepValues(saved);

      // Numbers may serialize as number or string; check both.
      const has = (v: string | number) =>
        values.includes(v) || values.includes(String(v));

      expect(has(333), "SUM(111,222)=333").toBeTruthy();
      expect(has(81), "LAMBDA(x,x*x)(9)=81").toBeTruthy();
      expect(has(10), "SUM(SEQUENCE(4))=10").toBeTruthy();
      expect(has("GROWN"), 'UPPER("grown")').toBeTruthy();
      expect(has("a") && has("b") && has("c"), "TEXTSPLIT spill").toBeTruthy();
    } finally {
      await trashSheet(page.request, id);
    }
  });

  test("a computed formula sheet survives reopening in the UI", async ({
    page,
  }) => {
    const id = await createSheet(page.request, "e2e sheet ui");
    try {
      await saveSheet(
        page.request,
        id,
        workbookWithCells([{ r: 0, c: 0, f: "=SUM(40,2)" }]),
      );
      await page.goto(`/sheets/d/${id}`);
      // The FortuneSheet grid mounts; 42 should appear somewhere in the grid.
      await expect(page.getByText("42", { exact: false }).first()).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await trashSheet(page.request, id);
    }
  });
});
