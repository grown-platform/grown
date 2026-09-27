// Pure element-naming helpers (the Selection-pane name OnlyOffice's JS API
// exposes as GetName/SetName, and pptx stores as `p:cNvPr@name`).

import type { ElementType, Slide, SlideElement } from "./model";
import { findDeep } from "./groupOps";

const TYPE_LABEL: Record<ElementType, string> = {
  text: "TextBox",
  rect: "Rectangle",
  ellipse: "Oval",
  image: "Picture",
  line: "Straight Connector",
  triangle: "Isosceles Triangle",
  diamond: "Diamond",
  rightArrow: "Right Arrow",
  roundRect: "Rounded Rectangle",
  table: "Table",
  group: "Group",
  shape: "Shape",
  connector: "Connector",
};

/** allElements lists every element on the slide, group members included. */
function allElements(els: readonly SlideElement[]): SlideElement[] {
  return els.flatMap((e) => [e, ...(e.children ? allElements(e.children) : [])]);
}

/** defaultElementName is PowerPoint's "<Type> <n>" name, with n one past the
 *  number of elements on the slide so it is unique among default names. */
export function defaultElementName(el: SlideElement, elements: readonly SlideElement[]): string {
  const taken = new Set(allElements(elements).map((e) => e.name).filter(Boolean));
  let n = allElements(elements).length + 1;
  while (taken.has(`${TYPE_LABEL[el.type]} ${n}`)) n++;
  return `${TYPE_LABEL[el.type]} ${n}`;
}

/** elementName is the element's name, or a default derived from its type and
 *  z-position when it has none. Never empty. */
export function elementName(el: SlideElement, elements: readonly SlideElement[]): string {
  if (el.name) return el.name;
  const i = allElements(elements).findIndex((e) => e.id === el.id);
  return `${TYPE_LABEL[el.type]} ${i < 0 ? 1 : i + 1}`;
}

function mapDeep(
  els: SlideElement[],
  fn: (e: SlideElement) => SlideElement,
): SlideElement[] {
  return els.map((e) => {
    const m = fn(e);
    return m.children ? { ...m, children: mapDeep(m.children, fn) } : m;
  });
}

/**
 * setElementName names element `id`. Blank or non-string names are rejected
 * (`ok: false`, elements unchanged). Names are unique per slide: another
 * element already carrying the name is renamed to a fresh default name.
 */
export function setElementName(
  elements: SlideElement[],
  id: string,
  name: unknown,
): { elements: SlideElement[]; ok: boolean } {
  if (typeof name !== "string" || !name.trim() || !findDeep(elements, id))
    return { elements, ok: false };
  const clash = allElements(elements).find((e) => e.id !== id && e.name === name);
  let out = elements;
  if (clash) {
    const fresh = defaultElementName(clash, elements);
    out = mapDeep(out, (e) => (e.id === clash.id ? { ...e, name: fresh } : e));
  }
  out = mapDeep(out, (e) => (e.id === id ? { ...e, name } : e));
  return { elements: out, ok: true };
}

/** findElementsByName returns the elements (group members included) whose
 *  name is one of `names`, across the given slides, in slide/z order. */
export function findElementsByName(
  slides: readonly Slide[],
  names: readonly string[],
): SlideElement[] {
  const want = new Set(names);
  return slides.flatMap((s) => allElements(s.elements).filter((e) => !!e.name && want.has(e.name)));
}
