// The slides document model. A deck is an ordered list of slides; each slide
// has a background and a list of absolutely-positioned elements. Coordinates
// are in a logical canvas CANVAS_W (always 960) wide and CANVAS_H high; the
// editor and thumbnails scale this to whatever pixel size they render at.
//
// CANVAS_H follows the open deck's slide size (M7, `DeckDoc.size`): 540 for
// 16:9 (the default), 720 for 4:3. It is a live binding set by
// `setCanvasSize` when a deck is opened or resized, so the pure geometry
// helpers keep one signature; importers of a pptx and the pptx writer read
// the size from the deck itself.

import type { AxisConfig, ChartType, SeriesConfig } from "../sheets/chartData";
import type { SlideComment } from "./comments";

export const CANVAS_W = 960;
/** Default logical slide height (16:9). */
export const DEFAULT_CANVAS_H = 540;
export let CANVAS_H = DEFAULT_CANVAS_H;

/** setCanvasSize sets the logical height of the open deck's slides. */
export function setCanvasSize(size: { w: number; h: number } | undefined): void {
  const h = size && size.w > 0 && size.h > 0 ? Math.round((CANVAS_W * size.h) / size.w) : DEFAULT_CANVAS_H;
  CANVAS_H = Math.max(60, Math.min(4 * CANVAS_W, h));
}

export type ElementType =
  | "text"
  | "rect"
  | "ellipse"
  | "image"
  | "line"
  | "triangle"
  | "diamond"
  | "rightArrow"
  | "roundRect"
  | "table"
  | "group"
  /** A DrawingML preset shape (`preset` + `adj`), drawn as inline SVG. */
  | "shape"
  /** A line/connector preset between two points (the box corners, with
   *  flipH/flipV choosing the diagonal), with optional arrowheads. */
  | "connector"
  /** A chart drawn from its own small data sheet (`chart`, M11). */
  | "chart"
  /** A video or audio clip (`media`, M11). */
  | "media";

/** pptx `a:prstDash` values Grown can write (pptxgenjs `dashType`). */
export type DashStyle =
  | "solid"
  | "dash"
  | "dashDot"
  | "lgDash"
  | "lgDashDot"
  | "lgDashDotDot"
  | "sysDash"
  | "sysDot";

export const DASH_STYLES: { value: DashStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "sysDot", label: "Round dot" },
  { value: "sysDash", label: "Square dot" },
  { value: "dash", label: "Dash" },
  { value: "dashDot", label: "Dash dot" },
  { value: "lgDash", label: "Long dash" },
  { value: "lgDashDot", label: "Long dash dot" },
  { value: "lgDashDotDot", label: "Long dash dot dot" },
];

/** Line-end decoration (pptx `a:headEnd`/`a:tailEnd` `type`). */
export type ArrowHead = "none" | "triangle" | "stealth" | "diamond" | "oval" | "arrow";

export const ARROW_HEADS: { value: ArrowHead; label: string }[] = [
  { value: "none", label: "None" },
  { value: "triangle", label: "Arrow" },
  { value: "arrow", label: "Open arrow" },
  { value: "stealth", label: "Stealth arrow" },
  { value: "diamond", label: "Diamond" },
  { value: "oval", label: "Oval" },
];

/** A connector end glued to a connection site of another element. */
export interface CxnRef {
  id: string;
  /** Index into the target preset's connection sites. */
  idx: number;
}

/** One side of a cell border; width (pt, like strokeWidth) 0 = no line. */
export interface CellBorder {
  color: string;
  width: number;
  dash?: DashStyle;
}

export type CellSide = "t" | "r" | "b" | "l";

/** Per-cell overrides (absent = the table style / element defaults). */
export interface CellProps {
  /** Cell fill; "none" = explicitly transparent. */
  fill?: string;
  /** Explicit borders per side (pptx `a:lnT/lnR/lnB/lnL`). */
  borders?: Partial<Record<CellSide, CellBorder>>;
  align?: TextAlign;
  valign?: "top" | "middle" | "bottom";
  /** Cell-wide character formatting (like a text element's own values). */
  style?: RunStyle;
  /** Rich text (F1) of the cell; concatenates to `cells[r][c]`. */
  runs?: TextRun[];
  paras?: ParaProps[];
}

