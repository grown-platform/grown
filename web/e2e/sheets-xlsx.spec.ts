import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { createSheet, trashSheet, getSheetData } from "./helpers";

// Sheets M11: File ▸ Import of an .xlsx written the way Excel writes one
// (styles, number formats, merges, a frozen row, conditional formatting,
// validation, a formula), the imported model, export back to .xlsx and a
// re-import, then View, Print and Protect on the imported sheet.

// JSZip comes from the app's dependencies (the e2e package has none of its own).
const requireApp = createRequire(path.join(process.cwd(), "../app/package.json"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = requireApp("jszip");

const SHOT = process.env.GROWN_M11_SHOT || path.join("test-results", "sheets-xlsx", "sheets-m11.png");

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

async function excelFile(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    "xl/workbook.xml",
    `<workbook ${NS}><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets>` +
      '<definedNames><definedName name="Costs">Budget!$B$2:$B$5</definedName></definedNames></workbook>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
  );
  // Styles: 1 bold white on green header, 2 currency, 3 date, 4 wrapped + centred + bordered.
  zip.file(
    "xl/styles.xml",
    `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>` +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1D8348"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="medium"><color rgb="FF000000"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" wrapText="1"/></xf></cellXfs>' +
      '<dxfs count="1"><dxf><font><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs></styleSheet>',
  );
  const strings = ["Item", "Cost", "Paid", "Due", "Rent", "Food", "Travel", "Books", "Total", "Imported from Excel", "Remember the receipts"];
  zip.file(
    "xl/sharedStrings.xml",
    `<sst ${NS} count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`,
  );
  const s = (ref: string, i: number, style = 0) => `<c r="${ref}" t="s"${style ? ` s="${style}"` : ""}><v>${i}</v></c>`;
  const n = (ref: string, v: number, style = 0) => `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${v}</v></c>`;
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      '<cols><col min="1" max="1" width="18.7109375" customWidth="1"/><col min="2" max="2" width="14.7109375" customWidth="1"/><col min="4" max="4" width="12.7109375" customWidth="1"/></cols>' +
      "<sheetData>" +
      `<row r="1" ht="21" customHeight="1">${s("A1", 0, 1)}${s("B1", 1, 1)}${s("C1", 2, 1)}${s("D1", 3, 1)}</row>` +
      `<row r="2">${s("A2", 4)}${n("B2", 1200, 2)}${n("D2", 45292, 3)}</row>` +
      `<row r="3">${s("A3", 5)}${n("B3", 85.5, 2)}${n("D3", 45323, 3)}</row>` +
      `<row r="4">${s("A4", 6)}${n("B4", 430, 2)}${n("D4", 45352, 3)}</row>` +
      `<row r="5">${s("A5", 7)}${n("B5", 60.25, 2)}${n("D5", 45383, 3)}</row>` +
      `<row r="6">${s("A6", 8, 1)}<c r="B6" s="2"><f>SUM(B2:B5)</f><v>1775.75</v></c></row>` +
      `<row r="8" ht="30" customHeight="1">${s("A8", 9, 4)}<c r="B8" s="4"/></row>` +
      "</sheetData>" +
      '<mergeCells count="1"><mergeCell ref="A8:B8"/></mergeCells>' +
      '<conditionalFormatting sqref="B2:B5"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>100</formula></cfRule></conditionalFormatting>' +
      '<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="C2:C5"><formula1>"Yes,No"</formula1></dataValidation></dataValidations>' +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup orientation="landscape"/></worksheet>',
  );
  zip.file("xl/worksheets/sheet2.xml", `<worksheet ${NS}><sheetData><row r="1">${s("A1", 10)}</row></sheetData></worksheet>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function openSheet(page: Page, id: string) {
  await page.goto(`/sheets/d/${id}`);
  await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
}

async function fileMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  // Items may carry a shortcut hint ("Print Ctrl+P").
  await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).first().click();
}

async function menu(page: Page, top: string, item: string) {
  await page.getByRole("button", { name: top, exact: true }).click();
  // Show/Zoom entries are checkbox/radio menu items.
  await page.locator('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]').filter({ hasText: item }).first().click();
}

async function importFile(page: Page, name: string, buffer: Buffer, mode: string, sheets = 2) {
  await fileMenu(page, "Import");
  const dialog = page.getByRole("dialog", { name: "Import file" });
  await dialog.getByTestId("import-file-input").setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await expect(dialog.getByTestId("import-summary")).toContainText(`${sheets} sheets`);
  await dialog.getByRole("radio", { name: mode }).check();
  await dialog.getByRole("button", { name: "Import data" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

const cellOf = (sheet: any, r: number, c: number) => sheet?.celldata?.find((x: any) => x.r === r && x.c === c)?.v;

test("import an Excel workbook, export it and import it again", async ({ page }) => {
  const id = await createSheet(page.request, "e2e sheets xlsx");
  let copyId = "";
  try {
    await openSheet(page, id);
    await importFile(page, "budget.xlsx", await excelFile(), "Insert new sheet(s)");

    // The imported sheets are saved with their formats, merges and rules.
    let budget: any;
    await expect
      .poll(async () => {
        const wb = await getSheetData(page.request, id);
        budget = wb.find((s: any) => s.name === "Budget");
        return wb.map((s: any) => s.name);
      })
      .toEqual(["Sheet1", "Budget", "Notes"]);
    expect(cellOf(budget, 0, 0)).toMatchObject({ v: "Item", bl: 1, bg: "#1d8348", fc: "#ffffff", fs: 12 });
    expect(cellOf(budget, 1, 1)).toMatchObject({ v: 1200, ct: { fa: '"$"#,##0.00', t: "n" } });
    expect(cellOf(budget, 1, 3)).toMatchObject({ v: 45292, ct: { fa: "m/d/yyyy", t: "d" } });
    // The formula keeps its text; the server engine computed its value on save.
    expect(cellOf(budget, 5, 1)).toMatchObject({ f: "=SUM(B2:B5)", v: 1775.75 });
    expect(budget.config.merge).toEqual({ "7_0": { r: 7, c: 0, rs: 1, cs: 2 } });
    expect(cellOf(budget, 7, 0)).toMatchObject({ ht: 0, tb: "2" });
    // 18.71 characters of 7 px plus 5 px padding.
    expect(budget.config.columnlen["0"]).toBe(131);
    expect(budget.config.rowlen["0"]).toBe(28);
    expect(budget.frozen).toEqual({ type: "rangeRow", range: { row_focus: 0, column_focus: 0 } });
    expect(budget.grownCF).toEqual([
      expect.objectContaining({ type: "cellIs", operator: "greaterThan", formula1: "100", ranges: [{ r1: 1, c1: 1, r2: 4, c2: 1 }], style: { color: "#9c0006", fill: "#ffc7ce" } }),
    ]);
    expect(budget.grownDV).toEqual([expect.objectContaining({ type: "list", formula1: "Yes,No", ranges: [{ r1: 1, c1: 2, r2: 4, c2: 2 }] })]);
    expect(budget.grownPrint).toMatchObject({ orientation: "landscape" });
    const wb0 = await getSheetData(page.request, id);
    expect(wb0[0]._namedRanges).toEqual([expect.objectContaining({ name: "Costs", range: "B2:B5", sheetName: "Budget" })]);

    // Show the imported sheet and keep a screenshot of it.
    await page.locator(".luckysheet-sheets-item", { hasText: "Budget" }).click();
    await page.waitForTimeout(1_500);
    fs.mkdirSync(path.dirname(SHOT), { recursive: true });
    await page.screenshot({ path: SHOT });

    // Export to .xlsx: the file carries the formats, merge, rule and validation.
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("button", { name: "Download" }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Microsoft Excel (.xlsx)" }).click()]);
    const exported = fs.readFileSync((await dl.path())!);
    const out = await JSZip.loadAsync(exported);
    const sheet2 = await out.file("xl/worksheets/sheet2.xml").async("string");
    expect(sheet2).toContain('<mergeCell ref="A8:B8"/>');
    expect(sheet2).toContain('<conditionalFormatting sqref="B2:B5">');
    expect(sheet2).toContain('<dataValidation type="list"');
    expect(sheet2).toContain("<f>SUM(B2:B5)</f>");
    expect(sheet2).toContain('state="frozen"');
    expect(await out.file("xl/styles.xml").async("string")).toContain('formatCode="&quot;$&quot;#,##0.00"');

    // Re-import the exported file as a new spreadsheet: the same model comes back.
    await importFile(page, "budget-export.xlsx", exported, "Create new spreadsheet", 3);
    await expect.poll(() => page.url(), { timeout: 15_000 }).not.toContain(id);
    copyId = page.url().split("/sheets/d/")[1];
    expect(copyId).not.toBe(id);
    const again = (await getSheetData(page.request, copyId)).find((s: any) => s.name === "Budget");
    for (const [r, c] of [[0, 0], [1, 1], [1, 3], [5, 1], [7, 0]] as const) {
      const a = cellOf(again, r, c);
      const b = cellOf(budget, r, c);
      expect({ v: a?.v, f: a?.f, fa: a?.ct?.fa, bl: a?.bl, bg: a?.bg }, `cell ${r},${c}`).toEqual({ v: b?.v, f: b?.f, fa: b?.ct?.fa, bl: b?.bl, bg: b?.bg });
    }
    expect(again.config.merge).toEqual(budget.config.merge);
    expect(again.frozen).toEqual(budget.frozen);
    expect(again.grownCF.map((r: any) => [r.type, r.formula1, r.style])).toEqual(budget.grownCF.map((r: any) => [r.type, r.formula1, r.style]));
    expect(again.grownDV.map((r: any) => [r.type, r.formula1])).toEqual([["list", "Yes,No"]]);
  } finally {
    await trashSheet(page.request, id);
    if (copyId) await trashSheet(page.request, copyId);
  }
});

test("view options, print settings and protected ranges on a sheet", async ({ page }) => {
  const id = await createSheet(page.request, "e2e sheets view print protect");
  try {
    await openSheet(page, id);
    await importFile(page, "budget.xlsx", await excelFile(), "Replace spreadsheet");
    await expect.poll(async () => (await getSheetData(page.request, id)).map((s: any) => s.name)).toEqual(["Budget", "Notes"]);
    await page.waitForTimeout(1_000);

    // View ▸ Show ▸ Formulas with Ctrl+`, gridlines off, zoom 150 %.
    await page.locator(".fortune-cell-area").click({ position: { x: 60, y: 40 } });
    await page.keyboard.press("Control+Backquote");
    await menu(page, "View", "Gridlines");
    await menu(page, "View", "150%");
    await expect
      .poll(async () => {
        const s = (await getSheetData(page.request, id))[0];
        return [s.grownView?.showFormulas, s.showGridLines, s.zoomRatio];
      }, { timeout: 15_000 })
      .toEqual([true, 0, 1.5]);
    await page.keyboard.press("Control+Backquote");
    await menu(page, "View", "100%");

    // File ▸ Print: settings, a preview with its page count, then saved on the sheet.
    await fileMenu(page, "Print");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("print-page-count")).toHaveText(/\d+ pages?/);
    await dialog.getByRole("combobox", { name: "Scale" }).click();
    await page.getByRole("option", { name: "Fit to page" }).click();
    await expect(dialog.getByTestId("print-page-count")).toHaveText("1 page");
    await dialog.getByLabel("Rows to repeat").fill("1:1");
    await dialog.getByLabel("Show gridlines").check();
    await dialog.getByLabel("Footer").fill("Page &P of &N");
    await expect(dialog.getByTestId("print-preview")).toBeVisible();
    const preview = page.frameLocator('[data-testid="print-preview"]');
    await expect(preview.locator("section.page")).toHaveCount(1);
    await expect(preview.locator(".ftr")).toContainText("Page 1 of 1");
    await dialog.getByRole("button", { name: "Save settings" }).click();
    await expect
      .poll(async () => (await getSheetData(page.request, id))[0].grownPrint, { timeout: 15_000 })
      .toMatchObject({ orientation: "landscape", fitToPage: true, titleRows: [0, 0], gridLines: true, footer: "Page &P of &N" });

    // Insert ▸ Page break at the selected cell: a row break above it, a column break left of it.
    await page.locator(".fortune-cell-area").click({ position: { x: 200, y: 110 } });
    await page.waitForTimeout(300);
    const at = /^([A-Z]+)(\d+)$/.exec((await page.locator(".fortune-name-box").textContent()) ?? "") ?? ["", "A", "1"];
    const row = Number(at[2]) - 1;
    const col = at[1].charCodeAt(0) - 65;
    await menu(page, "Insert", "Insert page break");
    await expect
      .poll(async () => {
        const s = (await getSheetData(page.request, id))[0];
        return [s.grownPrint?.rowBreaks, s.grownPrint?.colBreaks, s.grownView?.pageBreakPreview];
      }, { timeout: 15_000 })
      .toEqual([row > 0 ? [row] : [], col > 0 ? [col] : [], true]);

    // Data ▸ Protect sheets and ranges: a protected range.
    await menu(page, "Data", "Protect sheets and ranges");
    const prot = page.getByRole("dialog", { name: "Protected sheets and ranges" });
    await prot.getByRole("button", { name: "Add a range" }).click();
    await prot.getByLabel("Range name").fill("1test");
    await expect(prot.getByRole("button", { name: "Done" })).toBeDisabled();
    await prot.getByLabel("Range name").fill("Costs");
    await prot.getByLabel("Protected range").fill("B2:B6");
    await prot.getByRole("button", { name: "Done" }).click();
    await expect(prot.getByTestId("protection-list")).toContainText("Costs");
    await expect
      .poll(async () => (await getSheetData(page.request, id))[0].grownProtection?.ranges ?? [], { timeout: 15_000 })
      .toEqual([expect.objectContaining({ name: "Costs", ranges: [{ r1: 1, c1: 1, r2: 5, c2: 1 }] })]);
    await page.keyboard.press("Escape");

    // The owner may still edit protected cells.
    await page.reload();
    await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
    expect((await getSheetData(page.request, id))[0].grownProtection.ranges[0].name).toBe("Costs");
  } finally {
    await trashSheet(page.request, id);
  }
});
