// PDF pages from laid-out DOM pages (Docs and Sheets). Each page element is
// drawn to a canvas through an SVG <foreignObject> (the page's markup plus
// the stylesheet rules that apply to it, with its pictures and web fonts
// inlined as data: URLs, so the browser's own layout is what ends up in the
// file), then written as a JPEG under an invisible text layer and link
// annotations taken from the live layout (pdfWriter.ts). The page elements
// must be attached to a document while they are converted.

import { buildPdf, type PdfMeta, type PdfPage, type PdfText } from "./pdfWriter";

/** Raster resolution: pixels per point (2 = 144 dpi). */
export const PDF_PX_PER_PT = 2;
/** CSS px → PDF points. */
export const PT_PER_PX = 0.75;

export interface DomPage {
  el: HTMLElement;
  /** Page size in CSS px. */
  w: number;
  h: number;
}

export interface DomPdfOptions {
  /** Apply `@media print` rules (and skip `@media screen` ones). */
  printMedia?: boolean;
  /** Raster pixels per point; default PDF_PX_PER_PT. */
  pxPerPt?: number;
  /** JPEG quality; default 0.9. */
  quality?: number;
  /** Called after each page is drawn. */
  onProgress?: (done: number, total: number) => void;
}

// ---- stylesheet collection -------------------------------------------------------------------

/** splitSelectors splits a selector list at top-level commas. */
export function splitSelectors(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const DYNAMIC = /:(hover|focus|focus-within|focus-visible|active|target|visited)\b/;
const PSEUDO_ELEMENT = /::?(before|after|marker|placeholder|selection|first-line|first-letter|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)(\([^)]*\))?/g;

/** mediaMatches evaluates a media query list, reading `print` / `screen`
 *  as the export's medium and the rest against the window. */
export function mediaMatches(media: string, win: Window, printMedia: boolean): boolean {
  if (!media.trim() || media.trim() === "all") return true;
  return splitSelectors(media).some((q) => {
    let query = q.trim().toLowerCase();
    let negate = false;
    if (query.startsWith("not ")) {
      negate = true;
      query = query.slice(4).trim();
    }
    query = query.replace(/^only\s+/, "");
    let ok = true;
    const m = /^(print|screen|all|speech)\b\s*(?:and\s*)?(.*)$/.exec(query);
    if (m) {
      ok = m[1] === "all" || (m[1] === "print" ? printMedia : m[1] === "screen" ? !printMedia : false);
      query = m[2].trim();
    }
    if (ok && query) {
      try {
        ok = win.matchMedia(query).matches;
      } catch {
        ok = false;
      }
    }
    return negate ? !ok : ok;
  });
}

interface CssContext {
  host: Element;
  win: Window;
  printMedia: boolean;
  fontFaces: CSSFontFaceRule[];
  out: string[];
}

function ruleSelectorsIn(ctx: CssContext, selectorText: string): string[] {
  const kept: string[] = [];
  for (const sel of splitSelectors(selectorText)) {
    if (DYNAMIC.test(sel)) continue;
    const probe = sel.replace(PSEUDO_ELEMENT, "").trim() || "*";
    try {
      if (ctx.host.matches(probe) || ctx.host.querySelector(probe)) kept.push(sel);
      else {
        // Rules for <html>/<body> (custom properties, inherited fonts):
        // the page is wrapped in an html/body pair, and :root is the <svg>.
        const doc = ctx.host.ownerDocument;
        if (doc.documentElement.matches(probe) || (doc.body && doc.body.matches(probe))) kept.push(sel.replace(/:root\b/g, "html"));
      }
    } catch {
      // A selector this browser can't evaluate can't apply either.
    }
  }
  return kept;
}