/** A merged block anchored at its top-left cell (pptx gridSpan/rowSpan). */
export interface CellMerge {
  r: number;
  c: number;
  rs: number;
  cs: number;
}

/** Table style switches (pptx `a:tblPr` firstRow/bandRow/...). */
export interface TableLook {
  header?: boolean;
  banded?: boolean;
  firstCol?: boolean;
  lastRow?: boolean;
  lastCol?: boolean;
  bandedCols?: boolean;
}

/** Table element data: a grid of cell text (cells[row][col]). Everything
 *  after `cells` is optional (M5), so tables from older clients still work;
 *  `cells` stays the plain-text mirror of each cell. */
export interface TableData {
  rows: number;
  cols: number;
  cells: string[][];
  /** Relative column widths (scaled to the element width when drawn);
   *  absent = equal columns. */
  colW?: number[];
  /** Relative row heights (scaled to the element height); absent = equal. */
  rowH?: number[];
  /** Merged blocks; covered cells keep an empty string. */
  merges?: CellMerge[];
  /** Per-cell overrides, [row][col] (null = none). */
  props?: (CellProps | null)[][];
  /** Table style template id (a pptx `a:tableStyleId` GUID). */
  style?: string;
  /** Which parts of the style apply. */
  look?: TableLook;
}

/** newTable builds an r×c table with empty cells. */
export function newTable(rows: number, cols: number): TableData {
  return {
    rows,
    cols,
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => "")),
  };
}

// SHAPE_TYPES is every non-text/image/line element type — the "shape-like"
// elements that share fill/stroke styling and an 8-handle resize box.
export const SHAPE_TYPES: ElementType[] = [
  "rect",
  "ellipse",
  "triangle",
  "diamond",
  "rightArrow",
  "roundRect",
  "shape",
];

export function isShape(type: ElementType): boolean {
  return SHAPE_TYPES.includes(type);
}

// CSS clip-path polygon for shapes that aren't a plain box/ellipse. Returns
// undefined for rect/ellipse/roundRect (those use background + border-radius).
export function shapeClipPath(type: ElementType): string | undefined {
  switch (type) {
    case "triangle":
      return "polygon(50% 0%, 100% 100%, 0% 100%)";
    case "diamond":
      return "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)";
    case "rightArrow":
      return "polygon(0% 30%, 60% 30%, 60% 0%, 100% 50%, 60% 100%, 60% 70%, 0% 70%)";
    default:
      return undefined;
  }
}

// Slide transition played when advancing TO a slide during a slideshow.
// "slide-left/right/up" are the pre-M8 names (push from right/left/bottom);
// they stay valid so older decks keep playing.
export type TransitionType =
  | "none"
  | "fade"
  | "push"
  | "wipe"
  | "split"
  | "reveal"
  | "cover"
  | "uncover"
  | "zoom"
  | "cut"
  | "dissolve"
  | "morph"
  | "slide-left"
  | "slide-right"
  | "slide-up";

/** The legacy picker list (kept for older callers; the M8 catalogue with
 *  directions lives in transitions.ts). */
export const TRANSITIONS: { type: TransitionType; label: string }[] = [
  { type: "none", label: "None" },
  { type: "fade", label: "Fade" },
  { type: "slide-left", label: "Slide from right" },
  { type: "slide-right", label: "Slide from left" },
  { type: "slide-up", label: "Slide from bottom" },
];

// Entrance animation type for an element (pre-M8 Google Slides pane).
export type AnimationType =
  | "appear"
  | "fade-in"
  | "fly-in-bottom"
  | "fly-in-left";

