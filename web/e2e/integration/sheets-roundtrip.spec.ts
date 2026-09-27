import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import * as path from "node:path";
import { createSheet, trashSheet, saveSheet, getSheetData } from "../helpers";
import { num, txt, fx, openSheet, select, menu, typeAt } from "../sheetsGrid";
import {
  CSV_MIME,
  ODS_MIME,
  XLSX_MIME,
  cellAt,
  downloadAs,
  driveUpload,
  importAsNew,
  openInSheetsFromDrive,
  purgeDriveFile,
  savedWb,
  sheetNamed,
} from "./sheets-helpers";

// Sheets file round trips through the real UI. A two-sheet workbook is
// built partly from the API (data, a CF rule, a list validation, a chart)
// and partly in the grid (an Excel table, a structured reference, a
// cross-sheet formula, a currency format, a merge, a pivot table). It is
// downloaded as .xlsx, .ods, .csv and .pdf with File ▸ Download, and each
// download is imported again through File ▸ Import and through Drive upload →
// Open with ▸ Sheets → "Open in Sheets". The known losses are asserted as
// such, with the section of docs/plans/onlyoffice-parity/sheets.md that
// documents them.

const requireApp = createRequire(path.join(process.cwd(), "../app/package.json"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = requireApp("jszip");

const R = (r1: number, c1: number, r2: number, c2: number) => ({ r1, c1, r2, c2 });

function seed() {
  const data: Record<string, any> = {
    A1: txt("Region"), B1: txt("Qty"), C1: txt("Price"),
    A2: txt("East"), B2: num(2), C2: num(10),
    A3: txt("West"), B3: num(3), C3: num(20),
    A4: txt("North"), B4: num(5), C4: num(4),
    A5: txt("South"), B5: num(1), C5: num(7),
    A8: txt("Merged note"),
  };
  const celldata = Object.entries(data).map(([ref, v]) => {
    const c = ref.charCodeAt(0) - 65;
    return { r: Number(ref.slice(1)) - 1, c, v };
  });
  return [
    {
      name: "Data", id: "rt-data", order: 0, row: 60, column: 20, celldata,
      grownCF: [
        { id: "cf-rt-1", type: "cellIs", ranges: [R(1, 2, 4, 2)], priority: 1, operator: "greaterThan", formula1: "10", style: { fill: "#ffc7ce", color: "#9c0006" } },
      ],
      grownDV: [
        {
          id: "dv-rt-1", type: "list", operator: "between", formula1: "Yes,No", formula2: "", allowBlank: true, showDropdown: true,
          showInput: true, promptTitle: "", prompt: "", showError: true, errorStyle: "stop", errorTitle: "", error: "", ranges: [R(1, 3, 4, 3)],
        },
      ],
      grownCharts: [
        {
          id: "rt-chart", type: "column", title: "Qty by region", range: { r0: 0, r1: 4, c0: 0, c1: 1 }, headerRow: true, labelCol: true,
          sheetId: "rt-data", anchor: { r: 10, c: 0, dx: 4, dy: 4, w: 360, h: 220 },
        },
      ],
    },
    { name: "Summary", id: "rt-sum", order: 1, row: 30, column: 10, celldata: [
      { r: 0, c: 0, v: fx("=SUM(Data!C2:C5)") },
      { r: 0, c: 1, v: txt("Total price") },
    ] },
  ];
}

/** The parts every full-fidelity (xlsx) copy must keep. */
function expectXlsxFidelity(wb: any[], label: string) {
  expect(wb.map((s) => s.name), label).toEqual(["Data", "Summary"]);
  const d = sheetNamed(wb, "Data");
  const s = sheetNamed(wb, "Summary");
  // Formulas: structured reference, cross-sheet both ways, with engine values.
  expect(cellAt(d, "F1"), label).toMatchObject({ f: "=SUM(Table1[Qty])", v: 11 });
  expect(cellAt(d, "F2"), label).toMatchObject({ f: "=Summary!A1+1", v: 42 });
  expect(cellAt(s, "A1"), label).toMatchObject({ f: "=SUM(Data!C2:C5)", v: 41 });
  // Number format (currency) on the prices.
  expect(String(cellAt(d, "C3")?.ct?.fa), label).toContain("$");
  expect(cellAt(d, "C3")?.v, label).toBe(20);
  // Merge, CF, DV, the table and the chart.
  expect(d.config?.merge?.["7_0"], label).toMatchObject({ r: 7, c: 0, rs: 1, cs: 2 });
  expect(d.grownCF?.map((r: any) => [r.type, r.operator, r.formula1, r.style?.fill]), label).toEqual([["cellIs", "greaterThan", "10", "#ffc7ce"]]);
  expect(d.grownDV?.map((r: any) => [r.type, r.formula1]), label).toEqual([["list", "Yes,No"]]);
  expect(d.grownTables?.map((t: any) => [t.name, t.ref]), label).toEqual([["Table1", R(0, 0, 4, 2)]]);
  expect(d.grownCharts?.map((c: any) => [c.type, c.title, c.range]), label).toEqual([["column", "Qty by region", { r0: 0, r1: 4, c0: 0, c1: 1 }]]);
  // The pivot's report cells survive as plain cells …
  expect(pivotTotal(d), label).toBe(11);
  // … but the pivot definition does not: "Pivots are not written to or read
  // from xlsx yet" (sheets.md §15.3; also §14.5 "Charts, pivots … are not
  // written" — charts have since been added by M10, §16.1).
  expect(wb[0].grownPivots ?? [], label).toEqual([]);
}

/** The Grand Total of the pivot written at H1 (column H, its value in I). */
function pivotTotal(sheet: any): unknown {
  const gt = sheet?.celldata?.find((x: any) => x.c === 7 && x.v?.v === "Grand Total");
  return gt ? sheet.celldata.find((x: any) => x.r === gt.r && x.c === 8)?.v?.v : undefined;
}

async function buildInGrid(page: Page, id: string) {
  // Insert ▸ Table over the data (A1:C5 → Table1).
  await select(page, "B2");
  await menu(page, "Insert", /^Table/);
  const dlg = page.getByRole("dialog").filter({ hasText: "Create table" });
  await expect(dlg.getByLabel("Table range")).toHaveValue("A1:C5");
  await dlg.getByRole("button", { name: "OK" }).click();
  await expect(dlg).toBeHidden();
  // A structured reference and a cross-sheet formula, typed.
  await typeAt(page, "F1", "=SUM(Table1[Qty])");
  await typeAt(page, "F2", "=Summary!A1+1");
  // Currency on the prices (Ctrl+Shift+4).
  await select(page, "C2", 3, 0);
  await page.keyboard.press("Control+Shift+Digit4");
  // Format ▸ Merge cells on A8:B8.
  await select(page, "A8", 0, 1);
  await menu(page, "Format", "Merge cells");
  // Insert ▸ Pivot table: Sum of Qty by Region at H1.
  await select(page, "A1");
  await menu(page, "Insert", "Pivot table");
  const pv = page.getByRole("dialog", { name: "Create pivot table" });
  await pv.getByLabel("Data range").fill("Data!A1:C5");
  await pv.getByRole("combobox", { name: "Add row field" }).click();
  await page.getByRole("option", { name: "Region", exact: true }).click();
  await pv.getByRole("combobox", { name: "Add value field" }).click();
  await page.getByRole("option", { name: "Qty", exact: true }).click();
  await pv.getByRole("radio", { name: "Existing sheet" }).check();
  await pv.getByLabel("Pivot location").fill("Data!H1");
  await pv.getByRole("button", { name: "Create" }).click();
  await expect(pv).toBeHidden();

  // Everything lands in the saved model.
  const wb = await savedWb(page.request, id, (wb) => {
    const d = sheetNamed(wb, "Data");
    expect(cellAt(d, "F1")).toMatchObject({ f: "=SUM(Table1[Qty])", v: 11 });
    expect(cellAt(d, "F2")).toMatchObject({ f: "=Summary!A1+1", v: 42 });
    expect(String(cellAt(d, "C5")?.ct?.fa)).toContain("$");
    expect(d.config?.merge?.["7_0"]).toMatchObject({ rs: 1, cs: 2 });
    expect(d.grownTables?.[0]?.name).toBe("Table1");
    expect(wb[0].grownPivots?.length).toBe(1);
    expect(pivotTotal(d)).toBe(11);
  }, 30_000);
  expect(sheetNamed(wb, "Data").grownCharts).toHaveLength(1);
  return wb;
}

test("sheets: rich workbook round-trips through xlsx/ods/csv/pdf download, File ▸ Import and Drive", async ({ page }) => {
  test.setTimeout(420_000);
  const sheets: string[] = [];
  const files: string[] = [];
  const src = await createSheet(page.request, "e2e rt source");
  sheets.push(src);
  try {
    await saveSheet(page.request, src, seed());
    await openSheet(page, src);
    await buildInGrid(page, src);
    // The chart is on the grid.
    await expect(page.getByTestId("grid-chart")).toBeVisible();

    // ---- .xlsx ------------------------------------------------------------
    const xlsx = await test.step("download .xlsx", async () => {
      const { bytes, name } = await downloadAs(page, "Microsoft Excel (.xlsx)");
      expect(name).toBe("e2e rt source.xlsx");
      const zip = await JSZip.loadAsync(bytes);
      const parts = Object.keys(zip.files);
      expect(parts).toEqual(expect.arrayContaining(["xl/tables/table1.xml", "xl/charts/chart1.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]));
      const s1 = await zip.file("xl/worksheets/sheet1.xml").async("string");
      expect(s1).toContain('<mergeCell ref="A8:B8"/>');
      expect(s1).toContain('<conditionalFormatting sqref="C2:C5">');
      expect(s1).toContain('<dataValidation type="list"');
      expect(s1).toContain("Summary!A1+1");
      // Saved form of a structured reference (sheets.md §20).
      expect(s1).toMatch(/SUM\(Table1\[Qty\]\)/);
      // No pivot parts (sheets.md §15.3).
      expect(parts.some((p) => p.includes("pivot"))).toBe(false);
      return bytes;
    });

    await test.step("re-import .xlsx through File ▸ Import", async () => {
      const id = await importAsNew(page, "rt.xlsx", xlsx, XLSX_MIME);
      sheets.push(id);
      const wb = await savedWb(page.request, id, (wb) => expect(sheetNamed(wb, "Data")).toBeTruthy());
      expectXlsxFidelity(wb, "File ▸ Import xlsx");
      // The re-imported copy renders its chart.
      await expect(page.getByTestId("grid-chart")).toBeVisible({ timeout: 20_000 });
    });

    await test.step("re-import .xlsx through Drive → Open in Sheets", async () => {
      const fileId = await driveUpload(page, "rt drive.xlsx", xlsx, XLSX_MIME);
      files.push(fileId);
      const id = await openInSheetsFromDrive(page, fileId);
      sheets.push(id);
      const wb = await savedWb(page.request, id, (wb) => expect(sheetNamed(wb, "Data")).toBeTruthy());
      expectXlsxFidelity(wb, "Drive xlsx");
      // The Drive original is untouched (Open in Sheets makes a copy).
      const r = await page.request.get(`/api/v1/drive/files/${fileId}`);
      expect(r.ok()).toBeTruthy();
    });

    // ---- .ods -------------------------------------------------------------
    await openSheet(page, src);
    const ods = await test.step("download .ods", async () => {
      const { bytes, name } = await downloadAs(page, "OpenDocument (.ods)");
      expect(name).toBe("e2e rt source.ods");
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      expect(bytes.includes(Buffer.from("application/vnd.oasis.opendocument.spreadsheet"))).toBe(true);
      return bytes;
    });
    const expectOds = (wb: any[], label: string) => {
      // SheetJS keeps values, formulas, merges and sizes (sheets.md §14.1).
      expect(wb.map((s) => s.name), label).toEqual(["Data", "Summary"]);
      const d = sheetNamed(wb, "Data");
      expect(cellAt(d, "A2")?.v, label).toBe("East");
      expect(cellAt(d, "C3")?.v, label).toBe(20);
      // Number formats are lost: SheetJS CE 0.18.5's ODS writer emits no
      // number styles for cell formats (only its default date style), so the
      // currency cells come back as General. sheets.md §14.1 and export.ts
      // say ods export keeps number formats; it does not.
      expect(String(cellAt(d, "C3")?.ct?.fa ?? "General"), label).not.toContain("$");
      expect(cellAt(d, "F2"), label).toMatchObject({ f: "=Summary!A1+1", v: 42 });
      expect(cellAt(sheetNamed(wb, "Summary"), "A1"), label).toMatchObject({ f: "=SUM(Data!C2:C5)", v: 41 });
      expect(d.config?.merge?.["7_0"], label).toMatchObject({ rs: 1, cs: 2 });
      expect(pivotTotal(d), label).toBe(11);
      // Documented losses: ods goes through SheetJS CE, which does not write
      // conditional formats, validation, tables or charts (sheets.md §14.1,
      // "SheetJS CE drops styles, conditional formats, validation …";
      // `export.ts`: "ods — SheetJS writes values, formulas, number formats,
      // merges and column widths"), nor pivots (§15.3).
      expect(d.grownCF ?? [], label).toEqual([]);
      expect(d.grownDV ?? [], label).toEqual([]);
      expect(d.grownTables ?? [], label).toEqual([]);
      expect(d.grownCharts ?? [], label).toEqual([]);
      expect(wb[0].grownPivots ?? [], label).toEqual([]);
      // Without the table, the structured reference no longer resolves; the
      // formula text itself is kept.
      expect(cellAt(d, "F1")?.f, label).toBe("=SUM(Table1[Qty])");
    };
    await test.step("re-import .ods through File ▸ Import", async () => {
      const id = await importAsNew(page, "rt.ods", ods, ODS_MIME);
      sheets.push(id);
      expectOds(await savedWb(page.request, id, (wb) => expect(sheetNamed(wb, "Data")).toBeTruthy()), "File ▸ Import ods");
    });
    await test.step("re-import .ods through Drive → Open in Sheets", async () => {
      const fileId = await driveUpload(page, "rt drive.ods", ods, ODS_MIME);
      files.push(fileId);
      const id = await openInSheetsFromDrive(page, fileId);
      sheets.push(id);
      expectOds(await savedWb(page.request, id, (wb) => expect(sheetNamed(wb, "Data")).toBeTruthy()), "Drive ods");
    });

    // ---- .csv (the current sheet, values only) ---------------------------
    await openSheet(page, src);
    const csv = await test.step("download .csv", async () => {
      const { bytes, name } = await downloadAs(page, "Comma Separated Values (.csv)");
      expect(name).toBe("e2e rt source.csv");
      const lines = bytes.toString("utf8").split("\n");
      expect(lines[0]).toMatch(/^Region,Qty,Price,,,11/);
      expect(lines[1]).toMatch(/^East,2,10,,,42/);
      return bytes;
    });
    const expectCsv = (wb: any[], label: string) => {
      // CSV carries one sheet's values: formulas, formats, merges and every
      // grown* extra are gone by the nature of the format (export.ts csv).
      expect(wb, label).toHaveLength(1);
      const d = wb[0];
      expect(cellAt(d, "A1")?.v, label).toBe("Region");
      expect(cellAt(d, "C3")?.v, label).toBe(20);
      expect(cellAt(d, "F1")?.v, label).toBe(11);
      expect(cellAt(d, "F1")?.f, label).toBeUndefined();
      expect(cellAt(d, "F2")?.v, label).toBe(42);
      expect(pivotTotal(d), label).toBe(11);
    };
    await test.step("re-import .csv through File ▸ Import", async () => {
      const id = await importAsNew(page, "rt.csv", csv, CSV_MIME);
      sheets.push(id);
      expectCsv(await savedWb(page.request, id, (wb) => expect(cellAt(wb[0], "A1")).toBeTruthy()), "File ▸ Import csv");
    });
    await test.step("re-import .csv through Drive → Open in Sheets", async () => {
      const fileId = await driveUpload(page, "rt drive.csv", csv, CSV_MIME);
      files.push(fileId);
      const id = await openInSheetsFromDrive(page, fileId);
      sheets.push(id);
      expectCsv(await savedWb(page.request, id, (wb) => expect(cellAt(wb[0], "A1")).toBeTruthy()), "Drive csv");
    });

    // ---- .pdf (export only) ---------------------------------------------
    await openSheet(page, src);
    await test.step("download .pdf", async () => {
      // PDF goes through /api/v1/docs/convert (pandoc + tectonic, sheets.md
      // §14.5 "PDF export still goes through the HTML-table convert
      // endpoint"). Stacks without tectonic answer with an error, which the
      // editor reports in an alert.
      let alertText = "";
      page.once("dialog", (d) => {
        alertText = d.message();
        void d.accept();
      });
      await page.getByRole("button", { name: "File", exact: true }).click();
      await page.getByRole("button", { name: "Download" }).click();
      const dl = page.waitForEvent("download", { timeout: 60_000 }).catch(() => null);
      await page.getByRole("menuitem", { name: "PDF Document (.pdf)" }).click();
      const got = await Promise.race([dl, expect.poll(() => alertText, { timeout: 60_000 }).not.toBe("").then(() => null)]);
      if (got) {
        const bytes = await (await import("node:fs/promises")).readFile((await got.path())!);
        expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
        console.log(`[sheets-roundtrip] pdf export: ${bytes.length} bytes`);
      } else {
        expect(alertText).toMatch(/Download failed: Export failed: HTTP 5\d\d/);
        console.log(`[sheets-roundtrip] pdf export unavailable: ${alertText.slice(0, 160)}`);
        test.info().annotations.push({ type: "pdf-export", description: `converter unavailable on this stack: ${alertText.slice(0, 160)}` });
      }
    });

    // The source itself is unchanged by all of this.
    expectNoLoss(await getSheetData(page.request, src));
  } finally {
    for (const id of sheets) await trashSheet(page.request, id);
    for (const id of files) await purgeDriveFile(page.request, id);
  }
});

function expectNoLoss(wb: any[]) {
  const d = sheetNamed(wb, "Data");
  expect(cellAt(d, "F1")).toMatchObject({ v: 11 });
  expect(wb[0].grownPivots).toHaveLength(1);
  expect(d.grownCharts).toHaveLength(1);
}
