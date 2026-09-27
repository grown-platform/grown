// UI-facing pptx (and ODP) import helpers shared by the deck editor, the deck
// list and Drive's open flow. The readers are loaded lazily so jszip only
// ships when a file is actually imported.

import { createDeck, saveDeck, uploadDeckAsset } from "../api";
import { externalizeImages } from "../assets";
import type { DeckDoc, Slide } from "../model";
import { deckSize, resizeDeck } from "../slideProps";
import { layoutsOf } from "../layouts";

export const PPTX_ACCEPT =
  ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  ".odp,application/vnd.oasis.opendocument.presentation";

/** Title for an imported deck: the file's own title, else the file name without extension. */
export function importTitle(fileName: string, docTitle?: string): string {
  const t = (docTitle || "").trim();
  if (t && !/^PowerPoint Presentation$/i.test(t)) return t;
  return fileName.replace(/\.(pptx|odp)$/i, "").trim() || "Imported presentation";
}

function blobBytes(b: Blob): Promise<Uint8Array> {
  if (typeof b.arrayBuffer === "function") return b.arrayBuffer().then((a) => new Uint8Array(a));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });
}

/** Read slides (and the whole deck: theme, layouts, size) from a .pptx or
 *  .odp blob (told apart by the ODF package's mimetype entry). */
export async function readPptxSlides(
  data: Blob | ArrayBuffer,
): Promise<{ slides: Slide[]; deck: DeckDoc; title?: string; warnings: string[] }> {
  const bytes = data instanceof Blob ? await blobBytes(data) : new Uint8Array(data);
  const odp = await import("../odp/read");
  if (odp.isOdp(bytes)) {
    const r = await odp.readOdp(bytes);
    return { slides: r.deck.slides, deck: r.deck, title: r.title, warnings: r.warnings };
  }
  const { readPptx } = await import("./read");
  const r = await readPptx(bytes);
  return { slides: r.deck.slides, deck: r.deck, title: r.title, warnings: r.warnings };
}

/**
 * Slides of an imported deck made ready to append to `into` (File ▸ Import
 * slides): scaled to its slide size, and pointing only at layouts it has
 * (by id); their own look (colours, fonts) is kept as it is.
 */
export function slidesForDeck(imported: DeckDoc, into: DeckDoc): Slide[] {
  const target = deckSize(into);
  const src = deckSize(imported);
  const fitted = src.h === target.h ? imported : resizeDeck(imported, target);
  const ids = new Set(layoutsOf(into).map((l) => l.id));
  return fitted.slides.map((s) => {
    if (!s.layout || ids.has(s.layout)) return s;
    const o = { ...s };
    delete o.layout;
    return o;
  });
}

/** Create a new Grown deck from a .pptx and return its id. */
export async function importPptxAsNewDeck(
  data: Blob | ArrayBuffer,
  fileName: string,
): Promise<{ id: string; warnings: string[] }> {
  const r = await readPptxSlides(data);
  const d = await createDeck(importTitle(fileName, r.title));
  // Pictures go to the deck's asset store (inline when that isn't available).
  const up = (b: Blob) => uploadDeckAsset(d.id, b);
  const slides = await externalizeImages(r.slides, up);
  const layouts = r.deck.layouts ? await externalizeImages(r.deck.layouts, up) : undefined;
  const deck: DeckDoc = { ...r.deck, slides, ...(layouts ? { layouts } : {}) };
  await saveDeck(d.id, JSON.stringify(deck));
  return { id: d.id, warnings: r.warnings };
}
