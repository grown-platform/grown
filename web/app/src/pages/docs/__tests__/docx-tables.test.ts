// DOCX table properties both ways (Docs M4): borders, styles + look,
// widths / fixed layout, alignment, cell margins, vertical alignment, row
// height and the repeated header row; bad tables repaired on import.
// Fixtures are built in code (docx-fixture.ts).
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { Editor, JSONContent } from "@tiptap/core";
import { makeEditor } from "./harness";
import { buildDocx } from "./docx-fixture";
import { readDocx } from "../docx/read";
import { writeDocx } from "../docx/write";
import { applyDocxImport, collectDocxInput } from "../docx/apply";
import { parseXml } from "../docx/xml";
import { parseTableBorders } from "../tableModel";

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const tc = (t: string, tcPr = "") => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ""}${p(t)}</w:tc>`;

const TABLE_STYLES = `<w:styles ${W_NS}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="table" w:styleId="Gitternetztabelle4Akzent1"><w:name w:val="Grid Table 4 Accent 1"/></w:style>
<w:style w:type="table" w:styleId="Fancy"><w:name w:val="Fancy Lines"/><w:basedOn w:val="FancyBase"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="12" w:color="00B050"/></w:tblBorders></w:tblPr></w:style>
<w:style w:type="table" w:styleId="FancyBase"><w:name w:val="Fancy Base"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="000000"/><w:insideH w:val="dotted" w:sz="4" w:color="7F7F7F"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

async function importBody(body: string, styles = TABLE_STYLES) {
  const imp = await readDocx(await buildDocx({ body, styles }));
  const editor = makeEditor("<p></p>");
  applyDocxImport(editor, imp);
  return { editor, imp };
}

async function exportXml(editor: Editor): Promise<{ doc: Document; styles: Document; bytes: Uint8Array }> {
  const input = collectDocxInput(editor, { title: "T" });
  input.now = new Date("2026-09-26T00:00:00Z");
  const bytes = await writeDocx(input);
  const zip = await JSZip.loadAsync(bytes);
  return {
    doc: parseXml(await zip.file("word/document.xml")!.async("string")),
    styles: parseXml(await zip.file("word/styles.xml")!.async("string")),
    bytes,
  };
}

const tables = (e: Editor): JSONContent[] => (e.getJSON().content ?? []).filter((n) => n.type === "table");
const q = (d: Document | Element, sel: string) => [...(d as Element).getElementsByTagName(sel)];
const val = (e: Element | undefined, a = "w:val") => e?.getAttribute(a) ?? null;

