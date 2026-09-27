// Direct DOCX import / export (Docs M6). Fixtures are built in code
// (docx-fixture.ts); no third-party files are committed.
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { Editor } from "@tiptap/core";
import { makeEditor, numberingText, paragraphTexts } from "./harness";
import { buildDocx, richParts, PNG_1PX, STYLES, NUMBERING } from "./docx-fixture";
import { readDocx } from "../docx/read";
import { writeDocx } from "../docx/write";
import { applyDocxImport, collectDocxInput, importComments } from "../docx/apply";
import { stashDocxSeed, takeDocxSeed } from "../docx/seed";
import { importFile } from "../api";
import { getDocModel } from "../docModel";
import { parseXml } from "../docx/xml";
import type { DocxImport } from "../docx/model";

async function importInto(bytes: Uint8Array): Promise<{ editor: Editor; imp: DocxImport }> {
  const imp = await readDocx(bytes);
  const editor = makeEditor("<p></p>");
  applyDocxImport(editor, imp);
  return { editor, imp };
}

async function exportFrom(editor: Editor, imp?: DocxImport): Promise<Uint8Array> {
  const input = collectDocxInput(editor, { title: "Test" });
  if (imp) input.comments = imp.comments;
  input.now = new Date("2026-09-26T00:00:00Z");
  return writeDocx(input);
}

function model(editor: Editor) {
  const { sheet, numbering } = getDocModel(editor);
  return { doc: editor.getJSON(), styles: sheet.map.toJSON(), numbering: numbering.map.toJSON() };
}

