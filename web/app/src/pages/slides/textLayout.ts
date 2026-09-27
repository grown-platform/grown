// Text layout shared by every renderer (SlideView/SlideCanvas in React, the
// HTML/PDF export as strings, the rich editor's DOM): per-run CSS, per-
// paragraph CSS, list markers. Pure: returns camelCase style records.

import type { ParaProps, SlideElement, TextRun } from "./model";
import { INDENT_STEP } from "./model";
import { effective, listMarkers, paragraphs, paraIndent, type Paragraph } from "./textOps";

export type Css = Record<string, string | number>;

/** Colour of a link run that sets no colour of its own. */
export const LINK_COLOR = "#1155cc";
/** Super/subscript size relative to the run's font size. */
export const SCRIPT_SCALE = 0.65;

/** isRich reports whether a text element needs the paragraph/run renderer
 *  (a plain element keeps the original single pre-wrap block). */
export function isRich(el: SlideElement): boolean {
  return !!(el.runs || el.paras || el.list || el.baseline || /\v/.test(el.text || ""));
}

/** CSS for one run: every character property is written out (so a run can
 *  turn off an element-level underline, which CSS would otherwise draw
 *  through the whole box). */
export function runCss(el: SlideElement, r: TextRun): Css {
  const size = effective(el, r, "fontSize") as number;
  const url = r.url;
  const underline = !!effective(el, r, "underline") || !!url;
  const strike = !!effective(el, r, "strike");
  const baseline = effective(el, r, "baseline");
  const css: Css = {
    fontWeight: effective(el, r, "bold") ? 700 : 400,
    fontStyle: effective(el, r, "italic") ? "italic" : "normal",
    textDecoration: [underline ? "underline" : "", strike ? "line-through" : ""].filter(Boolean).join(" ") || "none",
    fontSize: baseline ? Math.round(size * SCRIPT_SCALE * 100) / 100 : size,
  };
  const fam = effective(el, r, "fontFamily");
  if (fam) css.fontFamily = fam as string;
  const color = r.color ?? (url ? LINK_COLOR : el.color);
  if (color) css.color = color;
  if (baseline) css.verticalAlign = baseline === "super" ? "super" : "sub";
  return css;
}

/** CSS for a paragraph block. */
export function paraCss(el: SlideElement, p: ParaProps, marker: boolean): Css {
  const css: Css = {
    textAlign: p.align ?? el.align ?? "left",
    paddingInlineStart: paraIndent(el, p),
  };
  if (marker) css.textIndent = -INDENT_STEP;
  if (el.spaceBefore) css.marginTop = el.spaceBefore;
  if (el.spaceAfter) css.marginBottom = el.spaceAfter;
  return css;
}

/** CSS for a list marker (sized/coloured like the paragraph's first run). */
export function markerCss(el: SlideElement, p: Paragraph): Css {
  const r = p.runs[0] ?? { text: "" };
  const css: Css = { display: "inline-block", width: INDENT_STEP, textIndent: 0, textDecoration: "none" };
  css.fontSize = effective(el, r, "fontSize") as number;
  const color = r.color ?? el.color;
  if (color) css.color = color;
  return css;
}

export interface LaidParagraph extends Paragraph {
  marker: string;
}

/** layoutParagraphs pairs each paragraph with its list marker. */
export function layoutParagraphs(el: SlideElement): LaidParagraph[] {
  const marks = listMarkers(el);
  return paragraphs(el).map((p, i) => ({ ...p, marker: marks[i] ?? "" }));
}

/** camelCase style record → inline CSS text. */
export function cssText(css: Css): string {
  return Object.entries(css)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${typeof v === "number" && k !== "fontWeight" ? `${v}px` : v}`)
    .join(";");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** textBodyHtml renders a rich text element's paragraphs as HTML (for the
 *  HTML/PDF export). Links become <a>; slide links become #slide-N. */
export function textBodyHtml(el: SlideElement, slideHref?: (url: string) => string | null): string {
  const laid = layoutParagraphs(el);
  return laid
    .map((p) => {
      const inner = p.runs
        .map((r) => {
          const t = r.text.split("\v").map(esc).join("<br/>");
          const span = `<span style="${cssText(runCss(el, r))}">${t}</span>`;
          if (!r.url) return span;
          const href = slideHref ? slideHref(r.url) : r.url;
          return href ? `<a href="${esc(href)}" style="color:inherit">${span}</a>` : span;
        })
        .join("");
      const trail = !p.runs.length || /\v$/.test(p.runs[p.runs.length - 1].text) ? "<br/>" : "";
      const marker = p.marker ? `<span style="${cssText(markerCss(el, p))}">${esc(p.marker)}</span>` : "";
      return `<div style="${cssText(paraCss(el, p.props, !!p.marker))}">${marker}${inner}${trail}</div>`;
    })
    .join("");
}