describe("docx tables: reader", () => {
  it("maps style (by Word name), look, borders, margins, layout, width, alignment, rows and cells", async () => {
    const body =
      `<w:tbl><w:tblPr><w:tblStyle w:val="Gitternetztabelle4Akzent1"/><w:tblW w:w="5000" w:type="pct"/><w:jc w:val="center"/>` +
      `<w:tblBorders><w:top w:val="double" w:sz="18" w:color="C00000"/><w:insideV w:val="nil"/></w:tblBorders>` +
      `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>` +
      `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="1" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/></w:tblGrid>` +
      `<w:tr><w:trPr><w:tblHeader/><w:trHeight w:val="600" w:hRule="atLeast"/></w:trPr>${tc("H1", '<w:tcW w:w="3000" w:type="dxa"/>')}${tc("H2")}</w:tr>` +
      `<w:tr>${tc("a", '<w:tcW w:w="2250" w:type="dxa"/><w:tcBorders><w:bottom w:val="dashed" w:sz="8" w:color="0070C0"/><w:right w:val="none"/></w:tcBorders><w:vAlign w:val="center"/>')}` +
      `${tc("b", '<w:tcMar><w:left w:w="200" w:type="dxa"/></w:tcMar><w:vAlign w:val="bottom"/>')}</w:tr></w:tbl>`;
    const { editor, imp } = await importBody(body);
    const [t] = tables(editor);
    expect(t.attrs).toMatchObject({
      tableStyle: "GridTable4-Accent1",
      look: "header banded lastRow",
      width: "100%",
      align: "center",
      layout: "fixed",
      cellMargins: "2 6 0 6",
    });
    expect(parseTableBorders(t.attrs!.borders)).toEqual({
      top: { width: 2.25, style: "double", color: "#c00000" },
      insideV: { width: 0, style: "none", color: "#000000" },
    });
    const [r0, r1] = t.content!;
    expect(r0.attrs).toMatchObject({ repeatHeader: true, height: 30 });
    expect(r0.content!.map((c) => c.type)).toEqual(["tableHeader", "tableHeader"]);
    // Fixed layout: the widest cell width per column (3000 twips = 200px, then 150px).
    expect(r0.content![0].attrs!.colwidth).toEqual([200]);
    expect(r0.content![1].attrs!.colwidth).toEqual([100]);
    expect(r1.content![0].attrs).toMatchObject({ verticalAlign: "middle", colwidth: [200] });
    expect(parseTableBorders(r1.content![0].attrs!.borders)).toEqual({
      bottom: { width: 1, style: "dashed", color: "#0070c0" },
      right: { width: 0, style: "none", color: "#000000" },
    });
    expect(r1.content![1].attrs).toMatchObject({ verticalAlign: "bottom", margins: "0 0 0 10" });
    expect(imp.warnings.join(" ")).not.toMatch(/table borders/);
  });

  it("keeps the borders of a table style it doesn't know (along basedOn) and says so", async () => {
    const body = `<w:tbl><w:tblPr><w:tblStyle w:val="Fancy"/></w:tblPr><w:tblGrid><w:gridCol w:w="1500"/></w:tblGrid><w:tr>${tc("x")}</w:tr></w:tbl>`;
    const { editor, imp } = await importBody(body);
    const [t] = tables(editor);
    expect(t.attrs!.tableStyle).toBeNull();
    expect(parseTableBorders(t.attrs!.borders)).toEqual({
      top: { width: 1.5, style: "solid", color: "#00b050" },
      insideH: { width: 0.5, style: "dotted", color: "#7f7f7f" },
    });
    expect(imp.warnings).toContain('table style "Fancy Lines" (its borders are kept)');
  });

  it("repairs a table whose rows are all vMerge continuations (correctBadTable)", async () => {
    const cont = '<w:vMerge/>';
    const row = `<w:tr>${tc("", cont)}${tc("", cont)}${tc("", cont)}</w:tr>`;
    const body = `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>${row}${row}${row}</w:tbl>`;
    const { editor, imp } = await importBody(body);
    const [t] = tables(editor);
    expect(t.content).toHaveLength(1);
    expect(t.content![0].content).toHaveLength(3);
    expect(t.content![0].content!.every((c) => c.attrs!.rowspan === 1)).toBe(true);
    expect(imp.warnings).toContain("invalid vertical merges (repaired)");
  });

  it("pads ragged rows and clips spans past the grid", async () => {
    const body =
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>` +
      `<w:tr>${tc("a")}${tc("b")}${tc("c")}</w:tr><w:tr>${tc("d")}</w:tr><w:tr>${tc("e", '<w:vMerge w:val="restart"/>')}${tc("f")}${tc("g")}</w:tr></w:tbl>`;
    const { editor, imp } = await importBody(body);
    const [t] = tables(editor);
    expect(t.content!.map((r) => r.content!.length)).toEqual([3, 3, 3]);
    expect(imp.warnings).toContain("malformed tables (repaired)");
  });

  it("merged cells take their bottom border from the last part", async () => {
    const body =
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>` +
      `<w:tr>${tc("m", '<w:vMerge w:val="restart"/><w:tcBorders><w:top w:val="single" w:sz="16" w:color="FF0000"/></w:tcBorders>')}${tc("a")}</w:tr>` +
      `<w:tr>${tc("", '<w:vMerge/><w:tcBorders><w:bottom w:val="single" w:sz="16" w:color="0000FF"/></w:tcBorders>')}${tc("b")}</w:tr></w:tbl>`;
    const { editor } = await importBody(body);
    const m = tables(editor)[0].content![0].content![0];
    expect(m.attrs!.rowspan).toBe(2);
    expect(Object.keys(parseTableBorders(m.attrs!.borders)).sort()).toEqual(["bottom", "top"]);
  });
  it("an unstyled or unknown-style table without borders round-trips docx -> Grown -> docx -> Grown", async () => {
    // OnlyOffice's "Изменение настроек таблиц по умолчанию.docx": tables
    // whose (unknown) style defines no tblBorders import with null
    // borders; the writer spells out Grown's light grid for Word, and the
    // re-import must read that grid back as the default, not as direct
    // borders. A direct side next to the grid stays direct.
    const styles = TABLE_STYLES.replace(
      "</w:styles>",
      `<w:style w:type="table" w:styleId="NewLined"><w:name w:val="New_Lined"/><w:tblPr><w:tblCellMar><w:left w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`,
    );
    const grid = `<w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/></w:tblGrid>`;
    const rows = `<w:tr>${tc("a")}${tc("b")}</w:tr><w:tr>${tc("c")}${tc("d")}</w:tr>`;
    const body =
      `<w:tbl><w:tblPr><w:tblStyle w:val="NewLined"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="01E0"/></w:tblPr>${grid}${rows}</w:tbl>` +
      p("between") +
      `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${grid}${rows}</w:tbl>` +
      p("between") +
      `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="18" w:color="000000"/></w:tblBorders></w:tblPr>${grid}${rows}</w:tbl>`;
    const { editor } = await importBody(body, styles);
    const first = tables(editor).map((t) => t.attrs?.borders ?? null);
    expect(first).toEqual([null, null, JSON.stringify({ top: "2.25 solid #000000" })]);
    const { bytes } = await exportXml(editor);
    const back = makeEditor("<p></p>");
    applyDocxImport(back, await readDocx(bytes));
    expect(back.getJSON()).toEqual(editor.getJSON());
  });
});

