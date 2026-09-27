// Docs M13 (Grown-native): statistics, drop cap (+ DOCX), symbols, text
// from file, non-printing characters, the scripting API's safety rails,
// the status bar's page in view.
import { beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { makeEditor, paragraphTexts, selectText, setCursor, typeText } from "./harness";
import { buildDocx } from "./docx-fixture";
import { docStats } from "../docStats";
import { readDocx } from "../docx/read";
import { writeDocx } from "../docx/write";
import { applyDocxImport, collectDocxInput } from "../docx/apply";
import { blockChars, insertSymbol, insertTextFromFile, loadRecentSymbols, SYMBOL_BLOCKS } from "../InsertDialogs";
import { isNonPrinting } from "../viewModes";
import { API_METHODS, callApi, createDocApi, isPlainJson, runMacro } from "../api/docApi";
import { handleApiMessage } from "../api/host";
import { scriptingEnabled } from "../api/flag";
import { visiblePage } from "../PagesUI";

// A plain in-memory localStorage (the test environment's may be partial).
beforeAll(() => {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  });
});

describe("document statistics", () => {
  it("counts like Word: words, characters with / without spaces, paragraphs", () => {
    const e = makeEditor("<p>Hello, well-known world.</p><p></p><p>e.g. two</p>", { cursor: "end" });
    e.commands.insertContent({ type: "footnote", attrs: { id: "n1", content: "Note text here" } });
    const s = docStats(e.state.doc, { pages: 3, lines: 7 });
    expect(s).toMatchObject({ pages: 3, words: 5, paragraphs: 2, lines: 7 });
    expect(s.charsWithSpaces).toBe("Hello, well-known world.".length + "e.g. two".length);
    expect(s.chars).toBe("Hello,well-knownworld.".length + "e.g.two".length);
    expect(docStats(e.state.doc, { includeNotes: true }).words).toBe(8);
    selectText(e, "well-known world");
    const { from, to } = e.state.selection;
    expect(docStats(e.state.doc, { from, to }).words).toBe(2);
  });
});

describe("drop cap", () => {
  it("renders as paragraph attributes and round-trips through DOCX as Word's framed letter", async () => {
    const e = makeEditor("<p>Once upon a time there was a document.</p><p>Second.</p>");
    setCursor(e, 3);
    e.commands.setDropCap({ kind: "drop", lines: 3 });
    const p = e.view.dom.querySelector("p")!;
    expect(p.getAttribute("data-drop-cap")).toBe("drop");
    expect(p.getAttribute("style")).toMatch(/--dc-lines:\s*3/);
    const input = collectDocxInput(e, { title: "t" });
    input.now = new Date("2026-09-27T00:00:00Z");
    const bytes = await writeDocx(input);
    const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<w:framePr w:dropCap="drop" w:lines="3"[^>]*\/>/);
    expect(xml).toContain('<w:t xml:space="preserve">O</w:t>');
    expect(xml).toContain("nce upon a time");
    const back = makeEditor("<p></p>");
    applyDocxImport(back, await readDocx(bytes));
    expect(paragraphTexts(back)).toEqual(["Once upon a time there was a document.", "Second."]);
    const attrs = back.state.doc.firstChild!.attrs;
    expect(attrs).toMatchObject({ dropCap: "drop", dropCapLines: 3 });
    e.commands.setDropCap(null);
    expect(e.view.dom.querySelector("p")!.hasAttribute("data-drop-cap")).toBe(false);
  });

  it("reads a Word margin drop cap", async () => {
    const body =
      '<w:p><w:pPr><w:framePr w:dropCap="margin" w:lines="2" w:wrap="around" w:vAnchor="text" w:hAnchor="page"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="72"/></w:rPr><w:t>T</w:t></w:r></w:p>' +
      "<w:p><w:r><w:t>he rest.</w:t></w:r></w:p>";
    const e = makeEditor("<p></p>");
    applyDocxImport(e, await readDocx(await buildDocx({ body })));
    expect(paragraphTexts(e)).toEqual(["The rest."]);
    expect(e.state.doc.firstChild!.attrs).toMatchObject({ dropCap: "margin", dropCapLines: 2, dropCapFont: "Georgia" });
  });
});

describe("symbols", () => {
  it("lists assigned characters of a block and inserts in a chosen font, remembering recent ones", () => {
    const arrows = SYMBOL_BLOCKS.find((b) => b.name === "Arrows")!;
    const chars = blockChars(arrows.from, arrows.to);
    expect(chars[0]).toBe("←");
    expect(blockChars(0x0378, 0x037a)).toEqual(["ͺ"]); // U+0378/0379 unassigned
    const e = makeEditor("<p>x</p>", { cursor: "end" });
    insertSymbol(e, "→", "Noto Sans");
    insertSymbol(e, "©", null);
    // The symbol takes the chosen font; what follows keeps typing in it.
    expect(e.getHTML()).toMatch(/<span style="font-family: Noto Sans;?">→©<\/span>/);
    expect(loadRecentSymbols().slice(0, 2)).toEqual(["©", "→"]);
  });
});

