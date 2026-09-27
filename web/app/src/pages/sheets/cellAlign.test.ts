/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet cells are loosely typed. */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { cssAlign, defaultHorizontalAlign, effectiveHorizontalAlign, explicitHorizontalAlign } from "./cellAlign";
import { fillCellDisplay } from "./normalize";
import { workbookToXlsx } from "./xlsx/xlsxWrite";

const RIGHT = "2";
const LEFT = "1";
const CENTRE = "0";

describe("defaultHorizontalAlign (Excel / Sheets alignment by type)", () => {
  it("right-aligns numbers: typed, API-saved and formula results", () => {
    expect(defaultHorizontalAlign({ v: 10, m: "10", ct: { fa: "General", t: "n" } })).toBe(RIGHT);
    expect(defaultHorizontalAlign(fillCellDisplay({ v: 32 }))).toBe(RIGHT); // API save, normalised
    expect(defaultHorizontalAlign({ v: 42 })).toBe(RIGHT); // no ct at all
    expect(defaultHorizontalAlign({ f: "=SUM(A2:A3)", v: 42, m: "42", ct: { fa: "General", t: "n" } })).toBe(RIGHT);
    expect(defaultHorizontalAlign({ v: -1.5, m: "-1.50", ct: { fa: "0.00", t: "n" } })).toBe(RIGHT);
    expect(defaultHorizontalAlign({ v: "1234", m: "1,234", ct: { fa: "#,##0", t: "n" } })).toBe(RIGHT);
  });

  it("right-aligns dates", () => {
    expect(defaultHorizontalAlign({ v: 46291, m: "2026-09-26", ct: { fa: "yyyy-MM-dd", t: "d" } })).toBe(RIGHT);
  });

  it("centres booleans and errors", () => {
    expect(defaultHorizontalAlign({ v: true, m: "TRUE", ct: { fa: "General", t: "b" } })).toBe(CENTRE);
    expect(defaultHorizontalAlign({ v: false })).toBe(CENTRE);
    expect(defaultHorizontalAlign({ f: "=1=1", v: 1, m: "TRUE" })).toBe(CENTRE); // server-computed logical
    expect(defaultHorizontalAlign({ f: "=1=2", v: 0, m: "FALSE" })).toBe(CENTRE);
    expect(defaultHorizontalAlign({ v: 1, m: "1" })).toBe(RIGHT);
    expect(defaultHorizontalAlign({ v: "#DIV/0!", m: "#DIV/0!", ct: { fa: "General", t: "e" } })).toBe(CENTRE);
    expect(defaultHorizontalAlign({ f: "=A1+", v: "#VALUE!", m: "#VALUE!" })).toBe(CENTRE);
    expect(defaultHorizontalAlign({ f: "=NA()", v: "#N/A" })).toBe(CENTRE);
  });

  it("left-aligns text, text-formatted numbers and TEXT() results", () => {
    expect(defaultHorizontalAlign({ v: "Value", m: "Value", ct: { fa: "General", t: "g" } })).toBe(LEFT);
    expect(defaultHorizontalAlign({ f: '=TEXT(DATE(2026,9,26),"yyyy-mm-dd")', v: "2026-09-26", m: "2026-09-26" })).toBe(LEFT);
    expect(defaultHorizontalAlign({ v: "42", m: "42", ct: { fa: "@", t: "s" } })).toBe(LEFT);
    expect(defaultHorizontalAlign({ v: 42, m: "42", ct: { fa: "@", t: "s" } })).toBe(LEFT);
    expect(defaultHorizontalAlign({ v: "#DIV/0!", m: "#DIV/0!", ct: { fa: "@", t: "s" } })).toBe(LEFT); // '#DIV/0!
    expect(defaultHorizontalAlign({ ct: { t: "inlineStr", s: [{ v: "rich" }] } })).toBe(LEFT);
  });

  it("left for empty or odd input", () => {
    expect(defaultHorizontalAlign(null)).toBe(LEFT);
    expect(defaultHorizontalAlign(undefined)).toBe(LEFT);
    expect(defaultHorizontalAlign({})).toBe(LEFT);
    expect(defaultHorizontalAlign({ v: "" })).toBe(LEFT);
    expect(defaultHorizontalAlign({ bg: "#ff0000" })).toBe(LEFT);
  });
});

describe("effectiveHorizontalAlign", () => {
  it("an explicit ht always wins over the type default", () => {
    expect(effectiveHorizontalAlign({ v: 42, ht: 1 })).toBe(LEFT);
    expect(effectiveHorizontalAlign({ v: 42, ht: "0" })).toBe(CENTRE);
    expect(effectiveHorizontalAlign({ v: "text", ht: 2 })).toBe(RIGHT);
    expect(effectiveHorizontalAlign({ v: true, ht: "1" })).toBe(LEFT);
  });

  it("falls back to the type default without a (valid) ht", () => {
    expect(explicitHorizontalAlign({ v: 42 })).toBeNull();
    expect(explicitHorizontalAlign({ v: 42, ht: "" })).toBeNull();
    expect(explicitHorizontalAlign({ v: 42, ht: 7 })).toBeNull();
    expect(effectiveHorizontalAlign({ v: 42, ht: null })).toBe(RIGHT);
    expect(effectiveHorizontalAlign({ v: "x" })).toBe(LEFT);
  });

  it("maps to CSS", () => {
    expect([cssAlign("0"), cssAlign("1"), cssAlign("2")]).toEqual(["center", "left", "right"]);
  });

  it("is registered for the patched FortuneSheet renderer", () => {
    expect((globalThis as any).__grownDefaultHt).toBe(defaultHorizontalAlign);
  });

  it("does not write ht into cells", () => {
    const cell: any = { v: 42, m: "42", ct: { fa: "General", t: "n" } };
    effectiveHorizontalAlign(cell);
    defaultHorizontalAlign(cell);
    expect("ht" in cell).toBe(false);
  });
});

describe("xlsx export keeps default alignment implicit", () => {
  it("writes no <alignment> for numbers, booleans or errors without ht", async () => {
    const bytes = await workbookToXlsx([
      {
        name: "S",
        celldata: [
          { r: 0, c: 0, v: { v: 10, m: "10", ct: { fa: "General", t: "n" } } },
          { r: 1, c: 0, v: { v: true, m: "TRUE", ct: { fa: "General", t: "b" } } },
          { r: 2, c: 0, v: { v: "text", m: "text", ct: { fa: "General", t: "g" } } },
          { r: 3, c: 0, v: { f: "=1/0", v: "#DIV/0!", m: "#DIV/0!", ct: { fa: "General", t: "e" } } },
        ],
      },
    ]);
    const zip = await JSZip.loadAsync(bytes);
    const styles = await zip.file("xl/styles.xml")!.async("string");
    expect(styles).not.toContain("<alignment");
    expect(styles).not.toContain('horizontal="right"');
  });
});
