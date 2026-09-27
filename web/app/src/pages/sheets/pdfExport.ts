/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet sheets are loosely typed. */

// Sheets ▸ Download ▸ PDF, built in the browser from the print layout (M11):
// each sheet's stored page setup (paper, orientation, margins, print area,
// scale / fit to N×M pages, gridlines, headings, repeated title rows and
// columns, manual breaks, centring, header/footer) is paginated and rendered
// by printRender.ts — the same pages print preview shows — and every page is
// drawn into the PDF by lib/pdf/domPdf.ts under a searchable text layer.

import { buildPdf, type PdfPage } from "../../lib/pdf/pdfWriter";
import { domPagesToPdfPages, withHtmlFrame, type DomPage } from "../../lib/pdf/domPdf";
import { pageSizePx, sheetPrintSettings, type PrintSettings } from "./printSettings";
import { renderPrintHtml, type RenderOptions } from "./printRender";

export interface SheetPdfJob {
  sheet: any;
  /** Page setup; the sheet's stored settings when omitted. */
  settings?: PrintSettings;
}

// On screen the print document draws pages as grey-framed sheets of paper;
// for the PDF each page is just the paper.
const FLAT = `@media screen { body { background: #fff !important; padding: 0 !important; } .page { margin: 0 !important; box-shadow: none !important; } }`;

/** sheetPagesToPdfPages renders one sheet's print pages. */
export async function sheetPagesToPdfPages(sheet: any, settings: PrintSettings, opts: RenderOptions = {}): Promise<PdfPage[]> {
  const { html, pages } = renderPrintHtml(sheet, settings, opts);
  if (!pages) return [];
  const size = pageSizePx(settings);
  const doc = html.replace("</head>", `<style>${FLAT}</style></head>`);
  return withHtmlFrame(doc, size.w, async (d) => {
    const host = d.body;
    const els = Array.from(d.querySelectorAll<HTMLElement>("section.page"));
    const list: DomPage[] = els.map((el) => ({ el, w: size.w, h: size.h }));
    return domPagesToPdfPages(host, list, { printMedia: false });
  });
}

/** sheetsToPdf renders the sheets' print pages, in order, as one PDF. */
export async function sheetsToPdf(jobs: readonly SheetPdfJob[], title: string, opts: Omit<RenderOptions, "title"> = {}): Promise<Uint8Array> {
  const out: PdfPage[] = [];
  for (const job of jobs) {
    const settings = job.settings ?? sheetPrintSettings(job.sheet);
    out.push(...(await sheetPagesToPdfPages(job.sheet, settings, { ...opts, title })));
  }
  if (!out.length) {
    // An empty workbook still downloads as one blank page.
    const size = pageSizePx(jobs[0]?.settings ?? sheetPrintSettings(jobs[0]?.sheet));
    out.push({ w: size.w * 0.75, h: size.h * 0.75 });
  }
  return buildPdf(out, { title: title || "Spreadsheet", producer: "Grown Sheets" });
}
