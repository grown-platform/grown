// Grown-native tests for Docs M8: fields, bookmarks, internal links,
// captions, cross-references, tables of contents / figures and Add text.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { makeEditor, makeSyncedEditors, paragraphTexts, pressKey, selectText, setCursor, textblocks, typeText } from "./harness";
import { formatDate, parseInstr, formatFieldNumber, explicitPages, REF_ERROR } from "../fields";
import {
  findBookmark,
  followLink,
  goToBookmark,
  isValidBookmarkName,
  listBookmarks,
  removeBookmark,
  setBookmark,
} from "../bookmarks";
import {
  fieldAt,
  followAt,
  insertTableOfContents,
  setFieldClock,
  setPageResolver,
  toggleFieldCodes,
  unlinkFields,
  updateFields,
} from "../references";
import { captionItems, captionLabels, insertCaption } from "../captions";
import { insertCrossReference, refTargets } from "../crossref";
import { setTocLevel, tocOptions, tocInstr, tofInstr } from "../toc";
import { getDocModel } from "../docModel";

const fields = (e: Editor) => {
  const out: { instr: string; result: string; pos: number }[] = [];
  e.state.doc.descendants((n, pos) => {
    if (n.type.name === "field") out.push({ instr: n.attrs.instr, result: n.attrs.result, pos });
    return true;
  });
  return out;
};
const results = (e: Editor) => fields(e).map((f) => f.result);
const tocEntries = (e: Editor, nth = 0) => {
  const out: { text: string; level: number; page: string; href: string | null }[] = [];
  let i = 0;
  e.state.doc.descendants((n) => {
    if (n.type.name !== "tableOfContents") return true;
    if (i++ === nth)
      n.forEach((entry: PMNode) =>
        out.push({
          text: entry.textContent,
          level: entry.attrs.level,
          page: entry.attrs.page,
          href: (entry.firstChild?.marks.find((m) => m.type.name === "link")?.attrs.href as string) ?? null,
        }),
      );
    return false;
  });
  return out;
};
const headingsDoc = "<h1>Intro</h1><p>a</p><h2>Scope</h2><p>b</p><h1>Method</h1><h3>Deep</h3><p>c</p>";

describe("field instructions and formats", () => {
  it("parses types, arguments, switches and formats", () => {
    expect(parseInstr('SEQ Figure \\* ARABIC \\s 1')).toEqual({ type: "SEQ", args: ["Figure"], sw: { s: "1" }, formats: ["ARABIC"] });
    expect(parseInstr('DATE \\@ "dddd, MMMM d, yyyy" \\* MERGEFORMAT')).toMatchObject({ type: "DATE", sw: { "@": "dddd, MMMM d, yyyy" }, formats: ["MERGEFORMAT"] });
    expect(parseInstr('TOC \\o "1-3" \\h \\z \\u')).toMatchObject({ type: "TOC", sw: { o: "1-3", h: true, z: true, u: true } });
    expect(parseInstr(" REF _Ref123 \\h \\p ")).toMatchObject({ type: "REF", args: ["_Ref123"], sw: { h: true, p: true } });
    expect(parseInstr('STYLEREF "Heading 1" \\s')).toMatchObject({ type: "STYLEREF", args: ["Heading 1"], sw: { s: true } });
  });
  it("formats numbers and Word date pictures", () => {
    expect(formatFieldNumber(4, ["roman"])).toBe("iv");
    expect(formatFieldNumber(28, ["ALPHABETIC"])).toBe("BB");
    expect(formatFieldNumber(3, ["Ordinal"])).toBe("3rd");
    const d = new Date(2026, 8, 6, 14, 5, 9);
    expect(formatDate(d, "M/d/yyyy")).toBe("9/6/2026");
    expect(formatDate(d, "dddd, MMMM d, yyyy")).toBe("Sunday, September 6, 2026");
    expect(formatDate(d, "yyyy-MM-dd HH:mm:ss")).toBe("2026-09-06 14:05:09");
    expect(formatDate(d, "h:mm am/pm")).toBe("2:05 pm");
    expect(formatDate(d, "d-MMM-yy 'at' h AM/PM")).toBe("6-Sep-26 at 2 PM");
  });
  it("counts explicit pages until M9's pagination", () => {
    const e = makeEditor("<p>a</p><div data-page-break></div><p>b</p><p style='break-before: page'>c</p>");
    const pages = explicitPages(e.state.doc);
    expect(pages.pageCount()).toBe(3);
    expect(pages.pageAt(1)).toBe(1);
    expect(pages.pageAt(e.state.doc.content.size - 1)).toBe(3);
  });
});

