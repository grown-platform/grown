import { describe, it, expect } from "vitest";
import {
  clipboardHtml,
  clipboardText,
  decodeClipboard,
  htmlToElements,
  internalFromHtml,
  encodeClipboard,
  htmlToText,
  pasteElements,
} from "./clipboard";
import { newElement, type SlideElement } from "./model";

const mk = (id: string, over: Partial<SlideElement> = {}): SlideElement => ({ ...newElement("rect"), id, x: 10, y: 20, ...over });
const counter = () => {
  let n = 0;
  return () => `p${++n}`;
};

describe("clipboard payload", () => {
  it("round-trips elements, including groups", () => {
    const g: SlideElement = { ...mk("g"), type: "group", children: [mk("a"), mk("b")] };
    expect(decodeClipboard(encodeClipboard([g, mk("c")]))).toEqual([g, mk("c")]);
  });
  it("rejects foreign or malformed data", () => {
    for (const s of [null, "", "hello", "{}", '{"grownSlides":1,"elements":[]}', '{"grownSlides":1,"elements":[{"id":"a"}]}', '{"grownSlides":2,"elements":[]}'])
      expect(decodeClipboard(s)).toBeNull();
  });
  it("plain-text flavour has the element text", () => {
    const t = { ...newElement("text"), id: "t", text: "Hi" };
    const g: SlideElement = { ...mk("g"), type: "group", children: [{ ...t, text: "In group" }] };
    expect(clipboardText([t, mk("r"), g])).toBe("Hi\nIn group");
  });
  it("htmlToText keeps line breaks and decodes entities", () => {
    expect(htmlToText("<p>a &amp; b</p><div>c<br>d</div><script>x</script>")).toBe("a & b\nc\nd");
  });
});

describe("OnlyOffice parity: copy/paste", () => {
  // Pasting plain text gives a new text box holding it.
  it("oo:slide/copypaste/copy-paste-tests.js#Test: callback tests paste plain text", () => {
    const [el] = pasteElements({ text: "test" }, counter());
    expect(el.type).toBe("text");
    expect(el.text).toBe("test");
    expect(pasteElements({ text: "   " })).toEqual([]);
  });

  // Pasting HTML gives a text box with the HTML's text.
  it("oo:slide/copypaste/copy-paste-tests.js#Test: callback tests paste HTML", () => {
    const [el] = pasteElements({ html: "<div>test HTML content</div>", text: "ignored" }, counter());
    expect(el.text).toBe("test HTML content");
  });

  // Pasting the internal format restores the copied elements under new ids,
  // offset like a duplicate; an empty internal payload pastes nothing.
  it("oo:slide/copypaste/copy-paste-tests.js#Test: callback tests paste Internal format", () => {
    const src = [mk("a"), { ...mk("g"), type: "group" as const, children: [mk("k")] }];
    const out = pasteElements({ internal: encodeClipboard(src), text: "x" }, counter());
    expect(out.map((e) => e.id)).toEqual(["p1", "p2"]);
    expect(out[1].children![0].id).toBe("p3");
    expect([out[0].x, out[0].y]).toEqual([26, 36]);
    expect(pasteElements({ internal: "" })).toEqual([]);
  });
});

describe("HTML clipboard (to and from Docs, between decks)", () => {
  const text = (over: Partial<SlideElement>): SlideElement => ({ ...newElement("text"), id: "t", ...over });

  it("copies text boxes as paragraphs with inline formatting and links", () => {
    const el = text({ text: "Bold link", runs: [{ text: "Bold", bold: true }, { text: " " }, { text: "link", url: "https://example.com/" }] });
    const html = clipboardHtml([el]);
    expect(html).toContain("<p><strong>Bold</strong> <a href=\"https://example.com/\">link</a></p>");
  });

  it("copies lists as nested <ul>/<ol>, tables as <table>, pictures as <img>", () => {
    const list = text({ text: "a\nb\nc", list: "number", paras: [{}, { level: 1 }, {}] });
    const tbl: SlideElement = { ...newElement("table"), id: "tb", table: { rows: 1, cols: 2, cells: [["x", "y"]] } };
    const img: SlideElement = { ...newElement("image", "data:image/png;base64,AAAA"), id: "i", alt: "Logo" };
    const html = clipboardHtml([list, tbl, img]);
    expect(html).toContain("<ol><li><p>a</p></li><ol><li><p>b</p></li></ol><li><p>c</p></li></ol>");
    expect(html).toContain("<table><tr><td>x</td><td>y</td></tr></table>");
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="Logo"');
  });

  it("carries the internal payload inside the HTML (browsers without custom types)", () => {
    const src = [mk("a", { text: "é ü" })];
    const html = clipboardHtml(src);
    expect(decodeClipboard(internalFromHtml(html))).toEqual(src);
    const out = pasteElements({ html, text: "whatever" }, counter());
    expect(out.map((e) => e.id)).toEqual(["p1"]);
    expect(out[0].type).toBe("rect");
  });

  it("pastes rich HTML from Docs as one text box with runs", () => {
    const html = '<meta charset="utf-8"><p>Plain <strong>bold</strong> <em>it</em> <a href="https://grown.haus">site</a></p><p><span style="color: rgb(255, 0, 0)">red</span> <s>gone</s> x<sup>2</sup></p>';
    const [el] = htmlToElements(html, counter());
    expect(el.type).toBe("text");
    expect(el.text).toBe("Plain bold it site\nred gone x2");
    expect(el.runs).toEqual([
      { text: "Plain " },
      { text: "bold", bold: true },
      { text: " " },
      { text: "it", italic: true },
      { text: " " },
      { text: "site", url: "https://grown.haus" },
      { text: "\n" },
      { text: "red", color: "#ff0000" },
      { text: " " },
      { text: "gone", strike: true },
      { text: " x" },
      { text: "2", baseline: "super" },
    ].reduce<{ text: string }[]>((acc, r) => {
      // Paragraph breaks join the run before them.
      if (r.text === "\n") acc[acc.length - 1] = { ...acc[acc.length - 1], text: acc[acc.length - 1].text + "\n" };
      else acc.push(r);
      return acc;
    }, []));
  });

  it("pastes lists with levels, tables and lone pictures", () => {
    const [list] = htmlToElements("<ul><li><p>one</p></li><li><p>two</p><ul><li><p>deep</p></li></ul></li></ul>", counter());
    expect(list.text).toBe("one\ntwo\ndeep");
    expect(list.list).toBe("bullet");
    expect(list.paras).toEqual([{}, {}, { level: 1 }]);
    const [tbl] = htmlToElements("<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td></tr></tbody></table>", counter());
    expect(tbl.type).toBe("table");
    expect(tbl.table).toEqual({ rows: 2, cols: 2, cells: [["A", "B"], ["1", ""]] });
    const pics = htmlToElements('<img src="data:image/png;base64,AAAA" alt="Chart"><img src="javascript:x">', counter());
    expect(pics).toHaveLength(1);
    expect(pics[0]).toMatchObject({ type: "image", src: "data:image/png;base64,AAAA", alt: "Chart" });
  });

  it("round-trips a Slides copy through HTML without the internal payload", () => {
    const el = text({ text: "Hi there\nnext", runs: [{ text: "Hi", bold: true }, { text: " there\nnext" }] });
    const html = clipboardHtml([el]).replace(/ data-grown-slides="[^"]*"/, "");
    const [back] = htmlToElements(html, counter());
    expect(back.text).toBe("Hi there\nnext");
    expect(back.runs?.[0]).toEqual({ text: "Hi", bold: true });
  });
});
