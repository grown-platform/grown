// Sections in DOCX (Docs M9): w:sectPr ⇄ SectionProps (sections.ts), and
// the document settings Grown keeps (odd/even headers, mirror margins,
// hyphenation, page colour). ECMA-376 Part 1 §17.6; elements are written
// in CT_SectPr order.
import {
  defaultSection,
  normalizeSection,
  type DocSettings,
  type HfKind,
  type HfWhich,
  type PageBorders,
  type PageNumFmt,
  type SectionProps,
  type SectionStart,
  SECTION_STARTS,
  DEFAULT_HYPHENATION,
} from "../sections";
import { attr, el, fromHex, kid, kids, num, onOff, ptToTwips, toHex, twipsToPt } from "./xml";

export interface HfRef {
  which: HfWhich;
  kind: HfKind;
  rid: string;
}

export interface ReadSection {
  props: SectionProps;
  /** How this section starts (w:type). */
  type: SectionStart;
  refs: HfRef[];
}

const PAGE_FMTS: PageNumFmt[] = ["decimal", "lowerRoman", "upperRoman", "lowerLetter", "upperLetter"];
const BORDER_STYLES: PageBorders["style"][] = ["single", "double", "dotted", "dashed", "thick"];

/** readSectPr reads a w:sectPr (null: Word's defaults, Letter). */
export function readSectPr(sect: Element | null): ReadSection {
  const d = defaultSection();
  if (!sect) return { props: d, type: "nextPage", refs: [] };
  const sz = kid(sect, "pgSz");
  const mar = kid(sect, "pgMar");
  const w = twipsToPt(num(attr(sz, "w:w")) ?? 12240);
  const h = twipsToPt(num(attr(sz, "w:h")) ?? 15840);
  const orient = attr(sz, "w:orient");
  const m = (k: string, def: number) => twipsToPt(Math.abs(num(attr(mar, k)) ?? def));
  const props: SectionProps = {
    ...d,
    pageW: w,
    pageH: h,
    orient: orient === "landscape" || (!orient && w > h) ? "landscape" : "portrait",
    margins: {
      top: m("w:top", 1440),
      right: m("w:right", 1440),
      bottom: m("w:bottom", 1440),
      left: m("w:left", 1440),
      header: m("w:header", 720),
      footer: m("w:footer", 720),
      gutter: m("w:gutter", 0),
    },
  };
  const cols = kid(sect, "cols");
  if (cols) {
    const colEls = kids(cols, "col");
    const count = num(attr(cols, "w:num")) ?? (colEls.length || 1);
    const space = twipsToPt(num(attr(cols, "w:space")) ?? 720);
    const equal = attr(cols, "w:equalWidth") == null ? !colEls.length : onOff(cols) !== false && /^(1|true|on)$/.test(attr(cols, "w:equalWidth") ?? "");
    props.cols = { num: Math.max(1, count), space, sep: /^(1|true|on)$/.test(attr(cols, "w:sep") ?? ""), equal: equal || colEls.length < 2 };
    if (!props.cols.equal) {
      props.cols.widths = colEls.map((c) => twipsToPt(num(attr(c, "w:w")) ?? 0));
      props.cols.spaces = colEls.slice(0, -1).map((c) => twipsToPt(num(attr(c, "w:space")) ?? 0));
      props.cols.num = colEls.length;
    }
  }
  props.titlePg = onOff(kid(sect, "titlePg")) ?? false;
  const ln = kid(sect, "lnNumType");
  if (ln) {
    const restart = attr(ln, "w:restart");
    props.lnNum = {
      countBy: Math.max(1, num(attr(ln, "w:countBy")) ?? 1),
      start: (num(attr(ln, "w:start")) ?? 0) + 1,
      distance: twipsToPt(num(attr(ln, "w:distance")) ?? 0),
      restart: restart === "newSection" || restart === "continuous" ? restart : "newPage",
    };
  }
  const pn = kid(sect, "pgNumType");
  if (pn) {
    const fmt = attr(pn, "w:fmt") as PageNumFmt | null;
    const start = num(attr(pn, "w:start"));
    props.pgNum = { ...(start != null ? { start } : {}), ...(fmt && PAGE_FMTS.includes(fmt) ? { fmt } : {}) };
  }
  const pb = kid(sect, "pgBorders");
  const side = pb ? kid(pb, "top") ?? kid(pb, "left") ?? kid(pb, "bottom") ?? kid(pb, "right") : null;
  if (pb && side && attr(side, "w:val") !== "nil" && attr(side, "w:val") !== "none") {
    const v = attr(side, "w:val") as PageBorders["style"];
    const disp = attr(pb, "w:display");
    props.borders = {
      style: BORDER_STYLES.includes(v) ? v : "single",
      color: fromHex(attr(side, "w:color")) ?? "#000000",
      width: (num(attr(side, "w:sz")) ?? 4) / 8,
      space: num(attr(side, "w:space")) ?? 24,
      offsetFrom: attr(pb, "w:offsetFrom") === "page" ? "page" : "text",
      display: disp === "firstPage" ? "first" : disp === "notFirstPage" ? "notFirst" : "all",
    };
  }
  const refs: HfRef[] = [];
  for (const which of ["header", "footer"] as const)
    for (const r of kids(sect, `${which}Reference`)) {
      const t = attr(r, "w:type") ?? "default";
      const rid = attr(r, "r:id");
      if (rid && (t === "default" || t === "first" || t === "even")) refs.push({ which, kind: t, rid });
    }
  const t = attr(kid(sect, "type"), "w:val") ?? "nextPage";
  const type: SectionStart = (SECTION_STARTS as string[]).includes(t) ? (t as SectionStart) : "nextPage";
  return { props: normalizeSection(props), type, refs };
}

