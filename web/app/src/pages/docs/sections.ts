// Sections and page setup (Docs M9), pure model.
//
// A document is a flat list of blocks. A `sectionBreak` block atom ends a
// section, Word style: the break carries the page setup of the section
// *before* it (Word's paragraph-level w:sectPr) and, as `kind`, how the
// section *after* it starts (next page / continuous / even / odd page).
// The final section's setup lives in the `docSettings` Yjs map, as do the
// document-wide settings (page colour, watermark, odd/even headers, mirror
// margins, pageless, hyphenation). No wrapper node: existing documents
// (no breaks, no settings) are one Letter section with 1in margins, which
// is what the editor always drew.
//
// All lengths are points. Header/footer content per section lives in named
// Yjs fragments (see hfFragment): the first section's default header and
// footer keep the original "header" / "footer" fragments.
import type { Node as PMNode } from "@tiptap/pm/model";

export type SectionStart = "nextPage" | "continuous" | "evenPage" | "oddPage";
export const SECTION_STARTS: SectionStart[] = ["nextPage", "continuous", "evenPage", "oddPage"];
export const SECTION_START_LABEL: Record<SectionStart, string> = {
  nextPage: "Next page",
  continuous: "Continuous",
  evenPage: "Even page",
  oddPage: "Odd page",
};

export type Orientation = "portrait" | "landscape";

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Distance from the page top to the header / bottom to the footer. */
  header: number;
  footer: number;
  gutter: number;
}

export interface Columns {
  num: number;
  /** Space between equal columns. */
  space: number;
  /** A line between columns. */
  sep: boolean;
  equal: boolean;
  /** Unequal columns: widths (num entries) and the space after each but
   *  the last (num - 1 entries). */
  widths?: number[];
  spaces?: number[];
}

export type LineNumberRestart = "newPage" | "newSection" | "continuous";
export interface LineNumbering {
  countBy: number;
  start: number;
  /** Distance from the text, 0 = automatic. */
  distance: number;
  restart: LineNumberRestart;
}

export type PageNumFmt = "decimal" | "lowerRoman" | "upperRoman" | "lowerLetter" | "upperLetter";
export interface PageNumbering {
  /** Restart at this number at the section start (null = continue). */
  start?: number | null;
  fmt?: PageNumFmt;
}

export type PageBorderStyle = "single" | "double" | "dotted" | "dashed" | "thick";
export interface PageBorders {
  style: PageBorderStyle;
  color: string;
  /** Line width. */
  width: number;
  /** Distance from the text (offsetFrom text) or the page edge. */
  space: number;
  offsetFrom: "text" | "page";
  display: "all" | "first" | "notFirst";
}

export type HfKind = "default" | "first" | "even";
export type HfWhich = "header" | "footer";

export interface SectionProps {
  pageW: number;
  pageH: number;
  orient: Orientation;
  margins: Margins;
  cols: Columns;
  /** Different first page. */
  titlePg: boolean;
  lnNum: LineNumbering | null;
  pgNum: PageNumbering;
  borders: PageBorders | null;
  /** Header/footer parts this section has of its own, as "header:first";
   *  the others are linked to the previous section (Word's "Link to
   *  previous"). The first section always owns its parts. */
  own: string[];
}

export interface Watermark {
  type: "none" | "text" | "image";
  text?: string;
  font?: string;
  size?: number | "auto";
  color?: string;
  semitransparent?: boolean;
  layout?: "diagonal" | "horizontal";
  image?: string;
  scale?: number | "auto";
  washout?: boolean;
}

export interface Hyphenation {
  auto: boolean;
  /** Hyphenation zone (pt). */
  zone: number;
  /** Maximum consecutive hyphenated lines (0 = no limit). */
  limit: number;
  caps: boolean;
}

