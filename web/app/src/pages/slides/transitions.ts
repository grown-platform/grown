// Slide transitions (M8): the catalogue (type, options, default duration)
// and the pure mapping to CSS animations for the incoming and outgoing
// slide layers. Keyframes live in TRANSITION_CSS. Morph and 3-D GL
// transitions are flagged exception F7: "morph" here is a crossfade plus
// tweening of matched elements (see morphPairs).

import type { Slide, SlideElement, TransitionType } from "./model";

export interface TransitionOption {
  value: string;
  label: string;
}

export interface TransitionDef {
  type: TransitionType;
  label: string;
  /** Options (directions/variants); the first is the default. */
  options: TransitionOption[];
  /** Default duration, ms. */
  dur: number;
}

const FROM4: TransitionOption[] = [
  { value: "l", label: "From right" },
  { value: "r", label: "From left" },
  { value: "u", label: "From bottom" },
  { value: "d", label: "From top" },
];
const TO4: TransitionOption[] = [
  { value: "l", label: "To left" },
  { value: "r", label: "To right" },
  { value: "u", label: "To top" },
  { value: "d", label: "To bottom" },
];

/** The picker catalogue. Directions use the pptx `dir` values: the way the
 *  motion goes ("l" = moving left, i.e. coming in from the right). */
export const TRANSITION_DEFS: TransitionDef[] = [
  { type: "none", label: "None", options: [], dur: 0 },
  {
    type: "fade",
    label: "Fade",
    options: [
      { value: "smooth", label: "Smoothly" },
      { value: "black", label: "Through black" },
    ],
    dur: 700,
  },
  { type: "push", label: "Push", options: FROM4, dur: 1000 },
  { type: "wipe", label: "Wipe", options: FROM4, dur: 1000 },
  {
    type: "split",
    label: "Split",
    options: [
      { value: "vert-out", label: "Vertical out" },
      { value: "vert-in", label: "Vertical in" },
      { value: "horz-out", label: "Horizontal out" },
      { value: "horz-in", label: "Horizontal in" },
    ],
    dur: 1000,
  },
  { type: "reveal", label: "Reveal", options: TO4.slice(0, 2), dur: 1200 },
  { type: "cover", label: "Cover", options: FROM4, dur: 1000 },
  { type: "uncover", label: "Uncover", options: TO4, dur: 1000 },
  {
    type: "zoom",
    label: "Zoom",
    options: [
      { value: "in", label: "Zoom in" },
      { value: "out", label: "Zoom out" },
    ],
    dur: 800,
  },
  { type: "dissolve", label: "Dissolve", options: [], dur: 700 },
  { type: "cut", label: "Cut", options: [], dur: 0 },
  { type: "morph", label: "Morph", options: [], dur: 1500 },
];

/** A legacy (pre-M8) type as its M8 type + option. */
export function normalizeTransition(
  t: TransitionType | undefined,
  dir?: string,
): { type: TransitionType; dir?: string } {
  switch (t) {
    case undefined:
      return { type: "none" };
    case "slide-left":
      return { type: "push", dir: "l" };
    case "slide-right":
      return { type: "push", dir: "r" };
    case "slide-up":
      return { type: "push", dir: "u" };
    default:
      return dir === undefined ? { type: t } : { type: t, dir };
  }
}

export function transitionDef(t: TransitionType | undefined): TransitionDef {
  const n = normalizeTransition(t).type;
  return TRANSITION_DEFS.find((d) => d.type === n) ?? TRANSITION_DEFS[0];
}

/** The slide's effective transition: type, option (defaulted) and duration. */
export function slideTransition(s: Pick<Slide, "transition" | "transitionDir" | "transitionDur"> | undefined): {
  type: TransitionType;
  dir: string;
  dur: number;
} {
  const n = normalizeTransition(s?.transition, s?.transitionDir);
  const def = transitionDef(n.type);
  const dir = n.dir && def.options.some((o) => o.value === n.dir) ? n.dir : (def.options[0]?.value ?? "");
  const dur = s?.transitionDur !== undefined && s.transitionDur >= 0 ? s.transitionDur : def.dur;
  return { type: def.type, dir, dur: def.type === "cut" || def.type === "none" ? 0 : dur };
}

