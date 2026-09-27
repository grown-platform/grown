import { describe, expect, it } from "vitest";
import { pasteSpecial, pastedSize, type Cell, type CopiedBlock } from "./pasteSpecial";

const num = (v: number, extra: Record<string, unknown> = {}): Cell => ({ v, m: String(v), ct: { fa: "General", t: "n" }, ...extra });
const txt = (v: string): Cell => ({ v, m: v, ct: { fa: "General", t: "g" } });
// A fake translate that tags the offset so the tests can see it.
const translate = (f: string, dr: number, dc: number) => `${f}@${dr},${dc}`;

function grid(cells: Record<string, Cell>) {
  return (r: number, c: number) => cells[`${r},${c}`] ?? null;
}

describe("pasteSpecial", () => {
  const block: CopiedBlock = {
    r: 0,
    c: 0,
    cells: [
      [num(1, { bl: 1 }), { v: 3, m: "3", f: "=A1+2", ct: { fa: "General", t: "n" } }],
      [null, txt("x")],
    ],
  };

  it("pastes values only, keeping the target's formatting", () => {
    const get = grid({ "5,5": num(9, { bg: "#ff0000", ct: { fa: "0.00", t: "n" } }) });
    const w = pasteSpecial(block, 5, 5, get, { what: "values", translate });
    const at = (r: number, c: number) => w.find((x) => x.r === r && x.c === c)?.cell;
    expect(at(5, 5)).toMatchObject({ v: 1, m: "1.00", bg: "#ff0000" });
    expect(at(5, 5)?.bl).toBeUndefined();
    expect(at(5, 6)).toMatchObject({ v: 3, m: "3" });
    expect(at(5, 6)?.f).toBeUndefined();
    expect(at(6, 6)).toMatchObject({ v: "x" });
  });

  it("pastes formulas moved by the paste offset", () => {
    const w = pasteSpecial(block, 2, 3, grid({}), { what: "formulas", translate });
    expect(w.find((x) => x.r === 2 && x.c === 4)?.cell?.f).toBe("=A1+2@2,3");
  });

  it("pastes formats only, keeping the target's values", () => {
    const get = grid({ "0,4": num(42, { ct: { fa: "General", t: "n" } }) });
    const w = pasteSpecial({ r: 0, c: 0, cells: [[num(1, { bl: 1, ct: { fa: "0.0", t: "n" } })]] }, 0, 4, get, { what: "formats" });
    expect(w[0].cell).toMatchObject({ v: 42, bl: 1, m: "42.0" });
  });

  it("transposes and skips blanks", () => {
    const get = grid({ "11,10": txt("keep") });
    const w = pasteSpecial(block, 10, 10, get, { what: "all", transpose: true, skipBlanks: true, translate });
    const at = (r: number, c: number) => w.find((x) => x.r === r && x.c === c);
    expect(at(10, 10)?.cell?.v).toBe(1);
    expect(at(11, 10)?.cell?.f).toBe("=A1+2@11,9"); // from (0,1) to (11,10)
    expect(at(10, 11)).toBeUndefined(); // blank source skipped
    expect(at(11, 11)?.cell?.v).toBe("x");
    expect(pastedSize(block, true)).toEqual({ rows: 2, cols: 2 });
  });

  it("applies operations", () => {
    const get = grid({ "0,0": num(10), "0,1": txt("t"), "0,2": { v: 4, f: "=B9", ct: { fa: "General", t: "n" } } });
    const src: CopiedBlock = { r: 9, c: 9, cells: [[num(2), num(2), num(2), num(0.2)]] };
    const add = pasteSpecial(src, 0, 0, get, { what: "values", operation: "add" });
    expect(add[0].cell?.v).toBe(12);
    expect(add[1].cell?.v).toBe("t"); // text target unchanged
    expect(add[2].cell?.f).toBe("=(B9)+2");
    expect(add[3].cell?.v).toBe(0.2); // blank target counts as 0
    const div = pasteSpecial({ r: 0, c: 0, cells: [[num(0)]] }, 0, 0, get, { what: "values", operation: "divide" });
    expect(div[0].cell?.v).toBe("#DIV/0!");
    const mul = pasteSpecial({ r: 0, c: 0, cells: [[num(0.1)]] }, 0, 0, grid({ "0,0": num(3) }), { what: "values", operation: "multiply" });
    expect(mul[0].cell?.v).toBe(0.3);
    const sub = pasteSpecial({ r: 0, c: 0, cells: [[num(3)]] }, 0, 0, grid({ "0,0": num(10) }), { what: "values", operation: "subtract" });
    expect(sub[0].cell?.v).toBe(7);
  });
});
