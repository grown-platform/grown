// Pure deck/slide/element operations used by DeckEditor. Every function here
// takes plain model values and returns new values (no React, no I/O), so the
// editor's behaviour can be unit-tested and shared by the collab receiver.

import { remapEffects } from "./animOps";
import {
  CANVAS_H,
  CANVAS_W,
  newSlide,
  uid,
  type DeckDoc,
  type Slide,
  type SlideElement,
  type TableData,
} from "./model";
import { elementBounds, selectionBounds, setElementBox, type Rect } from "./geometry";
import { reId } from "./groupOps";

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
  const id = makeId();
  const elements = slide.elements.map((e) => reId(e, makeId));
  const anims = remapEffects(
    slide.anims,
    new Map(slide.elements.map((e, i) => [e.id, elements[i].id])),
    makeId,
  );
  return {
    id,
    background: slide.background,
    elements,
    ...(anims ? { anims } : {}),
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
  return { ...doc, slides: doc.slides.map((s) => (s.id === slideId ? fn(s) : s)) };
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
  return moveElementBy(reId(el, makeId), DUPLICATE_OFFSET, DUPLICATE_OFFSET);
}

/** moveElementBy translates an element (and a group's members) by (dx, dy). */
export function moveElementBy(
  el: SlideElement,
  dx: number,
  dy: number,
): SlideElement {
  return setElementBox(el, { x: el.x + dx, y: el.y + dy, w: el.w, h: el.h });
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

// ---- multi-element ops (selection, arrange, align) ----

/** upsertElements replaces/appends several elements in one step. */
export function upsertElements(slide: Slide, els: readonly SlideElement[]): Slide {
  return els.reduce(upsertElement, slide);
}

/** removeElements drops every element in `ids` from the slide. */
export function removeElements(slide: Slide, ids: readonly string[]): Slide {
  const drop = new Set(ids);
  return { ...slide, elements: slide.elements.filter((e) => !drop.has(e.id)) };
}

/** reorderElements puts the slide's elements in the order of `ids` (z-order,
 *  last = top). Unknown ids are ignored and elements missing from `ids` keep
 *  their relative order on top, so a stale reorder never loses an element. */
export function reorderElements(slide: Slide, ids: readonly string[]): Slide {
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: SlideElement[] = [];
  for (const id of ids) {
    const e = byId.get(id);
    if (e && !seen.has(id)) {
      out.push(e);
      seen.add(id);
    }
  }
  for (const e of slide.elements) if (!seen.has(e.id)) out.push(e);
  return { ...slide, elements: out };
}

/** arrangeMany applies a z-order move to every element in `ids` at once,
 *  keeping the selected elements' relative order (PowerPoint semantics:
 *  "forward" moves each selected element above the next unselected one). */
export function arrangeMany(
  elements: SlideElement[],
  ids: readonly string[],
  dir: ArrangeDir,
): SlideElement[] {
  const sel = new Set(ids);
  if (dir === "front")
    return [...elements.filter((e) => !sel.has(e.id)), ...elements.filter((e) => sel.has(e.id))];
  if (dir === "back")
    return [...elements.filter((e) => sel.has(e.id)), ...elements.filter((e) => !sel.has(e.id))];
  const els = [...elements];
  if (dir === "forward") {
    for (let i = els.length - 2; i >= 0; i--)
      if (sel.has(els[i].id) && !sel.has(els[i + 1].id))
        [els[i], els[i + 1]] = [els[i + 1], els[i]];
  } else {
    for (let i = 1; i < els.length; i++)
      if (sel.has(els[i].id) && !sel.has(els[i - 1].id))
        [els[i - 1], els[i]] = [els[i], els[i - 1]];
  }
  return els;
}

/** moveElementsBy translates every element in `ids` by (dx, dy); locked
 *  elements stay put. Returns the moved elements only. */
export function moveElementsBy(
  elements: readonly SlideElement[],
  ids: readonly string[],
  dx: number,
  dy: number,
): SlideElement[] {
  const sel = new Set(ids);
  return elements
    .filter((e) => sel.has(e.id) && !e.locked)
    .map((e) => moveElementBy(e, dx, dy));
}

export type AlignHow = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type AlignTo = "slide" | "selection";

const SLIDE_BOX: Rect = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };

/** alignTarget picks the reference box: the slide, or the selection's union
 *  (the OnlyOffice/PowerPoint default is the slide for one object and the
 *  selection for several). */
export function alignTarget(els: readonly SlideElement[], to: AlignTo): Rect {
  if (to === "slide" || els.length < 2) return SLIDE_BOX;
  return selectionBounds([...els]) ?? SLIDE_BOX;
}

/** alignElements lines up the drawn bounds of `els` against `to` (see
 *  alignTarget) and returns the moved elements (locked ones are skipped). */
export function alignElements(
  els: readonly SlideElement[],
  how: AlignHow,
  to: AlignTo,
): SlideElement[] {
  const ref = alignTarget(els, to);
  return els
    .filter((e) => !e.locked)
    .map((e) => {
      const b = elementBounds(e);
      let dx = 0;
      let dy = 0;
      if (how === "left") dx = ref.x - b.x;
      else if (how === "center") dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
      else if (how === "right") dx = ref.x + ref.w - (b.x + b.w);
      else if (how === "top") dy = ref.y - b.y;
      else if (how === "middle") dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
      else dy = ref.y + ref.h - (b.y + b.h);
      return moveElementBy(e, dx, dy);
    });
}

/** centerOnPage centres the selection as a block on the slide horizontally
 *  or vertically (Arrange → Center on page), keeping relative positions. */
export function centerOnPage(
  els: readonly SlideElement[],
  axis: "horizontal" | "vertical",
): SlideElement[] {
  const b = selectionBounds([...els]);
  if (!b) return [];
  const dx = axis === "horizontal" ? CANVAS_W / 2 - (b.x + b.w / 2) : 0;
  const dy = axis === "vertical" ? CANVAS_H / 2 - (b.y + b.h / 2) : 0;
  return els.filter((e) => !e.locked).map((e) => moveElementBy(e, dx, dy));
}

/**
 * distributeElements spaces the elements evenly along one axis so the gaps
 * between neighbours' drawn bounds are equal. With `to: "selection"` the
 * outermost two stay put (needs 3+ elements); with `to: "slide"` the whole
 * slide width/height is the span (works for 2+). Returns moved elements.
 */
export function distributeElements(
  els: readonly SlideElement[],
  axis: "horizontal" | "vertical",
  to: AlignTo = "selection",
): SlideElement[] {
  const min = to === "slide" ? 1 : 3;
  if (els.length < min) return [];
  const h = axis === "horizontal";
  const items = els
    .map((e) => ({ e, b: elementBounds(e) }))
    .sort((a, b) => (h ? a.b.x - b.b.x : a.b.y - b.b.y) || 0);
  const pos = (b: Rect) => (h ? b.x : b.y);
  const size = (b: Rect) => (h ? b.w : b.h);
  const start = to === "slide" ? 0 : pos(items[0].b);
  const end =
    to === "slide"
      ? h
        ? CANVAS_W
        : CANVAS_H
      : pos(items[items.length - 1].b) + size(items[items.length - 1].b);
  const total = items.reduce((n, it) => n + size(it.b), 0);
  const gap = items.length > 1 ? (end - start - total) / (items.length - 1) : 0;
  let cursor = items.length === 1 ? start + (end - start - total) / 2 : start;
  const out: SlideElement[] = [];
  for (const it of items) {
    const d = Math.round((cursor - pos(it.b)) * 1e6) / 1e6;
    if (!it.e.locked) out.push(moveElementBy(it.e, h ? d : 0, h ? 0 : d));
    cursor += size(it.b) + gap;
  }
  return out;
}