export const ANIMATION_TYPES: { type: AnimationType; label: string }[] = [
  { type: "appear", label: "Appear" },
  { type: "fade-in", label: "Fade in" },
  { type: "fly-in-bottom", label: "Fly in from bottom" },
  { type: "fly-in-left", label: "Fly in from left" },
];

/** Pre-M8 per-element entrance animation. Still read (`animOps.effectsOf`
 *  turns it into slide effects); the animation pane migrates a slide to
 *  `Slide.anims` on its first edit. */
export interface ElementAnimation {
  /** Animation type */
  type: AnimationType;
  /** 1-based click order within the slide (lower = plays earlier). */
  order: number;
}

/** Animation effect class: entrance, emphasis or exit (pptx presetClass). */
export type AnimClass = "entr" | "emph" | "exit";

/** Effect kinds. Entrance/exit: appear, fade, fly, float, wipe, zoom.
 *  Emphasis: pulse, colorPulse, spin, grow (grow/shrink), teeter. */
export type AnimKind =
  | "appear"
  | "fade"
  | "fly"
  | "float"
  | "wipe"
  | "zoom"
  | "pulse"
  | "colorPulse"
  | "spin"
  | "grow"
  | "teeter";

/** When an effect starts: on a click, with the previous effect, or after
 *  the previous effect ends (PowerPoint's Start). */
export type AnimStart = "click" | "with" | "after";

/** One effect in a slide's animation sequence (M8). List order is play
 *  order, as in the animation pane. */
export interface AnimEffect {
  id: string;
  /** Target element id (top-level element on the slide). */
  el: string;
  cls: AnimClass;
  kind: AnimKind;
  start: AnimStart;
  /** Delay after the start point, ms (default 0). */
  delay?: number;
  /** Duration, ms (default: the kind's). */
  dur?: number;
  /** Fly/wipe/float direction: where it comes from (entrance) or goes to
   *  (exit): t, b, l, r. */
  dir?: "t" | "b" | "l" | "r";
  /** Text: one step per paragraph. */
  byPara?: boolean;
  /** Grow/shrink factor (1.5 = 150 %, 0.5 shrinks). */
  scale?: number;
  /** Colour pulse colour. */
  color?: string;
  /** Spin angle in degrees (default 360; negative = counter-clockwise). */
  angle?: number;
}

/** Character formatting that a text run can override (absent = inherit the
 *  element-level value). */
export interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Superscript / subscript (pptx `a:rPr@baseline`). */
  baseline?: "super" | "sub";
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  /** Hyperlink: an http/mailto URL, or a slide target (`#slide:first`,
   *  `#slide:last`, `#slide:next`, `#slide:prev`, `#slide:<slideId>`). */
  url?: string;
}

/**
 * A run of text with one formatting (Flagged exception F1). `text` may hold
 * "\n" (paragraph break) and "\v" (line break inside a paragraph, Shift+Enter);
 * the runs of an element concatenate to exactly `SlideElement.text`.
 */
export interface TextRun extends RunStyle {
  text: string;
}

export type TextAlign = "left" | "center" | "right" | "justify";

/** Per-paragraph properties, indexed by paragraph (text split on "\n"). */
export interface ParaProps {
  /** List / outline level 0–8 (pptx `a:pPr@lvl`); indents by INDENT_STEP. */
  level?: number;
  /** Paragraph alignment overriding the element's `align`. */
  align?: TextAlign;
}

