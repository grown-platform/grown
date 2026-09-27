// Fields (Docs M8): Word-style field instructions and their results.
//
// A `field` node (references.ts) stores its instruction (`instr`, e.g.
// `SEQ Figure \* ARABIC`) and its last computed `result`, like Word's
// field code + cached result. This module is pure: it parses
// instructions, formats numbers and dates the way Word's switches do, and
// computes every field's result for a document (`computeFieldResults`).
//
// Supported: PAGE, NUMPAGES / SECTIONPAGES (page placeholders until M9's
// pagination: the page resolver counts explicit page breaks, or measures
// the page in the browser), DATE / TIME (\@ date pictures), REF, PAGEREF,
// NOTEREF (\h \n \r \w \p \f), SEQ (\* format, \c \h \n \r \s) and
// STYLEREF (\n \r \s \w \p). Other instructions keep their cached result.
import type { Node as PMNode } from "@tiptap/pm/model";
import { formatNumber, type NumFmt, type NumLabel } from "./numbering";
import { paragraphStyleId, headingLevelOf, type StyleSheet } from "./styles";

// --- instructions -------------------------------------------------------------------

export interface FieldInstr {
  /** Upper-case field type ("PAGE", "REF", …); "" when empty. */
  type: string;
  /** Positional arguments (bookmark name, SEQ identifier, style name). */
  args: string[];
  /** Switches, keyed without the backslash; a flag is `true`. */
  sw: Record<string, string | true>;
  /** Every \* general format switch, in order. */
  formats: string[];
}

/** Switches that take an unquoted argument, per field type. */
const ARG_SWITCHES: Record<string, string> = { SEQ: "rs", TOC: "", STYLEREF: "" };
const GLOBAL_ARG = "@*#";

interface Tok {
  text: string;
  quoted: boolean;
  sw: boolean;
}

function tokenize(raw: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const c = raw[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      let s = "";
      i++;
      while (i < n && raw[i] !== '"') {
        if (raw[i] === "\\" && raw[i + 1] === '"') i++;
        s += raw[i++];
      }
      i++;
      out.push({ text: s, quoted: true, sw: false });
      continue;
    }
    if (c === "\\" && i + 1 < n) {
      out.push({ text: raw[i + 1], quoted: false, sw: true });
      i += 2;
      continue;
    }
    let s = "";
    while (i < n && !/\s/.test(raw[i])) s += raw[i++];
    out.push({ text: s, quoted: false, sw: false });
  }
  return out;
}

/** parseInstr reads a field instruction. */
export function parseInstr(raw: string): FieldInstr {
  const toks = tokenize(raw ?? "");
  const out: FieldInstr = { type: "", args: [], sw: {}, formats: [] };
  let k = 0;
  if (toks[0] && !toks[0].sw) {
    out.type = toks[0].text.toUpperCase();
    k = 1;
  }
  const argSw = GLOBAL_ARG + (ARG_SWITCHES[out.type] ?? "");
  for (; k < toks.length; k++) {
    const t = toks[k];
    if (!t.sw) {
      out.args.push(t.text);
      continue;
    }
    const next = toks[k + 1];
    const key = argSw.includes(t.text) ? t.text : t.text.toLowerCase();
    if (next && !next.sw && (next.quoted || argSw.includes(t.text))) {
      if (key === "*") out.formats.push(next.text);
      else out.sw[key] = next.text;
      k++;
    } else out.sw[key] = true;
  }
  return out;
}

/** fieldType returns an instruction's upper-case type. */
export const fieldType = (instr: string): string => parseInstr(instr).type;

/** Field types whose result Grown computes (others keep their cached result). */
export const COMPUTED_FIELDS = new Set([
  "PAGE", "NUMPAGES", "SECTIONPAGES", "DATE", "TIME", "REF", "PAGEREF", "NOTEREF", "SEQ", "STYLEREF",
]);

/** Field types the DOCX reader keeps as field nodes (with a cached result). */
export const KEPT_FIELDS = new Set([
  ...COMPUTED_FIELDS, "CREATEDATE", "SAVEDATE", "PRINTDATE", "AUTHOR", "TITLE", "SUBJECT", "FILENAME", "NUMWORDS", "NUMCHARS",
]);

// --- number and text formats ------------------------------------------------------------

