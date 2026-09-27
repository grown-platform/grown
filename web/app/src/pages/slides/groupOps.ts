// Pure group/ungroup operations on a slide's element list.
//
// Model: a group is an element of type "group" whose `children` hold the
// member elements (bottom to top). Children keep absolute slide coordinates
// as if the group were upright and unflipped; the group's box is the frame
// they scale with, and its rotation/flip turns the whole set about the
// group's centre. This is the pptx `p:grpSp` model with chOff = off and
// chExt = ext, so groups round-trip without coordinate conversion.

import { uid, type SlideElement } from "./model";
import { rotatePoint, selectionBounds, setElementBox } from "./geometry";

export function isGroup(el: SlideElement | undefined): boolean {
  return !!el && el.type === "group";
}

function normDeg(d: number | undefined): number {
  return (((d || 0) % 360) + 360) % 360;
}

/** reId copies an element (and, for a group, every descendant) under fresh ids. */
export function reId(el: SlideElement, makeId: () => string = uid): SlideElement {
  const out: SlideElement = { ...el, id: makeId() };
  if (el.children) out.children = el.children.map((c) => reId(c, makeId));
  return out;
}

/** groupElements wraps the top-level elements `ids` (at least two) into a new
 *  group. Members keep their z-order inside the group, and the group takes the
 *  z-position of its topmost member. Returns null when fewer than two of the
 *  ids are on the slide. */
export function groupElements(
  elements: SlideElement[],
  ids: readonly string[],
  makeId: () => string = uid,
): { elements: SlideElement[]; groupId: string } | null {
  const want = new Set(ids);
  const members = elements.filter((e) => want.has(e.id));
  if (members.length < 2) return null;
  const box = selectionBounds(members)!;
  const group: SlideElement = {
    id: makeId(),
    type: "group",
    ...box,
    children: members,
  };
  let top = -1;
  elements.forEach((e, i) => {
    if (want.has(e.id)) top = i;
  });
  const out: SlideElement[] = [];
  elements.forEach((e, i) => {
    if (!want.has(e.id)) out.push(e);
    else if (i === top) out.push(group);
  });
  return { elements: out, groupId: group.id };
}

/**
 * bakeChild returns a group member as it appears on the slide, with the
 * group's rotation and flips folded into the member's own position,
 * rotation and flips. Rendering applies flip then rotation (CSS
 * `rotate(θ) scale(±1, ±1)`), so a member at rotation φ ends up at
 * θ + det(F)·φ with its flips XOR-ed with the group's.
 */
export function bakeChild(child: SlideElement, group: SlideElement): SlideElement {
  const rot = normDeg(group.rotation);
  const fh = !!group.flipH;
  const fv = !!group.flipV;
  if (!rot && !fh && !fv) return child;
  const gcx = group.x + group.w / 2;
  const gcy = group.y + group.h / 2;
  let dx = child.x + child.w / 2 - gcx;
  let dy = child.y + child.h / 2 - gcy;
  if (fh) dx = -dx;
  if (fv) dy = -dy;
  const p = rotatePoint(gcx + dx, gcy + dy, gcx, gcy, rot);
  const det = (fh ? -1 : 1) * (fv ? -1 : 1);
  const out = setElementBox(child, {
    x: Math.round((p.x - child.w / 2) * 1e6) / 1e6,
    y: Math.round((p.y - child.h / 2) * 1e6) / 1e6,
    w: child.w,
    h: child.h,
  });
  const crot = normDeg(rot + det * (child.rotation || 0));
  const flipH = !!child.flipH !== fh;
  const flipV = !!child.flipV !== fv;
  delete out.rotation;
  delete out.flipH;
  delete out.flipV;
  if (crot) out.rotation = crot;
  if (flipH) out.flipH = true;
  if (flipV) out.flipV = true;
  return out;
}