/** Text insets (padding) in logical px; pptx `a:bodyPr` l/t/r/bIns. */
export interface TextInsets {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Image crop: fractions (0–1) of the source cut off each side. */
export interface ImageCrop {
  l: number;
  t: number;
  r: number;
  b: number;
}

/**
 * A chart on a slide (M11): the Sheets chart options (see
 * pages/sheets/chartData.ts `ChartConfig`, minus the workbook range/anchor)
 * plus its own data sheet. `data[0]` holds the series names (`data[0][0]` is
 * unused), column 0 the category labels; cells are strings as typed.
 * Series colours default to the deck theme's accents.
 */
export interface SlideChart {
  type: ChartType;
  title: string;
  data: string[][];
  /** Series run across rows (row 0 = categories, column 0 = series names). */
  seriesInRows?: boolean;
  stacking?: "none" | "stacked" | "percent";
  legend?: "right" | "left" | "top" | "bottom" | "none";
  dataLabels?: boolean;
  scatterLines?: boolean;
  holeSize?: number;
  /** Per-series options (colour, combo type, secondary axis, trendline). */
  series?: SeriesConfig[];
  xAxis?: AxisConfig;
  yAxis?: AxisConfig;
  y2Axis?: AxisConfig;
  totals?: number[];
}

/**
 * A video or audio clip (M11). `src` is a deck asset URL (uploaded), a
 * direct media URL, or — with `embed` — a YouTube/Vimeo page whose player
 * is framed in the slideshow.
 */
export interface SlideMedia {
  kind: "video" | "audio";
  src: string;
  /** Online player: the provider and its video id. */
  embed?: { provider: "youtube" | "vimeo"; id: string };
  /** Poster frame (an image URL): thumbnails, the editor and exports. */
  poster?: string;
  /** MIME type of an uploaded or direct file. */
  mime?: string;
  /** Start when the slide appears (else on click). */
  autoplay?: boolean;
  loop?: boolean;
  /** Start muted (videos). */
  muted?: boolean;
}

/** Text warp presets drawn with an SVG textPath (pptx `a:prstTxWarp`). */
export type TextWarp = "textArchUp" | "textArchDown" | "textCircle" | "textWave1" | "textSlantUp" | "textSlantDown";

/** Word art text effects on a text box (M11; pptx run `a:ln`, `a:gradFill`,
 *  `a:effectLst`, and `a:bodyPr/a:prstTxWarp`). */
export interface WordArt {
  /** Text outline. */
  outline?: { color: string; width: number };
  /** Gradient text fill: two stops and a linear angle (0 = left→right). */
  gradient?: { from: string; to: string; angle: number };
  /** Drop shadow behind the letters. */
  shadow?: { color: string; blur: number; dist: number; dir: number };
  /** Soft glow around the letters. */
  glow?: { color: string; radius: number };
  warp?: TextWarp;
}

/** SmartArt-lite (M11): the layout and outline a diagram group was built
 *  from, so the outline panel can rebuild it. */
export interface DiagramSpec {
  layout: "list" | "process" | "cycle" | "hierarchy" | "pyramid" | "venn";
  /** One item per line; leading tabs/2-space indents give the level. */
  outline: string;
}

/** Default text inset (px) on every side when `insets` is absent. */
export const DEFAULT_INSET = 4;
/** One list/indent level: 0.4375 in (11.1125 mm, OnlyOffice/PowerPoint). */
export const INDENT_STEP = 42;
/** Maximum paragraph level (pptx allows lvl 0–8). */
export const MAX_LEVEL = 8;

export interface SlideElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  // text
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Superscript / subscript for the whole element (runs may override). */
  baseline?: "super" | "sub";
  /** Bullet / numbered list rendering for a multi-line text element. */
  list?: "bullet" | "number";
  /** Bullet character (list "bullet", default by level) or pptx `buAutoNum`
   *  scheme (list "number", e.g. "alphaLcPeriod"). */
  bulletStyle?: string;
  /** Mixed formatting inside the box (F1). When present, the runs'
   *  texts concatenate to `text`, which stays the plain-text mirror. */
  runs?: TextRun[];
  /** Per-paragraph level/alignment (index = paragraph of `text`). */
  paras?: ParaProps[];
  /** Space before / after each paragraph, in logical px. */
  spaceBefore?: number;
  spaceAfter?: number;
  /** Text insets (px); absent = DEFAULT_INSET on every side. */
  insets?: TextInsets;
  /** Shrink text on overflow (pptx `a:normAutofit`). */
  autofit?: "shrink";
  /** Right-to-left paragraphs (pptx `a:pPr@rtl`). */
  rtl?: boolean;
  /** Vertical text: rotated 90° (`vert`) or 270° (`vert270`), pptx `bodyPr@vert`. */
  vert?: "vert" | "vert270";
  /** Line height multiplier for text (default 1.2). */
  lineSpacing?: number;
  color?: string;
  align?: TextAlign;
  valign?: "top" | "middle" | "bottom";
  // shape
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  // image
  src?: string;
  /** Crop as fractions of the source image cut from each side (pptx
   *  `a:srcRect`); present = the picture is stretched to fill its box. */
  crop?: ImageCrop;
  /** Crop to shape: the picture is clipped to this preset geometry. */
  cropShape?: string;
  /** Opacity 0–1 (pptx `a:alphaModFix`); absent = opaque. */
  opacity?: number;
  /** Drop shadow (pptx `a:outerShdw`). */
  shadow?: boolean;
  /** Alternative text (pptx `cNvPr@descr`). */
  alt?: string;
  // table
  table?: TableData;
  /** Chart (type "chart", M11). */
  chart?: SlideChart;
  /** Video/audio (type "media", M11). */
  media?: SlideMedia;
  /** Word art effects (text boxes, M11). */
  wordArt?: WordArt;
  /** A SmartArt-lite diagram (on the group that draws it, M11). */
  diagram?: DiagramSpec;
  /** Hyperlink target; clickable in present mode and exports. */
  url?: string;
  /** Clockwise rotation in degrees (absent/0 = upright). */
  rotation?: number;
  /** Mirror horizontally / vertically. */
  flipH?: boolean;
  flipV?: boolean;
  /** Entrance animation for this element (optional; absent = no animation). */
  animation?: ElementAnimation;
  // preset geometry ("shape" / "connector")
  /** ECMA-376 preset name (`a:prstGeom@prst`), e.g. "star5". */
  preset?: string;
  /** Adjust values (`a:avLst`); missing names take the preset defaults. */
  adj?: Record<string, number>;
  /** Outline dash style (absent = solid). */
  dash?: DashStyle;
  /** Arrowheads at the path start (`headEnd`) and end (`tailEnd`). */
  headEnd?: ArrowHead;
  tailEnd?: ArrowHead;
  /** Connector ends glued to connection sites (`stCxn`/`endCxn`). */
  stCxn?: CxnRef;
  endCxn?: CxnRef;
  /** Object name (Selection pane / pptx `cNvPr@name`); optional. */
  name?: string;
  /** Layout placeholder this element fills (M7): its type and index. */
  placeholder?: Placeholder;
  /** Theme references (M7): colour slots (`accent1`, `tx1`, …, optionally
   *  with DrawingML modifiers, see theme.ts) and font roles
   *  (`major`/`minor`) that `fill`/`stroke`/`color`/`fontFamily` were
   *  taken from. Changing the theme re-resolves them; a property without a
   *  reference is an explicit value and is kept. */
  themeRefs?: ThemeRefs;
  /** Position lock: a locked element can be selected but not moved/resized. */
  locked?: boolean;
  /**
   * Group members (type "group" only), bottom to top. Children use absolute
   * slide coordinates as if the group were unrotated and unflipped; the
   * group's own rotation/flip turns the whole set about the group's centre
   * (the pptx `p:grpSp` model with chOff = off and chExt = ext).
   */
  children?: SlideElement[];
}

