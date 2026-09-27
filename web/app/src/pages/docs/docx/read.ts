// Direct DOCX reader (Docs M6): WordprocessingML -> Grown's model.
//
// Written from ECMA-376 Part 1 (WordprocessingML, §17) and Part 2 (OPC).
// The output is what the editor itself stores: TipTap JSON for the body,
// entries for the `styles` and `numbering` Yjs maps (M3), header/footer
// JSON for the named fragments, and comment threads. Nothing goes through
// HTML, so style names, list definitions and paragraph properties survive.
//
// Mapped: paragraph/character styles (basedOn, next, docDefaults, theme
// fonts), abstractNum/num (level formats, text, start, indents, linked
// styles, start overrides, numStyleLink), paragraph properties (M3 attrs),
// run properties (marks), tables (grid widths, gridSpan, vMerge, header
// rows, cell shading; since M4 borders, table styles + look, widths,
// fixed layout, alignment, cell margins, vertical alignment, row height,
// repaired bad merges), images (inline/anchored DrawingML, VML), text boxes
// (content inlined after the paragraph), headers/footers (default), foot-
// and endnotes, comments (+ replies and resolved state from
// commentsExtended), tracked insertions/deletions/moves, hyperlinks
// (external and bookmark anchors, tooltips), fields (HYPERLINK fields
// become links; since M8 PAGE, NUMPAGES, DATE, TIME, REF, PAGEREF,
// NOTEREF, SEQ, STYLEREF and a few document-property fields become field
// nodes with their result, other fields keep their result text), TOC
// fields as table-of-contents nodes, bookmarks (M8), content controls and
// smart tags (unwrapped), page and section breaks, equations (as math
// nodes since M11).
//
// Dropped (no Grown model yet, reported in `warnings`): conditional formatting of table styles Grown doesn't know (their
// borders are kept), per-section page setup (M9), floating image
// positions (M7), direct "not bold/italic" overrides, caps/small caps as
// direct formatting, formatting-change revisions.
import JSZip from "jszip";
import type { JSONContent } from "@tiptap/core";
import { BUILTIN_STYLES, type ParaPr, type StyleDef } from "../styles";
import { MAX_LEVELS, type AbstractNum, type LvlDef, type NumFmt, type NumInstance } from "../numbering";
import { importedCommentId, type DocxComment, type DocxImport, type PageSetup } from "./model";
import {
  paragraphAttrs,
  readPPr,
  readRPr,
  readThemeFonts,
  runMarks,
  styleRunPr,
  type ReadPPr,
  type RunProps,
  type ThemeFonts,
} from "./props";
import { correctBadTable, encodeTableBorders, normalizeTable, parseTableBorders, resolveFixedGrid, type RawCell, type RawRow } from "../tableModel";
import { readTblPr, readTcPr, readTrPr, type TableStyles } from "./tables";
import { canonicalMarks, propsAttrs } from "../changes";
import { readOMathPara, readOMML } from "../math/omml";
import { toLinear } from "../math/linear";
import { serializeContent } from "../math/model";
import { fieldType, KEPT_FIELDS } from "../fields";
import { attr, descendants, EMU_PER_PX, kid, kids, nameOf, num, onOff, parseXml, path, TWIPS_PER_PX, twipsToPt } from "./xml";

type Mark = NonNullable<JSONContent["marks"]>[number];

const REL = "relationships/";
const MAX_BYTES = 64 << 20;

interface Rel {
  type: string;
  target: string;
  external: boolean;
}

interface Part {
  path: string;
  doc: Document;
  rels: Map<string, Rel>;
}

/** Resolves a relationship target against the part that owns it. */
function resolveTarget(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
  const out: string[] = [];
  for (const seg of (dir + target).split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return out.join("/");
}

function relsPath(part: string): string {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
}

async function readText(zip: JSZip, p: string): Promise<string | null> {
  const f = zip.file(p) ?? zip.file(decodeURIComponent(p));
  if (!f) {
    // Part names are case-insensitive in OPC.
    const lower = p.toLowerCase();
    const hit = Object.keys(zip.files).find((k) => k.toLowerCase() === lower);
    return hit ? zip.file(hit)!.async("string") : null;
  }
  return f.async("string");
}

async function loadRels(zip: JSZip, part: string): Promise<Map<string, Rel>> {
  const out = new Map<string, Rel>();
  const text = await readText(zip, relsPath(part));
  if (!text) return out;
  const doc = parseXml(text);
  for (const r of descendants(doc, "Relationship")) {
    const id = attr(r, "Id");
    const target = attr(r, "Target");
    if (!id || !target) continue;
    const external = attr(r, "TargetMode") === "External";
    out.set(id, { type: attr(r, "Type") ?? "", target: external ? target : resolveTarget(part, target), external });
  }
  return out;
}

async function loadPart(zip: JSZip, p: string): Promise<Part | null> {
  const text = await readText(zip, p);
  if (text == null) return null;
  return { path: p, doc: parseXml(text), rels: await loadRels(zip, p) };
}

const relOfType = (rels: Map<string, Rel>, suffix: string) =>
  [...rels.values()].find((r) => r.type.endsWith(REL + suffix) || r.type.endsWith("/" + suffix));

// --- built-in style names ------------------------------------------------------------

const BUILTIN_BY_NAME = new Map<string, StyleDef>();
for (const s of BUILTIN_STYLES) BUILTIN_BY_NAME.set(s.name.toLowerCase(), s);
const BUILTIN_BY_ID = new Map(BUILTIN_STYLES.map((s) => [s.id, s]));

/** Word's conventional names for Grown's built-ins (writer side). */
export const WORD_STYLE_NAMES: Record<string, string> = {
  Normal: "Normal",
  NoSpacing: "No Spacing",
  Title: "Title",
  Subtitle: "Subtitle",
  Quote: "Quote",
  IntenseQuote: "Intense Quote",
  ListParagraph: "List Paragraph",
  Caption: "caption",
  Emphasis: "Emphasis",
  Strong: "Strong",
  SubtleEmphasis: "Subtle Emphasis",
  IntenseEmphasis: "Intense Emphasis",
  BookTitle: "Book Title",
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`Heading${n}`, `heading ${n}`])),
};

interface RawStyle {
  rawId: string;
  type: string;
  name: string;
  basedOn: string | null;
  next: string | null;
  pPr: ReadPPr;
  rPr: RunProps;
  isDefault: boolean;
}

// --- numbering ---------------------------------------------------------------------------

const FMT_IN: Record<string, NumFmt> = {
  decimal: "decimal",
  decimalZero: "decimalZero",
  lowerLetter: "lowerLetter",
  upperLetter: "upperLetter",
  lowerRoman: "lowerRoman",
  upperRoman: "upperRoman",
  bullet: "bullet",
  none: "none",
  ordinal: "decimal",
  cardinalText: "decimal",
  ordinalText: "decimal",
  decimalEnclosedParen: "decimal",
  decimalEnclosedFullstop: "decimal",
  decimalEnclosedCircle: "decimal",
};

/** Bullets Word writes as Symbol/Wingdings private-use code points. */
const PUA_BULLETS: Record<number, string> = {
  0xf0b7: "•", 0xf0a7: "▪", 0xf0a8: "◦", 0xf0d8: "➢", 0xf0fc: "✓", 0xf076: "❖", 0xf06e: "■",
  0xf071: "❑", 0xf0a1: "○", 0xf0e0: "➔", 0xf0f0: "➔", 0xf0de: "➢", 0xf0b2: "◊", 0xf02d: "–",
};

function bulletText(text: string, font: string | null): string {
  if (!text) return "•";
  const cp = text.codePointAt(0)!;
  if (PUA_BULLETS[cp]) return PUA_BULLETS[cp];
  if (cp >= 0xf000 && cp <= 0xf0ff) return PUA_BULLETS[cp] ?? "•";
  if (text === "o" && font && /courier/i.test(font)) return "◦";
  if (text === "§" && font && /wingdings/i.test(font)) return "▪";
  if (text === "·" && font && /symbol/i.test(font)) return "•";
  return text;
}

/** Default level for levels a definition leaves out. */
function defaultLvl(i: number): LvlDef {
  return { fmt: "decimal", text: `%${i + 1}.`, start: 1, indLeft: 36 * (i + 1), hanging: 18, suffix: "tab" };
}