/** CSS for the two layers of a transition. `outgoing` undefined = the old
 *  slide is not drawn at all. `outgoingOnTop` puts the old slide above the
 *  new one (uncover, split in, zoom out). `total` is when to drop the old
 *  layer, ms. */
export interface TransitionFx {
  incoming?: string;
  outgoing?: string;
  outgoingOnTop?: boolean;
  /** Stage colour behind both layers ("#000" for through-black). */
  total: number;
}

const DIR_AXIS: Record<string, [string, string]> = {
  // motion direction → keyframe suffix for "coming from" and "leaving to"
  l: ["R", "L"],
  r: ["L", "R"],
  u: ["B", "T"],
  d: ["T", "B"],
};

/** transitionFx maps a slide's transition to the incoming/outgoing CSS
 *  animations (keyframes in TRANSITION_CSS). */
export function transitionFx(s: Pick<Slide, "transition" | "transitionDir" | "transitionDur"> | undefined): TransitionFx {
  const { type, dir, dur } = slideTransition(s);
  const a = (name: string, d = dur, delay = 0) => `${name} ${d}ms ease-in-out ${delay}ms both`;
  const [from, to] = DIR_AXIS[dir] ?? DIR_AXIS.l;
  switch (type) {
    case "fade":
      if (dir === "black")
        return { incoming: a("trFadeIn", dur / 2, dur / 2), outgoing: a("trFadeOut", dur / 2), outgoingOnTop: true, total: dur };
      return { incoming: a("trFadeIn"), outgoing: a("trHold"), total: dur };
    case "dissolve":
      return { incoming: `trFadeIn ${dur}ms steps(8, end) 0ms both`, outgoing: a("trHold"), total: dur };
    case "push":
      return { incoming: a(`trIn${from}`), outgoing: a(`trOut${to}`), total: dur };
    case "cover":
      return { incoming: a(`trIn${from}`), outgoing: a("trHold"), total: dur };
    case "uncover":
      return { incoming: a("trHold"), outgoing: a(`trOut${to}`), outgoingOnTop: true, total: dur };
    case "reveal":
      return { incoming: a("trFadeIn", dur / 2, dur / 2), outgoing: a(`trOutFade${to}`, dur / 2), outgoingOnTop: true, total: dur };
    case "wipe":
      return { incoming: a(`trWipe${from}`), outgoing: a("trHold"), total: dur };
    case "split": {
      const [orient, io] = dir.split("-");
      const o = orient === "horz" ? "H" : "V";
      return io === "in"
        ? { incoming: a("trHold"), outgoing: a(`trSplitClose${o}`), outgoingOnTop: true, total: dur }
        : { incoming: a(`trSplitOpen${o}`), outgoing: a("trHold"), total: dur };
    }
    case "zoom":
      return dir === "out"
        ? { incoming: a("trHold"), outgoing: a("trZoomOut"), outgoingOnTop: true, total: dur }
        : { incoming: a("trZoomIn"), outgoing: a("trHold"), total: dur };
    case "morph":
      return { incoming: a("trFadeIn"), outgoing: a("trFadeOut"), total: dur };
    default:
      return { total: 0 };
  }
}

