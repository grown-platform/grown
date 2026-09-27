// Document token streams for the diff engine (Docs M12).
//
// A document is flattened into one stream of tokens in reading order:
//   * inline tokens — a word, a run of spaces, a punctuation mark or an
//     inline object (word granularity), or a single character (character
//     granularity), carrying the inline nodes (with their marks) they cover;
//   * a paragraph token after each textblock's inline tokens — Word's
//     paragraph mark — carrying the textblock (type and attributes);
//   * block tokens for leaf blocks (images, page breaks, drawings) and for
//     textblocks that can't carry review marks (code blocks).
// Paragraph and block tokens record their *path*: the containers (lists,
// list items, tables, rows, cells, quotes) they sit in, each with an id
// unique to the stream, so the builder can nest a result again.
import type { Fragment, Node as PMNode } from "@tiptap/pm/model";

export type Granularity = "word" | "char";

export interface PathEntry {
  id: string;
  node: PMNode;
}

export interface Tok {
  kind: "inline" | "para" | "block";
  key: string;
  /** Text length (diff weights). */
  w: number;
  /** Inline tokens: the inline content covered. */
  frag?: Fragment;
  /** Paragraph tokens: the textblock; block tokens: the block. */
  node?: PMNode;
  path: PathEntry[];
}

export const PARA_KEY = "¶";
const OBJ = "￼";

/** atomKey identifies an inline object for comparison. */
export function atomKey(n: PMNode): string {
  const t = n.type.name;
  if (t === "hardBreak") return "\n";
  if (t === "field") return `${OBJ}field:${String(n.attrs.instr ?? "").trim()}`;
  const attrs: Record<string, unknown> = {};
  for (const k of Object.keys(n.attrs).sort()) if (n.attrs[k] != null && k !== "id") attrs[k] = n.attrs[k];
  return `${OBJ}${t}:${JSON.stringify(attrs)}`;
}

/** blockKey identifies a leaf block (or an untracked textblock). */
function blockKey(n: PMNode): string {
  return `${OBJ}block:${n.type.name}:${JSON.stringify(n.attrs)}:${n.textContent}`;
}

/** Textblocks whose text can carry the review marks. */
export function trackable(n: PMNode): boolean {
  return n.isTextblock && n.type.allowsMarkType(n.type.schema.marks.insertion) && n.type.allowsMarkType(n.type.schema.marks.deletion);
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD = /[\p{L}\p{N}\p{M}_'’]/u;
const SPACE = /\s/u;

export function charClass(ch: string): "w" | "s" | "p" {
  if (CJK.test(ch)) return "p";
  if (WORD.test(ch)) return "w";
  if (SPACE.test(ch)) return "s";
  return "p";
}

/** inlineTokens splits a textblock's content into tokens. */
export function inlineTokens(block: PMNode, gran: Granularity): Tok[] {
  interface Unit {
    s: string;
    from: number;
    to: number;
    atom?: PMNode;
  }
  const units: Unit[] = [];
  block.forEach((child, offset) => {
    if (child.isText) {
      let i = 0;
      for (const ch of Array.from(child.text ?? "")) {
        units.push({ s: ch, from: offset + i, to: offset + i + ch.length });
        i += ch.length;
      }
    } else units.push({ s: OBJ, from: offset, to: offset + child.nodeSize, atom: child });
  });
  const out: Tok[] = [];
  const push = (from: number, to: number, key: string, w: number) =>
    out.push({ kind: "inline", key, w, frag: block.content.cut(from, to), path: [] });
  let i = 0;
  while (i < units.length) {
    const u = units[i];
    if (u.atom) {
      push(u.from, u.to, atomKey(u.atom), 1);
      i++;
      continue;
    }
    const cls = charClass(u.s);
    let j = i + 1;
    let text = u.s;
    if (gran === "word" && cls !== "p") {
      while (j < units.length && !units[j].atom && charClass(units[j].s) === cls) {
        text += units[j].s;
        j++;
      }
    }
    push(u.from, units[j - 1].to, text, text.length);
    i = j;
  }
  return out;
}

/** flatten turns a document into a token stream; container ids get `prefix`. */
export function flatten(doc: PMNode, gran: Granularity, prefix: string): Tok[] {
  const out: Tok[] = [];
  let seq = 0;
  const walk = (node: PMNode, path: PathEntry[]) => {
    node.forEach((child) => {
      if (child.isTextblock && trackable(child)) {
        out.push(...inlineTokens(child, gran));
        out.push({ kind: "para", key: PARA_KEY, w: 1, node: child, path });
      } else if (child.isLeaf || child.isTextblock || child.isAtom) {
        out.push({ kind: "block", key: blockKey(child), w: 1, node: child, path });
      } else {
        walk(child, [...path, { id: `${prefix}${seq++}`, node: child }]);
      }
    });
  };
  walk(doc, []);
  return out;
}

/** A paragraph-level unit: one textblock's tokens (ending with its mark)
 *  or one block token, with a key for paragraph alignment. */
export interface Unit {
  start: number;
  end: number;
  key: string;
}

/** units groups a stream into paragraphs and blocks. The key is the
 *  paragraph's text plus its container shape, so only identical paragraphs
 *  align at this level. */
export function units(toks: Tok[]): Unit[] {
  const out: Unit[] = [];
  let start = 0;
  let key = "";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === "inline") {
      key += t.key;
      continue;
    }
    const shape = t.path.map((p) => p.node.type.name).join("/");
    out.push({ start, end: i + 1, key: `${shape}|${t.kind === "block" ? t.key : key + PARA_KEY}` });
    start = i + 1;
    key = "";
  }
  return out;
}
