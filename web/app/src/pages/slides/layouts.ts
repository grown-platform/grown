// Slide layouts (M7): templates of placeholders, applied by copying.
//
// A layout is a slide-like list of elements; the ones carrying
// `placeholder` are the title/body/subtitle boxes a slide made from the
// layout gets (empty, showing a prompt in the editor), plus the
// date/footer/slide-number boxes, which are never copied: they are drawn
// from the layout when the header & footer settings switch them on.
// "Apply layout" moves a slide's placeholders onto the layout's boxes,
// keeping their content; nothing inherits from the layout at render time
// (flagged exception F3).

import {
  CANVAS_H,
  DEFAULT_CANVAS_H,
  uid,
  type DeckDoc,
  type DeckHF,
  type Placeholder,
  type PlaceholderType,
  type Slide,
  type SlideElement,
  type SlideLayout,
} from "./model";
import { reId } from "./groupOps";
import { OFFICE_THEME, resolveRef, themeFont, themeOf } from "./theme";
import type { DeckTheme } from "./model";

/** Header/footer placeholder types (drawn from the layout, never copied). */
export const HF_TYPES: PlaceholderType[] = ["dt", "ftr", "sldNum"];

export function isHF(el: SlideElement): boolean {
  return !!el.placeholder && HF_TYPES.includes(el.placeholder.type);
}

/** Placeholder family: title and centred title match each other; body,
 *  content and subtitle match each other. */
export function phFamily(t: PlaceholderType): "title" | "body" | "pic" | PlaceholderType {
  if (t === "title" || t === "ctrTitle") return "title";
  if (t === "body" || t === "obj" || t === "subTitle") return "body";
  return t;
}

const PROMPTS: Partial<Record<PlaceholderType, string>> = {
  title: "Click to add title",
  ctrTitle: "Click to add title",
  subTitle: "Click to add subtitle",
  body: "Click to add text",
  obj: "Click to add text",
  pic: "Click to add picture",
};

/** The prompt an empty placeholder shows in the editor. */
export function placeholderPrompt(el: SlideElement): string {
  return (el.placeholder && PROMPTS[el.placeholder.type]) || "Click to add text";
}

/** An empty placeholder: shows its prompt in the editor, nothing elsewhere. */
export function isEmptyPlaceholder(el: SlideElement): boolean {
  if (!el.placeholder || isHF(el)) return false;
  if (el.type === "image") return !el.src;
  return el.type === "text" && !(el.text ?? "").replace(/[\n\v]/g, "").trim();
}

// ------------------------------------------------------------ built-ins

type Box = [number, number, number, number];

/** Text placeholder element at a 960×540 box (y/h scaled to `h`). */
function ph(
  type: PlaceholderType,
  idx: number | undefined,
  box: Box,
  sc: number,
  theme: DeckTheme,
  o: Partial<SlideElement> = {},
): SlideElement {
  const role = type === "title" || type === "ctrTitle" ? "major" : "minor";
  const colorRef = o.themeRefs?.color ?? (type === "subTitle" ? "tx1/lumMod:65000/lumOff:35000" : "tx1");
  return {
    id: `${type}${idx ?? ""}`,
    type: "text",
    x: box[0],
    y: Math.round(box[1] * sc * 100) / 100,
    w: box[2],
    h: Math.round(box[3] * sc * 100) / 100,
    text: "",
    fontSize: 18,
    fontFamily: themeFont(role, theme),
    color: resolveRef(colorRef, theme) ?? "#000000",
    align: "left",
    valign: "top",
    ...o,
    themeRefs: { color: colorRef, font: role },
    placeholder: { type, ...(idx !== undefined ? { idx } : {}) },
  };
}

const TITLE = (sc: number, th: DeckTheme) =>
  ph("title", undefined, [66, 29, 828, 90], sc, th, { fontSize: 36, valign: "middle" });

/** Date / footer / slide number boxes shared by every built-in layout. */
function hf(sc: number, h: number, th: DeckTheme): SlideElement[] {
  const y = h / sc - 46;
  const o = { fontSize: 12, valign: "middle" as const, themeRefs: { color: "tx1/lumMod:65000/lumOff:35000" } };
  return [
    ph("dt", 10, [66, y, 216, 29], sc, th, { ...o, align: "left" }),
    ph("ftr", 11, [318, y, 324, 29], sc, th, { ...o, align: "center" }),
    ph("sldNum", 12, [678, y, 216, 29], sc, th, { ...o, align: "right" }),
  ];
}