describe("text from file", () => {
  it("inserts a .txt file as paragraphs and a .docx file's content with its styles", async () => {
    const e = makeEditor("<p>Start</p>", { cursor: "end" });
    await insertTextFromFile(e, new File(["one\ntwo"], "notes.txt", { type: "text/plain" }));
    expect(paragraphTexts(e)).toContain("two");
    const docx = await buildDocx({ body: '<w:p><w:pPr><w:pStyle w:val="Callout"/></w:pPr><w:r><w:t>From Word</w:t></w:r></w:p>', styles: `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:customStyle="1" w:styleId="Callout"><w:name w:val="Callout Box"/><w:rPr><w:i/></w:rPr></w:style></w:styles>` });
    await insertTextFromFile(e, new File([docx as BlobPart], "part.docx"));
    expect(paragraphTexts(e)).toContain("From Word");
    expect(e.getHTML()).toContain("Callout");
  });
});

describe("non-printing characters", () => {
  it("marks spaces, no-break spaces and paragraph ends, and follows edits", () => {
    const e = makeEditor("<p>a b c</p><p>two words</p>", { cursor: "end" });
    e.commands.setNonPrinting(true);
    expect(isNonPrinting(e)).toBe(true);
    const dom = e.view.dom;
    expect(dom.querySelectorAll(".np-space").length).toBe(2);
    expect(dom.querySelectorAll(".np-nbsp").length).toBe(1);
    expect(dom.querySelectorAll(".np-para").length).toBe(2);
    typeText(e, " more text");
    expect(dom.querySelectorAll(".np-space").length).toBe(4);
    e.commands.setNonPrinting(false);
    expect(dom.querySelectorAll(".np-space").length).toBe(0);
  });
});

describe("scripting API (docs/api)", () => {
  it("runs JSON macros through the method table only", () => {
    const e = makeEditor("<p></p>", { cursor: "end" });
    const api = createDocApi({ editor: e });
    const out = runMacro(api, JSON.stringify([{ method: "AddText", args: ["Hello world."] }, { method: "GetText" }, { method: "HexColor", args: ["#336699"] }]));
    expect(out[1]).toContain("Hello world.");
    expect(out[2]).toEqual({ type: "rgba", r: 51, g: 102, b: 153, a: 255 });
    expect(() => callApi(api, "constructor", [])).toThrow(/Unknown API method/);
    expect(() => callApi(api, "eval" as never, ["1"])).toThrow(/Unknown API method/);
    expect(() => callApi(api, "AddText", [{ toString: () => "x" } as never])).toThrow(/plain JSON/);
    expect(isPlainJson([1, "a", { b: [null, true] }])).toBe(true);
    expect(isPlainJson([() => 1])).toBe(false);
    expect(isPlainJson([new Date()])).toBe(false);
    expect(API_METHODS).not.toContain("eval");
  });

  it("answers plugin messages with JSON replies", () => {
    const e = makeEditor("<p>Some text</p>");
    const api = createDocApi({ editor: e });
    expect(handleApiMessage(api, { grownApi: 1, id: 7, method: "GetText", args: [] })).toMatchObject({ id: 7, result: expect.stringContaining("Some text") });
    expect(handleApiMessage(api, { grownApi: 1, id: 8, method: "Nope" })).toMatchObject({ id: 8, error: expect.stringContaining("Unknown") });
    expect(handleApiMessage(api, { hello: 1 })).toBeNull();
  });

  it("is off unless the docs-api flag is set", () => {
    localStorage.removeItem("grown.flags");
    expect(scriptingEnabled()).toBe(false);
    localStorage.setItem("grown.flags", "other,docs-api");
    expect(scriptingEnabled()).toBe(true);
    localStorage.removeItem("grown.flags");
  });
});

describe("status bar page", () => {
  it("is the page sheet covering most of the viewport", () => {
    const root = document.createElement("div");
    root.setAttribute("data-testid", "doc-editor");
    const inner = document.createElement("div");
    root.appendChild(inner);
    const tops = [-1500, -500, 400];
    tops.forEach((top, i) => {
      const p = document.createElement("div");
      p.className = "doc-page";
      p.dataset.page = String(i + 1);
      p.getBoundingClientRect = () => ({ top, bottom: top + 1000, left: 0, right: 800, width: 800, height: 1000, x: 0, y: top, toJSON: () => ({}) });
      root.appendChild(p);
    });
    document.body.appendChild(root);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    expect(visiblePage(inner)).toBe(2); // page 2 shows 500px, page 3 400px
    root.remove();
    expect(visiblePage(document.createElement("div"))).toBe(0);
  });
});