// --- media -------------------------------------------------------------------------------

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
};

// --- the reader ----------------------------------------------------------------------------

interface FieldState {
  phase: "instr" | "result";
  instr: string;
  href?: string;
  /** Kept as a field node: the result is collected instead of emitted. */
  capture?: boolean;
  result?: string;
  marks?: Mark[];
  /** Already emitted (its result ran past a paragraph end). */
  emitted?: boolean;
  /** w:fldLock: the field is not updated. */
  locked?: boolean;
}

interface Ctx {
  part: Part;
  marks: Mark[];
  /** Margin (header/footer) conversion: images and notes are dropped. */
  margin?: boolean;
}

type Inline = { kind: "text"; text: string; marks: Mark[] } | { kind: "node"; node: JSONContent } | { kind: "block"; node: JSONContent };

class Reader {
  theme: ThemeFonts = {};
  raw = new Map<string, RawStyle>();
  defaultParaStyle: string | null = null;
  defaultCharStyle: string | null = null;
  docDefaults: { pPr: ReadPPr; rPr: RunProps } = { pPr: {}, rPr: {} };
  gid = new Map<string, string>();
  usedStyles = new Set<string>();
  usedNums = new Set<string>();
  abstracts = new Map<string, AbstractNum & { styleLink?: string; numStyleLink?: string }>();
  nums = new Map<string, NumInstance>();
  footnotes = new Map<string, string>();
  endnotes = new Map<string, string>();
  comments = new Map<string, DocxComment>();
  openComments = new Set<string>();
  fields: FieldState[] = [];
  /** Open bookmarks by w:id (M8); `used` once they marked something. */
  openBookmarks = new Map<string, { name: string; used: boolean }>();
  /** Point bookmarks that ended between paragraphs, for the next one. */
  pendingPoints: string[] = [];
  media = new Map<string, string>();
  warnings = new Set<string>();
  tableStyles: TableStyles = new Map();

  constructor(readonly zip: JSZip) {}

  warn(w: string) {
    this.warnings.add(w);
  }

  // --- styles ---------------------------------------------------------------

  readStyles(doc: Document | null) {
    if (!doc) return;
    const root = doc.documentElement;
    const dd = kid(root, "docDefaults");
    this.docDefaults = {
      pPr: readPPr(path(dd, "pPrDefault", "pPr")),
      rPr: readRPr(path(dd, "rPrDefault", "rPr"), this.theme),
    };
    for (const s of kids(root, "style")) {
      const rawId = attr(s, "w:styleId");
      if (!rawId) continue;
      const type = attr(s, "w:type") ?? "paragraph";
      const rs: RawStyle = {
        rawId,
        type,
        name: attr(kid(s, "name"), "w:val") ?? rawId,
        basedOn: attr(kid(s, "basedOn"), "w:val"),
        next: attr(kid(s, "next"), "w:val"),
        pPr: readPPr(kid(s, "pPr")),
        rPr: readRPr(kid(s, "rPr"), this.theme),
        isDefault: /^(1|true|on)$/i.test(attr(s, "w:default") ?? ""),
      };
      this.raw.set(rawId, rs);
      if (type === "table") this.tableStyles.set(rawId, { name: rs.name, el: s, basedOn: rs.basedOn });
      if (rs.isDefault && type === "paragraph") this.defaultParaStyle = rawId;
      if (rs.isDefault && type === "character") this.defaultCharStyle = rawId;
    }
    // Grown ids: built-ins by (English) name, everything else by its
    // sanitised docx id.
    const taken = new Set<string>();
    for (const rs of this.raw.values()) {
      if (rs.type !== "paragraph" && rs.type !== "character") continue;
      let b = BUILTIN_BY_NAME.get(rs.name.toLowerCase());
      if (rs.rawId === this.defaultParaStyle) b = BUILTIN_BY_ID.get("Normal");
      if (b && b.type === rs.type && !taken.has(b.id)) {
        this.gid.set(rs.rawId, b.id);
        taken.add(b.id);
      }
    }
    for (const rs of this.raw.values()) {
      if (this.gid.has(rs.rawId) || (rs.type !== "paragraph" && rs.type !== "character")) continue;
      const base = rs.rawId.replace(/[^A-Za-z0-9_-]+/g, "") || "Style";
      let id = base;
      for (let i = 2; taken.has(id) || BUILTIN_BY_ID.has(id); i++) id = `${base}${i}`;
      taken.add(id);
      this.gid.set(rs.rawId, id);
    }
  }

  rawChain(rawId: string | null | undefined): RawStyle[] {
    const out: RawStyle[] = [];
    const seen = new Set<string>();
    let s = rawId ? this.raw.get(rawId) : undefined;
    while (s && !seen.has(s.rawId)) {
      seen.add(s.rawId);
      out.push(s);
      s = s.basedOn ? this.raw.get(s.basedOn) : undefined;
    }
    return out;
  }

  headingLevel(rawId: string | null): number | null {
    for (const s of this.rawChain(rawId)) {
      const m = /^Heading([1-6])$/.exec(this.gid.get(s.rawId) ?? "");
      if (m && BUILTIN_BY_ID.has(m[0])) return parseInt(m[1], 10);
    }
    return null;
  }

  useStyle(rawId: string) {
    for (const s of this.rawChain(rawId)) {
      if (this.usedStyles.has(s.rawId)) break;
      this.usedStyles.add(s.rawId);
      if (s.pPr.numId && s.pPr.numId !== "0") this.useNum(s.pPr.numId);
    }
  }

  buildStyles(): Record<string, StyleDef> {
    const out: Record<string, StyleDef> = {};
    // Linked level styles of used lists are part of the model too.
    for (const n of this.usedNums) {
      const abs = this.abstracts.get(this.nums.get(n)?.abstractId ?? "");
      for (const l of abs?.lvls ?? []) if (l.pStyle && this.raw.has(l.pStyle)) this.useStyle(l.pStyle);
    }
    if (this.defaultParaStyle) this.useStyle(this.defaultParaStyle);
    for (const rawId of this.usedStyles) {
      const rs = this.raw.get(rawId)!;
      const id = this.gid.get(rawId);
      if (!id || (rs.type !== "paragraph" && rs.type !== "character")) continue;
      const builtin = BUILTIN_BY_ID.get(id);
      const { pStyle: _s, sectionBreak: _b, ...pPrRest } = rs.pPr;
      let pPr: ParaPr = { ...pPrRest };
      let rPr = styleRunPr(rs.rPr);
      const isRoot = !rs.basedOn || !this.raw.has(rs.basedOn);
      if (rs.type === "paragraph" && isRoot) {
        // docDefaults sit under the root paragraph style.
        const { pStyle: _p, sectionBreak: _x, numId: _n, numLvl: _l, ...ddp } = this.docDefaults.pPr;
        pPr = { ...ddp, ...pPr };
        rPr = { ...styleRunPr(this.docDefaults.rPr), ...rPr };
        // Word's defaults for what docDefaults leave out.
        pPr.spaceBefore ??= 0;
        pPr.spaceAfter ??= 0;
      }
      if (pPr.numId != null && pPr.numId !== "0" && !this.nums.has(pPr.numId)) {
        delete pPr.numId;
        delete pPr.numLvl;
      }
      const level = builtin?.headingLevel;
      if (level && !this.rawChain(rawId).some((s) => s.rPr.bold !== undefined)) rPr.bold = false;
      const def: StyleDef = {
        id,
        name: builtin ? builtin.name : rs.name,
        type: rs.type as StyleDef["type"],
        pPr,
        rPr,
      };
      if (builtin) {
        def.builtin = true;
        if (builtin.order != null) def.order = builtin.order;
        if (builtin.headingLevel) def.headingLevel = builtin.headingLevel;
      }
      const based = rs.basedOn ? this.gid.get(rs.basedOn) : undefined;
      def.basedOn = based && this.usedStyles.has(rs.basedOn!) ? based : null;
      const next = rs.next ? this.gid.get(rs.next) : undefined;
      if (next && this.usedStyles.has(rs.next!)) def.next = next;
      else if (rs.type === "paragraph") def.next = null;
      if (!Object.keys(def.pPr!).length) delete def.pPr;
      if (!Object.keys(def.rPr!).length) delete def.rPr;
      out[id] = def;
    }
    return out;
  }

