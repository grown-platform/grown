import { describe, it, expect } from "vitest";
import { importTitle, slidesForDeck } from "./importDeck";

describe("importTitle", () => {
  it("prefers the document title", () => {
    expect(importTitle("q3.pptx", "Q3 review")).toBe("Q3 review");
  });
  it("ignores PowerPoint's placeholder title and blank titles", () => {
    expect(importTitle("Board deck.PPTX", "PowerPoint Presentation")).toBe(
      "Board deck",
    );
    expect(importTitle("plan.pptx", "  ")).toBe("plan");
  });
  it("falls back when the name is only an extension", () => {
    expect(importTitle(".pptx")).toBe("Imported presentation");
  });
});

describe("slidesForDeck (M7)", () => {
  it("scales imported slides to the open deck's size and drops unknown layouts", () => {
    const imported = {
      size: { w: 960, h: 720 },
      slides: [
        { id: "a", background: "#fff", layout: "obj", elements: [{ id: "r", type: "rect" as const, x: 0, y: 0, w: 960, h: 720 }] },
        { id: "b", background: "#fff", layout: "layout9", elements: [] },
      ],
    };
    const out = slidesForDeck(imported, { slides: [] });
    expect(out[0].elements[0]).toMatchObject({ x: 120, y: 0, w: 720, h: 540 });
    expect(out[0].layout).toBe("obj");
    expect(out[1].layout).toBeUndefined();
  });
});