/** Document-wide settings (the `docSettings` Yjs map). */
export interface DocSettings {
  section: SectionProps;
  pageColor: string | null;
  watermark: Watermark | null;
  /** Different odd and even pages (Word: settings/evenAndOddHeaders). */
  evenOdd: boolean;
  /** Mirror margins (inside/outside). */
  mirror: boolean;
  pageless: boolean;
  hyphenation: Hyphenation;
}

// --- units and presets ----------------------------------------------------------------------

export const PX_PER_PT = 96 / 72;
export const ptToPx = (pt: number) => pt * PX_PER_PT;
export const pxToPt = (px: number) => px / PX_PER_PT;
export const inToPt = (inch: number) => inch * 72;
export const cmToPt = (cm: number) => (cm / 2.54) * 72;
export const mmToPt = (mm: number) => cmToPt(mm / 10);

export interface PageSizePreset {
  id: string;
  name: string;
  /** Portrait width × height, points. */
  w: number;
  h: number;
}

export const PAGE_SIZES: PageSizePreset[] = [
  { id: "letter", name: "US Letter", w: 612, h: 792 },
  { id: "legal", name: "US Legal", w: 612, h: 1008 },
  { id: "a3", name: "A3", w: mmToPt(297), h: mmToPt(420) },
  { id: "a4", name: "A4", w: mmToPt(210), h: mmToPt(297) },
  { id: "a5", name: "A5", w: mmToPt(148), h: mmToPt(210) },
  { id: "b5", name: "B5", w: mmToPt(176), h: mmToPt(250) },
  { id: "executive", name: "Executive", w: 522, h: 756 },
  { id: "tabloid", name: "Tabloid", w: 792, h: 1224 },
  { id: "statement", name: "Statement", w: 396, h: 612 },
  { id: "envelope-dl", name: "Envelope DL", w: mmToPt(110), h: mmToPt(220) },
];

/** pageSizeId names a size (either orientation), or "custom". */
export function pageSizeId(p: Pick<SectionProps, "pageW" | "pageH">): string {
  const a = Math.min(p.pageW, p.pageH);
  const b = Math.max(p.pageW, p.pageH);
  const hit = PAGE_SIZES.find((s) => Math.abs(s.w - a) < 1.5 && Math.abs(s.h - b) < 1.5);
  return hit?.id ?? "custom";
}

export interface MarginPreset {
  id: string;
  name: string;
  margins: Pick<Margins, "top" | "bottom" | "left" | "right">;
  mirror?: boolean;
}

export const MARGIN_PRESETS: MarginPreset[] = [
  { id: "normal", name: "Normal", margins: { top: 72, bottom: 72, left: 72, right: 72 } },
  { id: "narrow", name: "Narrow", margins: { top: 36, bottom: 36, left: 36, right: 36 } },
  { id: "moderate", name: "Moderate", margins: { top: 72, bottom: 72, left: 54, right: 54 } },
  { id: "wide", name: "Wide", margins: { top: 72, bottom: 72, left: 144, right: 144 } },
  { id: "mirrored", name: "Mirrored", margins: { top: 72, bottom: 72, left: 90, right: 72 }, mirror: true },
  { id: "office2003", name: "Office 2003 default", margins: { top: 72, bottom: 72, left: 90, right: 90 } },
];

export const DEFAULT_MARGINS: Margins = { top: 72, right: 72, bottom: 72, left: 72, header: 36, footer: 36, gutter: 0 };
export const DEFAULT_COLUMNS: Columns = { num: 1, space: 36, sep: false, equal: true };

export function defaultSection(): SectionProps {
  return {
    pageW: 612,
    pageH: 792,
    orient: "portrait",
    margins: { ...DEFAULT_MARGINS },
    cols: { ...DEFAULT_COLUMNS },
    titlePg: false,
    lnNum: null,
    pgNum: {},
    borders: null,
    own: [],
  };
}

export const DEFAULT_HYPHENATION: Hyphenation = { auto: false, zone: 18, limit: 0, caps: true };

