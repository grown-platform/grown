// Port of OnlyOffice word/js-api/api-table-cell.js (behaviour only): cell
// background colour through the table commands (tables.ts).
//
// The theme-colour sub-case is n/a: Grown has no document theme (as for
// the M1 run/range colour ports).
import { describe, expect, it } from "vitest";
import { makeEditor } from "../harness";
import { getCellBackground, insertTableSized, setCellBackground } from "../../tables";
import { rgbHex } from "../../textOps";

describe("OnlyOffice js-api: table cell", () => {
  it("oo:word/js-api/api-table-cell.js#SetColor, GetColor", () => {
    const e = makeEditor("<p></p>");
    insertTableSized(e, 2, 2, false);
    // The caret is in cell (0, 0).
    expect(getCellBackground(e)).toBeNull();

    setCellBackground(e, rgbHex(255, 127, 0));
    expect(getCellBackground(e)).toBe("#ff7f00");

    setCellBackground(e, "#BADA55");
    expect(getCellBackground(e)?.toUpperCase()).toBe("#BADA55");
    expect(e.view.dom.querySelector("td")!.style.backgroundColor).toBe("rgb(186, 218, 85)");

    setCellBackground(e, null);
    expect(getCellBackground(e)).toBeNull();
    expect(e.view.dom.querySelector("td")!.style.backgroundColor).toBe("");
  });
});
