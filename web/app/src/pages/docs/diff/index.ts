// Document diff engine (Docs M12): Compare, Combine and version diffs.
//
//   compareDocs(old, new)       -> a copy of `new` with tracked changes that
//                                  turn it back into `old` when rejected
//   combineDocs(orig, a, b?)    -> `orig` with both revisions' changes
//                                  tracked, each under its own author
//   diffVersions(old, new)      -> compareDocs at character level, for the
//                                  version history ("highlight changes" and
//                                  deleted-text recovery)
//
// How it works: both documents are flattened into token streams
// (stream.ts), aligned paragraph-first and then word- or character-level
// (align.ts), and the merged edit script is built back into a document with
// Track changes v2's marks and paragraph attributes (build.ts). Results
// are ordinary review content: the change list, accept / reject and the
// DOCX writer handle them like typed suggestions.
import { DOMParser as PMDOMParser, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { collectParts, nowIso, resolveParts } from "../changes";
import { align } from "./align";
import { buildDoc, type Author, type BuildOpts, type Item } from "./build";
import { flatten, type Granularity, type PathEntry, type Tok } from "./stream";

export type { Granularity } from "./stream";
export type { Author } from "./build";

export interface CompareOpts extends BuildOpts {
  /** Who the changes are attributed to (the revised document's author). */
  author: string;
  /** ISO date for the changes; default now. */
  date?: string;
  /** Word (default) or character level. */
  granularity?: Granularity;
}

/** acceptAll returns a document with every tracked change accepted. */
export function acceptAll(doc: PMNode): PMNode {
  const parts = collectParts(doc);
  if (!parts.length) return doc;
  const tr = EditorState.create({ doc }).tr;
  resolveParts(tr, parts, true);
  return tr.doc;
}

/** htmlToDoc parses editor HTML (a version snapshot) with a schema. */
export function htmlToDoc(schema: Schema, html: string): PMNode {
  const el = document.createElement("div");
  el.innerHTML = html || "<p></p>";
  return PMDOMParser.fromSchema(schema).parse(el);
}

/** pathMap maps container ids of stream `from` to the containers of stream
 *  `to` that hold the same (equal) paragraphs. */
function pathMap(pairs: [Tok, Tok][]): Map<string, PathEntry> {
  const map = new Map<string, PathEntry>();
  for (const [x, y] of pairs) {
    if (x.kind === "inline") continue;
    const n = Math.min(x.path.length, y.path.length);
    for (let d = 0; d < n; d++) {
      if (x.path[d].node.type !== y.path[d].node.type) break;
      if (!map.has(x.path[d].id)) map.set(x.path[d].id, y.path[d]);
    }
  }
  return map;
}

const mapPath = (p: PathEntry[], m: Map<string, PathEntry>) => p.map((e) => m.get(e.id) ?? e);

/**
 * compareDocs compares an original and a revised document and returns the
 * revised document with the differences as tracked changes by `opts.author`
 * (Word's Compare: rejecting everything gives the original back). Tracked
 * changes already in either document are accepted first, as Word does,
 * unless `keepExisting` is set.
 */
export function compareDocs(original: PMNode, revised: PMNode, opts: CompareOpts): PMNode {
  const schema = revised.type.schema;
  const gran = opts.granularity ?? "word";
  const oldDoc = opts.keepExisting ? original : acceptAll(original);
  const newDoc = opts.keepExisting ? revised : acceptAll(revised);
  const a = flatten(oldDoc, gran, "o");
  const b = flatten(newDoc, gran, "n");
  const ops = align(a, b);
  const author: Author = { name: opts.author, date: opts.date ?? nowIso() };
  const map = pathMap(ops.filter((o) => o.kind === "eq").map((o) => [a[o.a], b[o.b]] as [Tok, Tok]));
  const items: Item[] = ops.map((op) =>
    op.kind === "eq"
      ? { t: "eq", old: a[op.a], neu: b[op.b], author, path: b[op.b].path }
      : op.kind === "del"
        ? { t: "del", old: a[op.a], author, path: mapPath(a[op.a].path, map) }
        : { t: "ins", neu: b[op.b], author, path: b[op.b].path },
  );
  return buildDoc(schema, items, opts);
}

export interface CombineOpts extends Omit<BuildOpts, "insertions"> {
  authorA: string;
  authorB?: string;
  dateA?: string;
  dateB?: string;
  granularity?: Granularity;
}

function sameFormat(x: Tok, y: Tok): boolean {
  if (x.kind === "inline") {
    const f = (t: Tok) => {
      const out: string[] = [];
      t.frag!.forEach((n) => out.push(`${n.isText ? n.text?.length : 1}:${n.marks.filter((m) => !["insertion", "deletion", "formatChange", "commentMark"].includes(m.type.name)).map((m) => `${m.type.name}${JSON.stringify(m.attrs)}`).sort().join(",")}`));
      return out.join("|");
    };
    return f(x) === f(y);
  }
  if (x.kind === "para") return x.node!.type === y.node!.type && JSON.stringify(x.node!.attrs) === JSON.stringify(y.node!.attrs);
  return true;
}

/**
 * combineDocs merges revised copies of one original into the original as
 * tracked changes: revision A's under `authorA`, revision B's under
 * `authorB`. Where both inserted the same text at the same place it
 * appears once (A's); text either deleted is deleted. Tracked changes the
 * copies already carry are kept (OnlyOffice's and Word's combine), unless
 * `keepExisting` is false.
 */
export function combineDocs(original: PMNode, revA: PMNode, revB: PMNode | null, opts: CombineOpts): PMNode {
  const schema = original.type.schema;
  const gran = opts.granularity ?? "word";
  const keep = opts.keepExisting !== false;
  const prep = (d: PMNode) => (keep ? d : acceptAll(d));
  const o = flatten(prep(original), gran, "o");
  const A: Author = { name: opts.authorA, date: opts.dateA ?? nowIso() };
  const B: Author = { name: opts.authorB ?? opts.authorA, date: opts.dateB ?? opts.dateA ?? nowIso() };
  const sides = [revA, revB].filter((d): d is PMNode => !!d).map((d, i) => {
    const toks = flatten(prep(d), gran, i ? "b" : "a");
    const ops = align(o, toks);
    const match = new Array<number>(o.length).fill(-1);
    const ins = new Map<number, number[]>();
    let gap = 0;
    for (const op of ops) {
      if (op.kind === "eq") {
        match[op.a] = op.b;
        gap = op.a + 1;
      } else if (op.kind === "del") gap = op.a + 1;
      else {
        const l = ins.get(gap) ?? [];
        l.push(op.b);
        ins.set(gap, l);
      }
    }
    const map = pathMap(ops.filter((x) => x.kind === "eq").map((x) => [toks[x.b], o[x.a]] as [Tok, Tok]));
    return { toks, match, ins, map, author: i ? B : A };
  });
  const items: Item[] = [];
  for (let g = 0; g <= o.length; g++) {
    let prevKeys: string | null = null;
    for (const s of sides) {
      const l = s.ins.get(g);
      if (!l?.length) continue;
      const keys = l.map((i) => s.toks[i].key).join("\u0001");
      if (keys === prevKeys) continue;
      prevKeys = keys;
      for (const i of l) items.push({ t: "ins", neu: s.toks[i], author: s.author, path: mapPath(s.toks[i].path, s.map) });
    }
    if (g === o.length) break;
    const tok = o[g];
    const deleter = sides.find((s) => s.match[g] < 0);
    if (deleter) {
      items.push({ t: "del", old: tok, author: deleter.author, path: tok.path });
      continue;
    }
    const changed = sides.find((s) => !sameFormat(tok, s.toks[s.match[g]]));
    const s = changed ?? sides[0];
    const neu = s.toks[s.match[g]];
    items.push({ t: "eq", old: tok, neu: tok.kind === "block" ? tok : neu, author: s.author, path: tok.path });
  }
  return buildDoc(schema, items, { ...opts, keepExisting: keep });
}

export interface VersionDiffOpts {
  /** Author and date of the newer version. */
  author: string;
  date?: string;
  /** "changes": insertions and deletions (default); "deleted": only the
   *  deleted text is brought back (OnlyOffice's deleted-text recovery). */
  show?: "changes" | "deleted";
  granularity?: Granularity;
  newId?: () => string;
}

/** diffVersions shows how `newer` differs from `older` as tracked changes. */
export function diffVersions(older: PMNode, newer: PMNode, opts: VersionDiffOpts): PMNode {
  const deletedOnly = opts.show === "deleted";
  return compareDocs(older, newer, {
    author: opts.author,
    date: opts.date,
    granularity: opts.granularity ?? "char",
    insertions: !deletedOnly,
    formatting: !deletedOnly,
    newId: opts.newId,
  });
}

/** diffSummary counts a result's changes for a status line. */
export function diffSummary(doc: PMNode): { insertions: number; deletions: number; formatting: number } {
  const ids = { ins: new Set<string>(), del: new Set<string>(), fmt: new Set<string>() };
  for (const p of collectParts(doc)) {
    if (p.kind === "ins" || p.kind === "paraIns") ids.ins.add(p.id);
    else if (p.kind === "del" || p.kind === "paraDel") ids.del.add(p.id);
    else ids.fmt.add(p.id);
  }
  return { insertions: ids.ins.size, deletions: ids.del.size, formatting: ids.fmt.size };
}