describe("PAGE, NUMPAGES, DATE, TIME", () => {
  it("insert with results; Alt+Shift+P/D/T; F9 updates; field codes; unlink", () => {
    const e = makeEditor("<p>Page:</p><div data-page-break></div><p>x</p>");
    setFieldClock(e, () => new Date(2026, 0, 2, 9, 30));
    setCursor(e, 6);
    e.commands.insertContent(" ");
    pressKey(e, "Alt-Shift-p");
    e.commands.insertContent(" of ");
    e.commands.insertField("NUMPAGES");
    expect(paragraphTexts(e)[0]).toBe("Page: 1 of 2");
    e.commands.insertField('DATE \\@ "MMMM d, yyyy"');
    pressKey(e, "Alt-Shift-t");
    expect(results(e).slice(2)).toEqual(["January 2, 2026", "9:30 am"]);
    // A page break before the fields: F9 on all updates PAGE.
    setCursor(e, 1);
    e.commands.insertPageBreak();
    expect(results(e)[0]).toBe("1");
    expect(updateFields(e, "all")).toBe(true);
    expect(results(e).slice(0, 2)).toEqual(["2", "3"]);
    // A page resolver (the app measures) wins.
    setPageResolver(e, () => ({ pageAt: () => 7, pageCount: () => 9 }));
    updateFields(e, "all");
    expect(results(e).slice(0, 2)).toEqual(["7", "9"]);
    toggleFieldCodes(e);
    expect(e.view.dom.classList.contains("show-field-codes")).toBe(true);
    expect(e.view.dom.querySelector('.doc-field[data-field="PAGE"]')!.getAttribute("data-field-instr")).toBe("PAGE");
    // Ctrl+Shift+F9 turns the field at the caret into text.
    const page = fields(e)[0];
    setCursor(e, page.pos);
    expect(fieldAt(e.state)?.node.attrs.instr).toBe("PAGE");
    unlinkFields(e);
    expect(fields(e)).toHaveLength(3);
    expect(paragraphTexts(e).join("|")).toContain("Page: 7 of 9");
  });

  it("round-trips through HTML and syncs over Yjs", () => {
    const { editors, sync } = makeSyncedEditors(2);
    const [a, b] = editors;
    a.commands.setContent("<p>Total:</p>");
    setCursor(a, 7);
    a.commands.insertField("NUMPAGES");
    sync();
    expect(fields(b)).toEqual([{ instr: "NUMPAGES", result: "1", pos: 7 }]);
    const c = makeEditor(a.getHTML());
    expect(c.getJSON()).toEqual(a.getJSON());
  });
});

