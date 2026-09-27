// Paragraph and run properties <-> Grown's model (Docs M6).
//
// ECMA-376 Part 1, §17.3.1 (paragraph properties) and §17.3.2 (run
// properties). Lengths in Grown are points; OOXML uses twips (1/20 pt),
// half-points (font sizes) and eighths of a point (border widths).
//
// Both directions go through the same shapes the editor already uses:
// DirectParaProps (paragraphProps.ts) for paragraphs and styles.ts's RunPr
// plus a few mark-only fields for runs, so an imported document is the
// same model a user could have built in the editor.
import { resolveImportedFont } from "../../../lib/fonts";
import type { JSONContent } from "@tiptap/core";
import type { ParaPr, RunPr } from "../styles";
import type { Align, BorderSide, BorderSpec, Borders, LineRule, TabStop } from "../paragraphProps";
import { propsToAttrs, type DirectParaProps } from "../paragraphProps";
import { attr, el, fromHex, HIGHLIGHTS, kid, kids, num, onOff, ptToTwips, round2, toHex, twipsToPt } from "./xml";

// --- theme fonts ---------------------------------------------------------------------

export interface ThemeFonts {
  major?: string;
  minor?: string;
}

/** readThemeFonts reads the latin major/minor typefaces of theme1.xml. */
export function readThemeFonts(theme: Document | null): ThemeFonts {
  if (!theme) return {};
  const out: ThemeFonts = {};
  const all = theme.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    const ln = e.localName;
    if (ln !== "majorFont" && ln !== "minorFont") continue;
    const latin = kid(e, "latin");
    const face = attr(latin, "typeface");
    if (face) out[ln === "majorFont" ? "major" : "minor"] = face;
  }
  return out;
}

// --- paragraph properties --------------------------------------------------------------

const JC_IN: Record<string, Align> = {
  left: "left", start: "left", center: "center", right: "right", end: "right",
  both: "justify", distribute: "justify", mediumKashida: "justify", highKashida: "justify", lowKashida: "justify",
  thaiDistribute: "justify",
};

export const BORDER_IN: Record<string, BorderSpec["style"]> = {
  dashed: "dashed", dashSmallGap: "dashed", dotDash: "dashed", dotDotDash: "dashed", dashDotStroked: "dashed",
  dotted: "dotted", double: "double", triple: "double", doubleWave: "double",
  thinThickSmallGap: "double", thickThinSmallGap: "double", thinThickMediumGap: "double",
  thickThinMediumGap: "double", thinThickLargeGap: "double", thickThinLargeGap: "double",
};
export const BORDER_OUT: Record<BorderSpec["style"], string> = {
  solid: "single", dashed: "dashed", dotted: "dotted", double: "double",
};

const TAB_IN: Record<string, TabStop["align"]> = {
  left: "left", start: "left", center: "center", right: "right", end: "right", decimal: "decimal", num: "left", bar: "left",
};
const LEADER_IN: Record<string, TabStop["leader"]> = {
  dot: "dot", middleDot: "dot", hyphen: "hyphen", underscore: "underscore", heavy: "underscore",
};
const LEADER_OUT: Record<TabStop["leader"], string | null> = {
  none: null, dot: "dot", hyphen: "hyphen", underscore: "underscore",
};

export interface ReadPPr extends ParaPr {
  /** The raw (docx) paragraph style id. */
  pStyle?: string;
  /** A section ends at this paragraph (sectPr inside pPr). */
  sectionBreak?: "nextPage" | "continuous" | "evenPage" | "oddPage" | "nextColumn";
}

function readBorder(b: Element | null): BorderSpec | null {
  if (!b) return null;
  const val = attr(b, "w:val") ?? "single";
  if (/^(none|nil)$/.test(val)) return null;
  const sz = num(attr(b, "w:sz"));
  return {
    width: round2(Math.max(0.25, (sz ?? 4) / 8)),
    style: BORDER_IN[val] ?? "solid",
    color: fromHex(attr(b, "w:color")) ?? "#000000",
  };
}