  // --- numbering --------------------------------------------------------------

  readNumbering(doc: Document | null) {
    if (!doc) return;
    const root = doc.documentElement;
    const readLvl = (l: Element, i: number): LvlDef => {
      const fmtRaw = attr(kid(l, "numFmt"), "w:val") ?? "decimal";
      const fmt = FMT_IN[fmtRaw] ?? "decimal";
      if (!FMT_IN[fmtRaw]) this.warn(`numbering format ${fmtRaw}`);
      const font = attr(path(l, "rPr", "rFonts"), "w:ascii") ?? attr(path(l, "rPr", "rFonts"), "w:hAnsi");
      let text = attr(kid(l, "lvlText"), "w:val") ?? "";
      if (fmt === "bullet") text = bulletText(text, font);
      const ppr = readPPr(kid(l, "pPr"));
      const def: LvlDef = {
        fmt,
        text,
        start: num(attr(kid(l, "start"), "w:val")) ?? 0,
        indLeft: ppr.indLeft ?? 0,
        hanging: ppr.indFirstLine != null ? -ppr.indFirstLine : 0,
      };
      const jc = attr(kid(l, "lvlJc"), "w:val");
      if (jc === "center") def.align = "center";
      else if (jc === "right" || jc === "end") def.align = "right";
      else if (jc) def.align = "left";
      const suff = attr(kid(l, "suff"), "w:val");
      def.suffix = suff === "space" ? "space" : suff === "nothing" ? "nothing" : "tab";
      if (font && fmt !== "bullet") def.font = font;
      const ps = attr(kid(l, "pStyle"), "w:val");
      if (ps) def.pStyle = ps; // raw id; mapped in finishNumbering
      if (onOff(kid(l, "isLgl"))) def.legal = true;
      void i;
      return def;
    };
    const levels = (parent: Element): LvlDef[] => {
      const lv: LvlDef[] = [];
      for (const l of kids(parent, "lvl")) {
        const i = num(attr(l, "w:ilvl")) ?? lv.length;
        if (i >= 0 && i < MAX_LEVELS) lv[i] = readLvl(l, i);
      }
      for (let i = 0; i < MAX_LEVELS; i++) lv[i] ??= defaultLvl(i);
      return lv;
    };
    for (const a of kids(root, "abstractNum")) {
      const id = attr(a, "w:abstractNumId");
      if (id == null) continue;
      const abs: AbstractNum & { styleLink?: string; numStyleLink?: string } = { id, lvls: levels(a) };
      const name = attr(kid(a, "name"), "w:val");
      if (name) abs.name = name;
      const sl = attr(kid(a, "styleLink"), "w:val");
      const nsl = attr(kid(a, "numStyleLink"), "w:val");
      if (sl) abs.styleLink = sl;
      if (nsl) abs.numStyleLink = nsl;
      this.abstracts.set(id, abs);
    }
    for (const n of kids(root, "num")) {
      const id = attr(n, "w:numId");
      const absId = attr(kid(n, "abstractNumId"), "w:val");
      if (id == null || absId == null) continue;
      let abstractId = this.resolveAbstract(absId);
      const inst: NumInstance = { id, abstractId };
      const starts: Record<string, number> = {};
      const overrides: [number, Element][] = [];
      for (const o of kids(n, "lvlOverride")) {
        const lvl = num(attr(o, "w:ilvl"));
        if (lvl == null) continue;
        const so = num(attr(kid(o, "startOverride"), "w:val"));
        if (so != null) starts[String(lvl)] = so;
        const full = kid(o, "lvl");
        if (full) overrides.push([lvl, full]);
      }
      if (overrides.length) {
        const base = this.abstracts.get(abstractId);
        if (base) {
          const derivedId = `${abstractId}o${id}`;
          const lvls = base.lvls.map((l) => ({ ...l }));
          for (const [lvl, full] of overrides) if (lvl < MAX_LEVELS) lvls[lvl] = readLvl(full, lvl);
          this.abstracts.set(derivedId, { id: derivedId, lvls });
          abstractId = derivedId;
          inst.abstractId = derivedId;
        }
      }
      if (Object.keys(starts).length) inst.starts = starts;
      this.nums.set(id, inst);
    }
  }

  /** An abstractNum with numStyleLink takes its levels from the list the
   *  numbering style points at. */
  resolveAbstract(absId: string): string {
    const abs = this.abstracts.get(absId);
    if (!abs?.numStyleLink) return absId;
    const style = this.raw.get(abs.numStyleLink);
    const numId = style?.pPr.numId;
    const target = numId ? this.nums.get(numId)?.abstractId : [...this.abstracts.values()].find((a) => a.styleLink === abs.numStyleLink)?.id;
    return target && target !== absId ? target : absId;
  }

  useNum(numId: string) {
    if (numId !== "0" && this.nums.has(numId)) this.usedNums.add(numId);
  }

  buildNumbering(): Record<string, AbstractNum | NumInstance> {
    const out: Record<string, AbstractNum | NumInstance> = {};
    for (const n of this.usedNums) {
      const inst = this.nums.get(n)!;
      const abs = this.abstracts.get(inst.abstractId);
      if (!abs) continue;
      out[`num:${n}`] = { ...inst };
      if (!out[`abs:${abs.id}`]) {
        const clean: AbstractNum = {
          id: abs.id,
          lvls: abs.lvls.map((l) => {
            const c: LvlDef = { ...l };
            if (c.pStyle) {
              const g = this.usedStyles.has(c.pStyle) ? this.gid.get(c.pStyle) : undefined;
              if (g) c.pStyle = g;
              else delete c.pStyle;
            }
            return c;
          }),
        };
        if (abs.name) clean.name = abs.name;
        out[`abs:${abs.id}`] = clean;
      }
    }
    return out;
  }

  // --- notes and comments ---------------------------------------------------------

  readNotes(doc: Document | null, into: Map<string, string>, tag: "footnote" | "endnote") {
    if (!doc) return;
    for (const n of kids(doc.documentElement, tag)) {
      const type = attr(n, "w:type");
      if (type && type !== "normal") continue;
      const id = attr(n, "w:id");
      if (id == null) continue;
      into.set(id, plainText(n));
    }
  }

  readComments(doc: Document | null, ext: Document | null) {
    if (!doc) return;
    const byPara = new Map<string, string>();
    for (const c of kids(doc.documentElement, "comment")) {
      const id = attr(c, "w:id");
      if (id == null) continue;
      const entry: DocxComment = { id: importedCommentId(id), author: attr(c, "w:author") ?? "", text: plainText(c) };
      const initials = attr(c, "w:initials");
      const date = attr(c, "w:date");
      if (initials) entry.initials = initials;
      if (date) entry.date = date;
      this.comments.set(id, entry);
      const paras = kids(c, "p");
      const last = paras[paras.length - 1];
      const pid = last && attr(last, "w14:paraId");
      if (pid) byPara.set(pid.toUpperCase(), id);
    }
    if (!ext) return;
    for (const e of descendants(ext, "commentEx")) {
      const pid = attr(e, "w15:paraId")?.toUpperCase();
      const id = pid ? byPara.get(pid) : undefined;
      if (!id) continue;
      const c = this.comments.get(id)!;
      const parent = attr(e, "w15:paraIdParent")?.toUpperCase();
      const pidParent = parent ? byPara.get(parent) : undefined;
      if (pidParent) c.parentId = importedCommentId(pidParent);
      if (/^(1|true)$/.test(attr(e, "w15:done") ?? "")) c.resolved = true;
    }
  }

  // --- media --------------------------------------------------------------------------

  async loadMedia(part: Part) {
    for (const [rid, rel] of part.rels) {
      if (rel.external || !/\/image$/.test(rel.type)) continue;
      const key = `${part.path}#${rid}`;
      const ext = rel.target.split(".").pop()!.toLowerCase();
      const mime = MIME[ext];
      if (!mime) {
        this.warn(`image format ${ext}`);
        continue;
      }
      const f = this.zip.file(rel.target);
      if (!f) continue;
      this.media.set(key, `data:${mime};base64,${await f.async("base64")}`);
    }
  }

