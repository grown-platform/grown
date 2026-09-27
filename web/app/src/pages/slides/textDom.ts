// contentEditable ↔ runs serialisation for the rich text editor (F1).
//
// buildEditorDom renders an element as `div[data-para]` blocks holding
// `span[data-run]` runs (each carrying its own style overrides as JSON in
// data-style) and <br> for "\v". readEditorDom reads whatever the browser
// made of that DOM after typing, Enter, Shift+Enter, paste, deletes:
// block elements are paragraphs, <br> is a line break (a block's trailing
// placeholder <br> is dropped), and a text node takes the data-style of its
// nearest run span plus any formatting tags/inline styles the browser put
// between them.

import type { ParaProps, RunStyle, SlideElement, TextRun } from "./model";
import { runCss, layoutParagraphs, paraCss } from "./textLayout";
import { STYLE_KEYS } from "./textOps";

const BLOCKS = new Set(["DIV", "P", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE"]);

function isBlock(n: Node): n is HTMLElement {
  return n.nodeType === 1 && BLOCKS.has((n as Element).tagName);
}

function applyCss(node: HTMLElement, css: Record<string, string | number>) {
  for (const [k, v] of Object.entries(css)) {
    const prop = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    node.style.setProperty(prop, typeof v === "number" && k !== "fontWeight" ? `${v}px` : String(v));
  }
}

/** Own (override) style of a run, without the text. */
function ownStyle(r: TextRun): RunStyle {
  const s: RunStyle = {};
  for (const k of STYLE_KEYS) if (r[k] !== undefined) (s as Record<string, unknown>)[k] = r[k];
  return s;
}

/** buildEditorDom replaces root's children with the element's paragraphs. */
export function buildEditorDom(root: HTMLElement, el: SlideElement): void {
  const doc = root.ownerDocument;
  while (root.firstChild) root.removeChild(root.firstChild);
  const laid = layoutParagraphs(el);
  laid.forEach((p, i) => {
    const div = doc.createElement("div");
    div.setAttribute("data-para", "");
    if (p.props.level) div.setAttribute("data-level", String(p.props.level));
    if (p.props.align) div.setAttribute("data-align", p.props.align);
    if (p.marker) div.setAttribute("data-marker", p.marker);
    applyCss(div, paraCss(el, p.props, i === 0, !!p.marker));
    for (const r of p.runs) {
      const span = doc.createElement("span");
      span.setAttribute("data-run", "");
      const own = ownStyle(r);
      if (Object.keys(own).length) span.setAttribute("data-style", JSON.stringify(own));
      applyCss(span, runCss(el, r));
      r.text.split("\v").forEach((t, j) => {
        if (j > 0) span.appendChild(doc.createElement("br"));
        if (t) span.appendChild(doc.createTextNode(t));
      });
      div.appendChild(span);
    }
    const last = p.runs[p.runs.length - 1];
    if (!p.runs.length || /\v$/.test(last.text)) div.appendChild(doc.createElement("br"));
    root.appendChild(div);
  });
}

/** Style implied by formatting the browser inserted (tags / inline CSS). */
function tagStyle(n: HTMLElement, s: RunStyle) {
  switch (n.tagName) {
    case "B":
    case "STRONG":
      s.bold = true;
      break;
    case "I":
    case "EM":
      s.italic = true;
      break;
    case "U":
      s.underline = true;
      break;
    case "S":
    case "STRIKE":
    case "DEL":
      s.strike = true;
      break;
    case "SUP":
      s.baseline = "super";
      break;
    case "SUB":
      s.baseline = "sub";
      break;
    case "A": {
      const href = n.getAttribute("href");
      if (href) s.url = href;
      break;
    }
  }
  if (n.hasAttribute("data-run")) return;
  const st = n.style;
  if (!st) return;
  const fw = st.fontWeight;
  if (fw) s.bold = fw === "bold" || Number(fw) >= 600;
  if (st.fontStyle) s.italic = st.fontStyle === "italic";
  if (st.color) s.color = cssColorToHex(st.color) ?? s.color;
}

function cssColorToHex(c: string): string | undefined {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (!m) return undefined;
  return "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
}

/** The run style for a text node: its run span's data-style, then any
 *  browser-made formatting between them (innermost wins). */
function styleFor(node: Node, root: HTMLElement): RunStyle {
  const chain: HTMLElement[] = [];
  let run: HTMLElement | null = null;
  for (let p = node.parentElement; p && p !== root; p = p.parentElement) {
    if (p.hasAttribute("data-run")) {
      run = p;
      break;
    }
    if (!isBlock(p)) chain.push(p);
  }
  let s: RunStyle = {};
  if (run) {
    try {
      s = JSON.parse(run.getAttribute("data-style") || "{}") as RunStyle;
    } catch {
      s = {};
    }
    tagStyle(run, s);
  }
  for (let i = chain.length - 1; i >= 0; i--) tagStyle(chain[i], s);
  return s;
}

interface Para {
  runs: TextRun[];
  props: ParaProps;
  fromBlock: boolean;
}

function propsOf(n: HTMLElement | null): ParaProps {
  const p: ParaProps = {};
  const lvl = Number(n?.getAttribute("data-level"));
  if (lvl) p.level = lvl;
  const a = n?.getAttribute("data-align");
  if (a === "left" || a === "center" || a === "right" || a === "justify") p.align = a;
  return p;
}

/** readEditorDom reads runs and paragraph properties back from the editor. */
export function readEditorDom(
  root: Node,
  opts: { keepLastBreak?: boolean } = {},
): { runs: TextRun[]; paras: ParaProps[] } {
  const rootEl = (root.nodeType === 1 ? root : null) as HTMLElement | null;
  const paras: Para[] = [];
  const collect = (container: Node, props: ParaProps, isBlk: boolean) => {
    let cur: Para | null = null;
    let produced = false;
    const inline = (n: Node) => {
      if (!cur) {
        cur = { runs: [], props, fromBlock: isBlk };
        paras.push(cur);
        produced = true;
      }
      if (n.nodeType === 3) {
        const t = (n.nodeValue || "").replace(/\n/g, "\v").replace(/​/g, "");
        if (t) cur.runs.push({ ...styleFor(n, rootEl ?? (container as HTMLElement)), text: t });
      } else if (n.nodeType === 1) {
        const e = n as HTMLElement;
        if (e.tagName === "BR") cur.runs.push({ ...styleFor(e, rootEl ?? (container as HTMLElement)), text: "\v" });
        else for (const c of Array.from(e.childNodes)) {
          if (isBlock(c)) {
            cur = null;
            collect(c, { ...props, ...propsOf(c) }, true);
            produced = true;
          } else inline(c);
        }
      }
    };
    for (const c of Array.from(container.childNodes)) {
      if (isBlock(c)) {
        cur = null;
        collect(c, { ...props, ...propsOf(c) }, true);
        produced = true;
      } else inline(c);
    }
    if (!produced && isBlk) paras.push({ runs: [], props, fromBlock: true });
  };
  collect(root, {}, false);
  if (!paras.length) paras.push({ runs: [], props: {}, fromBlock: false });
  const runs: TextRun[] = [];
  paras.forEach((p, i) => {
    // A block's trailing <br> is the browser's placeholder, not a line.
    const last = p.runs[p.runs.length - 1];
    if (opts.keepLastBreak && i === paras.length - 1) {
      /* a cut-off prefix (textOffset): a <br> before the caret is real */
    } else if (p.fromBlock && last && last.text === "\v") p.runs.pop();
    else if (p.fromBlock && last && last.text.endsWith("\v")) last.text = last.text.slice(0, -1);
    if (i > 0) runs.push({ ...(p.runs[0] ? ownStyle(p.runs[0]) : runs.length ? ownStyle(runs[runs.length - 1]) : {}), text: "\n" });
    runs.push(...p.runs);
  });
  if (!runs.length) runs.push({ text: "" });
  return { runs, paras: paras.map((p) => p.props) };
}

/** textOffset is the model offset of a DOM point inside root. */
export function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange();
  range.setStart(root, 0);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  const frag = range.cloneContents();
  const { runs } = readEditorDom(frag, { keepLastBreak: true });
  return runs.map((r) => r.text).join("").length;
}

/** selectionOffsets returns the [anchor, focus] model offsets of the window
 *  selection when it lies inside root, else null. */
export function selectionOffsets(root: HTMLElement): [number, number] | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  return [textOffset(root, sel.anchorNode, sel.anchorOffset), textOffset(root, sel.focusNode, sel.focusOffset)];
}

