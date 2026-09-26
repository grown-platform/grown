// Clipboard handling for the Docs editor.
//
// Paste: normalizePastedHTML() rewrites clipboard HTML from Word, Excel,
// Google Docs and the web into markup TipTap's parser understands:
// * drops <head>/<style>/<meta>/<link>/<script>, comments and conditional
//   comments, Office namespace junk (<o:p>, VML <v:*>, <o:*>) and images
//   that point at the copier's local disk (file:, cid:);
// * turns Word's list paragraphs (style "mso-list: l0 level2 lfo1" with an
//   "mso-list: Ignore" marker span) into nested <ul>/<ol>;
// * turns page-break <br>s (page-break-before: always, mso-break-type) into
//   Grown page breaks;
// * unwraps Google Docs' <b style="font-weight:normal" id="docs-internal-…">
//   wrapper and turns background/mso-highlight spans into highlights;
// * strips Mso* classes, lang attributes and mso-* style declarations.
//
// Copy: selectionToHTML/selectionToText serialise the selection the way the
// clipboard does (sliceToText: paragraphs by "\n", table cells by "\t",
// bullets "• " / numbers "1. " kept as text). The ClipboardHandling
// extension wires these into ProseMirror (transformPastedHTML,
// clipboardTextSerializer, clipboardSerializer). Paste as plain text is
// ProseMirror's shift-paste (Ctrl+Shift+V) or pastePlainText().
import { Extension, type Editor } from "@tiptap/core";
import { DOMSerializer, type Fragment, type Node as PMNode, type Schema, type Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

// --- paste normalisation -----------------------------------------------------------

const DROP_TAGS = new Set(["HEAD", "STYLE", "META", "LINK", "SCRIPT", "TITLE", "XML", "NOSCRIPT"]);

function styleOf(el: Element): string {
  return (el.getAttribute("style") || "").toLowerCase();
}

/** Parse "mso-list: l0 level2 lfo1" -> { list: "l0", level: 2 }. */
function msoList(el: Element): { list: string; level: number } | null {
  const m = /mso-list:\s*(l\d+)\s+level(\d+)/i.exec(el.getAttribute("style") || "");
  if (!m) return null;
  return { list: m[1].toLowerCase(), level: Number(m[2]) };
}

function isPageBreak(el: Element): boolean {
  if (el.tagName !== "BR") return false;
  const s = styleOf(el).replace(/\s+/g, "");
  return (
    /page-break-(before|after):always/.test(s) ||
    /mso-break-type:(page|section)-break/.test(s) ||
    el.hasAttribute("data-page-break")
  );
}

function unwrap(el: Element) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function cleanStyle(el: Element) {
  const s = el.getAttribute("style");
  if (s == null) return;
  const kept = s
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !/^mso-/i.test(d) && !/^tab-stops/i.test(d));
  if (kept.length) el.setAttribute("style", kept.join("; "));
  else el.removeAttribute("style");
}

const HIGHLIGHT_NAMES: Record<string, string> = {
  yellow: "#ffff00",
  green: "#00ff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  blue: "#0000ff",
  red: "#ff0000",
  darkblue: "#000080",
  darkcyan: "#008080",
  darkgreen: "#008000",
  darkmagenta: "#800080",
  darkred: "#800000",
  darkyellow: "#808000",
  darkgray: "#808080",
  lightgray: "#c0c0c0",
  black: "#000000",
};

