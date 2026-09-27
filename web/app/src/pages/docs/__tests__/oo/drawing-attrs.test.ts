// Port of OnlyOffice word/js-api/api-drawing.js (Docs M7): drawing flips,
// strokes, relative sizes, positions, names and selection, against Grown's
// object model (objects.ts) and editor operations (objectNodes.ts).
// Behaviour only. OnlyOffice builds a "cube" shape of 3212465 × 963295 EMU
// with a solid fill and adds it to a paragraph; so do we.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import JSZip from "jszip";
import { makeEditor } from "../harness";
import { createStroke, drawingJson, positionPatch, relSizePatch } from "../../objects";
import { allObjects, insertShape, selectObject, selectedObject, setObjectName, unselectObject, updateObjectAt } from "../../objectNodes";
import { collectDocxInput } from "../../docx/apply";
import { writeDocx } from "../../docx/write";

const EMU = 9525;

/** CreateShape("cube", 3212465, 963295, solid fill, stroke) + AddDrawing. */
function cube(e: Editor, prst = "cube", stroke = createStroke(0, null)): number {
  return insertShape(e, prst, {
    width: 3212465 / EMU,
    height: 963295 / EMU,
    attrs: { fill: "#ff6f3d", stroke: stroke.color ?? "none", strokeWidth: stroke.width, dash: stroke.dash },
  })!;
}

const attrsAt = (e: Editor, pos: number) => e.state.doc.nodeAt(pos)!.attrs;

async function documentXml(e: Editor): Promise<string> {
  const zip = await JSZip.loadAsync(await writeDocx(collectDocxInput(e, { title: "T" })));
  return zip.file("word/document.xml")!.async("string");
}

