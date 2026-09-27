import { describe, it, expect } from "vitest";
import {
  defaultElementName,
  elementName,
  findElementsByName,
  setElementName,
} from "./elementOps";
import { newElement, type Slide, type SlideElement } from "./model";

const mk = (id: string, over: Partial<SlideElement> = {}): SlideElement => ({ ...newElement("rect"), id, ...over });

describe("element names", () => {
  it("default names come from the type and are unique", () => {
    const els = [mk("a", { name: "Rectangle 3" }), mk("b")];
    expect(defaultElementName(mk("c"), els)).toBe("Rectangle 4");
    expect(defaultElementName({ ...newElement("ellipse"), id: "e" }, els)).toBe("Oval 3");
  });
  it("names inside groups are found and renamed", () => {
    const g: SlideElement = { ...mk("g"), type: "group", children: [mk("k", { name: "Kid" })] };
    const r = setElementName([g, mk("b")], "b", "Kid");
    expect(r.ok).toBe(true);
    expect(r.elements[0].children![0].name).not.toBe("Kid");
  });
});

describe("OnlyOffice parity: drawing names", () => {
  // A drawing always has a non-empty name, even before one is set.
  it("oo:slide/js-api/api-drawing.js#Test: GetName", () => {
    const els = [mk("a")];
    const name = elementName(els[0], els);
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  // Setting a name succeeds; empty/null/undefined are rejected. Giving a
  // second drawing an existing name moves the name to it and the first one
  // gets a new default name.
  it("oo:slide/js-api/api-drawing.js#Test: SetName", () => {
    let els = [mk("d1")];
    let r = setElementName(els, "d1", "TestShape");
    expect(r.ok).toBe(true);
    expect(r.elements[0].name).toBe("TestShape");
    for (const bad of ["", null, undefined]) expect(setElementName(r.elements, "d1", bad).ok).toBe(false);

    els = [...r.elements, mk("d2")];
    r = setElementName(els, "d1", "DuplicateName");
    const first = r.elements[0].name;
    expect(first).toBe("DuplicateName");
    r = setElementName(r.elements, "d2", "DuplicateName");
    expect(r.elements[1].name).toBe("DuplicateName");
    expect(r.elements[0].name).not.toBe("DuplicateName");
    expect(r.elements[0].name).toBeTruthy();
  });
});

describe("OnlyOffice parity: presentation", () => {
  // GetDrawingsByName filters the drawings by a list of names.
  it("oo:slide/js-api/api-presentation.js#Test: GetDrawingsByName", () => {
    const slides: Slide[] = [
      { id: "s", background: "#fff", elements: [mk("a", { name: "Shape1" }), mk("b", { name: "Shape2" }), mk("c")] },
    ];
    expect(findElementsByName(slides, ["Shape1", "Shape2"])).toHaveLength(2);
    const one = findElementsByName(slides, ["Shape1"]);
    expect(one).toHaveLength(1);
    expect(one[0].name).toBe("Shape1");
  });
});
