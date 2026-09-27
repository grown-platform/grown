import { describe, it, expect } from "vitest";
import {
  clickSelect,
  marqueeMerge,
  primaryId,
  pruneSelection,
  selectAll,
  selectedElements,
} from "./selection";
import { newElement, type Slide } from "./model";

const mk = (id: string) => ({ ...newElement("rect"), id });
const slide: Slide = { id: "s", background: "#fff", elements: [mk("a"), mk("b"), mk("c")] };

describe("multi-selection", () => {
  it("resolves ids in z-order and drops stale ones", () => {
    expect(selectedElements(slide, ["c", "zz", "a"]).map((e) => e.id)).toEqual(["a", "c"]);
    expect(selectedElements(undefined, ["a"])).toEqual([]);
  });
  it("primary is the last selected", () => {
    expect(primaryId(["a", "c"])).toBe("c");
    expect(primaryId([])).toBeNull();
  });
  it("plain click selects one; clicking a selected element keeps the group", () => {
    expect(clickSelect(["a"], "b", false)).toEqual(["b"]);
    expect(clickSelect(["a", "b"], "a", false)).toEqual(["b", "a"]);
  });
  it("Shift/Ctrl+click toggles", () => {
    expect(clickSelect(["a"], "b", true)).toEqual(["a", "b"]);
    expect(clickSelect(["a", "b"], "a", true)).toEqual(["b"]);
  });
  it("select all and marquee merge", () => {
    expect(selectAll(slide)).toEqual(["a", "b", "c"]);
    expect(selectAll(undefined)).toEqual([]);
    expect(marqueeMerge(["a"], ["b", "c"], false)).toEqual(["b", "c"]);
    expect(marqueeMerge(["a", "b"], ["b", "c"], true)).toEqual(["a", "b", "c"]);
  });
  it("prunes ids that left the slide, keeping identity otherwise", () => {
    const ids = ["a", "b"];
    expect(pruneSelection(slide, ids)).toBe(ids);
    expect(pruneSelection(slide, ["a", "gone"])).toEqual(["a"]);
  });
});
