// Pure slideshow logic (M9): the navigation reducer (animation steps,
// next/prev/first/last, number + Enter go-to, black/white screen, loop,
// end-of-show), auto-advance timing, and the presenter/audience sync
// messages. Hidden slides are removed before the show (slideProps.showSlides).

import type { Slide } from "./model";
import { buildTimeline, clickSteps, groupEnd, type Timeline } from "./animOps";

export interface PresentState {
  /** Current index into the shown slides. */
  cur: number;
  /** Click groups triggered on the current slide (0 = none yet). */
  step: number;
  /** Whether the latest step plays (false: shown settled, e.g. after Prev). */
  animate: boolean;
  /** Black or white screen over the show (B / W). */
  blank: "black" | "white" | null;
  /** Digits typed for "number + Enter". */
  digits: string;
  /** Past the last slide: the "End of slide show" screen. */
  ended: boolean;
  /** Next on the end screen (or Esc) leaves the show. */
  exited: boolean;
}

export type PresentAction =
  | "next"
  | "prev"
  | "first"
  | "last"
  | "enter"
  | "black"
  | "white"
  | { digit: string }
  | { goto: number };

export interface ShowOptions {
  /** Start over after the last slide instead of ending (loop until Esc). */
  loop?: boolean;
}

export function initialPresent(cur = 0): PresentState {
  return { cur, step: 0, animate: true, blank: null, digits: "", ended: false, exited: false };
}

/** stepsOf is the number of click steps of each slide. */
export function stepsOf(slides: Slide[]): number[] {
  return slides.map((s) => clickSteps(buildTimeline(s)));
}

/** presentReduce advances a slideshow. "next" plays the slide's remaining
 *  click steps, then moves on; past the last slide it loops or shows the
 *  end screen (a further "next" exits). "prev" undoes a step, else goes to
 *  the previous slide fully built. Home/End go to the first/last slide;
 *  digits then Enter go to that slide (Enter alone is "next"). B/W toggle
 *  a black/white screen; any navigation clears it. */
export function presentReduce(
  s: PresentState,
  a: PresentAction,
  steps: number[],
  opts: ShowOptions = {},
): PresentState {
  const n = steps.length;
  if (!n) return s;
  const at = (cur: number, step = 0, animate = true): PresentState => ({
    ...s,
    cur,
    step,
    animate,
    blank: null,
    digits: "",
    ended: false,
  });
  if (typeof a === "object" && "digit" in a) {
    return /^\d$/.test(a.digit) ? { ...s, digits: (s.digits + a.digit).slice(-4) } : s;
  }
  if (typeof a === "object") return at(Math.max(0, Math.min(n - 1, a.goto)));
  switch (a) {
    case "black":
    case "white":
      return { ...s, blank: s.blank === a ? null : a, digits: "" };
    case "enter":
      if (s.digits) return at(Math.max(0, Math.min(n - 1, Number(s.digits) - 1)));
      return presentReduce(s, "next", steps, opts);
    case "first":
      return at(0);
    case "last":
      return at(n - 1);
    case "next":
      if (s.blank) return { ...s, blank: null, digits: "" };
      if (s.ended) return { ...s, exited: true };
      if (s.step < steps[s.cur]) return at(s.cur, s.step + 1);
      if (s.cur < n - 1) return at(s.cur + 1);
      if (opts.loop) return at(0);
      return { ...at(s.cur, s.step, false), ended: true };
    case "prev":
      if (s.blank) return { ...s, blank: null, digits: "" };
      if (s.ended) return at(s.cur, steps[s.cur], false);
      if (s.step > 0) return at(s.cur, s.step - 1, false);
      if (s.cur > 0) return at(s.cur - 1, steps[s.cur - 1], false);
      if (opts.loop) return at(n - 1, steps[n - 1], false);
      return s;
  }
}

/** autoAdvanceDelay is how long until the show advances by itself, ms, or
 *  null when it waits for a click. A slide with "advance after N" moves on
 *  N ms after it appeared, but never before the playing step has finished
 *  (remaining click steps then play back to back). Without a timing, only
 *  the automatic effects run and the show waits. */
export function autoAdvanceDelay(
  slide: Slide | undefined,
  t: Timeline,
  step: number,
  slideElapsed: number,
  stepElapsed: number,
): number | null {
  if (!slide || slide.advanceAfter === undefined || slide.advanceAfter < 0) return null;
  const g = t.groups[Math.min(step, t.groups.length - 1)] ?? [];
  const rest = Math.max(0, groupEnd(g) - stepElapsed);
  return Math.max(0, slide.advanceAfter - slideElapsed, rest);
}

/** clickAdvances reports whether a click on the slide advances the show
 *  (PowerPoint "On mouse click", default on). */
export function clickAdvances(slide: Slide | undefined): boolean {
  return slide?.advanceOnClick !== false;
}

/** nextSlideIndex is cur+1 clamped to the last slide. */
export function nextSlideIndex(cur: number, count: number): number {
  return Math.min(count - 1, cur + 1);
}

/** prevSlideIndex is cur-1 clamped to 0. */
export function prevSlideIndex(cur: number): number {
  return Math.max(0, cur - 1);
}

/** Elapsed show time as mm:ss (h:mm:ss past an hour). */
export function formatElapsed(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${String(m).padStart(2, "0")}:${sec}`;
}

// ------------------------------------------------------------ presenter sync

/** Messages on the show's BroadcastChannel (`showChannel(deckId)`): the
 *  audience window owns the state and sends `state` (and the slides on
 *  `hello`); the presenter window sends navigation `cmd`s. */
export type ShowMessage =
  | { t: "hello" }
  | { t: "slides"; slides: Slide[]; h?: number }
  | { t: "state"; state: PresentState; startedAt: number }
  | { t: "cmd"; action: PresentAction }
  | { t: "exit" }
  | { t: "end" };

export function showChannel(deckId: string): string {
  return `grown-slides-show:${deckId}`;
}

/** isShowMessage validates a message from the channel. */
export function isShowMessage(m: unknown): m is ShowMessage {
  if (!m || typeof m !== "object") return false;
  const t = (m as { t?: unknown }).t;
  switch (t) {
    case "hello":
    case "exit":
    case "end":
      return true;
    case "slides":
      return Array.isArray((m as { slides?: unknown }).slides);
    case "state":
      return typeof (m as { state?: { cur?: unknown } }).state?.cur === "number";
    case "cmd":
      return (m as { action?: unknown }).action !== undefined;
    default:
      return false;
  }
}
