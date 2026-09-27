// Direct DOCX writer (Docs M6): Grown's model -> WordprocessingML.
//
// The inverse of read.ts, written from ECMA-376 Part 1 §17 with elements
// in schema order (Word rejects out-of-order children). Input is the
// editor's ProseMirror document plus the `styles` / `numbering` stores,
// the header/footer fragments and the comment threads, so a document
// exported here and imported again yields the same model.
//
// Grown constructs Word has no direct equivalent for are written the
// nearest way: TipTap bullet/ordered lists become numbered paragraphs on
// generated list definitions, task items get a ☐/☒ prefix, block quotes
// an indent, code blocks Courier New, horizontal rules a bottom border,
// Excalidraw drawings their rendered image (when a rasteriser is given).
import JSZip from "jszip";
import type { Mark as PMMark, Node as PMNode } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";
import { NORMAL, paragraphStyleId, type ParaPr, type StyleDef, type StyleSheet } from "../styles";
import { MAX_LEVELS, type LvlDef, type NumberingStore } from "../numbering";
import { directProps } from "../paragraphProps";
import { parseParaChange, parsePropsChange } from "../changes";
import type { DocxComment, PageSetup } from "./model";
import { WORD_STYLE_NAMES } from "./read";
import { marksRunProps, writePPr, writeRPr } from "./props";
import { findTemplate } from "../tableModel";
import { tableStyleXml, tcBordersXml, tcMarXml, vAlignXml, writeTblPr, writeTrPr } from "./tables";
import { writeOMML } from "../math/omml";
import { contentFromAttr } from "../math/model";
import { EMU_PER_PX, el, esc, ptToTwips, ROOT_NS, toHex, TWIPS_PER_PX, XML_DECL, NS } from "./xml";

export interface RasterImage {
  data: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

export interface DocxWriteInput {
  doc: PMNode;
  sheet: StyleSheet;
  numbering: NumberingStore;
  header?: PMNode | null;
  footer?: PMNode | null;
  comments?: DocxComment[];
  title?: string;
  page?: PageSetup | null;
  /** Turns an image the package can't embed (SVG drawings) into PNG. */
  rasterize?: (src: string) => Promise<RasterImage | null>;
  /** Fixed timestamp for revisions and core properties (tests). */
  now?: Date;
}

const REL_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT_BASE = "application/vnd.openxmlformats-officedocument.wordprocessingml";

/** Content width of a Letter page with 1in margins, in px (6.5in). */
const MAX_IMAGE_PX = 624;

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/webp": "webp",
  "image/x-icon": "ico",
};

// --- image helpers ----------------------------------------------------------------------

function decodeDataUrl(src: string): { mime: string; data: Uint8Array } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (m[2]) {
    const bin = atob(m[3].replace(/\s+/g, ""));
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { mime, data };
  }
  return { mime, data: new TextEncoder().encode(decodeURIComponent(m[3])) };
}