const NUM_FORMATS: Record<string, NumFmt> = {
  ARABIC: "decimal",
  ALPHABETIC: "upperLetter",
  alphabetic: "lowerLetter",
  ROMAN: "upperRoman",
  roman: "lowerRoman",
};

/** Caption / SEQ numbering formats offered in the UI (\* switch values). */
export const SEQ_FORMATS: { id: string; label: string }[] = [
  { id: "ARABIC", label: "1, 2, 3, …" },
  { id: "alphabetic", label: "a, b, c, …" },
  { id: "ALPHABETIC", label: "A, B, C, …" },
  { id: "roman", label: "i, ii, iii, …" },
  { id: "ROMAN", label: "I, II, III, …" },
];

function ordinal(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** formatFieldNumber applies \* number formats (ARABIC, roman, …). */
export function formatFieldNumber(n: number, formats: string[]): string {
  for (const f of formats) {
    if (NUM_FORMATS[f]) return formatNumber(n, NUM_FORMATS[f]);
    const up = f.toUpperCase();
    if (NUM_FORMATS[up] && up === "ARABIC") return String(n);
    if (up === "ORDINAL") return ordinal(n);
  }
  return String(n);
}

/** applyCaseFormats applies \* Upper / Lower / Caps / FirstCap. */
export function applyCaseFormats(s: string, formats: string[]): string {
  for (const f of formats) {
    switch (f.toUpperCase()) {
      case "UPPER":
        s = s.toUpperCase();
        break;
      case "LOWER":
        s = s.toLowerCase();
        break;
      case "CAPS":
        s = s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
        break;
      case "FIRSTCAP":
        s = s.replace(/\p{L}/u, (c) => c.toUpperCase());
        break;
      default:
        break;
    }
  }
  return s;
}

// --- dates -----------------------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Date & time formats offered in the Field dialog (Word's list, en-US). */
export const DATE_FORMATS = [
  "M/d/yyyy",
  "dddd, MMMM d, yyyy",
  "MMMM d, yyyy",
  "M/d/yy",
  "yyyy-MM-dd",
  "d-MMM-yy",
  "M.d.yyyy",
  "MMM. d, yy",
  "d MMMM yyyy",
  "MMMM yy",
  "MMM-yy",
  "M/d/yyyy h:mm am/pm",
  "M/d/yyyy h:mm:ss am/pm",
  "h:mm am/pm",
  "h:mm:ss am/pm",
  "HH:mm",
  "HH:mm:ss",
];

/** formatDate renders a Word date picture (\@ "dddd, MMMM d, yyyy"). */
export function formatDate(d: Date, picture: string): string {
  let out = "";
  let i = 0;
  const p = picture;
  const hasAmPm = /am\/pm/i.test(p);
  const run = (ch: string) => {
    let j = i;
    while (j < p.length && p[j] === ch) j++;
    const len = j - i;
    i = j;
    return len;
  };
  while (i < p.length) {
    const c = p[i];
    if (c === "'") {
      const j = p.indexOf("'", i + 1);
      out += p.slice(i + 1, j < 0 ? p.length : j);
      i = j < 0 ? p.length : j + 1;
      continue;
    }
    if (/^am\/pm/i.test(p.slice(i))) {
      const s = d.getHours() < 12 ? "am" : "pm";
      out += p.slice(i, i + 2) === "AM" ? s.toUpperCase() : s;
      i += 5;
      continue;
    }
    switch (c) {
      case "d": {
        const n = run("d");
        if (n === 1) out += d.getDate();
        else if (n === 2) out += String(d.getDate()).padStart(2, "0");
        else if (n === 3) out += DAYS[d.getDay()].slice(0, 3);
        else out += DAYS[d.getDay()];
        break;
      }
      case "M": {
        const n = run("M");
        if (n === 1) out += d.getMonth() + 1;
        else if (n === 2) out += String(d.getMonth() + 1).padStart(2, "0");
        else if (n === 3) out += MONTHS[d.getMonth()].slice(0, 3);
        else out += MONTHS[d.getMonth()];
        break;
      }
      case "y": {
        const n = run("y");
        out += n <= 2 ? String(d.getFullYear() % 100).padStart(2, "0") : String(d.getFullYear());
        break;
      }
      case "h": {
        const n = run("h");
        const h = hasAmPm ? d.getHours() % 12 || 12 : d.getHours();
        out += n === 1 ? h : String(h).padStart(2, "0");
        break;
      }
      case "H": {
        const n = run("H");
        out += n === 1 ? d.getHours() : String(d.getHours()).padStart(2, "0");
        break;
      }
      case "m": {
        const n = run("m");
        out += n === 1 ? d.getMinutes() : String(d.getMinutes()).padStart(2, "0");
        break;
      }
      case "s": {
        const n = run("s");
        out += n === 1 ? d.getSeconds() : String(d.getSeconds()).padStart(2, "0");
        break;
      }
      default:
        out += c;
        i++;
    }
  }
  return out;
}

// --- results ---------------------------------------------------------------------------

export const REF_ERROR = "Error! Reference source not found.";
export const STYLE_ERROR = "Error! No text of specified style in document.";

/** Where things are in the document, for page-dependent results. */
export interface PageResolver {
  pageAt(pos: number): number;
  pageCount(): number;
}

/** explicitPages counts pages from explicit breaks (page-break nodes and
 *  "page break before" paragraphs): the page placeholder until M9. */
export function explicitPages(doc: PMNode): PageResolver {
  const starts: number[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === "pageBreak") starts.push(pos + n.nodeSize);
    else if (n.isTextblock && n.attrs.pageBreakBefore && pos > 0) starts.push(pos);
    return !n.isTextblock;
  });
  return {
    pageAt: (pos) => 1 + starts.filter((s) => s <= pos).length,
    pageCount: () => 1 + starts.length,
  };
}

