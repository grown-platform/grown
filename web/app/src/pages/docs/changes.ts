// Track changes v2 (M5): the change model.
//
// A tracked change is recorded on the document itself, so it rides the
// shared Yjs document like any other content:
//   * `insertion` / `deletion` marks on text (and inline atoms),
//   * a `formatChange` mark whose `old` attribute is a JSON snapshot of the
//     formatting marks the text had before the change,
//   * a `paraChange` attribute on a paragraph/heading when its paragraph
//     mark (the break at its end) was inserted or deleted, as in Word,
//   * a `propsChange` attribute holding the paragraph's previous type and
//     attributes when its paragraph properties changed.
// Every record carries an `id`, `author` and `date`. Records that share an
// id form one logical change (typing over a selection is one "replace").
//
// This module is pure ProseMirror: it reads changes out of a document
// (collectChanges) and resolves them (resolveParts) into a transaction.
import type { Mark, Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

export type ReviewType = "add" | "remove" | "common";

export interface ChangeInfo {
  id: string;
  author: string;
  date: string;
}

/** A paragraph mark that was inserted or deleted. */
export interface ParaChange extends ChangeInfo {
  type: "insert" | "delete";
}

/** A paragraph's properties before a tracked change. */
export interface PropsChange extends ChangeInfo {
  /** The node type before the change ("paragraph", "heading"). */
  type: string;
  attrs: Record<string, unknown>;
}

/** Marks that are review or anchor bookkeeping, not formatting. */
export const REVIEW_MARKS = new Set(["insertion", "deletion", "formatChange"]);
const NON_FORMAT = new Set([...REVIEW_MARKS, "commentMark", "link"]);
/** Paragraph attributes that record review state, not properties. */
export const REVIEW_ATTRS = ["paraChange", "propsChange"] as const;

export function isFormatMark(name: string): boolean {
  return !NON_FORMAT.has(name);
}

/** formatMarks keeps the formatting marks of a set (drops review marks,
 *  comments and links). */
export function formatMarks(marks: readonly Mark[]): Mark[] {
  return marks.filter((m) => isFormatMark(m.type.name));
}

export type MarkJSON = { type: string; attrs?: Record<string, unknown> };

function cleanAttrs(attrs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!attrs) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(attrs).sort()) if (attrs[k] != null) out[k] = attrs[k];
  return Object.keys(out).length ? out : undefined;
}

/** canonicalMarks puts JSON formatting marks in a stable form: review
 *  marks, comments and links dropped, null attributes dropped, sorted. */
export function canonicalMarks(marks: readonly MarkJSON[]): MarkJSON[] {
  return marks
    .filter((m) => isFormatMark(m.type))
    .map((m) => {
      const attrs = cleanAttrs(m.attrs);
      return attrs ? { type: m.type, attrs } : { type: m.type };
    })
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

/** marksJSON serialises formatting marks in a stable order. */
export function marksJSON(marks: readonly Mark[]): MarkJSON[] {
  return canonicalMarks(marks.map((m) => ({ type: m.type.name, attrs: m.attrs as Record<string, unknown> })));
}

/** marksKey is a comparable string for a set of formatting marks. */
export function marksKey(marks: readonly Mark[]): string {
  return JSON.stringify(marksJSON(marks));
}

/** oldMarks parses a formatChange mark's snapshot back into marks. */
export function oldMarks(schema: Schema, old: unknown): Mark[] {
  let list: MarkJSON[] = [];
  try {
    list = JSON.parse(String(old ?? "[]")) as MarkJSON[];
  } catch {
    list = [];
  }
  const out: Mark[] = [];
  for (const m of list) {
    if (!schema.marks[m.type]) continue;
    try {
      out.push(schema.markFromJSON(m));
    } catch {
      /* unknown attrs */
    }
  }
  return out;
}

function parseJSON<T>(v: unknown): T | null {
  if (v == null || v === "") return null;
  if (typeof v === "object") return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return null;
  }
}

export function parseParaChange(v: unknown): ParaChange | null {
  const p = parseJSON<ParaChange>(v);
  return p && (p.type === "insert" || p.type === "delete") ? p : null;
}

export function parsePropsChange(v: unknown): PropsChange | null {
  const p = parseJSON<PropsChange>(v);
  return p && typeof p.type === "string" && p.attrs && typeof p.attrs === "object" ? p : null;
}

/** propsAttrs drops the review bookkeeping from a paragraph's attributes
 *  and null values, for comparing properties. */
export function propsAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(attrs).sort()) {
    if ((REVIEW_ATTRS as readonly string[]).includes(k)) continue;
    if (attrs[k] != null) out[k] = attrs[k];
  }
  return out;
}