// elementTransform builds the CSS transform for an element's rotation/flip.
// Returns undefined when the element is upright and unflipped.
export function elementTransform(el: SlideElement): string | undefined {
  const parts: string[] = [];
  if (el.rotation) parts.push(`rotate(${el.rotation}deg)`);
  if (el.flipH || el.flipV)
    parts.push(`scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})`);
  return parts.length ? parts.join(" ") : undefined;
}

/** Placeholder kinds (pptx `p:ph@type`; `obj` = a content placeholder). */
export type PlaceholderType =
  | "title"
  | "ctrTitle"
  | "subTitle"
  | "body"
  | "obj"
  | "pic"
  | "dt"
  | "ftr"
  | "sldNum";

export interface Placeholder {
  type: PlaceholderType;
  /** Index among the layout's placeholders (pptx `p:ph@idx`). */
  idx?: number;
}

export interface ThemeRefs {
  fill?: string;
  stroke?: string;
  color?: string;
  font?: "major" | "minor";
}

/** A gradient or picture slide background (M7). `Slide.background` stays
 *  the plain colour (the first gradient stop, or white under a picture) so
 *  older clients still draw something sensible. */
export type SlideFill =
  | {
      kind: "gradient";
      /** Stops, 0–1 positions, in order. */
      stops: { pos: number; color: string }[];
      /** Linear angle in degrees (0 = left→right, 90 = top→bottom), or radial. */
      angle?: number;
      radial?: boolean;
    }
  | { kind: "image"; src: string };

