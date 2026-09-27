// Docs M7 object model: wrapping CSS, crop / resize / rotate arithmetic,
// z-order, names, HTML round trip and the editor operations (insert,
// block picture → anchored picture, arrange).
import { describe, expect, it } from "vitest";
import { NodeSelection } from "@tiptap/pm/state";
import { makeEditor } from "./harness";
import { PNG_1PX } from "./docx-fixture";
import { actualSize, angleFrom, arrange, cropImageBox, defaultName, fitSize, outerStyle, recrop, resizeBy } from "../objects";
import { allObjects, arrangeObject, insertChart, insertObject, insertShape, selectedObject, updateObjectAt } from "../objectNodes";

const SRC = `data:image/png;base64,${PNG_1PX}`;

describe("objects: geometry", () => {
  it("resizes from corners with the aspect ratio locked, edges freely", () => {
    expect(resizeBy({ w: 200, h: 100 }, "se", 100, 0, true)).toEqual({ w: 300, h: 150 });
    expect(resizeBy({ w: 200, h: 100 }, "nw", -20, -40, true)).toEqual({ w: 280, h: 140 });
    expect(resizeBy({ w: 200, h: 100 }, "se", 100, 0, false)).toEqual({ w: 300, h: 100 });
    expect(resizeBy({ w: 200, h: 100 }, "e", 50, 70, true)).toEqual({ w: 250, h: 100 });
    expect(resizeBy({ w: 200, h: 100 }, "n", 0, 30, true)).toEqual({ w: 200, h: 70 });
    expect(resizeBy({ w: 200, h: 100 }, "w", 500, 0, false)).toEqual({ w: 8, h: 100 });
  });

  it("crops by fractions of the source and keeps the scale when recropping", () => {
    expect(cropImageBox(80, 90, { cropL: 0.1, cropR: 0.1, cropT: 0.1 })).toEqual({ left: -10, top: -10, width: 100, height: 100 });
    const next = recrop({ width: 200, height: 100 }, { l: 0.5 });
    expect(next).toMatchObject({ cropL: 0.5, width: 100, height: 100 });
    expect(recrop({ width: 100, height: 100, cropL: 0.5 }, { l: 0 })).toMatchObject({ cropL: 0, width: 200 });
    expect(actualSize({ width: 400, height: 300 }, { cropL: 0.25, cropB: 0.5 })).toEqual({ width: 300, height: 150 });
  });

  it("fits a picture to the column and measures rotation", () => {
    expect(fitSize({ width: 1248, height: 600 }, 624)).toEqual({ width: 624, height: 300 });
    expect(fitSize({ width: 100, height: 50 }, 624)).toEqual({ width: 100, height: 50 });
    expect(angleFrom(0, 0, 10, 0)).toBe(90);
    expect(angleFrom(0, 0, 0, 10)).toBe(180);
    expect(angleFrom(0, 0, 10, -1, true)).toBe(90);
  });

  it("renders each wrapping style", () => {
    expect(outerStyle({ wrap: "inline", width: 10, height: 5 })).toMatchObject({ display: "inline-block", "vertical-align": "bottom" });
    expect(outerStyle({ wrap: "square", width: 100 })).toMatchObject({ float: "left", margin: "0 12px 12px 0" });
    expect(outerStyle({ wrap: "tight", hAlign: "right", dist: 4 })).toMatchObject({ float: "right", margin: "0 0 4px 4px" });
    expect(outerStyle({ wrap: "square", hAlign: "center", width: 100 })["margin-left"]).toBe("calc(50% - 50px)");
    expect(outerStyle({ wrap: "square", hRel: "page", hOffset: 150 })["margin-left"]).toBe("calc(150px - var(--doc-ml, 96px))");
    expect(outerStyle({ wrap: "topBottom", hAlign: "center" })).toMatchObject({ display: "block", "margin-left": "auto", "margin-right": "auto" });
    expect(outerStyle({ wrap: "behind", hOffset: 20, vOffset: 30 })).toMatchObject({ position: "absolute", "z-index": "-1", left: "20px", top: "30px" });
    expect(outerStyle({ wrap: "inFront", z: 3, hAlign: "right" })).toMatchObject({ position: "absolute", "z-index": "8", right: "0" });
  });

  it("arranges z-order and names objects", () => {
    const objs = [
      { id: 0, z: 1 },
      { id: 1, z: 2 },
      { id: 2, z: 3 },
    ];
    expect([...arrange(objs, 0, "front")]).toEqual([
      [1, 1],
      [2, 2],
      [0, 3],
    ]);
    expect(arrange(objs, 2, "backward").get(2)).toBe(2);
    expect(arrange(objs, 1, "back").get(1)).toBe(1);
    expect(defaultName("inlineImage", ["Picture 1", "Picture 2"])).toBe("Picture 3");
    expect(defaultName("textBox", [])).toBe("Text Box 1");
  });
});

