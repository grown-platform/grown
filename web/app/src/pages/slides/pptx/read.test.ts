import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { mapPreset, readPptx, resolvePartPath } from "./read";

// Minimal hand-written PresentationML packages. Every part here is authored
// for these tests from the ECMA-376 schema; nothing is taken from another
// project's fixtures.

const NS =
  `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
  `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
  `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"`;
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const THEME = `<a:theme ${NS} name="T"><a:themeElements>
<a:clrScheme name="C">
  <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
  <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
  <a:dk2><a:srgbClr val="1F2A44"/></a:dk2>
  <a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
  <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
  <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
  <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
  <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
  <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
  <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
  <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
  <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="F"><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Verdana"/></a:minorFont></a:fontScheme>
</a:themeElements></a:theme>`;

const MASTER = (
  extraTree = "",
  bg = `<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>`,
) =>
  `<p:sldMaster ${NS}><p:cSld>${bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="457200" y="228600"/><a:ext cx="8229600" cy="914400"/></a:xfrm></p:spPr>
  <p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p/></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="457200" y="1371600"/><a:ext cx="8229600" cy="3200400"/></a:xfrm></p:spPr>
  <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>
${extraTree}
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:txStyles>
  <p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
  <p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle>
  <p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle>
</p:txStyles></p:sldMaster>`;

const LAYOUT = (attrs = "", tree = "") =>
  `<p:sldLayout ${NS}${attrs}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Sub"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="914400" y="2286000"/><a:ext cx="7315200" cy="1828800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>
${tree}
</p:spTree></p:cSld></p:sldLayout>`;

const SLIDE = (tree: string, tail = "", head = "", attrs = "") =>
  `<p:sld ${NS}${attrs}><p:cSld>${head}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${tail}</p:sld>`;

const rels = (items: [string, string, string, boolean?][]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(
      ([id, type, target, ext]) =>
        `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"${ext ? ` TargetMode="External"` : ""}/>`,
    )
    .join("")}</Relationships>`;

interface PkgOpts {
  slides: {
    xml: string;
    rels?: [string, string, string, boolean?][];
    notes?: string;
  }[];
  size?: [number, number];
  master?: string;
  layout?: string;
  masterRels?: [string, string, string, boolean?][];
  media?: Record<string, string>;
  title?: string;
}

async function pkg(o: PkgOpts): Promise<Uint8Array> {
  const z = new JSZip();
  const [cx, cy] = o.size ?? [9144000, 5143500];
  z.file(
    "_rels/.rels",
    rels([["rId1", "officeDocument", "ppt/presentation.xml"]]),
  );
  z.file(
    "ppt/presentation.xml",
    `<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst><p:sldIdLst>${o.slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`)
      .join("")}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/></p:presentation>`,
  );
  z.file(
    "ppt/_rels/presentation.xml.rels",
    rels([
      ["rIdM", "slideMaster", "slideMasters/slideMaster1.xml"],
      // Deliberately listed out of order: slide order comes from sldIdLst.
      ...o.slides
        .map(
          (_, i) =>
            [`rIdS${i + 1}`, "slide", `slides/slide${i + 1}.xml`] as [
              string,
              string,
              string,
            ],
        )
        .reverse(),
    ]),
  );
  z.file("ppt/theme/theme1.xml", THEME);
  z.file("ppt/slideMasters/slideMaster1.xml", o.master ?? MASTER());
  z.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    rels([["rId1", "theme", "../theme/theme1.xml"], ...(o.masterRels ?? [])]),
  );
  z.file("ppt/slideLayouts/slideLayout1.xml", o.layout ?? LAYOUT());
  z.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]),
  );
  o.slides.forEach((s, i) => {
    const n = i + 1;
    z.file(`ppt/slides/slide${n}.xml`, s.xml);
    const r: [string, string, string, boolean?][] = [
      ["rIdL", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ...(s.rels ?? []),
    ];
    if (s.notes !== undefined) {
      r.push(["rIdN", "notesSlide", `../notesSlides/notesSlide${n}.xml`]);
      z.file(
        `ppt/notesSlides/notesSlide${n}.xml`,
        `<p:notes ${NS}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="img"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="n"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${s.notes
          .split("\n")
          .map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`)
          .join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
      );
    }
    z.file(`ppt/slides/_rels/slide${n}.xml.rels`, rels(r));
  });
  for (const [p, b64] of Object.entries(o.media ?? {}))
    z.file(p, b64, { base64: true });
  if (o.title)
    z.file(
      "docProps/core.xml",
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${o.title}</dc:title></cp:coreProperties>`,
    );
  return z.generateAsync({ type: "uint8array" });
}

// A shape with explicit geometry. EMU 9525 = 1 px on a 10 in wide slide.
const px = (v: number) => Math.round(v * 9525);
function sp(inner: {
  x: number;
  y: number;
  w: number;
  h: number;
  xfrmAttrs?: string;
  prst?: string;
  fill?: string;
  ln?: string;
  tx?: string;
  nv?: string;
  style?: string;
  cNvPr?: string;
}) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="9" name="s">${inner.cNvPr ?? ""}</p:cNvPr><p:cNvSpPr${inner.nv ?? ""}/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm${inner.xfrmAttrs ?? ""}><a:off x="${px(inner.x)}" y="${px(inner.y)}"/><a:ext cx="${px(inner.w)}" cy="${px(inner.h)}"/></a:xfrm>
<a:prstGeom prst="${inner.prst ?? "rect"}"><a:avLst/></a:prstGeom>${inner.fill ?? ""}${inner.ln ?? ""}</p:spPr>${inner.style ?? ""}${inner.tx ?? ""}</p:sp>`;
}
const solid = (c: string) => `<a:solidFill>${c}</a:solidFill>`;

