import { describe, it, expect } from "vitest";
import { storableWorkbook } from "./workbookJson";

describe("storableWorkbook", () => {
  it("replaces the dense data matrix with sparse celldata", () => {
    const out = storableWorkbook([
      { id: "s1", name: "Sheet1", data: [[{ v: 1 }, null], [null, { f: "=A1", v: 1 }]], celldata: [] },
      { id: "s2", name: "Two", celldata: [{ r: 0, c: 0, v: { v: 2 } }] },
    ]);
    expect(out).toEqual([
      {
        id: "s1",
        name: "Sheet1",
        celldata: [
          { r: 0, c: 0, v: { v: 1 } },
          { r: 1, c: 1, v: { f: "=A1", v: 1 } },
        ],
      },
      { id: "s2", name: "Two", celldata: [{ r: 0, c: 0, v: { v: 2 } }] },
    ]);
  });
});
