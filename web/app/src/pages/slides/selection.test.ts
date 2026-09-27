import { describe, it, expect } from "vitest";
import {
  clickSelect,
  primaryId,
  selectedElement,
  selectedElements,
  selectionAfterRemove,
} from "./selection";
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
  // Selecting a drawing puts it in the selection; Select(true) (replace)
  // makes it the only selected drawing, while an additive select
  // (Shift/Ctrl+click in Grown) keeps the others.
  it("oo:slide/js-api/api-drawing.js#Test: Select", () => {
    let sel = clickSelect([], "a", false);
    expect(selectedElements(slide, sel)).toEqual([a]);
    expect(selectedElement(slide, primaryId(sel))).toBe(a);
    sel = clickSelect(sel, "b", true);
    expect(selectedElements(slide, sel)).toEqual([a, b]);
    // Replace: only the new drawing stays selected.
    sel = clickSelect(sel, "b", false);
    expect(sel.includes("b")).toBe(true);
    expect(clickSelect(["a"], "b", false)).toEqual(["b"]);
  });

  // Unselecting removes the drawing from the selection (Grown: Ctrl+click it
  // again, press Esc or click the empty canvas; deleting it also clears it).
  it("oo:slide/js-api/api-drawing.js#Test: Unselect", () => {
    const sel = clickSelect(["a", "b"], "a", true);
    expect(sel).toEqual(["b"]);
    expect(selectedElements(slide, sel)).toEqual([b]);
    expect(selectionAfterRemove("a", "a")).toBeNull();
  });
});
