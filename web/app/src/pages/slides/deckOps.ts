// Pure deck/slide/element operations used by DeckEditor. Every function here
// takes plain model values and returns new values (no React, no I/O), so the
// editor's behaviour can be unit-tested and shared by the collab receiver.

import {
  newSlide,
  uid,
  type DeckDoc,
  type Slide,
  type SlideElement,
  type TableData,
} from "./model";

/** Result of a slide-list operation: the new slide list and the slide index to show. */
export interface SlidesResult {
  slides: Slide[];
  cur: number;
}

// ---- slide list ops ----

/** insertSlideAfter inserts `slide` right after index `cur` and moves to it. */
export function insertSlideAfter(
  slides: Slide[],
  cur: number,
  slide: Slide,
): SlidesResult {
  return {
    slides: [...slides.slice(0, cur + 1), slide, ...slides.slice(cur + 1)],
    cur: cur + 1,
  };
}

/** addNextSlide inserts a blank slide after `cur` that inherits the current
 *  slide's background (Ctrl+M / New slide). */
export function addNextSlide(
  slides: Slide[],
  cur: number,
  make: (background: string) => Slide = newSlide,
): SlidesResult {
  const bg = slides[cur]?.background || "#ffffff";
  return insertSlideAfter(slides, cur, make(bg));
}

/** copySlide clones a slide's background and elements under fresh ids.
 *  (Notes and transition are intentionally not copied, matching the editor.) */
export function copySlide(slide: Slide, makeId: () => string = uid): Slide {
  return {
    id: makeId(),
    background: slide.background,
    elements: slide.elements.map((e) => ({ ...e, id: makeId() })),
  };
}

/** duplicateSlideAt inserts a copy of slide `cur` after it and moves to it.
 *  Returns null when there is no slide at `cur`. */
export function duplicateSlideAt(
  slides: Slide[],
  cur: number,
  makeId: () => string = uid,
): SlidesResult | null {
  const slide = slides[cur];
  if (!slide) return null;
  return insertSlideAfter(slides, cur, copySlide(slide, makeId));
}

/** deleteSlideAt removes slide `cur`. Deleting the only slide replaces it with
 *  a blank slide (a deck always has at least one slide). */
export function deleteSlideAt(
  slides: Slide[],
  cur: number,
  make: () => Slide = () => newSlide(),
): SlidesResult {
  if (slides.length <= 1) return { slides: [make()], cur: 0 };
  return {
    slides: slides.filter((_, i) => i !== cur),
    cur: Math.max(0, cur - 1),
  };
}

/** moveSlide moves the slide at `from` to index `to`. Returns null when `to`
 *  is out of range (the editor ignores the move). */
export function moveSlide(
  slides: Slide[],
  from: number,
  to: number,
): SlidesResult | null {
  if (to < 0 || to >= slides.length) return null;
  const next = [...slides];
  const [s] = next.splice(from, 1);
  next.splice(to, 0, s);
  return { slides: next, cur: to };
}

/** patchSlide shallow-merges `patch` into the slide with id `slideId`. */
export function patchSlide(
  slides: Slide[],
  slideId: string,
  patch: Partial<Omit<Slide, "id">>,
): Slide[] {
  return slides.map((s) => (s.id === slideId ? { ...s, ...patch } : s));
}

/** mapSlide replaces the slide with id `slideId` by `fn(slide)`. */
export function mapSlide(
  doc: DeckDoc,
  slideId: string,
  fn: (s: Slide) => Slide,
): DeckDoc {
  return { slides: doc.slides.map((s) => (s.id === slideId ? fn(s) : s)) };
}

// ---- element ops within a slide ----

/** upsertElement replaces the element with the same id, or appends it on top. */
export function upsertElement(slide: Slide, el: SlideElement): Slide {
  const exists = slide.elements.some((e) => e.id === el.id);
  return {
    ...slide,
    elements: exists
      ? slide.elements.map((e) => (e.id === el.id ? el : e))
      : [...slide.elements, el],
  };
}

/** removeElement drops the element with id `elId` from the slide. */
export function removeElement(slide: Slide, elId: string): Slide {
  return { ...slide, elements: slide.elements.filter((e) => e.id !== elId) };
}