describe("package plumbing", () => {
  it("resolves relationship targets against the source part", () => {
    expect(resolvePartPath("ppt/slides/slide1.xml", "../media/a.png")).toBe(
      "ppt/media/a.png",
    );
    expect(resolvePartPath("ppt/presentation.xml", "slides/slide2.xml")).toBe(
      "ppt/slides/slide2.xml",
    );
    expect(resolvePartPath("ppt/slides/slide1.xml", "/ppt/media/b.png")).toBe(
      "ppt/media/b.png",
    );
    expect(resolvePartPath("", "ppt/presentation.xml")).toBe(
      "ppt/presentation.xml",
    );
  });

  it("reads slides in sldIdLst order, plus the title", async () => {
    const mk = (t: string) =>
      SLIDE(
        sp({
          x: 0,
          y: 0,
          w: 100,
          h: 50,
          tx: `<p:txBody><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody>`,
        }),
      );
    const r = await readPptx(
      await pkg({
        slides: [{ xml: mk("one") }, { xml: mk("two") }, { xml: mk("three") }],
        title: "My deck",
      }),
    );
    expect(r.deck.slides.map((s) => s.elements[0].text)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(r.title).toBe("My deck");
    expect(r.warnings).toEqual([]);
  });

  it("rejects a zip that isn't a presentation", async () => {
    const z = new JSZip();
    z.file("hello.txt", "hi");
    await expect(
      readPptx(await z.generateAsync({ type: "uint8array" })),
    ).rejects.toThrow(/presentation/);
  });
});

describe("geometry", () => {
  it("maps EMUs to canvas px with rotation and flips", async () => {
    const r = await readPptx(
      await pkg({
        slides: [
          {
            xml: SLIDE(
              sp({
                x: 100,
                y: 50,
                w: 200,
                h: 80,
                xfrmAttrs: ` rot="5400000" flipH="1"`,
                fill: solid(`<a:srgbClr val="FF0000"/>`),
              }),
            ),
          },
        ],
      }),
    );
    expect(r.deck.slides[0].elements[0]).toMatchObject({
      type: "rect",
      x: 100,
      y: 50,
      w: 200,
      h: 80,
      rotation: 90,
      flipH: true,
      fill: "#ff0000",
      stroke: "none",
    });
  });

  it("keeps a 4:3 deck's size: 960 px wide, 720 high (M7; was pillar-boxed)", async () => {
    // 10in × 7.5in: 960/9144000 px per EMU.
    const r = await readPptx(
      await pkg({
        size: [9144000, 6858000],
        slides: [
          {
            xml: SLIDE(
              `<p:sp><p:nvSpPr><p:cNvPr id="2" name=""/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"/>${solid(`<a:srgbClr val="00FF00"/>`)}</p:spPr></p:sp>`,
            ),
          },
        ],
      }),
    );
    expect(r.deck.slides[0].elements[0]).toMatchObject({
      x: 0,
      y: 0,
      w: 960,
      h: 720,
    });
    expect(r.deck.size).toEqual({ w: 960, h: 720 });
    expect(r.warnings.join()).not.toMatch(/16:9/);
  });

  it("reads group shapes as Grown groups, mapping members through the child space", async () => {
    const grp = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="5400000" flipH="1"><a:off x="${px(100)}" y="${px(100)}"/><a:ext cx="${px(200)}" cy="${px(100)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(100)}" cy="${px(50)}"/></a:xfrm></p:grpSpPr>
${sp({ x: 50, y: 25, w: 50, h: 25, prst: "ellipse", fill: solid(`<a:srgbClr val="0000FF"/>`) })}
${sp({ x: 0, y: 0, w: 10, h: 10, prst: "rect", fill: solid(`<a:srgbClr val="FF0000"/>`) })}</p:grpSp>`;
    const r = await readPptx(await pkg({ slides: [{ xml: SLIDE(grp) }] }));
    const g = r.deck.slides[0].elements[0];
    expect(g).toMatchObject({ type: "group", x: 100, y: 100, w: 200, h: 100, rotation: 90, flipH: true });
    expect(g.children).toHaveLength(2);
    // Members keep their own (unrotated) transform in the group's frame.
    expect(g.children![0]).toMatchObject({ type: "ellipse", x: 200, y: 150, w: 100, h: 50 });
    expect(g.children![0].rotation).toBeUndefined();
    expect(g.children![1]).toMatchObject({ type: "rect", x: 100, y: 100, w: 20, h: 20 });
  });

  it("reads nested groups and drops empty ones", async () => {
    const inner = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="i"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${px(50)}" cy="${px(50)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(50)}" cy="${px(50)}"/></a:xfrm></p:grpSpPr>
${sp({ x: 0, y: 0, w: 50, h: 50, prst: "rect", fill: solid(`<a:srgbClr val="00FF00"/>`) })}</p:grpSp>`;
    const empty = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="8" name="e"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:grpSp>`;
    const outer = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="7" name="o"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(10)}" y="${px(20)}"/><a:ext cx="${px(100)}" cy="${px(100)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(100)}" cy="${px(100)}"/></a:xfrm></p:grpSpPr>
${inner}${sp({ x: 60, y: 60, w: 40, h: 40, prst: "rect", fill: solid(`<a:srgbClr val="0000FF"/>`) })}</p:grpSp>${empty}`;
    const r = await readPptx(await pkg({ slides: [{ xml: SLIDE(outer) }] }));
    const els = r.deck.slides[0].elements;
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: "group", x: 10, y: 20 });
    expect(els[0].children![0]).toMatchObject({ type: "group", x: 10, y: 20, w: 50, h: 50 });
    expect(els[0].children![0].children![0]).toMatchObject({ type: "rect", x: 10, y: 20 });
    expect(els[0].children![1]).toMatchObject({ x: 70, y: 80 });
  });

  it("turns preset lines, connectors and straight freeforms into rotated Grown lines", async () => {
    const ln = `<a:ln w="25400">${solid(`<a:srgbClr val="112233"/>`)}</a:ln>`;
    const cxn = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="c"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="${px(100)}" y="${px(100)}"/><a:ext cx="${px(100)}" cy="${px(100)}"/></a:xfrm><a:prstGeom prst="straightConnector1"/>${ln}</p:spPr></p:cxnSp>`;
    const free = `<p:sp><p:nvSpPr><p:cNvPr id="6" name="f"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${px(0)}" y="${px(300)}"/><a:ext cx="${px(200)}" cy="${px(100)}"/></a:xfrm>
<a:custGeom><a:pathLst><a:path w="2" h="2"><a:moveTo><a:pt x="0" y="1"/></a:moveTo><a:lnTo><a:pt x="2" y="1"/></a:lnTo></a:path></a:pathLst></a:custGeom><a:noFill/>${ln}</p:spPr></p:sp>`;
    const r = await readPptx(
      await pkg({
        slides: [
          {
            xml: SLIDE(
              sp({ x: 10, y: 20, w: 300, h: 0, prst: "line", ln }) + cxn + free,
            ),
          },
        ],
      }),
    );
    const [a, b, c] = r.deck.slides[0].elements;
    expect(a).toMatchObject({
      type: "line",
      x: 10,
      y: 20,
      w: 300,
      h: 0,
      stroke: "#112233",
      strokeWidth: 2,
    });
    expect(a.rotation).toBeUndefined();
    // 100×100 diagonal: length 141.42 centred on (150,150), rotated 45°.
    expect(b).toMatchObject({ type: "line", y: 150, w: 141.42, rotation: 45 });
    expect(b.x).toBeCloseTo(150 - 141.42 / 2, 1);
    // Horizontal segment across the middle of the freeform box.
    expect(c).toMatchObject({ type: "line", x: 0, y: 350, w: 200, h: 0 });
  });

  it("maps preset names to the closest Grown shape", () => {
    expect(mapPreset("rect")).toBe("rect");
    expect(mapPreset("flowChartDecision")).toBe("diamond");
    expect(mapPreset("rtTriangle")).toBe("triangle");
    expect(mapPreset("round2SameRect")).toBe("roundRect");
    expect(mapPreset("straightConnector1")).toBe("line");
    expect(mapPreset("star5")).toBeNull();
  });

  it("reads supported presets as preset shapes with their adjust values", async () => {
    const r = await readPptx(
      await pkg({
        slides: [
          {
            xml: SLIDE(
              sp({ x: 0, y: 0, w: 10, h: 10, prst: "star5", fill: solid(`<a:srgbClr val="FFFF00"/>`) }).replace(
                "<a:avLst/>",
                `<a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst>`,
              ) +
                // default-adjust legacy presets keep their legacy Grown type
                sp({ x: 0, y: 0, w: 10, h: 10, prst: "triangle", fill: solid(`<a:srgbClr val="FFFF00"/>`) }),
            ),
          },
        ],
      }),
    );
    const [star, tri] = r.deck.slides[0].elements;
    expect(star).toMatchObject({ type: "shape", preset: "star5", adj: { adj: 30000 }, fill: "#ffff00" });
    expect(tri.type).toBe("triangle");
    expect(r.warnings).toEqual([]);
  });

  it("draws unsupported presets as rectangles and says so", async () => {
    const r = await readPptx(
      await pkg({
        slides: [
          {
            xml: SLIDE(
              sp({
                x: 0,
                y: 0,
                w: 10,
                h: 10,
                prst: "cloud",
                fill: solid(`<a:srgbClr val="FFFF00"/>`),
              }),
            ),
          },
        ],
      }),
    );
    expect(r.deck.slides[0].elements[0].type).toBe("rect");
    expect(r.warnings.join()).toMatch(/cloud/);
  });

  it("reads connectors with arrowheads, dash and glue to shape ids", async () => {
    const ln = `<a:ln w="12700">${solid(`<a:srgbClr val="112233"/>`)}<a:prstDash val="dot"/><a:headEnd type="none"/><a:tailEnd type="stealth"/></a:ln>`;
    const cxn = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="c"/><p:cNvCxnSpPr><a:stCxn id="9" idx="3"/><a:endCxn id="77" idx="1"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm flipV="1"><a:off x="${px(100)}" y="${px(100)}"/><a:ext cx="${px(200)}" cy="${px(50)}"/></a:xfrm><a:prstGeom prst="bentConnector3"><a:avLst><a:gd name="adj1" fmla="val 25000"/></a:avLst></a:prstGeom>${ln}</p:spPr></p:cxnSp>`;
    const r = await readPptx(
      await pkg({
        slides: [{ xml: SLIDE(sp({ x: 0, y: 0, w: 10, h: 10, fill: solid(`<a:srgbClr val="FF0000"/>`) }) + cxn) }],
      }),
    );
    const [box, c] = r.deck.slides[0].elements;
    expect(c).toMatchObject({
      type: "connector",
      preset: "bentConnector3",
      adj: { adj1: 25000 },
      x: 100,
      y: 100,
      w: 200,
      h: 50,
      flipV: true,
      dash: "sysDot",
      tailEnd: "stealth",
      stroke: "#112233",
      strokeWidth: 1,
    });
    expect(c.headEnd).toBeUndefined();
    // id 9 is the rectangle (sp() writes cNvPr id 9); id 77 does not exist.
    expect(c.stCxn).toEqual({ id: box.id, idx: 3 });
    expect(c.endCxn).toBeUndefined();
  });
});

