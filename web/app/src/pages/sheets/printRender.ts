/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet sheets are loosely typed. */

// Renders a sheet's pages (printSettings.paginate) as an HTML document laid
// out with CSS paged media: @page size and margins, one block per page with
// a forced break after it, the page scale as CSS zoom, repeated title rows and
// columns, gridlines/headings, merged cells, borders and cell styles. The same
// document is the print preview (on screen each page is drawn as a sheet of
// paper) and what the browser prints.

import { colToLetters } from "./cellValue";
import { PAPER, pageSizePx, paginate, sheetGeometry, type PrintPage, type PrintSettings } from "./printSettings";
import { cellViewText } from "./sheetView";
import { flattenBorders, type BorderSide, type CellBorder } from "./xlsx/xlsxStyles";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const BORDER_CSS: Record<number, string> = {
  1: "1px solid",
  2: "1px solid",
  3: "1px dotted",
  4: "1px dashed",
  5: "1px dashed",
  6: "1px dotted",
  7: "3px double",
  8: "2px solid",
  9: "2px dashed",
  10: "2px dashed",
  11: "2px dotted",
  12: "2px dashed",
  13: "3px solid",
};

function borderCss(side: string, b: BorderSide | undefined): string {
  if (!b) return "";
  return `border-${side}:${BORDER_CSS[b.style] ?? "1px solid"} ${b.color || "#000"};`;
}

function cellCss(cell: any, border: CellBorder | undefined, align: string | null): string {
  let css = "";
  if (cell) {
    if (Number(cell.bl) === 1) css += "font-weight:bold;";
    if (Number(cell.it) === 1) css += "font-style:italic;";
    const deco = [Number(cell.un) === 1 ? "underline" : "", Number(cell.cl) === 1 ? "line-through" : ""].filter(Boolean).join(" ");
    if (deco) css += `text-decoration:${deco};`;
    if (cell.fc) css += `color:${cell.fc};`;
    if (cell.bg) css += `background:${cell.bg};`;
    if (Number(cell.fs) > 0) css += `font-size:${Number(cell.fs)}pt;`;
    if (typeof cell.ff === "string" && cell.ff) css += `font-family:'${cell.ff.replace(/'/g, "")}',sans-serif;`;
    if (String(cell.tb) === "2") css += "white-space:normal;word-wrap:break-word;";
    const vt = Number(cell.vt);
    css += vt === 1 ? "vertical-align:top;" : vt === 0 && cell.vt !== undefined && cell.vt !== "" ? "vertical-align:middle;" : "";
  }
  if (align) css += `text-align:${align};`;
  if (border) css += borderCss("left", border.l) + borderCss("right", border.r) + borderCss("top", border.t) + borderCss("bottom", border.b);
  return css;
}

/** Header/footer codes: &P page, &N pages, &D date, &T time, &A sheet, &F file; &L/&C/&R sections. */
export function headerFooterText(src: string, ctx: { page: number; pages: number; sheet: string; file: string; now?: Date }): { left: string; center: string; right: string } {
  const now = ctx.now ?? new Date();
  const sub = (s: string) =>
    s
      .replace(/&P/g, String(ctx.page))
      .replace(/&N/g, String(ctx.pages))
      .replace(/&D/g, now.toLocaleDateString())
      .replace(/&T/g, now.toLocaleTimeString())
      .replace(/&A/g, ctx.sheet)
      .replace(/&F/g, ctx.file)
      .replace(/&&/g, "&");
  if (!/&[LCR]/.test(src)) return { left: "", center: sub(src), right: "" };
  const out = { left: "", center: "", right: "" };
  let cur: "left" | "center" | "right" = "center";
  for (const part of src.split(/(&[LCR])/)) {
    if (part === "&L") cur = "left";
    else if (part === "&C") cur = "center";
    else if (part === "&R") cur = "right";
    else out[cur] += sub(part);
  }
  return out;
}

