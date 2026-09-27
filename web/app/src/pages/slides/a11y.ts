// Accessibility helpers for the Slides editor (M13): the accessible names
// of slides and objects, the screen-reader announcement for a selection,
// and the reduced-motion preference. Pure except `prefersReducedMotion`.

import type { Slide, SlideElement } from "./model";
import { PRESET_GALLERY } from "./presetDefs";
import { slideTitle } from "./links";

const KIND: Partial<Record<SlideElement["type"], string>> = {
  text: "Text box",
  rect: "Rectangle",
  ellipse: "Oval",
  image: "Picture",
  line: "Line",
  triangle: "Triangle",
  diamond: "Diamond",
  rightArrow: "Arrow",
  roundRect: "Rounded rectangle",
  table: "Table",
  group: "Group",
  connector: "Connector",
  chart: "Chart",
};

let presetLabels: Map<string, string> | null = null;
function presetLabel(prst: string | undefined): string | undefined {
  if (!prst) return undefined;
  if (!presetLabels) presetLabels = new Map(PRESET_GALLERY.flatMap((g) => g.items.map((i) => [i.prst.split(":")[0], i.label] as [string, string])));
  return presetLabels.get(prst);
}

const clip = (t: string, n = 60) => {
  const s = t.replace(/[\n\v]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** elementKind is the spoken kind of an object ("Text box", "Picture",
 *  "Shape: Star", "Chart: Column", "Video", "Diagram"…). */
export function elementKind(el: SlideElement): string {
  if (el.diagram) return "Diagram";
  if (el.type === "media") return el.media?.kind === "audio" ? "Audio" : "Video";
  if (el.type === "chart") return el.chart ? `Chart: ${el.chart.type}` : "Chart";
  if (el.type === "shape") return `Shape: ${presetLabel(el.preset) ?? el.preset ?? "custom"}`;
  if (el.type === "text" && el.wordArt) return "Word art";
  if (el.type === "text" && el.placeholder) {
    const t = el.placeholder.type;
    return t === "title" || t === "ctrTitle" ? "Title" : t === "subTitle" ? "Subtitle" : "Text box";
  }
  return KIND[el.type] ?? "Object";
}

/** elementLabel is an object's accessible name: its kind, then the alt text
 *  (pictures, charts, clips, shapes), else its text, else its name. */
export function elementLabel(el: SlideElement): string {
  const kind = elementKind(el);
  const alt = el.alt?.trim();
  if (alt) return `${kind}: ${clip(alt, 120)}`;
  if (el.type === "table" && el.table) return `${kind}, ${el.table.rows} rows by ${el.table.cols} columns`;
  if (el.type === "chart" && el.chart?.title) return `${kind}: ${clip(el.chart.title)}`;
  const text = clip(el.text || "");
  if (text) return `${kind}: ${text}`;
  if (el.type === "group") return `${kind} of ${el.children?.length ?? 0} objects`;
  return el.name ? `${kind}: ${el.name}` : kind;
}

/** slideLabel names a slide in the rail: "Slide 3 of 10: Title, hidden". */
export function slideLabel(slide: Slide, i: number, count: number): string {
  const t = slideTitle(slide);
  return `Slide ${i + 1} of ${count}${t ? `: ${t}` : ""}${slide.hidden ? ", hidden" : ""}`;
}

/** selectionAnnouncement is what a screen reader hears when the selection
 *  on the canvas changes. */
export function selectionAnnouncement(els: readonly SlideElement[]): string {
  if (!els.length) return "No object selected";
  if (els.length === 1) return `${elementLabel(els[0])}, selected${els[0].locked ? ", locked" : ""}`;
  return `${els.length} objects selected`;
}

/** Objects without alt text that need one (pictures, charts, clips): the
 *  accessibility check PowerPoint runs before sharing. */
export function missingAltText(slides: readonly Slide[]): { slide: number; el: SlideElement }[] {
  const out: { slide: number; el: SlideElement }[] = [];
  const walk = (els: readonly SlideElement[], i: number) => {
    for (const e of els) {
      if (e.children) walk(e.children, i);
      else if ((e.type === "image" || e.type === "chart" || e.type === "media") && !e.alt?.trim()) out.push({ slide: i, el: e });
    }
  };
  slides.forEach((s, i) => walk(s.elements, i));
  return out;
}

/** prefersReducedMotion reads the OS "reduce motion" setting. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
