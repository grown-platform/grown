/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet cell objects are loosely typed. */

// Cell styles between FortuneSheet cells and xl/styles.xml (§18.8).
//
// FortuneSheet keeps formatting on each cell: `ct.fa` (number format code),
// `ff` font (name, or an index into its font list), `fs` size (pt), `fc`
// colour, `bl`/`it`/`cl`/`un` (bold, italic, strike, underline as 0/1),
// `bg` fill, `ht` horizontal (0 centre, 1 left, 2 right), `vt` vertical
// (0 middle, 1 top, 2 bottom), `tb` wrap ("0" clip, "1" overflow, "2" wrap),
// `tr` rotation ("1" 45°, "2" −45°, "3" stacked, "4" 90° up, "5" 90° down),
// `lo` locked (0 = unlocked). Borders live on the sheet (`config.borderInfo`).

import { resolveImportedFont } from "../../../lib/fonts";
import type { CfStyle } from "../cfOps";
import { all, attr, attrs, boolAttr, esc, kid, kids, numAttr, readColor, toArgb } from "./ooxml";

// ---- number formats --------------------------------------------------------------------

/** Built-in number formats (§18.8.30) with the codes Excel shows for en-US. */
export const BUILTIN_NUMFMTS: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  5: '"$"#,##0_);\\("$"#,##0\\)',
  6: '"$"#,##0_);[Red]\\("$"#,##0\\)',
  7: '"$"#,##0.00_);\\("$"#,##0.00\\)',
  8: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss.0",
  48: "##0.0E+0",
  49: "@",
};

const BUILTIN_BY_CODE = new Map(Object.entries(BUILTIN_NUMFMTS).map(([k, v]) => [v, Number(k)]));