export function defaultSettings(): DocSettings {
  return {
    section: defaultSection(),
    pageColor: null,
    watermark: null,
    evenOdd: false,
    mirror: false,
    pageless: false,
    hyphenation: { ...DEFAULT_HYPHENATION },
  };
}

// --- (de)serialisation -----------------------------------------------------------------

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** normalizeSection fills in defaults for a partial / older record. */
export function normalizeSection(raw: unknown): SectionProps {
  const d = defaultSection();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<SectionProps>;
  const m = (r.margins ?? {}) as Partial<Margins>;
  const c = (r.cols ?? {}) as Partial<Columns>;
  const pageW = num(r.pageW, d.pageW);
  const pageH = num(r.pageH, d.pageH);
  const cols: Columns = {
    num: Math.max(1, Math.min(45, Math.round(num(c.num, 1)))),
    space: num(c.space, d.cols.space),
    sep: !!c.sep,
    equal: c.equal !== false,
  };
  if (!cols.equal && Array.isArray(c.widths)) {
    cols.widths = c.widths.slice(0, cols.num).map((w) => num(w, 0));
    cols.spaces = (c.spaces ?? []).slice(0, cols.num - 1).map((s) => num(s, 0));
  }
  return {
    pageW,
    pageH,
    orient: r.orient === "landscape" || r.orient === "portrait" ? r.orient : pageW > pageH ? "landscape" : "portrait",
    margins: {
      top: num(m.top, d.margins.top),
      right: num(m.right, d.margins.right),
      bottom: num(m.bottom, d.margins.bottom),
      left: num(m.left, d.margins.left),
      header: num(m.header, d.margins.header),
      footer: num(m.footer, d.margins.footer),
      gutter: num(m.gutter, 0),
    },
    cols,
    titlePg: !!r.titlePg,
    lnNum: r.lnNum
      ? {
          countBy: Math.max(1, num(r.lnNum.countBy, 1)),
          start: Math.max(1, num(r.lnNum.start, 1)),
          distance: Math.max(0, num(r.lnNum.distance, 0)),
          restart: r.lnNum.restart === "newSection" || r.lnNum.restart === "continuous" ? r.lnNum.restart : "newPage",
        }
      : null,
    pgNum: { ...(r.pgNum ?? {}) },
    borders: r.borders ? { ...r.borders } : null,
    own: Array.isArray(r.own) ? r.own.filter((x) => typeof x === "string") : [],
  };
}

export function parseSection(raw: unknown): SectionProps {
  if (typeof raw === "string") {
    try {
      return normalizeSection(JSON.parse(raw));
    } catch {
      return defaultSection();
    }
  }
  return normalizeSection(raw);
}

/** encodeSection is the stable string form for node attributes. */
export function encodeSection(p: SectionProps): string {
  return JSON.stringify(normalizeSection(p));
}

export function sameSection(a: SectionProps, b: SectionProps): boolean {
  return encodeSection(a) === encodeSection(b);
}

/** setOrientation swaps the page size (and margins, as Word does) when
 *  the orientation changes. */
export function setOrientation(p: SectionProps, orient: Orientation): SectionProps {
  if (p.orient === orient) return p;
  const long = Math.max(p.pageW, p.pageH);
  const short = Math.min(p.pageW, p.pageH);
  const m = p.margins;
  return {
    ...p,
    orient,
    pageW: orient === "landscape" ? long : short,
    pageH: orient === "landscape" ? short : long,
    // Word rotates the margins with the page.
    margins:
      orient === "landscape"
        ? { ...m, top: m.left, right: m.top, bottom: m.right, left: m.bottom }
        : { ...m, top: m.right, right: m.bottom, bottom: m.left, left: m.top },
  };
}

/** setPageSize applies a preset in the section's orientation. */
export function setPageSize(p: SectionProps, w: number, h: number): SectionProps {
  const a = Math.min(w, h);
  const b = Math.max(w, h);
  const landscape = p.orient === "landscape";
  return { ...p, pageW: landscape ? b : a, pageH: landscape ? a : b };
}