// Rules may come from another realm (an iframe), so they are told apart by
// constructor name rather than instanceof.
function walkRules(ctx: CssContext, rules: CSSRuleList) {
  for (const rule of Array.from(rules)) {
    const kind = rule.constructor.name;
    if (kind === "CSSStyleRule") {
      const r = rule as CSSStyleRule;
      const kept = ruleSelectorsIn(ctx, r.selectorText);
      if (kept.length) ctx.out.push(`${kept.join(",")}{${r.style.cssText}}`);
      // Nested rules (CSS nesting) are rare in built CSS; ignored.
    } else if (kind === "CSSMediaRule") {
      const r = rule as CSSMediaRule;
      if (mediaMatches(r.conditionText ?? r.media.mediaText, ctx.win, ctx.printMedia)) walkRules(ctx, r.cssRules);
    } else if (kind === "CSSSupportsRule") {
      const r = rule as CSSSupportsRule;
      let ok = false;
      try {
        ok = CSS.supports(r.conditionText);
      } catch {
        ok = false;
      }
      if (ok) walkRules(ctx, r.cssRules);
    } else if (kind === "CSSLayerBlockRule" || kind === "CSSContainerRule") {
      walkRules(ctx, (rule as CSSGroupingRule).cssRules);
    } else if (kind === "CSSImportRule") {
      const r = rule as CSSImportRule;
      if (r.styleSheet && mediaMatches(r.media.mediaText, ctx.win, ctx.printMedia)) {
        try {
          walkRules(ctx, r.styleSheet.cssRules);
        } catch {
          // cross-origin
        }
      }
    } else if (kind === "CSSFontFaceRule") {
      ctx.fontFaces.push(rule as CSSFontFaceRule);
    }
    // @keyframes, @page, @property, @counter-style…: not needed for a still.
  }
}

/** Font family names used anywhere under `root`. */
function usedFamilies(root: Element, win: Window): Set<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  const els = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of els) {
    const ff = win.getComputedStyle(el).fontFamily;
    if (seen.has(ff)) continue;
    seen.add(ff);
    for (const name of splitSelectors(ff)) out.add(name.replace(/^["']|["']$/g, "").trim().toLowerCase());
  }
  return out;
}

const dataUrlCache = new Map<string, Promise<string | null>>();

/** toDataUrl fetches a same-origin resource as a data: URL (cached). */
export function toDataUrl(url: string): Promise<string | null> {
  if (url.startsWith("data:")) return Promise.resolve(url);
  let p = dataUrlCache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(url, { credentials: "same-origin" });
        if (!r.ok) return null;
        const blob = await r.blob();
        return await new Promise<string | null>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(typeof fr.result === "string" ? fr.result : null);
          fr.onerror = () => res(null);
          fr.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    })();
    // blob: URLs are per-document and may be revoked; don't keep them.
    if (!url.startsWith("blob:")) dataUrlCache.set(url, p);
  }
  return p;
}

const URL_RE = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

async function inlineUrls(css: string, base: string): Promise<string> {
  const urls = new Set<string>();
  for (const m of css.matchAll(URL_RE)) if (!m[2].startsWith("data:") && !m[2].startsWith("#")) urls.add(m[2]);
  let out = css;
  for (const u of urls) {
    let abs = u;
    try {
      abs = new URL(u, base).href;
    } catch {
      continue;
    }
    const data = await toDataUrl(abs);
    out = out.split(u).join(data ?? "about:blank");
  }
  return out;
}

/**
 * collectCss returns the stylesheet rules of `host`'s document that apply to
 * something inside `host`, with the @font-face rules of the families it
 * uses (their files inlined).
 */