describe("OnlyOffice api-drawing", () => {
  it("oo:word/js-api/api-drawing.js#GetFlipH", () => {
    const e = makeEditor("<p></p>");
    const pos = cube(e);
    expect(attrsAt(e, pos).flipH).toBe(false);
    updateObjectAt(e.view, pos, { flipH: true });
    expect(attrsAt(e, pos).flipH).toBe(true);
  });

  it("oo:word/js-api/api-drawing.js#GetFlipV", () => {
    const e = makeEditor("<p></p>");
    const pos = cube(e);
    expect(attrsAt(e, pos).flipV).toBe(false);
    updateObjectAt(e.view, pos, { flipV: true });
    expect(attrsAt(e, pos).flipV).toBe(true);
  });

  it("oo:word/js-api/api-drawing.js#CreateStroke", async () => {
    const e = makeEditor("<p></p>");
    const stroke = createStroke(3200 * 2, null, "dash");
    // OnlyOffice reports its enum value 0 for "dash"; Grown keeps the
    // ST_PresetLineDashVal name.
    expect(stroke.dash).toBe("dash");
    expect(stroke.width).toBeCloseTo(6400 / EMU, 2);
    expect(stroke.color).toBeNull();
    const pos = cube(e, "cube", stroke);
    expect(attrsAt(e, pos).dash).toBe("dash");
    // No fill on the line: an invisible outline, still dashed in the file.
    const xml = await documentXml(e);
    expect(xml).toContain('<a:prstDash val="dash"/>');
    expect(xml).toMatch(/<a:ln w="\d+"><a:noFill\/>/);
  });

  it("oo:word/js-api/api-drawing.js#SetRelativeHeight", async () => {
    const e = makeEditor("<p></p>");
    const pos = cube(e);
    updateObjectAt(e.view, pos, relSizePatch("h", "page", 20));
    const json = drawingJson(attrsAt(e, pos));
    expect((json.sizeRelV as Record<string, unknown>).relativeFrom).toBe("page");
    expect((json.sizeRelV as Record<string, unknown>)["wp14:pctHeight"]).toBe(20);
    expect(await documentXml(e)).toContain('<wp14:sizeRelV relativeFrom="page"><wp14:pctHeight>20000</wp14:pctHeight></wp14:sizeRelV>');
  });

  it("oo:word/js-api/api-drawing.js#SetRelativeWidth", async () => {
    const e = makeEditor("<p></p>");
    const pos = cube(e);
    updateObjectAt(e.view, pos, relSizePatch("w", "page", 10));
    const json = drawingJson(attrsAt(e, pos));
    expect((json.sizeRelH as Record<string, unknown>).relativeFrom).toBe("page");
    expect((json.sizeRelH as Record<string, unknown>)["wp14:pctWidth"]).toBe(10);
    expect(await documentXml(e)).toContain('<wp14:sizeRelH relativeFrom="page"><wp14:pctWidth>10000</wp14:pctWidth></wp14:sizeRelH>');
  });

  it("oo:word/js-api/api-drawing.js#SetHorPosition", async () => {
    const e = makeEditor("<p></p>");
    const pos = cube(e);
    updateObjectAt(e.view, pos, positionPatch("h", "page", 10, true));
    const h = drawingJson(attrsAt(e, pos)).positionH as Record<string, unknown>;
    expect(h.relativeFrom).toBe("page");
    expect(h.posOffset).toBe(10);
    expect(h.percent).toBe(true);
    expect(await documentXml(e)).toContain('<wp:positionH relativeFrom="page"><wp14:pctPosHOffset>10000</wp14:pctPosHOffset></wp:positionH>');
  });

  it("oo:word/js-api/api-drawing.js#SetVerPosition", async () => {
    const e = makeEditor("<p></p>");
    const pos = cube(e);
    updateObjectAt(e.view, pos, positionPatch("v", "topMargin", 20, true));
    const v = drawingJson(attrsAt(e, pos)).positionV as Record<string, unknown>;
    expect(v.relativeFrom).toBe("topMargin");
    expect(v.posOffset).toBe(20);
    expect(v.percent).toBe(true);
    expect(await documentXml(e)).toContain('<wp:positionV relativeFrom="topMargin"><wp14:pctPosVOffset>20000</wp14:pctPosVOffset></wp:positionV>');
  });

  it("oo:word/js-api/api-drawing.js#GetName", () => {
    const e = makeEditor("<p>Text</p>");
    const pos = cube(e);
    const name = attrsAt(e, pos).name;
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("oo:word/js-api/api-drawing.js#SetName", () => {
    const e = makeEditor("<p></p>");
    const first = cube(e);
    expect(setObjectName(e.view, first, "TestShape")).toBe(true);
    expect(attrsAt(e, first).name).toBe("TestShape");
    expect(setObjectName(e.view, first, "")).toBe(false);
    expect(setObjectName(e.view, first, null)).toBe(false);
    expect(setObjectName(e.view, first, undefined)).toBe(false);
    expect(attrsAt(e, first).name).toBe("TestShape");

    // A second drawing in the same paragraph; a duplicate name moves.
    e.commands.setTextSelection(first + e.state.doc.nodeAt(first)!.nodeSize);
    const second = cube(e, "rect");
    const pos1 = () => allObjects(e.state.doc)[0].pos;
    expect(setObjectName(e.view, pos1(), "DuplicateName")).toBe(true);
    expect(attrsAt(e, pos1()).name).toBe("DuplicateName");
    expect(setObjectName(e.view, second, "DuplicateName")).toBe(true);
    expect(attrsAt(e, second).name).toBe("DuplicateName");
    const renamed = attrsAt(e, pos1()).name;
    expect(renamed).not.toBe("DuplicateName");
    expect(renamed.length).toBeGreaterThan(0);
  });

  it("oo:word/js-api/api-drawing.js#Unselect", () => {
    const e = makeEditor("<p></p>");
    const pos = cube(e);
    expect(selectObject(e.view, pos)).toBe(true);
    expect(selectedObject(e.state)?.pos).toBe(pos);
    expect(unselectObject(e.view)).toBe(true);
    expect(selectedObject(e.state)).toBeNull();
    expect(e.state.selection instanceof NodeSelection).toBe(false);
  });

  it("oo:word/js-api/api-drawing.js#Select", () => {
    const e = makeEditor("<p>before</p>");
    e.commands.setTextSelection(3);
    const pos = cube(e);
    unselectObject(e.view);
    expect(selectObject(e.view, pos)).toBe(true);
    const sel = e.state.selection as NodeSelection;
    expect(sel instanceof NodeSelection && sel.node.type.name).toBe("shape");
    expect(selectedObject(e.state)?.pos).toBe(pos);
  });
});