/** writeSectPr writes a section's w:sectPr. */
export function writeSectPr(p: SectionProps, type: SectionStart, refs: HfRef[]): string {
  const refXml = (which: HfWhich) =>
    refs
      .filter((r) => r.which === which)
      .map((r) => el(`w:${which}Reference`, { "w:type": r.kind, "r:id": r.rid }))
      .join("");
  const m = p.margins;
  let cols: string;
  if (!p.cols.equal && p.cols.widths && p.cols.widths.length > 1) {
    cols = el(
      "w:cols",
      { "w:num": p.cols.widths.length, "w:sep": p.cols.sep ? 1 : undefined, "w:equalWidth": 0 },
      p.cols.widths.map((w, i) => el("w:col", { "w:w": ptToTwips(w), "w:space": i < p.cols.widths!.length - 1 ? ptToTwips(p.cols.spaces?.[i] ?? p.cols.space) : undefined })).join(""),
    );
  } else cols = el("w:cols", { "w:space": ptToTwips(p.cols.space), "w:num": p.cols.num > 1 ? p.cols.num : undefined, "w:sep": p.cols.sep ? 1 : undefined });
  const b = p.borders;
  const borders = b
    ? el(
        "w:pgBorders",
        { "w:offsetFrom": b.offsetFrom === "page" ? "page" : undefined, "w:display": b.display === "first" ? "firstPage" : b.display === "notFirst" ? "notFirstPage" : undefined },
        ["top", "left", "bottom", "right"]
          .map((s) => el(`w:${s}`, { "w:val": b.style, "w:sz": Math.round(b.width * 8), "w:space": Math.round(b.space), "w:color": toHex(b.color) ?? "000000" }))
          .join(""),
      )
    : "";
  const ln = p.lnNum
    ? el("w:lnNumType", {
        "w:countBy": p.lnNum.countBy,
        "w:start": p.lnNum.start > 1 ? p.lnNum.start - 1 : undefined,
        "w:distance": p.lnNum.distance ? ptToTwips(p.lnNum.distance) : undefined,
        "w:restart": p.lnNum.restart,
      })
    : "";
  const pn = p.pgNum.start != null || (p.pgNum.fmt && p.pgNum.fmt !== "decimal") ? el("w:pgNumType", { "w:fmt": p.pgNum.fmt && p.pgNum.fmt !== "decimal" ? p.pgNum.fmt : undefined, "w:start": p.pgNum.start ?? undefined }) : "";
  return el(
    "w:sectPr",
    {},
    refXml("header") +
      refXml("footer") +
      (type !== "nextPage" ? el("w:type", { "w:val": type }) : "") +
      el("w:pgSz", { "w:w": ptToTwips(p.pageW), "w:h": ptToTwips(p.pageH), "w:orient": p.orient === "landscape" ? "landscape" : undefined }) +
      el("w:pgMar", {
        "w:top": ptToTwips(m.top),
        "w:right": ptToTwips(m.right),
        "w:bottom": ptToTwips(m.bottom),
        "w:left": ptToTwips(m.left),
        "w:header": ptToTwips(m.header),
        "w:footer": ptToTwips(m.footer),
        "w:gutter": ptToTwips(m.gutter),
      }) +
      borders +
      ln +
      pn +
      cols +
      (p.titlePg ? el("w:titlePg") : ""),
  );
}

/** Settings Grown reads from word/settings.xml (and w:background). */
export function readSettings(settings: Document | null, docEl: Element | null): Partial<DocSettings> {
  const out: Partial<DocSettings> = {};
  const root = settings?.documentElement ?? null;
  if (root) {
    if (onOff(kid(root, "evenAndOddHeaders"))) out.evenOdd = true;
    if (onOff(kid(root, "mirrorMargins"))) out.mirror = true;
    const auto = onOff(kid(root, "autoHyphenation"));
    const zone = num(attr(kid(root, "hyphenationZone"), "w:val"));
    const limit = num(attr(kid(root, "consecutiveHyphenLimit"), "w:val"));
    const caps = onOff(kid(root, "doNotHyphenateCaps"));
    if (auto || zone != null || limit != null || caps)
      out.hyphenation = {
        ...DEFAULT_HYPHENATION,
        auto: !!auto,
        ...(zone != null ? { zone: twipsToPt(zone) } : {}),
        ...(limit != null ? { limit } : {}),
        caps: !caps,
      };
  }
  const bg = docEl ? kid(docEl, "background") : null;
  const color = fromHex(attr(bg, "w:color"));
  if (color && color.toLowerCase() !== "#ffffff") out.pageColor = color;
  return out;
}

/** The settings.xml children for Grown's document settings, in
 *  CT_Settings order around w:defaultTabStop: [before, after]. */
export function settingsXml(s: Partial<DocSettings>): [string, string] {
  let pre = "";
  if (s.pageColor) pre += el("w:displayBackgroundShape");
  if (s.mirror) pre += el("w:mirrorMargins");
  let post = "";
  const h = s.hyphenation;
  if (h?.auto) post += el("w:autoHyphenation");
  if (h && h.limit) post += el("w:consecutiveHyphenLimit", { "w:val": h.limit });
  if (h && h.zone !== DEFAULT_HYPHENATION.zone) post += el("w:hyphenationZone", { "w:val": ptToTwips(h.zone) });
  if (h && !h.caps) post += el("w:doNotHyphenateCaps");
  if (s.evenOdd) post += el("w:evenAndOddHeaders");
  return [pre, post];
}

/** The w:background element for a page colour. */
export const backgroundXml = (color: string | null | undefined) => (color ? el("w:background", { "w:color": toHex(color) ?? "FFFFFF" }) : "");