function cellMap(sheet: any): Map<string, any> {
  const m = new Map<string, any>();
  if (Array.isArray(sheet?.data)) {
    sheet.data.forEach((row: any[], r: number) =>
      row?.forEach?.((cell: any, c: number) => {
        if (cell) m.set(`${r}_${c}`, cell);
      }),
    );
  } else {
    for (const cd of Array.isArray(sheet?.celldata) ? sheet.celldata : []) if (cd?.v) m.set(`${cd.r}_${cd.c}`, cd.v);
  }
  return m;
}

function seq(a: number, b: number, hidden?: (i: number) => boolean): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) if (!hidden?.(i)) out.push(i);
  return out;
}

export interface RenderOptions {
  title?: string;
  showFormulas?: boolean;
  /** Only these pages (1-based); all when omitted. */
  pages?: number[];
  now?: Date;
}

function renderPage(sheet: any, s: PrintSettings, page: PrintPage, total: number, cells: Map<string, any>, borders: Map<string, CellBorder>, opts: RenderOptions): string {
  const geo = sheetGeometry(sheet);
  const rows = [
    ...(page.titleRows ? seq(page.titleRows[0], page.titleRows[1], geo.rowHidden) : []),
    ...seq(page.range.r1, page.range.r2, geo.rowHidden),
  ];
  const cols = [
    ...(page.titleCols ? seq(page.titleCols[0], page.titleCols[1], geo.colHidden) : []),
    ...seq(page.range.c1, page.range.c2, geo.colHidden),
  ];
  const rowPos = new Map(rows.map((r, i) => [r, i]));
  const colPos = new Map(cols.map((c, i) => [c, i]));
  const covered = new Set<string>();
  const showFormulas = !!opts.showFormulas;
  let html = `<table class="${s.gridLines ? "grid" : ""}"><colgroup>`;
  if (s.headings) html += '<col style="width:32px">';
  for (const c of cols) html += `<col style="width:${geo.colWidth(c) * (showFormulas ? 2 : 1)}px">`;
  html += "</colgroup>";
  if (s.headings) {
    html += '<tr><td class="hd"></td>' + cols.map((c) => `<td class="hd">${colToLetters(c)}</td>`).join("") + "</tr>";
  }
  for (const r of rows) {
    html += `<tr style="height:${geo.rowHeight(r)}px">`;
    if (s.headings) html += `<td class="hd">${r + 1}</td>`;
    for (const c of cols) {
      const key = `${r}_${c}`;
      if (covered.has(key)) continue;
      const cell = cells.get(key);
      let span = "";
      const mc = cell?.mc;
      if (mc && mc.rs && (mc.rs > 1 || mc.cs > 1)) {
        // Span the merge over the rows/columns of this page that follow in order.
        let rs = 1;
        while (rs < mc.rs && rowPos.get(r + rs) === (rowPos.get(r) ?? 0) + rs) rs++;
        let cs = 1;
        while (cs < mc.cs && colPos.get(c + cs) === (colPos.get(c) ?? 0) + cs) cs++;
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) if (i || j) covered.add(`${r + i}_${c + j}`);
        if (rs > 1) span += ` rowspan="${rs}"`;
        if (cs > 1) span += ` colspan="${cs}"`;
      }
      const shown = mc && !mc.rs ? { text: "", align: null } : cellViewText(cell, { showFormulas });
      const numeric = typeof cell?.v === "number" && !showFormulas;
      const align = shown.align ?? (numeric ? "right" : null);
      const css = cellCss(cell, borders.get(key), align);
      html += `<td${span}${css ? ` style="${esc(css)}"` : ""}>${esc(shown.text)}</td>`;
    }
    html += "</tr>";
  }
  html += "</table>";
  const hf = (src: string, cls: string) => {
    if (!src) return "";
    const t = headerFooterText(src, { page: page.number, pages: total, sheet: String(sheet?.name ?? ""), file: opts.title ?? "", now: opts.now });
    return `<div class="${cls}"><span>${esc(t.left)}</span><span>${esc(t.center)}</span><span>${esc(t.right)}</span></div>`;
  };
  const body = `<div class="content${s.hCenter ? " hc" : ""}${s.vCenter ? " vc" : ""}"><div style="zoom:${page.scale}">${html}</div></div>`;
  return `<section class="page" data-page="${page.number}">${hf(s.header, "hdr")}${body}${hf(s.footer, "ftr")}</section>`;
}