export async function collectCss(host: Element, printMedia: boolean): Promise<string> {
  const doc = host.ownerDocument;
  const win = doc.defaultView ?? window;
  const ctx: CssContext = { host, win, printMedia, fontFaces: [], out: [] };
  for (const sheet of Array.from(doc.styleSheets)) {
    if (sheet.disabled) continue;
    if (sheet.media?.mediaText && !mediaMatches(sheet.media.mediaText, win, printMedia)) continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin (e.g. a font CDN)
    }
    walkRules(ctx, rules);
  }
  const families = usedFamilies(host, win);
  const faces: string[] = [];
  for (const f of ctx.fontFaces) {
    const fam = f.style.getPropertyValue("font-family").replace(/^["']|["']$/g, "").trim().toLowerCase();
    if (!families.has(fam)) continue;
    faces.push(await inlineUrls(`@font-face{${f.style.cssText}}`, f.parentStyleSheet?.href ?? doc.baseURI));
  }
  return faces.join("\n") + "\n" + ctx.out.join("\n");
}

// ---- page preparation --------------------------------------------------------------------------

/** inlineResources makes a page self-contained: pictures and inline-style
 *  url()s become data: URLs, form state becomes attributes. */
export async function inlineResources(root: HTMLElement): Promise<void> {
  const base = root.ownerDocument.baseURI;
  const jobs: Promise<void>[] = [];
  root.querySelectorAll("img").forEach((img) => {
    const src = img.currentSrc || img.getAttribute("src") || "";
    img.removeAttribute("srcset");
    img.removeAttribute("loading");
    if (!src || src.startsWith("data:")) return;
    jobs.push(
      toDataUrl(new URL(src, base).href).then((d) => {
        if (d) img.setAttribute("src", d);
        else img.removeAttribute("src");
      }),
    );
  });
  root.querySelectorAll("image").forEach((im) => {
    const href = im.getAttribute("href") ?? im.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "";
    if (!href || href.startsWith("data:") || href.startsWith("#")) return;
    jobs.push(
      toDataUrl(new URL(href, base).href).then((d) => {
        if (d) im.setAttribute("href", d);
      }),
    );
  });
  root.querySelectorAll<HTMLElement>("[style*='url(']").forEach((el) => {
    const css = el.getAttribute("style") ?? "";
    jobs.push(inlineUrls(css, base).then((c) => el.setAttribute("style", c)));
  });
  root.querySelectorAll("input").forEach((inp) => {
    if (inp.checked) inp.setAttribute("checked", "");
    else inp.removeAttribute("checked");
    if (inp.type !== "checkbox" && inp.type !== "radio") inp.setAttribute("value", inp.value);
  });
  root.querySelectorAll("textarea").forEach((t) => (t.textContent = t.value));
  root.querySelectorAll("select").forEach((s) =>
    Array.from(s.options).forEach((o) => (o.selected ? o.setAttribute("selected", "") : o.removeAttribute("selected"))),
  );
  await Promise.all(jobs);
}

// ---- text layer ----------------------------------------------------------------------------------

/** Typical ascent / (ascent + descent) of text fonts, to place baselines. */
const ASCENT = 0.79;
/** Typical (ascent + descent) / em, to recover the font size from a rect. */
const CONTENT_EM = 1.15;

/**
 * textLayer reads every visible line of text in `page` as positioned runs
 * (points, top-left origin), and the rectangles of its web links.
 */
export function textLayer(page: HTMLElement, pageW: number, pageH: number): Pick<PdfPage, "texts" | "links"> {
  const doc = page.ownerDocument;
  const win = doc.defaultView ?? window;
  const pr = page.getBoundingClientRect();
  const sx = pr.width ? (pageW * PT_PER_PX) / pr.width : PT_PER_PX;
  const sy = pr.height ? (pageH * PT_PER_PX) / pr.height : PT_PER_PX;
  const texts: PdfText[] = [];
  const range = doc.createRange();
  const inside = (r: DOMRect) => {
    const cx = r.left + r.width / 2 - pr.left;
    const cy = r.top + r.height / 2 - pr.top;
    return r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx <= pr.width && cy <= pr.height;
  };
  const walker = doc.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  const styleOk = new Map<Element, boolean>();
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const data = node.data;
    if (!data.trim()) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    let ok = styleOk.get(parent);
    if (ok === undefined) {
      const cs = win.getComputedStyle(parent);
      ok = cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0" && !parent.closest("style,script,noscript");
      styleOk.set(parent, ok);
    }
    if (!ok) continue;
    // Words, grouped into runs that share a line.
    let run: { a: number; b: number; left: number; right: number; top: number; bottom: number } | null = null;
    const flush = () => {
      if (!run) return;
      const h = run.bottom - run.top;
      texts.push({
        x: (run.left - pr.left) * sx,
        y: (run.top - pr.top + h * ASCENT) * sy,
        size: Math.max(1, (h / CONTENT_EM) * sy),
        text: data.slice(run.a, run.b).replace(/\s+/g, " "),
        w: (run.right - run.left) * sx,
      });
      run = null;
    };
    for (const m of data.matchAll(/\S+/g)) {
      const a = m.index ?? 0;
      const b = a + m[0].length;
      range.setStart(node, a);
      range.setEnd(node, b);
      const rects = Array.from(range.getClientRects()).filter(inside);
      if (!rects.length) {
        flush();
        continue;
      }
      // A word broken across lines (hyphenation) keeps its first piece.
      const r = rects[0];
      const sameLine = run && Math.abs(r.top - run.top) < Math.max(2, (run.bottom - run.top) * 0.5) && r.left >= run.right - 1;
      if (run && sameLine) {
        run.b = b;
        run.right = Math.max(run.right, r.right);
        run.bottom = Math.max(run.bottom, r.bottom);
      } else {
        flush();
        run = { a, b, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }
    }
    flush();
  }
  const links: NonNullable<PdfPage["links"]> = [];
  page.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    const url = a.href;
    if (!/^(https?:|mailto:)/i.test(url)) return;
    for (const r of Array.from(a.getClientRects())) {
      if (!inside(r)) continue;
      links.push({ url, box: { x: (r.left - pr.left) * sx, y: (r.top - pr.top) * sy, w: r.width * sx, h: r.height * sy } });
    }
  });
  return { texts, links };
}