/** imageSize reads pixel dimensions from PNG/GIF/JPEG/BMP headers. */
export function imageSize(d: Uint8Array): { width: number; height: number } | null {
  const u32 = (o: number) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
  const u16be = (o: number) => (d[o] << 8) | d[o + 1];
  const u16le = (o: number) => d[o] | (d[o + 1] << 8);
  if (d.length > 24 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return { width: u32(16), height: u32(20) };
  if (d.length > 10 && d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46) return { width: u16le(6), height: u16le(8) };
  if (d.length > 26 && d[0] === 0x42 && d[1] === 0x4d) {
    const w = (d[18] | (d[19] << 8) | (d[20] << 16) | (d[21] << 24)) >>> 0;
    const h = Math.abs(d[22] | (d[23] << 8) | (d[24] << 16) | (d[25] << 24));
    return { width: w, height: h };
  }
  if (d.length > 4 && d[0] === 0xff && d[1] === 0xd8) {
    let o = 2;
    while (o + 9 < d.length) {
      if (d[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = d[o + 1];
      const len = u16be(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { width: u16be(o + 7), height: u16be(o + 5) };
      o += 2 + len;
    }
  }
  return null;
}

// --- relationships ------------------------------------------------------------------------

class Rels {
  private list: { id: string; type: string; target: string; external: boolean }[] = [];
  add(type: string, target: string, external = false): string {
    const hit = this.list.find((r) => r.type === type && r.target === target && r.external === external);
    if (hit) return hit.id;
    const id = `rId${this.list.length + 1}`;
    this.list.push({ id, type, target, external });
    return id;
  }
  get size() {
    return this.list.length;
  }
  xml(): string {
    const body = this.list
      .map((r) =>
        el("Relationship", {
          Id: r.id,
          Type: r.type.startsWith("http") ? r.type : `${REL_BASE}/${r.type}`,
          Target: r.target,
          TargetMode: r.external ? "External" : undefined,
        }),
      )
      .join("");
    return `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  }
}

// --- the writer --------------------------------------------------------------------------

interface ListCtx {
  numId: string;
  lvl: number;
  ordered?: boolean;
}

interface PartCtx {
  rels: Rels;
  /** Body only: comments, notes and change tracking apply. */
  body: boolean;
}

class Writer {
  zip = new JSZip();
  rels = new Rels();
  media: { name: string; data: Uint8Array }[] = [];
  contentTypes = new Map<string, string>();
  defaults = new Map<string, string>([
    ["rels", "application/vnd.openxmlformats-package.relationships+xml"],
    ["xml", "application/xml"],
  ]);
  /** Grown numbering id -> docx numId / abstractNumId. */
  numIds = new Map<string, number>();
  absIds = new Map<string, number>();
  /** Lists generated for TipTap bullet/ordered lists. */
  genAbstracts: { id: number; lvls: LvlDef[] }[] = [];
  genNums: { id: number; abs: number; start?: number }[] = [];
  bulletNum: number | null = null;
  usedStyles = new Set<string>();
  footnotes: string[] = [];
  endnotes: string[] = [];
  footnoteIds = new Map<string, number>();
  endnoteIds = new Map<string, number>();
  revId = 1000;
  drawingId = 1;
  leaf = 0;
  commentFirst = new Map<string, number>();
  commentLast = new Map<string, number>();
  comments = new Map<string, DocxComment>();
  replies = new Map<string, DocxComment[]>();
  commentNum = new Map<string, number>();
  /** Bookmarks (M8): leaf index of the first / last marked inline node. */
  bookmarkFirst = new Map<string, number>();
  bookmarkLast = new Map<string, number>();
  bookmarkIds = new Map<string, number>();
  /** TOC levels written (for the TOC n / table of figures styles). */
  tocStyles = new Set<string>();
  date: string;

  constructor(readonly input: DocxWriteInput) {
    this.date = (input.now ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z");
    for (const c of input.comments ?? []) this.comments.set(c.id, c);
    for (const c of input.comments ?? [])
      if (c.parentId && this.comments.has(c.parentId)) {
        const l = this.replies.get(c.parentId) ?? [];
        l.push(c);
        this.replies.set(c.parentId, l);
      }
  }

  // --- ids ---------------------------------------------------------------------------

  /** Numeric Grown ids keep their number (so a docx round trip is stable);
   *  others get the next free one. */
  allocate(map: Map<string, number>, id: string, reserved: Set<number>, min = 1): number {
    const hit = map.get(id);
    if (hit != null) return hit;
    let n = /^\d+$/.test(id) && +id >= min && !reserved.has(+id) ? +id : -1;
    if (n < 0) {
      n = min;
      while (reserved.has(n)) n++;
    }
    reserved.add(n);
    map.set(id, n);
    return n;
  }
  tableStyles = new Set<string>();
  numReserved = new Set<number>();
  absReserved = new Set<number>([]);

  planNumbering() {
    const store = this.input.numbering;
    const want = new Set<string>();
    this.input.doc.descendants((n) => {
      const id = n.attrs?.numId as string | null | undefined;
      if (id && id !== "0" && store.num(id)) want.add(id);
      return true;
    });
    for (const s of this.input.sheet.all()) if (s.pPr?.numId && s.pPr.numId !== "0" && store.num(s.pPr.numId)) want.add(s.pPr.numId);
    // Numeric ids first, so they keep their numbers.
    const ordered = [...want].sort((a, b) => Number(!/^\d+$/.test(a)) - Number(!/^\d+$/.test(b)));
    for (const id of ordered) if (/^\d+$/.test(id)) this.allocate(this.numIds, id, this.numReserved);
    for (const id of ordered) this.allocate(this.numIds, id, this.numReserved);
    const abs = [...new Set(ordered.map((id) => store.num(id)!.abstractId))].filter((a) => store.abstract(a));
    for (const a of abs) if (/^\d+$/.test(a)) this.allocate(this.absIds, a, this.absReserved, 0);
    for (const a of abs) this.allocate(this.absIds, a, this.absReserved, 0);
  }

  docxNumId(id: string | null | undefined): string | null {
    if (id == null) return null;
    if (id === "0") return "0";
    const n = this.numIds.get(id);
    return n == null ? null : String(n);
  }

  /** A generated list for TipTap bullet / ordered lists. */
  genList(ordered: boolean, start: number): string {
    if (!ordered && this.bulletNum != null) return String(this.bulletNum);
    const absKey = ordered ? "__ordered" : "__bullet";
    let abs = this.absIds.get(absKey);
    if (abs == null) {
      abs = this.allocate(this.absIds, absKey, this.absReserved, 0);
      const fmts: LvlDef["fmt"][] = ["decimal", "lowerLetter", "lowerRoman"];
      const bullets = ["•", "◦", "▪"];
      this.genAbstracts.push({
        id: abs,
        lvls: Array.from({ length: MAX_LEVELS }, (_, i) => ({
          fmt: ordered ? fmts[i % 3] : "bullet",
          text: ordered ? `%${i + 1}.` : bullets[i % 3],
          start: 1,
          indLeft: 36 * (i + 1),
          hanging: 18,
          suffix: "tab" as const,
        })),
      });
    }
    const id = this.allocate(this.numIds, `__gen${this.genNums.length}`, this.numReserved);
    this.genNums.push({ id, abs, start: ordered ? start : undefined });
    if (!ordered) this.bulletNum = id;
    return String(id);
  }

  // --- comments ------------------------------------------------------------------------

  planComments() {
    let i = 0;
    this.input.doc.descendants((n) => {
      if (!n.isInline) return true;
      for (const m of n.marks) {
        if (m.type.name !== "commentMark") continue;
        const id = m.attrs.commentId as string;
        if (!this.comments.has(id)) continue;
        if (!this.commentFirst.has(id)) this.commentFirst.set(id, i);
        this.commentLast.set(id, i);
      }
      i++;
      return false;
    });
    let n = 0;
    for (const id of this.commentFirst.keys()) {
      this.commentNum.set(id, n++);
      for (const r of this.replies.get(id) ?? []) this.commentNum.set(r.id, n++);
    }
  }

  /** planBookmarks numbers bookmarks and finds each one's first and last
   *  inline node (same leaf order as planComments). */
  planBookmarks() {
    let i = 0;
    let next = 0;
    const id = (name: string) => {
      if (!this.bookmarkIds.has(name)) this.bookmarkIds.set(name, next++);
    };
    this.input.doc.descendants((n) => {
      if (!n.isInline) return true;
      if (n.type.name === "bookmarkPoint" && n.attrs.name) id(String(n.attrs.name));
      for (const m of n.marks) {
        if (m.type.name !== "bookmark" || !m.attrs.name) continue;
        const name = String(m.attrs.name);
        id(name);
        if (!this.bookmarkFirst.has(name)) this.bookmarkFirst.set(name, i);
        this.bookmarkLast.set(name, i);
      }
      i++;
      return false;
    });
  }

  threadIds(id: string): number[] {
    return [id, ...(this.replies.get(id) ?? []).map((r) => r.id)].map((x) => this.commentNum.get(x)!);
  }

  // --- styles ----------------------------------------------------------------------------

  useStyle(id: string | null | undefined) {
    const { sheet } = this.input;
    for (const s of sheet.chain(id)) this.usedStyles.add(s.id);
  }

  stylesXml(): string {
    const { sheet } = this.input;
    this.useStyle(NORMAL);
    for (const key of sheet.map.keys()) if (sheet.get(key)) this.useStyle(key);
    for (const n of this.numIds.keys()) {
      for (const l of this.input.numbering.levels(n) ?? []) if (l.pStyle && sheet.get(l.pStyle)) this.useStyle(l.pStyle);
    }
    const defs: StyleDef[] = [...this.usedStyles].map((id) => sheet.get(id)!).filter(Boolean);
    const body = defs
      .map((s) => {
        const pPr = s.type === "paragraph" ? this.stylePPr(s.pPr ?? {}) : "";
        const rPr = writeRPr(s.rPr ?? {});
        const parts = [
          el("w:name", { "w:val": WORD_STYLE_NAMES[s.id] && s.builtin ? WORD_STYLE_NAMES[s.id] : s.name }),
          s.basedOn && this.usedStyles.has(s.basedOn) ? el("w:basedOn", { "w:val": s.basedOn }) : "",
          s.type === "paragraph" && s.next && sheet.get(s.next) && this.usedStyles.has(s.next) ? el("w:next", { "w:val": s.next }) : "",
          el("w:qFormat"),
          pPr,
          rPr,
        ].join("");
        return el(
          "w:style",
          { "w:type": s.type, "w:default": s.id === NORMAL ? "1" : undefined, "w:customStyle": s.builtin ? undefined : "1", "w:styleId": s.id },
          parts,
        );
      })
      .join("");
    const tableStyles = [...this.tableStyles]
      .map((id) => findTemplate(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map(tableStyleXml)
      .join("");
    const defaults =
      "<w:docDefaults><w:rPrDefault><w:rPr>" +
      el("w:rFonts", { "w:ascii": "Arial", "w:hAnsi": "Arial", "w:cs": "Arial", "w:eastAsia": "Arial" }) +
      el("w:sz", { "w:val": 24 }) +
      el("w:szCs", { "w:val": 24 }) +
      el("w:lang", { "w:val": "en-US" }) +
      "</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>";
    return `${XML_DECL}<w:styles ${ROOT_NS}>${defaults}${body}${tableStyles}${this.tocStylesXml()}</w:styles>`;
  }

  /** TOC 1-9 / table of figures paragraph styles for written tables:
   *  right tab with the leader at the text edge. */
  tocStylesXml(): string {
    return [...this.tocStyles]
      .sort()
      .map((key) => {
        const [id, leader] = key.split(":");
        const lvl = /^TOC(\d)$/.exec(id)?.[1];
        const name = lvl ? `toc ${lvl}` : "table of figures";
        const tab = leader === "none" ? "" : el("w:tabs", {}, el("w:tab", { "w:val": "right", "w:leader": leader === "dash" ? "hyphen" : leader, "w:pos": 9350 }));
        const ind = lvl && +lvl > 1 ? el("w:ind", { "w:left": (+lvl - 1) * 220 }) : "";
        return el(
          "w:style",
          { "w:type": "paragraph", "w:styleId": id },
          el("w:name", { "w:val": name }) +
            (this.usedStyles.has(NORMAL) ? el("w:basedOn", { "w:val": NORMAL }) + el("w:next", { "w:val": NORMAL }) : "") +
            el("w:uiPriority", { "w:val": 39 }) +
            el("w:unhideWhenUsed") +
            el("w:pPr", {}, tab + el("w:spacing", { "w:after": 100 }) + ind),
        );
      })
      .join("");
  }

  stylePPr(p: ParaPr): string {
    const numId = p.numId != null ? this.docxNumId(p.numId) : null;
    return writePPr({ ...p, numId: undefined, numLvl: undefined }, { numId, numLvl: numId && numId !== "0" ? p.numLvl ?? null : null });
  }

  // --- numbering ---------------------------------------------------------------------------

  lvlXml(l: LvlDef, i: number): string {
    const fmt = l.fmt;
    const rPr = l.font ? el("w:rPr", {}, el("w:rFonts", { "w:ascii": l.font, "w:hAnsi": l.font, "w:hint": "default" })) : "";
    return el(
      "w:lvl",
      { "w:ilvl": i },
      [
        el("w:start", { "w:val": l.start }),
        el("w:numFmt", { "w:val": fmt }),
        l.pStyle && this.usedStyles.has(l.pStyle) ? el("w:pStyle", { "w:val": l.pStyle }) : "",
        l.legal ? el("w:isLgl") : "",
        el("w:suff", { "w:val": l.suffix ?? "tab" }),
        el("w:lvlText", { "w:val": l.text }),
        l.align ? el("w:lvlJc", { "w:val": l.align }) : "",
        el("w:pPr", {}, el("w:ind", { "w:left": ptToTwips(l.indLeft), "w:hanging": ptToTwips(l.hanging) })),
        rPr,
      ].join(""),
    );
  }

  numberingXml(): string | null {
    const store = this.input.numbering;
    const abs: string[] = [];
    const nums: string[] = [];
    const absDone = new Set<number>();
    for (const [gid, n] of this.numIds) {
      if (gid.startsWith("__gen")) continue;
      const inst = store.num(gid)!;
      const a = store.abstract(inst.abstractId)!;
      const aId = this.absIds.get(a.id)!;
      if (!absDone.has(aId)) {
        absDone.add(aId);
        abs.push(
          el(
            "w:abstractNum",
            { "w:abstractNumId": aId },
            el("w:multiLevelType", { "w:val": "multilevel" }) +
              (a.name ? el("w:name", { "w:val": a.name }) : "") +
              a.lvls.slice(0, MAX_LEVELS).map((l, i) => this.lvlXml(l, i)).join(""),
          ),
        );
      }
      const overrides = Object.entries(inst.starts ?? {})
        .sort((x, y) => +x[0] - +y[0])
        .map(([lvl, v]) => el("w:lvlOverride", { "w:ilvl": lvl }, el("w:startOverride", { "w:val": v })))
        .join("");
      nums.push(el("w:num", { "w:numId": n }, el("w:abstractNumId", { "w:val": aId }) + overrides));
    }
    for (const g of this.genAbstracts)
      abs.push(
        el(
          "w:abstractNum",
          { "w:abstractNumId": g.id },
          el("w:multiLevelType", { "w:val": "hybridMultilevel" }) + g.lvls.map((l, i) => this.lvlXml(l, i)).join(""),
        ),
      );
    for (const g of this.genNums)
      nums.push(
        el(
          "w:num",
          { "w:numId": g.id },
          el("w:abstractNumId", { "w:val": g.abs }) +
            (g.start != null ? el("w:lvlOverride", { "w:ilvl": 0 }, el("w:startOverride", { "w:val": g.start })) : ""),
        ),
      );
    if (!nums.length) return null;
    return `${XML_DECL}<w:numbering ${ROOT_NS}>${abs.join("")}${nums.join("")}</w:numbering>`;
  }

  // --- blocks -----------------------------------------------------------------------------

  async blocks(parent: PMNode, ctx: PartCtx, list: ListCtx | null = null, extraInd = 0): Promise<string> {
    const out: string[] = [];
    for (let i = 0; i < parent.childCount; i++) out.push(await this.block(parent.child(i), ctx, list, extraInd));
    return out.join("");
  }

  async block(node: PMNode, ctx: PartCtx, list: ListCtx | null, extraInd: number): Promise<string> {
    const t = node.type.name;
    switch (t) {
      case "paragraph":
      case "heading":
        return this.paragraph(node, ctx, list, extraInd);
      case "bulletList":
      case "orderedList":
      case "taskList": {
        const ordered = t === "orderedList";
        const lvl = list ? Math.min(MAX_LEVELS - 1, list.lvl + 1) : 0;
        // Nested lists of the same kind continue their parent's list one
        // level down; a new top-level (or differently-kinded) list gets
        // its own instance.
        const numId =
          t === "taskList"
            ? null
            : list && list.numId && list.ordered === ordered
              ? list.numId
              : this.genList(ordered, (node.attrs.start as number) ?? 1);
        let out = "";
        for (let i = 0; i < node.childCount; i++) {
          const item = node.child(i);
          const prefix = t === "taskList" ? (item.attrs.checked ? "\u2612 " : "\u2610 ") : "";
          let first = true;
          for (let k = 0; k < item.childCount; k++) {
            const c = item.child(k);
            if (c.type.name === "paragraph" || c.type.name === "heading") {
              out += await this.paragraph(
                c,
                ctx,
                numId && first ? { numId, lvl, ordered } : null,
                extraInd + (numId && first ? 0 : 36 * (lvl + 1)),
                first ? prefix : "",
              );
              first = false;
            } else if (/List$/.test(c.type.name)) out += await this.block(c, ctx, { numId: numId ?? "", lvl, ordered }, extraInd);
            else out += await this.block(c, ctx, null, extraInd + 36 * (lvl + 1));
          }
        }
        return out;
      }
      case "blockquote":
        return this.blocks(node, ctx, null, extraInd + 36);
      case "codeBlock": {
        if (ctx.body) this.leaf += node.childCount;
        const lines = node.textContent.split("\n");
        const rPr = writeRPr({ fontFamily: "Courier New" });
        const runs = lines
          .map((l, i) => (i ? `<w:r>${rPr}<w:br/></w:r>` : "") + (l ? `<w:r>${rPr}${this.textXml(l, false)}</w:r>` : ""))
          .join("");
        return `<w:p>${writePPr({ indLeft: extraInd || undefined, spaceAfter: 6 })}${runs}</w:p>`;
      }
      case "horizontalRule":
        return `<w:p>${writePPr({ borders: { bottom: { width: 0.75, style: "solid", color: "#999999" } } })}</w:p>`;
      case "pageBreak":
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      case "image":
      case "drawing": {
        const d = await this.imageRun(node, ctx);
        return `<w:p>${extraInd ? writePPr({ indLeft: extraInd }) : ""}${d ?? ""}</w:p>`;
      }
      case "table":
        return this.table(node, ctx);
      case "tableOfContents":
        return this.tableOfContents(node, ctx);
      default:
        // Unknown blocks: keep their text.
        if (node.isTextblock) return this.paragraph(node, ctx, list, extraInd);
        if (node.childCount) return this.blocks(node, ctx, list, extraInd);
        return "";
    }
  }

  async paragraph(node: PMNode, ctx: PartCtx, list: ListCtx | null, extraInd: number, prefix = ""): Promise<string> {
    const { sheet } = this.input;
    const isHeading = node.type.name === "heading";
    let styleId: string | null = null;
    if (isHeading || node.type.name === "paragraph") {
      const sid = paragraphStyleId(sheet, node);
      if (sid !== NORMAL) styleId = sid;
    }
    if (styleId) this.useStyle(styleId);
    const direct: ParaPr = node.type.name === "paragraph" || isHeading ? directProps(node) : {};
    if (extraInd) direct.indLeft = (direct.indLeft ?? 0) + extraInd;
    let numId: string | null = null;
    let numLvl: number | null = null;
    if (list && list.numId) {
      numId = list.numId;
      numLvl = list.lvl;
    } else if (node.attrs.numId != null) {
      numId = this.docxNumId(node.attrs.numId as string);
      numLvl = numId && numId !== "0" ? ((node.attrs.numLvl as number | null) ?? 0) : null;
    }
    const pPr = writePPr(direct, { styleId, numId, numLvl, rPr: this.paraMarkRPr(node), extra: this.pPrChange(node) });
    const runs = await this.inline(node, ctx, prefix);
    return `<w:p>${pPr}${runs}</w:p>`;
  }

  /** Revision attributes (w:id, w:author, w:date) of a change record. */
  revAttrs(info: { author?: unknown; date?: unknown }): Record<string, string | number> {
    const d = typeof info.date === "string" && /^\d{4}-\d\d-\d\dT/.test(info.date) ? info.date.replace(/\.\d+Z$/, "Z") : this.date;
    return { "w:id": this.revId++, "w:author": (info.author as string) || "Unknown", "w:date": d };
  }

  /** The paragraph mark's run properties: w:ins / w:del when the mark was
   *  inserted or deleted with tracking on. */
  paraMarkRPr(node: PMNode): string {
    const pc = parseParaChange(node.attrs.paraChange);
    if (!pc) return "";
    return el("w:rPr", {}, el(pc.type === "insert" ? "w:ins" : "w:del", this.revAttrs(pc)));
  }

  /** w:pPrChange with the paragraph's properties before a tracked change. */
  pPrChange(node: PMNode): string {
    const pc = parsePropsChange(node.attrs.propsChange);
    if (!pc) return "";
    let old: PMNode;
    try {
      const type = node.type.schema.nodes[pc.type] ?? node.type;
      old = type.create({ ...pc.attrs, paraChange: null, propsChange: null });
    } catch {
      return "";
    }
    const { sheet } = this.input;
    const sid = old.type.name === "paragraph" || old.type.name === "heading" ? paragraphStyleId(sheet, old) : NORMAL;
    if (sid !== NORMAL) this.useStyle(sid);
    const numId = old.attrs.numId != null ? this.docxNumId(old.attrs.numId as string) : null;
    const numLvl = numId && numId !== "0" ? ((old.attrs.numLvl as number | null) ?? 0) : null;
    const inner = writePPr(directProps(old), { styleId: sid !== NORMAL ? sid : null, numId, numLvl }) || "<w:pPr/>";
    return el("w:pPrChange", this.revAttrs(pc), inner);
  }

  // --- runs ----------------------------------------------------------------------------------

  textXml(text: string, deleted: boolean): string {
    let out = "";
    let buf = "";
    const tag = deleted ? "w:delText" : "w:t";
    const flush = () => {
      if (buf) out += `<${tag} xml:space="preserve">${esc(buf)}</${tag}>`;
      buf = "";
    };
    for (const ch of text) {
      if (ch === "\t") (flush(), (out += "<w:tab/>"));
      else if (ch === "\n") (flush(), (out += "<w:br/>"));
      else if (ch === "\u2011") (flush(), (out += "<w:noBreakHyphen/>"));
      else if (ch === "\u00ad") (flush(), (out += "<w:softHyphen/>"));
      else buf += ch;
    }
    flush();
    return out;
  }

  async inline(node: PMNode, ctx: PartCtx, prefix: string): Promise<string> {
    type Item = { href: string | null; title?: string | null; xml: string };
    const items: Item[] = [];
    if (prefix) items.push({ href: null, xml: `<w:r>${this.textXml(prefix, false)}</w:r>` });
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      const idx = ctx.body ? this.leaf++ : -1;
      const link = c.marks.find((m) => m.type.name === "link");
      const href = (link?.attrs.href as string | undefined) || null;
      const title = (link?.attrs.title as string | undefined) || null;
      if (ctx.body) for (const [name, first] of this.bookmarkFirst) if (first === idx)
        items.push({ href, title, xml: el("w:bookmarkStart", { "w:id": this.bookmarkIds.get(name)!, "w:name": name }) });
      if (ctx.body) for (const [id, first] of this.commentFirst) if (first === idx)
        for (const n of this.threadIds(id)) items.push({ href, xml: el("w:commentRangeStart", { "w:id": n }) });
      const fc = c.marks.find((m) => m.type.name === "formatChange");
      const rPr = writeRPr(marksRunProps(c.marks), fc ? this.rPrChange(fc) : "");
      let run = "";
      if (c.isText) run = `<w:r>${rPr}${this.textXml(c.text ?? "", c.marks.some((m) => m.type.name === "deletion"))}</w:r>`;
      else if (c.type.name === "hardBreak") run = `<w:r>${rPr}<w:br/></w:r>`;
      else if (c.type.name === "footnote" || c.type.name === "endnote") {
        if (ctx.body) run = this.noteRef(c, writeRPr({ ...marksRunProps(c.marks), vertAlign: "super" }));
      } else if (c.type.name === "image") run = (await this.imageRun(c, ctx)) ?? "";
      else if (c.type.name === "math") run = writeOMML(contentFromAttr(c.attrs.data), !!c.attrs.display);
      else if (c.type.name === "field") run = fieldRuns(String(c.attrs.instr ?? ""), String(c.attrs.result ?? ""), rPr, !!c.attrs.locked, (t) => this.textXml(t, false));
      else if (c.type.name === "bookmarkPoint") {
        const id = ctx.body ? this.bookmarkIds.get(String(c.attrs.name)) : undefined;
        if (id != null) run = el("w:bookmarkStart", { "w:id": id, "w:name": String(c.attrs.name) }) + el("w:bookmarkEnd", { "w:id": id });
      }
      else if (c.textContent) run = `<w:r>${rPr}${this.textXml(c.textContent, false)}</w:r>`;
      if (run) items.push({ href, title, xml: c.type.name === "bookmarkPoint" ? run : this.tracked(c.marks, run) });
      if (ctx.body) for (const [id, last] of this.commentLast) if (last === idx)
        for (const n of this.threadIds(id))
          items.push({
            href,
            xml:
              el("w:commentRangeEnd", { "w:id": n }) +
              `<w:r>${el("w:commentReference", { "w:id": n })}</w:r>`,
          });
      if (ctx.body) for (const [name, last] of this.bookmarkLast) if (last === idx)
        items.push({ href, title, xml: el("w:bookmarkEnd", { "w:id": this.bookmarkIds.get(name)! }) });
    }
    // Group consecutive items with the same link into one w:hyperlink.
    let out = "";
    for (let i = 0; i < items.length; ) {
      const href = items[i].href;
      const title = items.slice(i).find((x) => x.href === href && x.title)?.title ?? null;
      let j = i;
      let body = "";
      while (j < items.length && items[j].href === href) body += items[j++].xml;
      if (href) {
        const attrs: Record<string, string> = {};
        if (href.startsWith("#")) attrs["w:anchor"] = href.slice(1);
        else attrs["r:id"] = ctx.rels.add("hyperlink", href, true);
        if (title) attrs["w:tooltip"] = title;
        out += el("w:hyperlink", attrs, body);
      } else out += body;
      i = j;
    }
    return out;
  }

  /** Wraps a run in w:ins / w:del for suggestion marks. */
  tracked(marks: readonly PMMark[], run: string): string {
    const ins = marks.find((m) => m.type.name === "insertion");
    const del = marks.find((m) => m.type.name === "deletion");
    const wrap = (tag: string, m: PMMark, body: string) => el(tag, this.revAttrs(m.attrs), body);
    if (del) run = wrap("w:del", del, run);
    if (ins) run = wrap("w:ins", ins, run);
    return run;
  }

  /** w:rPrChange with the run's formatting before a tracked change. */
  rPrChange(m: PMMark): string {
    let old: { type: string; attrs?: Record<string, unknown> }[] = [];
    try {
      old = JSON.parse(String(m.attrs.old ?? "[]"));
    } catch {
      old = [];
    }
    return el("w:rPrChange", this.revAttrs(m.attrs), writeRPr(marksRunProps(old)) || "<w:rPr/>");
  }

  noteRef(n: PMNode, rPr: string): string {
    const foot = n.type.name === "footnote";
    const ids = foot ? this.footnoteIds : this.endnoteIds;
    const list = foot ? this.footnotes : this.endnotes;
    const key = String(n.attrs.id ?? `anon${list.length}`);
    let id = ids.get(key);
    if (id == null) {
      const m = /^(?:fn|en)-(\d+)$/.exec(key);
      const used = new Set(ids.values());
      id = m && +m[1] > 0 && !used.has(+m[1]) ? +m[1] : Math.max(0, ...used) + 1;
      ids.set(key, id);
      const tag = foot ? "footnote" : "endnote";
      const ref = foot ? "w:footnoteRef" : "w:endnoteRef";
      const paras = String(n.attrs.content ?? "").split("\n");
      const body = paras
        .map(
          (p, i) =>
            `<w:p>${i === 0 ? `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><${ref}/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>` : ""}${
              p ? `<w:r>${this.textXml(p, false)}</w:r>` : ""
            }</w:p>`,
        )
        .join("");
      list.push(el(`w:${tag}`, { "w:id": id }, body));
    }
    const tag = foot ? "w:footnoteReference" : "w:endnoteReference";
    return `<w:r>${rPr}${el(tag, { "w:id": id })}</w:r>`;
  }

  async imageRun(node: PMNode, ctx: PartCtx): Promise<string | null> {
    const src = String(node.attrs.src ?? "");
    let img: { mime: string; data: Uint8Array } | null = decodeDataUrl(src);
    let size: { width: number; height: number } | null = null;
    if (!img || !MIME_EXT[img.mime]) {
      const r = this.input.rasterize && src ? await this.input.rasterize(src).catch(() => null) : null;
      if (!r) return node.attrs.alt ? `<w:r>${this.textXml(`[${node.attrs.alt}]`, false)}</w:r>` : null;
      img = { mime: r.mime, data: r.data };
      size = { width: r.width, height: r.height };
    }
    const ext = MIME_EXT[img.mime];
    const name = `image${this.media.length + 1}.${ext}`;
    this.media.push({ name, data: img.data });
    this.defaults.set(ext, img.mime);
    const rid = ctx.rels.add("image", `media/${name}`);
    const natural = imageSize(img.data) ?? size ?? { width: 300, height: 200 };
    let w = Number(node.attrs.width) || 0;
    let h = Number(node.attrs.height) || 0;
    if (w && !h) h = Math.round((w * natural.height) / Math.max(1, natural.width));
    if (!w) {
      w = natural.width;
      h = natural.height;
      if (w > MAX_IMAGE_PX) {
        h = Math.round((h * MAX_IMAGE_PX) / w);
        w = MAX_IMAGE_PX;
      }
    }
    const cx = Math.max(1, Math.round(w * EMU_PER_PX));
    const cy = Math.max(1, Math.round(h * EMU_PER_PX));
    const id = this.drawingId++;
    const alt = String(node.attrs.alt ?? "");
    return (
      "<w:r><w:drawing>" +
      `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
      el("wp:extent", { cx, cy }) +
      el("wp:effectExtent", { l: 0, t: 0, r: 0, b: 0 }) +
      el("wp:docPr", { id, name: `Picture ${id}`, descr: alt || undefined }) +
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic><a:graphicData uri="${NS.pic}"><pic:pic>` +
      `<pic:nvPicPr>${el("pic:cNvPr", { id: 0, name })}<pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill>${el("a:blip", { "r:embed": rid })}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/>${el("a:ext", { cx, cy })}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
    );
  }

  // --- table of contents (M8) ---------------------------------------------------------------

  /** A TOC as Word writes it: a "Table of Contents" content control around
   *  a TOC field whose result is the entry paragraphs (TOC n styles, a
   *  hyperlink to the heading's _Toc bookmark, a tab and a PAGEREF). */
  async tableOfContents(node: PMNode, ctx: PartCtx): Promise<string> {
    const instr = String(node.attrs.instr ?? "TOC");
    const figures = /\\c\s/.test(instr);
    const noPages = /\\n(\s|$)/.test(instr);
    const leader = String(node.attrs.leader ?? "dot");
    const paras: string[] = [];
    const count = node.childCount;
    for (let i = 0; i < count; i++) {
      const entry = node.child(i);
      const level = Math.min(9, Math.max(1, Number(entry.attrs.level) || 1));
      const styleId = figures ? "TableofFigures" : `TOC${level}`;
      this.tocStyles.add(`${styleId}:${leader}`);
      const begin = i === 0 ? fieldBegin(instr) : "";
      const end = i === count - 1 ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : "";
      const body = await this.inline(entry, ctx, "");
      let page = "";
      const pageText = String(entry.attrs.page ?? "");
      if (!noPages && pageText) {
        let target: string | null = null;
        entry.forEach((c) => {
          const href = c.marks.find((m) => m.type.name === "link")?.attrs.href as string | undefined;
          if (!target && href?.startsWith("#")) target = href.slice(1);
        });
        page =
          "<w:r><w:tab/></w:r>" +
          (target ? fieldRuns(`PAGEREF ${target} \\h`, pageText, "", false, (t) => this.textXml(t, false)) : `<w:r>${this.textXml(pageText, false)}</w:r>`);
      }
      paras.push(`<w:p>${el("w:pPr", {}, el("w:pStyle", { "w:val": styleId }))}${begin}${body}${page}${end}</w:p>`);
    }
    return (
      "<w:sdt><w:sdtPr>" +
      el("w:docPartObj", {}, el("w:docPartGallery", { "w:val": figures ? "Table of Figures" : "Table of Contents" }) + el("w:docPartUnique")) +
      `</w:sdtPr><w:sdtContent>${paras.join("")}</w:sdtContent></w:sdt>`
    );
  }

  // --- tables ------------------------------------------------------------------------------

  async table(node: PMNode, ctx: PartCtx): Promise<string> {
    const map = TableMap.get(node);
    const cols = map.width;
    const colW: number[] = Array(cols).fill(0);
    for (let r = 0; r < map.height; r++)
      for (let c = 0; c < cols; c++) {
        const pos = map.map[r * cols + c];
        const cell = node.nodeAt(pos)!;
        const rect = map.findCell(pos);
        const cw = cell.attrs.colwidth as number[] | null;
        if (cw && cw[c - rect.left] && !colW[c]) colW[c] = cw[c - rect.left];
      }
    const known = colW.filter(Boolean);
    const rest = Math.max(1, MAX_IMAGE_PX - known.reduce((a, b) => a + b, 0));
    const fill = Math.max(24, Math.round(rest / Math.max(1, cols - known.length)));
    const grid = colW.map((w) => (w || fill) * TWIPS_PER_PX);
    const { xml: tblPr, styleId } = writeTblPr(node.attrs);
    if (styleId) this.tableStyles.add(styleId);
    const tblGrid = el("w:tblGrid", {}, grid.map((w) => el("w:gridCol", { "w:w": w })).join(""));
    let rows = "";
    for (let r = 0; r < map.height; r++) {
      const rowNode = node.child(r);
      const header = rowNode.childCount > 0 && Array.from({ length: rowNode.childCount }, (_, i) => rowNode.child(i)).every((c) => c.type.name === "tableHeader");
      let cells = "";
      for (let c = 0; c < cols; ) {
        const pos = map.map[r * cols + c];
        const rect = map.findCell(pos);
        const cell = node.nodeAt(pos)!;
        const span = rect.right - rect.left;
        const w = grid.slice(rect.left, rect.right).reduce((a, b) => a + b, 0);
        const tcW = el("w:tcW", { "w:w": w, "w:type": "dxa" });
        const gridSpan = span > 1 ? el("w:gridSpan", { "w:val": span }) : "";
        const fillHex = toHex(cell.attrs.backgroundColor as string | null);
        const shd = fillHex ? el("w:shd", { "w:val": "clear", "w:color": "auto", "w:fill": fillHex }) : "";
        const merged = rect.bottom - rect.top > 1;
        const last = rect.bottom - 1 === r;
        // A vertically merged cell's parts share its sides; its top border
        // goes on the first part and its bottom border on the last.
        const sides = (["top", "left", "bottom", "right"] as const).filter(
          (s) => (s !== "top" || rect.top === r) && (s !== "bottom" || !merged || last),
        );
        const cellPr = (vMerge: string) =>
          el("w:tcPr", {}, tcW + gridSpan + vMerge + tcBordersXml(cell.attrs, sides) + shd + tcMarXml(cell.attrs) + vAlignXml(cell.attrs));
        if (rect.top < r) {
          cells += `<w:tc>${cellPr(el("w:vMerge"))}<w:p/></w:tc>`;
        } else {
          const vMerge = merged ? el("w:vMerge", { "w:val": "restart" }) : "";
          let content = await this.blocks(cell, ctx);
          // A cell must end with a paragraph.
          if (!content || !/<\/w:p>$|<w:p\/>$/.test(content)) content += "<w:p/>";
          cells += `<w:tc>${cellPr(vMerge)}${content}</w:tc>`;
        }
        c = rect.right;
      }
      rows += `<w:tr>${writeTrPr(rowNode.attrs, header)}${cells}</w:tr>`;
    }
    return `<w:tbl>${tblPr}${tblGrid}${rows}</w:tbl>`;
  }

  // --- parts -------------------------------------------------------------------------------

  override(part: string, type: string) {
    this.contentTypes.set(`/${part}`, type);
  }

  async marginPart(kind: "header" | "footer", node: PMNode | null | undefined): Promise<string | null> {
    if (!node || !node.textContent.trim()) return null;
    const rels = new Rels();
    const body = await this.blocks(node, { rels, body: false });
    const tag = kind === "header" ? "w:hdr" : "w:ftr";
    const name = `${kind}1.xml`;
    this.zip.file(`word/${name}`, `${XML_DECL}<${tag} ${ROOT_NS}>${body || "<w:p/>"}</${tag}>`);
    if (rels.size) this.zip.file(`word/_rels/${name}.rels`, rels.xml());
    this.override(`word/${name}`, `${CT_BASE}.${kind}+xml`);
    return this.rels.add(kind, name);
  }

  commentsXml(): { comments: string; ext: string } | null {
    if (!this.commentNum.size) return null;
    const entries: string[] = [];
    const exts: string[] = [];
    const paraIds = new Map<string, string>();
    let seq = 0x10000001;
    const all = [...this.commentNum.entries()].sort((a, b) => a[1] - b[1]);
    for (const [id] of all) paraIds.set(id, (seq++).toString(16).toUpperCase().padStart(8, "0"));
    for (const [id, n] of all) {
      const c = this.comments.get(id)!;
      const lines = c.text.split("\n");
      const pid = paraIds.get(id)!;
      const paras = lines
        .map((l, i) => {
          const attrs = i === lines.length - 1 ? ` w14:paraId="${pid}" w14:textId="77777777"` : "";
          const ref = i === 0 ? "<w:r><w:annotationRef/></w:r>" : "";
          return `<w:p${attrs}>${ref}${l ? `<w:r>${this.textXml(l, false)}</w:r>` : ""}</w:p>`;
        })
        .join("");
      entries.push(
        el(
          "w:comment",
          {
            "w:id": n,
            "w:author": c.author || "Unknown",
            "w:date": c.date ? c.date.replace(/\.\d+(Z|[+-]\d\d:\d\d)$/, "$1") : undefined,
            "w:initials": c.initials || undefined,
          },
          paras,
        ),
      );
      const parent = c.parentId && paraIds.get(c.parentId);
      exts.push(el("w15:commentEx", { "w15:paraId": pid, "w15:paraIdParent": parent || undefined, "w15:done": c.resolved ? 1 : 0 }));
    }
    return {
      comments: `${XML_DECL}<w:comments ${ROOT_NS}>${entries.join("")}</w:comments>`,
      ext: `${XML_DECL}<w15:commentsEx xmlns:w15="${NS.w15}" xmlns:mc="${NS.mc}" mc:Ignorable="w15">${exts.join("")}</w15:commentsEx>`,
    };
  }

  notesXml(kind: "footnote" | "endnote", notes: string[]): string {
    const tag = `w:${kind}`;
    const sep =
      el(tag, { "w:type": "separator", "w:id": -1 }, "<w:p><w:r><w:separator/></w:r></w:p>") +
      el(tag, { "w:type": "continuationSeparator", "w:id": 0 }, "<w:p><w:r><w:continuationSeparator/></w:r></w:p>");
    return `${XML_DECL}<w:${kind}s ${ROOT_NS}>${sep}${notes.join("")}</w:${kind}s>`;
  }

  async write(): Promise<Uint8Array> {
    const { input } = this;
    this.planNumbering();
    this.planComments();
    this.planBookmarks();
    const body = await this.blocks(input.doc, { rels: this.rels, body: true });
    const headerId = await this.marginPart("header", input.header);
    const footerId = await this.marginPart("footer", input.footer);

    const page = input.page ?? { width: 612, height: 792, orientation: "portrait", margins: { top: 72, right: 72, bottom: 72, left: 72 } };
    const sectPr = el(
      "w:sectPr",
      {},
      (headerId ? el("w:headerReference", { "w:type": "default", "r:id": headerId }) : "") +
        (footerId ? el("w:footerReference", { "w:type": "default", "r:id": footerId }) : "") +
        el("w:pgSz", {
          "w:w": ptToTwips(page.width),
          "w:h": ptToTwips(page.height),
          "w:orient": page.orientation === "landscape" ? "landscape" : undefined,
        }) +
        el("w:pgMar", {
          "w:top": ptToTwips(page.margins.top),
          "w:right": ptToTwips(page.margins.right),
          "w:bottom": ptToTwips(page.margins.bottom),
          "w:left": ptToTwips(page.margins.left),
          "w:header": ptToTwips(page.margins.header ?? 36),
          "w:footer": ptToTwips(page.margins.footer ?? 36),
          "w:gutter": 0,
        }),
    );
    this.zip.file(
      "word/document.xml",
      `${XML_DECL}<w:document ${ROOT_NS}><w:body>${body}${sectPr}</w:body></w:document>`,
    );
    this.override("word/document.xml", `${CT_BASE}.document.main+xml`);

    this.zip.file("word/styles.xml", this.stylesXml());
    this.override("word/styles.xml", `${CT_BASE}.styles+xml`);
    this.rels.add("styles", "styles.xml");

    const numbering = this.numberingXml();
    if (numbering) {
      this.zip.file("word/numbering.xml", numbering);
      this.override("word/numbering.xml", `${CT_BASE}.numbering+xml`);
      this.rels.add("numbering", "numbering.xml");
    }
    let notePr = "";
    if (this.footnotes.length) {
      this.zip.file("word/footnotes.xml", this.notesXml("footnote", this.footnotes));
      this.override("word/footnotes.xml", `${CT_BASE}.footnotes+xml`);
      this.rels.add("footnotes", "footnotes.xml");
      notePr += '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>';
    }
    if (this.endnotes.length) {
      this.zip.file("word/endnotes.xml", this.notesXml("endnote", this.endnotes));
      this.override("word/endnotes.xml", `${CT_BASE}.endnotes+xml`);
      this.rels.add("endnotes", "endnotes.xml");
      notePr += '<w:endnotePr><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr>';
    }
    const comments = this.commentsXml();
    if (comments) {
      this.zip.file("word/comments.xml", comments.comments);
      this.override("word/comments.xml", `${CT_BASE}.comments+xml`);
      this.rels.add("comments", "comments.xml");
      this.zip.file("word/commentsExtended.xml", comments.ext);
      this.override("word/commentsExtended.xml", `${CT_BASE}.commentsExtended+xml`);
      this.rels.add("http://schemas.microsoft.com/office/2011/relationships/commentsExtended", "commentsExtended.xml");
    }
    this.zip.file(
      "word/settings.xml",
      `${XML_DECL}<w:settings ${ROOT_NS}>${el("w:defaultTabStop", { "w:val": 720 })}${notePr}` +
        `<w:compat>${el("w:compatSetting", { "w:name": "compatibilityMode", "w:uri": "http://schemas.microsoft.com/office/word", "w:val": 15 })}</w:compat></w:settings>`,
    );
    this.override("word/settings.xml", `${CT_BASE}.settings+xml`);
    this.rels.add("settings", "settings.xml");

    for (const m of this.media) this.zip.file(`word/media/${m.name}`, m.data);
    this.zip.file("word/_rels/document.xml.rels", this.rels.xml());

    // Package parts.
    const pkg = new Rels();
    pkg.add("officeDocument", "word/document.xml");
    pkg.add("http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml");
    pkg.add("extended-properties", "docProps/app.xml");
    this.zip.file("_rels/.rels", pkg.xml());
    this.zip.file(
      "docProps/core.xml",
      `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
        `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
        `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        (input.title ? `<dc:title>${esc(input.title)}</dc:title>` : "") +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${this.date}</dcterms:created>` +
        `<dcterms:modified xsi:type="dcterms:W3CDTF">${this.date}</dcterms:modified></cp:coreProperties>`,
    );
    this.override("docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml");
    this.zip.file(
      "docProps/app.xml",
      `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Grown Docs</Application></Properties>`,
    );
    this.override("docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml");

    const ct =
      [...this.defaults].map(([ext, type]) => el("Default", { Extension: ext, ContentType: type })).join("") +
      [...this.contentTypes].map(([p, type]) => el("Override", { PartName: p, ContentType: type })).join("");
    this.zip.file(
      "[Content_Types].xml",
      `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${ct}</Types>`,
    );
    return this.zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: `${CT_BASE}.document` });
  }
}

/** writeDocx serialises a Grown document as a .docx package. */
/** The begin, instruction and separate runs of a complex field. */
function fieldBegin(instr: string, rPr = "", locked = false): string {
  return (
    `<w:r>${rPr}${el("w:fldChar", { "w:fldCharType": "begin", "w:fldLock": locked ? "1" : undefined })}</w:r>` +
    `<w:r>${rPr}<w:instrText xml:space="preserve"> ${esc(instr.trim())} </w:instrText></w:r>` +
    `<w:r>${rPr}<w:fldChar w:fldCharType="separate"/></w:r>`
  );
}

/** A complex field (w:fldChar begin / instrText / separate / result / end). */
function fieldRuns(instr: string, result: string, rPr: string, locked: boolean, text: (t: string) => string): string {
  return (
    fieldBegin(instr, rPr, locked) +
    (result ? `<w:r>${rPr}${text(result)}</w:r>` : "") +
    `<w:r>${rPr}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

export function writeDocx(input: DocxWriteInput): Promise<Uint8Array> {
  return new Writer(input).write();
}