describe("objects: editor", () => {
  it("inserts a picture inline at the caret and keeps its attributes through HTML", () => {
    const e = makeEditor("<p>Hello world</p>");
    e.commands.setTextSelection(6);
    const pos = insertObject(e, "inlineImage", { src: SRC, width: 50, height: 25, wrap: "square", hAlign: "right", cropL: 0.2, rotate: 30, alt: "Dot" })!;
    expect(e.state.doc.childCount).toBe(1);
    expect(e.state.doc.nodeAt(pos)!.type.name).toBe("inlineImage");
    expect(e.state.selection instanceof NodeSelection).toBe(true);
    const html = e.getHTML();
    expect(html).toContain('data-o-wrap="square"');
    const f = makeEditor(html);
    const obj = allObjects(f.state.doc)[0].node;
    expect(obj.attrs).toMatchObject({ src: SRC, width: 50, height: 25, wrap: "square", hAlign: "right", cropL: 0.2, rotate: 30, alt: "Dot", name: "Picture 1" });
  });

  it("anchors a pre-M7 block picture in the next paragraph when it floats", () => {
    const e = makeEditor(`<img src="${SRC}" width="80"><p>Wrapped paragraph</p>`);
    expect(e.state.doc.child(0).type.name).toBe("image");
    updateObjectAt(e.view, 0, { wrap: "square" });
    expect(e.state.doc.childCount).toBe(1);
    const p = e.state.doc.child(0);
    expect(p.type.name).toBe("paragraph");
    expect(p.firstChild!.type.name).toBe("inlineImage");
    expect(p.firstChild!.attrs).toMatchObject({ wrap: "square", width: 80, src: SRC });
    expect(p.textContent).toBe("Wrapped paragraph");
    expect(selectedObject(e.state)?.node.type.name).toBe("inlineImage");
    // Top-and-bottom stays a block picture.
    const g = makeEditor(`<img src="${SRC}"><p>x</p>`);
    updateObjectAt(g.view, 0, { wrap: "topBottom", hAlign: "center" });
    expect(g.state.doc.child(0).type.name).toBe("image");
    expect(g.state.doc.child(0).attrs.hAlign).toBe("center");
  });

  it("inserts shapes with text, text boxes and charts; arranges them", () => {
    const e = makeEditor("<p>Anchor</p>");
    e.commands.setTextSelection(2);
    const s = insertShape(e, "ellipse", { text: "Inside" })!;
    expect(e.state.doc.nodeAt(s)!.textContent).toBe("Inside");
    expect(e.state.doc.nodeAt(s)!.attrs).toMatchObject({ prst: "ellipse", wrap: "square", fill: "#4472c4" });
    const t = insertShape(e, "rect", { textBox: true, text: "Box" })!;
    expect(e.state.doc.nodeAt(t)!.type.name).toBe("textBox");
    const c = insertChart(e, { type: "pie", title: "P", data: [["", "S"], ["a", "1"], ["b", "2"]] })!;
    expect(JSON.parse(e.state.doc.nodeAt(c)!.attrs.chart).type).toBe("pie");
    const objs = allObjects(e.state.doc);
    expect(objs.map((o) => o.node.type.name)).toEqual(["shape", "textBox", "chart"]);
    arrangeObject(e.view, objs[0].pos, "front");
    const z = allObjects(e.state.doc).map((o) => o.node.attrs.z);
    expect(z[0]).toBeGreaterThan(Math.max(z[1], z[2]));
    // Typing inside a shape edits its text; the shape is the selected object.
    const inside = allObjects(e.state.doc)[0].pos + 2;
    e.commands.setTextSelection(inside);
    expect(selectedObject(e.state)?.node.type.name).toBe("shape");
    e.commands.insertContent("!");
    expect(allObjects(e.state.doc)[0].node.textContent).toBe("I!nside");
  });
});
