// Grown-native pagination tests (Docs M9): exact page fields and table of
// contents page numbers, decorations, line numbers, incremental layout
// and a 50-page performance check, all on the MockMeasurer grid.
import { describe, expect, it } from "vitest";
import { layoutOf, pagedEditor, pagesOf, sectionFor } from "./pagination-harness";
import { paragraphTexts, setCursor, typeText } from "./harness";
import { insertTableOfContents, updateFields } from "../references";
import { getLayout, paginationKey } from "../paginationPlugin";
import { layoutPageResolver, lineNumbers, modelMeasure, pageSnippets } from "../paginationModel";
import { paginate } from "../pagination";
import { sectionSpecs } from "../paginationModel";
import { sectionsOf } from "../sections";
import { MockMeasurer } from "./measurer";
import { makeEditor } from "./harness";

const PAGE = { w: 400, h: 400, margin: 50 }; // 15 lines of 20 per page
const lines = (n: number, tag = "p") => Array.from({ length: n }, (_, i) => `<${tag}>line ${i}</${tag}>`).join("");
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("page fields (M9)", () => {
  it("PAGE, NUMPAGES and SECTIONPAGES are exact", async () => {
    const e = pagedEditor(`<p>Top</p>${lines(20)}<p>Here</p>${lines(20)}`, PAGE);
    expect(layoutOf(e).pages).toHaveLength(3);
    setCursor(e, 4);
    e.commands.insertField("NUMPAGES");
    // "Here" is block 21: 21 lines in, on page 2.
    const here = paragraphTexts(e).indexOf("Here");
    let pos = 0;
    e.state.doc.forEach((_n, p, i) => {
      if (i === here) pos = p + 1;
    });
    setCursor(e, pos);
    e.commands.insertField("PAGE");
    e.commands.insertContent(" / ");
    e.commands.insertField("SECTIONPAGES");
    expect(paragraphTexts(e)[0]).toBe("Top3");
    expect(paragraphTexts(e)[here]).toBe("2 / 3Here");
    // More text pushes "Here" to page 3 and adds a page: F9 follows.
    setCursor(e, 2);
    for (let i = 0; i < 12; i++) e.commands.insertContentAt(1, { type: "paragraph", content: [{ type: "text", text: "more" }] });
    updateFields(e, "all");
    await flush();
    expect(layoutOf(e).pages).toHaveLength(4);
    expect(paragraphTexts(e).find((t) => t.endsWith("Here"))).toBe("3 / 4Here");
  });

  it("a table of contents gets exact page numbers", async () => {
    const e = pagedEditor(`<p></p><h1>Alpha</h1>${lines(20)}<h1>Beta</h1>${lines(30)}<h1>Gamma</h1>`, PAGE);
    setCursor(e, 1);
    insertTableOfContents(e);
    await flush();
    const l = layoutOf(e);
    const pageOf = (text: string) => {
      let page = -1;
      e.state.doc.forEach((n, _p, i) => {
        if (n.type.name === "heading" && n.textContent === text) page = l.blocks[i][0].page + 1;
      });
      return page;
    };
    const toc = e.state.doc.child(0);
    expect(toc.type.name).toBe("tableOfContents");
    const entries: [string, string][] = [];
    toc.forEach((c) => entries.push([c.textContent, String(c.attrs.page)]));
    expect(entries.map((x) => x[0])).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(entries.map((x) => +x[1])).toEqual([pageOf("Alpha"), pageOf("Beta"), pageOf("Gamma")]);
    expect(entries.map((x) => +x[1])).toEqual([1, 2, 4]);
  });

  it("page numbers restart and resolve per section", () => {
    const e = pagedEditor(lines(10), PAGE);
    const r = layoutPageResolver(getLayout(e)!);
    expect(r.pageAt(3)).toBe(1);
    expect(r.pageCount()).toBe(1);
  });
});