/** readPPr maps a <w:pPr> (or a style's pPr) to Grown paragraph props. */
export function readPPr(pPr: Element | null | undefined): ReadPPr {
  const p: ReadPPr = {};
  if (!pPr) return p;
  const style = attr(kid(pPr, "pStyle"), "w:val");
  if (style) p.pStyle = style;
  const jc = attr(kid(pPr, "jc"), "w:val");
  if (jc && JC_IN[jc]) p.align = JC_IN[jc];

  const ind = kid(pPr, "ind");
  if (ind) {
    const left = num(attr(ind, "w:start") ?? attr(ind, "w:left"));
    const right = num(attr(ind, "w:end") ?? attr(ind, "w:right"));
    const first = num(attr(ind, "w:firstLine"));
    const hanging = num(attr(ind, "w:hanging"));
    if (left != null) p.indLeft = twipsToPt(left);
    if (right != null) p.indRight = twipsToPt(right);
    if (hanging != null) p.indFirstLine = -twipsToPt(hanging);
    else if (first != null) p.indFirstLine = twipsToPt(first);
  }

  const sp = kid(pPr, "spacing");
  if (sp) {
    const before = num(attr(sp, "w:before"));
    const after = num(attr(sp, "w:after"));
    if (before != null) p.spaceBefore = twipsToPt(before);
    if (after != null) p.spaceAfter = twipsToPt(after);
    const line = num(attr(sp, "w:line"));
    if (line != null && line > 0) {
      const rule = attr(sp, "w:lineRule") ?? "auto";
      if (rule === "exact" || rule === "atLeast") {
        p.lineRule = rule as LineRule;
        p.lineValue = twipsToPt(line);
      } else {
        p.lineRule = "auto";
        p.lineValue = round2(line / 240);
      }
    }
  }

  const keepNext = onOff(kid(pPr, "keepNext"));
  if (keepNext) p.keepNext = true;
  const keepLines = onOff(kid(pPr, "keepLines"));
  if (keepLines) p.keepLines = true;
  const pbb = onOff(kid(pPr, "pageBreakBefore"));
  if (pbb) p.pageBreakBefore = true;
  const widow = onOff(kid(pPr, "widowControl"));
  if (widow === false) p.widowControl = false;

  const outline = num(attr(kid(pPr, "outlineLvl"), "w:val"));
  if (outline != null && outline >= 0 && outline <= 9) p.outlineLevel = outline + 1;

  const pBdr = kid(pPr, "pBdr");
  if (pBdr) {
    const borders: Borders = {};
    for (const side of ["top", "bottom", "left", "right", "between"] as BorderSide[]) {
      const name = side === "left" ? ["left", "start"] : side === "right" ? ["right", "end"] : [side];
      const b = readBorder(kids(pBdr, ...name)[0] ?? null);
      if (b) borders[side] = b;
    }
    if (Object.keys(borders).length) p.borders = borders;
  }

  const shd = kid(pPr, "shd");
  const fill = fromHex(attr(shd, "w:fill"));
  if (fill && attr(shd, "w:val") !== "nil") p.shading = fill;

  const tabsEl = kid(pPr, "tabs");
  if (tabsEl) {
    const tabs: TabStop[] = [];
    for (const t of kids(tabsEl, "tab")) {
      const val = attr(t, "w:val") ?? "left";
      const pos = num(attr(t, "w:pos"));
      if (val === "clear" || pos == null) continue;
      tabs.push({
        pos: twipsToPt(pos),
        align: TAB_IN[val] ?? "left",
        leader: LEADER_IN[attr(t, "w:leader") ?? ""] ?? "none",
      });
    }
    if (tabs.length) p.tabs = tabs;
  }

  const numPr = kid(pPr, "numPr");
  if (numPr) {
    const id = attr(kid(numPr, "numId"), "w:val");
    const lvl = num(attr(kid(numPr, "ilvl"), "w:val"));
    if (id != null) {
      p.numId = String(parseInt(id, 10) || 0);
      if (lvl != null) p.numLvl = Math.max(0, Math.min(8, lvl));
    } else if (lvl != null) p.numLvl = Math.max(0, Math.min(8, lvl));
  }

  const sect = kid(pPr, "sectPr");
  if (sect) {
    const type = attr(kid(sect, "type"), "w:val") ?? "nextPage";
    p.sectionBreak = type as ReadPPr["sectionBreak"];
  }
  return p;
}

const fmtPt = (n: number) => `${Math.round(n * 100) / 100}pt`;

/** paragraphAttrs turns direct props into TipTap paragraph/heading attrs
 *  (the same encoding the editor's commands write). */
