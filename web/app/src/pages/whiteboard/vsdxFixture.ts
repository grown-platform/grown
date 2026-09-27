/**
 * vsdxFixture.ts — builds small, hand-made .vsdx packages in code for tests
 * (vitest + the whiteboard e2e). Only the parts our reader needs are written.
 */
import JSZip from "jszip";

const NS = "http://schemas.microsoft.com/office/visio/2012/main";
const R_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.microsoft.com/visio/2010/relationships";

export interface FixturePage {
  name?: string;
  width?: number;
  height?: number;
  /** Inner XML of <Shapes>. */
  shapes: string;
  /** Inner XML of <Connects>. */
  connects?: string;
  /** Extra page relationships: id → target relative to visio/pages/. */
  rels?: Record<string, string>;
}
export interface FixtureMaster {
  id: string;
  name: string;
  shapes: string;
}
export interface FixtureOptions {
  pages: FixturePage[];
  masters?: FixtureMaster[];
  /** Inner XML of <StyleSheets>. */
  styleSheets?: string;
  /** Extra package files: path → content. */
  files?: Record<string, string | Uint8Array>;
}

/** cell renders a ShapeSheet <Cell>. */
export const cell = (n: string, v: string | number) =>
  `<Cell N="${n}" V="${v}"/>`;

/** xform renders the usual 2-D transform cells (inches). */
export function xform(
  pinX: number,
  pinY: number,
  w: number,
  h: number,
  angle = 0,
): string {
  return (
    cell("PinX", pinX) +
    cell("PinY", pinY) +
    cell("Width", w) +
    cell("Height", h) +
    cell("LocPinX", w / 2) +
    cell("LocPinY", h / 2) +
    (angle ? cell("Angle", angle) : "")
  );
}

type Row = [string, Record<string, number | string>];
/** geom renders a Geometry section from [type, cells] rows. */
export function geom(rows: Row[], ix = 0, extra = ""): string {
  return (
    `<Section N="Geometry" IX="${ix}">${cell("NoFill", 0)}${cell("NoLine", 0)}${extra}` +
    rows
      .map(
        ([t, cells], i) =>
          `<Row T="${t}" IX="${i + 1}">` +
          Object.entries(cells)
            .map(([k, v]) => cell(k, v))
            .join("") +
          `</Row>`,
      )
      .join("") +
    `</Section>`
  );
}

/** rectGeom: a closed rectangle path using Width/Height-relative points. */
export function rectGeom(w: number, h: number): string {
  return geom([
    ["MoveTo", { X: 0, Y: 0 }],
    ["LineTo", { X: w, Y: 0 }],
    ["LineTo", { X: w, Y: h }],
    ["LineTo", { X: 0, Y: h }],
    ["LineTo", { X: 0, Y: 0 }],
  ]);
}

export function ellipseGeom(w: number, h: number): string {
  return geom([
    ["Ellipse", { X: w / 2, Y: h / 2, A: w, B: h / 2, C: w / 2, D: h }],
  ]);
}

export function shape(
  id: string | number,
  inner: string,
  attrs: Record<string, string | number> = {},
): string {
  const a = Object.entries({ NameU: `Shape${id}`, Type: "Shape", ...attrs })
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
  return `<Shape ID="${id}"${a}>${inner}</Shape>`;
}

function rels(list: [string, string, string][]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    list
      .map(
        ([id, type, target]) =>
          `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`,
      )
      .join("") +
    `</Relationships>`
  );
}

/** buildVsdx zips a minimal Visio package. */
export async function buildVsdx(opts: FixtureOptions): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    rels([
      [
        "rId1",
        "http://schemas.microsoft.com/visio/2010/relationships/document",
        "visio/document.xml",
      ],
    ]),
  );
  zip.file(
    "visio/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><VisioDocument xmlns="${NS}" xmlns:r="${R_NS}"><StyleSheets>${opts.styleSheets ?? ""}</StyleSheets></VisioDocument>`,
  );
  const docRels: [string, string, string][] = [
    ["rId1", `${REL}/pages`, "pages/pages.xml"],
  ];
  if (opts.masters?.length)
    docRels.push(["rId2", `${REL}/masters`, "masters/masters.xml"]);
  zip.file("visio/_rels/document.xml.rels", rels(docRels));

  zip.file(
    "visio/pages/pages.xml",
    `<?xml version="1.0" encoding="UTF-8"?><Pages xmlns="${NS}" xmlns:r="${R_NS}">` +
      opts.pages
        .map(
          (p, i) =>
            `<Page ID="${i}" NameU="${p.name ?? `Page-${i + 1}`}" Name="${p.name ?? `Page-${i + 1}`}"><PageSheet>${cell("PageWidth", p.width ?? 8.5)}${cell("PageHeight", p.height ?? 11)}</PageSheet><Rel r:id="rId${i + 1}"/></Page>`,
        )
        .join("") +
      `</Pages>`,
  );
  zip.file(
    "visio/pages/_rels/pages.xml.rels",
    rels(
      opts.pages.map((_, i) => [
        `rId${i + 1}`,
        `${REL}/page`,
        `page${i + 1}.xml`,
      ]),
    ),
  );
  opts.pages.forEach((p, i) => {
    zip.file(
      `visio/pages/page${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><PageContents xmlns="${NS}" xmlns:r="${R_NS}"><Shapes>${p.shapes}</Shapes>${p.connects ? `<Connects>${p.connects}</Connects>` : ""}</PageContents>`,
    );
    if (p.rels)
      zip.file(
        `visio/pages/_rels/page${i + 1}.xml.rels`,
        rels(Object.entries(p.rels).map(([id, t]) => [id, `${REL}/image`, t])),
      );
  });

  if (opts.masters?.length) {
    zip.file(
      "visio/masters/masters.xml",
      `<?xml version="1.0" encoding="UTF-8"?><Masters xmlns="${NS}" xmlns:r="${R_NS}">` +
        opts.masters
          .map(
            (m, i) =>
              `<Master ID="${m.id}" NameU="${m.name}" Name="${m.name}"><Rel r:id="rId${i + 1}"/></Master>`,
          )
          .join("") +
        `</Masters>`,
    );
    zip.file(
      "visio/masters/_rels/masters.xml.rels",
      rels(
        opts.masters.map((_, i) => [
          `rId${i + 1}`,
          `${REL}/master`,
          `master${i + 1}.xml`,
        ]),
      ),
    );
    opts.masters.forEach((m, i) =>
      zip.file(
        `visio/masters/master${i + 1}.xml`,
        `<?xml version="1.0" encoding="UTF-8"?><MasterContents xmlns="${NS}" xmlns:r="${R_NS}"><Shapes>${m.shapes}</Shapes></MasterContents>`,
      ),
    );
  }
  for (const [path, content] of Object.entries(opts.files ?? {}))
    zip.file(path, content);
  return zip.generateAsync({ type: "uint8array" });
}
