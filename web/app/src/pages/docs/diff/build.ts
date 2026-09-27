// Building a tracked-changes document from a merged edit script (Docs M12).
//
// The result uses Track changes v2's model (changes.ts): inserted text gets
// an `insertion` mark, removed text is kept with a `deletion` mark, text
// whose formatting differs gets a `formatChange` mark holding the old
// formatting, a paragraph mark that exists on one side only gets
// `paraChange`, and a paragraph whose type or properties changed gets
// `propsChange`. Every change carries the author and date of the side that
// made it; neighbouring edits by one author share an id (one "replace").
import type { Mark, Node as PMNode, Schema } from "@tiptap/pm/model";
import { formatMarks, marksJSON, propsAttrs, propsKey, newChangeId, type ChangeInfo } from "../changes";
import type { PathEntry, Tok } from "./stream";

export interface Author {
  name: string;
  /** ISO date (seconds). */
  date: string;
}

export type Item =
  | { t: "eq"; old: Tok; neu: Tok; author: Author; path: PathEntry[] }
  | { t: "del"; old: Tok; author: Author; path: PathEntry[] }
  | { t: "ins"; neu: Tok; author: Author; path: PathEntry[] };

export interface BuildOpts {
  /** Mark inserted content (false: show it as plain text). Default true. */
  insertions?: boolean;
  /** Record formatting and paragraph-property changes. Default true. */
  formatting?: boolean;
  /** Keep review marks the inputs already carry. Default false. */
  keepExisting?: boolean;
  newId?: () => string;
}

const REVIEW = new Set(["insertion", "deletion", "formatChange"]);
/** Marks that belong to the old document only and are dropped from text
 *  that comes back as a deletion (comment anchors, bookmark names). */
const OLD_ONLY = new Set(["commentMark", "bookmark"]);

type ParaState = { type: "insert" | "delete"; info: ChangeInfo } | null;

interface OutPara {
  kind: "para";
  node: PMNode;
  props: string | null;
  pc: ParaState;
  inline: PMNode[];
  path: PathEntry[];
}
interface OutBlock {
  kind: "block";
  node: PMNode;
  path: PathEntry[];
}
type Out = OutPara | OutBlock;

function withMark(node: PMNode, mark: Mark, parentOk: boolean): PMNode {
  if (!parentOk) return node;
  if (node.marks.some((m) => m.type === mark.type)) return node;
  return node.mark(mark.addToSet(node.marks));
}

function stripMarks(node: PMNode, drop: (name: string) => boolean): PMNode {
  const keep = node.marks.filter((m) => !drop(m.type.name));
  return keep.length === node.marks.length ? node : node.mark(keep);
}

/** buildDoc turns merged items into a document. */
export function buildDoc(schema: Schema, items: Item[], opts: BuildOpts = {}): PMNode {
  const markIns = opts.insertions !== false;
  const markFmt = opts.formatting !== false;
  const keep = !!opts.keepExisting;
  const newId = opts.newId ?? newChangeId;
  const insT = schema.marks.insertion;
  const delT = schema.marks.deletion;
  const fmtT = schema.marks.formatChange;
  const clean = (n: PMNode) => (keep ? n : stripMarks(n, (name) => REVIEW.has(name)));

  // Change ids: a run of edits by one author is one change; a run of
  // formatting changes by one author is another.
  const ids: string[] = [];
  let prevEdit: Author | null = null;
  let editId = "";
  for (const it of items) {
    if (it.t === "eq") {
      prevEdit = null;
      ids.push("");
      continue;
    }
    if (!prevEdit || prevEdit.name !== it.author.name) editId = newId();
    prevEdit = it.author;
    ids.push(editId);
  }
  let fmtRun: { author: string; id: string } | null = null;
  const fmtId = (a: Author) => {
    if (!fmtRun || fmtRun.author !== a.name) fmtRun = { author: a.name, id: newId() };
    return fmtRun.id;
  };

  const outs: Out[] = [];
  let pending: PMNode[] = [];
  let queued: OutBlock[] = [];
  const pushInline = (n: PMNode) => {
    const last = pending[pending.length - 1];
    if (last && last.isText && n.isText && last.sameMarkup(n)) pending[pending.length - 1] = schema.text((last.text ?? "") + (n.text ?? ""), n.marks);
    else pending.push(n);
  };

  items.forEach((it, idx) => {
    const tok = it.t === "del" ? it.old : it.neu;
    const info = (id: string): ChangeInfo => ({ id, author: it.author.name, date: it.author.date });
    if (tok.kind === "inline") {
      if (it.t !== "eq") fmtRun = null;
      if (it.t === "del") {
        const mark = delT.create({ ...info(ids[idx]) });
        it.old.frag!.forEach((n) => pushInline(withMark(stripMarks(clean(n), (m) => OLD_ONLY.has(m)), mark, true)));
      } else if (it.t === "ins") {
        const mark = insT.create({ ...info(ids[idx]) });
        it.neu.frag!.forEach((n) => pushInline(markIns ? withMark(clean(n), mark, true) : clean(n)));
      } else {
        for (const n of formatDiff(it.old, it.neu, markFmt ? () => fmtT.create({ ...info(fmtId(it.author)) }) : null, clean)) pushInline(n);
      }
      return;
    }
    fmtRun = null;
    if (tok.kind === "block") {
      if (it.t === "del") return; // block objects aren't tracked (M5)
      const o: OutBlock = { kind: "block", node: it.neu.node!, path: it.path };
      if (pending.length) queued.push(o);
      else outs.push(o);
      return;
    }
    // Paragraph mark.
    const src = it.t === "del" ? it.old.node! : it.neu.node!;
    let props: string | null = keep ? ((src.attrs.propsChange as string | null) ?? null) : null;
    let pc: ParaState = null;
    if (it.t === "eq") {
      const o = it.old.node!;
      if (markFmt && !props && propsKey(o.type.name, o.attrs) !== propsKey(src.type.name, src.attrs))
        props = JSON.stringify({ ...info(newId()), type: o.type.name, attrs: propsAttrs(o.attrs) });
      if (keep && src.attrs.paraChange) pc = keepPc(src);
    } else if (it.t === "ins") {
      pc = keep && src.attrs.paraChange ? keepPc(src) : markIns ? { type: "insert", info: info(ids[idx]) } : null;
    } else {
      pc = keep && src.attrs.paraChange ? keepPc(src) : { type: "delete", info: info(ids[idx]) };
    }
    outs.push({ kind: "para", node: src, props, pc, inline: pending, path: it.path });
    pending = [];
    outs.push(...queued);
    queued = [];
  });
  if (pending.length || queued.length) {
    outs.push({ kind: "para", node: schema.nodes.paragraph.create(), props: null, pc: null, inline: pending, path: [] });
    outs.push(...queued);
  }

  moveTrailingParaChange(outs);
  const content = nest(outs, 0, schema);
  const doc = schema.nodes.doc.createAndFill(null, content) ?? schema.nodes.doc.create(null, content);
  return doc;
}

