// Structural diff of two decks (M10), keyed the way collab ops are: deck
// fields, the slide list, per-slide properties, and per-slide element lists
// (elements compared whole). Two uses:
//
//  - diffOps(a, b): the finest collab ops that turn `a` into `b`, so a
//    whole-deck `slides`/`deck` change (notes, background, undo) goes on the
//    wire as element/slide-property ops that cannot clobber a collaborator's
//    edit elsewhere in the deck.
//  - carryChanges(a, b, target, strict): the changes a→b replayed onto
//    `target`. Strict mode only touches keys where `target` still holds a's
//    value, so undo (carry after→before onto the live deck) reverts your own
//    edits and leaves anything a collaborator changed since.
//
// Comments are not part of either: they have their own ops (comments.ts) and
// are not undone.

import type { DeckDoc, Slide, SlideElement } from "./model";

export type WireOp = { t: string } & Record<string, unknown>;

/** Deck fields that are not diffed as deck properties. */
const DECK_SKIP = new Set(["slides", "comments"]);
/** Slide fields that are not slide properties. */
const SLIDE_SKIP = new Set(["id", "elements"]);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bb[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

function keysOf(...objs: object[]): string[] {
  const s = new Set<string>();
  for (const o of objs) for (const k of Object.keys(o)) s.add(k);
  return [...s];
}

const rec = (o: object) => o as Record<string, unknown>;

/** Props of a slide that differ between a and b, as a patch (null = unset). */
export function slidePatch(a: Slide, b: Slide): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  let any = false;
  for (const k of keysOf(a, b)) {
    if (SLIDE_SKIP.has(k)) continue;
    if (!deepEqual(rec(a)[k], rec(b)[k])) {
      patch[k] = rec(b)[k] === undefined ? null : rec(b)[k];
      any = true;
    }
  }
  return any ? patch : null;
}