  imageNode(ctx: Ctx, rid: string | null, extent: Element | null, docPr: Element | null): JSONContent | null {
    if (ctx.margin) {
      this.warn("header/footer images");
      return null;
    }
    if (!rid) return null;
    const src = this.media.get(`${ctx.part.path}#${rid}`);
    if (!src) return null;
    const attrs: Record<string, unknown> = { src };
    const alt = attr(docPr, "descr") || attr(docPr, "title");
    if (alt) attrs.alt = alt;
    const cx = num(attr(extent, "cx"));
    const cy = num(attr(extent, "cy"));
    if (cx && cy) {
      attrs.width = Math.round(cx / EMU_PER_PX);
      attrs.height = Math.round(cy / EMU_PER_PX);
    }
    return { type: "image", attrs };
  }

  // --- blocks ---------------------------------------------------------------------------

  blocks(parent: Element, ctx: Ctx): JSONContent[] {
    const out: JSONContent[] = [];
    const list = kids(parent);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      switch (nameOf(c)) {
        case "p": {
          const toc = ctx.margin ? null : this.tocBlock(list, i);
          if (toc) {
            out.push(toc.node);
            i = toc.last;
            break;
          }
          out.push(...this.paragraph(c, ctx));
          break;
        }
        case "tbl": {
          const t = this.table(c, ctx);
          if (t) out.push(t);
          break;
        }
        case "sdt":
          out.push(...this.blocks(kid(c, "sdtContent") ?? c, ctx));
          break;
        case "customXml":
        case "ins":
        case "moveTo":
          out.push(...this.blocks(c, ctx));
          break;
        case "del":
        case "moveFrom":
          // A deleted paragraph mark: its content is still there as runs.
          out.push(...this.blocks(c, ctx));
          break;
        case "AlternateContent": {
          const choice = kid(c, "Choice") ?? kid(c, "Fallback");
          if (choice) out.push(...this.blocks(choice, ctx));
          break;
        }
        case "bookmarkStart":
        case "bookmarkEnd":
          this.bookmark(c, ctx, null);
          break;
        case "commentRangeStart":
        case "commentRangeEnd":
          this.commentRange(c);
          break;
        case "altChunk":
          this.warn("embedded alternative-format chunks");
          break;
        default:
          break;
      }
    }
    return out;
  }

  commentRange(c: Element) {
    const id = attr(c, "w:id");
    if (id == null || !this.comments.has(id)) return;
    if (nameOf(c) === "commentRangeStart") this.openComments.add(id);
    else this.openComments.delete(id);
  }

  /** bookmark handles w:bookmarkStart / w:bookmarkEnd: open bookmarks mark
   *  what follows; one that ends before marking anything is a point
   *  bookmark (inline here, or at the start of the next paragraph). */
  bookmark(c: Element, ctx: Ctx, out: Inline[] | null) {
    if (ctx.margin) return;
    const id = attr(c, "w:id");
    if (id == null) return;
    if (nameOf(c) === "bookmarkStart") {
      const name = attr(c, "w:name") ?? "";
      if (!name || name === "_GoBack" || !/^[A-Za-z_][\w]{0,39}$/u.test(name)) return;
      this.openBookmarks.set(id, { name, used: false });
      return;
    }
    const b = this.openBookmarks.get(id);
    if (!b) return;
    this.openBookmarks.delete(id);
    if (b.used) return;
    if (out) out.push({ kind: "node", node: { type: "bookmarkPoint", attrs: { name: b.name } } });
    else this.pendingPoints.push(b.name);
  }

  /** Bookmark marks for what is being read now. */
  bookmarkMarks(): Mark[] {
    const out: Mark[] = [];
    for (const b of this.openBookmarks.values()) {
      b.used = true;
      out.push({ type: "bookmark", attrs: { name: b.name } });
    }
    return out;
  }

  // --- table of contents (M8) -------------------------------------------------------------

  /**
   * tocBlock: when paragraph list[i] starts a TOC field, reads the field's
   * result paragraphs (up to the one that ends it) as a table-of-contents
   * node. Entry level from the TOC n style, text before the last tab, page
   * after it, target from the entry's hyperlink anchor or PAGEREF.
   */
  tocBlock(list: Element[], i: number): { node: JSONContent; last: number } | null {
    const ev = fieldEvents(list[i]);
    let depth = 0;
    let instr: string | null = null;
    let cur = "";
    let startDepth = -1;
    for (const e of ev) {
      if (e.k === "begin") {
        depth++;
        if (depth === 1) cur = "";
      } else if (e.k === "instr") {
        if (depth === 1) cur += e.text;
      } else if (e.k === "sep" || e.k === "end") {
        if (depth === 1 && instr == null && /^\s*TOC\b/i.test(cur)) {
          instr = cur.trim();
          startDepth = 1;
        }
        if (e.k === "end") depth--;
      }
      if (instr != null) break;
    }
    if (instr == null || startDepth < 0) return null;
    // Find the paragraph where the TOC field ends.
    depth = 0;
    let last = list.length - 1;
    let started = false;
    outer: for (let j = i; j < list.length; j++) {
      for (const e of fieldEvents(list[j])) {
        if (e.k === "begin") {
          depth++;
          started = true;
        } else if (e.k === "end") {
          depth--;
          if (started && depth === 0) {
            last = j;
            break outer;
          }
        }
      }
    }
    const figures = /\\c\s/.test(instr);
    const entries: JSONContent[] = [];
    for (let j = i; j <= last; j++) {
      if (nameOf(list[j]) !== "p") continue;
      const e = this.tocEntry(list[j]);
      if (e) entries.push(e);
    }
    if (!entries.length)
      entries.push({
        type: "tocEntry",
        attrs: { level: 1, page: "" },
        content: [{ type: "text", text: figures ? "No table of figures entries found." : "No table of contents entries found." }],
      });
    return { node: { type: "tableOfContents", attrs: { instr }, content: entries }, last };
  }

  tocEntry(p: Element): JSONContent | null {
    let text = "";
    let target: string | null = null;
    const stack: ("instr" | "result")[] = [];
    let instr = "";
    const walk = (n: Element) => {
      for (const c of kids(n)) {
        const name = nameOf(c);
        if (name === "pPr" || name === "rPr" || name === "del" || name === "moveFrom") continue;
        if (name === "hyperlink" && !target) target = attr(c, "w:anchor");
        if (name === "fldChar") {
          const t = attr(c, "w:fldCharType");
          if (t === "begin") {
            stack.push("instr");
            instr = "";
          } else if (t === "separate" && stack.length) {
            stack[stack.length - 1] = "result";
            const m = /^\s*PAGEREF\s+(\S+)/i.exec(instr);
            if (m && !target) target = m[1];
          } else if (t === "end") stack.pop();
          continue;
        }
        if (name === "instrText") {
          instr += c.textContent ?? "";
          continue;
        }
        // Text only outside field instructions (the TOC field's own result
        // is where the entries are).
        const visible = stack.every((s) => s === "result");
        if (name === "t" && visible) text += c.textContent ?? "";
        else if ((name === "tab" || name === "ptab") && visible) text += "\t";
        else walk(c);
      }
    };
    walk(p);
    const tab = text.lastIndexOf("\t");
    const title = (tab >= 0 ? text.slice(0, tab) : text).replace(/\t/g, " ").trim();
    const page = tab >= 0 ? text.slice(tab + 1).trim() : "";
    if (!title) return null;
    const style = attr(kid(kid(p, "pPr"), "pStyle"), "w:val") ?? "";
    const sname = this.raw.get(style)?.name ?? style;
    const lvl = /toc\s*(\d)/i.exec(sname) ?? /toc\s*(\d)/i.exec(style);
    const href = target ? safeHref(`#${target}`) : null;
    return {
      type: "tocEntry",
      attrs: { level: lvl ? +lvl[1] : 1, page },
      content: [href ? { type: "text", text: title, marks: [{ type: "link", attrs: { href } }] } : { type: "text", text: title }],
    };
  }

  /** paraTypeAttrs maps paragraph props to a node type and attributes. */
  paraTypeAttrs(pPr: ReturnType<typeof readPPr>, ctx: Ctx): { type: string; attrs: Record<string, unknown> } {
    const rawStyle = pPr.pStyle && this.raw.get(pPr.pStyle)?.type === "paragraph" ? pPr.pStyle : this.defaultParaStyle;
    if (rawStyle && !ctx.margin) this.useStyle(rawStyle);
    const gid = rawStyle ? this.gid.get(rawStyle) ?? null : null;
    const level = this.headingLevel(rawStyle);

    const attrs = ctx.margin ? (pPr.align && pPr.align !== "left" ? { textAlign: pPr.align } : {}) : paragraphAttrs(pPr);
    if (!ctx.margin && pPr.numId != null) {
      if (pPr.numId !== "0" && !this.nums.has(pPr.numId)) {
        delete attrs.numId;
        delete attrs.numLvl;
      } else this.useNum(pPr.numId);
    } else if (!ctx.margin && pPr.numId == null && pPr.numLvl != null) {
      // ilvl without numId: the level of the style's list.
      attrs.numLvl = pPr.numLvl;
      const styleNum = this.rawChain(rawStyle).find((s) => s.pPr.numId)?.pPr.numId;
      if (styleNum && styleNum !== "0" && this.nums.has(styleNum)) attrs.numId = styleNum;
      else delete attrs.numLvl;
    }
    let type = "paragraph";
    if (level) {
      type = "heading";
      attrs.level = level;
      if (!ctx.margin && gid && gid !== `Heading${level}`) attrs.styleId = gid;
    } else if (!ctx.margin && gid && gid !== "Normal") attrs.styleId = gid;
    return { type, attrs };
  }

  paragraph(p: Element, ctx: Ctx): JSONContent[] {
    const pPrEl = kid(p, "pPr");
    const pPr = readPPr(pPrEl);
    const { type, attrs } = this.paraTypeAttrs(pPr, ctx);
    // Tracked paragraph mark (w:pPr/w:rPr/w:ins|w:del) and property change.
    const markRPr = kid(pPrEl, "rPr");
    const markIns = kid(markRPr, "ins");
    const markDel = kid(markRPr, "del");
    const markRev = markDel ?? markIns;
    if (markRev) attrs.paraChange = JSON.stringify({ type: markDel ? "delete" : "insert", ...revInfo(markRev) });
    const pch = kid(pPrEl, "pPrChange");
    if (pch) {
      const old = this.paraTypeAttrs(readPPr(kid(pch, "pPr")), ctx);
      attrs.propsChange = JSON.stringify({ ...revInfo(pch), type: old.type, attrs: propsAttrs(old.attrs) });
    }

    const items: Inline[] = [];
    if (!ctx.margin && this.pendingPoints.length) {
      for (const name of this.pendingPoints) items.push({ kind: "node", node: { type: "bookmarkPoint", attrs: { name } } });
      this.pendingPoints = [];
    }
    this.inline(p, ctx, items);
    // A kept field whose result runs past this paragraph: emit it here.
    for (const f of this.fields)
      if (f.capture && !f.emitted) {
        items.push({ kind: "node", node: this.fieldNode(f) });
        f.emitted = true;
      }

    const out: JSONContent[] = [];
    let cur: JSONContent[] = [];
    let emitted = false;
    const flush = (force: boolean) => {
      if (!cur.length && !force) return;
      out.push(cur.length ? { type, attrs: { ...attrs }, content: cur } : { type, attrs: { ...attrs } });
      cur = [];
      emitted = true;
    };
    // The paragraph mark belongs to the last part of a split paragraph.
    const markAttrs = { paraChange: attrs.paraChange, propsChange: attrs.propsChange };
    delete attrs.paraChange;
    delete attrs.propsChange;
    for (const it of items) {
      if (it.kind === "block") {
        flush(false);
        out.push(it.node);
        emitted = true;
      } else if (it.kind === "node") cur.push(it.node);
      else {
        const last = cur[cur.length - 1];
        if (last?.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(it.marks)) last.text += it.text;
        else cur.push(it.marks.length ? { type: "text", text: it.text, marks: it.marks } : { type: "text", text: it.text });
      }
    }
    flush(!emitted);
    const last = [...out].reverse().find((b) => b.type === type);
    if (last) for (const [k, v] of Object.entries(markAttrs)) if (v != null) last.attrs = { ...last.attrs, [k]: v };
    if (pPr.sectionBreak && /Page$/.test(pPr.sectionBreak) && !ctx.margin) out.push({ type: "pageBreak" });
    return out;
  }

  /** Whether runs are visible now (not inside a field's instruction part). */
  get inResult(): boolean {
    return this.fields.every((f) => f.phase === "result");
  }

  fieldHref(): string | undefined {
    for (let i = this.fields.length - 1; i >= 0; i--) if (this.fields[i].href) return this.fields[i].href;
    return undefined;
  }

  inline(parent: Element, ctx: Ctx, out: Inline[]) {
    for (const c of kids(parent)) {
      switch (nameOf(c)) {
        case "r":
          this.run(c, ctx, out);
          break;
        case "hyperlink": {
          const href = this.hyperlinkHref(c, ctx);
          const tip = attr(c, "w:tooltip");
          const link: Mark = { type: "link", attrs: tip ? { href, title: tip } : { href } };
          const marks = href ? [...ctx.marks.filter((m) => m.type !== "link"), link] : ctx.marks;
          this.inline(c, { ...ctx, marks }, out);
          break;
        }
        case "ins":
        case "moveTo":
          this.inline(c, { ...ctx, marks: [...ctx.marks, changeMark("insertion", c)] }, out);
          break;
        case "del":
        case "moveFrom":
          this.inline(c, { ...ctx, marks: [...ctx.marks, changeMark("deletion", c)] }, out);
          break;
        case "fldSimple": {
          const instr = attr(c, "w:instr") ?? "";
          const href = parseHyperlinkInstr(instr);
          if (!href && !ctx.margin && this.inResult && !this.capturing() && KEPT_FIELDS.has(fieldType(instr))) {
            const f: FieldState = { phase: "result", instr, capture: true, result: "" };
            this.fields.push(f);
            this.inline(c, ctx, out);
            this.fields.pop();
            if (!f.emitted) out.push({ kind: "node", node: this.fieldNode(f, ctx) });
            break;
          }
          const marks = href ? [...ctx.marks, { type: "link", attrs: { href } }] : ctx.marks;
          this.inline(c, { ...ctx, marks }, out);
          break;
        }
        case "sdt":
          this.inline(kid(c, "sdtContent") ?? c, ctx, out);
          break;
        case "smartTag":
        case "customXml":
        case "dir":
        case "bdo":
          this.inline(c, ctx, out);
          break;
        case "commentRangeStart":
        case "commentRangeEnd":
          this.commentRange(c);
          break;
        case "bookmarkStart":
        case "bookmarkEnd":
          this.bookmark(c, ctx, out);
          break;
        case "oMath":
        case "oMathPara": {
          // Equations become math nodes (M11); header/footer text keeps the
          // linear form, since the margin schema has no math node.
          const eqs = nameOf(c) === "oMath" ? [readOMML(c)] : readOMathPara(c);
          const display = nameOf(c) === "oMathPara";
          for (const eq of eqs) {
            if (ctx.margin) this.pushText(toLinear(eq), ctx, out);
            else if (this.inResult) out.push({ kind: "node", node: { type: "math", attrs: { data: serializeContent(eq), display } } });
          }
          break;
        }
        case "AlternateContent": {
          const choice = kid(c, "Choice") ?? kid(c, "Fallback");
          if (choice) this.inline(choice, ctx, out);
          break;
        }
        default:
          break;
      }
    }
  }

  hyperlinkHref(h: Element, ctx: Ctx): string | null {
    const rid = attr(h, "r:id");
    const anchor = attr(h, "w:anchor");
    let href: string | null = null;
    if (rid) {
      const rel = ctx.part.rels.get(rid);
      if (rel) href = rel.external ? rel.target : null;
      if (href && anchor) href += `#${anchor}`;
    } else if (anchor) href = `#${anchor}`;
    return safeHref(href);
  }

  runMarksFor(rPr: RunProps, ctx: Ctx): Mark[] {
    let cs: string | null = null;
    if (rPr.rStyle && rPr.rStyle !== this.defaultCharStyle) {
      const rs = this.raw.get(rPr.rStyle);
      if (rs?.type === "character") {
        if (!ctx.margin) this.useStyle(rPr.rStyle);
        cs = this.gid.get(rPr.rStyle) ?? null;
      }
    }
    if (rPr.allCaps || rPr.smallCaps) this.warn("caps / small caps as direct formatting");
    let marks = runMarks(rPr, ctx.margin ? null : cs);
    if (ctx.margin) marks = marks.filter((m) => MARGIN_MARKS.has(m.type as string));
    const href = this.fieldHref();
    const all = [...ctx.marks, ...marks];
    if (!ctx.margin) all.push(...this.bookmarkMarks());
    if (href && !all.some((m) => m.type === "link")) all.push({ type: "link", attrs: { href } });
    if (!ctx.margin)
      for (const id of this.openComments)
        // Replies share their parent's range; the thread has one mark.
        if (!this.comments.get(id)?.parentId) all.push({ type: "commentMark", attrs: { commentId: importedCommentId(id) } });
    return ctx.margin ? all.filter((m) => MARGIN_MARKS.has(m.type as string)) : all;
  }

  /** A formatChange mark from w:rPrChange: the old run formatting. */
  formatChangeMark(rch: Element, ctx: Ctx): Mark {
    const old = readRPr(kid(rch, "rPr"), this.theme);
    let cs: string | null = null;
    if (!ctx.margin && old.rStyle && old.rStyle !== this.defaultCharStyle && this.raw.get(old.rStyle)?.type === "character") {
      this.useStyle(old.rStyle);
      cs = this.gid.get(old.rStyle) ?? null;
    }
    let marks = runMarks(old, cs);
    if (ctx.margin) marks = marks.filter((m) => MARGIN_MARKS.has(m.type as string));
    return { type: "formatChange", attrs: { ...revInfo(rch), old: JSON.stringify(canonicalMarks(marks)) } };
  }

  pushText(text: string, ctx: Ctx, out: Inline[], rPr: RunProps = {}) {
    if (!text || !this.inResult) return;
    const cap = this.capturing();
    if (cap) {
      if (cap.emitted) return;
      if (!cap.marks) cap.marks = this.runMarksFor(rPr, ctx);
      cap.result = (cap.result ?? "") + text;
      return;
    }
    out.push({ kind: "text", text, marks: this.runMarksFor(rPr, ctx) });
  }

  /** The field whose result is being collected, if any. */
  capturing(): FieldState | undefined {
    return this.fields.find((f) => f.capture);
  }

  /** A field node from a kept field (instruction + collected result). */
  fieldNode(f: FieldState, ctx?: Ctx): JSONContent {
    const marks = (f.marks ?? (ctx ? this.runMarksFor({}, ctx) : [])).filter((m) => m.type !== "link");
    const node: JSONContent = { type: "field", attrs: { instr: f.instr.trim(), result: f.result ?? "", ...(f.locked ? { locked: true } : {}) } };
    if (marks.length) node.marks = marks;
    return node;
  }

  run(r: Element, ctx0: Ctx, out: Inline[]) {
    const rPrEl = kid(r, "rPr");
    const rPr = readRPr(rPrEl, this.theme);
    const rch = kid(rPrEl, "rPrChange");
    const ctx = rch ? { ...ctx0, marks: [...ctx0.marks, this.formatChangeMark(rch, ctx0)] } : ctx0;
    for (const c of kids(r)) {
      const n = nameOf(c);
      if (n === "fldChar") {
        const t = attr(c, "w:fldCharType");
        const keep = (f: FieldState) =>
          !ctx.margin && !f.href && !this.fields.some((x) => x !== f && x.capture) && this.fields.every((x) => x === f || x.phase === "result") && KEPT_FIELDS.has(fieldType(f.instr));
        if (t === "begin") this.fields.push({ phase: "instr", instr: "", locked: /^(1|true|on)$/.test(attr(c, "w:fldLock") ?? "") });
        else if (t === "separate") {
          const f = this.fields[this.fields.length - 1];
          if (f) {
            f.phase = "result";
            const href = parseHyperlinkInstr(f.instr);
            if (href) f.href = href;
            if (keep(f)) {
              f.capture = true;
              f.result = "";
            }
          }
        } else if (t === "end") {
          const f = this.fields[this.fields.length - 1];
          // A field without a result part (begin, instr, end) still counts.
          if (f && f.phase === "instr" && keep(f)) f.capture = true;
          this.fields.pop();
          if (f?.capture && !f.emitted) out.push({ kind: "node", node: this.fieldNode(f, ctx) });
        }
        continue;
      }
      if (n === "instrText") {
        const f = this.fields[this.fields.length - 1];
        if (f && f.phase === "instr") f.instr += c.textContent ?? "";
        continue;
      }
      if (!this.inResult) continue;
      if (rPr.hidden) continue;
      if (this.capturing() && !["t", "delText", "tab", "ptab", "noBreakHyphen", "softHyphen", "sym"].includes(n)) continue;
      switch (n) {
        case "t":
        case "delText":
          this.pushText(c.textContent ?? "", ctx, out, rPr);
          break;
        case "tab":
        case "ptab":
          this.pushText("\t", ctx, out, rPr);
          break;
        case "noBreakHyphen":
          this.pushText("‑", ctx, out, rPr);
          break;
        case "softHyphen":
          this.pushText("­", ctx, out, rPr);
          break;
        case "sym": {
          const code = parseInt(attr(c, "w:char") ?? "", 16);
          if (Number.isFinite(code)) this.pushText(PUA_BULLETS[code] ?? String.fromCodePoint(code >= 0xf000 ? code - 0xf000 : code), ctx, out, rPr);
          break;
        }
        case "br":
        case "cr": {
          const type = attr(c, "w:type");
          if (type === "page" && !ctx.margin) out.push({ kind: "block", node: { type: "pageBreak" } });
          else out.push({ kind: "node", node: { type: "hardBreak" } });
          break;
        }
        case "footnoteReference":
        case "endnoteReference": {
          if (ctx.margin) break;
          const id = attr(c, "w:id");
          if (id == null) break;
          const foot = n === "footnoteReference";
          const content = (foot ? this.footnotes : this.endnotes).get(id) ?? "";
          const bm = this.bookmarkMarks();
          out.push({
            kind: "node",
            node: { type: foot ? "footnote" : "endnote", attrs: { id: `${foot ? "fn" : "en"}-${id}`, content }, ...(bm.length ? { marks: bm } : {}) },
          });
          break;
        }
        case "drawing":
          this.drawing(c, ctx, out);
          break;
        case "pict":
        case "object":
          this.vml(c, ctx, out);
          break;
        case "AlternateContent": {
          const choice = kid(c, "Choice") ?? kid(c, "Fallback");
          if (choice) this.run(choice, ctx, out);
          break;
        }
        default:
          break;
      }
    }
  }

  drawing(d: Element, ctx: Ctx, out: Inline[]) {
    const box = kid(d, "inline") ?? kid(d, "anchor");
    if (box && nameOf(box) === "anchor") this.warn("floating image position");
    const blip = descendants(d, "blip")[0];
    if (blip) {
      const node = this.imageNode(ctx, attr(blip, "r:embed"), kid(box, "extent"), kid(box, "docPr"));
      if (node) out.push({ kind: "block", node });
      else if (attr(blip, "r:link")) this.warn("linked (external) images");
    }
    this.textBoxes(d, ctx, out);
  }

  vml(v: Element, ctx: Ctx, out: Inline[]) {
    const img = descendants(v, "imagedata")[0];
    if (img) {
      const node = this.imageNode(ctx, attr(img, "r:id"), null, null);
      if (node) out.push({ kind: "block", node });
    }
    this.textBoxes(v, ctx, out);
  }

  textBoxes(e: Element, ctx: Ctx, out: Inline[]) {
    for (const tb of descendants(e, "txbxContent")) {
      // Skip nested text boxes (they're reached through their parent).
      let p: Element | null = tb.parentElement;
      let nested = false;
      while (p && p !== e) {
        if (nameOf(p) === "txbxContent") nested = true;
        p = p.parentElement;
      }
      if (nested) continue;
      this.warn("text boxes (content kept inline)");
      for (const b of this.blocks(tb, ctx)) out.push({ kind: "block", node: b });
    }
  }

  // --- tables -------------------------------------------------------------------------

  table(tbl: Element, ctx: Ctx): JSONContent | null {
    if (ctx.margin) {
      // Margin editors have no tables: keep the cell text as paragraphs.
      const out: JSONContent[] = [];
      for (const tc of descendants(tbl, "tc")) out.push(...this.blocks(tc, ctx));
      return out.length ? { type: "__flatten", content: out } : null;
    }
    const tblPr = kid(tbl, "tblPr");
    const props = readTblPr(tblPr, this.tableStyles);
    if (props.unknownStyle) this.warn(`table style "${props.unknownStyle}" (its borders are kept)`);
    const gridPx = kids(kid(tbl, "tblGrid"), "gridCol").map((g) => {
      const w = num(attr(g, "w:w"));
      return w ? Math.max(1, Math.round(w / TWIPS_PER_PX)) : 0;
    });

    // Pass 1: the WordprocessingML grid (spans, vMerge), repaired.
    interface RawTc extends RawCell {
      tc: Element;
      tcPr: Element | null;
      width: number | null;
    }
    const raw: (RawRow<RawTc> & { tr: Element })[] = [];
    for (const tr of kids(tbl, "tr", "sdt", "customXml", "ins", "del").flatMap((e) =>
      nameOf(e) === "tr" ? [e] : kids(kid(e, "sdtContent") ?? e, "tr"),
    )) {
      const trPr = kid(tr, "trPr");
      const cells: RawTc[] = [];
      const tcs = kids(tr, "tc", "sdt", "customXml").flatMap((e) => (nameOf(e) === "tc" ? [e] : kids(kid(e, "sdtContent") ?? e, "tc")));
      for (const tc of tcs) {
        const tcPr = kid(tc, "tcPr");
        const span = Math.max(1, num(attr(kid(tcPr, "gridSpan"), "w:val")) ?? 1);
        const hm = attr(kid(tcPr, "hMerge"), "w:val");
        if (kid(tcPr, "hMerge") && hm !== "restart" && cells.length) {
          // Legacy horizontal merge: widen the previous cell.
          cells[cells.length - 1].span += span;
          continue;
        }
        const vm = kid(tcPr, "vMerge");
        const tcW = kid(tcPr, "tcW");
        const w = num(attr(tcW, "w:w"));
        cells.push({
          tc,
          tcPr,
          span,
          vMerge: vm ? (attr(vm, "w:val") === "restart" ? "restart" : "continue") : null,
          width: w && (attr(tcW, "w:type") ?? "dxa") === "dxa" ? Math.round(w / TWIPS_PER_PX) : null,
        });
      }
      raw.push({ tr, cells, before: num(attr(kid(trPr, "gridBefore"), "w:val")) ?? 0 });
    }
    const rows0 = raw.length;
    const fixedRows = correctBadTable(raw);
    if (fixedRows.length !== rows0) this.warn("invalid vertical merges (repaired)");

    // Column widths: a fixed layout resolves cell widths against the grid.
    const grid =
      props.attrs.layout === "fixed"
        ? resolveFixedGrid(gridPx, fixedRows.map((r) => ({ before: r.before, cells: r.cells.map((c) => ({ span: c.span, width: c.width, vMerge: c.vMerge })) }))).map((w) => Math.max(1, Math.round(w)))
        : gridPx;

    // Pass 2: editor JSON with rowspans.
    const rows: JSONContent[] = [];
    const vOpen = new Map<number, JSONContent>();
    for (const r of fixedRows) {
      const trPr = kid(r.tr, "trPr");
      const rowAttrs = readTrPr(trPr);
      const header = rowAttrs.repeatHeader === true;
      let col = r.before ?? 0;
      const cells: JSONContent[] = [];
      for (const c of r.cells) {
        const { tcPr, span } = c;
        if (c.vMerge === "continue" && vOpen.has(col)) {
          const above = vOpen.get(col)!;
          above.attrs!.rowspan = ((above.attrs!.rowspan as number) ?? 1) + 1;
          // The merged cell's bottom border is the last part's.
          const bottom = readTcPr(tcPr).borders;
          if (bottom) {
            const b = parseTableBorders(bottom);
            if (b.bottom) {
              const own = parseTableBorders(above.attrs!.borders);
              own.bottom = b.bottom;
              above.attrs!.borders = encodeTableBorders(own);
            }
          }
          col += span;
          continue;
        }
        const widths = grid.slice(col, col + span);
        const attrs: Record<string, unknown> = { colspan: span, rowspan: 1 };
        if (widths.length === span && widths.every((w) => w > 0)) attrs.colwidth = widths;
        else if (c.width && span === 1) attrs.colwidth = [c.width];
        const shd = kid(tcPr, "shd");
        const fill = attr(shd, "w:fill");
        if (fill && /^[0-9a-f]{6}$/i.test(fill) && attr(shd, "w:val") !== "nil") attrs.backgroundColor = `#${fill.toLowerCase()}`;
        Object.assign(attrs, readTcPr(tcPr));
        let content = this.blocks(c.tc, ctx);
        if (!content.length) content = [{ type: "paragraph" }];
        const cell: JSONContent = { type: header ? "tableHeader" : "tableCell", attrs, content };
        cells.push(cell);
        if (c.vMerge === "restart") for (let k = 0; k < span; k++) vOpen.set(col + k, cell);
        else for (let k = 0; k < span; k++) vOpen.delete(col + k);
        col += span;
      }
      rows.push({ type: "tableRow", ...(Object.keys(rowAttrs).length ? { attrs: rowAttrs } : {}), content: cells });
    }
    const table: JSONContent = { type: "table", ...(Object.keys(props.attrs).length ? { attrs: props.attrs } : {}), content: rows };
    const fixed = normalizeTable(table);
    if (fixed.fixes.some((f) => f !== "empty row" && f !== "empty table")) this.warn("malformed tables (repaired)");
    return fixed.table;
  }
}