/** Per-slide header/footer switches; absent = the deck setting. */
export interface SlideHF {
  sldNum?: boolean;
  dt?: boolean;
  ftr?: boolean;
}

export interface Slide {
  id: string;
  background: string;
  elements: SlideElement[];
  /** Presenter notes for this slide (shown in the editor notes panel and presenter view). */
  notes?: string;
  /** Transition played when this slide is shown during a slideshow. */
  transition?: TransitionType;
  /** Transition option (direction/variant, see transitions.ts). */
  transitionDir?: string;
  /** Transition duration, ms (default: the type's). */
  transitionDur?: number;
  /** false: a click does not advance (keys still do). Absent = true. */
  advanceOnClick?: boolean;
  /** Advance automatically after this many ms. */
  advanceAfter?: number;
  /** Animation sequence (M8); absent = derived from element `animation`. */
  anims?: AnimEffect[];
  /** Layout the slide was made from (`DeckDoc.layouts[].id`). */
  layout?: string;
  /** Gradient/picture background over `background`. */
  bgFill?: SlideFill;
  /** Theme slot of the background colour (e.g. "bg1"). */
  bgRef?: string;
  /** Skipped in the slideshow (pptx `p:sld@show="0"`). */
  hidden?: boolean;
  /** Header/footer overrides for this slide. */
  hf?: SlideHF;
}

/** DrawingML colour scheme slots (ECMA-376 §20.1.4.1.10 `a:clrScheme`). */
export interface ThemeColors {
  dk1: string;
  lt1: string;
  dk2: string;
  lt2: string;
  accent1: string;
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  accent6: string;
  hlink: string;
  folHlink: string;
}

/** A deck theme: colour scheme + font scheme (M7). */
export interface DeckTheme {
  /** Built-in theme id, or "custom"/"imported". */
  id: string;
  name: string;
  colors: ThemeColors;
  fonts: { major: string; minor: string };
  /** Dark variant: bg1/bg2 map to dk1/dk2 and tx1/tx2 to lt1/lt2 (the
   *  master `p:clrMap`); otherwise the standard mapping. */
  dark?: boolean;
}

/** A slide layout (M7): a template slide whose elements carry
 *  `placeholder` (title, body, pic, dt/ftr/sldNum, …) plus decorations.
 *  Slides copy it; nothing inherits from it at render time (flagged
 *  exception F3), except the date/footer/number placeholders, which are
 *  drawn from the layout when switched on. */
export interface SlideLayout {
  id: string;
  name: string;
  /** pptx `p:sldLayout@type` (title, obj, twoObj, secHead, titleOnly, blank, …). */
  type?: string;
  elements: SlideElement[];
  background?: string;
  bgRef?: string;
  bgFill?: SlideFill;
}

