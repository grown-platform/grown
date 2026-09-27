// Table properties <-> WordprocessingML (Docs M4, used by read.ts and
// write.ts): tblPr / trPr / tcPr for borders, style + look, widths,
// layout, alignment, cell margins, vertical alignment, row height and the
// repeated header row, and w:style definitions for Grown's templates.
//
// Written from ECMA-376 Part 1 §17.4 (tables) and §17.7.6 (table styles).
import {
  DEFAULT_LOOK,
  NO_BORDER,
  TABLE_SIDES,
  encodeMargins,
  encodeTableBorders,
  findTemplate,
  parseLook,
  parseMargins,
  parseTableBorders,
  type CellBorderSide,
  type CondFormat,
  type Margins,
  type TBorder,
  type TBorders,
  type TableLook,
  type TableBorderSide,
  type TableTemplate,
} from "../tableModel";
import { BORDER_IN, BORDER_OUT } from "./props";
import { attr, el, fromHex, kid, num, round2, toHex } from "./xml";

// --- reading ------------------------------------------------------------------------------

/** readBorder maps one CT_Border; "none"/"nil" is an explicit no-border. */
export function readTableBorder(b: Element | null): TBorder | null {
  if (!b) return null;
  const val = attr(b, "w:val") ?? "single";
  if (/^(none|nil)$/.test(val)) return { ...NO_BORDER };
  const sz = num(attr(b, "w:sz"));
  return {
    width: round2(Math.max(0.25, (sz ?? 4) / 8)),
    style: BORDER_IN[val] ?? "solid",
    color: fromHex(attr(b, "w:color")) ?? "#000000",
  };
}

const SIDE_NAMES: Record<TableBorderSide, string[]> = {
  top: ["top"],
  left: ["left", "start"],
  bottom: ["bottom"],
  right: ["right", "end"],
  insideH: ["insideH"],
  insideV: ["insideV"],
};

/** readBorders maps tblBorders / tcBorders. */
export function readBorders(e: Element | null, sides: readonly TableBorderSide[] = TABLE_SIDES): TBorders {
  const out: TBorders = {};
  if (!e) return out;
  for (const side of sides) {
    let b: TBorder | null = null;
    for (const n of SIDE_NAMES[side]) b ??= readTableBorder(kid(e, n));
    if (b) out[side] = b;
  }
  return out;
}

/** readMargins maps tblCellMar / tcMar (twips) to points; null when the
 *  element sets none. Missing sides take `base`. */
export function readMargins(e: Element | null, base: Margins): Margins | null {
  if (!e) return null;
  const side = (names: string[], d: number) => {
    for (const n of names) {
      const c = kid(e, n);
      if (!c) continue;
      const t = attr(c, "w:type") ?? "dxa";
      const w = num(attr(c, "w:w"));
      if (w != null && (t === "dxa" || t === "auto")) return round2(w / 20);
    }
    return d;
  };
  return {
    top: side(["top"], base.top),
    right: side(["right", "end"], base.right),
    bottom: side(["bottom"], base.bottom),
    left: side(["left", "start"], base.left),
  };
}

/** readLook maps CT_TblLook (attributes, or the older hex val). */
export function readLook(e: Element | null): TableLook | null {
  if (!e) return null;
  const hex = parseInt(attr(e, "w:val") ?? "", 16);
  const flag = (name: string, bit: number) => {
    const v = attr(e, `w:${name}`);
    if (v != null) return /^(1|true|on)$/i.test(v);
    return Number.isFinite(hex) ? (hex & bit) !== 0 : false;
  };
  return {
    header: flag("firstRow", 0x20),
    lastRow: flag("lastRow", 0x40),
    firstCol: flag("firstColumn", 0x80),
    lastCol: flag("lastColumn", 0x100),
    banded: !flag("noHBand", 0x200),
    bandedCols: !flag("noVBand", 0x400),
  };
}

/** readTableWidth maps tblW: 100 % -> "100%", other percentages and
 *  fixed widths -> "<n>pt" / "<n>%" (only "100%" and pt render), auto ->
 *  null. */
