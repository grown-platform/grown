// The shared font bundle in Sheets (CC7): fortune-sheet's font menu gets
// the same list as Docs and Slides, and the fonts a workbook uses are
// loaded before the canvas grid draws them (a canvas doesn't trigger
// @font-face downloads the way DOM text does).
import { locale } from "@fortune-sheet/core";
import { PICKER_FONTS, loadFonts } from "../../lib/fonts";

let extended = false;

/** extendSheetFonts appends the shared fonts to fortune-sheet's menus
 *  (appending keeps its numeric `ff` indexes stable). */
export function extendSheetFonts() {
  if (extended) return;
  extended = true;
  for (const lang of ["en", "zh", "es", "zh-TW", "hi", "ru"]) {
    const l = locale({ lang } as never) as { fontarray?: string[] };
    if (!l.fontarray) continue;
    for (const f of PICKER_FONTS) if (!l.fontarray.includes(f)) l.fontarray.push(f);
  }
}

/** The font names cells use. */
export function usedFonts(sheets: { celldata?: { v?: { ff?: unknown } | null }[] }[] | null): string[] {
  const out = new Set<string>();
  for (const s of sheets ?? []) for (const c of s.celldata ?? []) if (typeof c.v?.ff === "string") out.add(c.v.ff);
  return [...out];
}

/** loadSheetFonts loads the used fonts, then nudges the grid to redraw. */
export async function loadSheetFonts(sheets: Parameters<typeof usedFonts>[0]) {
  const fonts = usedFonts(sheets);
  if (!fonts.length) return;
  await loadFonts(fonts);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("resize"));
}
