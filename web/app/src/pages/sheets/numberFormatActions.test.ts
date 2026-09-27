import { describe, expect, it, vi } from "vitest";
import { applyNumberFormat, cellTypeFor, typedInputHooks, NUMBER_FORMAT_PRESETS } from "./numberFormatActions";
import { formatValue, parseInput } from "./numberFormat";

/* eslint-disable @typescript-eslint/no-explicit-any -- a fake FortuneSheet API */
function fakeWb(cells: Record<string, any>) {
  return {
    getSelection: () => [{ row: [0, 1], column: [0, 0] }],
    getCellsByRange: (r: any) => {
      const out: any[][] = [];
      for (let i = r.row[0]; i <= r.row[1]; i++) {
        const row: any[] = [];
        for (let j = r.column[0]; j <= r.column[1]; j++) row.push(cells[`${i},${j}`] ?? null);
        out.push(row);
      }
      return out;
    },
    setCellFormatByRange: vi.fn((attr: string, value: any, r: any) => {
      for (let i = r.row[0]; i <= r.row[1]; i++)
        for (let j = r.column[0]; j <= r.column[1]; j++) {
          const k = `${i},${j}`;
          cells[k] = { ...(cells[k] ?? {}), [attr]: value };
        }
    }),
    setCellValue: vi.fn((r: number, c: number, v: any) => {
      cells[`${r},${c}`] = { ...(cells[`${r},${c}`] ?? {}), ...v };
    }),
  };
}

describe("numberFormatActions", () => {
  it("applies a preset and re-renders the display text", () => {
    const cells: Record<string, any> = { "0,0": { v: -1234.5, m: "-1234.5" }, "1,0": { v: 0.25, m: "0.25" } };
    const w = fakeWb(cells);
    const acct = NUMBER_FORMAT_PRESETS.find((p) => p.id === "accounting")!.fa;
    applyNumberFormat(w, acct);
    expect(cells["0,0"].ct).toEqual({ fa: acct, t: "n" });
    expect(cells["0,0"].m).toBe(" $(1,234.50)");
    expect(cells["1,0"].m).toBe(" $0.25 ");
  });

  it("maps formats to FortuneSheet content types", () => {
    expect(cellTypeFor("General")).toBe("g");
    expect(cellTypeFor("@")).toBe("s");
    expect(cellTypeFor("[h]:mm:ss")).toBe("d");
    expect(cellTypeFor("# ?/?")).toBe("n");
  });

  it("reads typed input with numberFormat.ts", () => {
    const cells: Record<string, any> = {};
    const w = fakeWb(cells);
    const hooks = typedInputHooks(() => w);
    hooks.beforeUpdateCell(0, 0, "(1,234.50)");
    hooks.afterUpdateCell(0, 0, null, { v: "(1,234.50)", m: "(1,234.50)" });
    expect(cells["0,0"]).toMatchObject({ v: -1234.5, ct: { fa: "#,##0.00", t: "n" }, m: "-1,234.50" });

    hooks.beforeUpdateCell(1, 0, "1 1/2");
    hooks.afterUpdateCell(1, 0, null, { v: "1 1/2" });
    expect(cells["1,0"]).toMatchObject({ v: 1.5, ct: { fa: "# ?/?" }, m: "1 1/2" });

    // Formulas and text cells are left to FortuneSheet.
    hooks.beforeUpdateCell(2, 0, "=1+1");
    hooks.afterUpdateCell(2, 0, null, { f: "=1+1", v: 2 });
    hooks.beforeUpdateCell(3, 0, "12%");
    hooks.afterUpdateCell(3, 0, { ct: { fa: "@", t: "s" } }, { v: "12%" });
    expect(cells["2,0"]).toBeUndefined();
    expect(cells["3,0"]).toBeUndefined();
  });

  it("keeps a compatible cell format for typed dates", () => {
    const p = parseInput("Jan 15, 2023", { cellFormat: "yyyy-mm-dd" })!;
    expect(p.format).toBe("yyyy-mm-dd");
    expect(formatValue(p.value, p.format)).toBe("2023-01-15");
    expect(parseInput("1904-01-01", { date1904: true })!.value).toBe(0);
    expect(parseInput("2/29/1900")!.value).toBe(60);
    expect(parseInput("3/1/1900")!.value).toBe(61);
  });
});