/** The built-in layouts (PowerPoint's standard set) for a theme and slide
 *  height; ids are stable so slides keep pointing at them. */
export function builtinLayouts(theme: DeckTheme = OFFICE_THEME, h = CANVAS_H): SlideLayout[] {
  const sc = h / DEFAULT_CANVAS_H;
  const bg = { background: resolveRef("bg1", theme) ?? "#ffffff", bgRef: "bg1" };
  const foot = () => hf(sc, h, theme);
  const L = (id: string, name: string, type: string, els: SlideElement[]): SlideLayout => ({
    id,
    name,
    type,
    ...bg,
    elements: [...els, ...foot()],
  });
  return [
    L("title", "Title slide", "title", [
      ph("ctrTitle", undefined, [120, 128, 720, 150], sc, theme, {
        fontSize: 48,
        align: "center",
        valign: "bottom",
      }),
      ph("subTitle", 1, [120, 292, 720, 100], sc, theme, { fontSize: 22, align: "center" }),
    ]),
    L("obj", "Title and content", "obj", [
      TITLE(sc, theme),
      ph("body", 1, [66, 140, 828, 330], sc, theme, { fontSize: 22 }),
    ]),
    L("secHead", "Section header", "secHead", [
      ph("title", undefined, [66, 150, 828, 150], sc, theme, { fontSize: 44, valign: "bottom" }),
      ph("body", 1, [66, 306, 828, 80], sc, theme, {
        fontSize: 22,
        themeRefs: { color: "tx1/lumMod:65000/lumOff:35000" },
      }),
    ]),
    L("twoObj", "Two content", "twoObj", [
      TITLE(sc, theme),
      ph("body", 1, [66, 140, 404, 330], sc, theme, { fontSize: 20 }),
      ph("body", 2, [490, 140, 404, 330], sc, theme, { fontSize: 20 }),
    ]),
    L("twoTxTwoObj", "Comparison", "twoTxTwoObj", [
      TITLE(sc, theme),
      ph("body", 1, [66, 132, 404, 48], sc, theme, { fontSize: 20, bold: true, valign: "bottom" }),
      ph("body", 2, [66, 186, 404, 284], sc, theme, { fontSize: 18 }),
      ph("body", 3, [490, 132, 404, 48], sc, theme, { fontSize: 20, bold: true, valign: "bottom" }),
      ph("body", 4, [490, 186, 404, 284], sc, theme, { fontSize: 18 }),
    ]),
    L("titleOnly", "Title only", "titleOnly", [TITLE(sc, theme)]),
    L("objTx", "Content with caption", "objTx", [
      ph("title", undefined, [66, 36, 310, 110], sc, theme, { fontSize: 28, valign: "bottom" }),
      ph("body", 1, [410, 60, 484, 400], sc, theme, { fontSize: 20 }),
      ph("body", 2, [66, 160, 310, 300], sc, theme, { fontSize: 16 }),
    ]),
    L("blank", "Blank", "blank", []),
  ];
}

/** The deck's layouts: its own (imported/edited), else the built-ins. */
export function layoutsOf(deck: Pick<DeckDoc, "layouts" | "theme"> | null | undefined): SlideLayout[] {
  return deck?.layouts?.length ? deck.layouts : builtinLayouts(themeOf(deck));
}

export function findLayout(deck: Pick<DeckDoc, "layouts" | "theme"> | null | undefined, id: string | undefined): SlideLayout | undefined {
  if (!id) return undefined;
  return layoutsOf(deck).find((l) => l.id === id);
}

/** A layout by pptx type, falling back to the first layout. */
export function layoutByType(layouts: SlideLayout[], type: string): SlideLayout | undefined {
  return layouts.find((l) => l.type === type) ?? layouts.find((l) => l.id === type);
}

/** The layout Ctrl+M / New slide uses after slide `cur`: the current
 *  slide's layout, except that a title slide is followed by "Title and
 *  content" (PowerPoint); legacy slides without a layout also get it. */
