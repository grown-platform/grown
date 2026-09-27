// Pure text-run operations for slide text boxes (Flagged exception F1).
//
// A text element keeps `text` as its plain-text mirror. Mixed formatting
// lives in the optional `runs` (whose texts concatenate to `text`) and
// per-paragraph level/alignment in `paras`. Offsets are UTF-16 indices into
// `text`; "\n" separates paragraphs and "\v" is a line break inside one.
//
// Every operation returns a new element, normalised: adjacent runs with the
// same style are merged, run values equal to the element's own are dropped,
// a style shared by every run moves up to the element, and `runs`/`paras`
// disappear when they carry nothing. So an element that was never
// formatted per range keeps the exact shape older readers expect.

import {
  INDENT_STEP,
  MAX_LEVEL,
  type ParaProps,
  type RunStyle,
  type SlideElement,
  type TextAlign,
  type TextInsets,
  type TextRun,
  DEFAULT_INSET,
} from "./model";
import { caseChars, isWordChar, type CaseMode } from "../../lib/textCase";

export type StyleKey = keyof RunStyle;
export const STYLE_KEYS: StyleKey[] = [
  "bold",
  "italic",
  "underline",
  "strike",
  "baseline",
  "fontSize",
  "fontFamily",
  "color",
  "url",
];
/** Keys that move up to the element when every run agrees (not `url`: an
 *  element url is a whole-box link, a run url is a text link). */
const PROMOTABLE: StyleKey[] = STYLE_KEYS.filter((k) => k !== "url");
/** Character formatting captured by paint format / removed by clear. */
export const FORMAT_KEYS: StyleKey[] = PROMOTABLE;

export type BoolKey = "bold" | "italic" | "underline" | "strike";

const DEFAULT_FONT_SIZE = 18;

// ---------------------------------------------------------------- basics

export function runsText(runs: readonly TextRun[]): string {
  return runs.map((r) => r.text).join("");
}

/** The element's runs; a plain element (or stale runs whose text no longer
 *  matches the mirror, e.g. after an edit by an older client) is one run. */
export function elementRuns(el: SlideElement): TextRun[] {
  const text = el.text || "";
  if (el.runs && el.runs.length && runsText(el.runs) === text)
    return el.runs.map((r) => ({ ...r }));
  return [{ text }];
}

/** The element-level (inherited) value of a style key. */
export function elementValue(el: SlideElement, k: StyleKey): RunStyle[StyleKey] {
  switch (k) {
    case "bold":
    case "italic":
    case "underline":
    case "strike":
      return !!el[k];
    case "fontSize":
      return el.fontSize ?? DEFAULT_FONT_SIZE;
    case "baseline":
      return el.baseline;
    case "url":
      return undefined;
    default:
      return el[k];
  }
}

/** The effective value of `k` for a run of `el`. */
export function effective(el: SlideElement, run: RunStyle, k: StyleKey): RunStyle[StyleKey] {
  return run[k] !== undefined ? run[k] : elementValue(el, k);
}

/** Full effective character style of a run (url included). */
export function effectiveStyle(el: SlideElement, run: RunStyle): RunStyle {
  const out: RunStyle = {};
  for (const k of STYLE_KEYS) {
    const v = effective(el, run, k);
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function styleOf(r: RunStyle): RunStyle {
  const out: RunStyle = {};
  for (const k of STYLE_KEYS)
    if (r[k] !== undefined) (out as Record<string, unknown>)[k] = r[k];
  return out;
}

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return STYLE_KEYS.every((k) => a[k] === b[k]);
}

/** Merge adjacent same-style runs and drop empty ones (keeping one). */
export function mergeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) last.text += r.text;
    else out.push({ ...styleOf(r), text: r.text });
  }
  if (!out.length) out.push({ ...styleOf(runs[0] ?? { text: "" }), text: "" });
  return out;
}

export function paraCount(text: string): number {
  return text.split("\n").length;
}

/**
 * withRuns returns `el` with `runs` as its content, normalised (see the
 * file comment). `paras` is trimmed to the paragraph count.
 */
