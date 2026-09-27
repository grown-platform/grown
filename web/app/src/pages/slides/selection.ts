// Pure element-selection helpers. The editor has a single selection
// (`selId`, the selected element id or null).

import type { Slide, SlideElement } from "./model";

/** selectedElement resolves the selected id against the current slide.
 *  A stale id (element removed or on another slide) resolves to undefined. */
export function selectedElement(
  slide: Slide | undefined,
  selId: string | null,
): SlideElement | undefined {
  if (!slide || selId === null) return undefined;
  return slide.elements.find((e) => e.id === selId);
}

/** selectionAfterRemove clears the selection if the removed element was selected. */
export function selectionAfterRemove(
  selId: string | null,
  removedId: string,
): string | null {
  return selId === removedId ? null : selId;
}

/** isSelected reports whether element `id` is the selection. */
export function isSelected(selId: string | null, id: string): boolean {
  return selId !== null && selId === id;
}

// ---- multi-selection (a list of top-level element ids; the last one is the
// primary selection the toolbar reflects) ----

/** selectedElements resolves selected ids against the slide, in z-order.
 *  Stale ids are dropped. */
export function selectedElements(
  slide: Slide | undefined,
  ids: readonly string[],
): SlideElement[] {
  if (!slide || !ids.length) return [];
  const want = new Set(ids);
  return slide.elements.filter((e) => want.has(e.id));
}

/** primaryId is the most recently added id (the toolbar's element), or null. */
export function primaryId(ids: readonly string[]): string | null {
  return ids.length ? ids[ids.length - 1] : null;
}

/** clickSelect is the selection after clicking element `id`. A plain click
 *  selects only it, unless it is already selected (so a drag moves the whole
 *  selection); Shift/Ctrl/Cmd+click toggles it in the selection. */
export function clickSelect(
  ids: readonly string[],
  id: string,
  additive: boolean,
): string[] {
  if (additive)
    return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  return ids.includes(id) ? [...ids.filter((x) => x !== id), id] : [id];
}

/** selectAll is Ctrl/Cmd+A on the canvas: every element on the slide. */
export function selectAll(slide: Slide | undefined): string[] {
  return slide ? slide.elements.map((e) => e.id) : [];
}

/** marqueeMerge combines a marquee's hits with the prior selection: replace,
 *  or (Shift/Ctrl held) add. */
export function marqueeMerge(
  prior: readonly string[],
  hits: readonly string[],
  additive: boolean,
): string[] {
  if (!additive) return [...hits];
  return [...prior, ...hits.filter((h) => !prior.includes(h))];
}

/** pruneSelection drops ids no longer on the slide (after a remote edit,
 *  undo, or removal). Returns the same array when nothing changed. */
export function pruneSelection(slide: Slide | undefined, ids: string[]): string[] {
  if (!slide) return ids.length ? [] : ids;
  const have = new Set(slide.elements.map((e) => e.id));
  return ids.every((i) => have.has(i)) ? ids : ids.filter((i) => have.has(i));
}