describe("theme colours", () => {
  it("resolves scheme colours with lumMod/lumOff through lib/colorMods", async () => {
    // accent1 4472C4 at 60% lum + 40% offset = PowerPoint's "Lighter 40%".
    const fill = solid(
      `<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>`,
    );
    const r = await readPptx(
      await pkg({
        slides: [{ xml: SLIDE(sp({ x: 0, y: 0, w: 10, h: 10, fill })) }],
      }),
    );
    expect(r.deck.slides[0].elements[0].fill).toBe("#8faadc");
  });

  it("maps tx1/bg2 through the master clrMap, and keeps alpha", async () => {
    const r = await readPptx(
      await pkg({
        slides: [
          {
            xml: SLIDE(
              sp({
                x: 0,
                y: 0,
                w: 10,
                h: 10,
                fill: solid(`<a:schemeClr val="bg2"/>`),
                ln: `<a:ln>${solid(`<a:schemeClr val="tx2"><a:alpha val="50000"/></a:schemeClr>`)}</a:ln>`,
              }),
            ),
          },
        ],
      }),
    );
    expect(r.deck.slides[0].elements[0]).toMatchObject({
      fill: "#eeeeee",
      stroke: "#1f2a4480",
      strokeWidth: 1,
    });
  });

  it("uses the shape style's fillRef/lnRef/fontRef when spPr has none", async () => {
    const style = `<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>`;
    const tx = `<p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:t>Hi</a:t></a:r></a:p></p:txBody>`;
    const r = await readPptx(
      await pkg({
        slides: [
          {
            xml: SLIDE(
              sp({ x: 0, y: 0, w: 100, h: 50, prst: "ellipse", style, tx }),
            ),
          },
        ],
      }),
    );
    const [shape, text] = r.deck.slides[0].elements;
    expect(shape).toMatchObject({
      type: "ellipse",
      fill: "#ed7d31",
      stroke: "#2f528f",
    }); // accent1 shade 50% (linear light), as PowerPoint draws it
    expect(text).toMatchObject({
      type: "text",
      text: "Hi",
      color: "#ffffff",
      align: "center",
      valign: "middle",
    });
  });
});