/** domPoint finds the DOM point for a model offset in a DOM built by
 *  buildEditorDom. */
export function domPoint(root: HTMLElement, offset: number): { node: Node; offset: number } {
  const paras = Array.from(root.children) as HTMLElement[];
  let pos = 0;
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const walker = root.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let last: { node: Node; offset: number } = { node: p, offset: 0 };
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        const len = (n.nodeValue || "").length;
        if (offset <= pos + len) return { node: n, offset: offset - pos };
        pos += len;
        last = { node: n, offset: len };
      } else if ((n as Element).tagName === "BR") {
        const parent = n.parentNode!;
        const idx = Array.prototype.indexOf.call(parent.childNodes, n);
        if (offset === pos) return { node: parent, offset: idx };
        // A trailing placeholder <br> is not a character.
        const isTrail = !n.nextSibling && n.parentNode === p;
        if (!isTrail) pos += 1;
        last = { node: parent, offset: idx + 1 };
      }
    }
    if (offset <= pos || i === paras.length - 1) return last.node === p ? { node: p, offset: 0 } : last;
    pos += 1; // the paragraph break
  }
  return { node: root, offset: root.childNodes.length };
}

/** setSelectionOffsets selects [from, to] (model offsets) inside root. */
export function setSelectionOffsets(root: HTMLElement, from: number, to: number): void {
  const sel = root.ownerDocument.getSelection();
  if (!sel) return;
  const a = domPoint(root, from);
  const b = domPoint(root, to);
  try {
    sel.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
  } catch {
    /* ignore */
  }
}