export function propsKey(type: string, attrs: Record<string, unknown>): string {
  return JSON.stringify([type, propsAttrs(attrs)]);
}

// --- ids and clock ----------------------------------------------------------------------

let clock: () => Date = () => new Date();

/** setReviewClock replaces the clock used for change dates (tests). */
export function setReviewClock(fn: (() => Date) | null): void {
  clock = fn ?? (() => new Date());
}

/** nowIso is the current time as an ISO date without milliseconds (the
 *  precision WordprocessingML dates have). */
export function nowIso(): string {
  return clock().toISOString().replace(/\.\d{3}Z$/, "Z");
}

let seq = 0;
/** newChangeId returns a fresh change id, unique across collaborators. */
export function newChangeId(): string {
  seq = (seq + 1) % 1296;
  return `${Date.now().toString(36)}${seq.toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;
}

// --- paragraph boundaries ---------------------------------------------------------------

function isolating(n: PMNode): boolean {
  return !!n.type.spec.isolating || /^table/.test(n.type.name);
}

/** nextTextblockStart finds the content start of the textblock that follows
 *  the textblock whose content ends at `end`, when the two can be merged
 *  (no table, cell or block object between them). Null otherwise. */
export function nextTextblockStart(doc: PMNode, end: number): number | null {
  let found: number | null = null;
  let blocked = false;
  doc.nodesBetween(end + 1, doc.content.size, (n, p) => {
    if (found != null || blocked) return false;
    if (p <= end) return true; // ancestors
    if (n.isTextblock) {
      found = p + 1;
      return false;
    }
    if (n.isLeaf || isolating(n)) {
      blocked = true;
      return false;
    }
    return true;
  });
  if (found == null) return null;
  const $a = doc.resolve(end);
  const $b = doc.resolve(found);
  const shared = $a.sharedDepth(found);
  for (let d = shared + 1; d < $a.depth; d++) if (isolating($a.node(d))) return null;
  for (let d = shared + 1; d < $b.depth; d++) if (isolating($b.node(d))) return null;
  return found;
}

// --- collecting changes -------------------------------------------------------------------

export type PartKind = "ins" | "del" | "fmt" | "paraIns" | "paraDel" | "props";

export interface Part {
  kind: PartKind;
  id: string;
  author: string;
  date: string;
  /** Text parts: the range. Paragraph parts: the paragraph mark
   *  [contentEnd, contentEnd + 1]. */
  from: number;
  to: number;
  /** Position of the paragraph node (paragraph parts). */
  nodePos?: number;
  /** The mark (text parts). */
  mark?: Mark;
  text: string;
}

export type ChangeKind = "insert" | "delete" | "replace" | "format" | "paragraph";

export interface TrackedChange {
  id: string;
  kind: ChangeKind;
  author: string;
  date: string;
  from: number;
  to: number;
  /** Inserted text (paragraph marks as "¶"). */
  inserted: string;
  /** Deleted text. */
  deleted: string;
  /** Formatted text (format changes). */
  formatted: string;
  parts: Part[];
}

const PARA_SIGN = "¶";

/** collectParts lists every tracked part of the document in order. Marks
 *  without an id (older documents) get a synthetic id per contiguous run. */
export function collectParts(doc: PMNode): Part[] {
  const parts: Part[] = [];
  const push = (p: Part) => {
    const last = parts[parts.length - 1];
    // Extend a contiguous run of the same record.
    if (
      last &&
      p.mark &&
      last.mark &&
      last.kind === p.kind &&
      last.to === p.from &&
      last.mark.eq(p.mark)
    ) {
      last.to = p.to;
      last.text += p.text;
      return;
    }
    parts.push(p);
  };
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const end = pos + node.nodeSize - 1;
      const props = parsePropsChange(node.attrs.propsChange);
      if (props)
        parts.push({ kind: "props", id: props.id ?? "", author: props.author ?? "", date: props.date ?? "", from: pos + 1, to: end, nodePos: pos, text: "" });
      // Descend first so the paragraph mark sorts after the text.
      node.forEach((child, offset) => {
        const cpos = pos + 1 + offset;
        const text = child.isText ? child.text ?? "" : child.type.name === "hardBreak" ? "\n" : "￼";
        for (const m of child.marks) {
          const kind: PartKind | null =
            m.type.name === "insertion" ? "ins" : m.type.name === "deletion" ? "del" : m.type.name === "formatChange" ? "fmt" : null;
          if (!kind) continue;
          push({
            kind,
            id: String(m.attrs.id ?? ""),
            author: String(m.attrs.author ?? ""),
            date: String(m.attrs.date ?? ""),
            from: cpos,
            to: cpos + child.nodeSize,
            mark: m,
            text,
          });
        }
      });
      const pc = parseParaChange(node.attrs.paraChange);
      if (pc)
        parts.push({
          kind: pc.type === "insert" ? "paraIns" : "paraDel",
          id: pc.id ?? "",
          author: pc.author ?? "",
          date: pc.date ?? "",
          from: end,
          to: end + 1,
          nodePos: pos,
          text: PARA_SIGN,
        });
      return false;
    }
    return true;
  });
  // Synthetic ids for id-less records: one per contiguous run.
  let prev: Part | null = null;
  for (const p of parts) {
    if (!p.id) {
      const cont = prev && prev.id.startsWith("~") && prev.to === p.from && prev.author === p.author && sameFamily(prev.kind, p.kind);
      p.id = cont ? prev!.id : `~${p.kind}${p.from}`;
    }
    prev = p;
  }
  return parts;
}

function sameFamily(a: PartKind, b: PartKind): boolean {
  const fam = (k: PartKind) => (k === "ins" || k === "paraIns" ? "i" : k === "del" || k === "paraDel" ? "d" : k);
  return fam(a) === fam(b);
}

/** collectChanges groups the document's tracked parts into logical changes
 *  (by id), in document order. */
export function collectChanges(doc: PMNode): TrackedChange[] {
  const byId = new Map<string, TrackedChange>();
  const out: TrackedChange[] = [];
  for (const p of collectParts(doc)) {
    let c = byId.get(p.id);
    if (!c) {
      c = { id: p.id, kind: "insert", author: p.author, date: p.date, from: p.from, to: p.to, inserted: "", deleted: "", formatted: "", parts: [] };
      byId.set(p.id, c);
      out.push(c);
    }
    c.parts.push(p);
    c.from = Math.min(c.from, p.from);
    c.to = Math.max(c.to, p.to);
    if (p.date > c.date) c.date = p.date;
    if (p.kind === "ins" || p.kind === "paraIns") c.inserted += p.text;
    else if (p.kind === "del" || p.kind === "paraDel") c.deleted += p.text;
    else if (p.kind === "fmt") c.formatted += p.text;
  }
  for (const c of out) {
    const kinds = new Set(c.parts.map((p) => p.kind));
    const ins = kinds.has("ins") || kinds.has("paraIns");
    const del = kinds.has("del") || kinds.has("paraDel");
    c.kind = ins && del ? "replace" : ins ? "insert" : del ? "delete" : kinds.has("fmt") ? "format" : "paragraph";
  }
  return out.sort((a, b) => a.from - b.from);
}

/** describeChange is the one-line summary the change list and popover show. */
export function describeChange(c: TrackedChange): string {
  const clip = (s: string) => {
    const t = s.replace(/\n/g, " ");
    return t.length > 60 ? `${t.slice(0, 57)}…` : t;
  };
  const paraOnly = (s: string) => s.replace(new RegExp(PARA_SIGN, "g"), "") === "";
  switch (c.kind) {
    case "insert":
      return paraOnly(c.inserted) ? "Inserted paragraph" : `Inserted: "${clip(c.inserted.replace(/¶/g, " "))}"`;
    case "delete":
      return paraOnly(c.deleted) ? "Merged paragraphs" : `Deleted: "${clip(c.deleted.replace(/¶/g, " "))}"`;
    case "replace":
      return `Replaced: "${clip(c.deleted.replace(/¶/g, " "))}" with "${clip(c.inserted.replace(/¶/g, " "))}"`;
    case "format":
      return `Formatted: "${clip(c.formatted)}"`;
    default:
      return "Paragraph formatting";
  }
}

/** changeAt returns the change covering `pos` (or starting/ending there). */
export function changeAt(changes: TrackedChange[], pos: number, to = pos): TrackedChange | null {
  for (const c of changes) {
    for (const p of c.parts) {
      if (to === pos ? p.from <= pos && pos <= p.to : p.from < to && pos < p.to) return c;
    }
  }
  return null;
}

// --- resolving (accept / reject) ------------------------------------------------------------

/** partsInRange keeps the parts overlapping [from, to), clipping text parts.
 *  A paragraph part is included when its paragraph mark is in the range. */
export function partsInRange(parts: Part[], from: number, to: number): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    if (p.kind === "paraIns" || p.kind === "paraDel") {
      if (p.from >= from && p.from < to) out.push(p);
    } else if (p.kind === "props") {
      if (p.from <= to && from <= p.to) out.push(p);
    } else if (p.from < to && from < p.to) {
      out.push({ ...p, from: Math.max(p.from, from), to: Math.min(p.to, to) });
    }
  }
  return out;
}

/** resolveParts accepts or rejects the given parts in `tr` (whose doc is the
 *  document the parts were collected from). */
export function resolveParts(tr: Transaction, parts: Part[], accept: boolean): void {
  const { schema } = tr.doc.type;
  const doc = tr.doc;
  const deletions: Deletion[] = [];
  for (const p of parts) {
    switch (p.kind) {
      case "ins":
        if (accept) tr.removeMark(p.from, p.to, p.mark!);
        else deletions.push([p.from, p.to]);
        break;
      case "del":
        if (accept) deletions.push([p.from, p.to]);
        else tr.removeMark(p.from, p.to, p.mark!);
        break;
      case "fmt":
        if (!accept) {
          doc.nodesBetween(p.from, p.to, (n) => {
            if (!n.isInline) return true;
            for (const m of formatMarks(n.marks)) tr.removeMark(p.from, p.to, m);
            return false;
          });
          for (const m of oldMarks(schema, p.mark!.attrs.old)) tr.addMark(p.from, p.to, m);
        }
        tr.removeMark(p.from, p.to, p.mark!);
        break;
      case "paraIns":
      case "paraDel": {
        tr.setNodeAttribute(p.nodePos!, "paraChange", null);
        const merge = (p.kind === "paraIns") !== accept;
        if (merge) {
          const next = nextTextblockStart(doc, p.from);
          if (next != null) deletions.push([p.from, next, p.nodePos]);
        }
        break;
      }
      case "props": {
        const node = doc.nodeAt(p.nodePos!);
        if (!node) break;
        const pc = parsePropsChange(node.attrs.propsChange);
        if (accept || !pc) {
          tr.setNodeAttribute(p.nodePos!, "propsChange", null);
          break;
        }
        const type = schema.nodes[pc.type] ?? node.type;
        const attrs: Record<string, unknown> = { ...pc.attrs, paraChange: node.attrs.paraChange ?? null, propsChange: null };
        try {
          tr.setNodeMarkup(p.nodePos!, type, type.create(attrs).attrs);
        } catch {
          tr.setNodeAttribute(p.nodePos!, "propsChange", null);
        }
        break;
      }
    }
  }
  applyDeletions(tr, deletions);
}

/** A range to remove; `merge` is set when it removes a paragraph mark (the
 *  position of the paragraph whose mark it is). */
export type Deletion = [number, number, number?];

/** applyDeletions removes ranges of tr.doc (positions from before any of
 *  them) from the end backwards. When a paragraph mark is removed the merged
 *  paragraph takes over the following paragraph's mark, as in Word. */
export function applyDeletions(tr: Transaction, deletions: Deletion[]): void {
  deletions.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const base = tr.steps.length;
  let floor = Infinity;
  for (const [a, b0, merge] of deletions) {
    const b = Math.min(b0, floor);
    if (b <= a) continue;
    const m = tr.mapping.slice(base);
    const from = m.map(a);
    const to = m.map(b);
    if (merge != null && b === b0) {
      const nextBlock = tr.doc.resolve(to).parent;
      const first = m.map(merge);
      const node = tr.doc.nodeAt(first);
      if (node?.isTextblock && nextBlock.isTextblock && node.attrs.paraChange !== nextBlock.attrs.paraChange)
        tr.setNodeAttribute(first, "paraChange", nextBlock.attrs.paraChange ?? null);
    }
    tr.delete(from, to);
    floor = a;
  }
}

/** reviewRuns reads a textblock as [review type, text] runs (adjacent runs
 *  of the same type merged), the shape OnlyOffice's revision tests use. */
export function reviewRuns(block: PMNode): [ReviewType, string][] {
  const out: [ReviewType, string][] = [];
  block.forEach((child) => {
    const text = child.isText ? child.text ?? "" : child.type.name === "hardBreak" ? "\n" : "";
    if (!text) return;
    const t: ReviewType = child.marks.some((m) => m.type.name === "deletion")
      ? "remove"
      : child.marks.some((m) => m.type.name === "insertion")
        ? "add"
        : "common";
    const last = out[out.length - 1];
    if (last && last[0] === t) last[1] += text;
    else out.push([t, text]);
  });
  return out;
}

/** paragraphReviewType is the review type of a paragraph's mark. */
export function paragraphReviewType(block: PMNode): ReviewType {
  const pc = parseParaChange(block.attrs.paraChange);
  return pc ? (pc.type === "insert" ? "add" : "remove") : "common";
}