export type ArrangeDir = "front" | "back" | "forward" | "backward";

/** arrangeElements reorders the z-order (array order; last = on top) of the
 *  element `id`. Returns null when the element is not on the slide. */
export function arrangeElements(
  elements: SlideElement[],
  id: string,
  dir: ArrangeDir,
): SlideElement[] | null {
  const els = [...elements];
  const i = els.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const [e] = els.splice(i, 1);
  if (dir === "front") els.push(e);
  else if (dir === "back") els.unshift(e);
  else if (dir === "forward") els.splice(Math.min(els.length, i + 1), 0, e);
  else els.splice(Math.max(0, i - 1), 0, e);
  return els;
}

export type RotateOp = "cw" | "ccw" | "flipH" | "flipV";

/** rotateElement rotates ±90° (normalised to [0, 360)) or toggles a flip. */
export function rotateElement(el: SlideElement, op: RotateOp): SlideElement {
  if (op === "flipH") return { ...el, flipH: !el.flipH };
  if (op === "flipV") return { ...el, flipV: !el.flipV };
  const delta = op === "cw" ? 90 : -90;
  const rot = ((((el.rotation || 0) + delta) % 360) + 360) % 360;
  return { ...el, rotation: rot };
}

/** Offset (logical px) applied to duplicated/pasted elements. */
export const DUPLICATE_OFFSET = 16;

/** duplicateElement copies an element under a new id, offset down-right. */
export function duplicateElement(
  el: SlideElement,
  makeId: () => string = uid,
): SlideElement {
  return {
    ...el,
    id: makeId(),
    x: el.x + DUPLICATE_OFFSET,
    y: el.y + DUPLICATE_OFFSET,
  };
}

/** moveElementBy translates an element by (dx, dy). */
export function moveElementBy(
  el: SlideElement,
  dx: number,
  dy: number,
): SlideElement {
  return { ...el, x: el.x + dx, y: el.y + dy };
}

export type StyleToggle = "bold" | "italic" | "underline" | "strike";

/** toggleStyle flips one of the boolean text-style flags. */
export function toggleStyle(el: SlideElement, attr: StyleToggle): SlideElement {
  return { ...el, [attr]: !el[attr] };
}

/** setList sets (or clears with null) the bullet/number list style. */
export function setList(
  el: SlideElement,
  v: "bullet" | "number" | null,
): SlideElement {
  return { ...el, list: v === null ? undefined : v };
}

/** setLink sets the element hyperlink from user input; blank removes it. */
export function setLink(el: SlideElement, input: string): SlideElement {
  const v = input.trim();
  return { ...el, url: v || undefined };
}

/** setTableCell returns a copy of the table with cell (r, c) set to `v`. */
export function setTableCell(
  t: TableData,
  r: number,
  c: number,
  v: string,
): TableData {
  const cells = t.cells.map((row) => [...row]);
  cells[r][c] = v;
  return { ...t, cells };
}

/** removeAnimation returns the element without its entrance animation. */
export function removeAnimation(el: SlideElement): SlideElement {
  const { animation: _removed, ...rest } = el;
  void _removed;
  return rest as SlideElement;
}

// ---- collab ops ----

/** CollabOp is the wire format of the slides collab hub. */
export type CollabOp =
  | { t: "upsert"; si: string; el: SlideElement }
  | { t: "remove"; si: string; elId: string }
  | { t: "slides"; slides: Slide[] };

/** applyCollabOp applies a remote op to the local doc. Unknown or malformed
 *  ops return the doc unchanged. */
export function applyCollabOp(
  doc: DeckDoc,
  m: { t: string; si?: string; el?: SlideElement; elId?: string; slides?: Slide[] },
): DeckDoc {
  if (m.t === "upsert" && m.si && m.el) {
    const el = m.el;
    return mapSlide(doc, m.si, (s) => upsertElement(s, el));
  }
  if (m.t === "remove" && m.si && m.elId) {
    const elId = m.elId;
    return mapSlide(doc, m.si, (s) => removeElement(s, elId));
  }
  if (m.t === "slides" && m.slides) return { slides: m.slides };
  return doc;
}