/** Marks the header/footer schema has. */
const MARGIN_MARKS = new Set(["bold", "italic", "underline", "strike", "insertion", "deletion", "formatChange"]);

/** Author, date and (raw) id of a revision element. Ids are renumbered per
 *  logical change by groupRevisions. */
function revInfo(e: Element): { id: string; author: string; date: string } {
  return { id: `w${attr(e, "w:id") ?? ""}`, author: attr(e, "w:author") ?? "", date: attr(e, "w:date") ?? "" };
}

function changeMark(type: "insertion" | "deletion", e: Element): Mark {
  return { type, attrs: revInfo(e) };
}

/** groupRevisions gives each logical change one id: consecutive insertions
 *  and deletions (and a paragraph mark right after them) by the same author
 *  at the same time are one change, as are consecutive formatting changes,
 *  since Word gives every run its own revision id. Ids are numbered in
 *  document order, so an export and re-import keeps them. */
export function groupRevisions(docs: (JSONContent | null | undefined)[]): void {
  let n = 0;
  const next = () => `docx-r${++n}`;
  type Open = { key: string; id: string } | null;
  let text: Open = null;
  let fmt: Open = null;
  const keyOf = (a: Record<string, unknown>) => `${a.author ?? ""}\u0000${a.date ?? ""}`;
  const reJSON = (v: unknown, f: (o: Record<string, unknown>) => void): string | unknown => {
    try {
      const o = JSON.parse(String(v)) as Record<string, unknown>;
      f(o);
      return JSON.stringify(o);
    } catch {
      return v;
    }
  };
  const walk = (node: JSONContent) => {
    const tb = node.type === "paragraph" || node.type === "heading";
    if (tb && node.attrs?.propsChange)
      node.attrs.propsChange = reJSON(node.attrs.propsChange, (o) => (o.id = next()));
    if (!tb && node.type !== "doc" && node.content && !node.text) {
      // Structure (tables, lists) breaks runs.
      text = null;
      fmt = null;
    }
    if (node.type === "text" || (node.marks && !node.content)) {
      let sawText = false;
      let sawFmt = false;
      for (const m of node.marks ?? []) {
        if (m.type !== "insertion" && m.type !== "deletion" && m.type !== "formatChange") continue;
        const a = (m.attrs ??= {});
        if (m.type === "insertion" || m.type === "deletion") {
          const k = keyOf(a);
          if (!text || text.key !== k) text = { key: k, id: next() };
          a.id = text.id;
          sawText = true;
        } else if (m.type === "formatChange") {
          const k = keyOf(a);
          if (!fmt || fmt.key !== k) fmt = { key: k, id: next() };
          a.id = fmt.id;
          sawFmt = true;
        }
      }
      if (!sawText) text = null;
      if (!sawFmt) fmt = null;
      return;
    }
    for (const c of node.content ?? []) walk(c);
    if (tb) {
      fmt = null;
      const pc = node.attrs?.paraChange;
      if (pc) {
        node.attrs!.paraChange = reJSON(pc, (o) => {
          const k = keyOf(o);
          if (!text || text.key !== k) text = { key: k, id: next() };
          o.id = text.id;
        });
      } else text = null;
    }
  };
  for (const d of docs) if (d) {
    text = null;
    fmt = null;
    walk(d);
  }
}

