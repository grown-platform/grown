// Small XML helpers for the DOCX reader and writer (Docs M6).
//
// Reading goes through the browser's DOMParser (jsdom in tests). Lookups
// match on *local names*, so a document that binds the WordprocessingML
// namespace to a prefix other than "w" (or uses Strict OOXML URIs) still
// reads. Writing is plain string building with escaping.

/** Units: OOXML twips (1/20 pt), half-points, eighths of a point, EMUs. */
export const twipsToPt = (v: number) => round2(v / 20);
export const ptToTwips = (pt: number) => Math.round(pt * 20);
export const EMU_PER_PX = 9525;
export const TWIPS_PER_PX = 15;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error(`invalid XML: ${err.textContent?.slice(0, 200) ?? ""}`);
  return doc;
}

const local = (el: Element) => el.localName || el.nodeName.replace(/^.*:/, "");

/** Child elements, optionally filtered by local name(s). */
export function kids(el: Element | null | undefined, ...names: string[]): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling)
    if (!names.length || names.includes(local(c))) out.push(c);
  return out;
}

/** First child element with the local name. */
export function kid(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (local(c) === name) return c;
  return null;
}

/** Descendant by a path of local names ("pPr", "spacing"). */
export function path(el: Element | null | undefined, ...names: string[]): Element | null {
  let cur: Element | null | undefined = el;
  for (const n of names) {
    cur = kid(cur, n);
    if (!cur) return null;
  }
  return cur ?? null;
}

/** All descendants with a local name (document order). */
export function descendants(el: Element | Document | null | undefined, name: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  const all = (el as Element).getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) if (local(all[i]) === name) out.push(all[i]);
  return out;
}

export function nameOf(el: Element): string {
  return local(el);
}

/** Attribute by local name ("val" finds w:val). A prefixed name ("r:id")
 *  is tried exactly first, then by local name with a matching prefix or
 *  namespace family. */
export function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  const exact = el.getAttribute(name);
  if (exact != null) return exact;
  const i = name.indexOf(":");
  const want = i >= 0 ? name.slice(i + 1) : name;
  const prefix = i >= 0 ? name.slice(0, i) : null;
  for (let k = 0; k < el.attributes.length; k++) {
    const a = el.attributes[k];
    const ln = a.localName || a.name.replace(/^.*:/, "");
    if (ln !== want) continue;
    if (!prefix) return a.value;
    if (a.prefix === prefix) return a.value;
    if (prefix === "r" && /relationships/.test(a.namespaceURI ?? "")) return a.value;
  }
  return null;
}

/** Word's ST_OnOff: missing element = undefined, `<w:b/>` = true,
 *  val "0"/"false"/"off" = false. */
export function onOff(el: Element | null | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = attr(el, "w:val");
  if (v == null) return true;
  return !/^(0|false|off|none)$/i.test(v);
}

export function num(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  // Strict OOXML allows units on some measures ("12pt", "0.5in").
  const m = /^(-?[\d.]+)(pt|in|mm|cm|pc|pi)?$/.exec(v.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  switch (m[2]) {
    case "pt":
      return n * 20;
    case "in":
      return n * 1440;
    case "mm":
      return (n * 1440) / 25.4;
    case "cm":
      return (n * 1440) / 2.54;
    case "pc":
    case "pi":
      return n * 240;
    default:
      return n;
  }
}

export function textOf(el: Element | null | undefined): string {
  return el?.textContent ?? "";
}

// --- writing -------------------------------------------------------------------

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most C0 controls; drop them (tabs/newlines are
    // written as elements by the callers).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

/** el("w:jc", { "w:val": "center" }) -> `<w:jc w:val="center"/>`. */
export function el(name: string, attrs: Record<string, string | number | null | undefined> = {}, body = ""): string {
  let s = `<${name}`;
  for (const [k, v] of Object.entries(attrs)) if (v != null) s += ` ${k}="${esc(String(v))}"`;
  return body ? `${s}>${body}</${name}>` : `${s}/>`;
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Namespaces declared on every WordprocessingML part root. */
export const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  w14: "http://schemas.microsoft.com/office/word/2010/wordml",
  w15: "http://schemas.microsoft.com/office/word/2012/wordml",
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
  /** Word 2010 drawing extensions (M7): relative sizes / positions, shapes. */
  wp14: "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
  wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
  m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
  /** Grown's form-field extension (M10), ignorable for other readers. */
  gf: "urn:grown:docs:forms:2026",
};

export const ROOT_NS =
  `xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" ` +
  `xmlns:pic="${NS.pic}" xmlns:m="${NS.m}" xmlns:w14="${NS.w14}" xmlns:w15="${NS.w15}" xmlns:gf="${NS.gf}" xmlns:mc="${NS.mc}" ` +
  `xmlns:wp14="${NS.wp14}" xmlns:wps="${NS.wps}" mc:Ignorable="w14 w15 gf wp14"`;

// --- colours ---------------------------------------------------------------------

/** Word highlight names (ST_HighlightColor) and their RGB. */
export const HIGHLIGHTS: Record<string, string> = {
  yellow: "#ffff00",
  green: "#00ff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  blue: "#0000ff",
  red: "#ff0000",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#c0c0c0",
  black: "#000000",
  white: "#ffffff",
};

const NAMED: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF",
  yellow: "FFFF00", gray: "808080", grey: "808080", orange: "FFA500", purple: "800080",
};

/** toHex turns a CSS colour (#rgb, #rrggbb, rgb(), a few names) into
 *  "RRGGBB", or null. */
export function toHex(c: string | null | undefined): string | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  let m = /^#?([0-9a-f]{6})$/.exec(s);
  if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (m) return [m[1], m[2], m[3]].map((v) => Math.min(255, +v).toString(16).padStart(2, "0")).join("").toUpperCase();
  return NAMED[s] ?? null;
}

/** fromHex turns Word's "RRGGBB" (or "auto") into "#rrggbb" or null. */
export function fromHex(v: string | null | undefined): string | null {
  if (!v || /^auto$/i.test(v)) return null;
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null;
}