/** Deck-wide header & footer (Insert ▸ Header & footer). */
export interface DeckHF {
  sldNum?: boolean;
  ftr?: boolean;
  footerText?: string;
  dt?: boolean;
  /** Fixed date text; absent = today's date, updated automatically. */
  dateText?: string;
  /** Don't show on title slides (layout type "title"). */
  notOnTitle?: boolean;
  /** Number of the first slide (default 1). */
  startAt?: number;
}

export interface DeckDoc {
  slides: Slide[];
  /** Theme; absent = the default Office theme (M7). */
  theme?: DeckTheme;
  /** Slide layouts; absent = the built-in set for the theme. */
  layouts?: SlideLayout[];
  /** Slide size in logical units ({w: 960, h}); absent = 16:9 (960×540). */
  size?: { w: number; h: number };
  /** Header & footer settings. */
  hf?: DeckHF;
  /** Slide show settings (M9). */
  show?: { loop?: boolean };
  /** Comment threads (M10, comments.ts). */
  comments?: SlideComment[];
}

export const FONT_FAMILIES = [
  "Arial",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Roboto",
  "Inter",
];

// uid generates a short unique id for slides/elements (browser-side; crypto when available).
export function uid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID)
      return crypto.randomUUID().slice(0, 8);
  } catch {
    /* fall through */
  }
  return Math.random().toString(36).slice(2, 10);
}

export function newSlide(background = "#ffffff"): Slide {
  return { id: uid(), background, elements: [] };
}

// A fresh title slide with a title + subtitle placeholder, à la Google Slides.
export function titleSlide(): Slide {
  return {
    id: uid(),
    background: "#ffffff",
    elements: [
      {
        id: uid(),
        type: "text",
        x: 110,
        y: 190,
        w: 740,
        h: 90,
        text: "Click to add title",
        fontSize: 40,
        bold: true,
        color: "#202124",
        align: "center",
        valign: "middle",
        fontFamily: "Arial",
      },
      {
        id: uid(),
        type: "text",
        x: 160,
        y: 300,
        w: 640,
        h: 50,
        text: "Click to add subtitle",
        fontSize: 20,
        color: "#5f6368",
        align: "center",
        valign: "middle",
        fontFamily: "Arial",
      },
    ],
  };
}

export function defaultDeck(): DeckDoc {
  return { slides: [titleSlide()] };
}

// elementDefaults returns a new element of the given type, centered-ish.
export function newElement(type: ElementType, src?: string): SlideElement {
  const base = { id: uid(), x: 360, y: 220, w: 240, h: 100 };
  switch (type) {
    case "text":
      return {
        ...base,
        type,
        text: "Text",
        fontSize: 18,
        color: "#202124",
        align: "left",
        valign: "top",
        fontFamily: "Arial",
      };
    case "rect":
      return { ...base, type, fill: "#4285f4", stroke: "none", strokeWidth: 0 };
    case "ellipse":
      return { ...base, type, fill: "#34a853", stroke: "none", strokeWidth: 0 };
    case "triangle":
      return { ...base, type, fill: "#fbbc04", stroke: "none", strokeWidth: 0 };
    case "diamond":
      return { ...base, type, fill: "#a142f4", stroke: "none", strokeWidth: 0 };
    case "rightArrow":
      return { ...base, type, fill: "#ea4335", stroke: "none", strokeWidth: 0 };
    case "roundRect":
      return { ...base, type, fill: "#4285f4", stroke: "none", strokeWidth: 0 };
    case "line":
      return { ...base, type, h: 0, w: 280, stroke: "#202124", strokeWidth: 3 };
    case "image":
      return { ...base, type, w: 320, h: 200, src: src || "" };
    case "table":
      return {
        ...base,
        type,
        w: 480,
        h: 220,
        table: newTable(3, 3),
        fill: "none",
        stroke: "#bdc1c6",
        strokeWidth: 1,
        fontSize: 16,
        color: "#202124",
      };
    case "group":
      return { ...base, type, children: [] };
    case "shape":
      return newShape("rect");
    case "connector":
      return newConnector("straightConnector1");
    case "chart":
      return {
        ...base,
        type,
        x: 240,
        y: 120,
        w: 480,
        h: 300,
        chart: {
          type: "column",
          title: "",
          data: [
            ["", "Series 1", "Series 2", "Series 3"],
            ["Category 1", "4.3", "2.4", "2"],
            ["Category 2", "2.5", "4.4", "2"],
            ["Category 3", "3.5", "1.8", "3"],
            ["Category 4", "4.5", "2.8", "5"],
          ],
        },
      };
    case "media":
      return { ...base, type, x: 240, y: 110, w: 480, h: 270, media: { kind: "video", src: src || "" } };
  }
}