export interface FieldEnv {
  doc: PMNode;
  pages: PageResolver;
  now: Date;
  sheet?: StyleSheet | null;
  /** Numbering labels by paragraph position (numbering.computeNumbering). */
  labels?: Map<number, NumLabel>;
}

/** The text an inline leaf contributes (a field's result). */
export function leafText(node: PMNode, results?: Map<number, string>, pos?: number): string {
  if (node.type.name === "field") {
    const r = pos != null ? results?.get(pos) : undefined;
    return r ?? String(node.attrs.result ?? "");
  }
  if (node.type.name === "hardBreak") return "\n";
  return "";
}

/** textBetween with field results (optionally overridden by `results`). */
export function textWithFields(doc: PMNode, from: number, to: number, results?: Map<number, string>): string {
  let s = "";
  let lastBlock = -1;
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) {
      s += node.text!.slice(Math.max(0, from - pos), to - pos);
      return false;
    }
    if (node.isTextblock) {
      if (lastBlock >= 0 && s) s += "\n";
      lastBlock = pos;
      return true;
    }
    if (node.isInline) {
      s += leafText(node, results, pos);
      return false;
    }
    return true;
  });
  return s;
}

/** Outline level of a paragraph or heading: direct, else its style's,
 *  else the heading level; 10 (body text) and none give null. */
export function outlineLevelOf(node: PMNode, sheet?: StyleSheet | null): number | null {
  if (node.type.name !== "paragraph" && node.type.name !== "heading") return null;
  const direct = node.attrs.outlineLevel as number | null | undefined;
  if (direct) return direct >= 1 && direct <= 9 ? direct : null;
  if (sheet) {
    const sid = paragraphStyleId(sheet, node);
    for (const s of sheet.chain(sid))
      if (s.pPr?.outlineLevel) return s.pPr.outlineLevel >= 1 && s.pPr.outlineLevel <= 9 ? s.pPr.outlineLevel : null;
    const hl = headingLevelOf(sheet, sid);
    if (hl) return hl;
  }
  return node.type.name === "heading" ? (node.attrs.level as number) : null;
}

interface ParaInfo {
  pos: number;
  node: PMNode;
  styleId: string;
  styleName: string;
  level: number | null;
}

interface MarkRange {
  from: number;
  to: number;
}

/** bookmarkRanges maps each bookmark name to the span it covers (first to
 *  last marked position; a point bookmark is an empty span). */
