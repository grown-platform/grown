import { describe, it, expect } from "vitest";
import { importTitle } from "./importDeck";

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