type FieldEvent = { k: "begin" | "sep" | "end" } | { k: "instr"; text: string };

/** fieldEvents lists an element's complex-field markers in document order. */
function fieldEvents(e: Element): FieldEvent[] {
  const out: FieldEvent[] = [];
  const walk = (n: Element) => {
    for (const c of kids(n)) {
      const name = nameOf(c);
      if (name === "fldChar") {
        const t = attr(c, "w:fldCharType");
        if (t === "begin") out.push({ k: "begin" });
        else if (t === "separate") out.push({ k: "sep" });
        else if (t === "end") out.push({ k: "end" });
      } else if (name === "instrText") out.push({ k: "instr", text: c.textContent ?? "" });
      else if (name !== "del" && name !== "moveFrom") walk(c);
    }
  };
  walk(e);
  return out;
}

/** plainText is a note or comment body as text: paragraphs joined by
 *  newlines, reference marks and deleted text left out. */
function plainText(e: Element): string {
  const paras: string[] = [];
  for (const p of descendants(e, "p")) {
    let s = "";
    const walk = (n: Element) => {
      for (const c of kids(n)) {
        const name = nameOf(c);
        if (name === "t") s += c.textContent ?? "";
        else if (name === "tab") s += "\t";
        else if (name === "br" || name === "cr") s += "\n";
        else if (name === "noBreakHyphen") s += "‑";
        else if (name === "del" || name === "moveFrom" || name === "instrText" || name === "p") continue;
        else walk(c);
      }
    };
    walk(p);
    paras.push(s);
  }
  return paras.join("\n").replace(/^\s+|\s+$/g, (m) => m.replace(/[^\n]/g, "")).trim();
}

