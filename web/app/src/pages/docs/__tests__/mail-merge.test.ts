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
import { defaultSection, hfFragment, parseSection, sectionsOf, type SectionProps } from "../sections";

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

    const { doc: all, section } = mergeAll(e.state.doc, recs);
    all.check();
    expect(all.childCount).toBe(5);
    // Records are separated by a next-page section break (M9), not a page break.
    expect(all.child(2).type.name).toBe("sectionBreak");
    expect(all.child(2).attrs.kind).toBe("nextPage");
    expect(all.child(3).textContent).toBe("Dear Grace, you owe .");
    // Each record's section restarts page numbering.
    expect(parseSection(all.child(2).attrs.sectPr).pgNum.start).toBe(1);
    expect(section.pgNum.start).toBe(1);
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

describe("mail merge to a new document: one section per record (M9)", () => {
  const ids = () => {
    let n = 0;
    return () => `rec${++n}`;
  };

  it("single-section template: a next-page break ends every record but the last; headers repeat per record", () => {
    const e = makeEditor("<p>To:</p>");
    insertMergeField(e, "Name");
    const final: SectionProps = { ...defaultSection(), titlePg: true, pgNum: { start: null, fmt: "lowerRoman" } };
    const recs = [{ Name: "Ada" }, { Name: "Grace" }, { Name: "Linus" }];
    const m = mergeAll(e.state.doc, recs, final, ids());
    m.doc.check();
    expect(m.doc.childCount).toBe(5);
    const secs = sectionsOf(m.doc, m.section);
    expect(secs.map((s) => s.start)).toEqual(["nextPage", "nextPage", "nextPage"]);
    expect(secs.map((s) => m.doc.child(s.fromBlock).textContent)).toEqual(["To:Ada", "To:Grace", "To:Linus"]);
    for (const s of secs) {
      // The template's setup is kept, page numbers restart at 1 in the
      // template's format, and "different first page" holds per record.
      expect(s.props.pgNum).toEqual({ start: 1, fmt: "lowerRoman" });
      expect(s.props.titlePg).toBe(true);
      expect(s.props.pageW).toBe(final.pageW);
    }
    // Every record shows the template's own header/footer parts, not a link
    // to the previous record: sections 2 and 3 (named after the break that
    // ends them) own copies of the first section's parts.
    expect(secs.map((s) => s.id)).toEqual(["rec1", "rec2", "final"]);
    expect(hfFragment(secs, 1, "header", "default")).toBe("hf:rec2:default:header");
    expect(hfFragment(secs, 2, "footer", "first")).toBe("hf:final:first:footer");
    expect(m.fragments["hf:rec2:default:header"]).toBe("header");
    expect(m.fragments["hf:final:first:footer"]).toBe("hf:first-section:first:footer");
    expect(m.fragments["hf:final:default:footer"]).toBe("footer");
    expect(m.fragments.header).toBe("header");
  });

  it("keeps an explicit restart value and the template's own section breaks per record", () => {
    const e = makeEditor("<p>Cover for x</p><p>Body</p>");
    setCursor(e, 2);
    insertMergeField(e, "Name");
    const first: SectionProps = { ...defaultSection(), pgNum: { start: 5 } };
    const landscape: SectionProps = { ...defaultSection(), orient: "landscape", pageW: 792, pageH: 612, own: ["header:default"] };
    // Template: [Cover] | oddPage break | [Body] (final, landscape, own header).
    const { tr, schema } = e.state;
    tr.insert(e.state.doc.child(0).nodeSize, schema.nodes.sectionBreak.create({ id: "t1", kind: "oddPage", sectPr: JSON.stringify(first) }));
    e.view.dispatch(tr);
    const m = mergeAll(e.state.doc, [{ Name: "A" }, { Name: "B" }], landscape, ids());
    m.doc.check();
    const secs = sectionsOf(m.doc, m.section);
    expect(secs).toHaveLength(4);
    expect(secs.map((s) => s.start)).toEqual(["nextPage", "oddPage", "nextPage", "oddPage"]);
    expect(secs.map((s) => s.props.orient)).toEqual(["portrait", "landscape", "portrait", "landscape"]);
    expect(secs.map((s) => s.props.pgNum.start ?? null)).toEqual([5, null, 5, null]);
    // Record 1 keeps the template's break id; record 2's copy gets a fresh one.
    expect(secs.map((s) => s.id)).toEqual(["t1", "rec1", "rec2", "final"]);
    // The landscape section's own header follows each copy.
    expect(m.fragments["hf:rec1:default:header"]).toBe("hf:final:default:header");
    expect(m.fragments["hf:final:default:header"]).toBe("hf:final:default:header");
    // Record 2's cover owns the first section's parts again.
    expect(m.fragments["hf:rec2:default:footer"]).toBe("footer");
  });

  it("the merged document writes one w:sectPr per record to .docx", async () => {
    const e = makeEditor("<p>Hi:</p>");
    insertMergeField(e, "Name");
    const input = collectDocxInput(e, { title: "M" });
    const m = mergeAll(e.state.doc, [{ Name: "A" }, { Name: "B" }, { Name: "C" }], input.settings?.section);
    input.doc = m.doc;
    const bytes = await writeDocx(input);
    const imp = await readDocx(bytes);
    const e2 = makeEditor("<p></p>");
    applyDocxImport(e2, imp);
    const types: string[] = [];
    e2.state.doc.forEach((n) => types.push(n.type.name));
    expect(types).toEqual(["paragraph", "sectionBreak", "paragraph", "sectionBreak", "paragraph"]);
    expect(paragraphTexts(e2)).toEqual(["Hi:A", "Hi:B", "Hi:C"]);
  });
});