// --- columns (ApiSection: SetEqualColumns / SetNotEqualColumns) -------------------------------

export function setEqualColumns(p: SectionProps, num: number, space: number): SectionProps {
  return { ...p, cols: { num: Math.max(1, Math.round(num)), space: Math.max(0, space), sep: p.cols.sep, equal: true } };
}

export function setNotEqualColumns(p: SectionProps, widths: number[], spaces: number[]): SectionProps {
  const n = widths.length;
  if (!n) return p;
  return {
    ...p,
    cols: {
      num: n,
      space: spaces[0] ?? p.cols.space,
      sep: p.cols.sep,
      equal: false,
      widths: [...widths],
      spaces: spaces.slice(0, n - 1),
    },
  };
}

export const columnsCount = (p: SectionProps) => p.cols.num;

/** contentWidth is the width between the margins (points). */
export function contentWidth(p: SectionProps): number {
  return Math.max(36, p.pageW - p.margins.left - p.margins.right - p.margins.gutter);
}

/** columnWidths returns every column's width and the spaces after each but
 *  the last. Unequal widths are scaled to fit the text width. */
export function columnWidths(p: SectionProps): { widths: number[]; spaces: number[] } {
  const total = contentWidth(p);
  const n = p.cols.num;
  if (!p.cols.equal && p.cols.widths && p.cols.widths.length === n) {
    const spaces = Array.from({ length: n - 1 }, (_, i) => p.cols.spaces?.[i] ?? p.cols.space);
    const sum = p.cols.widths.reduce((a, b) => a + b, 0) + spaces.reduce((a, b) => a + b, 0);
    const k = sum > 0 ? total / sum : 1;
    return { widths: p.cols.widths.map((w) => w * k), spaces: spaces.map((s) => s * k) };
  }
  const space = n > 1 ? Math.min(p.cols.space, (total - n * 18) / (n - 1)) : 0;
  const w = (total - space * (n - 1)) / n;
  return { widths: Array(n).fill(w), spaces: Array(Math.max(0, n - 1)).fill(space) };
}

/** columnBoxes: each column's left offset from the text's left edge. */
export function columnBoxes(p: SectionProps): { x: number; w: number }[] {
  const { widths, spaces } = columnWidths(p);
  const out: { x: number; w: number }[] = [];
  let x = 0;
  for (let i = 0; i < widths.length; i++) {
    out.push({ x, w: widths[i] });
    x += widths[i] + (spaces[i] ?? 0);
  }
  return out;
}

/** Column presets (Word's Columns menu). */
export const COLUMN_PRESETS: { id: string; name: string; apply: (p: SectionProps) => SectionProps }[] = [
  { id: "one", name: "One", apply: (p) => setEqualColumns(p, 1, p.cols.space) },
  { id: "two", name: "Two", apply: (p) => setEqualColumns(p, 2, 36) },
  { id: "three", name: "Three", apply: (p) => setEqualColumns(p, 3, 36) },
  {
    id: "left",
    name: "Left",
    apply: (p) => {
      const t = contentWidth(p) - 36;
      return setNotEqualColumns(p, [t / 3, (2 * t) / 3], [36]);
    },
  },
  {
    id: "right",
    name: "Right",
    apply: (p) => {
      const t = contentWidth(p) - 36;
      return setNotEqualColumns(p, [(2 * t) / 3, t / 3], [36]);
    },
  },
];

// --- sections of a document ----------------------------------------------------------------

export interface Section {
  index: number;
  /** "final" for the last section, else the id of the break ending it. */
  id: string;
  props: SectionProps;
  /** How this section starts (the previous break's kind; the first
   *  section starts a page). */
  start: SectionStart;
  /** Top-level block indices [fromBlock, toBlock); the break itself is
   *  the last block of its section. */
  fromBlock: number;
  toBlock: number;
  /** Document positions [from, to). */
  from: number;
  to: number;
  /** Position of the break ending the section (null for the last). */
  breakPos: number | null;
}