describe("docx tables: writer", () => {
  function styledEditor(): Editor {
    return makeEditor(
      `<table data-table-style="PlainTable1" data-look="header lastRow" data-borders='{"bottom":"3 double #c00000","insideV":"none"}' ` +
        `data-cell-margins="2 8 2 8" data-layout="fixed" data-width="100%" data-align="right"><tbody>` +
        `<tr data-repeat-header="true" data-height="24"><th colwidth="120"><p>H</p></th><th colwidth="80"><p>I</p></th></tr>` +
        `<tr><td rowspan="2" colwidth="120" data-borders='{"bottom":"1.5 dashed #0070c0","left":"0.75 solid #00b050"}' style="vertical-align: middle; background-color: #fce8b2"><p>M</p></td>` +
        `<td colwidth="80" data-margins="0 12 0 12" style="vertical-align: bottom"><p>x</p></td></tr>` +
        `<tr><td colwidth="80"><p>y</p></td></tr></tbody></table>`,
    );
  }

  it("writes tblPr, trPr and tcPr in schema order, and the style definition", async () => {
    const { doc, styles } = await exportXml(styledEditor());
    const tblPr = q(doc, "w:tblPr")[0];
    expect([...tblPr.children].map((c) => c.localName)).toEqual(["tblStyle", "tblW", "jc", "tblBorders", "tblLayout", "tblCellMar", "tblLook"]);
    expect(val(q(tblPr, "w:tblStyle")[0])).toBe("PlainTable1");
    expect(val(q(tblPr, "w:tblW")[0], "w:type")).toBe("pct");
    expect(val(q(tblPr, "w:jc")[0])).toBe("right");
    const tb = q(tblPr, "w:tblBorders")[0];
    expect([...tb.children].map((c) => `${c.localName}:${val(c)}`)).toEqual(["bottom:double", "insideV:nil"]);
    expect(val(q(tb, "w:bottom")[0], "w:sz")).toBe("24");
    const look = q(tblPr, "w:tblLook")[0];
    expect([val(look, "w:firstRow"), val(look, "w:lastRow"), val(look, "w:firstColumn"), val(look, "w:noHBand")]).toEqual(["1", "1", "0", "1"]);

    const trPr = q(doc, "w:trPr")[0];
    expect([...trPr.children].map((c) => c.localName)).toEqual(["trHeight", "tblHeader"]);
    expect(val(q(trPr, "w:trHeight")[0])).toBe("480");

    const order = ["tcW", "gridSpan", "vMerge", "tcBorders", "shd", "tcMar", "vAlign"];
    for (const tcPr of q(doc, "w:tcPr")) {
      const idx = [...tcPr.children].map((c) => order.indexOf(c.localName));
      expect(idx.every((i) => i >= 0)).toBe(true);
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
    // The merged cell: top part without a bottom border, last part with it.
    const tcs = q(doc, "w:tc");
    const first = tcs[2];
    const cont = tcs[4];
    expect(q(first, "w:vMerge")[0].getAttribute("w:val")).toBe("restart");
    expect(q(q(first, "w:tcBorders")[0], "w:bottom")).toHaveLength(0);
    expect(q(q(cont, "w:tcBorders")[0], "w:bottom")).toHaveLength(1);
    expect(val(q(first, "w:vAlign")[0])).toBe("center");

    const def = q(styles, "w:style").find((s) => s.getAttribute("w:styleId") === "PlainTable1")!;
    expect(def.getAttribute("w:type")).toBe("table");
    expect(val(q(def, "w:name")[0])).toBe("Plain Table 1");
    expect(q(def, "w:tblStylePr").map((e) => e.getAttribute("w:type"))).toEqual(expect.arrayContaining(["firstRow", "lastRow", "band1Horz"]));
  });

  it("round-trips Grown -> docx -> Grown with equal table attributes", async () => {
    const editor = styledEditor();
    const { bytes } = await exportXml(editor);
    const imp = await readDocx(bytes);
    const back = makeEditor("<p></p>");
    applyDocxImport(back, imp);
    const strip = (t: JSONContent) => JSON.parse(JSON.stringify(t, (k, v) => (k === "content" && Array.isArray(v) && v[0]?.type === "paragraph" ? undefined : v)));
    expect(strip(tables(back)[0])).toEqual(strip(tables(editor)[0]));
  });

  it("an unstyled table keeps Grown's light grid in Word, with direct sides on top", async () => {
    const editor = makeEditor(`<table data-borders='{"top":"2.25 solid #000000"}'><tbody><tr><td><p>a</p></td></tr></tbody></table>`);
    const { doc } = await exportXml(editor);
    const tb = q(doc, "w:tblBorders")[0];
    expect([...tb.children].map((c) => `${c.localName}:${c.getAttribute("w:color")}`)).toEqual([
      "top:000000",
      "left:CCCED1",
      "bottom:CCCED1",
      "right:CCCED1",
      "insideH:CCCED1",
      "insideV:CCCED1",
    ]);
    expect(q(doc, "w:tblStyle")).toHaveLength(0);
    expect(q(doc, "w:tblLayout")).toHaveLength(0);
  });
});