/** HYPERLINK "url" [\l "anchor"] field instructions. */
function parseHyperlinkInstr(instr: string): string | null {
  const m = /^\s*HYPERLINK\s+(.*)$/i.exec(instr);
  if (!m) return null;
  const args = m[1];
  const anchor = /\\l\s+"([^"]*)"/.exec(args)?.[1];
  const url = /^"([^"]*)"/.exec(args.trim())?.[1] ?? (/^([^\s\\]+)/.exec(args.trim())?.[1] ?? "");
  const href = url ? (anchor ? `${url}#${anchor}` : url) : anchor ? `#${anchor}` : null;
  return safeHref(href);
}

/** Script-capable URLs never become links. */
function safeHref(href: string | null): string | null {
  if (!href) return null;
  const s = href.trim();
  if (/^(javascript|vbscript|data|file):/i.test(s.replace(/[\s\u0000-\u001f]/g, ""))) return null;
  return s;
}

/** Keeps header/footer content inside the margin editor's schema. */
function marginContent(blocks: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const b of blocks) {
    if (b.type === "__flatten") out.push(...marginContent(b.content ?? []));
    else if (b.type === "paragraph" || b.type === "heading") {
      const attrs: Record<string, unknown> = {};
      if (b.type === "heading") attrs.level = b.attrs?.level;
      if (b.attrs?.textAlign) attrs.textAlign = b.attrs.textAlign;
      if (b.attrs?.paraChange) attrs.paraChange = b.attrs.paraChange;
      out.push({ ...b, attrs, content: b.content?.filter((n) => n.type === "text" || n.type === "hardBreak") });
    }
  }
  for (const b of out) if (!b.content?.length) delete b.content;
  return out;
}