export function nextLayoutFor(deck: DeckDoc, cur: number): SlideLayout | undefined {
  const layouts = layoutsOf(deck);
  const here = findLayout(deck, deck.slides[cur]?.layout);
  if (here && here.type !== "title") return here;
  return layoutByType(layouts, "obj") ?? layouts[0];
}

function copyEl(el: SlideElement): SlideElement {
  return reId(el, uid);
}

/** slideFromLayout builds a new slide from a layout: its placeholders
 *  (empty) and decorations, its background. */
export function slideFromLayout(layout: SlideLayout, makeId: () => string = uid): Slide {
  return {
    id: makeId(),
    background: layout.background ?? "#ffffff",
    ...(layout.bgRef ? { bgRef: layout.bgRef } : {}),
    ...(layout.bgFill ? { bgFill: layout.bgFill } : {}),
    elements: layout.elements.filter((e) => !isHF(e)).map(copyEl),
    layout: layout.id,
  };
}

/** Pair each layout placeholder with a slide placeholder of the same
 *  family: by idx first, then in order. */
function matchPlaceholders(slideEls: SlideElement[], layoutEls: SlideElement[]): Map<SlideElement, SlideElement> {
  const out = new Map<SlideElement, SlideElement>();
  const used = new Set<SlideElement>();
  const phs = slideEls.filter((e) => e.placeholder && !isHF(e));
  const lphs = layoutEls.filter((e) => e.placeholder && !isHF(e));
  const fam = (p: Placeholder) => phFamily(p.type);
  for (const l of lphs) {
    const m = phs.find(
      (s) =>
        !used.has(s) &&
        fam(s.placeholder!) === fam(l.placeholder!) &&
        s.placeholder!.idx !== undefined &&
        s.placeholder!.idx === l.placeholder!.idx,
    );
    if (m) {
      out.set(l, m);
      used.add(m);
    }
  }
  for (const l of lphs) {
    if (out.has(l)) continue;
    const m = phs.find((s) => !used.has(s) && fam(s.placeholder!) === fam(l.placeholder!));
    if (m) {
      out.set(l, m);
      used.add(m);
    }
  }
  return out;
}

/**
 * applyLayout changes a slide's layout. Placeholders matching the layout's
 * move to its boxes and keep their content and formatting; the layout's
 * other placeholders are added empty; empty placeholders the layout doesn't
 * have are removed (ones with content are kept). Other elements stay.
 */
export function applyLayout(slide: Slide, layout: SlideLayout, reset = false): Slide {
  const match = matchPlaceholders(slide.elements, layout.elements);
  const bySlide = new Map<SlideElement, SlideElement>();
  for (const [l, s] of match) bySlide.set(s, l);
  const els: SlideElement[] = [];
  for (const e of slide.elements) {
    const l = bySlide.get(e);
    if (l) {
      els.push(reset ? resetPlaceholder(e, l) : { ...e, x: l.x, y: l.y, w: l.w, h: l.h, rotation: undefined, placeholder: l.placeholder });
      continue;
    }
    if (e.placeholder && !isHF(e) && isEmptyPlaceholder(e)) continue;
    els.push(e);
  }
  for (const l of layout.elements) {
    if (!l.placeholder || isHF(l) || match.has(l)) continue;
    els.push(copyEl(l));
  }
  const out: Slide = { ...slide, elements: els.map(dropUndefinedRotation), layout: layout.id };
  if (reset) {
    out.background = layout.background ?? out.background;
    if (layout.bgRef) out.bgRef = layout.bgRef;
    else delete out.bgRef;
    if (layout.bgFill) out.bgFill = layout.bgFill;
    else delete out.bgFill;
  }
  return out;
}

function dropUndefinedRotation(e: SlideElement): SlideElement {
  if (!("rotation" in e) || e.rotation !== undefined) return e;
  const o = { ...e };
  delete o.rotation;
  return o;
}

/** A slide placeholder reset to its layout box and formatting, keeping its
 *  text (rich formatting is cleared) or picture. */