export function paragraphAttrs(p: ParaPr): Record<string, unknown> {
  const direct: Partial<Record<keyof DirectParaProps, unknown>> = {};
  const keys: (keyof DirectParaProps)[] = [
    "indLeft", "indRight", "indFirstLine", "align", "lineRule", "lineValue", "tabs", "keepNext",
    "keepLines", "widowControl", "pageBreakBefore", "borders", "shading", "outlineLevel",
  ];
  for (const k of keys) if (p[k] !== undefined) direct[k] = p[k];
  if (p.lineValue === undefined) delete direct.lineRule;
  const attrs = propsToAttrs(direct);
  if (p.align === undefined || p.align === "left") delete attrs.textAlign;
  if (p.spaceBefore !== undefined || p.spaceAfter !== undefined)
    attrs.paragraphSpacing = `${p.spaceBefore == null ? "" : fmtPt(p.spaceBefore)}|${p.spaceAfter == null ? "" : fmtPt(p.spaceAfter)}`;
  for (const [k, v] of Object.entries(attrs)) if (v == null) delete attrs[k];
  if (p.numId != null) {
    attrs.numId = p.numId;
    if (p.numId !== "0") attrs.numLvl = p.numLvl ?? 0;
  }
  return attrs;
}

/** writePPr serialises paragraph props in CT_PPrBase element order. */
export function writePPr(
  p: ParaPr,
  opts: { styleId?: string | null; numId?: string | null; numLvl?: number | null; extra?: string; rPr?: string; framePr?: string } = {},
): string {
  const parts: string[] = [];
  if (opts.styleId) parts.push(el("w:pStyle", { "w:val": opts.styleId }));
  if (p.keepNext) parts.push(el("w:keepNext"));
  if (p.keepLines) parts.push(el("w:keepLines"));
  if (p.pageBreakBefore) parts.push(el("w:pageBreakBefore"));
  if (opts.framePr) parts.push(opts.framePr);
  if (p.widowControl === false) parts.push(el("w:widowControl", { "w:val": "0" }));
  const numId = opts.numId !== undefined ? opts.numId : p.numId;
  const numLvl = opts.numLvl !== undefined ? opts.numLvl : p.numLvl;
  if (numId != null)
    parts.push(
      el(
        "w:numPr",
        {},
        (numLvl != null && numId !== "0" ? el("w:ilvl", { "w:val": numLvl }) : "") + el("w:numId", { "w:val": numId }),
      ),
    );
  if (p.borders && Object.keys(p.borders).length) {
    let b = "";
    for (const side of ["top", "left", "bottom", "right", "between"] as BorderSide[]) {
      const s = p.borders[side];
      if (!s) continue;
      b += el(`w:${side}`, {
        "w:val": BORDER_OUT[s.style] ?? "single",
        "w:sz": Math.max(2, Math.round(s.width * 8)),
        "w:space": 1,
        "w:color": toHex(s.color) ?? "auto",
      });
    }
    if (b) parts.push(el("w:pBdr", {}, b));
  }
  const shade = toHex(p.shading);
  if (shade) parts.push(el("w:shd", { "w:val": "clear", "w:color": "auto", "w:fill": shade }));
  if (p.tabs?.length) {
    const t = p.tabs
      .map((tab) =>
        el("w:tab", {
          "w:val": tab.align,
          "w:leader": LEADER_OUT[tab.leader] ?? undefined,
          "w:pos": ptToTwips(tab.pos),
        }),
      )
      .join("");
    parts.push(el("w:tabs", {}, t));
  }
  const spacing: Record<string, string | number> = {};
  if (p.spaceBefore != null) spacing["w:before"] = ptToTwips(p.spaceBefore);
  if (p.spaceAfter != null) spacing["w:after"] = ptToTwips(p.spaceAfter);
  if (p.lineValue != null) {
    const rule = p.lineRule ?? "auto";
    spacing["w:line"] = rule === "auto" ? Math.round(p.lineValue * 240) : ptToTwips(p.lineValue);
    spacing["w:lineRule"] = rule;
  }
  if (Object.keys(spacing).length) parts.push(el("w:spacing", spacing));
  const ind: Record<string, number> = {};
  if (p.indLeft != null) ind["w:left"] = ptToTwips(p.indLeft);
  if (p.indRight != null) ind["w:right"] = ptToTwips(p.indRight);
  if (p.indFirstLine != null) {
    if (p.indFirstLine < 0) ind["w:hanging"] = ptToTwips(-p.indFirstLine);
    else ind["w:firstLine"] = ptToTwips(p.indFirstLine);
  }
  if (Object.keys(ind).length) parts.push(el("w:ind", ind));
  if (p.align) parts.push(el("w:jc", { "w:val": p.align === "justify" ? "both" : p.align }));
  if (p.outlineLevel) parts.push(el("w:outlineLvl", { "w:val": p.outlineLevel - 1 }));
  if (opts.rPr) parts.push(opts.rPr);
  if (opts.extra) parts.push(opts.extra);
  return parts.length ? el("w:pPr", {}, parts.join("")) : "";
}