// ---- rasterizing -----------------------------------------------------------------------------------

function cdata(css: string): string {
  return `<![CDATA[${css.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function attrs(el: Element | null): string {
  if (!el) return "";
  return Array.from(el.attributes)
    .filter((a) => /^(class|lang|dir|data-[\w-]+)$/.test(a.name))
    .map((a) => ` ${a.name}="${a.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`)
    .join("");
}

/**
 * pageSvg wraps a page element and its CSS in an SVG image of the page
 * (`w`×`h` CSS px) scaled to `pxW`×`pxH`. The element's <html>/<body>
 * attributes are kept so rules like `body .x` or `[data-theme] .x` match.
 */
export function pageSvg(el: HTMLElement, css: string, w: number, h: number, pxW: number, pxH: number): string {
  const doc = el.ownerDocument;
  const body = new XMLSerializer().serializeToString(el);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 ${w} ${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<html xmlns="http://www.w3.org/1999/xhtml"${attrs(doc.documentElement)} style="margin:0;padding:0;background:transparent">` +
    `<body${attrs(doc.body)} style="margin:0;padding:0;background:transparent;width:${w}px;height:${h}px;overflow:hidden">` +
    `<style>${cdata(css)}</style>${body}</body></html></foreignObject></svg>`
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "sync";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("page render failed"));
    img.src = src;
  });
}

/** svgToJpeg draws an SVG page on a white canvas and encodes it. */
export async function svgToJpeg(svg: string, pxW: number, pxH: number, quality = 0.9): Promise<Uint8Array> {
  const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
  await img.decode().catch(() => undefined);
  const canvas = document.createElement("canvas");
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, pxW, pxH);
  ctx.drawImage(img, 0, 0, pxW, pxH);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("canvas export failed");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * domPagesToPdfPages draws attached page elements as PDF pages, in order.
 * `host` is the element holding them (CSS is collected once for it).
 */
export async function domPagesToPdfPages(host: HTMLElement, pages: readonly DomPage[], opts: DomPdfOptions = {}): Promise<PdfPage[]> {
  const k = opts.pxPerPt ?? PDF_PX_PER_PT;
  const doc = host.ownerDocument;
  await doc.fonts?.ready;
  // Read the text positions from the live layout before touching the pages.
  const layers = pages.map((p) => textLayer(p.el, p.w, p.h));
  await Promise.all(pages.map((p) => inlineResources(p.el)));
  const css = await collectCss(host, !!opts.printMedia);
  const out: PdfPage[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const wPt = p.w * PT_PER_PX;
    const hPt = p.h * PT_PER_PX;
    const pxW = Math.round(wPt * k);
    const pxH = Math.round(hPt * k);
    const data = await svgToJpeg(pageSvg(p.el, css, p.w, p.h, pxW, pxH), pxW, pxH, opts.quality ?? 0.9);
    out.push({ w: wPt, h: hPt, image: { data, width: pxW, height: pxH }, ...layers[i] });
    opts.onProgress?.(i + 1, pages.length);
  }
  return out;
}

/** domPagesToPdf renders attached page elements to a PDF file. */
export async function domPagesToPdf(host: HTMLElement, pages: readonly DomPage[], meta: PdfMeta, opts: DomPdfOptions = {}): Promise<Uint8Array> {
  return buildPdf(await domPagesToPdfPages(host, pages, opts), meta);
}

/**
 * withHtmlFrame loads a whole HTML document into a hidden same-origin
 * iframe (its styles stay out of the app), runs `fn` on it and removes it.
 */
export async function withHtmlFrame<T>(html: string, width: number, fn: (doc: Document) => Promise<T>): Promise<T> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = `position:absolute;left:-100000px;top:0;width:${Math.ceil(width) + 40}px;height:200px;border:0;visibility:hidden`;
  const loaded = new Promise<void>((res) => (frame.onload = () => res()));
  frame.srcdoc = html;
  document.body.appendChild(frame);
  try {
    await loaded;
    const doc = frame.contentDocument;
    if (!doc) throw new Error("no frame document");
    await doc.fonts?.ready;
    return await fn(doc);
  } finally {
    frame.remove();
  }
}

/** Blocks that end a page in flowHtmlToPdfPages. */
const PAGE_BREAK = "[data-page-break], [data-section-break]:not([data-kind='continuous'])";

export interface FlowPage {
  /** Page size and margins, CSS px. */
  w: number;
  h: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * flowHtmlToPdfPages lays out a document body (no pagination of its own)
 * on pages of `page`'s size: top-level blocks fill a page until the next
 * one overflows it, and a page break or a (non-continuous) section break
 * starts a new page. Blocks
 * taller than a page are clipped. Used where no paginated view exists
 * (mail merge output).
 */
export async function flowHtmlToPdfPages(bodyHtml: string, css: string, page: FlowPage, opts: DomPdfOptions = {}): Promise<PdfPage[]> {
  const innerH = page.h - page.top - page.bottom;
  const pageCss = `html,body{margin:0;padding:0;background:#fff}
.grown-flow-page{position:relative;box-sizing:border-box;overflow:hidden;background:#fff;width:${page.w}px;height:${page.h}px;padding:${page.top}px ${page.right}px ${page.bottom}px ${page.left}px}
.grown-flow-body{height:${innerH}px;overflow:hidden;display:flow-root}
.grown-flow-src{width:${page.w - page.left - page.right}px}
body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.4;color:#000}
[data-page-break],[data-section-break]{border:0;margin:0;height:0}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}\n${pageCss}</style></head><body><div class="grown-flow-src">${bodyHtml}</div></body></html>`;
  return withHtmlFrame(html, page.w, async (doc) => {
    const src = doc.querySelector(".grown-flow-src") as HTMLElement;
    const host = doc.createElement("div");
    doc.body.appendChild(host);
    const pages: DomPage[] = [];
    const newPage = () => {
      const el = doc.createElement("div");
      el.className = "grown-flow-page";
      const body = doc.createElement("div");
      body.className = "grown-flow-body";
      el.appendChild(body);
      host.appendChild(el);
      pages.push({ el, w: page.w, h: page.h });
      return body;
    };
    let cur = newPage();
    for (const node of Array.from(src.childNodes)) {
      if (node.nodeType === 1 && (node as Element).matches(PAGE_BREAK)) {
        cur = newPage();
        continue;
      }
      cur.appendChild(node);
      if (cur.scrollHeight > innerH + 1 && cur.childNodes.length > 1) {
        cur = newPage();
        cur.appendChild(node);
      }
    }
    src.remove();
    return domPagesToPdfPages(host, pages, opts);
  });
}