/** sectionsOf splits a document at its top-level section breaks. */
export function sectionsOf(doc: PMNode, final: SectionProps): Section[] {
  const out: Section[] = [];
  let fromBlock = 0;
  let from = 0;
  let start: SectionStart = "nextPage";
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const end = pos + child.nodeSize;
    if (child.type.name === "sectionBreak") {
      out.push({
        index: out.length,
        id: String(child.attrs.id || `b${pos}`),
        props: parseSection(child.attrs.sectPr),
        start,
        fromBlock,
        toBlock: i + 1,
        from,
        to: end,
        breakPos: pos,
      });
      start = (SECTION_STARTS as string[]).includes(child.attrs.kind) ? (child.attrs.kind as SectionStart) : "nextPage";
      fromBlock = i + 1;
      from = end;
    }
    pos = end;
  }
  out.push({
    index: out.length,
    id: "final",
    props: final,
    start,
    fromBlock,
    toBlock: doc.childCount,
    from,
    to: doc.content.size,
    breakPos: null,
  });
  return out;
}

/** sectionAt finds the section holding a document position. */
export function sectionAt(sections: Section[], pos: number): Section {
  for (const s of sections) if (pos < s.to) return s;
  return sections[sections.length - 1];
}

// --- headers and footers -----------------------------------------------------------------

export const hfKey = (which: HfWhich, kind: HfKind) => `${which}:${kind}`;

/** The Yjs fragment holding a section's own header/footer part. */
export function ownFragment(sections: Section[], index: number, which: HfWhich, kind: HfKind): string {
  if (index === 0) return kind === "default" ? which : `hf:first-section:${kind}:${which}`;
  return `hf:${sections[index].id}:${kind}:${which}`;
}

/** Whether a section has its own part (the first section always has). */
export function ownsPart(sections: Section[], index: number, which: HfWhich, kind: HfKind): boolean {
  return index === 0 || sections[index].props.own.includes(hfKey(which, kind));
}

/**
 * hfFragment resolves which fragment a section shows for a part: its own,
 * or the nearest earlier section's (Link to previous).
 */
export function hfFragment(sections: Section[], index: number, which: HfWhich, kind: HfKind): string {
  let i = Math.max(0, Math.min(index, sections.length - 1));
  while (i > 0 && !ownsPart(sections, i, which, kind)) i--;
  return ownFragment(sections, i, which, kind);
}

/** Which header/footer variant a page uses. */
export function pageHfKind(opts: { firstOfSection: boolean; titlePg: boolean; pageNumber: number; evenOdd: boolean }): HfKind {
  if (opts.firstOfSection && opts.titlePg) return "first";
  if (opts.evenOdd && opts.pageNumber % 2 === 0) return "even";
  return "default";
}

// --- page numbers ------------------------------------------------------------------------

const ROMAN: [number, string][] = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

export function formatPageNumber(n: number, fmt: PageNumFmt | undefined): string {
  switch (fmt) {
    case "lowerRoman":
    case "upperRoman": {
      let r = "";
      let v = Math.max(1, Math.floor(n));
      for (const [k, s] of ROMAN) while (v >= k) (r += s), (v -= k);
      return fmt === "upperRoman" ? r.toUpperCase() : r;
    }
    case "lowerLetter":
    case "upperLetter": {
      // Word: a, b, …, z, aa, bb, …
      const v = Math.max(1, Math.floor(n));
      const ch = String.fromCharCode(97 + ((v - 1) % 26)).repeat(Math.floor((v - 1) / 26) + 1);
      return fmt === "upperLetter" ? ch.toUpperCase() : ch;
    }
    default:
      return String(n);
  }
}

/** CSS counter style for a page-number format. */
export const PAGE_FMT_CSS: Record<PageNumFmt, string> = {
  decimal: "decimal",
  lowerRoman: "lower-roman",
  upperRoman: "upper-roman",
  lowerLetter: "lower-alpha",
  upperLetter: "upper-alpha",
};