/** True when a format code shows a date or time. */
export function isDateFormat(code: string): boolean {
  if (!code || code === "General" || code === "@") return false;
  const stripped = code.replace(/"[^"]*"|\[(?!h\]|hh\]|m\]|mm\]|s\]|ss\])[^\]]*\]|\\.|_.|\*./gi, "");
  return /[dyhs]/i.test(stripped) || /(^|[^0#?])m/i.test(stripped);
}

// ---- borders ---------------------------------------------------------------------------

/** FortuneSheet border style numbers ↔ ST_BorderStyle. */
export const BORDER_STYLES = [
  "none",
  "thin",
  "hair",
  "dotted",
  "dashed",
  "dashDot",
  "dashDotDot",
  "double",
  "medium",
  "mediumDashed",
  "mediumDashDot",
  "mediumDashDotDot",
  "slantDashDot",
  "thick",
] as const;

export interface BorderSide {
  style: number;
  color: string;
}
export interface CellBorder {
  l?: BorderSide;
  r?: BorderSide;
  t?: BorderSide;
  b?: BorderSide;
}

// ---- reading ---------------------------------------------------------------------------

export interface ReadStyle {
  /** Cell fields to spread onto the FortuneSheet cell (no v/m). */
  cell: Record<string, any>;
  /** Number format code (General when absent). */
  fmt: string;
  border: CellBorder | null;
  locked: boolean;
  hidden: boolean;
}

export interface ReadStyles {
  xfs: ReadStyle[];
  dxfs: CfStyle[];
  /** Default font size (pt) and name: cells only get ff/fs when they differ. */
  defaultFont: { name: string; size: number };
}

const H_ALIGN: Record<string, number> = { center: 0, centerContinuous: 0, left: 1, right: 2, justify: 1, distributed: 0, fill: 1 };
const V_ALIGN: Record<string, number> = { center: 0, top: 1, bottom: 2, justify: 0, distributed: 0 };

function readFont(el: Element | null, theme: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  if (!el) return out;
  const b = kid(el, "b");
  if (b && boolAttr(b, "val", true)) out.bl = 1;
  const i = kid(el, "i");
  if (i && boolAttr(i, "val", true)) out.it = 1;
  const s = kid(el, "strike");
  if (s && boolAttr(s, "val", true)) out.cl = 1;
  const u = kid(el, "u");
  if (u && attr(u, "val") !== "none") out.un = 1;
  const sz = numAttr(kid(el, "sz"), "val");
  if (sz !== null) out.fs = sz;
  const name = attr(kid(el, "name"), "val");
  // Keep the name; Calibri & co. render with the bundled fallback (CC7).
  if (name) out.ff = resolveImportedFont(name) || name;
  const color = readColor(kid(el, "color"), theme);
  if (color) out.fc = color;
  return out;
}

function readFill(el: Element | null, theme: string[], dxf = false): string | null {
  const pf = kid(el, "patternFill");
  if (pf) {
    const type = attr(pf, "patternType");
    // In a dxf the fill colour is bgColor and the pattern defaults to solid.
    if (dxf) return readColor(kid(pf, "bgColor"), theme) ?? readColor(kid(pf, "fgColor"), theme);
    if (!type || type === "none") return null;
    if (type === "solid") return readColor(kid(pf, "fgColor"), theme) ?? readColor(kid(pf, "bgColor"), theme);
    // Patterns are approximated by their foreground colour.
    return readColor(kid(pf, "fgColor"), theme) ?? readColor(kid(pf, "bgColor"), theme);
  }
  const gf = kid(el, "gradientFill");
  if (gf) {
    const stop = kids(gf, "stop")[0];
    return readColor(kid(stop, "color"), theme);
  }
  return null;
}

function readBorder(el: Element | null, theme: string[]): CellBorder | null {
  if (!el) return null;
  const out: CellBorder = {};
  const side = (names: string[]): BorderSide | undefined => {
    for (const n of names) {
      const s = kid(el, n);
      const st = attr(s, "style");
      if (!s || !st || st === "none") continue;
      const idx = BORDER_STYLES.indexOf(st as (typeof BORDER_STYLES)[number]);
      return { style: idx > 0 ? idx : 1, color: readColor(kid(s, "color"), theme, "#000000") ?? "#000000" };
    }
    return undefined;
  };
  const l = side(["left", "start"]);
  const r = side(["right", "end"]);
  const t = side(["top"]);
  const b = side(["bottom"]);
  if (l) out.l = l;
  if (r) out.r = r;
  if (t) out.t = t;
  if (b) out.b = b;
  return l || r || t || b ? out : null;
}

function rotationCode(deg: number | null): string | undefined {
  if (deg === null || deg === 0) return undefined;
  if (deg === 255) return "3";
  if (deg === 90) return "4";
  if (deg === 180) return "5";
  if (deg > 0 && deg <= 90) return "1";
  if (deg > 90 && deg <= 180) return "2";
  return undefined;
}

export function readStyles(doc: Document | null, theme: string[]): ReadStyles {
  const numFmts = new Map<number, string>();
  for (const nf of all(doc, "numFmt")) {
    const id = numAttr(nf, "numFmtId");
    const code = attr(nf, "formatCode");
    if (id !== null && code !== null) numFmts.set(id, code);
  }
  const root = doc?.documentElement ?? null;
  const fonts = kids(kid(root, "fonts"), "font").map((f) => readFont(f, theme));
  const fills = kids(kid(root, "fills"), "fill").map((f) => readFill(f, theme));
  const borders = kids(kid(root, "borders"), "border").map((b) => readBorder(b, theme));
  const firstFont = kids(kid(root, "fonts"), "font")[0] ?? null;
  const defaultFont = {
    name: attr(kid(firstFont, "name"), "val") ?? "Calibri",
    size: numAttr(kid(firstFont, "sz"), "val") ?? 11,
  };
  const xfs: ReadStyle[] = kids(kid(root, "cellXfs"), "xf").map((xf) => {
    const cell: Record<string, any> = {};
    const font = fonts[numAttr(xf, "fontId") ?? 0] ?? {};
    for (const [k, v] of Object.entries(font)) {
      if (k === "fs" && v === defaultFont.size) continue;
      if (k === "ff" && v === defaultFont.name) continue;
      if (k === "fc" && v === "#000000") continue;
      cell[k] = v;
    }
    const fill = fills[numAttr(xf, "fillId") ?? 0];
    if (fill) cell.bg = fill;
    const al = kid(xf, "alignment");
    if (al) {
      const h = attr(al, "horizontal");
      if (h && h in H_ALIGN) cell.ht = H_ALIGN[h];
      const v = attr(al, "vertical");
      if (v && v in V_ALIGN) cell.vt = V_ALIGN[v];
      if (boolAttr(al, "wrapText")) cell.tb = "2";
      else if (boolAttr(al, "shrinkToFit")) cell.tb = "0";
      const tr = rotationCode(numAttr(al, "textRotation"));
      if (tr) cell.tr = tr;
    }
    const numFmtId = numAttr(xf, "numFmtId") ?? 0;
    const fmt = numFmts.get(numFmtId) ?? BUILTIN_NUMFMTS[numFmtId] ?? "General";
    const prot = kid(xf, "protection");
    return {
      cell,
      fmt,
      border: borders[numAttr(xf, "borderId") ?? 0] ?? null,
      locked: prot ? boolAttr(prot, "locked", true) : true,
      hidden: prot ? boolAttr(prot, "hidden", false) : false,
    };
  });
  const dxfs: CfStyle[] = kids(kid(root, "dxfs"), "dxf").map((d) => {
    const st: CfStyle = {};
    const f = readFont(kid(d, "font"), theme);
    if (f.fc) st.color = f.fc;
    if (f.bl) st.bold = true;
    if (f.it) st.italic = true;
    if (f.un) st.underline = true;
    if (f.cl) st.strike = true;
    const fill = readFill(kid(d, "fill"), theme, true);
    if (fill) st.fill = fill;
    return st;
  });
  return { xfs, dxfs, defaultFont };
}

// ---- writing ---------------------------------------------------------------------------

/** Default font for exported workbooks (FortuneSheet's own default). */
export const EXPORT_FONT = { name: "Arial", size: 10 };

const FS_FONTS = ["Times New Roman", "Arial", "Tahoma", "Verdana"];

function fontName(ff: unknown): string | null {
  if (typeof ff === "number") return FS_FONTS[ff] ?? null;
  if (typeof ff === "string" && ff.trim()) return /^\d+$/.test(ff) ? (FS_FONTS[Number(ff)] ?? null) : ff;
  return null;
}

const H_NAME = ["center", "left", "right"];
const V_NAME = ["center", "top", "bottom"];
const ROT_DEG: Record<string, number> = { "1": 45, "2": 135, "3": 255, "4": 90, "5": 180 };

/** Collects unique fonts/fills/borders/numFmts/xfs/dxfs and writes styles.xml. */
export class StyleBuilder {
  private fonts: string[] = [];
  private fills: string[] = [];
  private borders: string[] = [];
  private numFmts = new Map<string, number>();
  private xfs: string[] = [];
  private xfIndex = new Map<string, number>();
  private dxfs: string[] = [];
  private dxfIndex = new Map<string, number>();
  private fontIndex = new Map<string, number>();
  private fillIndex = new Map<string, number>();
  private borderIndex = new Map<string, number>();

  constructor() {
    this.font(`<font><sz val="${EXPORT_FONT.size}"/><name val="${EXPORT_FONT.name}"/><family val="2"/></font>`);
    // Fills 0 and 1 are reserved (none, gray125).
    this.fill('<fill><patternFill patternType="none"/></fill>');
    this.fill('<fill><patternFill patternType="gray125"/></fill>');
    this.border("<border><left/><right/><top/><bottom/><diagonal/></border>");
    this.xf('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
  }

  private font(xml: string): number {
    return intern(this.fonts, this.fontIndex, xml);
  }
  private fill(xml: string): number {
    return intern(this.fills, this.fillIndex, xml);
  }
  private border(xml: string): number {
    return intern(this.borders, this.borderIndex, xml);
  }
  private xf(xml: string): number {
    return intern(this.xfs, this.xfIndex, xml);
  }

  numFmtId(code: string | undefined): number {
    if (!code || code === "General") return 0;
    const builtin = BUILTIN_BY_CODE.get(code);
    if (builtin !== undefined) return builtin;
    let id = this.numFmts.get(code);
    if (id === undefined) {
      id = 164 + this.numFmts.size;
      this.numFmts.set(code, id);
    }
    return id;
  }

  /** The cellXfs index for a FortuneSheet cell's formatting (0 = default). */
  cellStyle(cell: any, border: CellBorder | null, unlocked = false): number {
    if (!cell && !border && !unlocked) return 0;
    const c = cell ?? {};
    let fontXml = "<font>";
    if (Number(c.bl) === 1) fontXml += "<b/>";
    if (Number(c.it) === 1) fontXml += "<i/>";
    if (Number(c.cl) === 1) fontXml += "<strike/>";
    if (Number(c.un) === 1) fontXml += "<u/>";
    const fs = Number(c.fs);
    fontXml += `<sz val="${Number.isFinite(fs) && fs > 0 ? fs : EXPORT_FONT.size}"/>`;
    const fc = toArgb(c.fc);
    if (fc && fc !== "FF000000") fontXml += `<color rgb="${fc}"/>`;
    fontXml += `<name val="${esc(fontName(c.ff) ?? EXPORT_FONT.name)}"/><family val="2"/></font>`;
    const fontId = this.font(fontXml);
    const bg = toArgb(c.bg);
    const fillId = bg ? this.fill(`<fill><patternFill patternType="solid"><fgColor rgb="${bg}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    let borderId = 0;
    if (border && (border.l || border.r || border.t || border.b)) {
      const side = (tag: string, s?: BorderSide) => {
        if (!s || !s.style) return `<${tag}/>`;
        const name = BORDER_STYLES[s.style] ?? "thin";
        return `<${tag} style="${name}"><color rgb="${toArgb(s.color) ?? "FF000000"}"/></${tag}>`;
      };
      borderId = this.border(`<border>${side("left", border.l)}${side("right", border.r)}${side("top", border.t)}${side("bottom", border.b)}<diagonal/></border>`);
    }
    const numFmtId = this.numFmtId(c.ct?.fa);
    let align = "";
    const al: Record<string, string | number | undefined> = {};
    const ht = c.ht === undefined || c.ht === null || c.ht === "" ? null : Number(c.ht);
    if (ht !== null && H_NAME[ht]) al.horizontal = H_NAME[ht];
    const vt = c.vt === undefined || c.vt === null || c.vt === "" ? null : Number(c.vt);
    if (vt !== null && V_NAME[vt] && vt !== 2) al.vertical = V_NAME[vt];
    if (String(c.tb) === "2") al.wrapText = 1;
    if (c.tr !== undefined && ROT_DEG[String(c.tr)]) al.textRotation = ROT_DEG[String(c.tr)];
    if (Object.keys(al).length) align = `<alignment${attrs(al)}/>`;
    const prot = unlocked || c.lo === 0 ? '<protection locked="0"/>' : "";
    const xml =
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
      (numFmtId ? ' applyNumberFormat="1"' : "") +
      (fontId ? ' applyFont="1"' : "") +
      (fillId ? ' applyFill="1"' : "") +
      (borderId ? ' applyBorder="1"' : "") +
      (align ? ' applyAlignment="1"' : "") +
      (prot ? ' applyProtection="1"' : "") +
      (align || prot ? `>${align}${prot}</xf>` : "/>");
    return this.xf(xml);
  }

  /** A differential format for a conditional-formatting style. */
  dxf(style: CfStyle | undefined): number | null {
    if (!style) return null;
    let font = "";
    if (style.bold) font += "<b/>";
    if (style.italic) font += "<i/>";
    if (style.strike) font += "<strike/>";
    if (style.underline) font += "<u/>";
    const fc = toArgb(style.color);
    if (fc) font += `<color rgb="${fc}"/>`;
    const bg = toArgb(style.fill);
    const xml =
      "<dxf>" +
      (font ? `<font>${font}</font>` : "") +
      (bg ? `<fill><patternFill><bgColor rgb="${bg}"/></patternFill></fill>` : "") +
      "</dxf>";
    if (xml === "<dxf></dxf>") return null;
    return intern(this.dxfs, this.dxfIndex, xml);
  }

  xml(): string {
    const numFmts = [...this.numFmts.entries()]
      .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`)
      .join("");
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (this.numFmts.size ? `<numFmts count="${this.numFmts.size}">${numFmts}</numFmts>` : "") +
      `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join("")}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      `<dxfs count="${this.dxfs.length}">${this.dxfs.join("")}</dxfs>` +
      '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
      "</styleSheet>"
    );
  }
}

function intern(list: string[], index: Map<string, number>, xml: string): number {
  let i = index.get(xml);
  if (i === undefined) {
    i = list.length;
    list.push(xml);
    index.set(xml, i);
  }
  return i;
}

// ---- sheet borders ---------------------------------------------------------------------

/**
 * Flattens FortuneSheet's `config.borderInfo` (per-cell entries and range
 * entries with border-all/outside/inside/horizontal/vertical/left/right/top/
 * bottom/none) into per-cell sides, keyed "r_c". Later entries win.
 */
export function flattenBorders(borderInfo: unknown): Map<string, CellBorder> {
  const out = new Map<string, CellBorder>();
  const get = (r: number, c: number) => {
    const k = `${r}_${c}`;
    let b = out.get(k);
    if (!b) {
      b = {};
      out.set(k, b);
    }
    return b;
  };
  const set = (r: number, c: number, side: keyof CellBorder, s: BorderSide | null) => {
    if (r < 0 || c < 0) return;
    const b = get(r, c);
    if (s) b[side] = s;
    else delete b[side];
  };
  for (const e of Array.isArray(borderInfo) ? borderInfo : []) {
    if (!e || typeof e !== "object") continue;
    if (e.rangeType === "cell") {
      const v = e.value ?? {};
      const r = Number(v.row_index);
      const c = Number(v.col_index);
      if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
      for (const side of ["l", "r", "t", "b"] as const) {
        const s = v[side];
        if (s && Number(s.style) > 0) set(r, c, side, { style: Number(s.style), color: s.color ?? "#000000" });
      }
      continue;
    }
    if (e.rangeType !== "range") continue;
    const style = Number(e.style) || 1;
    const s: BorderSide = { style, color: e.color ?? "#000000" };
    for (const rg of Array.isArray(e.range) ? e.range : []) {
      const r1 = Number(rg?.row?.[0]);
      const r2 = Number(rg?.row?.[1] ?? rg?.row?.[0]);
      const c1 = Number(rg?.column?.[0]);
      const c2 = Number(rg?.column?.[1] ?? rg?.column?.[0]);
      if (![r1, r2, c1, c2].every(Number.isInteger)) continue;
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const top = r === r1;
          const bottom = r === r2;
          const left = c === c1;
          const right = c === c2;
          switch (e.borderType) {
            case "border-all":
              set(r, c, "t", s);
              set(r, c, "b", s);
              set(r, c, "l", s);
              set(r, c, "r", s);
              break;
            case "border-outside":
              if (top) set(r, c, "t", s);
              if (bottom) set(r, c, "b", s);
              if (left) set(r, c, "l", s);
              if (right) set(r, c, "r", s);
              break;
            case "border-inside":
              if (!bottom) set(r, c, "b", s);
              if (!right) set(r, c, "r", s);
              break;
            case "border-horizontal":
              if (!bottom) set(r, c, "b", s);
              break;
            case "border-vertical":
              if (!right) set(r, c, "r", s);
              break;
            case "border-top":
              if (top) set(r, c, "t", s);
              break;
            case "border-bottom":
              if (bottom) set(r, c, "b", s);
              break;
            case "border-left":
              if (left) set(r, c, "l", s);
              break;
            case "border-right":
              if (right) set(r, c, "r", s);
              break;
            case "border-none":
              set(r, c, "t", null);
              set(r, c, "b", null);
              set(r, c, "l", null);
              set(r, c, "r", null);
              // The neighbours' facing sides are cleared too.
              if (top) set(r - 1, c, "b", null);
              if (bottom) set(r + 1, c, "t", null);
              if (left) set(r, c - 1, "r", null);
              if (right) set(r, c + 1, "l", null);
              break;
          }
        }
      }
    }
  }
  for (const [k, b] of out) if (!b.l && !b.r && !b.t && !b.b) out.delete(k);
  return out;
}

/** Per-cell border sides → FortuneSheet `borderInfo` cell entries. */
export function bordersToInfo(cells: Map<string, CellBorder>): any[] {
  const out: any[] = [];
  for (const [k, b] of cells) {
    const [r, c] = k.split("_").map(Number);
    const value: Record<string, any> = { row_index: r, col_index: c };
    for (const side of ["l", "r", "t", "b"] as const) if (b[side]) value[side] = { ...b[side] };
    out.push({ rangeType: "cell", value });
  }
  return out;
}