describe("bookmarks and internal links", () => {
  it("add, list, go to, move, delete, point bookmarks, names", () => {
    const e = makeEditor("<p>alpha beta gamma</p><p>delta</p>");
    expect(isValidBookmarkName("Results_2026")).toBe(true);
    expect(isValidBookmarkName("2x")).toBe(false);
    expect(isValidBookmarkName("has space")).toBe(false);
    expect(isValidBookmarkName("_Toc1")).toBe(false);
    expect(isValidBookmarkName("_Toc1", true)).toBe(true);
    selectText(e, "beta");
    const tr = e.state.tr;
    setBookmark(tr, "Beta", e.state.selection.from, e.state.selection.to);
    setBookmark(tr, "Start", 1, 1);
    e.view.dispatch(tr);
    expect(listBookmarks(e.state.doc).map((b) => [b.name, b.text])).toEqual([
      ["Start", ""],
      ["Beta", "beta"],
    ]);
    setCursor(e, e.state.doc.content.size - 1);
    expect(goToBookmark(e, "Beta")).toBe(true);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("beta");
    // Re-adding a name moves it.
    selectText(e, "delta");
    const t2 = e.state.tr;
    setBookmark(t2, "Beta", e.state.selection.from, e.state.selection.to);
    e.view.dispatch(t2);
    expect(findBookmark(e.state.doc, "Beta")?.text).toBe("delta");
    const t3 = e.state.tr;
    expect(removeBookmark(t3, "Start")).toBe(true);
    e.view.dispatch(t3);
    expect(listBookmarks(e.state.doc).map((b) => b.name)).toEqual(["Beta"]);
    expect(e.getText()).toBe("alpha beta gamma\n\ndelta");
  });

  it("Ctrl+click / Alt+Enter follow #bookmark, #_top and external links", () => {
    const e = makeEditor(
      '<p>Top</p><p>see <a href="#Target">target</a> and <a href="https://grown.haus" title="Home">site</a></p><p><span data-bookmark="Target">here</span></p>',
    );
    selectText(e, "targ");
    expect(followAt(e)).toBe(true);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("here");
    const opened: string[] = [];
    expect(followLink(e, "https://grown.haus", (u) => opened.push(u))).toBe(true);
    expect(opened).toEqual(["https://grown.haus"]);
    expect(followLink(e, "#_top")).toBe(true);
    expect(e.state.selection.from).toBe(1);
    // ScreenTip is kept.
    expect(e.getHTML()).toContain('title="Home"');
  });

  it("pasting a copy keeps the original bookmark only", () => {
    const e = makeEditor('<p><span data-bookmark="Keep">word</span></p><p></p>');
    setCursor(e, e.state.doc.content.size - 1);
    e.view.pasteHTML('<span data-bookmark="Keep">word</span> <span data-bookmark="Fresh">new</span>');
    expect(listBookmarks(e.state.doc).map((b) => [b.name, b.text])).toEqual([
      ["Keep", "word"],
      ["Fresh", "new"],
    ]);
  });
});

describe("tables of contents", () => {
  it("builds from headings with levels, bookmarks, links and pages; F9 in the table updates it", () => {
    const e = makeEditor(`<p></p>${headingsDoc}`, { cursor: "start" });
    insertTableOfContents(e);
    expect(tocEntries(e)).toEqual([
      { text: "Intro", level: 1, page: "1", href: "#_Toc1" },
      { text: "Scope", level: 2, page: "1", href: "#_Toc2" },
      { text: "Method", level: 1, page: "1", href: "#_Toc3" },
      { text: "Deep", level: 3, page: "1", href: "#_Toc4" },
    ]);
    expect(findBookmark(e.state.doc, "_Toc2")?.text).toBe("Scope");
    // Edit a heading, add one after a page break, then F9 inside the TOC.
    selectText(e, "Method", 1);
    e.commands.insertContent("Methods");
    setCursor(e, e.state.doc.content.size - 1);
    e.commands.insertPageBreak();
    e.commands.setNode("heading", { level: 2 });
    e.commands.insertContent("Results");
    setCursor(e, 3);
    pressKey(e, "F9");
    expect(tocEntries(e).map((x) => [x.text, x.page])).toEqual([
      ["Intro", "1"],
      ["Scope", "1"],
      ["Methods", "1"],
      ["Deep", "1"],
      ["Results", "2"],
    ]);
    // Heading bookmarks grow with edits; following an entry goes there.
    expect(findBookmark(e.state.doc, "_Toc3")?.text).toBe("Methods");
    selectText(e, "Results", 0);
    expect(followAt(e)).toBe(true);
    expect(e.state.selection.$from.parent.type.name).toBe("heading");
  });

  it("levels, page numbers and table of figures options; Add text", () => {
    expect(tocOptions('TOC \\o "2-4" \\h \\z \\n \\u')).toEqual({ from: 2, to: 4, hyperlinks: true, pageNumbers: false, caption: null });
    expect(tocInstr({ from: 1, to: 2, hyperlinks: false, pageNumbers: true, caption: null })).toBe('TOC \\o "1-2" \\z \\u');
    const e = makeEditor(`<p></p>${headingsDoc}<p>Appendix note</p>`, { cursor: "start" });
    insertTableOfContents(e, tocInstr({ from: 1, to: 2, hyperlinks: false, pageNumbers: false, caption: null }));
    expect(tocEntries(e).map((x) => [x.text, x.href])).toEqual([
      ["Intro", null],
      ["Scope", null],
      ["Method", null],
    ]);
    expect(e.view.dom.querySelector(".doc-toc")!.getAttribute("data-no-pages")).toBe("true");
    const sheet = getDocModel(e).sheet;
    // Add text: a body paragraph at level 2, a heading out of the TOC.
    selectText(e, "Appendix");
    expect(setTocLevel(e, 2, sheet)).toBe(true);
    selectText(e, "Scope", 1);
    expect(setTocLevel(e, 0, sheet)).toBe(true);
    expect(textblocks(e).find((b) => b.node.type.name === "heading" && b.node.textContent === "Scope")!.node.attrs.outlineLevel).toBe(10);
    updateFields(e, "all");
    expect(tocEntries(e).map((x) => x.text)).toEqual(["Intro", "Method", "Appendix note"]);
    // Back to its style's level drops the override.
    selectText(e, "Scope");
    setTocLevel(e, 2, sheet);
    expect(textblocks(e).find((b) => b.node.type.name === "heading" && b.node.textContent === "Scope")!.node.attrs.outlineLevel).toBeNull();
    // HTML round trip keeps the table.
    const c = makeEditor(e.getHTML());
    expect(c.getJSON()).toEqual(e.getJSON());
  });

  it("an empty document says so", () => {
    const e = makeEditor("<p></p>");
    insertTableOfContents(e);
    expect(tocEntries(e).map((x) => x.text)).toEqual(["No table of contents entries found."]);
    insertTableOfContents(e, tofInstr("Figure"));
    expect(tocEntries(e, 1).map((x) => x.text)).toEqual(["No table of figures entries found."]);
  });
});