export function bookmarkRanges(doc: PMNode): Map<string, MarkRange> {
  const out = new Map<string, MarkRange>();
  doc.descendants((n, pos) => {
    if (n.type.name === "bookmarkPoint") {
      const name = String(n.attrs.name ?? "");
      if (name && !out.has(name)) out.set(name, { from: pos, to: pos });
      return false;
    }
    if (!n.isInline) return true;
    for (const m of n.marks) {
      if (m.type.name !== "bookmark") continue;
      const name = String(m.attrs.name ?? "");
      if (!name) continue;
      const r = out.get(name);
      if (!r) out.set(name, { from: pos, to: pos + n.nodeSize });
      else {
        r.from = Math.min(r.from, pos);
        r.to = Math.max(r.to, pos + n.nodeSize);
      }
    }
    return false;
  });
  return out;
}

function trimLabel(s: string): string {
  return s.replace(/[.)\]:\s]+$/u, "").replace(/^[(\s]+/u, "");
}

/** noteNumber: 1-based number of the note node at pos among its kind. */
function noteNumbers(doc: PMNode): Map<number, string> {
  const out = new Map<number, string>();
  let fn = 0;
  let en = 0;
  doc.descendants((n, pos) => {
    if (n.type.name === "footnote") out.set(pos, String(++fn));
    else if (n.type.name === "endnote") out.set(pos, formatNumber(++en, "lowerRoman"));
    return true;
  });
  return out;
}

/**
 * computeFieldResults computes the result of every field in the document,
 * keyed by position. Fields whose type Grown doesn't compute are left out
 * (they keep their cached result).
 */
