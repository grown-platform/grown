// Pure present-mode (slideshow) logic: animation step ordering, which elements
// are revealed, and the next/previous navigation reducer.

import type { Slide, TransitionType } from "./model";

/** animationSteps returns the sorted unique click-order values of the animated
 *  elements on a slide. Elements sharing an order play on the same click. */
export function animationSteps(slide: Slide | undefined): number[] {
  if (!slide) return [];
  const orders = new Set<number>();
  for (const el of slide.elements) {
    if (el.animation) orders.add(el.animation.order);
  }
  return Array.from(orders).sort((a, b) => a - b);
}

/** revealedElementIds returns the ids of elements visible after `animStep`
 *  clicks: every un-animated element plus animated ones whose order is at or
 *  before the step's order. */
export function revealedElementIds(
  slide: Slide | undefined,
  steps: number[],
  animStep: number,
): Set<string> {
  const ids = new Set<string>();
  if (!slide) return ids;
  const maxOrder = animStep > 0 ? steps[animStep - 1] : -Infinity;
  for (const el of slide.elements) {
    if (!el.animation || el.animation.order <= maxOrder) ids.add(el.id);
  }
  return ids;
}

export interface PresentState {
  /** Current slide index. */
  cur: number;
  /** Number of animation steps revealed on the current slide. */
  animStep: number;
}

export type PresentAction = "next" | "prev";

/** presentReduce advances or rewinds a slideshow. "next" first plays any
 *  remaining animation steps on the current slide, then moves to the next
 *  slide (clamped at the last one). "prev" moves to the previous slide
 *  (clamped at 0). Changing slide resets the animation step. */
export function presentReduce(
  state: PresentState,
  action: PresentAction,
  slides: Slide[],
): PresentState {
  if (action === "next") {
    const steps = animationSteps(slides[state.cur]);
    if (state.animStep < steps.length)
      return { ...state, animStep: state.animStep + 1 };
    const cur = nextSlideIndex(state.cur, slides.length);
    return cur === state.cur ? state : { cur, animStep: 0 };
  }
  const cur = prevSlideIndex(state.cur);
  return cur === state.cur ? state : { cur, animStep: 0 };
}

/** nextSlideIndex is cur+1 clamped to the last slide. */
export function nextSlideIndex(cur: number, count: number): number {
  return Math.min(count - 1, cur + 1);
}

/** prevSlideIndex is cur-1 clamped to 0. */
export function prevSlideIndex(cur: number): number {
  return Math.max(0, cur - 1);
}

/** transitionAnimation maps a slide transition to its CSS animation shorthand
 *  (keyframes defined in DeckEditor's TRANSITION_CSS). */
export function transitionAnimation(t?: TransitionType): string | undefined {
  switch (t) {
    case "fade":
      return "slidesFade 350ms ease";
    case "slide-left":
      return "slidesFromRight 350ms ease";
    case "slide-right":
      return "slidesFromLeft 350ms ease";
    case "slide-up":
      return "slidesFromBottom 350ms ease";
    default:
      return undefined;
  }
}
