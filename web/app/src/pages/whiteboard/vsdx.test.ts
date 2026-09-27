import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseVsdx,
  layoutVsdxPages,
  visioColor,
  PX_PER_INCH,
  type VsdxSkeleton,
} from "./vsdx";
import {
  buildVsdx,
  cell,
  xform,
  geom,
  rectGeom,
  ellipseGeom,
  shape,
} from "./vsdxFixture";

const PX = PX_PER_INCH;

async function onePage(shapes: string, connects?: string, extra = {}) {
  const bytes = await buildVsdx({ pages: [{ shapes, connects }], ...extra });
  const doc = await parseVsdx(bytes);
  return doc.pages[0].elements;
}
const byId = (els: VsdxSkeleton[], id: string) => els.find((e) => e.id === id)!;
const close = (a: number, b: number, d = 0.5) =>
  expect(Math.abs(a - b)).toBeLessThan(d);

describe("vsdx reader", () => {
  it("oo:visio/serialize/sax-serialize.js#Test api.OpenDocumentFromZip", async () => {
    const bytes = await buildVsdx({
      pages: [{ name: "Main", width: 11, height: 8.5, shapes: "" }],
    });
    const doc = await parseVsdx(bytes);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].name).toBe("Main");
    expect(doc.pages[0].width).toBe(11 * PX);
    expect(doc.pages[0].height).toBe(8.5 * PX);
    expect(doc.pages[0].elements).toEqual([]);
  });

  it("rejects a package without a Visio document", async () => {
    const JSZip = (await import("jszip")).default;
    const z = new JSZip();
    z.file("hello.txt", "x");
    await expect(
      parseVsdx(await z.generateAsync({ type: "uint8array" })),
    ).rejects.toThrow(/document/);
  });

  it("oo:visio/api/test-files.js#rectangle", async () => {
    const els = await onePage(
      shape(
        1,
        xform(2, 9, 2, 1) +
          cell("FillForegnd", "#ff0000") +
          cell("LineColor", "#0000ff") +
          cell("LineWeight", 2 / 96) +
          rectGeom(2, 1),
        { NameU: "Rectangle" },
      ),
    );
    expect(els).toHaveLength(1);
    const r = els[0];
    expect(r.type).toBe("rectangle");
    // Pin (2,9) with a 2×1 box → top-left (1, 11-9.5) in inches.
    close(r.x, 1 * PX);
    close(r.y, 1.5 * PX);
    close(r.width as number, 2 * PX);
    close(r.height as number, 1 * PX);
    expect(r.backgroundColor).toBe("#ff0000");
    expect(r.strokeColor).toBe("#0000ff");
    expect(r.strokeWidth).toBe(2);
    expect(r.angle).toBe(0);
  });

  it("oo:visio/api/test-files.js#triangle", async () => {
    const els = await onePage(
      shape(
        1,
        xform(4, 5, 2, 2) +
          cell("FillForegnd", 3) +
          geom([
            ["MoveTo", { X: 0, Y: 0 }],
            ["LineTo", { X: 2, Y: 0 }],
            ["LineTo", { X: 1, Y: 2 }],
            ["LineTo", { X: 0, Y: 0 }],
          ]),
      ),
    );
    expect(els).toHaveLength(1);
    const t = els[0];
    expect(t.type).toBe("line");
    const pts = t.points as [number, number][];
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual(pts[3]); // closed polygon
    // Apex is up (smaller y) in screen space.
    close(t.x + pts[2][0], 4 * PX);
    close(t.y + pts[2][1], (11 - 6) * PX);
    expect(t.backgroundColor).toBe("#00ff00"); // palette index 3
  });

  it("oo:visio/api/test-files.js#circle", async () => {
    const els = await onePage(
      shape(1, xform(3, 3, 1.5, 1.5) + ellipseGeom(1.5, 1.5)),
    );
    expect(els[0].type).toBe("ellipse");
    close(els[0].width as number, 1.5 * PX);
    close(els[0].x, 2.25 * PX);
    close(els[0].y, (11 - 3.75) * PX);
  });

  it("oo:visio/api/test-files.js#rectAndCircle", async () => {
    const els = await onePage(
      shape(1, xform(2, 2, 2, 1) + rectGeom(2, 1)) +
        shape(2, xform(5, 2, 1, 1) + ellipseGeom(1, 1)),
    );
    expect(els.map((e) => e.type)).toEqual(["rectangle", "ellipse"]);
  });

  it("recognises a diamond from edge midpoints", async () => {
    const els = await onePage(
      shape(
        1,
        xform(2, 2, 2, 1) +
          geom([
            ["MoveTo", { X: 1, Y: 0 }],
            ["LineTo", { X: 2, Y: 0.5 }],
            ["LineTo", { X: 1, Y: 1 }],
            ["LineTo", { X: 0, Y: 0.5 }],
            ["LineTo", { X: 1, Y: 0 }],
          ]),
      ),
    );
    expect(els[0].type).toBe("diamond");
  });

  it("oo:visio/api/test-files.js#lineShapes", async () => {
    const els = await onePage(
      shape(
        1,
        cell("BeginX", 1) +
          cell("BeginY", 10) +
          cell("EndX", 4) +
          cell("EndY", 8) +
          cell("LinePattern", 2),
      ),
    );
    const l = els[0];
    expect(l.type).toBe("line");
    close(l.x, 1 * PX);
    close(l.y, 1 * PX);
    expect(l.points).toEqual([
      [0, 0],
      [3 * PX, 2 * PX],
    ]);
    expect(l.strokeStyle).toBe("dashed");
  });

  it("oo:visio/api/test-files.js#sizeAndPositionStart", async () => {
    // Rotated 90° CCW with an off-centre local pin at the bottom-left corner.
    const inner =
      cell("PinX", 3) +
      cell("PinY", 3) +
      cell("Width", 2) +
      cell("Height", 1) +
      cell("LocPinX", 0) +
      cell("LocPinY", 0) +
      cell("Angle", Math.PI / 2) +
      rectGeom(2, 1);
    const r = (await onePage(shape(1, inner)))[0];
    expect(r.type).toBe("rectangle");
    close(r.width as number, 2 * PX);
    close(r.height as number, 1 * PX);
    // Visio's CCW 90° is 270° clockwise in Excalidraw.
    close(r.angle as number, (3 * Math.PI) / 2, 1e-6);
    // Centre: local (1, 0.5) rotated about (0,0) → (-0.5, 1) + pin (3,3).
    close(r.x + (r.width as number) / 2, 2.5 * PX);
    close(r.y + (r.height as number) / 2, (11 - 4) * PX);
  });

  it("oo:visio/api/test-files.js#rotatedEllipticalArc", async () => {
    const els = await onePage(
      shape(
        1,
        xform(4, 4, 2, 2) +
          geom([
            ["MoveTo", { X: 0, Y: 1 }],
            [
              "EllipticalArcTo",
              { X: 2, Y: 1, A: 1, B: 1.5, C: Math.PI / 6, D: 2 },
            ],
          ]),
      ),
    );
    const l = els[0];
    expect(l.type).toBe("line");
    const pts = (l.points as [number, number][]).map(([x, y]) => [
      l.x + x,
      l.y + y,
    ]);
    expect(pts.length).toBeGreaterThan(4);
    // Ends at (2,1) local → page (5,4).
    close(pts[pts.length - 1][0], 5 * PX, 1e-6);
    close(pts[pts.length - 1][1], 7 * PX, 1e-6);
    // Passes (approximately) through the control point (1,1.5) → page (4,4.5).
    const d = Math.min(
      ...pts.map(([x, y]) => Math.hypot(x - 4 * PX, y - 6.5 * PX)),
    );
    expect(d).toBeLessThan(0.05 * PX);
  });

  it("samples ArcTo bows on the clockwise side of the chord", async () => {
    const els = await onePage(
      shape(
        1,
        xform(4, 4, 2, 1) +
          geom([
            ["MoveTo", { X: 0, Y: 0 }],
            ["ArcTo", { X: 2, Y: 0, A: 0.5 }],
          ]),
      ),
    );
    const l = els[0];
    const ys = (l.points as [number, number][]).map(([, y]) => l.y + y);
    // Chord at local y=0 (page y 3.5); a positive bow goes to local y=-0.5 → page 3.0 → screen larger y.
    close(Math.max(...ys), (11 - 3) * PX, 1);
  });

  it("oo:visio/api/api-test.js#addSquarePolygon", async () => {
    const els = await onePage(
      shape(
        1,
        xform(4, 6, 2, 1) +
          cell("FillForegnd", "#ffffff") +
          geom([
            ["RelMoveTo", { X: 0, Y: 0 }],
            ["RelLineTo", { X: 1, Y: 0 }],
            ["RelLineTo", { X: 1, Y: 1 }],
            ["RelLineTo", { X: 0, Y: 1 }],
            ["RelLineTo", { X: 0, Y: 0 }],
          ]),
      ),
    );
    expect(els[0].type).toBe("rectangle");
    close(els[0].x, 3 * PX);
    close(els[0].y, 4.5 * PX);
  });

  it("oo:visio/api/api-test.js#colorizeRectange", async () => {
    const els = await onePage(
      shape(
        1,
        xform(2, 2, 1, 1) + cell("FillForegnd", "#A2A2A2") + rectGeom(1, 1),
        {
          NameU: "Rectangle",
        },
      ),
    );
    expect(els[0].backgroundColor).toBe("#a2a2a2");
  });

  it("honours FillPattern 0, LinePattern 0 and NoFill", async () => {
    const els = await onePage(
      shape(
        1,
        xform(2, 2, 1, 1) +
          cell("FillPattern", 0) +
          cell("LinePattern", 0) +
          rectGeom(1, 1),
      ) +
        shape(
          2,
          xform(4, 2, 1, 1) +
            geom(
              [
                ["MoveTo", { X: 0, Y: 0 }],
                ["LineTo", { X: 1, Y: 0 }],
                ["LineTo", { X: 0.5, Y: 1 }],
                ["LineTo", { X: 0, Y: 0 }],
              ],
              0,
            ).replace(cell("NoFill", 0), cell("NoFill", 1)),
        ),
    );
    expect(els[0].backgroundColor).toBe("transparent");
    expect(els[0].strokeColor).toBe("transparent");
    expect(els[1].backgroundColor).toBe("transparent");
  });

  it("reads text as a container label with basic formatting", async () => {
    const els = await onePage(
      shape(
        1,
        xform(2, 2, 2, 1) +
          rectGeom(2, 1) +
          `<Section N="Character"><Row IX="0">${cell("Size", 0.25)}${cell("Color", "#336699")}</Row></Section>` +
          `<Section N="Paragraph"><Row IX="0">${cell("HorzAlign", 0)}</Row></Section>` +
          `<Text><cp IX="0"/><pp IX="0"/>Hello&#xa;World<fld IX="0">!</fld>\n</Text>`,
      ),
    );
    const label = els[0].label as Record<string, unknown>;
    expect(label.text).toBe("Hello\nWorld!");
    expect(label.fontSize).toBe(24);
    expect(label.strokeColor).toBe("#336699");
    expect(label.textAlign).toBe("left");
  });

  it("emits free text for non-container shapes", async () => {
    const els = await onePage(
      shape(
        1,
        xform(3, 3, 2, 2) +
          geom([
            ["MoveTo", { X: 0, Y: 0 }],
            ["LineTo", { X: 2, Y: 0 }],
            ["LineTo", { X: 1, Y: 2 }],
            ["LineTo", { X: 0, Y: 0 }],
          ]) +
          `<Text>Tri</Text>`,
      ) + shape(2, xform(6, 6, 1, 0.5) + `<Text>Just text</Text>`),
    );
    const texts = els.filter((e) => e.type === "text");
    expect(texts.map((t) => t.text)).toEqual(["Tri", "Just text"]);
    // Centred on the text block (shape centre).
    const t = texts[1];
    const approxCx = t.x + ("Just text".length * 16 * 0.55) / 2;
    close(approxCx, 6 * PX, 1);
  });

  it("binds connectors to the shapes they are glued to", async () => {
    const els = await onePage(
      shape(1, xform(2, 9, 2, 1) + rectGeom(2, 1)) +
        shape(2, xform(6, 9, 1, 1) + ellipseGeom(1, 1)) +
        shape(
          3,
          cell("BeginX", 3) +
            cell("BeginY", 9) +
            cell("EndX", 5.5) +
            cell("EndY", 9) +
            cell("EndArrow", 4) +
            `<Text>flows</Text>`,
          { NameU: "Dynamic connector" },
        ),
      `<Connect FromSheet="3" FromCell="BeginX" ToSheet="1" ToCell="PinX"/>` +
        `<Connect FromSheet="3" FromCell="EndX" ToSheet="2" ToCell="PinX"/>`,
    );
    const a = els.find((e) => e.type === "arrow")!;
    expect(a).toBeTruthy();
    expect(a.start).toEqual({ id: byId(els, "vsdx0-s1").id });
    expect(a.end).toEqual({ id: byId(els, "vsdx0-s2").id });
    expect(a.startArrowhead).toBeNull();
    expect(a.endArrowhead).toBe("arrow");
    expect((a.label as { text: string }).text).toBe("flows");
    close(a.x, 3 * PX);
  });

  it("follows a connector's own elbow geometry", async () => {
    const els = await onePage(
      shape(
        3,
        cell("BeginX", 1) +
          cell("BeginY", 1) +
          cell("EndX", 3) +
          cell("EndY", 2) +
          xform(2, 1.5, 2, 1) +
          geom([
            ["MoveTo", { X: 0, Y: 0 }],
            ["LineTo", { X: 1, Y: 0 }],
            ["LineTo", { X: 1, Y: 1 }],
            ["LineTo", { X: 2, Y: 1 }],
          ]) +
          cell("EndArrow", 1),
      ),
    );
    expect(els[0].type).toBe("arrow");
    expect(els[0].points).toHaveLength(4);
  });

  it("inherits geometry, cells and text from masters", async () => {
    const master = shape(
      5,
      xform(0.5, 0.25, 1, 0.5) +
        cell("FillForegnd", "#abcdef") +
        cell("LineColor", "#123456") +
        rectGeom(1, 0.5) +
        `<Text>Master text</Text>`,
    );
    const els = await onePage(
      shape(1, cell("PinX", 2) + cell("PinY", 2), { Master: "2" }) +
        shape(
          2,
          cell("PinX", 4) +
            cell("PinY", 2) +
            cell("FillForegnd", "#ff0000") +
            `<Text>Mine</Text>`,
          {
            Master: "2",
          },
        ) +
        // Row override turns the master's rectangle into a triangle-ish path.
        shape(
          3,
          cell("PinX", 6) +
            cell("PinY", 2) +
            `<Section N="Geometry" IX="0"><Row T="LineTo" IX="3"><Cell N="X" V="0.5"/><Cell N="Y" V="0.5"/></Row><Row IX="4" Del="1"/></Section>`,
          { Master: "2" },
        ),
      undefined,
      { masters: [{ id: "2", name: "Box", shapes: master }] },
    );
    const [a, b, c] = els;
    expect(a.type).toBe("rectangle");
    close(a.width as number, 1 * PX);
    expect(a.backgroundColor).toBe("#abcdef");
    expect(a.strokeColor).toBe("#123456");
    expect((a.label as { text: string }).text).toBe("Master text");
    expect(b.backgroundColor).toBe("#ff0000");
    expect((b.label as { text: string }).text).toBe("Mine");
    expect(c.type).toBe("line");
    expect(c.points).toHaveLength(4);
  });

  it("inherits group sub-shapes from a master via MasterShape", async () => {
    const master = shape(
      10,
      xform(1, 1, 2, 2) +
        `<Shapes>${shape(11, xform(0.5, 1, 1, 2) + rectGeom(1, 2))}${shape(12, xform(1.5, 1, 1, 2) + ellipseGeom(1, 2))}</Shapes>`,
      { Type: "Group" },
    );
    const els = await onePage(
      shape(
        1,
        cell("PinX", 3) +
          cell("PinY", 3) +
          `<Shapes>${shape(2, cell("FillForegnd", "#00ff00"), { MasterShape: 11 })}${shape(3, "", { MasterShape: 12 })}</Shapes>`,
        { Master: "7", Type: "Group" },
      ),
      undefined,
      { masters: [{ id: "7", name: "Pair", shapes: master }] },
    );
    expect(els.map((e) => e.type)).toEqual(["rectangle", "ellipse"]);
    expect(els[0].backgroundColor).toBe("#00ff00");
    // Group spans (2..4, 2..4); child 11 is its left half.
    close(els[0].x, 2 * PX);
    close(els[0].y, (11 - 4) * PX);
    expect(els[0].groupIds).toEqual(["vsdx0-grp1"]);
  });

  it("falls back to style sheets for line and fill", async () => {
    const els = await onePage(
      shape(1, xform(2, 2, 1, 1) + rectGeom(1, 1), {
        LineStyle: "3",
        FillStyle: "3",
      }),
      undefined,
      {
        styleSheets: `<StyleSheet ID="0" NameU="No Style">${cell("LineColor", 0)}${cell("FillForegnd", 1)}</StyleSheet><StyleSheet ID="3" NameU="Fancy" LineStyle="0" FillStyle="0">${cell("FillForegnd", "#fedcba")}</StyleSheet>`,
      },
    );
    expect(els[0].backgroundColor).toBe("#fedcba");
    expect(els[0].strokeColor).toBe("#000000");
  });

  it("reads bitmap foreign shapes as images", async () => {
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );
    const bytes = await buildVsdx({
      pages: [
        {
          shapes: shape(
            1,
            xform(2, 2, 1, 1) +
              `<ForeignData ForeignType="Bitmap"><Rel r:id="rId9"/></ForeignData>`,
            { Type: "Foreign" },
          ),
          rels: { rId9: "../media/image1.png" },
        },
      ],
      files: { "visio/media/image1.png": png },
    });
    const doc = await parseVsdx(bytes);
    const img = doc.pages[0].elements[0];
    expect(img.type).toBe("image");
    const f = doc.files[img.fileId as string];
    expect(f.mimeType).toBe("image/png");
    expect(f.dataURL.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("lays out several pages side by side in named frames", async () => {
    const bytes = await buildVsdx({
      pages: [
        {
          name: "One",
          width: 4,
          height: 3,
          shapes: shape(1, xform(1, 1, 1, 1) + rectGeom(1, 1)),
        },
        {
          name: "Two",
          width: 4,
          height: 3,
          shapes: shape(1, xform(1, 1, 1, 1) + ellipseGeom(1, 1)),
        },
      ],
    });
    const doc = await parseVsdx(bytes);
    const els = layoutVsdxPages(doc, { origin: { x: 0, y: 0 }, gap: 100 });
    const frames = els.filter((e) => e.type === "frame");
    expect(frames.map((f) => f.name)).toEqual(["One", "Two"]);
    expect(frames[0].children).toEqual(["vsdx0-s1"]);
    const second = byId(els, "vsdx1-s1");
    expect(second.x).toBeGreaterThanOrEqual(4 * PX + 100);
    // Single page → no frame by default.
    expect(
      layoutVsdxPages(doc, { pages: [0] }).some((e) => e.type === "frame"),
    ).toBe(false);
  });

  it("maps Visio colors", () => {
    expect(visioColor("#ABC")).toBe("#aabbcc");
    expect(visioColor("RGB(255,0,16)")).toBe("#ff0010");
    expect(visioColor("4")).toBe("#0000ff");
    expect(visioColor("Themed")).toBeUndefined();
  });
});