/** Default box for a preset shape inserted from the gallery. */
const SQUARE_PRESETS = /^(ellipse|donut|pie|smileyFace|heart|star|octagon|hexagon|pentagon|plus|flowChartConnector|flowChartOffpageConnector|math|cube|frame|lightningBolt|diamond|flowChartSort|flowChartMerge|flowChartExtract|quadArrow)/;
const TALL_PRESETS = /^(upArrow|downArrow|upDownArrow|can)$/;

/** Default gallery size of a preset (PowerPoint-like proportions). */
export function presetDefaultSize(preset: string): { w: number; h: number } {
  if (TALL_PRESETS.test(preset)) return { w: 120, h: 200 };
  if (SQUARE_PRESETS.test(preset)) return { w: 160, h: 160 };
  return { w: 240, h: 120 };
}

/** newShape builds a preset-geometry shape with the preset's default adjust
 *  values left implicit (stored `adj` only once a handle is dragged). */
export function newShape(preset: string, at?: { x: number; y: number; w?: number; h?: number }): SlideElement {
  const size = presetDefaultSize(preset);
  const w = at?.w ?? size.w;
  const h = at?.h ?? size.h;
  return {
    id: uid(),
    type: "shape",
    preset,
    x: at?.x ?? Math.round((CANVAS_W - w) / 2),
    y: at?.y ?? Math.round((CANVAS_H - h) / 2),
    w,
    h,
    fill: "#4285f4",
    stroke: "#1a5dc8",
    strokeWidth: 1,
  };
}

/** newConnector builds a connector from (x1,y1) to (x2,y2) (default: a
 *  horizontal 240 px line in the middle of the slide). */
export function newConnector(
  preset: string,
  opts: { tailEnd?: ArrowHead; headEnd?: ArrowHead; from?: [number, number]; to?: [number, number] } = {},
): SlideElement {
  const [x1, y1] = opts.from ?? [360, 270];
  const [x2, y2] = opts.to ?? [600, 270];
  return {
    id: uid(),
    type: "connector",
    preset,
    ...connectorBox(x1, y1, x2, y2),
    stroke: "#202124",
    strokeWidth: 2,
    ...(opts.headEnd && opts.headEnd !== "none" ? { headEnd: opts.headEnd } : {}),
    ...(opts.tailEnd && opts.tailEnd !== "none" ? { tailEnd: opts.tailEnd } : {}),
  };
}

/** The box + flips that draw a connector from (x1,y1) to (x2,y2): presets
 *  run from the box's top-left to its bottom-right, and flipH/flipV mirror
 *  that (the pptx `cxnSp` convention). */
export function connectorBox(x1: number, y1: number, x2: number, y2: number) {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    x: r(Math.min(x1, x2)),
    y: r(Math.min(y1, y2)),
    w: r(Math.abs(x2 - x1)),
    h: r(Math.abs(y2 - y1)),
    flipH: x2 < x1 ? true : undefined,
    flipV: y2 < y1 ? true : undefined,
    rotation: undefined,
  };
}

export function parseDeck(data?: string): DeckDoc {
  if (!data) return defaultDeck();
  try {
    const d = JSON.parse(data) as DeckDoc;
    if (d && Array.isArray(d.slides) && d.slides.length) return d;
  } catch {
    /* ignore */
  }
  return defaultDeck();
}
