// Pure clipboard payloads for the slides editor. Copying elements writes the
// internal format (JSON under CLIP_MIME) next to plain text, so a paste in
// another tab or deck restores the elements; pasting plain text or HTML from
// elsewhere makes a new text box.

import { newElement, uid, type ParaProps, type SlideElement, type TextRun } from "./model";
import { duplicateElements } from "./deckOps";
import { layoutParagraphs } from "./textLayout";
import { effective } from "./textOps";

/** MIME type of the internal element payload on the system clipboard. */
export const CLIP_MIME = "application/x-grown-slides+json";

interface Payload {
  grownSlides: 1;
  elements: SlideElement[];
}

/** encodeClipboard serialises elements as the internal clipboard payload. */
export function encodeClipboard(els: readonly SlideElement[]): string {
  const p: Payload = { grownSlides: 1, elements: [...els] };
  return JSON.stringify(p);
}

function validElement(e: unknown): e is SlideElement {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  const ok =
    typeof o.id === "string" &&
    typeof o.type === "string" &&
    ["x", "y", "w", "h"].every((k) => typeof o[k] === "number" && Number.isFinite(o[k]));
  if (!ok) return false;
  if (o.children !== undefined)
    return Array.isArray(o.children) && o.children.every(validElement);
  return true;
}

/** decodeClipboard parses an internal payload; anything else (including
 *  malformed JSON or elements) yields null. */
export function decodeClipboard(s: string | null | undefined): SlideElement[] | null {
  if (!s) return null;
  try {
    const p = JSON.parse(s) as Partial<Payload>;
    if (p?.grownSlides !== 1 || !Array.isArray(p.elements)) return null;
    if (!p.elements.length || !p.elements.every(validElement)) return null;
    return p.elements;
  } catch {
    return null;
  }
}

/** clipboardText is the plain-text flavour of copied elements: their text
 *  (group members included), one element per line. */
export function clipboardText(els: readonly SlideElement[]): string {
  const out: string[] = [];
  const walk = (e: SlideElement) => {
    if (e.text) out.push(e.text);
    if (e.table) out.push(e.table.cells.map((r) => r.join("\t")).join("\n"));
    e.children?.forEach(walk);
  };
  els.forEach(walk);
  return out.join("\n");
}

/** htmlToText flattens an HTML fragment to text: block ends and <br> become
 *  newlines, tags are dropped and the common entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function base64Utf8(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}
function fromBase64Utf8(s: string): string {
  return decodeURIComponent(escape(atob(s)));
}

/** A text element's paragraphs as HTML (<p> or list items with inline
 *  <b>/<i>/<u>/<s>/<sup>/<sub>/<a>/colour), for Docs and other editors. */
function textHtml(el: SlideElement): string {
  const paras = layoutParagraphs(el);
  const runHtml = (r: TextRun) => {
    let h = escHtml(r.text).replace(/\v/g, "<br>");
    if (!h) return "";
    const color = r.color;
    if (color) h = `<span style="color:${escHtml(color)}">${h}</span>`;
    if (effective(el, r, "baseline") === "super") h = `<sup>${h}</sup>`;
    if (effective(el, r, "baseline") === "sub") h = `<sub>${h}</sub>`;
    if (effective(el, r, "strike")) h = `<s>${h}</s>`;
    if (effective(el, r, "underline") && !r.url) h = `<u>${h}</u>`;
    if (effective(el, r, "italic")) h = `<em>${h}</em>`;
    if (effective(el, r, "bold")) h = `<strong>${h}</strong>`;
    if (r.url && /^(https?:|mailto:)/i.test(r.url)) h = `<a href="${escHtml(r.url)}">${h}</a>`;
    return h;
  };
  if (!el.list) return paras.map((p) => `<p>${p.runs.map(runHtml).join("") || "<br>"}</p>`).join("");
  // Nested lists by paragraph level.
  const tag = el.list === "number" ? "ol" : "ul";
  let out = "";
  let depth = -1;
  for (const p of paras) {
    const lvl = Math.max(0, p.props.level ?? 0);
    while (depth < lvl) {
      out += `<${tag}>`;
      depth++;
    }
    while (depth > lvl) {
      out += `</${tag}>`;
      depth--;
    }
    out += `<li><p>${p.runs.map(runHtml).join("")}</p></li>`;
  }
  while (depth-- >= 0) out += `</${tag}>`;
  return out;
}

/**
 * clipboardHtml is the text/html flavour of copied elements: text boxes as
 * paragraphs and lists, tables as <table>, pictures as <img> (with alt),
 * in slide order. The root carries the internal payload too
 * (`data-grown-slides`), so browsers that drop custom clipboard types
 * still paste real elements into another deck.
 */