describe("captions", () => {
  it("numbers captions, renumbers on insert, table above, labels, formats, table of figures", () => {
    const e = makeEditor("<p>first</p><p>second</p><table><tr><td><p>cell</p></td></tr></table><p>end</p>");
    selectText(e, "first");
    insertCaption(e, { label: "Figure", text: ": One" });
    selectText(e, "second");
    insertCaption(e, { label: "Figure", text: ": Two" });
    expect(paragraphTexts(e).filter((t) => t.startsWith("Figure"))).toEqual(["Figure 1: One", "Figure 2: Two"]);
    // A caption inserted before the others renumbers them at once.
    setCursor(e, 1);
    e.commands.insertContent({ type: "paragraph", content: [{ type: "text", text: "zero" }] });
    selectText(e, "zero");
    insertCaption(e, { label: "Figure", text: ": Zero", position: "above" });
    expect(paragraphTexts(e).filter((t) => t.startsWith("Figure"))).toEqual(["Figure 1: Zero", "Figure 2: One", "Figure 3: Two"]);
    // Table: caption above the table, roman numbers, style Caption.
    selectText(e, "cell");
    insertCaption(e, { label: "Table", text: " Totals", format: "ROMAN" });
    const idx = paragraphTexts(e).indexOf("Table I Totals");
    expect(idx).toBeGreaterThan(0);
    const cap = textblocks(e).find((b) => b.node.textContent === "Table  Totals")!;
    expect(cap.node.attrs.styleId).toBe("Caption");
    expect(e.state.doc.nodeAt(cap.pos - 1 + cap.node.nodeSize)!.type.name).toBe("table");
    // Custom label, excluded label.
    selectText(e, "end");
    insertCaption(e, { label: "Chart", text: " sales", excludeLabel: true });
    expect(paragraphTexts(e)).toContain("1 sales");
    expect(captionLabels(e.state.doc, [])).toEqual(["Figure", "Table", "Equation", "Chart"]);
    expect(captionItems(e.state.doc, "Figure").map((c) => c.text)).toEqual(["Figure 1: Zero", "Figure 2: One", "Figure 3: Two"]);
    // Table of figures.
    setCursor(e, 1);
    insertTableOfContents(e, tofInstr("Figure"));
    expect(tocEntries(e).map((x) => x.text)).toEqual(["Figure 1: Zero", "Figure 2: One", "Figure 3: Two"]);
  });

  it("chapter numbering restarts at each Heading 1", () => {
    const e = makeEditor("<h1>One</h1><p>a</p><p>b</p><h1>Two</h1><p>c</p>");
    for (const t of ["a", "b", "c"]) {
      selectText(e, t);
      insertCaption(e, { label: "Figure", chapter: { level: 1, separator: "-" } });
    }
    expect(paragraphTexts(e).filter((t) => t.startsWith("Figure"))).toEqual(["Figure 1-1", "Figure 1-2", "Figure 2-1"]);
  });
});