/** ungroupElement replaces the group `groupId` by its members (with the
 *  group's rotation/flip baked in) at the group's z-position. Returns null
 *  when `groupId` is not a top-level group. */
export function ungroupElement(
  elements: SlideElement[],
  groupId: string,
): { elements: SlideElement[]; ids: string[] } | null {
  const i = elements.findIndex((e) => e.id === groupId);
  const g = elements[i];
  if (i < 0 || !isGroup(g)) return null;
  const kids = (g.children || []).map((c) => bakeChild(c, g));
  return {
    elements: [...elements.slice(0, i), ...kids, ...elements.slice(i + 1)],
    ids: kids.map((k) => k.id),
  };
}

/** ungroupMany ungroups every group among `ids`; non-groups stay selected. */
export function ungroupMany(
  elements: SlideElement[],
  ids: readonly string[],
): { elements: SlideElement[]; ids: string[] } | null {
  let els = elements;
  const sel: string[] = [];
  let changed = false;
  for (const id of ids) {
    const r = ungroupElement(els, id);
    if (r) {
      els = r.elements;
      sel.push(...r.ids);
      changed = true;
    } else sel.push(id);
  }
  return changed ? { elements: els, ids: sel } : null;
}

/** refitGroup shrinks an upright, unflipped group's box to its members after
 *  a member was removed. A rotated or flipped group keeps its box so the
 *  remaining members don't jump (its rotation centre would move). */
function refitGroup(g: SlideElement, kids: SlideElement[]): SlideElement {
  if (normDeg(g.rotation) || g.flipH || g.flipV) return { ...g, children: kids };
  return { ...g, ...selectionBounds(kids)!, children: kids };
}

/**
 * removeDeep deletes the element `id` wherever it is: on the slide or inside
 * a (nested) group. A group left with one member dissolves into it, and an
 * emptied group is removed, as in PowerPoint/OnlyOffice.
 */
export function removeDeep(elements: SlideElement[], id: string): SlideElement[] {
  const out: SlideElement[] = [];
  for (const e of elements) {
    if (e.id === id) continue;
    if (e.children) {
      const kids = removeDeep(e.children, id);
      if (kids.length !== e.children.length || kids.some((k, i) => k !== e.children![i])) {
        if (kids.length === 0) continue;
        if (kids.length === 1) out.push(bakeChild(kids[0], e));
        else out.push(refitGroup(e, kids));
        continue;
      }
    }
    out.push(e);
  }
  return out;
}

/** findDeep finds an element by id on the slide or inside any group. */
export function findDeep(
  elements: readonly SlideElement[],
  id: string,
): SlideElement | undefined {
  for (const e of elements) {
    if (e.id === id) return e;
    if (e.children) {
      const f = findDeep(e.children, id);
      if (f) return f;
    }
  }
  return undefined;
}

/** parentGroupOf returns the top-level group containing `id` (at any depth),
 *  or undefined when `id` is itself top-level or absent. */
export function parentGroupOf(
  elements: readonly SlideElement[],
  id: string,
): SlideElement | undefined {
  return elements.find((e) => e.children && e.id !== id && findDeep(e.children, id));
}

/** flattenGroups returns the leaf elements of a list with every group's
 *  rotation/flip baked in: what renderers without group support (HTML, SVG,
 *  PDF export) draw. */
export function flattenGroups(elements: readonly SlideElement[]): SlideElement[] {
  const out: SlideElement[] = [];
  for (const e of elements) {
    if (e.type === "group") out.push(...flattenGroups((e.children || []).map((c) => bakeChild(c, e))));
    else out.push(e);
  }
  return out;
}

/** relativeTo shifts an element (and its descendants) into the coordinate
 *  space of a container positioned at (ox, oy): how a group's DOM box lays
 *  out its members. */
export function relativeTo(el: SlideElement, ox: number, oy: number): SlideElement {
  return setElementBox(el, { x: el.x - ox, y: el.y - oy, w: el.w, h: el.h });
}