export function readTableWidth(e: Element | null, contentWidthPt = 468): string | null {
  if (!e) return null;
  const type = attr(e, "w:type") ?? "dxa";
  const raw = attr(e, "w:w") ?? "";
  if (type === "pct") {
    const pct = raw.endsWith("%") ? parseFloat(raw) : (num(raw) ?? 0) / 50;
    if (!(pct > 0)) return null;
    if (Math.abs(pct - 100) < 0.5) return "100%";
    return `${round2((pct / 100) * contentWidthPt)}pt`;
  }
  if (type === "dxa") {
    const w = num(raw);
    return w && w > 0 ? `${round2(w / 20)}pt` : null;
  }
  return null;
}

const JC_TABLE: Record<string, string | null> = { left: null, start: null, center: "center", right: "right", end: "right" };

export interface ReadTableProps {
  attrs: Record<string, unknown>;
  /** A style the reader doesn't know: its name, for a warning. */
  unknownStyle?: string;
}

/** Table styles from styles.xml: raw id -> element (and name). */
export type TableStyles = Map<string, { name: string; el: Element; basedOn: string | null }>;

/** styleBorders collects tblBorders along a table style's basedOn chain
 *  (the nearest definition of a side wins). */
function styleBorders(styles: TableStyles, id: string | null): TBorders {
  const chain: Element[] = [];
  const seen = new Set<string>();
  let cur = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const s = styles.get(cur);
    if (!s) break;
    chain.push(s.el);
    cur = s.basedOn;
  }
  const out: TBorders = {};
  for (const e of chain.reverse()) Object.assign(out, readBorders(kid(kid(e, "tblPr"), "tblBorders")));
  return out;
}

/** readTblPr maps a table's tblPr to Grown's table attributes. */
export function readTblPr(tblPr: Element | null, styles: TableStyles): ReadTableProps {
  const attrs: Record<string, unknown> = {};
  let unknownStyle: string | undefined;
  const styleId = attr(kid(tblPr, "tblStyle"), "w:val");
  let borders: TBorders = {};
  if (styleId) {
    const def = styles.get(styleId);
    const tpl = findTemplate(styleId) ?? (def ? findTemplate(def.name) : null);
    if (tpl) attrs.tableStyle = tpl.id;
    else if (def) {
      borders = styleBorders(styles, styleId);
      unknownStyle = def.name;
    }
  }
  Object.assign(borders, readBorders(kid(tblPr, "tblBorders")));
  if (Object.keys(borders).length) attrs.borders = encodeTableBorders(borders);
  const look = readLook(kid(tblPr, "tblLook"));
  // Word's default look is stored as null (= DEFAULT_LOOK).
  if (attrs.tableStyle && look && LOOK_ORDER.some((k) => look[k] !== DEFAULT_LOOK[k])) attrs.look = LOOK_ORDER.filter((k) => look[k]).join(" ");
  const m = readMargins(kid(tblPr, "tblCellMar"), { top: 0, right: 5.4, bottom: 0, left: 5.4 });
  if (m) attrs.cellMargins = encodeMargins(m);
  if (attr(kid(tblPr, "tblLayout"), "w:type") === "fixed") attrs.layout = "fixed";
  const width = readTableWidth(kid(tblPr, "tblW"));
  if (width) attrs.width = width;
  const jc = attr(kid(tblPr, "jc"), "w:val");
  if (jc && JC_TABLE[jc]) attrs.align = JC_TABLE[jc];
  return { attrs, unknownStyle };
}

const LOOK_ORDER: (keyof TableLook)[] = ["header", "banded", "firstCol", "lastRow", "lastCol", "bandedCols"];



const VALIGN_IN: Record<string, string | null> = { top: null, center: "middle", both: "middle", bottom: "bottom" };

/** readTcPr maps the cell properties M4 adds (borders, vertical
 *  alignment, margins). Shading and spans stay in read.ts. */
export function readTcPr(tcPr: Element | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const b = readBorders(kid(tcPr, "tcBorders"), ["top", "left", "bottom", "right"]);
  if (Object.keys(b).length) out.borders = encodeTableBorders(b);
  const v = attr(kid(tcPr, "vAlign"), "w:val");
  if (v && VALIGN_IN[v]) out.verticalAlign = VALIGN_IN[v];
  const m = readMargins(kid(tcPr, "tcMar"), { top: 0, right: 0, bottom: 0, left: 0 });
  if (m) out.margins = encodeMargins(m);
  return out;
}

