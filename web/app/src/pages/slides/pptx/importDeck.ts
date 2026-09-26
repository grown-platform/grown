// UI-facing pptx import helpers shared by the deck editor, the deck list and
// Drive's open flow. The reader is loaded lazily so jszip only ships when a
// file is actually imported.

import { createDeck, saveDeck } from "../api";
import type { Slide } from "../model";

export const PPTX_ACCEPT =
  ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Title for an imported deck: the file's own title, else the file name without extension. */
export function importTitle(fileName: string, docTitle?: string): string {
  const t = (docTitle || "").trim();
  if (t && !/^PowerPoint Presentation$/i.test(t)) return t;
  return fileName.replace(/\.pptx$/i, "").trim() || "Imported presentation";
}

/** Read slides from a .pptx blob. */
export async function readPptxSlides(
  data: Blob | ArrayBuffer,
): Promise<{ slides: Slide[]; title?: string; warnings: string[] }> {
  const { readPptx } = await import("./read");
  const r = await readPptx(data);
  return { slides: r.deck.slides, title: r.title, warnings: r.warnings };
}

/** Create a new Grown deck from a .pptx and return its id. */
export async function importPptxAsNewDeck(
  data: Blob | ArrayBuffer,
  fileName: string,
): Promise<{ id: string; warnings: string[] }> {
  const r = await readPptxSlides(data);
  const d = await createDeck(importTitle(fileName, r.title));
  await saveDeck(d.id, JSON.stringify({ slides: r.slides }));
  return { id: d.id, warnings: r.warnings };
}