/** applySlidePatch sets (or, for null, removes) slide props. */
export function applySlidePatch(s: Slide, patch: Record<string, unknown>): Slide {
  const out: Record<string, unknown> = { ...s };
  for (const [k, v] of Object.entries(patch)) {
    if (SLIDE_SKIP.has(k)) continue;
    if (v === null || v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as unknown as Slide;
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

/** The element-list ops turning slide a's elements into b's. */
function elementOps(si: string, a: SlideElement[], b: SlideElement[]): WireOp[] {
  const am = new Map(a.map((e) => [e.id, e]));
  const bm = new Map(b.map((e) => [e.id, e]));
  const removed = a.filter((e) => !bm.has(e.id)).map((e) => e.id);
  const changed = b.filter((e) => !deepEqual(am.get(e.id), e));
  // The order upsert/remove would leave: survivors in a's order, then the
  // new elements appended in b's order.
  const implied = [
    ...a.filter((e) => bm.has(e.id)).map((e) => e.id),
    ...b.filter((e) => !am.has(e.id)).map((e) => e.id),
  ];
  if (!deepEqual(implied, ids(b))) return [{ t: "setElements", si, elements: b }];
  const out: WireOp[] = [];
  if (removed.length) out.push({ t: "removeMany", si, ids: removed });
  if (changed.length === 1) out.push({ t: "upsert", si, el: changed[0] });
  else if (changed.length) out.push({ t: "upsertMany", si, els: changed });
  return out;
}

/** diffOps returns the collab ops that turn deck a into deck b. A changed
 *  deck property (theme, size, …) gives one `deck` op; a changed slide list
 *  (added, removed or moved slides) one `slides` op; otherwise per-slide
 *  `slideProps` and element ops. */
export function diffOps(a: DeckDoc, b: DeckDoc): WireOp[] {
  for (const k of keysOf(a, b)) {
    if (DECK_SKIP.has(k)) continue;
    if (!deepEqual(rec(a)[k], rec(b)[k])) return [{ t: "deck", deck: b }];
  }
  if (!deepEqual(ids(a.slides), ids(b.slides))) return [{ t: "slides", slides: b.slides }];
  const out: WireOp[] = [];
  b.slides.forEach((sb, i) => {
    const sa = a.slides[i];
    if (sa === sb) return;
    const patch = slidePatch(sa, sb);
    if (patch) out.push({ t: "slideProps", si: sb.id, patch });
    if (sa.elements !== sb.elements) out.push(...elementOps(sb.id, sa.elements, sb.elements));
  });
  return out;
}

// ---- carry ----

/** Put the ids common to a and b and present in `list` into b's relative
 *  order, keeping every other entry where it is (slot-preserving). */
function reorderSlots<T extends { id: string }>(
  list: T[],
  a: string[],
  b: string[],
  strict: boolean,
): T[] {
  const inA = new Set(a);
  const inB = new Set(b);
  const inL = new Set(ids(list));
  const common = (xs: string[]) => xs.filter((x) => inA.has(x) && inB.has(x) && inL.has(x));
  const ca = common(a);
  const cb = common(b);
  if (deepEqual(ca, cb)) return list;
  const cl = common(ids(list));
  if (strict && !deepEqual(cl, ca)) return list;
  const byId = new Map(list.map((x) => [x.id, x]));
  const slot = new Set(cl);
  let k = 0;
  return list.map((x) => (slot.has(x.id) ? byId.get(cb[k++])! : x));
}

/** Insert `item` into `list` after its predecessor in `order` (the nearest
 *  earlier id present in `list`), else first. */
function insertAfterPred<T extends { id: string }>(list: T[], item: T, order: string[]): T[] {
  const at = order.indexOf(item.id);
  const have = new Set(ids(list));
  for (let i = at - 1; i >= 0; i--) {
    if (have.has(order[i])) {
      const j = list.findIndex((x) => x.id === order[i]);
      return [...list.slice(0, j + 1), item, ...list.slice(j + 1)];
    }
  }
  return [item, ...list];
}

/** Carry a keyed list's changes a→b onto target. */
function carryList<T extends { id: string }>(
  a: T[],
  b: T[],
  target: T[],
  strict: boolean,
  carryItem: (x: T, y: T, t: T) => T,
): T[] {
  const am = new Map(a.map((x) => [x.id, x]));
  const bm = new Map(b.map((x) => [x.id, x]));
  let out = target;
  // Removed a→b.
  for (const x of a) {
    if (bm.has(x.id)) continue;
    const t = out.find((y) => y.id === x.id);
    if (t && (!strict || deepEqual(t, x))) out = out.filter((y) => y.id !== x.id);
  }
  // Changed a→b.
  let changed = false;
  const mapped = out.map((t) => {
    const x = am.get(t.id);
    const y = bm.get(t.id);
    const n = x && y && x !== y ? carryItem(x, y, t) : t;
    if (n !== t) changed = true;
    return n;
  });
  if (changed) out = mapped;
  // Order of the survivors.
  out = reorderSlots(out, ids(a), ids(b), strict);
  // Added a→b.
  for (const y of b) {
    if (am.has(y.id) || out.some((t) => t.id === y.id)) continue;
    out = insertAfterPred(out, y, ids(b));
  }
  return out;
}

function carryProps<T extends object>(a: T, b: T, target: T, skip: Set<string>, strict: boolean): T {
  let out: Record<string, unknown> | null = null;
  for (const k of keysOf(a, b)) {
    if (skip.has(k)) continue;
    const va = rec(a)[k];
    const vb = rec(b)[k];
    if (deepEqual(va, vb)) continue;
    if (strict && !deepEqual(rec(target)[k], va)) continue;
    out ??= { ...target };
    if (vb === undefined) delete out[k];
    else out[k] = vb;
  }
  return (out as T | null) ?? target;
}

/** carryChanges replays the changes a→b onto target: deck properties, the
 *  slide list (added/removed/moved), slide properties and elements (added,
 *  removed, changed, z-order). With `strict`, only where target still holds
 *  a's value; a slide or element someone else changed is left alone. */
export function carryChanges(a: DeckDoc, b: DeckDoc, target: DeckDoc, strict: boolean): DeckDoc {
  if (a === b) return target;
  let out = carryProps(a, b, target, DECK_SKIP, strict);
  const carrySlide = (x: Slide, y: Slide, t: Slide): Slide => {
    let s = carryProps(x, y, t, SLIDE_SKIP, strict);
    if (x.elements !== y.elements) {
      const els = carryList(x.elements, y.elements, s.elements, strict, (ex, ey, et) =>
        !strict || deepEqual(et, ex) ? ey : et,
      );
      if (els !== s.elements) s = { ...s, elements: els };
    }
    return s;
  };
  const slides = carryList(a.slides, b.slides, out.slides, strict, carrySlide);
  if (slides !== out.slides) out = { ...out, slides };
  return out;
}
