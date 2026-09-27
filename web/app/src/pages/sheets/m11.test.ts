/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet workbooks are loosely typed. */
import { describe, expect, it } from "vitest";
import { applyImport, csvToWorkbook, importKind, type ImportedWorkbook } from "./sheetImport";
import { defaultPrintSettings } from "./printSettings";
import { headerFooterText, renderPrintHtml } from "./printRender";
import { blockedCellOps } from "./viewTools";

const imported = (cells: any[], name = "Data"): ImportedWorkbook => ({
  sheets: [{ name, id: "imp-0", order: 0, celldata: cells, config: { merge: { "0_0": { r: 0, c: 0, rs: 1, cs: 2 } } } }],
  namedRanges: [{ name: "Totals", range: "A1:B1", sheetId: "imp-0", sheetName: name }],
  warnings: [],
});

describe("import", () => {
  it("detects the file kind", () => {
    expect(importKind("a.xlsx", new Uint8Array([0x50, 0x4b, 3, 4]))).toBe("xlsx");
    expect(importKind("a.ods")).toBe("sheetjs");
    expect(importKind("a.xls")).toBe("sheetjs");
    expect(importKind("a.tsv")).toBe("csv");
    expect(importKind("a.bin", new Uint8Array([0x50, 0x4b]))).toBe("xlsx");
    expect(importKind("a.pdf")).toBeNull();
  });

  it("reads delimited text with types, formulas and quoted fields", () => {
    const wb = csvToWorkbook('﻿name;amount;when\n"Smith; J";12.5;2024-01-31\nx;=B2*2;TRUE\n', {});
    const cells = wb.sheets[0].celldata;
    const at = (r: number, c: number) => cells.find((x: any) => x.r === r && x.c === c)?.v;
    expect(at(1, 0).v).toBe("Smith; J");
    expect(at(1, 1)).toMatchObject({ v: 12.5, ct: { t: "n" } });
    expect(at(1, 2).ct.t).toBe("d");
    expect(at(2, 1).f).toBe("=B2*2");
    expect(at(2, 2).v).toBe(true);
    const text = csvToWorkbook("1,2\n", { convert: false }).sheets[0].celldata;
    expect(text[0].v).toMatchObject({ v: "1", ct: { t: "s" } });
  });

  it("inserts sheets with unique names and merges named ranges", () => {
    const current = [{ name: "Data", id: "a", order: 0, celldata: [{ r: 0, c: 0, v: { f: "=Data!B1" } }], _namedRanges: [{ name: "Old", range: "A1", sheetId: "a", sheetName: "Data" }] }];
    const imp = imported([{ r: 0, c: 0, v: { f: "=Data!B2" } }]);
    const out = applyImport(current, imp, "insertSheets");
    expect(out.map((s) => s.name)).toEqual(["Data", "Data (2)"]);
    expect(out[1].celldata[0].v.f).toBe("='Data (2)'!B2");
    expect(out[0]._namedRanges.map((n: any) => `${n.name}:${n.sheetName}`)).toEqual(["Old:Data", "Totals:Data (2)"]);
    expect(out[1]._namedRanges).toBeUndefined();
  });

  it("replaces the current sheet, appends rows and pastes at a cell", () => {
    const current = [
      { name: "One", id: "a", order: 0, celldata: [{ r: 0, c: 0, v: { v: "keep" } }, { r: 2, c: 1, v: { v: "last" } }] },
      { name: "Two", id: "b", order: 1, celldata: [] },
    ];
    const imp = imported([{ r: 0, c: 0, v: { v: "new" } }, { r: 1, c: 1, v: { v: 5 } }]);
    const replaced = applyImport(current, imp, "replaceSheet", { sheetId: "b" });
    expect(replaced[1]).toMatchObject({ name: "Two", id: "b", order: 1 });
    expect(replaced[1].celldata.length).toBe(2);
    const appended = applyImport(current, imp, "appendRows", { sheetId: "a" });
    expect(appended[0].celldata.find((x: any) => x.r === 3 && x.c === 0).v.v).toBe("new");
    expect(appended[0].config.merge["3_0"]).toEqual({ r: 3, c: 0, rs: 1, cs: 2 });
    const pasted = applyImport(current, imp, "replaceAtCell", { sheetId: "a", r: 0, c: 0 });
    expect(pasted[0].celldata.find((x: any) => x.r === 0 && x.c === 0).v.v).toBe("new");
    expect(pasted[0].celldata.find((x: any) => x.r === 2 && x.c === 1).v.v).toBe("last");
    expect(applyImport(current, imp, "replaceSpreadsheet").map((s) => s.name)).toEqual(["Data"]);
  });
});