describe("text", () => {
  it("reads paragraphs, breaks, run formatting and alignment", async () => {
    const tx = `<p:txBody><a:bodyPr anchor="b"/><a:lstStyle/>
<a:p><a:pPr algn="r"><a:lnSpc><a:spcPct val="120000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="2400" b="1" i="1" u="sng" strike="sngStrike"><a:solidFill><a:srgbClr val="336699"/></a:solidFill><a:latin typeface="Courier New"/></a:rPr><a:t>Line one</a:t></a:r><a:br/><a:r><a:t>still one</a:t></a:r></a:p>
<a:p><a:r><a:t>Line two</a:t></a:r></a:p></p:txBody>`;
    const r = await readPptx(
      await pkg({
        slides: [
          {
            xml: SLIDE(
              sp({ x: 0, y: 0, w: 200, h: 100, nv: ` txBox="1"`, tx }),
            ),
          },
        ],
      }),
    );
    expect(r.deck.slides[0].elements).toHaveLength(1);
    expect(r.deck.slides[0].elements[0]).toMatchObject({
      type: "text",
      // a:br is a line break inside the paragraph ("\v").
      text: "Line one\vstill one\nLine two",
      fontSize: 32, // 24 pt
      fontFamily: "Courier New",
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      color: "#336699",
      align: "right",
      valign: "bottom",
      lineSpacing: 1.2,
    });
    // The unformatted runs after the first keep their own (default) style.
    const el = r.deck.slides[0].elements[0];
    expect(el.runs?.[0]).toEqual({ text: "Line one\v" });
    expect(el.runs?.[1]).toMatchObject({ bold: false, italic: false, underline: false, strike: false, fontSize: 24 });
  });

  it("applies normAutofit font scale", async () => {
    const tx = `<p:txBody><a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr><a:p><a:r><a:rPr sz="3600"/><a:t>x</a:t></a:r></a:p></p:txBody>`;
    const r = await readPptx(
      await pkg({
        slides: [{ xml: SLIDE(sp({ x: 0, y: 0, w: 10, h: 10, tx })) }],
      }),
    );
    expect(r.deck.slides[0].elements[0].fontSize).toBe(24);
  });

  it("reads bullets and numbering, with buNone overriding inherited bullets", async () => {
    const body = (pPr: string) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="b"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p>${pPr}<a:r><a:t>item</a:t></a:r></a:p></p:txBody></p:sp>`;
    const r = await readPptx(
      await pkg({
        slides: [
          { xml: SLIDE(body("")) },
          {
            xml: SLIDE(
              body(`<a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr>`),
            ),
          },
          { xml: SLIDE(body(`<a:pPr><a:buNone/></a:pPr>`)) },
        ],
      }),
    );
    expect(r.deck.slides.map((s) => s.elements[0].list)).toEqual([
      "bullet",
      "number",
      undefined,
    ]);
  });

  it("inherits placeholder position, size, colour and theme fonts from layout and master", async () => {
    const title = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp>`;
    const sub = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="s"/><p:cNvSpPr/><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>World</a:t></a:r></a:p></p:txBody></p:sp>`;
    const empty = `<p:sp><p:nvSpPr><p:cNvPr id="4" name="e"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="2"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp>`;
    const r = await readPptx(
      await pkg({ slides: [{ xml: SLIDE(title + sub + empty) }] }),
    );
    const [t, s, e] = r.deck.slides[0].elements;
    // The empty placeholder is kept (M7): it shows its prompt in the editor.
    expect(r.deck.slides[0].elements).toHaveLength(3);
    expect(e).toMatchObject({ type: "text", text: "", placeholder: { type: "body", idx: 2 } });
    expect(t.placeholder).toEqual({ type: "ctrTitle" });
    expect(s.placeholder).toEqual({ type: "subTitle", idx: 1 });
    // Title: geometry from the master, 44 pt, tx2 colour, major font, centred.
    expect(t).toMatchObject({
      x: 48,
      y: 24,
      w: 864,
      h: 96,
      fontSize: 58.67,
      color: "#1f2a44",
      fontFamily: "Georgia",
      align: "center",
      valign: "middle",
    });
    // Subtitle (idx 1): geometry from the layout, body style from the master.
    expect(s).toMatchObject({
      x: 96,
      y: 240,
      w: 768,
      h: 192,
      fontSize: 37.33,
      color: "#000000",
      fontFamily: "Verdana",
    });
    expect(s.list).toBeUndefined();
  });

  it("keeps web/mail links, drops relative, script and slide-jump targets", async () => {
    const run = (id: string) =>
      sp({
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        tx: `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr><a:hlinkClick r:id="${id}"/></a:rPr><a:t>${id}</a:t></a:r></a:p></p:txBody>`,
      });
    const r = await readPptx(
      await pkg({
        slides: [
          {
            xml: SLIDE(
              run("rW") + run("rM") + run("rF") + run("rJ") + run("rS"),
            ),
            rels: [
              ["rW", "hyperlink", "https://grown.example/x", true],
              ["rM", "hyperlink", "mailto:a@b.example", true],
              ["rF", "hyperlink", "other.pptx", true],
              ["rJ", "hyperlink", "javascript:alert(1)", true],
              ["rS", "slide", "slide2.xml"],
            ],
          },
        ],
      }),
    );
    expect(r.deck.slides[0].elements.map((e) => e.url)).toEqual([
      "https://grown.example/x",
      "mailto:a@b.example",
      undefined,
      undefined,
      undefined,
    ]);
    // A linked run's underline comes from the hyperlink style, not the user.
    expect(r.deck.slides[0].elements[0].underline).toBeUndefined();
  });
});

describe("pictures, tables, notes, backgrounds, transitions", () => {
  it("reads pictures as data URLs and skips formats browsers can't draw", async () => {
    const pic = (id: string) =>
      `<p:pic><p:nvPicPr><p:cNvPr id="7" name="p"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm flipV="1"><a:off x="${px(10)}" y="${px(20)}"/><a:ext cx="${px(30)}" cy="${px(40)}"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic>`;
    const r = await readPptx(
      await pkg({
        slides: [
          {
            xml: SLIDE(pic("rP") + pic("rE")),
            rels: [
              ["rP", "image", "../media/image1.png"],
              ["rE", "image", "../media/image2.emf"],
            ],
          },
        ],
        media: {
          "ppt/media/image1.png": PNG_B64,
          "ppt/media/image2.emf": PNG_B64,
        },
      }),
    );
    expect(r.deck.slides[0].elements).toEqual([
      {
        id: expect.any(String),
        type: "image",
        x: 10,
        y: 20,
        w: 30,
        h: 40,
        flipV: true,
        src: `data:image/png;base64,${PNG_B64}`,
      },
    ]);
    expect(r.warnings.join()).toMatch(/\.emf/);
  });

  it("reads tables: grid, cell text, borders, fill and font", async () => {
    const tc = (t: string) =>
      `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1500"><a:solidFill><a:srgbClr val="222222"/></a:solidFill><a:latin typeface="Verdana"/></a:rPr><a:t>${t}</a:t></a:r></a:p></a:txBody><a:tcPr><a:lnL w="19050">${solid(`<a:srgbClr val="999999"/>`)}</a:lnL>${solid(`<a:schemeClr val="accent6"/>`)}</a:tcPr></a:tc>`;
    const gf = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="8" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${px(100)}" y="${px(100)}"/><a:ext cx="${px(300)}" cy="${px(10)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="${px(150)}"/><a:gridCol w="${px(150)}"/></a:tblGrid>
<a:tr h="${px(40)}">${tc("a")}${tc("b")}</a:tr><a:tr h="${px(40)}">${tc("c")}<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>x</a:t></a:r><a:br/><a:r><a:t>y</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const chart = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="c"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>`;
    const r = await readPptx(
      await pkg({ slides: [{ xml: SLIDE(gf + chart) }] }),
    );
    // The cells don't share one border, so the table keeps them per cell
    // (with PowerPoint's plain "No Style, No Grid" underneath).
    const line = { color: "#999999", width: 1.5 };
    const own = { borders: { l: line }, fill: "#70ad47" };
    expect(r.deck.slides[0].elements).toEqual([
      {
        id: expect.any(String),
        type: "table",
        x: 100,
        y: 100,
        w: 300,
        h: 80, // row heights win over a too-small frame
        table: {
          rows: 2,
          cols: 2,
          cells: [
            ["a", "b"],
            ["c", "x\vy"],
          ],
          style: "{2D5ABB26-0587-4C30-8999-92F81FD0307C}",
          props: [
            [own, own],
            // the last cell has no run properties: 18 pt black
            [own, { style: { color: "#000000", fontSize: 24 } }],
          ],
        },
        fill: "none",
        stroke: "none",
        strokeWidth: 0,
        fontSize: 20,
        fontFamily: "Verdana",
        color: "#222222",
      },
    ]);
    expect(r.warnings.join()).toMatch(/Charts/);
  });

  it("reads speaker notes from the notes slide body placeholder", async () => {
    const r = await readPptx(
      await pkg({
        slides: [
          { xml: SLIDE(""), notes: "First\nSecond" },
          { xml: SLIDE("") },
        ],
      }),
    );
    expect(r.deck.slides[0].notes).toBe("First\nSecond");
    expect(r.deck.slides[1].notes).toBeUndefined();
  });

  it("reads slide, layout and master backgrounds in that order of precedence", async () => {
    const own = `<p:bg><p:bgPr>${solid(`<a:srgbClr val="ABCDEF"/>`)}<a:effectLst/></p:bgPr></p:bg>`;
    const r = await readPptx(
      await pkg({
        slides: [{ xml: SLIDE("", "", own) }, { xml: SLIDE("") }],
        master: MASTER(
          "",
          `<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg2"/></p:bgRef></p:bg>`,
        ),
      }),
    );
    expect(r.deck.slides.map((s) => s.background)).toEqual([
      "#abcdef",
      "#eeeeee",
    ]);
  });

  it("reads a picture background as the slide's picture fill (M7)", async () => {
    const bg = `<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rB"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:bgPr></p:bg>`;
    const r = await readPptx(
      await pkg({
        slides: [
          {
            xml: SLIDE(
              sp({
                x: 1,
                y: 1,
                w: 5,
                h: 5,
                fill: solid(`<a:srgbClr val="000000"/>`),
              }),
              "",
              bg,
            ),
            rels: [["rB", "image", "../media/bg.png"]],
          },
        ],
        media: { "ppt/media/bg.png": PNG_B64 },
      }),
    );
    const s0 = r.deck.slides[0];
    expect(s0.bgFill?.kind).toBe("image");
    expect(s0.bgFill && s0.bgFill.kind === "image" && s0.bgFill.src).toMatch(/^data:image\/png;base64,/);
    expect(s0.elements.map((e) => e.type)).toEqual(["rect"]);
  });

  it("includes master/layout decorations unless showMasterSp=0", async () => {
    const deco = sp({
      x: 0,
      y: 500,
      w: 960,
      h: 40,
      fill: solid(`<a:schemeClr val="accent4"/>`),
    });
    const layoutDeco = sp({
      x: 900,
      y: 0,
      w: 60,
      h: 60,
      prst: "ellipse",
      fill: solid(`<a:schemeClr val="accent5"/>`),
    });
    const opts = { master: MASTER(deco), layout: LAYOUT("", layoutDeco) };
    const shown = await readPptx(
      await pkg({ ...opts, slides: [{ xml: SLIDE("") }] }),
    );
    expect(shown.deck.slides[0].elements.map((e) => [e.type, e.fill])).toEqual([
      ["rect", "#ffc000"],
      ["ellipse", "#5b9bd5"],
    ]);
    const hidden = await readPptx(
      await pkg({
        ...opts,
        slides: [{ xml: SLIDE("", "", "", ` showMasterSp="0"`) }],
      }),
    );
    expect(hidden.deck.slides[0].elements).toEqual([]);
    const layoutHides = await readPptx(
      await pkg({
        master: MASTER(deco),
        layout: LAYOUT(` showMasterSp="0"`, layoutDeco),
        slides: [{ xml: SLIDE("") }],
      }),
    );
    expect(layoutHides.deck.slides[0].elements.map((e) => e.type)).toEqual([
      "ellipse",
    ]);
  });

  it("maps transitions, reading the mc:Fallback of AlternateContent", async () => {
    const t = (inner: string) => `<p:transition>${inner}</p:transition>`;
    const alt = `<mc:AlternateContent><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:transition><p14:vortex/></p:transition></mc:Choice><mc:Fallback>${t(`<p:push dir="r"/>`)}</mc:Fallback></mc:AlternateContent>`;
    const r = await readPptx(
      await pkg({
        slides: [
          { xml: SLIDE("", t("<p:fade/>")) },
          { xml: SLIDE("", t(`<p:push/>`)) },
          { xml: SLIDE("", t(`<p:cover dir="u"/>`)) },
          { xml: SLIDE("", alt) },
          { xml: SLIDE("", t(`<p:circle/>`)) },
          { xml: SLIDE("", `<p:transition spd="slow"/>`) },
          { xml: SLIDE("") },
        ],
      }),
    );
    expect(r.deck.slides.map((s) => s.transition)).toEqual([
      "fade",
      "slide-left",
      "slide-up",
      "slide-right",
      "fade",
      undefined,
      undefined,
    ]);
  });
});
