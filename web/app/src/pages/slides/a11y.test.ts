import { afterEach, describe, expect, it, vi } from "vitest";
import { newElement, newShape, type Slide, type SlideElement } from "./model";
import { elementKind, elementLabel, missingAltText, prefersReducedMotion, selectionAnnouncement, slideLabel } from "./a11y";
import { newChartElement } from "./chartElement";

const text = (t: string, over: Partial<SlideElement> = {}): SlideElement => ({ ...newElement("text"), text: t, ...over });

describe("accessible names", () => {
  it("names objects by kind plus alt text, text or name", () => {
    expect(elementLabel(text("Hello\nworld"))).toBe("Text box: Hello world");
    expect(elementLabel(text("Q3", { placeholder: { type: "title" } }))).toBe("Title: Q3");
    expect(elementLabel({ ...newElement("image"), alt: "A red kite" })).toBe("Picture: A red kite");
    expect(elementLabel(newElement("image"))).toBe("Picture");
    expect(elementLabel({ ...newShape("star5"), alt: "" })).toMatch(/^Shape: /);
    expect(elementKind(newChartElement("pie"))).toBe("Chart: pie");
    expect(elementLabel({ ...newElement("table"), table: { rows: 2, cols: 3, cells: [] } })).toBe("Table, 2 rows by 3 columns");
    expect(elementLabel({ ...newElement("rect"), type: "group", children: [newElement("rect"), newElement("rect")] })).toBe("Group of 2 objects");
    expect(elementLabel(text("x".repeat(100))).length).toBeLessThan(80);
  });

  it("names slides with their title and hidden state", () => {
    const s: Slide = { id: "s", background: "#fff", elements: [text("Welcome")], hidden: true };
    expect(slideLabel(s, 0, 4)).toBe("Slide 1 of 4: Welcome, hidden");
    expect(slideLabel({ ...s, elements: [], hidden: false }, 2, 4)).toBe("Slide 3 of 4");
  });

  it("announces selections", () => {
    expect(selectionAnnouncement([])).toBe("No object selected");
    expect(selectionAnnouncement([text("Hi", { locked: true })])).toBe("Text box: Hi, selected, locked");
    expect(selectionAnnouncement([text("a"), text("b")])).toBe("2 objects selected");
  });

  it("finds pictures, charts and clips without alt text (group members too)", () => {
    const img = { ...newElement("image"), id: "i" };
    const ok = { ...newElement("image"), id: "ok", alt: "fine" };
    const group: SlideElement = { ...newElement("rect"), type: "group", children: [img] };
    expect(missingAltText([{ id: "s", background: "#fff", elements: [group, ok, text("t")] }]).map((m) => m.el.id)).toEqual(["i"]);
  });
});

describe("prefersReducedMotion", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("reads the media query", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    expect(prefersReducedMotion()).toBe(true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
  });
});
