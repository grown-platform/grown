// PDF file and print window for a deck (M12). Pages come from
// printLayout.ts and are drawn by printRender.ts; the PDF rasterizes each
// page (2 px per point) under an invisible text layer, the print window
// keeps the pages as inline SVG so the browser prints vectors.

import { CANVAS_H, CANVAS_W, type DeckDoc } from "./model";
import { prepareDeck, svgToImage } from "./export";
import { buildPdf, type PdfPage } from "../../lib/pdf/pdfWriter";
import { DEFAULT_PRINT, printedSlides, printPages, type PrintOptions, type PrintPage } from "./printLayout";
import { printDocument, renderPage, slideSvgCache, type RenderedPage } from "./printRender";

/** Raster resolution of PDF pages, pixels per point (144 dpi). */
export const PDF_SCALE = 2;

export interface PrintJob {
  pages: PrintPage[];
  rendered: RenderedPage[];
}

/** printJob prepares the deck and draws every page of `opts`. */
export async function printJob(deck: DeckDoc, title: string, opts: Partial<PrintOptions>, cur = 0): Promise<PrintJob> {
  const o = { ...DEFAULT_PRINT, ...opts };
  const prepared = await prepareDeck(deck);
  const indices = printedSlides(prepared.slides, o, cur);
  const pages = printPages(prepared.slides, indices, o, CANVAS_H / CANVAS_W, title);
  const svgOf = slideSvgCache(prepared.slides);
  return { pages, rendered: pages.map((p) => renderPage(p, prepared.slides, o, svgOf)) };
}

/** deckToPdf builds the PDF file for a print layout. */
export async function deckToPdf(deck: DeckDoc, title: string, opts: Partial<PrintOptions> = {}, cur = 0): Promise<Uint8Array> {
  const { pages, rendered } = await printJob(deck, title, opts, cur);
  const out: PdfPage[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const blob = await svgToImage(rendered[i].svg, "image/jpeg", { w: p.w * PDF_SCALE, h: p.h * PDF_SCALE }, 0.9);
    const data = new Uint8Array(await blob.arrayBuffer());
    out.push({ w: p.w, h: p.h, image: { data, width: Math.round(p.w * PDF_SCALE), height: Math.round(p.h * PDF_SCALE) }, ...rendered[i].pdf });
  }
  return buildPdf(out, { title: title || "Presentation" });
}

/** printDeck opens the print window for a print layout and prints it. */
export async function printDeck(deck: DeckDoc, title: string, opts: Partial<PrintOptions> = {}, cur = 0, win?: Window | null): Promise<boolean> {
  // Open the window first (inside the click), then fill it.
  const w = win ?? window.open("", "_blank");
  if (!w) return false;
  const { pages, rendered } = await printJob(deck, title, opts, cur);
  const size = pages[0] ?? { w: 612, h: 792 };
  w.document.open();
  w.document.write(printDocument(rendered, size, title || "Presentation"));
  w.document.close();
  w.focus();
  window.setTimeout(() => w.print(), 400);
  return true;
}
