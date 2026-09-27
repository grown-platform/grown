import { describe, it, expect } from "vitest";
import {
  clipboardText,
  decodeClipboard,
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