/** Keyframes for transitionFx (and the editor's preview). */
export const TRANSITION_CSS = `
@keyframes trHold { from { opacity: 1; } to { opacity: 1; } }
@keyframes trFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes trFadeOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes trInR { from { transform: translateX(100%); } to { transform: none; } }
@keyframes trInL { from { transform: translateX(-100%); } to { transform: none; } }
@keyframes trInB { from { transform: translateY(100%); } to { transform: none; } }
@keyframes trInT { from { transform: translateY(-100%); } to { transform: none; } }
@keyframes trOutL { from { transform: none; } to { transform: translateX(-100%); } }
@keyframes trOutR { from { transform: none; } to { transform: translateX(100%); } }
@keyframes trOutT { from { transform: none; } to { transform: translateY(-100%); } }
@keyframes trOutB { from { transform: none; } to { transform: translateY(100%); } }
@keyframes trOutFadeL { from { transform: none; opacity: 1; } to { transform: translateX(-30%); opacity: 0; } }
@keyframes trOutFadeR { from { transform: none; opacity: 1; } to { transform: translateX(30%); opacity: 0; } }
@keyframes trOutFadeT { from { transform: none; opacity: 1; } to { transform: translateY(-30%); opacity: 0; } }
@keyframes trOutFadeB { from { transform: none; opacity: 1; } to { transform: translateY(30%); opacity: 0; } }
@keyframes trWipeR { from { clip-path: inset(0 0 0 100%); } to { clip-path: inset(0 0 0 0); } }
@keyframes trWipeL { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes trWipeB { from { clip-path: inset(100% 0 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes trWipeT { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes trSplitOpenV { from { clip-path: inset(0 50% 0 50%); } to { clip-path: inset(0 0 0 0); } }
@keyframes trSplitOpenH { from { clip-path: inset(50% 0 50% 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes trSplitCloseV { from { clip-path: inset(0 0 0 0); } to { clip-path: inset(0 50% 0 50%); } }
@keyframes trSplitCloseH { from { clip-path: inset(0 0 0 0); } to { clip-path: inset(50% 0 50% 0); } }
@keyframes trZoomIn { from { transform: scale(0.3); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes trZoomOut { from { transform: none; opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
@keyframes trMorph { from { translate: var(--mx) var(--my); scale: var(--msx) var(--msy); opacity: var(--mo, 1); } }
`;

// ------------------------------------------------------------ morph-lite

/** A morph pair: the element on the new slide and the box it tweens from. */
export interface MorphPair {
  id: string;
  /** The matched element on the old slide. */
  fromId: string;
  from: { x: number; y: number; w: number; h: number };
}

function morphKey(e: SlideElement): string | null {
  if (e.type === "text") return e.text?.trim() ? `text:${e.text.trim()}` : null;
  if (e.type === "image") return e.src ? `image:${e.src}` : null;
  if (e.type === "shape") return `shape:${e.preset ?? ""}:${e.fill ?? ""}`;
  if (e.type === "group" || e.type === "table" || e.type === "connector" || e.type === "line") return null;
  return `${e.type}:${e.fill ?? ""}`;
}

/** morphPairs matches elements of the old and new slide for morph-lite:
 *  by name when both carry one, else by id, else by content (same text,
 *  same picture, same shape and fill). Each old element matches once. */
export function morphPairs(prev: Slide | undefined, next: Slide): MorphPair[] {
  if (!prev) return [];
  const used = new Set<string>();
  const out: MorphPair[] = [];
  const take = (e: SlideElement, o: SlideElement | undefined) => {
    if (!o || used.has(o.id)) return false;
    used.add(o.id);
    out.push({ id: e.id, fromId: o.id, from: { x: o.x, y: o.y, w: o.w, h: o.h } });
    return true;
  };
  const rest: SlideElement[] = [];
  for (const e of next.elements) {
    if (e.name && take(e, prev.elements.find((o) => o.name === e.name && !used.has(o.id)))) continue;
    if (take(e, prev.elements.find((o) => o.id === e.id))) continue;
    rest.push(e);
  }
  for (const e of rest) {
    const k = morphKey(e);
    if (k) take(e, prev.elements.find((o) => !used.has(o.id) && morphKey(o) === k));
  }
  return out;
}

/** The per-element CSS for a morph tween: the element starts at the old
 *  box (translate + scale about its centre) and eases to its own. */
export function morphStyle(e: SlideElement, from: MorphPair["from"], dur: number): Record<string, string> {
  const sx = e.w > 0 ? from.w / e.w : 1;
  const sy = e.h > 0 ? from.h / e.h : 1;
  const dx = from.x + from.w / 2 - (e.x + e.w / 2);
  const dy = from.y + from.h / 2 - (e.y + e.h / 2);
  return {
    "--mx": `${round(dx)}px`,
    "--my": `${round(dy)}px`,
    "--msx": `${round(sx)}`,
    "--msy": `${round(sy)}`,
    animation: `trMorph ${dur}ms ease-in-out 0ms both`,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