/** Background colour a span asks for, if it is a real highlight. */
function spanHighlight(el: Element): string | null {
  const s = el.getAttribute("style") || "";
  const mso = /mso-highlight:\s*([a-z]+)/i.exec(s);
  if (mso) return HIGHLIGHT_NAMES[mso[1].toLowerCase()] ?? mso[1];
  const bg = /(?:^|;)\s*background(?:-color)?:\s*([^;]+)/i.exec(s);
  if (!bg) return null;
  const v = bg[1].trim();
  if (/^(transparent|none|initial|inherit|white|#fff(fff)?|rgb\(255,\s*255,\s*255\)|rgba\(.*,\s*0\))$/i.test(v)) return null;
  return v;
}

/** Word list paragraphs -> nested lists. Consecutive paragraphs carrying
 *  mso-list are grouped; the marker text decides bullet vs numbered. */
function convertWordLists(root: Element, doc: Document) {
  const paras = Array.from(root.querySelectorAll("p, h1, h2, h3, h4, h5, h6, div")).filter(
    (p) => msoList(p) && !p.closest("li"),
  );
  const done = new Set<Element>();
  for (const first of paras) {
    if (done.has(first)) continue;
    // Collect the run of adjacent list paragraphs (siblings, whitespace
    // text between them allowed).
    const run: Element[] = [];
    let cur: Node | null = first;
    while (cur) {
      if (cur.nodeType === 3 && !(cur.textContent || "").trim()) {
        cur = cur.nextSibling;
        continue;
      }
      if (cur.nodeType !== 1 || !msoList(cur as Element)) break;
      run.push(cur as Element);
      cur = cur.nextSibling;
    }
    run.forEach((p) => done.add(p));
    const stack: { level: number; list: Element }[] = [];
    const anchor = run[0];
    let top: Element | null = null;
    for (const p of run) {
      const info = msoList(p)!;
      const marker = p.querySelector('[style*="mso-list:ignore" i], [style*="mso-list: ignore" i]');
      const markerText = (marker?.textContent || "").replace(/ /g, " ").trim();
      marker?.remove();
      const ordered = /^\(?([0-9]+|[ivxlcdm]+|[a-z])[.)]$/i.test(markerText);
      const tag = ordered ? "OL" : "UL";
      while (stack.length && stack[stack.length - 1].level > info.level) stack.pop();
      let parentList = stack[stack.length - 1];
      if (!parentList || parentList.level < info.level || parentList.list.tagName !== tag) {
        if (parentList && parentList.level === info.level) stack.pop();
        const list = doc.createElement(tag);
        const holder = stack[stack.length - 1];
        if (holder) {
          const lastLi = holder.list.lastElementChild ?? holder.list.appendChild(doc.createElement("li"));
          lastLi.appendChild(list);
        } else if (!top) {
          top = list;
          anchor.parentNode!.insertBefore(list, anchor);
        } else {
          top.parentNode!.insertBefore(list, top.nextSibling);
          top = list;
        }
        parentList = { level: info.level, list };
        stack.push(parentList);
      }
      const li = doc.createElement("li");
      const para = doc.createElement(/^H\d$/.test(p.tagName) ? p.tagName : "P");
      while (p.firstChild) para.appendChild(p.firstChild);
      // Word indents list text with margins/text-indent; drop them.
      li.appendChild(para);
      parentList.list.appendChild(li);
      p.remove();
    }
  }
}

function removeComments(root: Node) {
  const walker = root.ownerDocument!.createTreeWalker(root, 128 /* SHOW_COMMENT */);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));
}

/** normalizePastedHTML cleans clipboard HTML (see the file comment). */
export function normalizePastedHTML(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  // Word/Excel wrap the fragment in <!--StartFragment--> … <!--EndFragment-->
  // inside a full document; the parser copes with either.
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  if (!body) return html;
  removeComments(body);
  body.querySelectorAll("*").forEach((el) => {
    if (!el.isConnected) return;
    const tag = el.tagName.toUpperCase();
    if (DROP_TAGS.has(tag)) {
      el.remove();
      return;
    }
    if (tag.includes(":")) {
      // Office namespaces: VML shapes and o:* bits go; other wrappers
      // (w:sdt content controls, st1:* smart tags) are unwrapped.
      if (/^(V|O):/.test(tag)) el.remove();
      else unwrap(el);
      return;
    }
    if (tag === "IMG") {
      const src = el.getAttribute("src") || "";
      if (!src || /^(file|cid|blob):/i.test(src)) el.remove();
      return;
    }
  });
  // Google Docs' bold wrapper that isn't bold.
  body.querySelectorAll('b[id^="docs-internal-guid"]').forEach((b) => {
    if (/font-weight:\s*(normal|400)/i.test(b.getAttribute("style") || "")) unwrap(b);
  });
  convertWordLists(body, doc);
  body.querySelectorAll("br").forEach((br) => {
    if (!isPageBreak(br)) return;
    const pb = doc.createElement("div");
    pb.setAttribute("data-page-break", "true");
    // A page break is a block: lift it out of the paragraph it sits in.
    const block = br.closest("p, h1, h2, h3, h4, h5, h6, li, div:not([data-page-break])");
    if (block && block.parentNode && block !== body) {
      const text = (block.textContent || "").trim();
      if (!text) block.parentNode.replaceChild(pb, block);
      else {
        block.parentNode.insertBefore(pb, block.nextSibling);
        br.remove();
      }
    } else br.replaceWith(pb);
  });
  body.querySelectorAll("span").forEach((span) => {
    const hl = spanHighlight(span);
    if (hl) {
      const mark = doc.createElement("mark");
      mark.setAttribute("data-color", hl);
      mark.setAttribute("style", `background-color: ${hl}`);
      while (span.firstChild) mark.appendChild(span.firstChild);
      span.appendChild(mark);
      const rest = (span.getAttribute("style") || "")
        .split(";")
        .filter((d) => d.trim() && !/^\s*(background(-color)?|mso-highlight)\s*:/i.test(d));
      if (rest.length) span.setAttribute("style", rest.join(";"));
      else span.removeAttribute("style");
    }
  });
  // Character styles set on a block (<h1 style="color:red">) only reach
  // TipTap's text-style marks from a <span>: move them onto one.
  body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, td, th").forEach((block) => {
    const st = (block as HTMLElement).style;
    if (!st) return;
    const carry = (["color", "font-family", "font-size"] as const)
      .map((k) => [k, st.getPropertyValue(k)] as const)
      .filter(([, v]) => v && !/^(inherit|initial|windowtext)$/i.test(v));
    if (!carry.length || !block.textContent?.trim()) return;
    if (block.querySelector("p, div, ul, ol, table, h1, h2, h3, h4, h5, h6, blockquote, pre")) return;
    const span = doc.createElement("span");
    span.setAttribute("style", carry.map(([k, v]) => `${k}: ${v}`).join("; "));
    while (block.firstChild) span.appendChild(block.firstChild);
    block.appendChild(span);
    carry.forEach(([k]) => st.removeProperty(k));
  });
  body.querySelectorAll("*").forEach((el) => {
    const cls = el.getAttribute("class");
    if (cls && /(^|\s)Mso/.test(cls)) el.removeAttribute("class");
    el.removeAttribute("lang");
    cleanStyle(el);
  });
  return body.innerHTML;
}