export function withRuns(el: SlideElement, runs: readonly TextRun[], paras?: ParaProps[]): SlideElement {
  const out: SlideElement = { ...el };
  let rs = mergeRuns(canonBreaks(runs));
  const nonEmpty = rs.filter((r) => r.text);
  // Promote a value every run shares up to the element.
  for (const k of PROMOTABLE) {
    if (!nonEmpty.length) break;
    const v0 = effective(out, nonEmpty[0], k);
    if (!nonEmpty.every((r) => effective(out, r, k) === v0)) continue;
    setElementValue(out, k, v0);
    rs = rs.map((r) => {
      const c = { ...r };
      delete c[k];
      return c;
    });
  }
  // Drop run values equal to the element's own.
  rs = rs.map((r) => {
    const c = { ...r };
    for (const k of STYLE_KEYS) if (c[k] !== undefined && c[k] === elementValue(out, k)) delete c[k];
    return c;
  });
  rs = mergeRuns(rs);
  out.text = runsText(rs);
  if (rs.some((r) => STYLE_KEYS.some((k) => r[k] !== undefined))) out.runs = rs;
  else delete out.runs;
  const p = normParas(paras ?? el.paras, paraCount(out.text));
  if (p) out.paras = p;
  else delete out.paras;
  return out;
}

function setElementValue(el: SlideElement, k: StyleKey, v: RunStyle[StyleKey]) {
  const rec = el as unknown as Record<string, unknown>;
  if (k === "bold" || k === "italic" || k === "underline" || k === "strike") {
    if (v) rec[k] = true;
    else delete rec[k];
  } else if (v === undefined) delete rec[k];
  else rec[k] = v;
}

function normParas(paras: ParaProps[] | undefined, n: number): ParaProps[] | undefined {
  if (!paras) return undefined;
  const out: ParaProps[] = [];
  for (let i = 0; i < n; i++) {
    const p = paras[i] ?? {};
    const c: ParaProps = {};
    if (p.level) c.level = Math.max(0, Math.min(MAX_LEVEL, Math.round(p.level)));
    if (p.align) c.align = p.align;
    out.push(c);
  }
  while (out.length && !out[out.length - 1].level && !out[out.length - 1].align) out.pop();
  return out.length ? out : undefined;
}

/** A paragraph break carries no visible formatting; give each "\n" the
 *  style of the character before it (the first: the one after) so equal
 *  content always has equal runs. */
function canonBreaks(runs: readonly TextRun[]): TextRun[] {
  const pieces: TextRun[] = [];
  for (const r of runs)
    for (const t of r.text.split(/(\n)/)) if (t) pieces.push({ ...r, text: t });
  return pieces.map((p, i) => {
    if (p.text !== "\n") return p;
    const src = pieces.slice(0, i).reverse().find((q) => q.text !== "\n") ?? pieces.slice(i + 1).find((q) => q.text !== "\n");
    return src ? { ...styleOf(src), text: "\n" } : { text: "\n" };
  });
}

/** Split runs so that a run boundary falls at each of `offsets`. */
export function splitRuns(runs: readonly TextRun[], ...offsets: number[]): TextRun[] {
  let out = runs.map((r) => ({ ...r }));
  for (const at of offsets) {
    const next: TextRun[] = [];
    let pos = 0;
    for (const r of out) {
      const end = pos + r.text.length;
      if (at > pos && at < end) {
        next.push({ ...r, text: r.text.slice(0, at - pos) }, { ...r, text: r.text.slice(at - pos) });
      } else next.push(r);
      pos = end;
    }
    out = next;
  }
  return out;
}

/** Visit the runs inside [from, to) (after splitting at the ends). */
function mapRange(
  el: SlideElement,
  from: number,
  to: number,
  fn: (r: TextRun, start: number) => TextRun,
): TextRun[] {
  const [a, b] = order(from, to);
  let pos = 0;
  return splitRuns(elementRuns(el), a, b).map((r) => {
    const start = pos;
    pos += r.text.length;
    return start >= a && start + r.text.length <= b && r.text ? fn(r, start) : r;
  });
}