/** readTrPr maps row height and the repeated header row. */
export function readTrPr(trPr: Element | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const h = num(attr(kid(trPr, "trHeight"), "w:val"));
  if (h && h > 0) out.height = round2(h / 20);
  const hdr = kid(trPr, "tblHeader");
  if (hdr && !/^(0|false|off)$/i.test(attr(hdr, "w:val") ?? "")) out.repeatHeader = true;
  return out;
}

// --- writing ------------------------------------------------------------------------------

const LEGACY: TBorder = { width: 0.5, style: "solid", color: "#ccced1" };
const XML_SIDE: Record<TableBorderSide, string> = {
  top: "top",
  left: "left",
  bottom: "bottom",
  right: "right",
  insideH: "insideH",
  insideV: "insideV",
};

export function writeBorder(side: string, b: TBorder): string {
  if (b.style === "none" || b.width <= 0) return el(`w:${side}`, { "w:val": "nil" });
  return el(`w:${side}`, {
    "w:val": BORDER_OUT[b.style as Exclude<TBorder["style"], "none">] ?? "single",
    "w:sz": Math.max(2, Math.min(96, Math.round(b.width * 8))),
    "w:space": 0,
    "w:color": toHex(b.color) ?? "auto",
  });
}

function writeBorders(tag: string, b: TBorders, sides: readonly TableBorderSide[]): string {
  const body = sides.filter((s) => b[s]).map((s) => writeBorder(XML_SIDE[s], b[s]!)).join("");
  return body ? el(tag, {}, body) : "";
}

const twips = (pt: number) => Math.round(pt * 20);

function writeMargins(tag: string, m: Margins | null): string {
  if (!m) return "";
  const side = (n: string, v: number) => el(`w:${n}`, { "w:w": twips(v), "w:type": "dxa" });
  return el(tag, {}, side("top", m.top) + side("left", m.left) + side("bottom", m.bottom) + side("right", m.right));
}

function writeLook(l: TableLook): string {
  const val =
    (l.header ? 0x20 : 0) |
    (l.lastRow ? 0x40 : 0) |
    (l.firstCol ? 0x80 : 0) |
    (l.lastCol ? 0x100 : 0) |
    (l.banded ? 0 : 0x200) |
    (l.bandedCols ? 0 : 0x400);
  return el("w:tblLook", {
    "w:val": val.toString(16).toUpperCase().padStart(4, "0"),
    "w:firstRow": +l.header,
    "w:lastRow": +l.lastRow,
    "w:firstColumn": +l.firstCol,
    "w:lastColumn": +l.lastCol,
    "w:noHBand": +!l.banded,
    "w:noVBand": +!l.bandedCols,
  });
}

/** writeTblPr writes a table's tblPr (CT_TblPr element order). A table
 *  with no style gets Grown's default light grid for the sides it doesn't
 *  set itself, so Word shows what the editor shows. */
export function writeTblPr(a: Record<string, unknown>): { xml: string; styleId: string | null } {
  const tpl = findTemplate(a.tableStyle as string | null);
  const direct = parseTableBorders(a.borders);
  const borders: TBorders = tpl ? direct : { ...Object.fromEntries(TABLE_SIDES.map((s) => [s, LEGACY])), ...direct };
  let tblW = el("w:tblW", { "w:w": 0, "w:type": "auto" });
  if (a.width === "100%") tblW = el("w:tblW", { "w:w": 5000, "w:type": "pct" });
  else if (typeof a.width === "string" && /^[\d.]+pt$/.test(a.width)) tblW = el("w:tblW", { "w:w": twips(parseFloat(a.width)), "w:type": "dxa" });
  const jc = a.align === "center" ? el("w:jc", { "w:val": "center" }) : a.align === "right" ? el("w:jc", { "w:val": "right" }) : "";
  const look = tpl ? parseLook(a.look) : { header: true, banded: true, firstCol: true, lastRow: false, lastCol: false, bandedCols: false };
  const xml = el(
    "w:tblPr",
    {},
    (tpl ? el("w:tblStyle", { "w:val": tpl.id }) : "") +
      tblW +
      jc +
      writeBorders("w:tblBorders", borders, TABLE_SIDES) +
      (a.layout === "fixed" ? el("w:tblLayout", { "w:type": "fixed" }) : "") +
      writeMargins("w:tblCellMar", parseMargins(a.cellMargins)) +
      writeLook(look),
  );
  return { xml, styleId: tpl?.id ?? null };
}