// --- copy serialisation ----------------------------------------------------------------

/** sliceToText turns copied content into plain text: textblocks end with
 *  "\n", table cells are separated by "\t" and rows end with "\n", hard
 *  breaks become "\n", list items keep a "• " or "1. " prefix and task
 *  items "☐ " / "☑ ". */
export function sliceToText(content: Fragment): string {
  const lines: string[] = [];
  const inline = (block: PMNode) => {
    let s = "";
    block.forEach((c) => {
      if (c.isText) s += c.text;
      else if (c.type.name === "hardBreak") s += "\n";
      else if (c.isLeaf) s += c.type.spec.leafText?.(c) ?? "";
    });
    return s;
  };
  const walk = (frag: Fragment, prefix: string, depth: number) => {
    let first = true;
    frag.forEach((node) => {
      const name = node.type.name;
      if (node.isTextblock) {
        lines.push((first ? prefix : " ".repeat(prefix.length)) + inline(node));
        first = false;
      } else if (name === "bulletList" || name === "orderedList" || name === "taskList") {
        let n = name === "orderedList" ? (node.attrs.start as number) ?? 1 : 1;
        node.forEach((item) => {
          const indent = "  ".repeat(depth);
          const p =
            name === "orderedList"
              ? `${n++}. `
              : name === "taskList"
                ? item.attrs.checked
                  ? "☑ "
                  : "☐ "
                : "• ";
          walk(item.content, indent + p, depth + 1);
        });
        first = false;
      } else if (name === "table") {
        node.forEach((row) => {
          const cells: string[] = [];
          row.forEach((cell) => {
            const parts: string[] = [];
            cell.forEach((b) => parts.push(b.isTextblock ? inline(b) : b.textContent));
            cells.push(parts.join(" "));
          });
          lines.push(cells.join("\t"));
        });
        first = false;
      } else if (name === "pageBreak" || name === "horizontalRule") {
        lines.push("");
      } else if (!node.isLeaf) {
        walk(node.content, prefix, depth);
      }
    });
  };
  // A slice inside one paragraph is a bare inline fragment.
  let allInline = true;
  content.forEach((n) => {
    if (!n.isInline) allInline = false;
  });
  if (allInline) {
    let s = "";
    content.forEach((c) => {
      if (c.isText) s += c.text;
      else if (c.type.name === "hardBreak") s += "\n";
    });
    return s;
  }
  walk(content, "", 0);
  return lines.join("\n");
}

/** clipboardSerializerFor extends the schema's DOM serializer for other
 *  word processors: page breaks go out as Word's page-break <br>. */
export function clipboardSerializerFor(schema: Schema): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema);
  return new DOMSerializer(
    {
      ...base.nodes,
      pageBreak: () => [
        "br",
        { "data-page-break": "true", style: "page-break-before: always; mso-break-type: page-break" },
      ],
    },
    base.marks,
  );
}

/** selectionToHTML returns what copying the selection puts on the
 *  clipboard as text/html. */
export function selectionToHTML(editor: Editor): string {
  const slice = editor.state.selection.content();
  return editor.view.serializeForClipboard(slice).dom.innerHTML;
}

/** selectionToText returns what copying the selection puts on the
 *  clipboard as text/plain. */
export function selectionToText(editor: Editor): string {
  const slice = editor.state.selection.content();
  return editor.view.serializeForClipboard(slice).text;
}

/** pasteHTML / pastePlainText run content through the editor's paste
 *  pipeline (normalisation, paste rules, Suggesting) at the selection. */
export function pasteHTML(editor: Editor, html: string): boolean {
  return editor.view.pasteHTML(html);
}
export function pastePlainText(editor: Editor, text: string): boolean {
  return editor.view.pasteText(text);
}

export const clipboardKey = new PluginKey("docClipboard");

/** ClipboardHandling installs the paste/copy transforms. */
export const ClipboardHandling = Extension.create({
  name: "clipboardHandling",
  // Ahead of TipTap's core ClipboardTextSerializer (someProp takes the
  // first plugin that answers).
  priority: 1000,
  addProseMirrorPlugins() {
    const schema = this.editor.schema;
    const serializer = clipboardSerializerFor(schema);
    return [
      new Plugin({
        key: clipboardKey,
        props: {
          transformPastedHTML: (html: string) => normalizePastedHTML(html),
          clipboardTextSerializer: (slice: Slice) => sliceToText(slice.content),
          clipboardSerializer: serializer,
        },
      }),
    ];
  },
});
