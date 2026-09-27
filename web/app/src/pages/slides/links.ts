// Hyperlink targets for slides: external URLs (classified by the shared
// lib/urlType) and jumps inside the deck. A slide jump is stored as an
// in-document anchor so lib/urlType already classes it as "internal":
//   #slide:first  #slide:last  #slide:next  #slide:prev  #slide:<slideId>
// pptx expresses the same targets as `ppaction://hlinkshowjump?jump=…`
// (first/last/next/previous) and `ppaction://hlinksldjump` + a slide
// relationship (a specific slide).

import { normalizeLink, type UrlType } from "../../lib/urlType";
import type { Slide } from "./model";

export type SlideJump = "first" | "last" | "next" | "prev";
export type SlideTarget = SlideJump | { id: string };

export const SLIDE_LINK_PREFIX = "#slide:";
const JUMPS: SlideJump[] = ["first", "last", "next", "prev"];

/** slideLink builds the stored href for a slide target. */
export function slideLink(t: SlideTarget): string {
  return SLIDE_LINK_PREFIX + (typeof t === "string" ? t : t.id);
}

/** parseSlideLink reads a stored slide href, or null for any other link. */
export function parseSlideLink(url: string | undefined): SlideTarget | null {
  if (!url || !url.startsWith(SLIDE_LINK_PREFIX)) return null;
  const v = url.slice(SLIDE_LINK_PREFIX.length);
  if (!v) return null;
  return (JUMPS as string[]).includes(v) ? (v as SlideJump) : { id: v };
}

/** resolveSlideLink returns the slide index a slide link jumps to from slide
 *  `cur`, or null (not a slide link, a deleted slide, or past either end). */
export function resolveSlideLink(url: string | undefined, slides: readonly Slide[], cur: number): number | null {
  const t = parseSlideLink(url);
  if (!t || !slides.length) return null;
  switch (t) {
    case "first":
      return 0;
    case "last":
      return slides.length - 1;
    case "next":
      return cur + 1 < slides.length ? cur + 1 : null;
    case "prev":
      return cur > 0 ? cur - 1 : null;
    default: {
      const i = slides.findIndex((s) => s.id === t.id);
      return i >= 0 ? i : null;
    }
  }
}

const SHOWJUMP: Record<string, SlideJump> = {
  firstslide: "first",
  lastslide: "last",
  nextslide: "next",
  previousslide: "prev",
};

/** fromPpAction maps a pptx `hlinkClick@action` to a slide href. For
 *  `hlinksldjump` pass the id of the slide its relationship targets. */
export function fromPpAction(action: string | null | undefined, targetSlideId?: string): string | null {
  if (!action) return null;
  const m = /^ppaction:\/\/hlinkshowjump\?jump=([a-z]+)/i.exec(action);
  if (m) {
    const j = SHOWJUMP[m[1].toLowerCase()];
    return j ? slideLink(j) : null;
  }
  if (/^ppaction:\/\/hlinksldjump/i.test(action)) return targetSlideId ? slideLink({ id: targetSlideId }) : null;
  return null;
}

/** toPpAction maps a slide href to its pptx action; `slideIndex` (0-based)
 *  is set for a specific slide, which needs a slide relationship. */
export function toPpAction(
  url: string,
  slides: readonly Slide[],
): { action: string; slideIndex?: number } | null {
  const t = parseSlideLink(url);
  if (!t) return null;
  if (typeof t === "string") {
    const jump = Object.entries(SHOWJUMP).find(([, v]) => v === t)![0];
    return { action: `ppaction://hlinkshowjump?jump=${jump}` };
  }
  const i = slides.findIndex((s) => s.id === t.id);
  return i >= 0 ? { action: "ppaction://hlinksldjump", slideIndex: i } : null;
}

export type LinkKind = UrlType | "slide";

/** classifyLink classifies user input for the hyperlink dialog: slide
 *  hrefs are "slide"; anything else goes through lib/urlType. */
export function classifyLink(input: string): { kind: LinkKind; href: string } {
  const s = input.trim();
  if (parseSlideLink(s)) return { kind: "slide", href: s };
  const { type, href } = normalizeLink(s);
  return { kind: type, href };
}

/** A short human label for a link ("Next slide", "Slide 3", the URL). */
export function linkLabel(url: string, slides: readonly Slide[]): string {
  const t = parseSlideLink(url);
  if (!t) return url.replace(/^mailto:/i, "");
  if (t === "first") return "First slide";
  if (t === "last") return "Last slide";
  if (t === "next") return "Next slide";
  if (t === "prev") return "Previous slide";
  const i = slides.findIndex((s) => s.id === t.id);
  return i >= 0 ? `Slide ${i + 1}` : "Missing slide";
}

/** A short title for a slide (its first text), for the slide picker. */
export function slideTitle(s: Slide): string {
  for (const el of s.elements) {
    const t = (el.text || "").split(/[\n\v]/)[0].trim();
    if (el.type === "text" && t) return t.length > 40 ? `${t.slice(0, 40)}…` : t;
  }
  return "";
}
