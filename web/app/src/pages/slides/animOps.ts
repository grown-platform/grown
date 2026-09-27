// Element animations (M8), pure: the effect catalogue, the slide's effect
// list (with the pre-M8 `el.animation` read as effects), pane edits
// (add/update/remove/move), the timeline (click groups; with/after
// chains; delays) and the per-element frame the slideshow renders at a
// given step. Keyframes are in ANIM_CSS. Motion paths are flagged
// exception F8 and not offered.

import { uid } from "./model";
import type {
  AnimClass,
  AnimEffect,
  AnimKind,
  AnimStart,
  AnimationType,
  Slide,
  SlideElement,
} from "./model";

export interface AnimKindDef {
  kind: AnimKind;
  label: string;
  /** Default duration, ms. */
  dur: number;
  /** Takes a direction (fly, wipe, float). */
  dirs?: boolean;
}

/** Effects offered per class, in PowerPoint's gallery order. */
export const ANIM_CATALOG: Record<AnimClass, AnimKindDef[]> = {
  entr: [
    { kind: "appear", label: "Appear", dur: 1 },
    { kind: "fade", label: "Fade", dur: 500 },
    { kind: "fly", label: "Fly in", dur: 500, dirs: true },
    { kind: "float", label: "Float in", dur: 1000, dirs: true },
    { kind: "wipe", label: "Wipe", dur: 500, dirs: true },
    { kind: "zoom", label: "Zoom", dur: 500 },
  ],
  emph: [
    { kind: "pulse", label: "Pulse", dur: 500 },
    { kind: "colorPulse", label: "Color pulse", dur: 1000 },
    { kind: "teeter", label: "Teeter", dur: 1000 },
    { kind: "spin", label: "Spin", dur: 2000 },
    { kind: "grow", label: "Grow/Shrink", dur: 2000 },
  ],
  exit: [
    { kind: "appear", label: "Disappear", dur: 1 },
    { kind: "fade", label: "Fade", dur: 500 },
    { kind: "fly", label: "Fly out", dur: 500, dirs: true },
    { kind: "float", label: "Float out", dur: 1000, dirs: true },
    { kind: "wipe", label: "Wipe", dur: 500, dirs: true },
    { kind: "zoom", label: "Zoom", dur: 500 },
  ],
};

export const CLASS_LABEL: Record<AnimClass, string> = { entr: "Entrance", emph: "Emphasis", exit: "Exit" };
export const START_LABEL: Record<AnimStart, string> = {
  click: "On click",
  with: "With previous",
  after: "After previous",
};
export const DIR_LABEL: Record<NonNullable<AnimEffect["dir"]>, string> = {
  b: "Bottom",
  l: "Left",
  r: "Right",
  t: "Top",
};

export function kindDef(cls: AnimClass, kind: AnimKind): AnimKindDef | undefined {
  return ANIM_CATALOG[cls].find((d) => d.kind === kind);
}

/** An effect's label in the pane ("Fly in from left", "Spin", …). */
export function effectLabel(e: AnimEffect): string {
  const d = kindDef(e.cls, e.kind);
  const base = d?.label ?? e.kind;
  if (d?.dirs && e.dir) return `${base} ${e.cls === "exit" ? "to" : "from"} ${DIR_LABEL[e.dir].toLowerCase()}`;
  return base;
}

export function effectDur(e: AnimEffect): number {
  if (e.dur !== undefined && e.dur >= 0) return e.dur;
  return kindDef(e.cls, e.kind)?.dur ?? 500;
}

/** The default direction of a directional effect (fly in from bottom). */
export function defaultDir(kind: AnimKind): AnimEffect["dir"] | undefined {
  if (kind === "fly" || kind === "float") return "b";
  if (kind === "wipe") return "b";
  return undefined;
}

// ------------------------------------------------------------ the list

const LEGACY: Record<AnimationType, Pick<AnimEffect, "kind" | "dir">> = {
  appear: { kind: "appear" },
  "fade-in": { kind: "fade" },
  "fly-in-bottom": { kind: "fly", dir: "b" },
  "fly-in-left": { kind: "fly", dir: "l" },
};

/** effectsOf returns the slide's effects in play order. A slide without
 *  `anims` derives them from the pre-M8 `el.animation` (sorted by order;
 *  equal orders play together). Effects on elements that no longer exist
 *  on the slide are dropped. */