describe("cross-references", () => {
  it("to a heading: text, page, above/below; hidden _Ref bookmark; F9 after an edit", () => {
    const e = makeEditor("<p>See</p><h1>Background</h1><p>More</p>");
    setCursor(e, 4);
    e.commands.insertContent(" ");
    const [head] = refTargets(e, "heading");
    expect(head.label).toBe("Background");
    insertCrossReference(e, { type: "heading", target: head, kind: "text", hyperlink: true });
    e.commands.insertContent(" on page ");
    insertCrossReference(e, { type: "heading", target: refTargets(e, "heading")[0], kind: "page" });
    e.commands.insertContent(" ");
    insertCrossReference(e, { type: "heading", target: refTargets(e, "heading")[0], kind: "aboveBelow" });
    expect(paragraphTexts(e)[0]).toBe("See Background on page 1 below");
    expect(fields(e).map((f) => f.instr)).toEqual(["REF _Ref1 \\h", "PAGEREF _Ref1", "REF _Ref1 \\p"]);
    expect(findBookmark(e.state.doc, "_Ref1")?.text).toBe("Background");
    // Edit inside the heading (the bookmark keeps covering it).
    const h = textblocks(e).find((b) => b.node.type.name === "heading")!;
    setCursor(e, h.pos + 4);
    typeText(e, "ed ");
    expect(paragraphTexts(e)[0]).toBe("See Background on page 1 below");
    updateFields(e, "all");
    expect(paragraphTexts(e)[0]).toBe("See Backed ground on page 1 below");
    // Text typed at the end of the heading joins its hidden bookmark on
    // the next update (grown-variant: Word leaves it outside).
    const h2 = textblocks(e).find((b) => b.node.type.name === "heading")!;
    setCursor(e, h2.pos + h2.node.content.size);
    typeText(e, " notes");
    updateFields(e, "all");
    expect(paragraphTexts(e)[0]).toBe("See Backed ground notes on page 1 below");
    // Ctrl+click on the REF \h field follows it.
    expect(followAt(e, fields(e)[0].pos)).toBe(true);
    expect(e.state.selection.$from.parent.type.name).toBe("heading");
  });

  it("to bookmarks, footnotes, captions; missing target reports an error", () => {
    const e = makeEditor('<p>A text <span data-bookmark="Key">key idea</span></p><p>ref:</p><p>fig</p>');
    setCursor(e, 2);
    e.commands.insertFootnote("note one");
    selectText(e, "fig");
    insertCaption(e, { label: "Figure", text: ": Chart" });
    setCursor(e, e.state.doc.child(0).nodeSize + 5);
    e.commands.insertContent(" ");
    const bm = refTargets(e, "bookmark")[0];
    expect(bm.name).toBe("Key");
    insertCrossReference(e, { type: "bookmark", target: bm, kind: "text" });
    e.commands.insertContent(", ");
    insertCrossReference(e, { type: "footnote", target: refTargets(e, "footnote")[0], kind: "noteNumber" });
    e.commands.insertContent(", ");
    const fig = refTargets(e, "caption:Figure")[0];
    insertCrossReference(e, { type: "caption:Figure", target: fig, kind: "labelNumber" });
    e.commands.insertContent(", ");
    insertCrossReference(e, { type: "caption:Figure", target: refTargets(e, "caption:Figure")[0], kind: "captionText" });
    e.commands.insertContent(", ");
    insertCrossReference(e, { type: "caption:Figure", target: refTargets(e, "caption:Figure")[0], kind: "text" });
    expect(paragraphTexts(e)[1]).toBe("ref: key idea, 1, Figure 1, Chart, Figure 1: Chart");
    // Removing the bookmark breaks the reference on the next update.
    const tr = e.state.tr;
    removeBookmark(tr, "Key");
    e.view.dispatch(tr);
    updateFields(e, "all");
    expect(results(e)).toContain(REF_ERROR);
  });
});
