// Mail merge (Docs M12): data sources, merge fields, preview, merging and
// the DOCX round trip of MERGEFIELD fields.
import { describe, expect, it } from "vitest";
import { makeEditor, paragraphTexts, setCursor } from "./harness";
import {
  csvRows,
  emailField,
  fieldValue,
  fillTemplate,
  insertMergeField,
  mergeAll,
  mergeFieldInstr,
  mergeFieldName,
  mergeRecord,
  mergeText,
  parseA1Range,
  previewRecord,
  recordsFromRows,
  sheetRows,
  sheetTabs,
  usedFields,
} from "../mailmerge";
import { readDocx } from "../docx/read";
import { writeDocx } from "../docx/write";
import { applyDocxImport, collectDocxInput } from "../docx/apply";

const WORKBOOK = JSON.stringify([
  {
    name: "People",
    celldata: [
      { r: 0, c: 0, v: { v: "First name", m: "First name" } },
      { r: 0, c: 1, v: { v: "Email", m: "Email" } },
      { r: 0, c: 2, v: { v: "Amount", m: "Amount" } },
      { r: 1, c: 0, v: { v: "Ada", m: "Ada" } },
      { r: 1, c: 1, v: { v: "ada@example.com" } },
      { r: 1, c: 2, v: { v: 12.5, m: "$12.50" } },
      { r: 2, c: 0, v: { ct: { t: "inlineStr", s: [{ v: "Gra" }, { v: "ce" }] } } },
      { r: 2, c: 1, v: "grace@example.com" },
      { r: 3, c: 0, v: null },
    ],
  },
  { name: "Other", data: [[{ v: "k", m: "k" }], [{ v: "v1", m: "v1" }]] },
]);

describe("data sources", () => {
  it("reads a sheet's used range, display text and rich text", () => {
    expect(sheetTabs(WORKBOOK)).toEqual(["People", "Other"]);
    const rows = sheetRows(WORKBOOK, "People");
    expect(rows).toEqual([
      ["First name", "Email", "Amount"],
      ["Ada", "ada@example.com", "$12.50"],
      ["Grace", "grace@example.com", ""],
    ]);
    const data = recordsFromRows(rows);
    expect(data.fields).toEqual(["First name", "Email", "Amount"]);
    expect(data.records).toEqual([
      { "First name": "Ada", Email: "ada@example.com", Amount: "$12.50" },
      { "First name": "Grace", Email: "grace@example.com", Amount: "" },
    ]);
    expect(emailField(data)).toBe("Email");
  });

  it("reads a range and the 2D data layout", () => {
    expect(parseA1Range("A1:B2")).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(parseA1Range("$c$3")).toEqual({ r1: 2, c1: 2, r2: 2, c2: 2 });
    expect(parseA1Range("nope")).toBeNull();
    expect(sheetRows(WORKBOOK, "People", parseA1Range("A1:A2"))).toEqual([["First name"], ["Ada"]]);
    expect(sheetRows(WORKBOOK, "Other")).toEqual([["k"], ["v1"]]);
  });

  it("parses CSV with quotes and semicolons, names blank headers, skips empty rows", () => {
    expect(recordsFromRows(csvRows('name,"note, quoted"\nA,"x ""y"""\n\n,\nB,z\n'))).toEqual({
      fields: ["name", "note, quoted"],
      records: [
        { name: "A", "note, quoted": 'x "y"' },
        { name: "B", "note, quoted": "z" },
      ],
    });
    expect(recordsFromRows(csvRows("a;;a\n1;2;3")).fields).toEqual(["a", "Column 2", "Column 3"]);
  });
});

describe("merge fields", () => {
  it("builds and reads Word instructions", () => {
    expect(mergeFieldInstr("City")).toBe("MERGEFIELD City");
    expect(mergeFieldInstr("First name")).toBe('MERGEFIELD "First name"');
    expect(mergeFieldName('MERGEFIELD "First name" \\* MERGEFORMAT')).toBe("First name");
    expect(mergeFieldName("PAGE")).toBeNull();
    expect(fieldValue('MERGEFIELD "first NAME" \\* Upper', { "First name": "ada" })).toBe("ADA");
    expect(fillTemplate("Hi «First name», {{ amount }}", { "First name": "Ada", Amount: "5" })).toBe("Hi Ada, 5");
  });

  it("inserts fields, previews records and merges", () => {
    const e = makeEditor("<p>Dear , you owe .</p><p>Thanks</p>");
    setCursor(e, 6);
    insertMergeField(e, "First name");
    // Before the full stop.
    setCursor(e, e.state.doc.child(0).content.size);
    insertMergeField(e, "Amount");
    expect(usedFields(e.state.doc)).toEqual(["First name", "Amount"]);
    expect(paragraphTexts(e)[0]).toBe("Dear «First name», you owe «Amount».");

    const recs = [
      { "First name": "Ada", Amount: "$12.50" },
      { "First name": "Grace", Amount: "" },
    ];
    previewRecord(e, recs[0]);
    expect(paragraphTexts(e)[0]).toBe("Dear Ada, you owe $12.50.");
    previewRecord(e, null);
    expect(paragraphTexts(e)[0]).toBe("Dear «First name», you owe «Amount».");

    const one = mergeRecord(e.state.doc, recs[0]);
    one.check();
    expect(one.child(0).textContent).toBe("Dear Ada, you owe $12.50.");
    let fields = 0;
    one.descendants((n) => void (n.type.name === "field" && fields++));
    expect(fields).toBe(0);

    const all = mergeAll(e.state.doc, recs);
    all.check();
    expect(all.childCount).toBe(5);
    expect(all.child(2).type.name).toBe("pageBreak");
    expect(all.child(3).textContent).toBe("Dear Grace, you owe .");
    expect(mergeText(e.state.doc, recs[1])).toBe("Dear Grace, you owe .\n\nThanks");
  });

  it("keeps the field's formatting in merged text", () => {
    const e = makeEditor("<p>Hi</p>");
    e.commands.setBold();
    insertMergeField(e, "Name");
    const merged = mergeRecord(e.state.doc, { Name: "Bo" });
    const last = merged.child(0).lastChild!;
    expect(last.text).toBe("Bo");
    expect(last.marks.map((m) => m.type.name)).toContain("bold");
  });

  it("MERGEFIELD fields survive a .docx round trip", async () => {
    const e = makeEditor("<p>Hello </p>");
    insertMergeField(e, "First name");
    const bytes = await writeDocx(collectDocxInput(e, { title: "M" }));
    const imp = await readDocx(bytes);
    const e2 = makeEditor("<p></p>");
    applyDocxImport(e2, imp);
    expect(usedFields(e2.state.doc)).toEqual(["First name"]);
    expect(paragraphTexts(e2)[0]).toBe("Hello«First name»");
  });
});
