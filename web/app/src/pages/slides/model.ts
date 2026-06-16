// The slides document model. A deck is an ordered list of slides; each slide
// has a background and a list of absolutely-positioned elements. Coordinates
// are in a fixed logical canvas of CANVAS_W × CANVAS_H (16:9); the editor and
// thumbnails scale this to whatever pixel size they render at.

export const CANVAS_W = 960;
export const CANVAS_H = 540;

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
  | "table";

/** Table element data: a grid of cell text (cells[row][col]). */
export interface TableData {
  rows: number;
  cols: number;
  cells: string[][];
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
export type TransitionType =
  | "none"
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-up";

export const TRANSITIONS: { type: TransitionType; label: string }[] = [
  { type: "none", label: "None" },
  { type: "fade", label: "Fade" },
  { type: "slide-left", label: "Slide from right" },
  { type: "slide-right", label: "Slide from left" },
  { type: "slide-up", label: "Slide from bottom" },
];

// Entrance animation type for an element (Google Slides "Animations" pane).
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

/** Per-element entrance animation assigned in the Animations pane. */
export interface ElementAnimation {
  /** Animation type */
  type: AnimationType;
  /** 1-based click order within the slide (lower = plays earlier). */
  order: number;
}

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
  color?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  // shape
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  // image
  src?: string;
  // table
  table?: TableData;
  /** Hyperlink target; clickable in present mode and exports. */
  url?: string;
  /** Clockwise rotation in degrees (absent/0 = upright). */
  rotation?: number;
  /** Mirror horizontally / vertically. */
  flipH?: boolean;
  flipV?: boolean;
  /** Entrance animation for this element (optional; absent = no animation). */
  animation?: ElementAnimation;
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

export interface Slide {
  id: string;
  background: string;
  elements: SlideElement[];
  /** Presenter notes for this slide (shown in the editor notes panel and presenter view). */
  notes?: string;
  /** Transition played when this slide is shown during a slideshow. */
  transition?: TransitionType;
}

export interface DeckDoc {
  slides: Slide[];
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
  }
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