function keepPc(n: PMNode): ParaState {
  try {
    const p = JSON.parse(String(n.attrs.paraChange));
    if (p && (p.type === "insert" || p.type === "delete")) return { type: p.type, info: { id: p.id, author: p.author, date: p.date } };
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * A paragraph mark added or removed at the very end of the document has no
 * following paragraph to merge with; Word records the change on the mark
 * before it instead, which accepts and rejects to the same text.
 */
function moveTrailingParaChange(outs: Out[]): void {
  const paras = outs.filter((o): o is OutPara => o.kind === "para");
  const last = paras[paras.length - 1];
  if (!last || !last.pc) return;
  for (let i = paras.length - 2; i >= 0; i--) {
    if (!paras[i].pc) {
      paras[i].pc = last.pc;
      last.pc = null;
      return;
    }
  }
}

/** formatDiff lays the new token's content out, marking runs whose
 *  formatting differs from the old token's at the same characters. */
function formatDiff(old: Tok, neu: Tok, mk: (() => Mark) | null, clean: (n: PMNode) => PMNode): PMNode[] {
  // Old formatting per UTF-16 offset.
  const oldAt: { key: string; json: string }[] = [];
  old.frag!.forEach((n) => {
    const fm = formatMarks(n.marks);
    const json = JSON.stringify(marksJSON(fm));
    const len = n.isText ? (n.text ?? "").length : 1;
    for (let i = 0; i < len; i++) oldAt.push({ key: json, json });
  });
  const out: PMNode[] = [];
  let off = 0;
  neu.frag!.forEach((raw) => {
    const n = clean(raw);
    const newKey = JSON.stringify(marksJSON(formatMarks(n.marks)));
    const len = n.isText ? (n.text ?? "").length : 1;
    if (!mk) {
      out.push(n);
      off += len;
      return;
    }
    let s = 0;
    while (s < len) {
      const o = oldAt[off + s]?.key ?? newKey;
      let e = s + 1;
      while (e < len && (oldAt[off + e]?.key ?? newKey) === o) e++;
      let piece = n.isText ? n.type.schema.text((n.text ?? "").slice(s, e), n.marks) : n;
      if (o !== newKey && !piece.marks.some((m) => m.type.name === "formatChange")) {
        const m = mk();
        piece = piece.mark(m.type.create({ ...m.attrs, old: o }).addToSet(piece.marks));
      }
      out.push(piece);
      s = e;
    }
    off += len;
  });
  return out;
}

function makePara(o: OutPara): PMNode {
  const t = o.node.type;
  const attrs: Record<string, unknown> = { ...o.node.attrs };
  if ("paraChange" in attrs) {
    attrs.paraChange = o.pc ? JSON.stringify({ ...o.pc.info, type: o.pc.type }) : null;
    attrs.propsChange = o.props;
  }
  const inline = o.inline.filter((n) => t.contentMatch.matchType(n.type) || n.isText);
  try {
    return t.create(attrs, inline, o.node.marks);
  } catch {
    return t.create(attrs, inline.filter((n) => n.isText));
  }
}

/** nest rebuilds containers from the paths of consecutive outputs. */
function nest(outs: Out[], depth: number, schema: Schema): PMNode[] {
  const res: PMNode[] = [];
  let i = 0;
  while (i < outs.length) {
    const o = outs[i];
    if (o.path.length <= depth) {
      res.push(o.kind === "para" ? makePara(o) : o.node);
      i++;
      continue;
    }
    const id = o.path[depth].id;
    let j = i;
    while (j < outs.length && outs[j].path.length > depth && outs[j].path[depth].id === id) j++;
    const entry = o.path[depth].node;
    const kids = nest(outs.slice(i, j), depth + 1, schema);
    let node: PMNode | null = null;
    try {
      node = entry.type.createAndFill(entry.attrs, kids);
    } catch {
      node = null;
    }
    res.push(node ?? entry.type.create(entry.attrs, kids));
    i = j;
  }
  return res;
}