function order(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function textLen(el: SlideElement): number {
  return (el.text || "").length;
}

/** The runs covering [from, to) (for "is it all bold?" questions). With an
 *  empty range, the run holding the character before `from`. */
function runsIn(el: SlideElement, from: number, to: number): TextRun[] {
  const [a, b] = order(from, to);
  const runs = elementRuns(el);
  const out: TextRun[] = [];
  let pos = 0;
  for (const r of runs) {
    const end = pos + r.text.length;
    if (a === b ? a > pos && a <= end : end > a && pos < b) out.push(r);
    pos = end;
  }
  if (!out.length) out.push(runs[0]);
  return out;
}

// ---------------------------------------------------------------- formatting

export type StylePatch = { [K in StyleKey]?: RunStyle[K] | null };

/** formatRange sets (or, with null, clears to the element value) style keys
 *  on the characters in [from, to). An empty text formats the element. */
export function formatRange(el: SlideElement, from: number, to: number, patch: StylePatch): SlideElement {
  if (!textLen(el)) return formatWhole(el, patch);
  // Clearing super/subscript must turn it off, not inherit the element's:
  // move the element value down into the runs first.
  if (patch.baseline === null && el.baseline) {
    const b = el.baseline;
    const runs = elementRuns(el).map((r) => ({ baseline: b, ...r }));
    const rest = { ...el };
    delete rest.baseline;
    el = { ...rest, runs, text: runsText(runs) };
  }
  const runs = mapRange(el, from, to, (r) => {
    const c = { ...r };
    for (const [k, v] of Object.entries(patch) as [StyleKey, unknown][]) {
      if (v === null || v === undefined) delete c[k];
      else (c as Record<string, unknown>)[k] = v;
    }
    return c;
  });
  return withRuns(el, runs);
}

/** formatWhole sets style keys on the element and removes them from runs. */
export function formatWhole(el: SlideElement, patch: StylePatch): SlideElement {
  const out: SlideElement = { ...el };
  for (const [k, v] of Object.entries(patch) as [StyleKey, RunStyle[StyleKey] | null][]) {
    if (k === "url") {
      if (v) out.url = v as string;
      else delete out.url;
      continue;
    }
    setElementValue(out, k, v ?? undefined);
  }
  const runs = elementRuns(el).map((r) => {
    const c = { ...r };
    for (const k of Object.keys(patch) as StyleKey[]) delete c[k];
    return c;
  });
  return withRuns(out, runs);
}

/** Is `k` on (truthy / equal to `value`) for every character in [from, to)? */
export function rangeHas(
  el: SlideElement,
  from: number,
  to: number,
  k: StyleKey,
  value: RunStyle[StyleKey] = true,
): boolean {
  return runsIn(el, from, to).every((r) => effective(el, r, k) === value);
}

/** toggleRange flips a boolean style (or super/subscript) over [from, to):
 *  on unless every character already has it. */
export function toggleRange(
  el: SlideElement,
  from: number,
  to: number,
  k: BoolKey | "super" | "sub",
): SlideElement {
  if (k === "super" || k === "sub") {
    const on = rangeHas(el, from, to, "baseline", k);
    return formatRange(el, from, to, { baseline: on ? null : k });
  }
  const on = rangeHas(el, from, to, k, true);
  return formatRange(el, from, to, { [k]: !on });
}

/** Font-size ladder (Ctrl+] / Ctrl+[): Word/OnlyOffice steps, then ±10. */
export const FONT_LADDER = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

/** fontStep returns the next ladder size up (dir 1) or down (dir -1). */
export function fontStep(size: number, dir: 1 | -1): number {
  if (dir > 0) {
    if (size < FONT_LADDER[0]) return Math.floor(size) + 1;
    const n = FONT_LADDER.find((v) => v > size);
    return n ?? Math.floor(size / 10) * 10 + 10;
  }
  if (size <= FONT_LADDER[0]) return Math.max(1, Math.ceil(size) - 1);
  if (size > 72) return Math.max(72, Math.ceil(size / 10) * 10 - 10);
  const lower = FONT_LADDER.filter((v) => v < size);
  return lower[lower.length - 1];
}

/** stepFontRange grows or shrinks every run in [from, to) by one ladder step. */
export function stepFontRange(el: SlideElement, from: number, to: number, dir: 1 | -1): SlideElement {
  if (!textLen(el)) return { ...el, fontSize: fontStep(el.fontSize ?? DEFAULT_FONT_SIZE, dir) };
  const runs = mapRange(el, from, to, (r) => ({
    ...r,
    fontSize: fontStep(effective(el, r, "fontSize") as number, dir),
  }));
  const [a, b] = order(from, to);
  const whole = a <= 0 && b >= textLen(el);
  return withRuns(whole ? { ...el, fontSize: fontStep(el.fontSize ?? DEFAULT_FONT_SIZE, dir) } : el, runs);
}

/** changeCaseRange applies a change-case mode to [from, to); words and
 *  sentences are judged with the paragraph text before the range. */
export function changeCaseRange(el: SlideElement, from: number, to: number, mode: CaseMode): SlideElement {
  const text = el.text || "";
  const runs = mapRange(el, from, to, (r, start) => {
    const paraStart = text.lastIndexOf("\n", start - 1) + 1;
    const before = text.slice(paraStart, start);
    return { ...r, text: caseChars(Array.from(r.text), mode, before).join("") };
  });
  return withRuns(el, runs);
}

/** clearFormatRange removes character formatting (not links) in [from, to):
 *  the characters fall back to the element's style. On the whole element
 *  it also resets the element's bold/italic/underline/strike/baseline. */
export function clearFormatRange(el: SlideElement, from: number, to: number): SlideElement {
  const [a, b] = order(from, to);
  const whole = a <= 0 && b >= textLen(el);
  if (whole) {
    const base = formatWhole(el, {
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      baseline: null,
      fontSize: el.fontSize ?? null,
      fontFamily: el.fontFamily ?? null,
      color: el.color ?? null,
    });
    return base;
  }
  const runs = mapRange(el, a, b, (r) => {
    const c = { ...r };
    for (const k of FORMAT_KEYS) delete c[k];
    return c;
  });
  return withRuns(el, runs);
}

/** captureFormat is paint format's "copy": the effective character style at
 *  the start of [from, to) (links are not captured). */
export function captureFormat(el: SlideElement, from = 0, to = from): RunStyle {
  const [a, b] = order(from, to);
  const r = runsIn(el, a, a === b ? a : a + 1)[0] ?? {};
  const s = effectiveStyle(el, r);
  delete s.url;
  return s;
}

/** applyFormat is paint format's "paste": every captured key on [from, to)
 *  (keys missing from the capture are cleared to the element style). */
export function applyFormat(el: SlideElement, from: number, to: number, style: RunStyle): SlideElement {
  const patch: StylePatch = {};
  for (const k of FORMAT_KEYS) (patch as Record<string, unknown>)[k] = style[k] ?? null;
  // Booleans that are off must be written as false, not "inherit".
  for (const k of ["bold", "italic", "underline", "strike"] as const) patch[k] = !!style[k];
  return from === to && !textLen(el) ? formatWhole(el, patch) : formatRange(el, from, to, patch);
}

/** applyFormatWhole pastes a captured style onto a whole element. */
export function applyFormatWhole(el: SlideElement, style: RunStyle): SlideElement {
  const patch: StylePatch = {};
  for (const k of FORMAT_KEYS) (patch as Record<string, unknown>)[k] = style[k] ?? null;
  for (const k of ["bold", "italic", "underline", "strike"] as const) patch[k] = !!style[k];
  return formatWhole(el, patch);
}

// ---------------------------------------------------------------- editing

/** replaceRange replaces [from, to) with `s`; the new text takes the style
 *  of the first replaced character (an insertion: the one before). Paragraph
 *  properties follow the paragraphs they belong to. */
export function replaceRange(el: SlideElement, from: number, to: number, s: string): SlideElement {
  const [a, b] = order(from, to);
  const text = el.text || "";
  const styleAt = runsIn(el, a, a < b ? a + 1 : a)[0] ?? {};
  const out: TextRun[] = [];
  let pos = 0;
  for (const r of splitRuns(elementRuns(el), a, b)) {
    const start = pos;
    pos += r.text.length;
    if (start < a) out.push(r);
  }
  out.push({ ...styleOf(styleAt), text: s });
  pos = 0;
  for (const r of splitRuns(elementRuns(el), a, b)) {
    const start = pos;
    pos += r.text.length;
    if (start >= b && r.text) out.push(r);
  }
  // Paragraph properties: breaks removed merge into the first paragraph,
  // breaks inserted copy its properties.
  let paras = el.paras;
  if (paras) {
    const p0 = text.slice(0, a).split("\n").length - 1;
    const removed = text.slice(a, b).split("\n").length - 1;
    const added = s.split("\n").length - 1;
    const next = [...paras];
    while (next.length <= p0) next.push({});
    next.splice(p0 + 1, removed, ...Array.from({ length: added }, () => ({ ...next[p0] })));
    paras = next;
  }
  return withRuns(el, out, paras);
}

export function insertText(el: SlideElement, at: number, s: string): SlideElement {
  return replaceRange(el, at, at, s);
}

/** wordAt returns the [from, to) of the word touching `at`, or null. */
export function wordAt(text: string, at: number): [number, number] | null {
  let a = at;
  let b = at;
  while (a > 0 && isWordChar(text[a - 1])) a--;
  while (b < text.length && isWordChar(text[b])) b++;
  return a === b ? null : [a, b];
}

// ---------------------------------------------------------------- links

/** setLinkRange links (or with "" unlinks) the characters in [from, to). */
export function setLinkRange(el: SlideElement, from: number, to: number, url: string): SlideElement {
  return formatRange(el, from, to, { url: url || null });
}

/** linkAt returns the run-level link at offset `at` (the character after,
 *  else the one before), or the element link. */
export function linkAt(el: SlideElement, at: number): string | undefined {
  const text = el.text || "";
  const runs = elementRuns(el);
  let pos = 0;
  for (const r of runs) {
    const end = pos + r.text.length;
    if (r.url && ((at >= pos && at < end) || (at === end && at === text.length))) return r.url;
    pos = end;
  }
  return el.url;
}

// ---------------------------------------------------------------- paragraphs

export interface Paragraph {
  index: number;
  start: number;
  end: number;
  runs: TextRun[];
  props: ParaProps;
}

/** paragraphs splits an element into paragraphs of runs. */
export function paragraphs(el: SlideElement): Paragraph[] {
  const out: Paragraph[] = [];
  let cur: TextRun[] = [];
  let start = 0;
  let pos = 0;
  const push = (end: number) => {
    const i = out.length;
    out.push({ index: i, start, end, runs: cur, props: el.paras?.[i] ?? {} });
    cur = [];
  };
  for (const r of elementRuns(el)) {
    const parts = r.text.split("\n");
    parts.forEach((t, i) => {
      if (i > 0) {
        push(pos);
        pos += 1;
        start = pos;
      }
      if (t) cur.push({ ...r, text: t });
      pos += t.length;
    });
  }
  push(pos);
  return out;
}

/** Indices of the paragraphs touched by [from, to]. */
export function paraIndices(text: string, from: number, to: number): number[] {
  const [a, b] = order(from, to);
  const first = text.slice(0, a).split("\n").length - 1;
  const last = text.slice(0, b).split("\n").length - 1;
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

function withParas(el: SlideElement, idxs: number[], fn: (p: ParaProps) => ParaProps): SlideElement {
  const n = paraCount(el.text || "");
  const paras = Array.from({ length: n }, (_, i) => ({ ...(el.paras?.[i] ?? {}) }));
  for (const i of idxs) if (i >= 0 && i < n) paras[i] = fn(paras[i]);
  const out = { ...el };
  const p = normParas(paras, n);
  if (p) out.paras = p;
  else delete out.paras;
  return out;
}

/** setParaAlign aligns the given paragraphs (Ctrl+E/J/L/R while editing). */
export function setParaAlign(el: SlideElement, idxs: number[], align: TextAlign): SlideElement {
  const all = idxs.length >= paraCount(el.text || "");
  if (all) return setAlignWhole(el, align);
  return withParas(el, idxs, (p) => ({ ...p, align: align === (el.align ?? "left") ? undefined : align }));
}

/** setAlignWhole aligns the element and drops per-paragraph alignment. */
export function setAlignWhole(el: SlideElement, align: TextAlign): SlideElement {
  return withParas({ ...el, align }, [...Array(paraCount(el.text || "")).keys()], (p) => ({
    ...p,
    align: undefined,
  }));
}

/** indentParas changes the list level of paragraphs by `delta` (Tab /
 *  Shift+Tab, Format ▸ Indent), clamped to 0…MAX_LEVEL. */
export function indentParas(el: SlideElement, idxs: number[], delta: number): SlideElement {
  return withParas(el, idxs, (p) => ({
    ...p,
    level: Math.max(0, Math.min(MAX_LEVEL, (p.level ?? 0) + delta)),
  }));
}

/** Left indent (px) of a paragraph: one INDENT_STEP per level. With a list,
 *  the marker hangs in the first step. */
export function paraIndent(el: SlideElement, p: ParaProps): number {
  return ((p.level ?? 0) + (el.list ? 1 : 0)) * INDENT_STEP;
}

// ---------------------------------------------------------------- lists

/** Bullet characters offered in Format ▸ Bullets, and the level defaults. */
export const BULLET_CHARS = ["•", "◦", "▪", "➢", "✓", "–", "◆", "★"];
const LEVEL_BULLETS = ["•", "◦", "▪"];

/** Numbering schemes (pptx `a:buAutoNum@type`). */
export const NUMBER_SCHEMES: { value: string; label: string }[] = [
  { value: "arabicPeriod", label: "1. 2. 3." },
  { value: "arabicParenR", label: "1) 2) 3)" },
  { value: "alphaUcPeriod", label: "A. B. C." },
  { value: "alphaLcPeriod", label: "a. b. c." },
  { value: "alphaLcParenR", label: "a) b) c)" },
  { value: "romanUcPeriod", label: "I. II. III." },
  { value: "romanLcPeriod", label: "i. ii. iii." },
];
const LEVEL_SCHEMES = ["arabicPeriod", "alphaLcPeriod", "romanLcPeriod"];

function roman(n: number): string {
  const t: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let s = "";
  for (const [v, r] of t) while (n >= v) {
    s += r;
    n -= v;
  }
  return s;
}
function alpha(n: number): string {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

/** formatNumber renders list number `n` (1-based) in a buAutoNum scheme. */
export function formatNumber(n: number, scheme: string): string {
  const m = /^(arabic|alphaLc|alphaUc|romanLc|romanUc)(Period|ParenR|ParenBoth|Plain)$/.exec(scheme);
  const kind = m?.[1] ?? "arabic";
  const punct = m?.[2] ?? "Period";
  let v =
    kind === "arabic"
      ? String(n)
      : kind.startsWith("alpha")
        ? alpha(n)
        : roman(n);
  if (kind.endsWith("Uc")) v = v.toUpperCase();
  return punct === "Period" ? `${v}.` : punct === "ParenR" ? `${v})` : punct === "ParenBoth" ? `(${v})` : v;
}

/** listMarkers returns the bullet/number shown before each paragraph ("" for
 *  none: no list, or an empty paragraph). Numbering counts per level and
 *  restarts when a shallower paragraph interrupts a deeper run. */
export function listMarkers(el: SlideElement): string[] {
  const paras = paragraphs(el);
  if (!el.list) return paras.map(() => "");
  const counters: number[] = [];
  return paras.map((p) => {
    const empty = !p.runs.some((r) => r.text.replace(/\v/g, ""));
    const lvl = p.props.level ?? 0;
    if (empty) return "";
    if (el.list === "bullet") return el.bulletStyle || LEVEL_BULLETS[lvl % LEVEL_BULLETS.length];
    counters.length = lvl + 1;
    counters[lvl] = (counters[lvl] ?? 0) + 1;
    for (let i = 0; i < lvl; i++) counters[i] = counters[i] ?? 0;
    const scheme = lvl === 0 && el.bulletStyle ? el.bulletStyle : LEVEL_SCHEMES[lvl % LEVEL_SCHEMES.length];
    return formatNumber(counters[lvl], scheme);
  });
}

/** setListStyle turns a list on (with an optional bullet char / numbering
 *  scheme) or off (null). */
export function setListStyle(
  el: SlideElement,
  list: "bullet" | "number" | null,
  style?: string,
): SlideElement {
  const out = { ...el };
  if (!list) {
    delete out.list;
    delete out.bulletStyle;
    return out;
  }
  out.list = list;
  if (style) out.bulletStyle = style;
  else delete out.bulletStyle;
  return out;
}

// ---------------------------------------------------------------- box

/** Effective insets (px). */
export function insetsOf(el: SlideElement): TextInsets {
  return el.insets ?? { l: DEFAULT_INSET, t: DEFAULT_INSET, r: DEFAULT_INSET, b: DEFAULT_INSET };
}

/** setInsets sets the text insets (px, left/top/right/bottom), or returns
 *  null for negative or non-finite values (the element is unchanged). */
export function setInsets(el: SlideElement, l: number, t: number, r: number, b: number): SlideElement | null {
  if (![l, t, r, b].every((v) => Number.isFinite(v) && v >= 0)) return null;
  const out = { ...el };
  if ([l, t, r, b].every((v) => v === DEFAULT_INSET)) delete out.insets;
  else out.insets = { l, t, r, b };
  return out;
}

/** The [from, to) of the link run touching `at`, or null. */
export function linkRangeAt(el: SlideElement, at: number): [number, number] | null {
  let pos = 0;
  const runs = elementRuns(el);
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const end = pos + r.text.length;
    if (r.url && at >= pos && at <= end) {
      // Neighbouring runs with the same link (different formatting) join in.
      let a = pos;
      let b = end;
      for (let j = i - 1, p = pos; j >= 0 && runs[j].url === r.url; j--) a = p -= runs[j].text.length;
      for (let j = i + 1; j < runs.length && runs[j].url === r.url; j++) b += runs[j].text.length;
      return [a, b];
    }
    pos = end;
  }
  return null;
}
