// DOCX references both ways (Docs M8): bookmarks (w:bookmarkStart/End),
// simple and complex fields (PAGE, SEQ, REF, …), hyperlinks with w:anchor
// and w:tooltip, and tables of contents as a TOC field in a "Table of
// Contents" content control. Fixtures are built in code.
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { Editor, JSONContent } from "@tiptap/core";
import { makeEditor, paragraphTexts, selectText, setCursor } from "./harness";
import { buildDocx } from "./docx-fixture";
import { readDocx } from "../docx/read";
import { writeDocx } from "../docx/write";
import { applyDocxImport, collectDocxInput } from "../docx/apply";
import { parseXml } from "../docx/xml";
import { listBookmarks, setBookmark } from "../bookmarks";
import { insertTableOfContents, updateFields } from "../references";
import { insertCaption } from "../captions";
import { insertCrossReference, refTargets } from "../crossref";

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const r = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const fld = (instr: string, result: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r(result)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const STYLES = `<w:styles ${W_NS}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Beschriftung"><w:name w:val="caption"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Verzeichnis1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Verzeichnis2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/></w:style>
</w:styles>`;

const tocEntry = (style: string, anchor: string, text: string, page: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:hyperlink w:anchor="${anchor}" w:history="1">${r(text)}<w:r><w:tab/></w:r>${fld(`PAGEREF ${anchor} \\h`, page)}</w:hyperlink></w:p>`;

const WORD_BODY =
  // A TOC in a content control: begin/separate in the first entry, end in
  // a paragraph of its own.
  `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>` +
  `<w:p><w:pPr><w:pStyle w:val="Verzeichnis1"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:hyperlink w:anchor="_Toc100">${r("Introduction")}<w:r><w:tab/></w:r>${fld("PAGEREF _Toc100 \\h", "1")}</w:hyperlink></w:p>` +
  tocEntry("Verzeichnis2", "_Toc101", "Scope", "2") +
  `<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>` +
  `</w:sdtContent></w:sdt>` +
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:bookmarkStart w:id="0" w:name="_Toc100"/>${r("Introduction")}<w:bookmarkEnd w:id="0"/></w:p>` +
  `<w:p>${r("Text with a ")}<w:bookmarkStart w:id="1" w:name="Key"/>${r("key")}${r(" idea")}<w:bookmarkEnd w:id="1"/>${r(". Page ")}<w:fldSimple w:instr=" PAGE ">${r("1")}</w:fldSimple>${r(" of ")}${fld("NUMPAGES", "3")}</w:p>` +
  `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:bookmarkStart w:id="2" w:name="_Toc101"/>${r("Scope")}<w:bookmarkEnd w:id="2"/></w:p>` +
  `<w:p><w:pPr><w:pStyle w:val="Beschriftung"/></w:pPr><w:bookmarkStart w:id="3" w:name="_Ref5"/>${r("Figure ")}${fld("SEQ Figure \\* ARABIC", "1")}<w:bookmarkEnd w:id="3"/>${r(": Chart")}</w:p>` +
  `<w:p>${r("See ")}${fld("REF _Ref5 \\h", "Figure 1")}${r(" and ")}<w:hyperlink w:anchor="Key" w:tooltip="Jump to the key idea">${r("the idea")}</w:hyperlink>${r(".")}<w:bookmarkStart w:id="4" w:name="Here"/><w:bookmarkEnd w:id="4"/></w:p>`;

async function importBody(body: string) {
  const imp = await readDocx(await buildDocx({ body, styles: STYLES }));
  const editor = makeEditor("<p></p>");
  applyDocxImport(editor, imp);
  return { editor, imp };
}

async function exportDoc(editor: Editor): Promise<{ doc: Document; styles: Document; bytes: Uint8Array }> {
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

const q = (d: Document | Element, sel: string) => [...(d as Element).getElementsByTagName(sel)];
const nodesOf = (json: JSONContent, type: string): JSONContent[] => {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === type) out.push(n);
    n.content?.forEach(walk);
  };
  walk(json);
  return out;
};

describe("docx references: reader", () => {
  it("maps a TOC, bookmarks, fields and anchored links with tooltips", async () => {
    const { editor, imp } = await importBody(WORD_BODY);
    const json = editor.getJSON();
    const [toc] = nodesOf(json, "tableOfContents");
    expect(toc.attrs!.instr).toBe('TOC \\o "1-2" \\h \\z \\u');
    expect(toc.content!.map((e) => [e.attrs!.level, e.attrs!.page, e.content![0].text, e.content![0].marks?.[0]?.attrs?.href])).toEqual([
      [1, "1", "Introduction", "#_Toc100"],
      [2, "2", "Scope", "#_Toc101"],
    ]);
    expect(listBookmarks(editor.state.doc).map((b) => [b.name, b.text])).toEqual([
      ["_Toc100", "Introduction"],
      ["Key", "key idea"],
      ["_Toc101", "Scope"],
      ["_Ref5", "Figure 1"],
      ["Here", ""],
    ]);
    expect(nodesOf(json, "field").map((f) => [f.attrs!.instr, f.attrs!.result])).toEqual([
      ["PAGE", "1"],
      ["NUMPAGES", "3"],
      ["SEQ Figure \\* ARABIC", "1"],
      ["REF _Ref5 \\h", "Figure 1"],
    ]);
    const texts = paragraphTexts(editor);
    expect(texts).toContain("Text with a key idea. Page 1 of 3");
    expect(texts).toContain("See Figure 1 and the idea.");
    const idea = nodesOf(json, "text").find((t) => t.text === "the idea")!;
    expect(idea.marks).toEqual([{ type: "link", attrs: expect.objectContaining({ href: "#Key", title: "Jump to the key idea" }) }]);
    const caption = json.content!.find((b) => b.content?.some((c) => c.type === "field" && c.attrs!.instr.startsWith("SEQ")))!;
    expect(caption.attrs!.styleId).toBe("Caption");
    expect(imp.warnings).not.toContain("bookmarks");
    // F9 recomputes from the model: NUMPAGES falls back to the page
    // placeholder (no breaks = 1 page).
    updateFields(editor, "all");
    expect(paragraphTexts(editor)).toContain("Text with a key idea. Page 1 of 1");
  });

  it("keeps unknown fields as text and header fields as their result", async () => {
    const { editor } = await importBody(`<w:p>${r("Merge: ")}${fld('MERGEFIELD Name \\* MERGEFORMAT', "«Name»")}</w:p>`);
    expect(nodesOf(editor.getJSON(), "field")).toEqual([]);
    expect(paragraphTexts(editor)).toEqual(["Merge: «Name»"]);
  });
});

describe("docx references: writer and round trips", () => {
  function authored(): Editor {
    const e = makeEditor("<p></p><h1>Intro</h1><p>alpha beta</p><p>fig here</p><h2>Details</h2><p>See: </p>", { cursor: "start" });
    insertTableOfContents(e);
    selectText(e, "fig here");
    insertCaption(e, { label: "Figure", text: ": Growth" });
    selectText(e, "beta");
    const tr = e.state.tr;
    setBookmark(tr, "Beta", e.state.selection.from, e.state.selection.to);
    e.view.dispatch(tr);
    setCursor(e, e.state.doc.content.size - 1);
    insertCrossReference(e, { type: "caption:Figure", target: refTargets(e, "caption:Figure")[0], kind: "labelNumber", hyperlink: true });
    e.commands.insertContent(" on page ");
    insertCrossReference(e, { type: "heading", target: refTargets(e, "heading")[1], kind: "page" });
    e.commands.insertContent(" ");
    e.commands.insertContent({ type: "text", text: "top", marks: [{ type: "link", attrs: { href: "#_top", title: "Back to top" } }] });
    return e;
  }

  it("writes bookmarks, complex fields, the TOC content control, anchors and tooltips", async () => {
    const e = authored();
    const { doc, styles } = await exportDoc(e);
    const starts = q(doc, "w:bookmarkStart").map((b) => b.getAttribute("w:name"));
    expect(starts).toEqual(expect.arrayContaining(["_Toc1", "_Toc2", "Beta", "_Ref1"]));
    // Every start has its end, ids unique.
    const ids = q(doc, "w:bookmarkStart").map((b) => b.getAttribute("w:id"));
    expect(new Set(ids).size).toBe(ids.length);
    expect(q(doc, "w:bookmarkEnd").map((b) => b.getAttribute("w:id")).sort()).toEqual([...ids].sort());
    const instrs = q(doc, "w:instrText").map((t) => t.textContent!.trim());
    expect(instrs).toEqual(
      expect.arrayContaining(['TOC \\o "1-3" \\h \\z \\u', "PAGEREF _Toc1 \\h", "SEQ Figure \\* ARABIC", "REF _Ref1 \\h", "PAGEREF _Ref2"]),
    );
    const begins = q(doc, "w:fldChar").filter((f) => f.getAttribute("w:fldCharType") === "begin").length;
    expect(q(doc, "w:fldChar").filter((f) => f.getAttribute("w:fldCharType") === "end").length).toBe(begins);
    const sdt = q(doc, "w:sdt")[0];
    expect(q(sdt, "w:docPartGallery")[0].getAttribute("w:val")).toBe("Table of Contents");
    expect(q(sdt, "w:pStyle").map((s) => s.getAttribute("w:val"))).toEqual(["TOC1", "TOC2"]);
    const links = q(doc, "w:hyperlink").map((h) => [h.getAttribute("w:anchor"), h.getAttribute("w:tooltip")]);
    expect(links).toEqual(expect.arrayContaining([["_Toc1", null], ["_top", "Back to top"]]));
    const styleIds = q(styles, "w:style").map((s) => s.getAttribute("w:styleId"));
    expect(styleIds).toEqual(expect.arrayContaining(["TOC1", "TOC2", "Caption"]));
    const tab = q(q(styles, "w:style").find((s) => s.getAttribute("w:styleId") === "TOC1")!, "w:tab")[0];
    expect([tab.getAttribute("w:val"), tab.getAttribute("w:leader")]).toEqual(["right", "dot"]);
  });

  it("Grown → docx → Grown keeps the model; a second trip is stable", async () => {
    const e = authored();
    const { bytes } = await exportDoc(e);
    const imp = await readDocx(bytes);
    const f = makeEditor("<p></p>");
    applyDocxImport(f, imp);
    expect(f.getJSON().content).toEqual(e.getJSON().content);
    const again = await readDocx((await exportDoc(f)).bytes);
    const g = makeEditor("<p></p>");
    applyDocxImport(g, again);
    expect(g.getJSON()).toEqual(f.getJSON());
  });

  it("Word's document → Grown → docx → Grown is stable", async () => {
    const { editor } = await importBody(WORD_BODY);
    const { bytes } = await exportDoc(editor);
    const f = makeEditor("<p></p>");
    applyDocxImport(f, await readDocx(bytes));
    expect(f.getJSON().content).toEqual(editor.getJSON().content);
  });
});