export function computeFieldResults(env: FieldEnv): Map<number, string> {
  const { doc, sheet } = env;
  const out = new Map<number, string>();
  const paras: ParaInfo[] = [];
  const fields: { pos: number; node: PMNode; para: number; instr: FieldInstr }[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === "tableOfContents") return false;
    if (n.isTextblock) {
      const styleId = sheet && (n.type.name === "paragraph" || n.type.name === "heading") ? paragraphStyleId(sheet, n) : n.type.name === "heading" ? `Heading${n.attrs.level}` : "Normal";
      paras.push({
        pos,
        node: n,
        styleId,
        styleName: sheet?.get(styleId)?.name ?? styleId.replace(/^Heading(\d)$/, "Heading $1"),
        level: outlineLevelOf(n, sheet),
      });
      return true;
    }
    if (n.type.name === "field") {
      const instr = parseInstr(String(n.attrs.instr ?? ""));
      if (!n.attrs.locked && COMPUTED_FIELDS.has(instr.type)) fields.push({ pos, node: n, para: paras.length - 1, instr });
      return false;
    }
    return true;
  });

  // Phase 1: fields that depend only on their place.
  const seq = new Map<string, { value: number; epoch: number }>();
  const lastHeading: number[] = Array(11).fill(-1);
  let paraCursor = 0;
  const advanceHeadings = (upto: number) => {
    for (; paraCursor <= upto && paraCursor < paras.length; paraCursor++) {
      const lvl = paras[paraCursor].level;
      if (lvl) lastHeading[lvl] = paraCursor;
    }
  };
  for (const f of fields) {
    advanceHeadings(f.para);
    const { instr } = f;
    switch (instr.type) {
      case "PAGE":
        out.set(f.pos, formatFieldNumber(env.pages.pageAt(f.pos), instr.formats));
        break;
      case "NUMPAGES":
      case "SECTIONPAGES":
        out.set(f.pos, formatFieldNumber(env.pages.pageCount(), instr.formats));
        break;
      case "DATE":
      case "TIME": {
        const pic = typeof instr.sw["@"] === "string" ? (instr.sw["@"] as string) : instr.type === "DATE" ? "M/d/yyyy" : "h:mm am/pm";
        out.set(f.pos, formatDate(env.now, pic));
        break;
      }
      case "SEQ": {
        const id = (instr.args[0] ?? "").toLowerCase();
        const st = seq.get(id) ?? { value: 0, epoch: -1 };
        const sLvl = typeof instr.sw.s === "string" ? parseInt(instr.sw.s, 10) : 0;
        if (sLvl >= 1 && sLvl <= 9) {
          const epoch = Math.max(...lastHeading.slice(1, sLvl + 1));
          if (epoch !== st.epoch) {
            st.value = 0;
            st.epoch = epoch;
          }
        }
        if (typeof instr.sw.r === "string" && /^\d+$/.test(instr.sw.r)) st.value = parseInt(instr.sw.r, 10);
        else if (!instr.sw.c) st.value += 1;
        seq.set(id, st);
        out.set(f.pos, instr.sw.h ? "" : formatFieldNumber(st.value, instr.formats));
        break;
      }
      case "STYLEREF": {
        const key = (instr.args[0] ?? "").trim();
        const match = (p: ParaInfo) =>
          /^\d$/.test(key) ? p.level === +key && (p.node.type.name === "heading" || /^Heading\d$/.test(p.styleId)) : p.styleName.toLowerCase() === key.toLowerCase() || p.styleId.toLowerCase() === key.toLowerCase();
        let hit = -1;
        for (let i = Math.min(f.para, paras.length - 1); i >= 0; i--)
          if (match(paras[i]) && i !== f.para) {
            hit = i;
            break;
          }
        if (hit < 0) hit = paras.findIndex((p, i) => i > f.para && match(p));
        if (hit < 0) {
          out.set(f.pos, STYLE_ERROR);
          break;
        }
        const p = paras[hit];
        if (instr.sw.n || instr.sw.r || instr.sw.s || instr.sw.w) {
          const label = env.labels?.get(p.pos)?.text;
          if (label) out.set(f.pos, instr.sw.w || instr.sw.s ? trimLabel(label) : trimLabel(label).split(/[.)]/).filter(Boolean).pop() || trimLabel(label));
          else {
            // Grown: an unnumbered heading counts as its ordinal (chapter 2
            // is the second Heading 1), so chapter numbers work without a
            // heading-linked list.
            let n = 0;
            for (let i = 0; i <= hit; i++) if (match(paras[i])) n++;
            out.set(f.pos, String(n));
          }
        } else out.set(f.pos, applyCaseFormats(textWithFields(doc, p.pos + 1, p.pos + p.node.nodeSize - 1), instr.formats));
        break;
      }
      default:
        break;
    }
  }

  // Phase 2: references (their text may contain phase-1 results).
  const marks = bookmarkRanges(doc);
  const notes = noteNumbers(doc);
  const paraAt = (pos: number): ParaInfo | undefined => {
    let best: ParaInfo | undefined;
    for (const p of paras) {
      if (p.pos <= pos && pos <= p.pos + p.node.nodeSize) best = p;
      if (p.pos > pos) break;
    }
    return best;
  };
  for (const f of fields) {
    const { instr } = f;
    if (instr.type !== "REF" && instr.type !== "PAGEREF" && instr.type !== "NOTEREF") continue;
    const r = marks.get(instr.args[0] ?? "");
    if (!r) {
      out.set(f.pos, REF_ERROR);
      continue;
    }
    const rel = f.pos < r.from ? "below" : "above";
    const withRel = (s: string) => (instr.sw.p ? (s ? `${s} ${rel}` : rel) : s);
    if (instr.type === "PAGEREF") {
      const page = env.pages.pageAt(r.from);
      if (instr.sw.p) out.set(f.pos, page === env.pages.pageAt(f.pos) ? rel : `on page ${page}`);
      else out.set(f.pos, formatFieldNumber(page, instr.formats));
      continue;
    }
    if (instr.type === "NOTEREF") {
      let num = "";
      doc.nodesBetween(r.from, Math.max(r.to, r.from + 1), (n, pos) => {
        if (!num && (n.type.name === "footnote" || n.type.name === "endnote")) num = notes.get(pos) ?? "";
        return !num;
      });
      out.set(f.pos, withRel(num || REF_ERROR));
      continue;
    }
    // REF
    if (instr.sw.n || instr.sw.r || instr.sw.w) {
      const p = paraAt(r.from);
      const label = p ? env.labels?.get(p.pos)?.text : undefined;
      let s = label ? trimLabel(label) : "0";
      if (label && !instr.sw.w) s = s.split(/[.)]/).filter(Boolean).pop() ?? s;
      out.set(f.pos, withRel(s));
      continue;
    }
    if (instr.sw.p) {
      out.set(f.pos, rel);
      continue;
    }
    out.set(f.pos, applyCaseFormats(textWithFields(doc, r.from, r.to, out), instr.formats));
  }
  return out;
}
