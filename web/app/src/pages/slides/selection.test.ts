import { describe, it, expect } from "vitest";
import { isSelected, selectedElement, selectionAfterRemove } from "./selection";
import { newElement, type Slide } from "./model";

const a = { ...newElement("rect"), id: "a" };
const b = { ...newElement("ellipse"), id: "b" };
const slide: Slide = { id: "s", background: "#fff", elements: [a, b] };

describe("selectedElement", () => {
  it("resolves the selected id on the current slide", () => {
    expect(selectedElement(slide, "b")).toBe(b);
  });
  it("is undefined for no selection, a stale id, or no slide", () => {
    expect(selectedElement(slide, null)).toBeUndefined();
    expect(selectedElement(slide, "gone")).toBeUndefined();
    expect(selectedElement(undefined, "a")).toBeUndefined();
  });
});

describe("selectionAfterRemove", () => {
  it("clears only when the removed element was selected", () => {
    expect(selectionAfterRemove("a", "a")).toBeNull();
    expect(selectionAfterRemove("a", "b")).toBe("a");
    expect(selectionAfterRemove(null, "a")).toBeNull();
  });
});

describe("OnlyOffice parity", () => {
  // Selecting a drawing puts it in the selection. Grown has a single
  // selection (clicking an element sets selId; the canvas outlines it).
  it("oo:slide/js-api/api-drawing.js#Test: Select", () => {
    const selId: string | null = "a";
    expect(isSelected(selId, "a")).toBe(true);
    expect(selectedElement(slide, selId)).toBe(a);
    // Selecting another replaces the selection.
    const next: string | null = "b";
    expect(isSelected(next, "a")).toBe(false);
    expect(selectedElement(slide, next)).toBe(b);
  });

  // Unselecting removes the drawing from the selection (Grown: click on the
  // empty canvas sets selId to null; deleting the element also clears it).
  it("oo:slide/js-api/api-drawing.js#Test: Unselect", () => {
    expect(isSelected("a", "a")).toBe(true);
    const cleared: string | null = null;
    expect(isSelected(cleared, "a")).toBe(false);
    expect(selectedElement(slide, cleared)).toBeUndefined();
    expect(selectionAfterRemove("a", "a")).toBeNull();
  });
});