// --- run properties -----------------------------------------------------------------------

/** Run props: the style-level RunPr plus what only direct formatting has. */
export interface RunProps extends RunPr {
  rStyle?: string;
  vertAlign?: "sub" | "super";
  hidden?: boolean;
  /** Proofing language (w:lang w:val, BCP 47) and w:noProof (M13). */
  lang?: string;
  noProof?: boolean;
}

/** readRPr maps a <w:rPr> to run props. Theme fonts resolve through
 *  theme1.xml. */
export function readRPr(rPr: Element | null | undefined, theme: ThemeFonts = {}): RunProps {
  const r: RunProps = {};
  if (!rPr) return r;
  const rs = attr(kid(rPr, "rStyle"), "w:val");
  if (rs) r.rStyle = rs;
  const fonts = kid(rPr, "rFonts");
  if (fonts) {
    const face = attr(fonts, "w:ascii") ?? attr(fonts, "w:hAnsi");
    const themed = attr(fonts, "w:asciiTheme") ?? attr(fonts, "w:hAnsiTheme");
    const font = face ?? (themed ? (/^major/.test(themed) ? theme.major : theme.minor) : undefined);
    // Keep the name; Calibri & co. render with the bundled fallback (CC7).
    if (font) r.fontFamily = resolveImportedFont(font) || font;
  }
  const flag = (name: string, key: "bold" | "italic" | "allCaps" | "smallCaps") => {
    const v = onOff(kid(rPr, name));
    if (v !== undefined) r[key] = v;
  };
  flag("b", "bold");
  flag("i", "italic");
  flag("caps", "allCaps");
  flag("smallCaps", "smallCaps");
  const strike = onOff(kid(rPr, "strike")) ?? onOff(kid(rPr, "dstrike"));
  if (strike !== undefined) r.strike = strike;
  const u = kid(rPr, "u");
  if (u) r.underline = !/^(none)$/.test(attr(u, "w:val") ?? "single");
  const color = fromHex(attr(kid(rPr, "color"), "w:val"));
  if (color) r.color = color;
  const sz = num(attr(kid(rPr, "sz"), "w:val"));
  if (sz != null && sz > 0) r.fontSize = round2(sz / 2);
  const hl = attr(kid(rPr, "highlight"), "w:val");
  if (hl && HIGHLIGHTS[hl]) r.highlight = HIGHLIGHTS[hl];
  else {
    const shd = kid(rPr, "shd");
    const fill = fromHex(attr(shd, "w:fill"));
    if (fill && attr(shd, "w:val") !== "nil") r.highlight = fill;
  }
  const va = attr(kid(rPr, "vertAlign"), "w:val");
  if (va === "superscript") r.vertAlign = "super";
  else if (va === "subscript") r.vertAlign = "sub";
  if (onOff(kid(rPr, "vanish")) || onOff(kid(rPr, "webHidden"))) r.hidden = true;
  const lang = attr(kid(rPr, "lang"), "w:val");
  if (lang) r.lang = lang;
  if (onOff(kid(rPr, "noProof"))) r.noProof = true;
  return r;
}

/** styleRunPr keeps the fields a style's RunPr can hold. */
export function styleRunPr(r: RunProps): RunPr {
  const out: RunPr = {};
  for (const k of ["bold", "italic", "underline", "strike", "smallCaps", "allCaps", "fontFamily", "fontSize", "color", "highlight"] as const)
    if (r[k] !== undefined) (out as Record<string, unknown>)[k] = r[k];
  return out;
}

type Mark = NonNullable<JSONContent["marks"]>[number];

/** runMarks turns direct run props into TipTap marks. False flags (direct
 *  "not bold" over a bold style) have no mark and are dropped. */
export function runMarks(r: RunProps, charStyle?: string | null): Mark[] {
  const m: Mark[] = [];
  if (r.bold) m.push({ type: "bold" });
  if (r.italic) m.push({ type: "italic" });
  if (r.underline) m.push({ type: "underline" });
  if (r.strike) m.push({ type: "strike" });
  if (r.vertAlign === "sub") m.push({ type: "subscript" });
  if (r.vertAlign === "super") m.push({ type: "superscript" });
  const ts: Record<string, string> = {};
  if (r.color) ts.color = r.color;
  if (r.fontFamily) ts.fontFamily = r.fontFamily;
  if (r.fontSize) ts.fontSize = `${r.fontSize}pt`;
  if (Object.keys(ts).length) m.push({ type: "textStyle", attrs: ts });
  if (r.highlight) m.push({ type: "highlight", attrs: { color: r.highlight } });
  if (charStyle) m.push({ type: "charStyle", attrs: { styleId: charStyle } });
  if (r.lang || r.noProof) m.push({ type: "lang", attrs: { lang: r.lang ?? null, noProof: !!r.noProof } });
  return m;
}