export function clipboardHtml(els: readonly SlideElement[]): string {
  const parts: string[] = [];
  const walk = (e: SlideElement) => {
    if (e.children) return e.children.forEach(walk);
    if ((e.type === "text" || e.type === "shape") && (e.text || "").trim()) parts.push(textHtml(e));
    else if (e.type === "table" && e.table)
      parts.push(`<table>${e.table.cells.map((row) => `<tr>${row.map((c) => `<td>${escHtml(c).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("")}</table>`);
    else if (e.type === "image" && e.src && !e.src.startsWith("/")) parts.push(`<img src="${escHtml(e.src)}" alt="${escHtml(e.alt ?? "")}" width="${Math.round(e.w)}" height="${Math.round(e.h)}">`);
    else if (e.type === "image" && e.src) parts.push(`<img src="${escHtml(new URL(e.src, typeof location !== "undefined" ? location.href : "http://localhost/").href)}" alt="${escHtml(e.alt ?? "")}">`);
  };
  els.forEach(walk);
  return `<div data-grown-slides="${base64Utf8(encodeClipboard(els))}">${parts.join("")}</div>`;
}

/** The internal payload embedded in copied HTML, if any. */
export function internalFromHtml(html: string | null | undefined): string | null {
  const m = html ? /data-grown-slides="([A-Za-z0-9+/=]+)"/.exec(html) : null;
  if (!m) return null;
  try {
    return fromBase64Utf8(m[1]);
  } catch {
    return null;
  }
}

function cssColor(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return "#" + [...t.slice(1)].map((c) => c + c).join("");
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(t);
  if (m && (m[4] === undefined || Number(m[4]) > 0)) return "#" + [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("");
  return undefined;
}

const BLOCKS = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "TR"]);

/**
 * htmlToElements turns an HTML fragment (from Grown Docs, Google Docs, a
 * web page) into slide elements: a lone table becomes a table, lone
 * pictures become pictures, anything else one text box with runs (bold,
 * italic, underline, strike, super/subscript, colour, links) and, when
 * every paragraph is a list item, a bulleted/numbered list with levels.
 */
export function htmlToElements(html: string, makeId: () => string = uid): SlideElement[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  body.querySelectorAll("script,style,meta,link,title").forEach((n) => n.remove());
  const meaningful = (n: Element) => !!(n.textContent || "").trim() || n.querySelector("img");
  const top = Array.from(body.querySelectorAll(":scope > *")).filter(meaningful);
  // Unwrap single wrappers (e.g. <b id="docs-internal-guid…"> or a <div>).
  let roots = top;
  while (roots.length === 1 && !["TABLE", "IMG", "P", "LI", "UL", "OL"].includes(roots[0].tagName) && roots[0].children.length && !(roots[0].childNodes.length > roots[0].children.length && Array.from(roots[0].childNodes).some((c) => c.nodeType === 3 && (c.textContent || "").trim())))
    roots = Array.from(roots[0].children).filter(meaningful);
  // A table on its own.
  if (roots.length === 1 && roots[0].tagName === "TABLE") {
    const rows = Array.from(roots[0].querySelectorAll("tr")).map((tr) => Array.from(tr.querySelectorAll("th,td")).map((td) => (td.textContent || "").replace(/\s+/g, " ").trim()));
    const cols = Math.max(1, ...rows.map((r) => r.length));
    if (rows.length && cols) {
      const cells = rows.map((r) => [...r, ...Array(cols - r.length).fill("")]);
      const base = newElement("table");
      const w = Math.min(880, 120 * cols);
      const h = Math.min(480, 40 * rows.length);
      return [{ ...base, id: makeId(), w, h, table: { rows: rows.length, cols, cells } }];
    }
  }
  // Pictures on their own.
  const imgs = Array.from(body.querySelectorAll("img"));
  if (imgs.length && !(body.textContent || "").trim()) {
    return imgs
      .filter((im) => /^(data:image\/|https?:|\/)/i.test(im.getAttribute("src") || ""))
      .slice(0, 20)
      .map((im, i) => {
        const w = Math.min(640, Number(im.getAttribute("width")) || 320);
        const h = Math.min(480, Number(im.getAttribute("height")) || 240);
        return { ...newElement("image", im.getAttribute("src")!), id: makeId(), x: 40 + i * 20, y: 40 + i * 20, w, h, ...(im.getAttribute("alt") ? { alt: im.getAttribute("alt")! } : {}) };
      });
  }
  // Rich text.
  const runs: TextRun[] = [];
  const paras: ParaProps[] = [];
  let listKind: "bullet" | "number" | null | undefined;
  let allList = true;
  let started = false;
  let pendingBreak = false;
  const newPara = (level: number | undefined, inList: boolean) => {
    if (started) runs.push({ text: "\n" });
    started = true;
    paras.push(level ? { level } : {});
    if (!inList) allList = false;
  };
  type Style = Omit<TextRun, "text">;
  /** `level` counts the enclosing lists. */
  const walk = (n: Node, st: Style, level: number, list: "bullet" | "number" | null) => {
    if (n.nodeType === 3) {
      const t = (n.textContent || "").replace(/\s+/g, " ");
      if (!t.trim() && !started) return;
      if (!started) newPara(undefined, false);
      if (pendingBreak) {
        runs.push({ ...st, text: "\v" });
        pendingBreak = false;
      }
      runs.push({ ...st, text: t });
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as HTMLElement;
    const tag = e.tagName;
    if (tag === "BR") {
      pendingBreak = true;
      return;
    }
    const s: Style = { ...st };
    const fw = e.style.fontWeight;
    if (tag === "B" || tag === "STRONG" || /^h[1-6]$/i.test(tag) || fw === "bold" || Number(fw) >= 600) s.bold = true;
    if (fw === "normal" || (Number(fw) > 0 && Number(fw) < 600)) delete s.bold;
    if (tag === "I" || tag === "EM" || e.style.fontStyle === "italic") s.italic = true;
    const deco = e.style.textDecoration || e.style.textDecorationLine || "";
    if (tag === "U" || /underline/.test(deco)) s.underline = true;
    if (tag === "S" || tag === "STRIKE" || tag === "DEL" || /line-through/.test(deco)) s.strike = true;
    if (tag === "SUP" || e.style.verticalAlign === "super") s.baseline = "super";
    if (tag === "SUB" || e.style.verticalAlign === "sub") s.baseline = "sub";
    const c = cssColor(e.style.color);
    if (c && c !== "#000000") s.color = c;
    if (tag === "A") {
      const href = e.getAttribute("href") || "";
      if (/^(https?:|mailto:)/i.test(href)) s.url = href;
    }
    if (tag === "UL" || tag === "OL") {
      const kind = tag === "OL" ? "number" : "bullet";
      if (listKind === undefined) listKind = kind;
      e.childNodes.forEach((ch) => walk(ch, s, level + 1, kind));
      return;
    }
    if (BLOCKS.has(tag)) {
      // A list item's inner <p> stays in the item's paragraph.
      const inner = tag === "P" && e.parentElement?.tagName === "LI" && e.parentElement.firstElementChild === e;
      if (!inner) {
        newPara(tag === "LI" ? Math.max(0, level - 1) : undefined, tag === "LI" && !!list);
        pendingBreak = false;
      }
      e.childNodes.forEach((ch) => walk(ch, s, level, list));
      if (tag === "TD" || tag === "TH") runs.push({ ...s, text: "\t" });
      return;
    }
    e.childNodes.forEach((ch) => walk(ch, s, level, list));
    if (tag === "TD" || tag === "TH") runs.push({ ...s, text: "\t" });
  };
  body.childNodes.forEach((ch) => walk(ch, {}, 0, null));
  // Tidy: trim spaces at paragraph edges, merge equal runs, drop empties.
  const text0 = runs.map((r) => r.text).join("");
  if (!text0.trim()) return [];
  const merged: TextRun[] = [];
  const same = (a: TextRun, b: TextRun) => JSON.stringify({ ...a, text: "" }) === JSON.stringify({ ...b, text: "" });
  for (const r of runs) {
    if (!r.text) continue;
    const last = merged[merged.length - 1];
    if (last && (same(last, r) || r.text === "\n")) last.text += r.text;
    else merged.push({ ...r });
  }
  // Trim trailing spaces/tabs before each paragraph break and at the ends.
  for (const r of merged) r.text = r.text.replace(/[ \t]+\n/g, "\n").replace(/\n[ ]+/g, "\n");
  if (merged.length) {
    merged[0].text = merged[0].text.replace(/^\s+/, "");
    merged[merged.length - 1].text = merged[merged.length - 1].text.replace(/\s+$/, "");
  }
  const cleaned = merged.filter((r) => r.text);
  const text = cleaned.map((r) => r.text).join("");
  const plain = cleaned.every((r) => Object.keys(r).length === 1);
  const count = text.split("\n").length;
  const base = newElement("text");
  const el: SlideElement = { ...base, id: makeId(), text };
  if (!plain) el.runs = cleaned;
  const ps = paras.slice(0, count);
  if (ps.some((p) => p.level)) el.paras = ps;
  if (allList && listKind) el.list = listKind;
  el.h = Math.max(base.h, Math.min(460, count * (base.fontSize || 18) * 1.5 + 16));
  return [el];
}

/**
 * pasteElements turns clipboard data into new elements to insert: the
 * internal format wins (fresh ids, offset like a duplicate; also when it
 * rides inside copied HTML), then HTML (rich text, a table or pictures,
 * see htmlToElements), then plain text (one text box). Returns [] when there's nothing usable.
 */
export function pasteElements(
  data: { internal?: string | null; html?: string | null; text?: string | null },
  makeId: () => string = uid,
): SlideElement[] {
  const els = decodeClipboard(data.internal) ?? decodeClipboard(internalFromHtml(data.html));
  if (els) return duplicateElements(els, makeId);
  if (data.html) {
    const fromHtml = htmlToElements(data.html, makeId);
    if (fromHtml.length) return fromHtml;
  }
  const text = data.html ? htmlToText(data.html) : (data.text ?? "").trim();
  if (!text) return [];
  const box = newElement("text");
  return [{ ...box, id: makeId(), text }];
}