/** writeTrPr writes row height and the repeated header row. */
export function writeTrPr(a: Record<string, unknown>, header: boolean): string {
  const body =
    (typeof a.height === "number" && a.height > 0 ? el("w:trHeight", { "w:val": twips(a.height), "w:hRule": "atLeast" }) : "") +
    (a.repeatHeader || header ? el("w:tblHeader") : "");
  return body ? el("w:trPr", {}, body) : "";
}

const VALIGN_OUT: Record<string, string> = { middle: "center", bottom: "bottom" };

/** tcBordersXml / tcMarXml / vAlignXml: the M4 parts of a tcPr, in
 *  CT_TcPr order around shd (tcBorders, shd, tcMar, vAlign). `sides`
 *  limits which borders a (vertically merged) cell part writes. */
export function tcBordersXml(a: Record<string, unknown>, sides: readonly CellBorderSide[] = ["top", "left", "bottom", "right"]): string {
  const b = parseTableBorders(a.borders);
  return writeBorders("w:tcBorders", b, sides);
}
export function tcMarXml(a: Record<string, unknown>): string {
  return writeMargins("w:tcMar", parseMargins(a.margins));
}
export function vAlignXml(a: Record<string, unknown>): string {
  const v = VALIGN_OUT[a.verticalAlign as string];
  return v ? el("w:vAlign", { "w:val": v }) : "";
}

// --- table style definitions -------------------------------------------------------------------

function condXml(type: string, f: CondFormat | undefined, edge?: "top" | "bottom"): string {
  if (!f) return "";
  const rPr = (f.bold ? "<w:b/><w:bCs/>" : "") + (f.color ? el("w:color", { "w:val": toHex(f.color) ?? "auto" }) : "");
  const tcPr =
    (f.edge && edge ? el("w:tcBorders", {}, writeBorder(edge, f.edge)) : "") +
    (f.fill ? el("w:shd", { "w:val": "clear", "w:color": "auto", "w:fill": toHex(f.fill) ?? "auto" }) : "");
  if (!rPr && !tcPr) return "";
  return el("w:tblStylePr", { "w:type": type }, (rPr ? el("w:rPr", {}, rPr) : "") + (tcPr ? el("w:tcPr", {}, tcPr) : ""));
}

/** tableStyleXml is the w:style definition of a Grown template. */
export function tableStyleXml(t: TableTemplate): string {
  const band = (type: string, fill: string | undefined) =>
    fill ? el("w:tblStylePr", { "w:type": type }, el("w:tcPr", {}, el("w:shd", { "w:val": "clear", "w:color": "auto", "w:fill": toHex(fill) ?? "auto" }))) : "";
  const tblPr = el(
    "w:tblPr",
    {},
    el("w:tblStyleRowBandSize", { "w:val": 1 }) +
      el("w:tblStyleColBandSize", { "w:val": 1 }) +
      writeBorders("w:tblBorders", t.borders, TABLE_SIDES) +
      el("w:tblCellMar", {}, el("w:left", { "w:w": 108, "w:type": "dxa" }) + el("w:right", { "w:w": 108, "w:type": "dxa" })),
  );
  return el(
    "w:style",
    { "w:type": "table", "w:default": t.id === "TableNormal" ? "1" : undefined, "w:styleId": t.id },
    el("w:name", { "w:val": t.name }) +
      el("w:uiPriority", { "w:val": t.id === "TableNormal" ? 99 : 40 }) +
      tblPr +
      condXml("firstRow", t.header, "bottom") +
      condXml("lastRow", t.lastRow, "top") +
      condXml("firstCol", t.firstCol) +
      condXml("lastCol", t.lastCol) +
      band("band1Vert", t.bandCol) +
      band("band1Horz", t.band),
  );
}