const cssPt = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const m = /^(-?[\d.]+)\s*(pt|px|em|rem)?$/i.exec(String(v).trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "px").toLowerCase();
  return unit === "pt" ? n : unit === "px" ? n * 0.75 : n * 12;
};

/** marksRunProps reads TipTap marks back into run props (writer side). */
export function marksRunProps(marks: readonly { type: { name: string } | string; attrs?: Record<string, unknown> }[]): RunProps & { charStyle?: string } {
  const r: RunProps & { charStyle?: string } = {};
  for (const mk of marks) {
    const name = typeof mk.type === "string" ? mk.type : mk.type.name;
    const a = mk.attrs ?? {};
    if (name === "bold") r.bold = true;
    else if (name === "italic") r.italic = true;
    else if (name === "underline") r.underline = true;
    else if (name === "strike") r.strike = true;
    else if (name === "subscript") r.vertAlign = "sub";
    else if (name === "superscript") r.vertAlign = "super";
    else if (name === "code") r.fontFamily = "Courier New";
    else if (name === "highlight") r.highlight = (a.color as string) || "#ffff00";
    else if (name === "charStyle" && a.styleId) r.charStyle = String(a.styleId);
    else if (name === "lang") {
      if (a.lang) r.lang = String(a.lang);
      if (a.noProof) r.noProof = true;
    }
    else if (name === "textStyle") {
      if (a.color) r.color = String(a.color);
      if (a.fontFamily) r.fontFamily = String(a.fontFamily).split(",")[0].trim().replace(/^["']|["']$/g, "");
      const pt = cssPt(a.fontSize);
      if (pt) r.fontSize = pt;
    }
  }
  return r;
}

/** writeRPr serialises run props in CT_RPr element order. */
export function writeRPr(r: RunProps & { charStyle?: string }, extra = ""): string {
  const p: string[] = [];
  const styleId = r.charStyle ?? r.rStyle;
  if (styleId) p.push(el("w:rStyle", { "w:val": styleId }));
  if (r.fontFamily)
    p.push(el("w:rFonts", { "w:ascii": r.fontFamily, "w:hAnsi": r.fontFamily, "w:cs": r.fontFamily, "w:eastAsia": r.fontFamily }));
  if (r.bold !== undefined) p.push(r.bold ? el("w:b") : el("w:b", { "w:val": "0" }));
  if (r.italic !== undefined) p.push(r.italic ? el("w:i") : el("w:i", { "w:val": "0" }));
  if (r.allCaps) p.push(el("w:caps"));
  if (r.smallCaps) p.push(el("w:smallCaps"));
  if (r.strike !== undefined) p.push(r.strike ? el("w:strike") : el("w:strike", { "w:val": "0" }));
  if (r.noProof) p.push(el("w:noProof"));
  const color = toHex(r.color);
  if (color) p.push(el("w:color", { "w:val": color }));
  if (r.fontSize) {
    p.push(el("w:sz", { "w:val": Math.round(r.fontSize * 2) }));
    p.push(el("w:szCs", { "w:val": Math.round(r.fontSize * 2) }));
  }
  let shd = "";
  if (r.highlight) {
    const hex = toHex(r.highlight);
    const named = hex && Object.entries(HIGHLIGHTS).find(([, v]) => v.slice(1).toUpperCase() === hex)?.[0];
    if (named) p.push(el("w:highlight", { "w:val": named }));
    else if (hex) shd = el("w:shd", { "w:val": "clear", "w:color": "auto", "w:fill": hex });
  }
  if (r.underline !== undefined) p.push(el("w:u", { "w:val": r.underline ? "single" : "none" }));
  if (shd) p.push(shd);
  if (r.vertAlign) p.push(el("w:vertAlign", { "w:val": r.vertAlign === "super" ? "superscript" : "subscript" }));
  if (r.lang) p.push(el("w:lang", { "w:val": r.lang }));
  if (extra) p.push(extra);
  return p.length ? el("w:rPr", {}, p.join("")) : "";
}