/** cycleSelection is Tab / Shift+Tab: the next (or previous) element in
 *  z-order after the current selection, wrapping around. With nothing
 *  selected, Tab picks the bottom element and Shift+Tab the top one. */
export function cycleSelection(
  elements: readonly SlideElement[],
  selected: readonly string[],
  dir: 1 | -1,
): string | null {
  if (!elements.length) return null;
  const cur = selected.length ? selected[selected.length - 1] : null;
  const i = cur === null ? -1 : elements.findIndex((e) => e.id === cur);
  if (i < 0) return elements[dir === 1 ? 0 : elements.length - 1].id;
  return elements[(i + dir + elements.length) % elements.length].id;
}

/** setLocked locks or unlocks elements' position (Arrange → Lock). */
export function setLocked(els: readonly SlideElement[], locked: boolean): SlideElement[] {
  return els.map((e) => {
    const out = { ...e };
    if (locked) out.locked = true;
    else delete out.locked;
    return out;
  });
}

/** duplicateElements copies several elements (groups deeply) under new ids,
 *  offset down-right, in their z-order. */
export function duplicateElements(
  els: readonly SlideElement[],
  makeId: () => string = uid,
): SlideElement[] {
  return els.map((e) => duplicateElement(e, makeId));
}

// ---- collab ops ----

/** CollabOp is the wire format of the slides collab hub. The multi-element
 *  ops keep a selection edit to one message instead of a whole-deck
 *  `slides` replace, so peers editing other slides are not clobbered. */
export type CollabOp =
  | { t: "upsert"; si: string; el: SlideElement }
  | { t: "remove"; si: string; elId: string }
  | { t: "upsertMany"; si: string; els: SlideElement[] }
  | { t: "removeMany"; si: string; ids: string[] }
  | { t: "reorder"; si: string; ids: string[] }
  | { t: "setElements"; si: string; elements: SlideElement[] }
  | { t: "slides"; slides: Slide[] };

/** applyCollabOp applies a remote op to the local doc. Unknown or malformed
 *  ops return the doc unchanged. Every op is idempotent: applying it twice
 *  gives the same doc as applying it once. */
export function applyCollabOp(
  doc: DeckDoc,
  m: {
    t: string;
    si?: string;
    el?: SlideElement;
    elId?: string;
    els?: SlideElement[];
    ids?: string[];
    elements?: SlideElement[];
    slides?: Slide[];
    deck?: DeckDoc;
  },
): DeckDoc {
  if (m.t === "upsert" && m.si && m.el) {
    const el = m.el;
    return mapSlide(doc, m.si, (s) => upsertElement(s, el));
  }
  if (m.t === "remove" && m.si && m.elId) {
    const elId = m.elId;
    return mapSlide(doc, m.si, (s) => removeElement(s, elId));
  }
  if (m.t === "upsertMany" && m.si && Array.isArray(m.els)) {
    const els = m.els;
    return mapSlide(doc, m.si, (s) => upsertElements(s, els));
  }
  if (m.t === "removeMany" && m.si && Array.isArray(m.ids)) {
    const ids = m.ids;
    return mapSlide(doc, m.si, (s) => removeElements(s, ids));
  }
  if (m.t === "reorder" && m.si && Array.isArray(m.ids)) {
    const ids = m.ids;
    return mapSlide(doc, m.si, (s) => reorderElements(s, ids));
  }
  if (m.t === "setElements" && m.si && Array.isArray(m.elements)) {
    const elements = m.elements;
    return mapSlide(doc, m.si, (s) => ({ ...s, elements }));
  }
  // The slide list; deck-level props (theme, layouts, size, header &
  // footer) are kept.
  if (m.t === "slides" && m.slides) return { ...doc, slides: m.slides };
  // The whole deck (theme/size changes, undo): M7.
  if (m.t === "deck" && m.deck && Array.isArray(m.deck.slides)) return m.deck;
  return doc;
}