describe("print rendering", () => {
  const sheet = {
    name: "Report",
    celldata: [
      { r: 0, c: 0, v: { v: "Title", m: "Title", bl: 1, mc: { r: 0, c: 0, rs: 1, cs: 2 } } },
      { r: 0, c: 1, v: { mc: { r: 0, c: 0 } } },
      ...Array.from({ length: 80 }, (_, i) => ({ r: i + 1, c: 0, v: { v: i, m: String(i) } })),
      { r: 1, c: 1, v: { f: "=A2*2", v: 0, m: "0" } },
    ],
    config: { borderInfo: [{ rangeType: "cell", value: { row_index: 1, col_index: 0, b: { style: 8, color: "#ff0000" } } }] },
  };

  it("lays out pages with repeated titles, merges, borders and headings", () => {
    const s = { ...defaultPrintSettings(), titleRows: [0, 0] as [number, number], headings: true, gridLines: true, footer: "Page &P of &N" };
    const { html, pages } = renderPrintHtml(sheet, s, { title: "Book" });
    expect(pages).toBeGreaterThan(1);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const sections = doc.querySelectorAll("section.page");
    expect(sections.length).toBe(pages);
    // The title row is repeated on page 2.
    expect(sections[1].querySelector("tr:nth-child(2) td:nth-child(2)")?.textContent).toBe("Title");
    expect(sections[0].querySelector("td[colspan='2']")?.textContent).toBe("Title");
    expect(html).toContain("border-bottom:2px solid #ff0000");
    expect(sections[0].querySelector("td.hd")).not.toBeNull();
    expect(sections[1].querySelector(".ftr")?.textContent).toContain(`Page 2 of ${pages}`);
    expect(html).toContain("@page { size: 215.9mm 279.4mm; }");
  });

  it("prints formulas when they are shown", () => {
    const { html } = renderPrintHtml(sheet, defaultPrintSettings(), { showFormulas: true, pages: [1] });
    expect(html).toContain("=A2*2");
  });

  it("expands header and footer codes", () => {
    expect(headerFooterText("&LLeft&CPage &P of &N&R&A", { page: 2, pages: 5, sheet: "S", file: "F" })).toEqual({ left: "Left", center: "Page 2 of 5", right: "S" });
    expect(headerFooterText("Draft && final", { page: 1, pages: 1, sheet: "S", file: "F" }).center).toBe("Draft & final");
  });
});

describe("protection on relayed ops", () => {
  it("finds cell ops the user may not make", () => {
    const sheets = [
      {
        id: "s1",
        data: [[{ v: 1 }, { v: 2, lo: 0 }]],
        grownProtection: { sheet: { users: [], by: "carol", except: [] }, ranges: [] },
      },
      { id: "s2", data: [] },
    ];
    const ops = [
      { op: "replace", id: "s1", path: ["data", 0, 0, "v"], value: 5 },
      { op: "replace", id: "s1", path: ["data", 0, 1], value: { v: 3 } },
      { op: "replace", id: "s2", path: ["data", 0, 0], value: { v: 3 } },
      { op: "replace", id: "s1", path: ["luckysheet_select_save"], value: [] },
    ];
    expect(blockedCellOps(ops, sheets, { user: "bob", owner: "olga" })).toEqual([{ sheetId: "s1", r: 0, c: 0 }]);
    expect(blockedCellOps(ops, sheets, { user: "carol", owner: "olga" })).toEqual([]);
    expect(blockedCellOps(ops, sheets, { user: "olga", owner: "olga" })).toEqual([]);
  });
});