export function effectsOf(slide: Slide | undefined): AnimEffect[] {
  if (!slide) return [];
  const ids = new Set(slide.elements.map((e) => e.id));
  if (slide.anims) return slide.anims.filter((a) => ids.has(a.el));
  const legacy = slide.elements
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.animation)
    .sort((a, b) => a.e.animation!.order - b.e.animation!.order || a.i - b.i);
  return legacy.map(({ e }, k) => ({
    id: `legacy-${e.id}`,
    el: e.id,
    cls: "entr" as const,
    ...LEGACY[e.animation!.type],
    start:
      k > 0 && legacy[k - 1].e.animation!.order === e.animation!.order ? ("with" as const) : ("click" as const),
  }));
}

/** withEffects stores `anims` on the slide and drops the pre-M8
 *  `animation` fields (the list is now the source of truth); an empty list
 *  removes `anims`. */
export function withEffects(slide: Slide, anims: AnimEffect[]): Slide {
  const elements = slide.elements.map((e) => {
    if (!e.animation) return e;
    const { animation: _drop, ...rest } = e;
    return rest as SlideElement;
  });
  const { anims: _old, ...base } = slide;
  return anims.length ? { ...base, elements, anims } : { ...base, elements };
}

/** addEffect appends an effect for each target (PowerPoint: the first
 *  starts on click, the rest with it). */
export function addEffect(
  slide: Slide,
  targets: string[],
  cls: AnimClass,
  kind: AnimKind,
  makeId: () => string = uid,
): { slide: Slide; ids: string[] } {
  const list = effectsOf(slide).map(fixLegacyId(makeId));
  const ids: string[] = [];
  targets.forEach((el, i) => {
    const dir = kindDef(cls, kind)?.dirs ? defaultDir(kind) : undefined;
    const e: AnimEffect = { id: makeId(), el, cls, kind, start: i === 0 ? "click" : "with", ...(dir ? { dir } : {}) };
    ids.push(e.id);
    list.push(e);
  });
  return { slide: withEffects(slide, list), ids };
}

function fixLegacyId(makeId: () => string) {
  return (e: AnimEffect): AnimEffect => (e.id.startsWith("legacy-") ? { ...e, id: makeId() } : e);
}

/** updateEffect patches one effect (by id). Changing the kind drops a
 *  direction the new kind does not take and adds its default one. */
export function updateEffect(slide: Slide, id: string, patch: Partial<Omit<AnimEffect, "id">>): Slide {
  const list = effectsOf(slide).map((e) => {
    if (e.id !== id) return e;
    const n: AnimEffect = { ...e, ...patch };
    const def = kindDef(n.cls, n.kind);
    if (!def) {
      n.kind = ANIM_CATALOG[n.cls][0].kind;
    }
    if (kindDef(n.cls, n.kind)?.dirs) n.dir ??= defaultDir(n.kind);
    else delete n.dir;
    for (const k of Object.keys(n) as (keyof AnimEffect)[]) if (n[k] === undefined) delete n[k];
    return n;
  });
  return withEffects(slide, list);
}

/** removeEffects drops the given effects (the shape stays: shortcut #10). */
export function removeEffects(slide: Slide, ids: string[]): Slide {
  const drop = new Set(ids);
  return withEffects(
    slide,
    effectsOf(slide).filter((e) => !drop.has(e.id)),
  );
}

/** removeElementEffects drops every effect on an element. */
export function removeElementEffects(slide: Slide, elId: string): Slide {
  return withEffects(
    slide,
    effectsOf(slide).filter((e) => e.el !== elId),
  );
}