function resetPlaceholder(s: SlideElement, l: SlideElement): SlideElement {
  const out: SlideElement = { ...l, id: s.id };
  if (s.type === "text" && l.type === "text") out.text = s.text ?? "";
  else if (s.type !== l.type) return { ...s, x: l.x, y: l.y, w: l.w, h: l.h, placeholder: l.placeholder };
  if (s.src) out.src = s.src;
  if (s.url) out.url = s.url;
  if (s.animation) out.animation = s.animation;
  return out;
}

/** resetSlide puts every placeholder back to its layout box and format
 *  (Slide ▸ Reset slide); a slide without a layout is unchanged. */
export function resetSlide(slide: Slide, layout: SlideLayout | undefined): Slide {
  return layout ? applyLayout(slide, layout, true) : slide;
}

/** The content placeholders of a slide in tab order (element order). */
export function placeholdersOf(slide: Slide): SlideElement[] {
  return slide.elements.filter((e) => e.placeholder && !isHF(e));
}

/**
 * Ctrl+Enter: the placeholder after `currentId` (or the first when no
 * placeholder is current). Null when `currentId` is the last one — the
 * caller then adds a slide and moves to its first placeholder.
 */
export function nextPlaceholder(slide: Slide, currentId: string | null): string | null {
  const phs = placeholdersOf(slide);
  if (!phs.length) return null;
  if (!currentId) return phs[0].id;
  const i = phs.findIndex((e) => e.id === currentId);
  if (i < 0) return phs[0].id;
  return i + 1 < phs.length ? phs[i + 1].id : null;
}

// ------------------------------------------------------------ header & footer

/** Default date text (Header & footer "update automatically"). */
export function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** Whether slide i shows each header/footer part. */
export function hfFlags(deck: DeckDoc, i: number): { dt: boolean; ftr: boolean; sldNum: boolean } {
  const s = deck.slides[i];
  const hf: DeckHF = deck.hf ?? {};
  const off = { dt: false, ftr: false, sldNum: false };
  if (!s) return off;
  if (hf.notOnTitle && findLayout(deck, s.layout)?.type === "title") return off;
  return {
    dt: s.hf?.dt ?? !!hf.dt,
    ftr: s.hf?.ftr ?? !!hf.ftr,
    sldNum: s.hf?.sldNum ?? !!hf.sldNum,
  };
}

/** The date/footer/number boxes drawn on slide i (ids "hf-dt", "hf-ftr",
 *  "hf-sldNum"), from its layout's placeholders or the built-in ones. */
export function footerElements(deck: DeckDoc, i: number, now: Date = new Date()): SlideElement[] {
  const flags = hfFlags(deck, i);
  if (!flags.dt && !flags.ftr && !flags.sldNum) return [];
  const s = deck.slides[i];
  const layout = findLayout(deck, s.layout) ?? layoutByType(layoutsOf(deck), "obj");
  const fallback = builtinLayouts(themeOf(deck))[1];
  const hf = deck.hf ?? {};
  const out: SlideElement[] = [];
  for (const k of HF_TYPES as ("dt" | "ftr" | "sldNum")[]) {
    if (!flags[k]) continue;
    const box =
      layout?.elements.find((e) => e.placeholder?.type === k) ??
      fallback.elements.find((e) => e.placeholder?.type === k);
    if (!box) continue;
    const text =
      k === "sldNum" ? String(i + (hf.startAt ?? 1)) : k === "dt" ? (hf.dateText ?? formatDate(now)) : (hf.footerText ?? "");
    if (!text) continue;
    out.push({ ...box, id: `hf-${k}`, text, runs: undefined, paras: undefined });
  }
  return out;
}

/** Slide i with its header/footer boxes appended (thumbnails, slideshow,
 *  exports). */
export function withFooters(deck: DeckDoc, i: number, now?: Date): Slide {
  const s = deck.slides[i];
  const extra = footerElements(deck, i, now);
  return extra.length ? { ...s, elements: [...s.elements, ...extra] } : s;
}

/** A new deck: one title slide made from the title layout (empty
 *  placeholders with prompts), in the default theme. */
export function newLayoutDeck(): DeckDoc {
  const title = layoutByType(builtinLayouts(OFFICE_THEME), "title")!;
  return { slides: [slideFromLayout(title)] };
}