/** The printable HTML document of one sheet. */
export function renderPrintHtml(sheet: any, s: PrintSettings, opts: RenderOptions = {}): { html: string; pages: number } {
  const geo = sheetGeometry(sheet);
  const pagination = paginate(opts.showFormulas ? { ...geo, colWidth: (c) => geo.colWidth(c) * 2 } : geo, s);
  const cells = cellMap(sheet);
  const borders = flattenBorders(sheet?.config?.borderInfo);
  const page = pageSizePx(s);
  const m = s.margins;
  const paper = PAPER[s.paper] ?? PAPER.letter;
  const wanted = opts.pages ? new Set(opts.pages) : null;
  const sections = pagination.pages
    .filter((p) => !wanted || wanted.has(p.number))
    .map((p) => renderPage(sheet, s, p, pagination.pages.length, cells, borders, opts))
    .join("");
  const innerH = page.h - (m.top + m.bottom) * 96;
  const css = `
@page { size: ${s.orientation === "landscape" ? `${paper.h}mm ${paper.w}mm` : `${paper.w}mm ${paper.h}mm`}; }
html, body { margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; break-after: page; page-break-after: always; box-sizing: border-box; }
.page:last-child { break-after: auto; page-break-after: auto; }
.content { height: ${innerH.toFixed(1)}px; overflow: hidden; }
.content.hc > div { margin: 0 auto; width: fit-content; }
.content.vc { display: flex; flex-direction: column; justify-content: center; }
table { border-collapse: collapse; table-layout: fixed; }
td { overflow: hidden; white-space: nowrap; padding: 0 3px; vertical-align: bottom; line-height: 1.2; }
table.grid td { outline: 1px solid #c8c8c8; outline-offset: -1px; }
td.hd { background: #f1f3f4; color: #5f6368; text-align: center; outline: 1px solid #c8c8c8; outline-offset: -1px; font-size: 8pt; }
.hdr, .ftr { position: absolute; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 9pt; color: #333; }
.hdr { top: -${(m.top - m.header).toFixed(2)}in; }
.ftr { bottom: -${(m.bottom - m.footer).toFixed(2)}in; }
.hdr span, .ftr span { flex: 1; }
.hdr span:nth-child(2), .ftr span:nth-child(2) { text-align: center; }
.hdr span:nth-child(3), .ftr span:nth-child(3) { text-align: right; }
@media screen {
  body { background: #e8eaed; padding: 16px 0; }
  .page { width: ${page.w.toFixed(1)}px; height: ${page.h.toFixed(1)}px; margin: 0 auto 16px; background: #fff; padding: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
  .hdr { top: ${(m.header).toFixed(2)}in; left: ${m.left}in; right: ${m.right}in; }
  .ftr { bottom: ${(m.footer).toFixed(2)}in; left: ${m.left}in; right: ${m.right}in; }
}
@media print { .hdr, .ftr { left: 0; right: 0; } }
`;
  const title = esc(opts.title ?? String(sheet?.name ?? "Sheet"));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${sections || '<section class="page"><div class="content"></div></section>'}</body></html>`;
  return { html, pages: pagination.pages.length };
}

/** Prints the HTML through a hidden iframe (the browser's print dialog). */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.onload = () => {
      const w = frame.contentWindow;
      const done = () => {
        setTimeout(() => frame.remove(), 1000);
        resolve();
      };
      if (!w) return done();
      w.addEventListener("afterprint", done, { once: true });
      w.focus();
      w.print();
      // Some browsers never fire afterprint for a blocked dialog.
      setTimeout(done, 60000);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