/** moveEffect moves an effect one place earlier (-1) or later (+1). */
export function moveEffect(slide: Slide, id: string, delta: -1 | 1): Slide {
  const list = effectsOf(slide);
  const i = list.findIndex((e) => e.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return slide;
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return withEffects(slide, out);
}

/** remapEffects rewrites effect targets after element ids changed (slide
 *  copy); effects whose element has no new id are dropped. */
export function remapEffects(anims: AnimEffect[] | undefined, idMap: Map<string, string>, makeId: () => string = uid): AnimEffect[] | undefined {
  if (!anims) return undefined;
  const out = anims.filter((a) => idMap.has(a.el)).map((a) => ({ ...a, id: makeId(), el: idMap.get(a.el)! }));
  return out.length ? out : undefined;
}

// ------------------------------------------------------------ timeline

/** One effect instance on the timeline (a paragraph of a by-paragraph
 *  effect is its own instance). */
export interface TimedEffect {
  effect: AnimEffect;
  /** Paragraph index for a by-paragraph effect. */
  para?: number;
  /** The resolved start (paragraphs after the first follow on). */
  start: AnimStart;
  /** Start and end within its click group, ms. */
  begin: number;
  end: number;
}

export interface Timeline {
  /** groups[0] plays when the slide appears (effects before the first
   *  "on click" — possibly none); groups[i ≥ 1] each start on a click. */
  groups: TimedEffect[][];
}

/** Number of paragraphs of a text element ("\n"-separated). */
export function paragraphCount(el: SlideElement | undefined): number {
  if (!el || el.type !== "text") return 1;
  return Math.max(1, (el.text ?? "").split("\n").length);
}

/** expandParagraphs turns a by-paragraph effect on a text box into one
 *  instance per non-empty paragraph. Later paragraphs start on a click
 *  when the effect does, else after the previous one. */
export function expandParagraphs(
  effects: AnimEffect[],
  elOf: (id: string) => SlideElement | undefined,
): { effect: AnimEffect; para?: number; start: AnimStart }[] {
  const out: { effect: AnimEffect; para?: number; start: AnimStart }[] = [];
  for (const e of effects) {
    const el = elOf(e.el);
    if (!e.byPara || !el || el.type !== "text") {
      out.push({ effect: e, start: e.start });
      continue;
    }
    const paras = (el.text ?? "").split("\n");
    let first = true;
    paras.forEach((p, i) => {
      if (!p.trim()) return;
      out.push({ effect: e, para: i, start: first ? e.start : e.start === "click" ? "click" : "after" });
      first = false;
    });
    if (first) out.push({ effect: e, start: e.start });
  }
  return out;
}

/** buildTimeline groups effects into click groups and times them:
 *  "on click" opens a new group at 0; "with previous" starts with the
 *  previous effect; "after previous" starts when everything so far in the
 *  group has ended. Each effect then waits its own delay. */
export function buildTimeline(slide: Slide | undefined): Timeline {
  const effects = effectsOf(slide);
  const elOf = (id: string) => slide?.elements.find((e) => e.id === id);
  const groups: TimedEffect[][] = [[]];
  let parStart = 0;
  for (const { effect, para, start } of expandParagraphs(effects, elOf)) {
    let g = groups[groups.length - 1];
    if (start === "click") {
      g = [];
      groups.push(g);
      parStart = 0;
    } else if (start === "after") {
      parStart = groupEnd(g);
    }
    const begin = parStart + Math.max(0, effect.delay ?? 0);
    g.push({ effect, ...(para !== undefined ? { para } : {}), start, begin, end: begin + effectDur(effect) });
  }
  return { groups };
}

/** groupEnd is when the last effect of a group ends, ms. */
export function groupEnd(g: TimedEffect[]): number {
  return g.reduce((m, t) => Math.max(m, t.end), 0);
}

/** clickSteps is the number of clicks a slide's animations take. */
export function clickSteps(t: Timeline): number {
  return t.groups.length - 1;
}

// ------------------------------------------------------------ frames

/** How an element (or one paragraph, key `id:p<i>`) is drawn at a step. */
export interface ElFrame {
  hidden?: boolean;
  /** CSS animations playing (comma-joined shorthand), when animating. */
  animation?: string;
  /** CSS custom properties the keyframes read. */
  vars?: Record<string, string>;
  /** A grow/shrink that has finished stays scaled. */
  scale?: number;
  /** The click group playing (so a repeated effect remounts and replays). */
  nonce?: number;
}

export function frameKey(t: { effect: AnimEffect; para?: number }): string {
  return t.para === undefined ? t.effect.el : `${t.effect.el}:p${t.para}`;
}

const DIR_SUFFIX: Record<string, string> = { t: "T", b: "B", l: "L", r: "R" };

/** The CSS animation shorthand for one timed effect. */
export function effectCss(t: TimedEffect): string {
  const e = t.effect;
  const dur = Math.max(1, t.end - t.begin);
  const rev = e.cls === "exit" ? " reverse" : "";
  const d = DIR_SUFFIX[e.dir ?? "b"] ?? "B";
  const at = `${t.begin}ms`;
  switch (e.kind) {
    case "appear":
      return `anAppear ${dur}ms step-end ${at} 1${rev} both`;
    case "fade":
      return `anFade ${dur}ms ease ${at} 1${rev} both`;
    case "fly":
      return `anFly${d} ${dur}ms ${e.cls === "exit" ? "ease-in" : "ease-out"} ${at} 1${rev} both`;
    case "float":
      return `anFloat${d} ${dur}ms ease-out ${at} 1${rev} both`;
    case "wipe":
      return `anWipe${d} ${dur}ms linear ${at} 1${rev} both`;
    case "zoom":
      return `anZoom ${dur}ms ease-out ${at} 1${rev} both`;
    case "pulse":
      return `anPulse ${dur}ms ease-in-out ${at} 1 both`;
    case "colorPulse":
      return `anColorPulse ${dur}ms ease-in-out ${at} 1 both`;
    case "teeter":
      return `anTeeter ${dur}ms ease-in-out ${at} 1 both`;
    case "spin":
      return `anSpin ${dur}ms ease-in-out ${at} 1 both`;
    case "grow":
      return `anGrow ${dur}ms ease-in-out ${at} 1 both`;
  }
}

/** Variables for the keyframes: fly distance (from off the slide), grow
 *  factor, pulse colour, spin angle. */
export function effectVars(e: AnimEffect, el: SlideElement | undefined, slideW: number, slideH: number): Record<string, string> {
  const v: Record<string, string> = {};
  if (e.kind === "fly" && el) {
    v["--fl"] = `${-(el.x + el.w) - 10}px`;
    v["--fr"] = `${slideW - el.x + 10}px`;
    v["--ft"] = `${-(el.y + el.h) - 10}px`;
    v["--fb"] = `${slideH - el.y + 10}px`;
  }
  if (e.kind === "grow") v["--grow"] = String(e.scale ?? 1.5);
  if (e.kind === "colorPulse") v["--pulse"] = e.color ?? "#ffb300";
  if (e.kind === "spin") v["--spin"] = `${e.angle ?? 360}deg`;
  return v;
}

/** framesAt returns how each animated element/paragraph is drawn once
 *  `step` click groups have been triggered (group 0 always has). With
 *  `animate`, the last triggered group plays (its effects carry CSS
 *  animations with their begin times as delays); without, everything is
 *  shown in its settled state. `pending` (a slide transition is still
 *  running) holds the last group back: its elements keep their state from
 *  before it. Keys without an entry draw normally. */
export function framesAt(
  slide: Slide | undefined,
  t: Timeline,
  step: number,
  animate: boolean,
  size: { w: number; h: number } = { w: 960, h: 540 },
  pending = false,
): Map<string, ElFrame> {
  const frames = new Map<string, ElFrame>();
  if (!slide) return frames;
  const elOf = (id: string) => slide.elements.find((e) => e.id === id);
  const last = Math.min(Math.max(0, step), t.groups.length - 1);
  // Initial visibility: hidden until the first effect, if that is an entrance.
  const firstCls = new Map<string, AnimClass>();
  for (const g of t.groups)
    for (const te of g) {
      const k = frameKey(te);
      if (!firstCls.has(k)) firstCls.set(k, te.effect.cls);
    }
  const state = new Map<string, { visible: boolean; scale?: number }>();
  for (const [k, c] of firstCls) state.set(k, { visible: c !== "entr" });
  // Settle every completed group (and the last one when not animating).
  for (let gi = 0; gi <= last; gi++) {
    if (gi === last && animate) break;
    for (const te of [...t.groups[gi]].sort((a, b) => a.end - b.end)) {
      const s = state.get(frameKey(te))!;
      if (te.effect.cls === "entr") s.visible = true;
      else if (te.effect.cls === "exit") s.visible = false;
      else if (te.effect.kind === "grow") s.scale = (s.scale ?? 1) * (te.effect.scale ?? 1.5);
    }
  }
  for (const [k, s] of state) frames.set(k, { ...(s.visible ? {} : { hidden: true }), ...(s.scale && s.scale !== 1 ? { scale: s.scale } : {}) });
  if (animate && !pending) {
    const playing = new Map<string, TimedEffect[]>();
    for (const te of t.groups[last] ?? []) {
      const k = frameKey(te);
      playing.set(k, [...(playing.get(k) ?? []), te]);
    }
    for (const [k, list] of playing) {
      const f = frames.get(k) ?? {};
      const vars: Record<string, string> = {};
      for (const te of list) {
        Object.assign(vars, effectVars(te.effect, elOf(te.effect.el), size.w, size.h));
        if (te.effect.kind === "wipe") Object.assign(vars, wipeMask(te.effect.dir));
      }
      // An element entering in this group is drawn by its animation (the
      // keyframes' start state holds it hidden during the delay).
      const entering = list.some((te) => te.effect.cls === "entr");
      frames.set(k, {
        ...(f.hidden && !entering ? { hidden: true } : {}),
        ...(f.scale ? { scale: f.scale } : {}),
        animation: list.map(effectCss).join(", "),
        ...(Object.keys(vars).length ? { vars } : {}),
        nonce: last,
      });
    }
  }
  return frames;
}

/** frameStyle turns a frame into inline CSS for the element (or paragraph). */
export function frameStyle(f: ElFrame | undefined): Record<string, string | number> | undefined {
  if (!f) return undefined;
  const s: Record<string, string | number> = {};
  if (f.hidden) {
    s.opacity = 0;
    s.pointerEvents = "none";
  }
  if (f.scale) s.scale = String(f.scale);
  if (f.animation) s.animation = f.animation;
  if (f.vars) Object.assign(s, f.vars);
  return s;
}

/** Keyframes for effectCss. Individual `translate`/`scale`/`rotate`
 *  properties compose with the element's own rotate/flip `transform`;
 *  wipes use a mask so a shape's clip-path is left alone. */
export const ANIM_CSS = `
@keyframes anAppear { from { opacity: 0; } to { opacity: 1; } }
@keyframes anFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes anFlyL { from { translate: var(--fl) 0; } to { translate: 0 0; } }
@keyframes anFlyR { from { translate: var(--fr) 0; } to { translate: 0 0; } }
@keyframes anFlyT { from { translate: 0 var(--ft); } to { translate: 0 0; } }
@keyframes anFlyB { from { translate: 0 var(--fb); } to { translate: 0 0; } }
@keyframes anFloatB { from { translate: 0 60px; opacity: 0; } to { translate: 0 0; opacity: 1; } }
@keyframes anFloatT { from { translate: 0 -60px; opacity: 0; } to { translate: 0 0; opacity: 1; } }
@keyframes anFloatL { from { translate: -60px 0; opacity: 0; } to { translate: 0 0; opacity: 1; } }
@keyframes anFloatR { from { translate: 60px 0; opacity: 0; } to { translate: 0 0; opacity: 1; } }
@keyframes anWipeL { from { -webkit-mask-position: 100% 0; mask-position: 100% 0; } to { -webkit-mask-position: 0 0; mask-position: 0 0; } }
@keyframes anWipeR { from { -webkit-mask-position: 0 0; mask-position: 0 0; } to { -webkit-mask-position: 100% 0; mask-position: 100% 0; } }
@keyframes anWipeT { from { -webkit-mask-position: 0 100%; mask-position: 0 100%; } to { -webkit-mask-position: 0 0; mask-position: 0 0; } }
@keyframes anWipeB { from { -webkit-mask-position: 0 0; mask-position: 0 0; } to { -webkit-mask-position: 0 100%; mask-position: 0 100%; } }
@keyframes anZoom { from { scale: 0.1; opacity: 0; } to { scale: 1; opacity: 1; } }
@keyframes anPulse { 50% { scale: 1.08; } }
@keyframes anColorPulse { 50% { filter: drop-shadow(0 0 10px var(--pulse)) brightness(1.25); } }
@keyframes anTeeter { 20% { rotate: 4deg; } 40% { rotate: -4deg; } 60% { rotate: 4deg; } 80% { rotate: -4deg; } }
@keyframes anSpin { from { rotate: 0deg; } to { rotate: var(--spin); } }
@keyframes anGrow { to { scale: var(--grow); } }
`;

/** Mask setup for a wipe (set on the element while a wipe plays). */
export function wipeMask(dir: AnimEffect["dir"]): Record<string, string> {
  const to = dir === "r" ? "left" : dir === "t" ? "bottom" : dir === "b" ? "top" : "right";
  const horiz = dir === "l" || dir === "r";
  const img = `linear-gradient(to ${to}, #000 50%, transparent 50%)`;
  const size = horiz ? "200% 100%" : "100% 200%";
  return {
    WebkitMaskImage: img,
    maskImage: img,
    WebkitMaskSize: size,
    maskSize: size,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  };
}