function findNode(json: ReturnType<Editor["getJSON"]>, pred: (n: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  const stack = [json as Record<string, unknown>];
  while (stack.length) {
    const n = stack.shift()!;
    if (pred(n)) return n;
    stack.push(...(((n.content as Record<string, unknown>[]) ?? [])));
  }
  return null;
}

const textOf = (n: Record<string, unknown> | null): string =>
  !n ? "" : n.type === "text" ? (n.text as string) : ((n.content as Record<string, unknown>[]) ?? []).map(textOf).join("");

describe("docx reader", () => {
  it("maps styles, headings and character styles", async () => {
    const { editor, imp } = await importInto(await buildDocx(richParts()));
    const { sheet } = getDocModel(editor);
    // Built-ins are matched by name, even when the id is localised.
    expect(imp.styles.Title?.rPr?.fontSize).toBe(28);
    expect(imp.styles.Heading1).toMatchObject({ builtin: true, headingLevel: 1, basedOn: "Normal", next: "Normal" });
    expect(imp.styles.Heading1.rPr).toMatchObject({ color: "#2f5496", fontSize: 16, fontFamily: "Calibri Light", bold: false });
    expect(imp.styles.Heading1.pPr).toMatchObject({ keepNext: true, keepLines: true, spaceBefore: 12, spaceAfter: 0, outlineLevel: 1 });
    // docDefaults sit under Normal (theme fonts resolved).
    expect(imp.styles.Normal.rPr).toMatchObject({ fontFamily: "Calibri", fontSize: 11 });
    expect(imp.styles.Normal.pPr).toMatchObject({ spaceAfter: 8, lineRule: "auto", lineValue: 1.08 });
    // Custom styles keep names and inheritance; unused / table styles are left out.
    expect(imp.styles.Callout).toMatchObject({ name: "Callout Box", type: "paragraph", basedOn: "Normal" });
    expect(imp.styles.Callout.pPr).toMatchObject({ indLeft: 18, shading: "#e8f0fe" });
    expect(imp.styles.Callout.pPr?.borders?.left).toEqual({ width: 3, style: "solid", color: "#1a73e8" });
    expect(imp.styles.BigHeading).toMatchObject({ basedOn: "Heading1", rPr: { fontSize: 20 } });
    expect(imp.styles.Marker).toMatchObject({ type: "character", rPr: { bold: true, color: "#c00000" } });
    expect(Object.keys(imp.styles)).not.toContain("Unused");
    expect(Object.keys(imp.styles)).not.toContain("TableGrid");
    expect(Object.keys(imp.styles)).not.toContain("DefaultParagraphFont");
    expect(sheet.get("Callout")?.name).toBe("Callout Box");

    const json = editor.getJSON();
    const blocks = json.content!;
    expect(blocks[0]).toMatchObject({ type: "paragraph", attrs: { styleId: "Title" } });
    expect(blocks[1]).toMatchObject({ type: "heading", attrs: { level: 1, styleId: null } });
    const big = findNode(json, (n) => textOf(n) === "Custom heading" && n.type === "heading");
    expect(big).toMatchObject({ attrs: { level: 1, styleId: "BigHeading" } });
    const callout = findNode(json, (n) => n.type === "paragraph" && textOf(n) === "A callout");
    expect(callout).toMatchObject({ attrs: { styleId: "Callout" } });
  });

  it("maps run formatting to marks", async () => {
    const { editor } = await importInto(await buildDocx(richParts()));
    const para = editor.getJSON().content![2];
    const runs = (para.content ?? []).map((t) => [t.text, (t.marks ?? []).map((m) => (m.attrs ? `${m.type}:${JSON.stringify(m.attrs)}` : m.type))]);
    const marksOf = (text: string) => runs.find(([t]) => t === text)?.[1] as string[];
    expect(marksOf("bold")).toEqual(["bold"]);
    expect(marksOf("italic")).toEqual(["italic"]);
    expect(marksOf("under")).toEqual(["underline"]);
    expect(marksOf("struck")).toEqual(["strike"]);
    expect(marksOf("red")[0]).toMatch(/^textStyle:.*"color":"#ff0000"/);
    expect(marksOf("big")[0]).toMatch(/"fontSize":"14pt"/);
    expect(marksOf("serif")[0]).toMatch(/"fontFamily":"Georgia"/);
    expect(marksOf("marked")[0]).toMatch(/^highlight:.*#ffff00/);
    expect(marksOf("2")).toEqual(["superscript"]);
    expect(marksOf("styled")).toEqual(['charStyle:{"styleId":"Marker"}']);
    expect(runs.some(([t]) => String(t).includes("\t"))).toBe(true);
    expect(marksOf("example")[0]).toMatch(/^link:.*"href":"https:\/\/example.com\/"/);
    expect(marksOf("see intro")[0]).toMatch(/"href":"#intro"/);
  });

  it("maps paragraph properties to the M3 attributes", async () => {
    const { editor } = await importInto(await buildDocx(richParts()));
    const para = findNode(editor.getJSON(), (n) => n.type === "paragraph" && textOf(n) === "Formatted paragraph")!;
    expect(para.attrs).toMatchObject({
      textAlign: "center",
      indent: 36,
      indentRight: 18,
      indentFirstLine: 18,
      paragraphSpacing: "6pt|12pt",
      lineHeight: "1.5",
      keepNext: true,
      shading: "#eeeeee",
      tabs: "468r.",
    });
    expect(JSON.parse((para.attrs as Record<string, string>).borders)).toEqual({ bottom: "1 solid #999999" });
  });

  it("maps numbering to the numbering map with Word's labels", async () => {
    const { editor, imp } = await importInto(await buildDocx(richParts()));
    expect(imp.numbering["num:3"]).toEqual({ id: "3", abstractId: "0", starts: { "0": 5 } });
    expect(imp.numbering["num:9"]).toBeUndefined(); // unused instance
    const abs1 = imp.numbering["abs:1"] as { lvls: { text: string; fmt: string }[] };
    expect(abs1.lvls[0]).toMatchObject({ fmt: "bullet", text: "•" }); // Symbol U+F0B7
    const texts = paragraphTexts(editor);
    const label = (t: string) => numberingText(editor, texts.indexOf(t));
    expect(label("First item")).toBe("1.");
    expect(label("Sub item")).toBe("1.1.");
    expect(label("Second item")).toBe("2.");
    expect(label("Bullet one")).toBe("•");
    expect(label("Restarted at five")).toBe("5.");
    // Numbering through a paragraph style.
    expect(imp.styles.ListNumbered.pPr).toMatchObject({ numId: "4" });
    expect(label("Through the style")).toBe("Step A)");
    expect(label("Also through the style")).toBe("Step B)");
  });

  it("maps tables with grid widths, merges, header rows and shading", async () => {
    const { editor } = await importInto(await buildDocx(richParts()));
    const table = findNode(editor.getJSON(), (n) => n.type === "table")!;
    const rows = table.content as { content: { type: string; attrs: Record<string, unknown>; content: unknown[] }[] }[];
    expect(rows).toHaveLength(3);
    expect(rows[0].content.map((c) => c.type)).toEqual(["tableHeader", "tableHeader", "tableHeader"]);
    expect(rows[0].content.map((c) => c.attrs.colwidth)).toEqual([[100], [200], [300]]);
    expect(rows[1].content[0].attrs).toMatchObject({ colspan: 2, colwidth: [100, 200], backgroundColor: "#fce8b2" });
    expect(rows[1].content[1].attrs).toMatchObject({ rowspan: 2 });
    expect(rows[2].content).toHaveLength(2);
  });

  it("maps images, notes, comments, tracked changes, fields and breaks", async () => {
    const { editor, imp } = await importInto(await buildDocx(richParts()));
    const json = editor.getJSON();
    const img = findNode(json, (n) => n.type === "image")!;
    expect(img.attrs).toMatchObject({ src: `data:image/png;base64,${PNG_1PX}`, alt: "Logo", width: 100, height: 50 });

    const fn = findNode(json, (n) => n.type === "footnote")!;
    expect(fn.attrs).toMatchObject({ id: "fn-1", content: "The footnote text." });
    const en = findNode(json, (n) => n.type === "endnote")!;
    expect(en.attrs).toMatchObject({ id: "en-2", content: "An endnote.\nSecond line." });

    expect(imp.comments).toEqual([
      { id: "docx-c0", author: "Carol", initials: "C", date: "2026-02-03T04:05:06Z", text: "Please check." },
      { id: "docx-c1", author: "Dan", date: "2026-02-04T04:05:06Z", text: "Checked.", parentId: "docx-c0" },
    ]);
    const commented = findNode(json, (n) => n.type === "text" && n.text === "commented text")!;
    expect(commented.marks).toEqual([{ type: "commentMark", attrs: { commentId: "docx-c0" } }]);

    const added = findNode(json, (n) => n.type === "text" && n.text === "added")!;
    expect(added.marks).toEqual([{ type: "insertion", attrs: { author: "Alice", color: "#188038" } }]);
    const removed = findNode(json, (n) => n.type === "text" && n.text === "removed")!;
    expect((removed.marks as unknown[])[0]).toMatchObject({ type: "deletion", attrs: { author: "Bob" } });

    const texts = paragraphTexts(editor);
    expect(texts).toContain("Date: 2026-09-26 field link");
    const fieldLink = findNode(json, (n) => n.type === "text" && n.text === "field link")!;
    expect((fieldLink.marks as unknown[])[0]).toMatchObject({ type: "link", attrs: { href: "https://grown.example/" } });

    const blocks = json.content!;
    const brk = blocks.findIndex((b) => b.type === "pageBreak");
    expect(brk).toBeGreaterThan(0);
    expect(textOf(blocks[brk + 1] as Record<string, unknown>)).toBe("After the break");
    expect(imp.warnings).toContain("bookmarks");
  });

  it("reads the header, footer and page setup", async () => {
    const { imp } = await importInto(await buildDocx(richParts()));
    expect(imp.header).toEqual({
      type: "doc",
      content: [{ type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "Company header", marks: [{ type: "bold" }] }] }],
    });
    expect(imp.footer?.content?.[0]).toMatchObject({ attrs: { textAlign: "right" } });
    expect(imp.page).toEqual({
      width: 792,
      height: 612,
      orientation: "landscape",
      margins: { top: 54, right: 72, bottom: 54, left: 72, header: 36, footer: 36 },
    });
  });

  it("rejects files that are not Word documents", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    await expect(readDocx(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow(/not a Word document/);
    await expect(readDocx(new TextEncoder().encode("plain text"))).rejects.toThrow();
  });

  it("never turns script URLs into links", async () => {
    const bytes = await buildDocx({
      body: '<w:p><w:hyperlink r:id="rIdX"><w:r><w:t>bad</w:t></w:r></w:hyperlink><w:fldSimple w:instr="HYPERLINK &quot;javascript:alert(1)&quot;"><w:r><w:t>worse</w:t></w:r></w:fldSimple></w:p>',
      rels: [["rIdX", "hyperlink", "javascript:alert(1)", true]],
    });
    const { editor } = await importInto(bytes);
    expect(JSON.stringify(editor.getJSON())).not.toMatch(/javascript/);
    expect(paragraphTexts(editor)).toEqual(["badworse"]);
  });
});

async function unzip(bytes: Uint8Array) {
  return JSZip.loadAsync(bytes);
}

describe("docx writer", () => {
  it("writes a well-formed package: content types, relationships, parts", async () => {
    const { editor, imp } = await importInto(await buildDocx(richParts()));
    const zip = await unzip(await exportFrom(editor, imp));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    for (const n of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "word/numbering.xml", "word/footnotes.xml", "word/endnotes.xml", "word/comments.xml", "word/commentsExtended.xml", "word/header1.xml", "word/footer1.xml", "word/settings.xml", "docProps/core.xml", "docProps/app.xml"])
      expect(names).toContain(n);
    // Every XML part parses.
    for (const n of names.filter((x) => /\.(xml|rels)$/.test(x))) parseXml(await zip.file(n)!.async("string"));
    // Every part except rels/content types has a content type.
    const ct = parseXml(await zip.file("[Content_Types].xml")!.async("string"));
    const overrides = new Set([...ct.getElementsByTagName("Override")].map((o) => o.getAttribute("PartName")));
    const defaults = new Set([...ct.getElementsByTagName("Default")].map((o) => o.getAttribute("Extension")));
    for (const n of names) {
      if (n === "[Content_Types].xml") continue;
      const ext = n.split(".").pop()!;
      expect(overrides.has(`/${n}`) || defaults.has(ext), n).toBe(true);
    }
    // Every internal relationship target exists.
    for (const relsPath of names.filter((n) => n.endsWith(".rels"))) {
      const base = relsPath === "_rels/.rels" ? "" : relsPath.replace(/_rels\/([^/]+)\.rels$/, "$1").replace(/[^/]*$/, "");
      const rels = parseXml(await zip.file(relsPath)!.async("string"));
      for (const r of [...rels.getElementsByTagName("Relationship")]) {
        if (r.getAttribute("TargetMode") === "External") continue;
        expect(names, `${relsPath} -> ${r.getAttribute("Target")}`).toContain(base + r.getAttribute("Target"));
      }
    }
    // Every r:id / r:embed in document.xml resolves.
    const docXml = await zip.file("word/document.xml")!.async("string");
    const relIds = new Set([...parseXml(await zip.file("word/_rels/document.xml.rels")!.async("string")).getElementsByTagName("Relationship")].map((r) => r.getAttribute("Id")));
    for (const m of docXml.matchAll(/r:(?:id|embed)="([^"]+)"/g)) expect(relIds.has(m[1]), m[1]).toBe(true);
    expect(docXml).toMatch(/<w:sectPr>.*<\/w:sectPr><\/w:body>/);
  });

  it("writes elements in schema order", async () => {
    const { editor, imp } = await importInto(await buildDocx(richParts()));
    const zip = await unzip(await exportFrom(editor, imp));
    const doc = parseXml(await zip.file("word/document.xml")!.async("string"));
    const order: Record<string, string[]> = {
      pPr: ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "widowControl", "numPr", "pBdr", "shd", "tabs", "spacing", "ind", "jc", "outlineLvl", "rPr"],
      rPr: ["rStyle", "rFonts", "b", "i", "caps", "smallCaps", "strike", "color", "sz", "szCs", "highlight", "u", "shd", "vertAlign"],
      tcPr: ["tcW", "gridSpan", "vMerge", "tcBorders", "shd", "tcMar", "vAlign"],
    };
    for (const [parent, want] of Object.entries(order)) {
      for (const e of [...doc.getElementsByTagName(`w:${parent}`)]) {
        const got = [...e.children].map((c) => c.localName);
        const idx = got.map((g) => want.indexOf(g));
        expect(idx.every((v) => v >= 0), `${parent}: ${got}`).toBe(true);
        expect([...idx].sort((a, b) => a - b), `${parent}: ${got}`).toEqual(idx);
      }
    }
    // Table cells end with a paragraph.
    for (const tc of [...doc.getElementsByTagName("w:tc")]) expect(tc.lastElementChild?.localName).toBe("p");
  });

  it("round-trips docx -> Grown -> docx -> Grown with an equal model", async () => {
    const first = await importInto(await buildDocx(richParts()));
    const exported = await exportFrom(first.editor, first.imp);
    const second = await importInto(exported);
    expect(model(second.editor)).toEqual(model(first.editor));
    expect(second.imp.comments).toEqual(first.imp.comments);
    expect(second.imp.header).toEqual(first.imp.header);
    expect(second.imp.footer).toEqual(first.imp.footer);
  });

  it("exports a document written in the editor (TipTap lists, quotes, code)", async () => {
    const editor = makeEditor(
      "<h2>Plan</h2><ul><li><p>Alpha</p><ul><li><p>Nested</p></li></ul></li><li><p>Beta</p></li></ul>" +
        "<ol start=\"3\"><li><p>Three</p></li><li><p>Four</p></li></ol>" +
        "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"true\"><p>Done</p></li></ul>" +
        "<blockquote><p>Quoted</p></blockquote><pre><code>line 1\nline 2</code></pre><hr>" +
        "<table><tbody><tr><th><p>H</p></th><th><p>I</p></th></tr><tr><td colspan=\"2\"><p>Wide</p></td></tr></tbody></table>",
    );
    const { editor: back } = await importInto(await exportFrom(editor));
    const texts = paragraphTexts(back);
    expect(texts).toEqual(expect.arrayContaining(["Plan", "Alpha", "Nested", "Beta", "Three", "Four", "☒ Done", "Quoted", "line 1\nline 2", "H", "I", "Wide"]));
    const label = (t: string) => numberingText(back, texts.indexOf(t));
    expect(label("Alpha")).toBe("•");
    expect(label("Nested")).toBe("◦");
    expect(label("Three")).toBe("3.");
    expect(label("Four")).toBe("4.");
    expect(back.getJSON().content![0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    const quoted = findNode(back.getJSON(), (n) => textOf(n) === "Quoted" && n.type === "paragraph")!;
    expect(quoted.attrs).toMatchObject({ indent: 36 });
  });

  it("writes styles and numbering definitions from the maps", async () => {
    const { editor, imp } = await importInto(await buildDocx({ body: '<w:p><w:pPr><w:pStyle w:val="ListNumbered"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>', styles: STYLES, numbering: NUMBERING }));
    const zip = await unzip(await exportFrom(editor, imp));
    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(styles).toMatch(/<w:style w:type="paragraph" w:default="1" w:styleId="Normal">/);
    expect(styles).toMatch(/w:styleId="ListNumbered"><w:name w:val="Numbered Steps"\/><w:basedOn w:val="Normal"\/>/);
    const numbering = await zip.file("word/numbering.xml")!.async("string");
    expect(numbering).toMatch(/<w:lvlText w:val="Step %1\)"\/>/);
    expect(numbering).toMatch(/<w:num w:numId="4"><w:abstractNumId w:val="2"\/><\/w:num>/);
  });
});

describe("docx import/export wiring", () => {
  it("creates imported comment threads on the server and re-points the marks", async () => {
    const { editor, imp } = await importInto(await buildDocx(richParts()));
    const calls: string[] = [];
    let seq = 0;
    const n = await importComments(
      editor,
      imp.comments,
      {
        add: async (body, quote, from, to) => {
          calls.push(`add ${JSON.stringify(body)} ${quote} ${to > from}`);
          return { id: `srv${++seq}` };
        },
        reply: async (parent, body) => calls.push(`reply ${parent} ${JSON.stringify(body)}`),
        resolve: async (id) => calls.push(`resolve ${id}`),
      },
      "Dan",
    );
    expect(n).toBe(2);
    expect(calls).toEqual(['add "Please check.\\n\\n— Carol" commented text true', 'reply srv1 "Checked."']);
    const marked = findNode(editor.getJSON(), (x) => x.type === "text" && x.text === "commented text")!;
    expect(marked.marks).toEqual([{ type: "commentMark", attrs: { commentId: "srv1" } }]);
  });

  it("anchors server comments without marks from their stored range on export", async () => {
    const editor = makeEditor("<p>Hello brave new world</p>");
    const input = collectDocxInput(editor, {
      comments: [
        { id: "c1", author_name: "Eve", body: "Nice", created_at: "2026-03-01T00:00:00Z", resolved: true, anchor_from: 7, anchor_to: 12, replies: [] },
      ],
    });
    const { imp, editor: back } = await importInto(await writeDocx(input));
    expect(imp.comments).toEqual([{ id: "docx-c0", author: "Eve", date: "2026-03-01T00:00:00Z", text: "Nice", resolved: true }]);
    const marked = findNode(back.getJSON(), (x) => x.type === "text" && x.text === "brave")!;
    expect(marked.marks).toEqual([{ type: "commentMark", attrs: { commentId: "docx-c0" } }]);
    // The live document is untouched.
    expect(JSON.stringify(editor.getJSON())).not.toMatch(/commentMark/);
  });

  it("falls back to the pandoc importer when the direct reader fails", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("<p>from pandoc</p>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const bad = new File([new TextEncoder().encode("not a zip")], "broken.docx");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await importFile(bad);
      warn.mockRestore();
      expect(res).toEqual({ kind: "html", html: "<p>from pandoc</p>" });
      expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/import\?from=docx/);

      const good = new File([(await buildDocx({ body: "<w:p><w:r><w:t>direct</w:t></w:r></w:p>" })) as BlobPart], "good.docx");
      const ok = await importFile(good);
      expect(ok.kind).toBe("docx");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hands a docx import to the editor through the seed channel", () => {
    const imp = { doc: { type: "doc", content: [] }, styles: {}, numbering: {}, header: null, footer: null, comments: [], page: null, warnings: [] };
    stashDocxSeed("d1", imp);
    expect(takeDocxSeed("d1")).toEqual(imp);
    expect(takeDocxSeed("d1")).toBeNull();
  });
});