function pageSetup(sect: Element | null): PageSetup | null {
  if (!sect) return null;
  const sz = kid(sect, "pgSz");
  const mar = kid(sect, "pgMar");
  const w = num(attr(sz, "w:w")) ?? 12240;
  const h = num(attr(sz, "w:h")) ?? 15840;
  const m = (k: string, d: number) => twipsToPt(num(attr(mar, k)) ?? d);
  const orient = attr(sz, "w:orient");
  return {
    width: twipsToPt(w),
    height: twipsToPt(h),
    orientation: orient === "landscape" || (!orient && w > h) ? "landscape" : "portrait",
    margins: {
      top: m("w:top", 1440),
      right: m("w:right", 1440),
      bottom: m("w:bottom", 1440),
      left: m("w:left", 1440),
      header: m("w:header", 720),
      footer: m("w:footer", 720),
    },
  };
}

/** readDocx reads a .docx package into Grown's model. Throws on a file
 *  that isn't a WordprocessingML package. */
export async function readDocx(data: ArrayBuffer | Uint8Array | Blob): Promise<DocxImport> {
  const size = data instanceof Blob ? data.size : data.byteLength;
  if (size > MAX_BYTES) throw new Error(`file too large (${size} bytes)`);
  const zip = await JSZip.loadAsync(data);
  const pkgRels = await loadRels(zip, "");
  const mainRel = relOfType(pkgRels, "officeDocument");
  const mainPath = mainRel?.target ?? "word/document.xml";
  const main = await loadPart(zip, mainPath);
  if (!main) throw new Error("not a Word document (no main document part)");
  const body = kid(main.doc.documentElement, "body");
  if (!body || nameOf(main.doc.documentElement) !== "document") throw new Error("not a WordprocessingML document");

  const r = new Reader(zip);
  const part = async (type: string) => {
    const rel = relOfType(main.rels, type);
    return rel && !rel.external ? loadPart(zip, rel.target) : null;
  };
  const [theme, styles, numbering, footnotes, endnotes, comments, commentsExt] = await Promise.all([
    part("theme"),
    part("styles"),
    part("numbering"),
    part("footnotes"),
    part("endnotes"),
    part("comments"),
    part("commentsExtended"),
  ]);
  r.theme = readThemeFonts(theme?.doc ?? null);
  r.readStyles(styles?.doc ?? null);
  r.readNumbering(numbering?.doc ?? null);
  r.readNotes(footnotes?.doc ?? null, r.footnotes, "footnote");
  r.readNotes(endnotes?.doc ?? null, r.endnotes, "endnote");
  r.readComments(comments?.doc ?? null, commentsExt?.doc ?? null);
  await r.loadMedia(main);

  let content = r.blocks(body, { part: main, marks: [] }).flatMap((b) => (b.type === "__flatten" ? b.content ?? [] : [b]));
  if (!content.length) content = [{ type: "paragraph" }];

  // Header / footer of the final section (default, else first page).
  const sect = kid(body, "sectPr");
  const margin = async (kind: "header" | "footer"): Promise<JSONContent | null> => {
    const refs = kids(sect, `${kind}Reference`);
    const ref = refs.find((x) => (attr(x, "w:type") ?? "default") === "default") ?? refs.find((x) => attr(x, "w:type") === "first") ?? refs[0];
    if (refs.length > 1) r.warn("first-page / even-page headers and footers");
    const rel = ref ? main.rels.get(attr(ref, "r:id") ?? "") : undefined;
    if (!rel || rel.external) return null;
    const hp = await loadPart(zip, rel.target);
    if (!hp) return null;
    const saved = r.fields;
    r.fields = [];
    const blocks = marginContent(r.blocks(hp.doc.documentElement, { part: hp, marks: [], margin: true }));
    r.fields = saved;
    if (!blocks.some((b) => b.content?.length)) return null;
    return { type: "doc", content: blocks };
  };
  const header = await margin("header");
  const footer = await margin("footer");
  groupRevisions([header, { type: "doc", content }, footer]);

  const out: DocxImport = {
    doc: { type: "doc", content },
    styles: {},
    numbering: {},
    header,
    footer,
    comments: [...r.comments.values()],
    page: pageSetup(sect),
    warnings: [],
  };
  // Styles first: they pull in the lists they number and the level styles
  // of used lists, which buildNumbering then maps to Grown ids.
  out.styles = r.buildStyles();
  out.numbering = r.buildNumbering();
  out.warnings = [...r.warnings].sort();
  return out;
}
