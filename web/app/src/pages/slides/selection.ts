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
