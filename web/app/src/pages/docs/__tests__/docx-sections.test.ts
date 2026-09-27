// DOCX sections both ways (Docs M9): paragraph-level and body w:sectPr
// (pgSz, pgMar, cols, titlePg, lnNumType, pgNumType, pgBorders, type),
// header/footer references per section and type (default / first /
// even, linked when missing), header PAGE fields, column breaks and the
// settings Grown keeps (odd/even headers, mirror margins, hyphenation,
// page colour).
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { Editor } from "@tiptap/core";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { makeEditor } from "./harness";
import { buildDocx } from "./docx-fixture";
import { readDocx } from "../docx/read";
import { writeDocx } from "../docx/write";
import { applyDocxImport, collectDocxInput, modelDoc } from "../docx/apply";
import { parseXml } from "../docx/xml";
import { docSections, getSettings } from "../pageLayout";
import { marginSchema } from "../margin";

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const r = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const fld = (instr: string, result: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r(result)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const hdr = (tag: "hdr" | "ftr", body: string) => `<w:${tag} ${W_NS}>${body}</w:${tag}>`;

// Section 1: portrait Letter, a first-page header and a default one.
// Section 2 (next page): landscape, two columns with a line, line numbers,
// page numbers from 5 in roman, a box border; its footer is its own.
// Section 3 (continuous start): inherits everything (no references).
const SECT1 =
  `<w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:headerReference w:type="first" r:id="rIdH2"/>` +
  `<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="360"/><w:titlePg/></w:sectPr>`;
const SECT2 =
  `<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/>` +
  `<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/>` +
  `<w:pgBorders w:offsetFrom="page"><w:top w:val="double" w:sz="12" w:space="24" w:color="1F4E79"/><w:left w:val="double" w:sz="12" w:space="24" w:color="1F4E79"/><w:bottom w:val="double" w:sz="12" w:space="24" w:color="1F4E79"/><w:right w:val="double" w:sz="12" w:space="24" w:color="1F4E79"/></w:pgBorders>` +
  `<w:lnNumType w:countBy="5" w:start="0" w:restart="newSection"/><w:pgNumType w:fmt="lowerRoman" w:start="5"/><w:cols w:num="2" w:space="720" w:sep="1"/></w:sectPr>`;
const FINAL =
  `<w:type w:val="continuous"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/>` +
  `<w:cols w:num="3" w:equalWidth="0"><w:col w:w="2000" w:space="360"/><w:col w:w="4000" w:space="360"/><w:col w:w="6000"/></w:cols>`;

const BODY =
  `<w:p>${r("Portrait page")}</w:p>` +
  `<w:p><w:pPr>${SECT1}</w:pPr>${r("End of one")}</w:p>` +
  `<w:p>${r("Landscape in columns")}</w:p><w:p><w:r><w:br w:type="column"/></w:r></w:p><w:p>${r("Second column")}</w:p>` +
  `<w:p><w:pPr>${SECT2}</w:pPr></w:p>` +
  `<w:p>${r("Third section")}</w:p>`;

const SETTINGS = `<w:settings ${W_NS}><w:displayBackgroundShape/><w:mirrorMargins/><w:defaultTabStop w:val="720"/><w:autoHyphenation/><w:consecutiveHyphenLimit w:val="2"/><w:evenAndOddHeaders/></w:settings>`;

async function wordDoc(): Promise<Uint8Array> {
  const bytes = await buildDocx({
    body: BODY,
    sectPr: FINAL,
    settings: SETTINGS,
    extraParts: {
      "hdrA.xml": hdr("hdr", `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${r("Report")}</w:p>`),
      "hdrB.xml": hdr("hdr", `<w:p>${r("Cover")}</w:p>`),
      "ftrA.xml": hdr("ftr", `<w:p><w:pPr><w:jc w:val="right"/></w:pPr>${r("Page ")}${fld("PAGE", "5")}${r(" of ")}${fld("NUMPAGES", "9")}</w:p>`),
    },
    rels: [
      ["rIdH1", "header", "hdrA.xml"],
      ["rIdH2", "header", "hdrB.xml"],
      ["rIdF1", "footer", "ftrA.xml"],
    ],
  });
  // A page colour (w:background) as the document's first child.
  const zip = await JSZip.loadAsync(bytes);
  const doc = await zip.file("word/document.xml")!.async("string");
  zip.file("word/document.xml", doc.replace("<w:body>", '<w:background w:color="FFF8E1"/><w:body>'));
  return zip.generateAsync({ type: "uint8array" });
}

function fragJSON(e: Editor, name: string) {
  const ydoc = modelDoc(e)!;
  const f = ydoc.getXmlFragment(name);
  return f.length ? yXmlFragmentToProseMirrorRootNode(f, marginSchema()).toJSON() : null;
}

async function roundTrip(e: Editor): Promise<{ editor: Editor; xml: Document; settings: Document }> {
  const input = collectDocxInput(e, { title: "T" });
  input.now = new Date("2026-09-27T00:00:00Z");
  const bytes = await writeDocx(input);
  const zip = await JSZip.loadAsync(bytes);
  const xml = parseXml(await zip.file("word/document.xml")!.async("string"));
  const settings = parseXml(await zip.file("word/settings.xml")!.async("string"));
  const f = makeEditor("<p></p>");
  applyDocxImport(f, await readDocx(bytes));
  return { editor: f, xml, settings };
}

describe("docx sections (M9)", () => {
  it("reads sections, headers per section and type, settings", async () => {
    const imp = await readDocx(await wordDoc());
    const e = makeEditor("<p></p>");
    applyDocxImport(e, imp);
    const secs = docSections(e);
    expect(secs).toHaveLength(3);
    const [a, b, c] = secs.map((s) => s.props);
    expect([a.orient, a.pageW, a.margins.gutter, a.titlePg]).toEqual(["portrait", 612, 18, true]);
    expect([b.orient, b.pageW, b.pageH, b.margins.left]).toEqual(["landscape", 792, 612, 54]);
    expect(b.cols).toMatchObject({ num: 2, space: 36, sep: true, equal: true });
    expect(b.lnNum).toEqual({ countBy: 5, start: 1, distance: 0, restart: "newSection" });
    expect(b.pgNum).toEqual({ start: 5, fmt: "lowerRoman" });
    expect(b.borders).toMatchObject({ style: "double", color: "#1f4e79", width: 1.5, offsetFrom: "page", display: "all" });
    expect(c.cols.equal).toBe(false);
    expect(c.cols.widths).toEqual([100, 200, 300]);
    // How sections start: the break before section 3 is continuous.
    expect(secs.map((s) => s.start)).toEqual(["nextPage", "nextPage", "continuous"]);
    // The column break and the text around it; the w:sectPr-only paragraph
    // became just a break.
    const types = e.getJSON().content!.map((n) => n.type);
    expect(types).toEqual(["paragraph", "paragraph", "sectionBreak", "paragraph", "columnBreak", "paragraph", "sectionBreak", "paragraph"]);
    // Headers: section 1 default + first; section 2 its own footer with
    // PAGE / NUMPAGES fields; section 3 links to section 2.
    expect(JSON.stringify(fragJSON(e, "header"))).toContain("Report");
    expect(JSON.stringify(fragJSON(e, "hf:first-section:first:header"))).toContain("Cover");
    const foot = JSON.stringify(fragJSON(e, `hf:${secs[1].id}:default:footer`));
    expect(foot).toContain('"instr":"PAGE"');
    expect(foot).toContain('"instr":"NUMPAGES"');
    expect(b.own).toEqual(["footer:default"]);
    expect(c.own).toEqual([]);
    const s = getSettings(e);
    expect([s.evenOdd, s.mirror, s.hyphenation.auto, s.hyphenation.limit, s.pageColor]).toEqual([true, true, true, 2, "#fff8e1"]);
    expect(imp.warnings).not.toContain("first-page / even-page headers and footers");
  });

  it("Word → Grown → docx → Grown keeps sections, parts and settings; the XML is in schema order", async () => {
    const e = makeEditor("<p></p>");
    applyDocxImport(e, await readDocx(await wordDoc()));
    const { editor: f, xml, settings } = await roundTrip(e);
    expect(f.getJSON()).toEqual(e.getJSON());
    expect(docSections(f).map((s) => s.props)).toEqual(docSections(e).map((s) => s.props));
    expect(getSettings(f)).toEqual(getSettings(e));
    for (const name of ["header", "hf:first-section:first:header", `hf:${docSections(e)[1].id}:default:footer`])
      expect(fragJSON(f, name)).toEqual(fragJSON(e, name));
    // Paragraph-level sectPr, the body's last; children in CT_SectPr order.
    const sects = Array.from(xml.getElementsByTagName("w:sectPr"));
    expect(sects).toHaveLength(3);
    const order = ["headerReference", "footerReference", "type", "pgSz", "pgMar", "pgBorders", "lnNumType", "pgNumType", "cols", "titlePg"];
    for (const s of sects) {
      const names = Array.from(s.children).map((c) => c.localName);
      const idx = names.map((n) => order.indexOf(n));
      expect(idx.every((v) => v >= 0)).toBe(true);
      expect([...idx].sort((x, y) => x - y)).toEqual(idx);
    }
    expect(xml.documentElement.firstElementChild?.localName).toBe("background");
    const setNames = Array.from(settings.documentElement.children).map((c) => c.localName);
    expect(setNames.indexOf("mirrorMargins")).toBeLessThan(setNames.indexOf("defaultTabStop"));
    expect(setNames.indexOf("autoHyphenation")).toBeGreaterThan(setNames.indexOf("defaultTabStop"));
    expect(setNames).toContain("evenAndOddHeaders");
    // A second trip is stable.
    const again = await roundTrip(f);
    expect(again.editor.getJSON()).toEqual(f.getJSON());
  });

  it("an editor-authored document keeps its breaks", async () => {
    const e = makeEditor("<p>one</p><p>two</p>");
    e.commands.setTextSelection(4);
    e.commands.insertSectionBreak("oddPage");
    const { editor: f } = await roundTrip(e);
    expect(docSections(f).map((s) => s.start)).toEqual(["nextPage", "oddPage"]);
    // Section ids are Grown's own (Word has none): the reader makes new ones.
    const noIds = (ed: Editor) => JSON.stringify(ed.getJSON()).replace(/"id":"[^"]*"/g, '"id":"x"');
    expect(noIds(f)).toEqual(noIds(e));
  });
});