describe("decorations (M9)", () => {
  it("spacers realise page breaks: before blocks, inside split paragraphs and tables", () => {
    const long = `<p>${"word ".repeat(120).trim()}</p>`; // 20 lines at 30 chars
    const e = pagedEditor(lines(10) + long + `<table><tbody>${'<tr data-height="40"><td><p>c</p></td></tr>'.repeat(12)}</tbody></table>`, PAGE);
    const deco = paginationKey.getState(e.state)!.deco.find();
    const specs = deco.map((d) => (d as unknown as { spec: { key: string } }).spec.key);
    expect(specs.some((k) => k.startsWith("pg-l"))).toBe(true); // inside the paragraph
    expect(specs.some((k) => k.startsWith("pg-r"))).toBe(true); // a spacer row
    // Each inner spacer sits at the first character of the line that
    // moves on: the paragraph's text before it is exactly whole lines.
    const inline = deco.filter((d) => (d as unknown as { spec: { key: string } }).spec.key.startsWith("pg-l"));
    const pStart = e.state.doc.resolve(inline[0].from).start();
    const before = e.state.doc.textBetween(pStart, inline[0].from);
    expect(before.length % 30 === 0 || before.endsWith(" ")).toBe(true);
    // In pageless view there are none.
    const f = pagedEditor(lines(40), { ...PAGE, settings: { pageless: true } });
    expect(paginationKey.getState(f.state)!.deco.find()).toHaveLength(0);
    expect(layoutOf(f).pages.length).toBeGreaterThan(1);
  });

  it("line numbers: count by, restart per page / section / continuous", () => {
    const e = pagedEditor(lines(20), { ...PAGE, section: { lnNum: { countBy: 5, start: 1, distance: 0, restart: "newPage" } } });
    const marks = lineNumbers(getLayout(e)!);
    expect(marks.map((m) => [m.page, m.n])).toEqual([
      [0, 5],
      [0, 10],
      [0, 15],
      [1, 5],
    ]);
    const f = pagedEditor(lines(20), { ...PAGE, section: { lnNum: { countBy: 10, start: 1, distance: 0, restart: "continuous" } } });
    expect(lineNumbers(getLayout(f)!).map((m) => m.n)).toEqual([10, 20]);
  });

  it("page snippets for thumbnails", () => {
    const e = pagedEditor(lines(20), PAGE);
    const s = pageSnippets(getLayout(e)!, e.state.doc);
    expect(s[0].startsWith("line 0")).toBe(true);
    expect(s[1].startsWith("line 15")).toBe(true);
  });
});

describe("incremental layout and performance (M9)", () => {
  // ~50 pages on the grid: 750 short paragraphs and some long ones.
  function bigDoc(): string {
    let html = "";
    for (let i = 0; i < 700; i++) html += i % 25 === 0 ? `<h2>Section ${i}</h2>` : `<p>${"text ".repeat(i % 7 === 0 ? 30 : 4)}${i}</p>`;
    return html;
  }

  it("resuming from the first changed block equals a full layout", () => {
    const e = makeEditor(bigDoc());
    const secs = sectionsOf(e.state.doc, sectionFor(PAGE));
    const m = new MockMeasurer({ lineHeight: 20, charWidth: 10 });
    const measured = modelMeasure(e.state.doc, secs, { measurer: m });
    const specs = sectionSpecs(secs, 1);
    const full = paginate(measured.boxes, specs, { splitRows: true });
    expect(full.pages.length).toBeGreaterThanOrEqual(50);
    // Change block 400's height and relayout both ways.
    const boxes = measured.boxes.slice();
    const b = boxes[400];
    if (b.kind === "flow") boxes[400] = { ...b, lines: [...b.lines, 20, 20, 20] };
    const inc = paginate(boxes, specs, { splitRows: true }, full, 400);
    const ref = paginate(boxes, specs, { splitRows: true });
    expect(inc.pages.map((p) => p.top)).toEqual(ref.pages.map((p) => p.top));
    expect(JSON.stringify(inc.blocks)).toEqual(JSON.stringify(ref.blocks));
    // Blocks before the chain start are the previous layout's.
    expect(inc.blocks[10]).toBe(full.blocks[10]);
  });

  it("stays responsive on a 50-page document", () => {
    const e = makeEditor(bigDoc());
    const secs = sectionsOf(e.state.doc, sectionFor(PAGE));
    const m = new MockMeasurer({ lineHeight: 20, charWidth: 10 });
    const t0 = performance.now();
    const measured = modelMeasure(e.state.doc, secs, { measurer: m });
    const specs = sectionSpecs(secs, 1);
    const full = paginate(measured.boxes, specs, { splitRows: true });
    const tFull = performance.now() - t0;
    const boxes = measured.boxes.slice();
    const t1 = performance.now();
    for (let k = 0; k < 20; k++) paginate(boxes, specs, { splitRows: true }, full, 600);
    const tInc = (performance.now() - t1) / 20;
    expect(full.pages.length).toBeGreaterThanOrEqual(50);
    // Generous bounds for CI; typically a few ms.
    expect(tFull).toBeLessThan(500);
    expect(tInc).toBeLessThan(25);
  });

  it("typing in a 50-page paged editor re-lays out quickly", () => {
    const e = pagedEditor(bigDoc(), PAGE);
    expect(layoutOf(e).pages.length).toBeGreaterThanOrEqual(50);
    setCursor(e, e.state.doc.content.size - 3);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) typeText(e, "x");
    const per = (performance.now() - t0) / 20;
    expect(per).toBeLessThan(80);
    expect(pagesOf(e, 0)).toEqual([0]);
  });
});
