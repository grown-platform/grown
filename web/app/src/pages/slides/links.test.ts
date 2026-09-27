import { describe, it, expect } from "vitest";
import type { Slide } from "./model";
import {
  classifyLink,
  fromPpAction,
  linkLabel,
  parseSlideLink,
  resolveSlideLink,
  slideLink,
  slideTitle,
  toPpAction,
} from "./links";

const slide = (id: string, title = ""): Slide => ({
  id,
  background: "#fff",
  elements: title ? [{ id: `t-${id}`, type: "text", x: 0, y: 0, w: 1, h: 1, text: title }] : [],
});
const deck = [slide("a", "Intro"), slide("b"), slide("c", "Wrap up\nmore")];

describe("slide link targets", () => {
  it("round-trips the stored form", () => {
    for (const t of ["first", "last", "next", "prev"] as const) expect(parseSlideLink(slideLink(t))).toBe(t);
    expect(parseSlideLink(slideLink({ id: "b" }))).toEqual({ id: "b" });
    expect(parseSlideLink("https://example.com")).toBeNull();
    expect(parseSlideLink("#slide:")).toBeNull();
  });

  it("resolves first/last/next/prev/N from the current slide", () => {
    expect(resolveSlideLink("#slide:first", deck, 1)).toBe(0);
    expect(resolveSlideLink("#slide:last", deck, 0)).toBe(2);
    expect(resolveSlideLink("#slide:next", deck, 1)).toBe(2);
    expect(resolveSlideLink("#slide:next", deck, 2)).toBeNull();
    expect(resolveSlideLink("#slide:prev", deck, 0)).toBeNull();
    expect(resolveSlideLink("#slide:prev", deck, 2)).toBe(1);
    expect(resolveSlideLink("#slide:c", deck, 0)).toBe(2);
    expect(resolveSlideLink("#slide:gone", deck, 0)).toBeNull();
    expect(resolveSlideLink("https://x.org", deck, 0)).toBeNull();
  });

  // A run linked to ppaction://hlinkshowjump?jump=lastslide: following it
  // (Ctrl+click in the editor, click in the slideshow) shows the last slide.
  // Grown does not track a "visited" state for links.
  it("oo:slide/shortcuts/shortcuts.js#Check visit hyperlink", () => {
    const href = fromPpAction("ppaction://hlinkshowjump?jump=lastslide");
    expect(href).toBe("#slide:last");
    expect(resolveSlideLink(href!, [slide("s0"), slide("s1")], 0)).toBe(1);
  });

  it("maps pptx actions both ways", () => {
    expect(fromPpAction("ppaction://hlinkshowjump?jump=firstslide")).toBe("#slide:first");
    expect(fromPpAction("ppaction://hlinkshowjump?jump=nextslide")).toBe("#slide:next");
    expect(fromPpAction("ppaction://hlinkshowjump?jump=previousslide")).toBe("#slide:prev");
    expect(fromPpAction("ppaction://hlinkshowjump?jump=endshow")).toBeNull();
    expect(fromPpAction("ppaction://hlinksldjump", "b")).toBe("#slide:b");
    expect(fromPpAction("ppaction://hlinksldjump")).toBeNull();
    expect(fromPpAction("ppaction://macro?name=x")).toBeNull();
    expect(toPpAction("#slide:prev", deck)).toEqual({ action: "ppaction://hlinkshowjump?jump=previousslide" });
    expect(toPpAction("#slide:c", deck)).toEqual({ action: "ppaction://hlinksldjump", slideIndex: 2 });
    expect(toPpAction("#slide:zz", deck)).toBeNull();
    expect(toPpAction("https://example.com", deck)).toBeNull();
  });
});

describe("classifyLink / labels", () => {
  it("classifies dialog input through lib/urlType", () => {
    expect(classifyLink("example.com")).toEqual({ kind: "http", href: "https://example.com" });
    expect(classifyLink("me@example.com")).toEqual({ kind: "email", href: "mailto:me@example.com" });
    expect(classifyLink("#slide:last")).toEqual({ kind: "slide", href: "#slide:last" });
    expect(classifyLink("javascript:alert(1)").kind).toBe("invalid");
    expect(classifyLink("file:///etc/passwd").kind).toBe("unsafe");
  });

  it("labels links and slides", () => {
    expect(linkLabel("#slide:next", deck)).toBe("Next slide");
    expect(linkLabel("#slide:c", deck)).toBe("Slide 3");
    expect(linkLabel("mailto:a@b.co", deck)).toBe("a@b.co");
    expect(slideTitle(deck[2])).toBe("Wrap up");
    expect(slideTitle(deck[1])).toBe("");
  });
});