// Local-only corpus: OnlyOffice's base64-embedded sample files, when the
// research checkout is present (or OO_RESEARCH points at research/onlyoffice).
// Nothing from it is committed.
const RESEARCH = resolve(
  process.env.OO_RESEARCH ??
    resolve(__dirname, "../../../../../research/onlyoffice"),
  "sdkjs-tests-v9.3.1/tests/visio",
);
const CORPUS = ["api/test-files.js", "serialize/sax-serialize-files.js"]
  .map((f) => resolve(RESEARCH, f))
  .filter((f) => existsSync(f));

describe.skipIf(CORPUS.length === 0)(
  "vsdx corpus (local research/ only)",
  () => {
    const samples: [string, string][] = [];
    for (const f of CORPUS) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(
        /window\['Asc'\]\.(\w+)\s*=\s*"(UEsDB[^"]+)"/g,
      ))
        samples.push([m[1], m[2]]);
    }
    it.each(samples)("parses %s", async (_name, b64) => {
      const bytes = Buffer.from(b64, "base64");
      // Some OnlyOffice fixtures are bare XML zips, not Visio packages.
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(bytes);
      if (!zip.file("visio/document.xml")) {
        await expect(parseVsdx(bytes)).rejects.toThrow(/document/);
        return;
      }
      const doc = await parseVsdx(bytes);
      expect(doc.pages.length).toBeGreaterThan(0);
      const els = layoutVsdxPages(doc);
      for (const e of els) {
        expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
      }
    });
  },
);
