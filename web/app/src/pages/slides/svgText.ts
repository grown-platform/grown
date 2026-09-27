// Text layout for the SVG-based exports (SVG/PNG/JPEG, the PDF file and the
// print pages): SVG <text> does not wrap, so paragraphs are broken into
// visual lines here, the way the HTML renderer's CSS would, from measured
// run widths. Pure given a `Measure`; the browser measures with a canvas.

import { INDENT_STEP, type SlideElement, type TextRun } from "./model";
import { effective, insetsOf, listMarkers, paragraphs, paraIndent } from "./textOps";
import { SCRIPT_SCALE } from "./textLayout";

/** Width in px of `text` set in the CSS `font` shorthand. */
export type Measure = (text: string, font: string, size: number) => number;

/** A rough width model (0.52 em per character, 0.28 em per space) for
 *  environments without a canvas (tests, SSR). */
export const estimateMeasure: Measure = (text, _font, size) => {
  let w = 0;
  for (const ch of text) w += ch === " " ? 0.28 : /[A-ZMW@%&mw]/.test(ch) ? 0.72 : /[il.,;:'|!]/.test(ch) ? 0.26 : 0.52;
  return w * size;
};

let ctx2d: CanvasRenderingContext2D | null | undefined;
/** canvasMeasure measures with a 2D canvas (the browser's own font metrics),
 *  falling back to the estimate where there is none. */
export const canvasMeasure: Measure = (text, font, size) => {
  if (ctx2d === undefined) {
    ctx2d = null;
    try {
      const jsdom = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
      if (!jsdom && typeof document !== "undefined") ctx2d = document.createElement("canvas").getContext("2d");
    } catch {
      ctx2d = null;
    }
  }
  if (!ctx2d) return estimateMeasure(text, font, size);
  ctx2d.font = font;
  return ctx2d.measureText(text).width;
};

/** One styled piece of a visual line. */
export interface LineSeg {
  text: string;
  run: TextRun;
  /** Left edge in slide coordinates. */
  x: number;
  w: number;
  size: number;
  font: string;
}

/** One visual line of a text element, in slide coordinates. */
export interface TextLine {
  segs: LineSeg[];
  /** Baseline. */
  y: number;
  /** The line's largest font size. */
  size: number;
  /** List marker drawn before the first line of a paragraph. */
  marker?: { text: string; x: number; size: number; color?: string };
}

function fontOf(el: SlideElement, r: TextRun, size: number): string {
  const fam = (effective(el, r, "fontFamily") as string | undefined) || el.fontFamily || "Arial";
  return `${effective(el, r, "italic") ? "italic " : ""}${effective(el, r, "bold") ? "bold " : ""}${size}px ${fam}`;
}

function runSize(el: SlideElement, r: TextRun): number {
  const s = (effective(el, r, "fontSize") as number) || el.fontSize || 18;
  return effective(el, r, "baseline") ? s * SCRIPT_SCALE : s;
}

interface Token {
  text: string;
  run: TextRun;
  size: number;
  font: string;
  w: number;
  space: boolean;
}

/**
 * layoutTextLines breaks a text element into positioned lines: word wrap at
 * the box width (minus insets and the paragraph indent), forced breaks at
 * "\v", alignment, line spacing, space before/after and vertical anchoring.
 * A single word wider than the box is broken between characters.
 */
export function layoutTextLines(el: SlideElement, measure: Measure = estimateMeasure): TextLine[] {
  const ins = insetsOf(el);
  const left = el.x + ins.l;
  const inner = Math.max(1, el.w - ins.l - ins.r);
  const spacing = el.lineSpacing || 1.2;
  const marks = listMarkers(el);
  const out: TextLine[] = [];
  let y = 0; // top of the next line, relative to the content top
  paragraphs(el).forEach((p, pi) => {
    const indent = paraIndent(el, p.props);
    const avail = Math.max(1, inner - indent);
    const align = p.props.align ?? el.align ?? "left";
    if (pi > 0 && el.spaceBefore) y += el.spaceBefore;
    // Forced lines (split at \v), each a token stream.
    const forced: Token[][] = [[]];
    for (const r of p.runs) {
      const size = runSize(el, r);
      const font = fontOf(el, r, size);
      r.text.split("\v").forEach((t, j) => {
        if (j > 0) forced.push([]);
        for (const part of t.split(/(\s+)/)) {
          if (!part) continue;
          forced[forced.length - 1].push({ text: part, run: r, size, font, w: measure(part, font, size), space: /^\s+$/.test(part) });
        }
      });
    }
    const baseSize = runSize(el, p.runs[0] ?? { text: "" });
    let first = true;
    for (const tokens of forced) {
      // Greedy wrap.
      const lines: Token[][] = [[]];
      let w = 0;
      for (const tok of tokens) {
        let cur = lines[lines.length - 1];
        if (!tok.space && w + tok.w > avail && cur.some((t) => !t.space)) {
          lines.push([]);
          cur = lines[lines.length - 1];
          w = 0;
        }
        if (tok.space && !cur.length && lines.length > 1) continue; // no leading space on a wrapped line
        if (!tok.space && tok.w > avail && !cur.length) {
          // Break an over-long word between characters.
          let piece = "";
          for (const ch of tok.text) {
            const pw = measure(piece + ch, tok.font, tok.size);
            if (pw > avail && piece) {
              lines[lines.length - 1].push({ ...tok, text: piece, w: measure(piece, tok.font, tok.size) });
              lines.push([]);
              piece = ch;
            } else piece += ch;
          }
          const rest = { ...tok, text: piece, w: measure(piece, tok.font, tok.size) };
          lines[lines.length - 1].push(rest);
          w = rest.w;
          continue;
        }
        cur.push(tok);
        w += tok.w;
      }
      for (const toks of lines) {
        // Trailing spaces do not count for alignment.
        let end = toks.length;
        while (end > 0 && toks[end - 1].space) end--;
        const width = toks.slice(0, end).reduce((s, t) => s + t.w, 0);
        const size = toks.reduce((m, t) => Math.max(m, t.size), 0) || baseSize;
        const lineH = size * spacing;
        let x = left + indent;
        if (align === "center") x += (avail - width) / 2;
        else if (align === "right") x += avail - width;
        const segs: LineSeg[] = [];
        for (const t of toks.slice(0, end)) {
          const last = segs[segs.length - 1];
          if (last && last.run === t.run) {
            last.text += t.text;
            last.w += t.w;
          } else segs.push({ text: t.text, run: t.run, x, w: t.w, size: t.size, font: t.font });
          x += t.w;
        }
        const line: TextLine = { segs, y: y + (lineH - size) / 2 + size * 0.9, size };
        if (first && marks[pi]) {
          const r0 = p.runs[0] ?? { text: "" };
          line.marker = { text: marks[pi], x: left + indent - INDENT_STEP, size: (effective(el, r0, "fontSize") as number) || el.fontSize || 18, color: r0.color ?? el.color };
        }
        first = false;
        out.push(line);
        y += lineH;
      }
    }
    if (el.spaceAfter) y += el.spaceAfter;
  });
  // Vertical anchoring inside the box.
  const innerH = el.h - ins.t - ins.b;
  const top = el.y + ins.t + (el.valign === "middle" ? (innerH - y) / 2 : el.valign === "bottom" ? innerH - y : 0);
  for (const l of out) l.y += top;
  return out;
}

/** Plain text of a laid-out line (for the PDF text layer). */
export function lineText(l: TextLine): string {
  return (l.marker ? `${l.marker.text} ` : "") + l.segs.map((s) => s.text).join("");
}
