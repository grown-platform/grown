import {
  useState,
  useRef,
  useEffect,
  useCallback,
  DragEvent,
  ChangeEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  Upload,
  FilePlus,
  Type,
  Image as ImageIcon,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  RotateCw,
  Download,
  Save,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  X,
  MousePointer2,
  Square,
  Circle,
  Minus,
  ArrowUpRight,
  Pencil,
  Highlighter,
  Underline,
  Strikethrough,
  Eraser,
  Undo2,
  Redo2,
  Bold,
  Italic,
  Copy,
  ChevronsUp,
  ChevronsDown,
  ChevronUp,
  ChevronDown,
  ClipboardPaste,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Magnet,
  Grid3x3,
  PanelLeft,
  MoveHorizontal,
  Maximize,
  MoreHorizontal,
  FormInput,
  CheckSquare,
  CircleDot,
  ChevronDownSquare,
  PenTool,
  Signature,
  CalendarDays,
  Check,
  Dot,
  PenLine,
  PaintBucket,
  Squircle,
  Pentagon,
  Spline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  SquareDashed,
  Baseline,
  EyeOff,
} from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { PDFDocument, rgb, StandardFonts, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import { Card, LoadingSpinner } from "tibui";
import { apiClient } from "@/utils/apiClient";
import { SignatureDialog, type SigResult } from "@/features/editor/components/SignatureDialog";
// Self-host the pdf.js worker so the editor works offline / in CI (no CDN).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PAGE_RENDER_WIDTH = 700;
const THUMB_WIDTH = 104; // rendered width (px) of a sidebar page thumbnail
const POINTS_WIDE = 612; // reference page width (pt) for points↔px scaling

function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  className = "",
  onClick,
  title,
  testId,
}: {
  children: React.ReactNode;
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  testId?: string;
}) {
  const sizeStyles = { sm: "px-2 py-1 text-sm", md: "px-4 py-2", lg: "px-6 py-3 text-lg" };
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    outline: "border border-gray-300 bg-transparent hover:bg-gray-50",
    ghost: "bg-transparent hover:bg-gray-100",
  };
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${sizeStyles[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

// ---- Edit model -------------------------------------------------------------
// Annotations use normalized coordinates (0-1) relative to the rendered page.
// Vector shapes render in a pixel-space SVG overlay; text/image render as divs.

type Tool =
  | "select"
  | "text"
  | "image"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "draw"
  | "highlight"
  | "underline"
  | "strikethrough"
  | "whiteout"
  // Wave 5b — true redaction. Drag a rectangle to mark an area for removal;
  // on export the whole page is rasterized (pdfjs → canvas) with the region
  // painted solid black, destroying the underlying text/vector layer.
  | "redact"
  // Wave 5a — markup. eraser deletes annotations (partial-erase for ink);
  // rrect = rounded rectangle (BoxAnnotation with rx); polygon/polyline are
  // click-to-add-vertex poly annotations (closed vs open).
  | "eraser"
  | "rrect"
  | "polygon"
  | "polyline"
  | "field-text"
  | "field-check"
  | "field-radio"
  | "field-dropdown"
  // Wave 4b — signing / Fill & Sign. signature/initials drop a remembered PNG
  // as an image annotation; date drops a text annotation; stamp-* drop small
  // vector marks (reusing the ink/line/ellipse annotation + export paths).
  | "signature"
  | "initials"
  | "date"
  | "stamp-check"
  | "stamp-x"
  | "stamp-dot";

type FontFamily = "Helvetica" | "Times" | "Courier";

type TextAlign = "left" | "center" | "right";
type ListMode = "none" | "bullet" | "number";
interface TextAnnotation {
  id: string;
  type: "text";
  page: number;
  x: number;
  y: number;
  width: number;
  text: string;
  fontSize: number; // pt
  color: string;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  // Wave 5a — rich text. undefined ⇒ back-compat defaults (left / none / 1.2).
  align?: TextAlign;
  list?: ListMode;
  lineSpacing?: number; // line-height multiple (1.0 / 1.15 / 1.5 / 2.0)
}
interface ImageAnnotation {
  id: string;
  type: "image";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
  mime: "image/png" | "image/jpeg";
}
interface BoxAnnotation {
  id: string;
  type: "rect" | "ellipse" | "highlight" | "underline" | "strikethrough" | "whiteout" | "redact";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string | null;
  strokeWidth: number; // pt
  fillColor: string | null;
  opacity: number;
  // Wave 5a. rx = corner radius (pt) on a "rect" ⇒ rounded rect; dash = dashed
  // stroke. Both undefined for pre-Wave-5a snapshots (square / solid).
  rx?: number;
  dash?: boolean;
}
interface LineAnnotation {
  id: string;
  type: "line" | "arrow";
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeColor: string;
  strokeWidth: number; // pt
  dash?: boolean;
}
interface InkAnnotation {
  id: string;
  type: "ink";
  page: number;
  points: { x: number; y: number }[];
  strokeColor: string;
  strokeWidth: number; // pt
}
// Wave 5a — polygon (closed, fillable) / polyline (open). Built by clicking
// vertices; stored as a normalized point list + `closed` flag.
interface PolyAnnotation {
  id: string;
  type: "poly";
  page: number;
  points: { x: number; y: number }[];
  closed: boolean;
  strokeColor: string;
  strokeWidth: number; // pt
  fillColor: string | null;
  opacity: number;
  dash?: boolean;
}
// ---- AcroForm fields (Wave 4a) ---------------------------------------------
// An interactive form field. Shares the x/y/width/height box shape with
// box/image annotations so selection, move, resize, z-order, clipboard and
// undo all reuse the existing infra. `value` is boolean for checkboxes,
// string for text/dropdown/radio (the selected option). `options` drives the
// choices for dropdown + radio; `groupName` is a radio group's export name.
type FieldType = "text" | "checkbox" | "radio" | "dropdown";
interface FieldAnnotation {
  id: string;
  type: "field";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fieldType: FieldType;
  name: string;
  value: string | boolean;
  options?: string[];
  groupName?: string;
  required?: boolean;
  fontSize?: number;
}
type Annotation =
  | TextAnnotation
  | ImageAnnotation
  | BoxAnnotation
  | LineAnnotation
  | InkAnnotation
  | PolyAnnotation
  | FieldAnnotation;

const isBox = (a: Annotation): a is BoxAnnotation =>
  a.type === "rect" || a.type === "ellipse" || a.type === "highlight" ||
  a.type === "underline" || a.type === "strikethrough" || a.type === "whiteout" ||
  a.type === "redact";
const isLine = (a: Annotation): a is LineAnnotation => a.type === "line" || a.type === "arrow";
const isPoly = (a: Annotation): a is PolyAnnotation => a.type === "poly";
const isField = (a: Annotation): a is FieldAnnotation => a.type === "field";

// A blank page (srcIndex === -1) can carry its own size + background template;
// undefined ⇒ Letter / no background (back-compat with pre-Wave-3b snapshots).
type PageBg = "none" | "lined" | "dotted" | "grid";
interface PageEntry {
  srcIndex: number;
  rotation: number;
  // Blank-only (srcIndex === -1): materialized by rebuildPdf/merge into the
  // exported bytes, after which pages become an identity mapping again.
  blankW?: number;
  blankH?: number;
  blankBg?: PageBg;
}

// Named page templates (portrait dimensions in pt). Custom uses user width/height.
type PageSizeName = "Letter" | "Legal" | "A4" | "A3" | "Tabloid" | "Custom";
const PAGE_SIZES: Record<Exclude<PageSizeName, "Custom">, [number, number]> = {
  Letter: [612, 792],
  Legal: [612, 1008],
  A4: [595, 842],
  A3: [842, 1191],
  Tabloid: [792, 1224],
};
const BG_GAP = 24; // spacing (pt) between blank-page background lines/dots

// Draw a light-gray lined / dotted / grid background onto a freshly-added blank.
function drawPageBackground(page: PDFPage, bg: PageBg | undefined) {
  if (!bg || bg === "none") return;
  const { width, height } = page.getSize();
  const color = rgb(0.82, 0.82, 0.82);
  const hLine = (y: number) => page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness: 0.5, color });
  const vLine = (x: number) => page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, thickness: 0.5, color });
  if (bg === "lined") {
    for (let y = BG_GAP; y < height; y += BG_GAP) hLine(y);
  } else if (bg === "grid") {
    for (let y = BG_GAP; y < height; y += BG_GAP) hLine(y);
    for (let x = BG_GAP; x < width; x += BG_GAP) vLine(x);
  } else if (bg === "dotted") {
    for (let y = BG_GAP; y < height; y += BG_GAP)
      for (let x = BG_GAP; x < width; x += BG_GAP) page.drawCircle({ x, y, size: 0.7, color });
  }
}

// Parse a page-range string like "1-3,5" into 0-based indices (unique, ordered,
// clamped to 1..max). Invalid tokens are ignored.
function parsePageRange(str: string, max: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const add = (n: number) => {
    if (n >= 1 && n <= max && !seen.has(n)) {
      seen.add(n);
      out.push(n - 1);
    }
  };
  for (const part of str.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let n = a; n <= b; n++) add(n);
    } else {
      const n = parseInt(t, 10);
      if (!isNaN(n)) add(n);
    }
  }
  return out;
}

// ---- Headers / footers / page numbers / Bates (Wave 3c) ---------------------
// Document-level config (not a per-object annotation): six text slots resolved
// with tokens ({page}/{pages}/{date}/{time}/{filename}/{bates}) at render/export.
// {date}/{time} are captured ONCE when the user clicks Apply (appliedDate/Time)
// so the live preview and every re-render/export agree — never Date.now() at
// render time.
type HfSlot = "headerLeft" | "headerCenter" | "headerRight" | "footerLeft" | "footerCenter" | "footerRight";
interface HeaderFooterConfig {
  enabled: boolean;
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
  batesPrefix: string;
  batesStart: number;
  batesDigits: number;
  fontSize: number; // pt
  color: string;
  range: string; // "all" or a page-range like "1-3,5"
  margin: number; // pt from the page edge
  appliedDate: string; // captured at Apply
  appliedTime: string; // captured at Apply
}
const DEFAULT_HF: HeaderFooterConfig = {
  enabled: false,
  headerLeft: "",
  headerCenter: "",
  headerRight: "",
  footerLeft: "",
  footerCenter: "",
  footerRight: "",
  batesPrefix: "",
  batesStart: 1,
  batesDigits: 4,
  fontSize: 10,
  color: "#444444",
  range: "all",
  margin: 24,
  appliedDate: "",
  appliedTime: "",
};
const HF_SLOTS: { key: HfSlot; testId: string; label: string }[] = [
  { key: "headerLeft", testId: "hf-header-left", label: "Header left" },
  { key: "headerCenter", testId: "hf-header-center", label: "Header center" },
  { key: "headerRight", testId: "hf-header-right", label: "Header right" },
  { key: "footerLeft", testId: "hf-footer-left", label: "Footer left" },
  { key: "footerCenter", testId: "hf-footer-center", label: "Footer center" },
  { key: "footerRight", testId: "hf-footer-right", label: "Footer right" },
];
function zeroPad(n: number, digits: number): string {
  const s = String(Math.max(0, Math.floor(n)));
  const d = Math.max(1, Math.floor(digits));
  return s.length >= d ? s : "0".repeat(d - s.length) + s;
}
// {bates} = prefix + zeroPad(start + pageIndex, digits) (pageIndex 0-based).
function batesFor(hf: HeaderFooterConfig, pageIndex: number): string {
  return hf.batesPrefix + zeroPad(hf.batesStart + pageIndex, hf.batesDigits);
}
// Resolve all tokens in one slot's template for a given (0-based) page.
function resolveHfText(template: string, hf: HeaderFooterConfig, pageIndex: number, pageCount: number, filename: string): string {
  if (!template) return "";
  return template
    .replace(/\{page\}/g, String(pageIndex + 1))
    .replace(/\{pages\}/g, String(pageCount))
    .replace(/\{date\}/g, hf.appliedDate)
    .replace(/\{time\}/g, hf.appliedTime)
    .replace(/\{filename\}/g, filename)
    .replace(/\{bates\}/g, batesFor(hf, pageIndex));
}
// Does the header/footer apply to this (0-based) page? "all"/empty ⇒ every page.
function hfAppliesTo(hf: HeaderFooterConfig, pageIndex: number, pageCount: number): boolean {
  const r = hf.range.trim().toLowerCase();
  if (!r || r === "all") return true;
  return parsePageRange(hf.range, pageCount).includes(pageIndex);
}

const DEFAULT_FONT_SIZE = 16;
// Drag-to-draw tools (mousedown → drag → mouseup commits). rrect draws like a
// rect but with a corner radius. polygon/polyline are click-to-add-vertex and
// are handled separately (POLY_TOOLS).
const SHAPE_TOOLS: Tool[] = ["rect", "rrect", "ellipse", "line", "arrow", "draw", "highlight", "underline", "strikethrough", "whiteout", "redact"];
const POLY_TOOLS: Tool[] = ["polygon", "polyline"];
const isPolyTool = (t: Tool): boolean => POLY_TOOLS.includes(t);
const DEFAULT_RX = 12; // default rounded-rect corner radius (pt)
const DASH_PT: [number, number] = [6, 4]; // dashed-stroke pattern (pt)
const FIELD_TOOLS: Tool[] = ["field-text", "field-check", "field-radio", "field-dropdown"];
const isFieldTool = (t: Tool): boolean => FIELD_TOOLS.includes(t);
// Wave 4b: click-to-place tools (signature/initials/date + quick stamps). A
// single click on the page drops the mark, so they resolve in the overlay
// onClick (like text/image) rather than via a drag.
const STAMP_TOOLS: Tool[] = ["stamp-check", "stamp-x", "stamp-dot"];
const PLACE_TOOLS: Tool[] = ["signature", "initials", "date", ...STAMP_TOOLS];
const isPlaceTool = (t: Tool): boolean => PLACE_TOOLS.includes(t);
// Stamp mark colors (fixed, so quick marks read consistently).
const STAMP_COLOR: Record<string, string> = { "stamp-check": "#16a34a", "stamp-x": "#dc2626", "stamp-dot": "#111827" };
// Map a field placement tool to the field variant it creates.
const FIELD_TOOL_TYPE: Record<string, FieldType> = {
  "field-text": "text",
  "field-check": "checkbox",
  "field-radio": "radio",
  "field-dropdown": "dropdown",
};
// Default normalized field size for a click-placed field. Checkbox/radio need a
// square-ish box, so height is derived from width via the page aspect (the px
// scale is uniform) to look square on screen.
function defaultFieldRect(ft: FieldType, x: number, y: number, pageAspect: number): { x: number; y: number; width: number; height: number } {
  let width: number;
  let height: number;
  if (ft === "checkbox") {
    width = 0.03;
    height = width / pageAspect;
  } else if (ft === "radio") {
    width = 0.28;
    height = 0.09; // ~2 stacked options
  } else {
    width = 0.28;
    height = 0.035;
  }
  return { x: clamp01(Math.min(x, 1 - width)), y: clamp01(Math.min(y, 1 - height)), width, height };
}
// Parse a comma/newline-separated options list into a trimmed, non-empty array.
function parseOptions(str: string): string[] {
  return str
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}
function cssFamily(f: FontFamily) {
  return f === "Times" ? "Georgia, 'Times New Roman', serif" : f === "Courier" ? "'Courier New', monospace" : "Helvetica, Arial, sans-serif";
}
// Wave 5a — the list-item prefix for logical line `i` under a list mode.
function listPrefix(list: ListMode | undefined, i: number): string {
  return list === "bullet" ? "• " : list === "number" ? `${i + 1}. ` : "";
}
// Greedy word-wrap of one logical line to `maxWidth` (pt) for the export. A word
// wider than maxWidth is placed on its own line (overflow) rather than dropped.
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [""];
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const trial = cur ? `${cur} ${word}` : word;
    if (!cur || font.widthOfTextAtSize(trial, size) <= maxWidth) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

// Translate an annotation by a normalized delta (for moving).
function translate(a: Annotation, dx: number, dy: number): Annotation {
  if (isLine(a)) return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
  if (a.type === "ink" || a.type === "poly") return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  return { ...a, x: clamp01((a as BoxAnnotation).x + dx), y: clamp01((a as BoxAnnotation).y + dy) };
}

// Normalized bounding box {x0,y0,x1,y1} for an annotation (used by marquee +
// multi-select outlines). Text height is approximated from its font size.
type NBox = { x0: number; y0: number; x1: number; y1: number };
function annotBBox(a: Annotation, pageAspect: number): NBox {
  if (isLine(a)) {
    return { x0: Math.min(a.x1, a.x2), y0: Math.min(a.y1, a.y2), x1: Math.max(a.x1, a.x2), y1: Math.max(a.y1, a.y2) };
  }
  if (a.type === "ink" || a.type === "poly") {
    const xs = a.points.map((p) => p.x);
    const ys = a.points.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  if (a.type === "text") {
    const h = (a.fontSize * 1.2) / (POINTS_WIDE * pageAspect);
    return { x0: a.x, y0: a.y, x1: a.x + a.width, y1: a.y + Math.max(0.02, h) };
  }
  const b = a as BoxAnnotation | ImageAnnotation;
  return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
}
function boxesIntersect(a: NBox, b: NBox): boolean {
  return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
}
// Distance (px) from point to a line segment — for click-selecting lines/ink.
function segDistPx(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
// Ray-casting point-in-polygon (pts in the same space as px/py).
function pointInPoly(px: number, py: number, pts: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- Wave 2b geometry: resize / snapping / grid -----------------------------
const MIN_SIZE = 0.02; // smallest normalized box/image edge
const SNAP_PX = 6; // snap threshold, screen px
const GRID_PX = 24; // grid cell size, screen px

// The 8 perimeter handles for box/image, plus text ("br") and line endpoints.
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "br" | "p1" | "p2";

// A live guide line while snapping: exactly one of x/y is set (normalized).
type Guide = { x?: number; y?: number };

// Snap candidate coordinates from a set of annotations: each edge + center on
// both axes, plus the page mid-lines (0.5). Used for move + resize snapping.
function snapTargets(annots: Annotation[], pageAspect: number): { xs: number[]; ys: number[] } {
  const xs: number[] = [0.5];
  const ys: number[] = [0.5];
  for (const a of annots) {
    const b = annotBBox(a, pageAspect);
    xs.push(b.x0, (b.x0 + b.x1) / 2, b.x1);
    ys.push(b.y0, (b.y0 + b.y1) / 2, b.y1);
  }
  return { xs, ys };
}
// Snap a single value to the nearest target within threshold (else unchanged).
function snapValue(v: number, targets: number[], threshold: number): { value: number; snapped: boolean } {
  let best: { d: number; v: number } | null = null;
  for (const t of targets) {
    const d = Math.abs(t - v);
    if (d <= threshold && (best === null || d < best.d)) best = { d, v: t };
  }
  return best ? { value: best.v, snapped: true } : { value: v, snapped: false };
}
function snapToGrid(v: number, cell: number): number {
  return Math.round(v / cell) * cell;
}
// Snap the moving selection's bbox (left/center/right, top/mid/bottom) to
// nearby targets. Returns the delta to apply + the active guide lines.
function computeMoveSnap(moving: NBox, targets: { xs: number[]; ys: number[] }, thX: number, thY: number): { dx: number; dy: number; guides: Guide[] } {
  const guides: Guide[] = [];
  let dx = 0;
  let dy = 0;
  const xs = [moving.x0, (moving.x0 + moving.x1) / 2, moving.x1];
  let bestX: { d: number; line: number } | null = null;
  for (const s of xs) {
    for (const t of targets.xs) {
      const d = t - s;
      if (Math.abs(d) <= thX && (bestX === null || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, line: t };
    }
  }
  if (bestX) {
    dx = bestX.d;
    guides.push({ x: bestX.line });
  }
  const ys = [moving.y0, (moving.y0 + moving.y1) / 2, moving.y1];
  let bestY: { d: number; line: number } | null = null;
  for (const s of ys) {
    for (const t of targets.ys) {
      const d = t - s;
      if (Math.abs(d) <= thY && (bestY === null || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, line: t };
    }
  }
  if (bestY) {
    dy = bestY.d;
    guides.push({ y: bestY.line });
  }
  return { dx, dy, guides };
}
// Resize a box/image from its start geometry, keeping the opposite edge/corner
// anchored. `shift` on a corner locks the aspect ratio (normalized w:h — which,
// since the px scale is uniform, preserves the visual ratio too).
function resizeBox(
  start: { x: number; y: number; width: number; height: number },
  handle: ResizeHandle,
  nx: number,
  ny: number,
  shift: boolean,
  min: number,
): { x: number; y: number; width: number; height: number } {
  const sx0 = start.x;
  const sy0 = start.y;
  const sx1 = start.x + start.width;
  const sy1 = start.y + start.height;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  let x0 = sx0;
  let x1 = sx1;
  let y0 = sy0;
  let y1 = sy1;
  if (east) x1 = Math.max(sx0 + min, nx);
  if (west) x0 = Math.min(sx1 - min, nx);
  if (south) y1 = Math.max(sy0 + min, ny);
  if (north) y0 = Math.min(sy1 - min, ny);
  let w = x1 - x0;
  let h = y1 - y0;
  if (shift && (east || west) && (north || south) && start.width > 0 && start.height > 0) {
    const scale = Math.max(w / start.width, h / start.height);
    w = start.width * scale;
    h = start.height * scale;
  }
  return {
    x: west ? sx1 - w : sx0,
    y: north ? sy1 - h : sy0,
    width: w,
    height: h,
  };
}

// ---- True redaction (Wave 5b) ----------------------------------------------
// Decode a "data:image/png;base64,…" URL to raw bytes for pdf-lib embedding.
function dataUrlToBytes(dataUrl: string): Uint8Array {
  return Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
}
// Rasterize ONE page (0-based) to a PNG data URL via pdfjs at `scale`, painting
// each redaction rect solid black. Returns the PNG plus the page's visual size
// in points (rotation applied) so the replacement PDF page keeps identical
// dimensions. Normalized rects are top-left / y-down — the same convention as
// the canvas, so no flip is needed.
async function rasterizeRedactedPage(
  pdf: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>,
  pageIndex: number,
  redacts: BoxAnnotation[],
  scale = 2,
): Promise<{ png: string; w: number; h: number }> {
  const page = await pdf.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 }); // points, rotation applied
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  // White backdrop so any transparent regions flatten to a printable page.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  ctx.fillStyle = "#000000";
  for (const a of redacts) {
    ctx.fillRect(a.x * canvas.width, a.y * canvas.height, a.width * canvas.width, a.height * canvas.height);
  }
  return { png: canvas.toDataURL("image/png"), w: base.width, h: base.height };
}
// Build a new PDFDocument where every page carrying ≥1 redaction mark is
// replaced by a flattened raster image (original content destroyed + regions
// blacked out); pages without redactions are copied unchanged (stay vector).
// The `rasterized` set is filled with the 0-based indices that were successfully
// flattened so the caller can skip drawing their (already-baked) black boxes and
// fall back to an opaque pdf-lib box for any page rasterization missed.
async function rasterizeRedactedPages(
  srcDoc: PDFDocument,
  srcBytes: Uint8Array,
  redacts: BoxAnnotation[],
  rasterized: Set<number>,
): Promise<PDFDocument> {
  const pagesWithRedact = Array.from(new Set(redacts.map((a) => a.page - 1))).sort((p, q) => p - q);
  const rasterMap = new Map<number, { png: string; w: number; h: number }>();
  try {
    // pdfjs may detach the buffer it's given — pass a fresh copy so srcBytes
    // (also used by react-pdf) is never corrupted.
    const task = pdfjs.getDocument({ data: srcBytes.slice() });
    const pdf = await task.promise;
    for (const pi of pagesWithRedact) {
      try {
        rasterMap.set(pi, await rasterizeRedactedPage(pdf, pi, redacts.filter((a) => a.page - 1 === pi)));
      } catch {
        // Leave unmapped → the caller draws an opaque black box fallback.
      }
    }
    try {
      await pdf.cleanup();
    } catch {
      /* ignore */
    }
    try {
      await task.destroy();
    } catch {
      /* ignore */
    }
  } catch {
    // Whole-document rasterize failed → every redacted page falls back to a box.
  }
  if (!rasterMap.size) return srcDoc; // nothing flattened; keep the vector doc
  const out = await PDFDocument.create();
  const total = srcDoc.getPageCount();
  for (let i = 0; i < total; i++) {
    const r = rasterMap.get(i);
    if (r) {
      const png = await out.embedPng(dataUrlToBytes(r.png));
      const p = out.addPage([r.w, r.h]);
      p.drawImage(png, { x: 0, y: 0, width: r.w, height: r.h });
      rasterized.add(i);
    } else {
      const [copied] = await out.copyPages(srcDoc, [i]);
      out.addPage(copied);
    }
  }
  return out;
}

export function EditorPage() {
  const navigate = useNavigate();

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [docName, setDocName] = useState("Untitled");

  const [pages, setPages] = useState<PageEntry[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const annotationsRef = useRef<Annotation[]>([]);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);
  // Mirror pages + pdfBytes into refs so history snapshots (called from event
  // handlers with possibly-stale closures) always capture the live values.
  const pagesRef = useRef<PageEntry[]>([]);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  const pdfBytesRef = useRef<Uint8Array | null>(null);

  const [numRendered, setNumRendered] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  // Fit mode re-applies zoom from the container size on resize until the user
  // manually zooms (which flips this back to "manual").
  const [zoomMode, setZoomMode] = useState<"manual" | "fit-width" | "fit-page">("manual");
  const [pageAspect, setPageAspect] = useState(792 / POINTS_WIDE);
  // Thumbnail sidebar (collapsible) + its open per-page "⋯" menu + drag source.
  // Collapsed by default: expanding mounts a second react-pdf render per page.
  const [showThumbs, setShowThumbs] = useState(false);
  const [thumbMenu, setThumbMenu] = useState<number | null>(null);
  const dragThumb = useRef<number | null>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  // Multi-select: the selection is a set of ids. `selectedId` (derived below)
  // is non-null only when exactly one annotation is selected, so the existing
  // single-selection code paths (properties panel, resize) keep working.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef = useRef<string[]>([]);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);
  // Text annotation currently being typed/edited directly on the page.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Marquee (rubber-band) selection rect while dragging on empty canvas.
  const [marquee, setMarquee] = useState<NBox | null>(null);
  // Internal clipboard (deliberately NOT the async system clipboard).
  const clipboard = useRef<Annotation[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // ---- Assemble dialogs (Wave 3b): blank template / import / extract / delete-range
  // + headerfooter (Wave 3c). All share the modal overlay below.
  const [dialog, setDialog] = useState<null | "blank" | "extract" | "deleteRange" | "headerfooter">(null);
  // Header/footer document config (Wave 3c). Its own state, persisted across
  // page navigation; not part of the annotation undo stack.
  const [hf, setHf] = useState<HeaderFooterConfig>(DEFAULT_HF);
  const patchHf = (patch: Partial<HeaderFooterConfig>) => setHf((h) => ({ ...h, ...patch }));
  const [blankSize, setBlankSize] = useState<PageSizeName>("Letter");
  const [blankOrient, setBlankOrient] = useState<"portrait" | "landscape">("portrait");
  const [blankBg, setBlankBg] = useState<PageBg>("none");
  const [blankCustomW, setBlankCustomW] = useState(612);
  const [blankCustomH, setBlankCustomH] = useState(792);
  const [extractRange, setExtractRange] = useState("");
  const [deleteRangeStr, setDeleteRangeStr] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Annotation | null>(null);
  const draftRef = useRef<Annotation | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Default style for newly drawn shapes.
  const [strokeColor, setStrokeColor] = useState("#e11d48");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fillColor, setFillColor] = useState<string | null>(null);
  const [textColor] = useState("#111111");
  // Wave 5a — dashed toggle for newly drawn shapes/lines/polys.
  const [shapeDash, setShapeDash] = useState(false);
  // Wave 5a — eraser radius (screen px). A drag erases everything the cursor
  // passes within this radius. `eraseState` marks an active erase gesture (one
  // snapshot per drag).
  const [eraserSize, setEraserSize] = useState(14);
  const eraserSizeRef = useRef(eraserSize);
  useEffect(() => {
    eraserSizeRef.current = eraserSize;
  }, [eraserSize]);
  const eraseState = useRef(false);
  // Wave 5a — in-progress polygon/polyline vertices (click to add; Enter/Esc/
  // double-click to finish). `polyCursor` is the live rubber-band endpoint.
  const [polyDraft, setPolyDraft] = useState<{ tool: "polygon" | "polyline"; points: { x: number; y: number }[] } | null>(null);
  const polyDraftRef = useRef<typeof polyDraft>(null);
  useEffect(() => {
    polyDraftRef.current = polyDraft;
  }, [polyDraft]);
  const [polyCursor, setPolyCursor] = useState<{ x: number; y: number } | null>(null);
  // Abandon an in-progress polygon/polyline when leaving the poly tools.
  useEffect(() => {
    if (!isPolyTool(tool)) {
      polyDraftRef.current = null;
      setPolyDraft(null);
      setPolyCursor(null);
    }
  }, [tool]);
  // Export option (Wave 4a): bake form fields into static content when ON.
  const [flattenForms, setFlattenForms] = useState(false);
  // ---- Signing / Fill & Sign (Wave 4b) --------------------------------------
  // The remembered signature + initials assets (a PNG/JPEG + natural size), so
  // repeated placement reuses them without reopening the dialog. `sigDialog`
  // holds which kind is currently being created (null = closed). `fillSign`
  // reveals the compact quick-fill toolbar.
  const [sigAsset, setSigAsset] = useState<SigResult | null>(null);
  const [initialsAsset, setInitialsAsset] = useState<SigResult | null>(null);
  const [sigDialog, setSigDialog] = useState<null | "signature" | "initials">(null);
  const [fillSign, setFillSign] = useState(false);
  // Monotonic counter for default field names (text_1, checkbox_2, …).
  const fieldSeq = useRef(0);

  // ---- Snapping + grid (Wave 2b) --------------------------------------------
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [gridEnabled, setGridEnabled] = useState(false);
  const snapEnabledRef = useRef(snapEnabled);
  const gridEnabledRef = useRef(gridEnabled);
  useEffect(() => {
    snapEnabledRef.current = snapEnabled;
  }, [snapEnabled]);
  useEffect(() => {
    gridEnabledRef.current = gridEnabled;
  }, [gridEnabled]);
  // Live alignment guide lines (normalized); cleared on mouse-up.
  const [guides, setGuides] = useState<Guide[]>([]);

  const overlayRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImagePoint = useRef<{ x: number; y: number } | null>(null);

  // A move drags every id in `ids` (group move). We track the pointer origin +
  // the selection's start bbox so snapping can work off absolute positions, and
  // `applied` remembers the delta committed so far (translate is incremental).
  const dragState = useRef<{
    ids: string[];
    originX: number;
    originY: number;
    bbox0: NBox;
    applied: { dx: number; dy: number };
    targets: { xs: number[]; ys: number[] };
  } | null>(null);
  const drawState = useRef<{
    tool: Tool;
    sx: number;
    sy: number;
    style: { strokeColor: string; strokeWidth: number; fillColor: string | null; dash: boolean };
  } | null>(null);
  const resizeState = useRef<{
    id: string;
    handle: ResizeHandle;
    start: { x: number; y: number; width: number; height: number } | null;
    targets: { xs: number[]; ys: number[] };
  } | null>(null);
  // Marquee selection drag on empty canvas.
  const marqueeState = useRef<{ sx: number; sy: number; additive: boolean; box: NBox; moved: boolean } | null>(null);
  // A shape click/marquee-drag already resolved selection — stop the trailing
  // canvas onClick from clearing it.
  const suppressCanvasClick = useRef(false);
  // True once a move gesture actually translated the selection, so a field's
  // trailing onClick (fill/toggle) is skipped after a drag-move.
  const gestureMoved = useRef(false);

  // ---- Undo / redo ----------------------------------------------------------
  // A snapshot captures BOTH annotations AND the page structure (+ the pdf bytes
  // those pages were serialized from). Page ops re-serialize the PDF, so simply
  // restoring the captured bytes+pages is the equivalent of re-running
  // rebuildPdf for the restored structure — and avoids srcIndex drift across
  // rebuilds. Annotation-only ops reuse the same bytes reference (no reload).
  interface HistSnap {
    annotations: Annotation[];
    pages: PageEntry[];
    bytes: Uint8Array | null;
  }
  const undoStack = useRef<HistSnap[]>([]);
  const redoStack = useRef<HistSnap[]>([]);
  const [, setHistTick] = useState(0);
  const captureState = useCallback(
    (): HistSnap => ({
      annotations: JSON.parse(JSON.stringify(annotationsRef.current)),
      pages: JSON.parse(JSON.stringify(pagesRef.current)),
      bytes: pdfBytesRef.current,
    }),
    [],
  );
  const restoreState = useCallback((s: HistSnap) => {
    setAnnotations(s.annotations);
    setPages(s.pages);
    // Same reference for annotation-only history entries → no PDF reload.
    setPdfBytes(s.bytes);
    setCurrentPage((p) => Math.min(Math.max(1, p), Math.max(1, s.pages.length)));
    setSelectedIds([]);
    setEditingId(null);
  }, []);
  const snapshot = useCallback(() => {
    undoStack.current.push(captureState());
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
    setHistTick((t) => t + 1);
  }, [captureState]);
  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    redoStack.current.push(captureState());
    restoreState(undoStack.current.pop()!);
    setHistTick((t) => t + 1);
  }, [captureState, restoreState]);
  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current.push(captureState());
    restoreState(redoStack.current.pop()!);
    setHistTick((t) => t + 1);
  }, [captureState, restoreState]);

  // ---- Blob URL lifecycle ---------------------------------------------------
  useEffect(() => {
    pdfBytesRef.current = pdfBytes;
    if (!pdfBytes) {
      setFileUrl(null);
      return;
    }
    const blob = new Blob([pdfBytes.slice()], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfBytes]);

  const renderWidth = PAGE_RENDER_WIDTH * zoom;
  const overlayH = renderWidth * pageAspect;
  const pxScale = renderWidth / POINTS_WIDE; // pt → screen px
  const pageCount = pages.length;
  const pageAnnotations = annotations.filter((a) => a.page === currentPage);
  // Any redaction marks present ⇒ their pages flatten to images on export.
  const hasRedactions = annotations.some((a) => a.type === "redact");
  // Single-selection derived id: null unless exactly one is selected. The
  // properties panel + resize handles key off this so they only appear then.
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selected = selectedId ? (annotations.find((a) => a.id === selectedId) ?? null) : null;
  const isSelected = (id: string) => selectedIds.includes(id);
  const currentPageRef = useRef(currentPage);
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);
  const pageAspectRef = useRef(pageAspect);
  useEffect(() => {
    pageAspectRef.current = pageAspect;
  }, [pageAspect]);

  // ---- Fit-to zoom ----------------------------------------------------------
  // Derive a zoom from the scroll container's available size. `zoomMode` keeps
  // the chosen fit sticky across window resizes until a manual zoom.
  const computeFit = useCallback((mode: "fit-width" | "fit-page") => {
    const el = canvasScrollRef.current;
    if (!el) return;
    const pad = 32; // container p-4 (16px each side)
    const availW = el.clientWidth - pad;
    const availH = el.clientHeight - pad;
    const raw =
      mode === "fit-width"
        ? availW / PAGE_RENDER_WIDTH
        : availH / (pageAspectRef.current * PAGE_RENDER_WIDTH);
    if (!isFinite(raw) || raw <= 0) return;
    setZoom(+Math.max(0.1, Math.min(4, raw)).toFixed(3));
  }, []);
  const applyFit = (mode: "fit-width" | "fit-page") => {
    setZoomMode(mode);
    computeFit(mode);
  };
  // Close the thumbnail per-page menu on any outside click / Escape.
  useEffect(() => {
    if (thumbMenu === null) return;
    const close = () => setThumbMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setThumbMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [thumbMenu]);

  // Re-apply the active fit on window resize + when the page aspect changes.
  useEffect(() => {
    if (zoomMode === "manual") return;
    const onResize = () => computeFit(zoomMode);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [zoomMode, computeFit]);
  useEffect(() => {
    if (zoomMode !== "manual") computeFit(zoomMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageAspect]);

  // ---- Loading --------------------------------------------------------------
  const loadFromBytes = useCallback(async (bytes: Uint8Array, name: string) => {
    setError(null);
    try {
      // ignoreEncryption: load PDFs that carry permissions encryption (no user
      // password), e.g. many gov/AF forms — pdf-lib throws on them otherwise.
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const count = doc.getPageCount();
      setPdfBytes(bytes);
      setDocName(name);
      setPages(Array.from({ length: count }, (_, i) => ({ srcIndex: i, rotation: 0 })));
      setAnnotations([]);
      undoStack.current = [];
      redoStack.current = [];
      setCurrentPage(1);
      setSelectedIds([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read PDF — is it valid?");
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        setError("Please choose a PDF file.");
        return;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      await loadFromBytes(buf, file.name.replace(/\.pdf$/i, ""));
    },
    [loadFromBytes],
  );

  const handleNewBlank = useCallback(async () => {
    setError(null);
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    setPdfBytes(bytes);
    setDocName("Untitled");
    setPages([{ srcIndex: -1, rotation: 0 }]);
    setAnnotations([]);
    undoStack.current = [];
    redoStack.current = [];
    setCurrentPage(1);
    setSelectedIds([]);
  }, []);

  // ---- Page structure -------------------------------------------------------
  const rebuildPdf = useCallback(
    async (nextPages: PageEntry[]) => {
      if (!pdfBytes) return;
      setBusy(true);
      try {
        const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const out = await PDFDocument.create();
        for (const entry of nextPages) {
          if (entry.srcIndex >= 0 && entry.srcIndex < src.getPageCount()) {
            const [copied] = await out.copyPages(src, [entry.srcIndex]);
            if (entry.rotation) {
              const base = copied.getRotation().angle;
              copied.setRotation(degrees((base + entry.rotation) % 360));
            }
            out.addPage(copied);
          } else {
            const p = out.addPage([entry.blankW ?? 612, entry.blankH ?? 792]);
            if (entry.rotation) p.setRotation(degrees(entry.rotation % 360));
            drawPageBackground(p, entry.blankBg);
          }
        }
        const bytes = await out.save();
        setPages(nextPages.map((_, i) => ({ srcIndex: i, rotation: 0 })));
        setPdfBytes(bytes);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Page operation failed");
      } finally {
        setBusy(false);
      }
    },
    [pdfBytes],
  );

  // Index-based page ops (0-based `idx`). Each snapshots first (so it's
  // undoable together with its annotation remap), remaps annotation `page`
  // numbers, then re-serializes via rebuildPdf.
  const insertBlankAt = useCallback(
    (idx: number, opts?: { blankW?: number; blankH?: number; blankBg?: PageBg }) => {
      snapshot();
      const next = [...pagesRef.current];
      next.splice(idx, 0, { srcIndex: -1, rotation: 0, ...opts });
      setAnnotations((prev) => prev.map((a) => (a.page >= idx + 1 ? { ...a, page: a.page + 1 } : a)));
      rebuildPdf(next).then(() => setCurrentPage(idx + 1));
    },
    [snapshot, rebuildPdf],
  );
  const deletePageAt = useCallback(
    (idx: number) => {
      if (pagesRef.current.length <= 1) return;
      snapshot();
      const pageNum = idx + 1;
      const next = pagesRef.current.filter((_, i) => i !== idx);
      setAnnotations((prev) =>
        prev.filter((a) => a.page !== pageNum).map((a) => (a.page > pageNum ? { ...a, page: a.page - 1 } : a)),
      );
      rebuildPdf(next).then(() => setCurrentPage((c) => Math.min(c, next.length)));
    },
    [snapshot, rebuildPdf],
  );
  // Duplicate page `idx` right after itself, cloning its annotations too.
  const duplicatePageAt = useCallback(
    (idx: number) => {
      snapshot();
      const pageNum = idx + 1;
      const next = [...pagesRef.current];
      next.splice(idx + 1, 0, { ...pagesRef.current[idx] });
      setAnnotations((prev) => {
        const shifted = prev.map((a) => (a.page > pageNum ? { ...a, page: a.page + 1 } : a));
        const clones = prev
          .filter((a) => a.page === pageNum)
          .map((a) => {
            const c = JSON.parse(JSON.stringify(a)) as Annotation;
            c.id = uid();
            c.page = pageNum + 1;
            return c;
          });
        return [...shifted, ...clones];
      });
      rebuildPdf(next).then(() => setCurrentPage(idx + 2));
    },
    [snapshot, rebuildPdf],
  );
  const rotatePageAt = useCallback(
    (idx: number) => {
      snapshot();
      const next = pagesRef.current.map((p, i) => (i === idx ? { ...p, rotation: (p.rotation + 90) % 360 } : p));
      rebuildPdf(next);
    },
    [snapshot, rebuildPdf],
  );
  // Move page from `from` to `to` (both 0-based). Used by Up/Down + thumb drag.
  const reorderPages = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || to < 0) return;
      snapshot();
      const cur = pagesRef.current;
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // Old→new page-number map via the same permutation on identity indices.
      const order = cur.map((_, i) => i);
      const [m] = order.splice(from, 1);
      order.splice(to, 0, m);
      const oldToNew = new Map<number, number>();
      order.forEach((oldIdx, newIdx) => oldToNew.set(oldIdx + 1, newIdx + 1));
      setAnnotations((prev) => prev.map((a) => ({ ...a, page: oldToNew.get(a.page) ?? a.page })));
      rebuildPdf(next).then(() => setCurrentPage(to + 1));
    },
    [snapshot, rebuildPdf],
  );

  // ---- Assemble: merge another PDF + delete a range -------------------------
  // Merge an imported PDF into the base bytes. We rebuild a fresh combined base
  // in the CURRENT page order (materializing edits/rotations/blanks), splice the
  // imported pages in after the current page, then reset `pages` to an identity
  // mapping over the combined doc. Undoable; existing annotations are preserved
  // (imported pages carry none) and shifted for pages after the insert point.
  const handleImportPdf = useCallback(
    async (file: File) => {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        setError("Please choose a PDF file.");
        return;
      }
      const baseBytes = pdfBytesRef.current;
      if (!baseBytes) return;
      setBusy(true);
      setError(null);
      try {
        const impBytes = new Uint8Array(await file.arrayBuffer());
        const base = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
        const imp = await PDFDocument.load(impBytes, { ignoreEncryption: true });
        const curPages = pagesRef.current;
        const out = await PDFDocument.create();
        const impIndices = imp.getPageIndices();
        const impCopied = await out.copyPages(imp, impIndices);
        // Insert the imported pages AFTER this 1-based page number.
        const insertPos = Math.min(currentPageRef.current, curPages.length);
        let inserted = false;
        for (let i = 0; i < curPages.length; i++) {
          const entry = curPages[i];
          if (entry.srcIndex >= 0 && entry.srcIndex < base.getPageCount()) {
            const [copied] = await out.copyPages(base, [entry.srcIndex]);
            if (entry.rotation) copied.setRotation(degrees((copied.getRotation().angle + entry.rotation) % 360));
            out.addPage(copied);
          } else {
            const p = out.addPage([entry.blankW ?? 612, entry.blankH ?? 792]);
            if (entry.rotation) p.setRotation(degrees(entry.rotation % 360));
            drawPageBackground(p, entry.blankBg);
          }
          if (i + 1 === insertPos) {
            for (const ip of impCopied) out.addPage(ip);
            inserted = true;
          }
        }
        if (!inserted) for (const ip of impCopied) out.addPage(ip);
        const combined = await out.save();
        // Verify the combined page count = original + imported.
        const check = await PDFDocument.load(combined, { ignoreEncryption: true });
        const expected = curPages.length + impIndices.length;
        if (check.getPageCount() !== expected) {
          throw new Error(`Merge produced ${check.getPageCount()} pages, expected ${expected}`);
        }
        snapshot();
        const impCount = impIndices.length;
        setAnnotations((prev) => prev.map((a) => (a.page > insertPos ? { ...a, page: a.page + impCount } : a)));
        setPages(Array.from({ length: expected }, (_, i) => ({ srcIndex: i, rotation: 0 })));
        setPdfBytes(combined);
        setCurrentPage(insertPos + 1);
        setSelectedIds([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to import PDF");
      } finally {
        setBusy(false);
      }
    },
    [snapshot],
  );

  // Delete every page in a range string ("1-3,5") at once. Keeps ≥1 page.
  const handleDeleteRange = useCallback(
    (rangeStr: string) => {
      const cur = pagesRef.current;
      const indices = parsePageRange(rangeStr, cur.length);
      if (!indices.length) return;
      const delSet = new Set(indices.map((i) => i + 1)); // 1-based page numbers
      const next = cur.filter((_, i) => !delSet.has(i + 1));
      if (!next.length) {
        setError("Cannot delete all pages.");
        return;
      }
      snapshot();
      setAnnotations((prev) =>
        prev
          .filter((a) => !delSet.has(a.page))
          .map((a) => {
            const shift = [...delSet].filter((d) => d < a.page).length;
            return shift ? { ...a, page: a.page - shift } : a;
          }),
      );
      rebuildPdf(next).then(() => setCurrentPage((c) => Math.min(c, next.length)));
    },
    [snapshot, rebuildPdf],
  );

  // Thin wrappers preserving the existing Pages-panel button semantics.
  const addBlankPage = () => insertBlankAt(currentPage);
  const deletePage = () => deletePageAt(currentPage - 1);
  const movePage = (dir: "up" | "down") =>
    reorderPages(currentPage - 1, dir === "up" ? currentPage - 2 : currentPage);
  const rotatePage = () => rotatePageAt(currentPage - 1);

  // ---- Pointer geometry -----------------------------------------------------
  const toNorm = (clientX: number, clientY: number) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  // Hit-test an SVG-rendered annotation (box/line/ink). The interaction overlay
  // sits on top of the SVG, so shape selection is resolved here rather than by
  // per-shape DOM events. (text/image are DOM children with their own handlers.)
  const hitTestShape = (a: Annotation, clientX: number, clientY: number): boolean => {
    const rect = overlayRef.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const X = (nx: number) => nx * rect.width;
    const Y = (ny: number) => ny * rect.height;
    if (isBox(a)) {
      return px >= X(a.x) - 4 && px <= X(a.x + a.width) + 4 && py >= Y(a.y) - 4 && py <= Y(a.y + a.height) + 4;
    }
    if (isLine(a)) return segDistPx(px, py, X(a.x1), Y(a.y1), X(a.x2), Y(a.y2)) <= 8;
    if (a.type === "ink") {
      for (let i = 1; i < a.points.length; i++) {
        if (segDistPx(px, py, X(a.points[i - 1].x), Y(a.points[i - 1].y), X(a.points[i].x), Y(a.points[i].y)) <= 8) return true;
      }
    }
    if (a.type === "poly") {
      const n = a.points.length;
      for (let i = 1; i < n; i++) {
        if (segDistPx(px, py, X(a.points[i - 1].x), Y(a.points[i - 1].y), X(a.points[i].x), Y(a.points[i].y)) <= 8) return true;
      }
      if (a.closed && n > 2) {
        if (segDistPx(px, py, X(a.points[n - 1].x), Y(a.points[n - 1].y), X(a.points[0].x), Y(a.points[0].y)) <= 8) return true;
        // Point-in-polygon so a filled polygon is selectable by its interior.
        if (a.fillColor && pointInPoly(px, py, a.points.map((p) => ({ x: X(p.x), y: Y(p.y) })))) return true;
      }
    }
    return false;
  };

  // Build a new field annotation of the given variant at a normalized rect.
  const makeField = (ft: FieldType, rect: { x: number; y: number; width: number; height: number }): FieldAnnotation => {
    const n = ++fieldSeq.current;
    const base: FieldAnnotation = {
      id: uid(),
      type: "field",
      page: currentPageRef.current,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      fieldType: ft,
      name: `${ft}_${n}`,
      value: ft === "checkbox" ? false : "",
      fontSize: 12,
    };
    if (ft === "dropdown") base.options = ["Option 1", "Option 2"];
    if (ft === "radio") {
      base.options = ["Option 1", "Option 2"];
      base.groupName = `radio_${n}`;
    }
    return base;
  };
  // Patch a field annotation by id (used by inline fill controls, which may act
  // on a field that isn't the single selection).
  const setFieldValue = (id: string, patch: Partial<FieldAnnotation>) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id && isField(a) ? { ...a, ...patch } : a)));
  };

  // ---- Eraser (Wave 5a) -----------------------------------------------------
  // Erase every annotation on the current page the cursor passes within the
  // eraser radius. Ink is trimmed rather than deleted: points inside the radius
  // are removed and each surviving contiguous run (≥2 points) becomes its own
  // ink annotation, so a stroke splits where it's crossed. Reuses annotBBox /
  // segDistPx for hit-testing. Snapshot is taken once per drag (in mousedown).
  const eraseAt = useCallback((clientX: number, clientY: number) => {
    const el = overlayRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ex = clientX - rect.left;
    const ey = clientY - rect.top;
    const r = eraserSizeRef.current;
    const page = currentPageRef.current;
    const pa = pageAspectRef.current;
    const W = rect.width;
    const H = rect.height;
    setAnnotations((prev) => {
      let changed = false;
      const out: Annotation[] = [];
      for (const a of prev) {
        if (a.page !== page) {
          out.push(a);
          continue;
        }
        if (a.type === "ink") {
          const keep = a.points.map((p) => Math.hypot(p.x * W - ex, p.y * H - ey) > r);
          if (keep.every(Boolean)) {
            out.push(a);
            continue;
          }
          changed = true;
          // Split into contiguous surviving runs; keep runs with ≥2 points.
          let run: { x: number; y: number }[] = [];
          for (let i = 0; i < a.points.length; i++) {
            if (keep[i]) run.push(a.points[i]);
            else {
              if (run.length >= 2) out.push({ ...a, id: uid(), points: run });
              run = [];
            }
          }
          if (run.length >= 2) out.push({ ...a, id: uid(), points: run });
          continue;
        }
        // Whole-annotation erase: line/poly by segment distance, everything else
        // (box/text/image/field) by its bounding box, both padded by the radius.
        let hit = false;
        if (isLine(a)) {
          hit = segDistPx(ex, ey, a.x1 * W, a.y1 * H, a.x2 * W, a.y2 * H) <= r;
        } else if (a.type === "poly") {
          for (let i = 1; i < a.points.length && !hit; i++) {
            hit = segDistPx(ex, ey, a.points[i - 1].x * W, a.points[i - 1].y * H, a.points[i].x * W, a.points[i].y * H) <= r;
          }
          if (!hit && a.closed && a.points.length > 2) {
            const n = a.points.length;
            hit = segDistPx(ex, ey, a.points[n - 1].x * W, a.points[n - 1].y * H, a.points[0].x * W, a.points[0].y * H) <= r;
          }
        } else {
          const bb = annotBBox(a, pa);
          hit = ex >= bb.x0 * W - r && ex <= bb.x1 * W + r && ey >= bb.y0 * H - r && ey <= bb.y1 * H + r;
        }
        if (hit) changed = true;
        else out.push(a);
      }
      return changed ? out : prev;
    });
  }, []);

  // ---- Polygon / polyline drafting (Wave 5a) --------------------------------
  const finishPoly = useCallback(() => {
    const d = polyDraftRef.current;
    polyDraftRef.current = null;
    setPolyDraft(null);
    setPolyCursor(null);
    if (!d) return;
    const closed = d.tool === "polygon";
    const min = closed ? 3 : 2;
    if (d.points.length < min) return;
    const ann: PolyAnnotation = {
      id: uid(),
      type: "poly",
      page: currentPageRef.current,
      points: d.points,
      closed,
      strokeColor,
      strokeWidth,
      fillColor: closed ? fillColor : null,
      opacity: 1,
      dash: shapeDash || undefined,
    };
    snapshot();
    setAnnotations((p) => [...p, ann]);
    setSelectedIds([ann.id]);
    setTool("select");
  }, [strokeColor, strokeWidth, fillColor, shapeDash, snapshot]);

  // ---- Placement (text/image) + draw start ----------------------------------
  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Fresh gesture — clear any stale click-suppression from the previous one.
    suppressCanvasClick.current = false;
    // Interacting with the canvas should take focus off any sidebar field (we
    // preventDefault below, which otherwise keeps the field focused) so keyboard
    // shortcuts like Ctrl+C/V aren't swallowed by the "editing a field" guard.
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === "INPUT" || active.tagName === "SELECT")) active.blur();
    // Eraser: one snapshot per drag, then erase at the down-point immediately so
    // a plain click also erases.
    if (tool === "eraser") {
      e.preventDefault();
      snapshot();
      eraseState.current = true;
      eraseAt(e.clientX, e.clientY);
      return;
    }
    if (SHAPE_TOOLS.includes(tool) || isFieldTool(tool)) {
      e.preventDefault();
      const { x, y } = toNorm(e.clientX, e.clientY);
      drawState.current = {
        tool,
        sx: clamp01(x),
        sy: clamp01(y),
        style: { strokeColor, strokeWidth, fillColor, dash: shapeDash },
      };
      if (tool === "draw") {
        setDraft({ id: "draft", type: "ink", page: currentPage, points: [{ x: clamp01(x), y: clamp01(y) }], strokeColor, strokeWidth });
      }
      return;
    }
    if (tool !== "select") return;
    // Topmost-first hit-test of SVG shapes on this page (array order = z-order).
    const shapes = annotations.filter((a) => a.page === currentPage && (isBox(a) || isLine(a) || a.type === "ink" || a.type === "poly"));
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (hitTestShape(shapes[i], e.clientX, e.clientY)) {
        e.preventDefault();
        suppressCanvasClick.current = true;
        startMove(e, shapes[i]);
        return;
      }
    }
    // Empty canvas → begin a marquee selection.
    const { x, y } = toNorm(e.clientX, e.clientY);
    marqueeState.current = {
      sx: clamp01(x),
      sy: clamp01(y),
      additive: e.shiftKey || e.metaKey || e.ctrlKey,
      box: { x0: clamp01(x), y0: clamp01(y), x1: clamp01(x), y1: clamp01(y) },
      moved: false,
    };
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Polygon / polyline: each click adds a vertex (finish via dbl-click/Enter/Esc).
    if (isPolyTool(tool)) {
      const { x, y } = toNorm(e.clientX, e.clientY);
      const pt = { x: clamp01(x), y: clamp01(y) };
      const cur = polyDraftRef.current;
      const points = cur && cur.tool === tool ? [...cur.points, pt] : [pt];
      const next = { tool: tool as "polygon" | "polyline", points };
      polyDraftRef.current = next;
      setPolyDraft(next);
      return;
    }
    if (tool === "text") {
      const { x, y } = toNorm(e.clientX, e.clientY);
      const ann: TextAnnotation = {
        id: uid(),
        type: "text",
        page: currentPage,
        x: clamp01(x),
        y: clamp01(y),
        width: 0.4,
        text: "",
        fontSize: DEFAULT_FONT_SIZE,
        color: textColor,
        family: "Helvetica",
        bold: false,
        italic: false,
      };
      snapshot();
      setAnnotations((p) => [...p, ann]);
      setSelectedIds([ann.id]);
      // Drop a caret straight into the new box so you can just start typing.
      setEditingId(ann.id);
      setTool("select");
      return;
    }
    if (tool === "image") {
      pendingImagePoint.current = toNorm(e.clientX, e.clientY);
      imageInputRef.current?.click();
      return;
    }
    // Wave 4b — click-to-place signing marks.
    if (tool === "signature" || tool === "initials") {
      const asset = tool === "initials" ? initialsAsset : sigAsset;
      if (!asset) return;
      const { x, y } = toNorm(e.clientX, e.clientY);
      placeSignatureAt(asset, x, y, tool === "initials" ? 0.12 : 0.28);
      return;
    }
    if (tool === "date") {
      const { x, y } = toNorm(e.clientX, e.clientY);
      // Capture the date ONCE, now — not during render.
      const ann: TextAnnotation = {
        id: uid(),
        type: "text",
        page: currentPage,
        x: clamp01(Math.min(x, 0.75)),
        y: clamp01(y),
        width: 0.25,
        text: new Date().toLocaleDateString(),
        fontSize: 14,
        color: textColor,
        family: "Helvetica",
        bold: false,
        italic: false,
      };
      snapshot();
      setAnnotations((p) => [...p, ann]);
      setSelectedIds([ann.id]);
      setTool("select");
      return;
    }
    if (STAMP_TOOLS.includes(tool)) {
      const { x, y } = toNorm(e.clientX, e.clientY);
      const marks = makeStampAnnotations(tool, clamp01(x), clamp01(y));
      snapshot();
      setAnnotations((p) => [...p, ...marks]);
      setSelectedIds(marks.map((m) => m.id));
      setTool("select");
      return;
    }
    if (tool === "select") {
      // A shape click or marquee drag already settled the selection.
      if (suppressCanvasClick.current) {
        suppressCanvasClick.current = false;
        return;
      }
      setSelectedIds([]);
    }
  };

  const handleImageChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const mime: "image/png" | "image/jpeg" = file.type === "image/jpeg" || file.type === "image/jpg" ? "image/jpeg" : "image/png";
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.width, h: img.height });
      img.src = dataUrl;
    });
    const pt = pendingImagePoint.current ?? { x: 0.3, y: 0.3 };
    const normWidth = 0.3;
    const aspect = dims.h / dims.w;
    const normHeight = (normWidth * aspect) / pageAspect;
    const ann: ImageAnnotation = {
      id: uid(),
      type: "image",
      page: currentPage,
      x: clamp01(pt.x),
      y: clamp01(pt.y),
      width: normWidth,
      height: Math.max(0.05, normHeight),
      dataUrl,
      mime,
    };
    snapshot();
    setAnnotations((p) => [...p, ann]);
    setSelectedIds([ann.id]);
    setTool("select");
    pendingImagePoint.current = null;
  };

  // ---- Signing / Fill & Sign placement (Wave 4b) ----------------------------
  // Drop a remembered signature/initials PNG as a plain image annotation
  // (aspect-correct from its natural size), reusing the existing image render +
  // pdf-lib embed/export path. `normWidth` gives signatures a sensible default
  // width; initials are placed smaller.
  const placeSignatureAt = (asset: SigResult, x: number, y: number, normWidth: number) => {
    const aspect = asset.h / asset.w;
    const normHeight = (normWidth * aspect) / pageAspectRef.current;
    const ann: ImageAnnotation = {
      id: uid(),
      type: "image",
      page: currentPageRef.current,
      x: clamp01(Math.min(x, 1 - normWidth)),
      y: clamp01(y),
      width: normWidth,
      height: Math.max(0.03, normHeight),
      dataUrl: asset.dataUrl,
      mime: asset.mime,
    };
    snapshot();
    setAnnotations((p) => [...p, ann]);
    setSelectedIds([ann.id]);
    setTool("select");
  };

  // Build the vector annotation(s) for a quick stamp centered at (cx, cy). Marks
  // are drawn as ink/line/ellipse so they bake into the PDF via the existing
  // export path — never as font glyphs. `hy` compresses vertical extent by the
  // page aspect so a mark reads square on screen.
  const makeStampAnnotations = (kind: Tool, cx: number, cy: number): Annotation[] => {
    const hx = 0.02;
    const hy = hx / pageAspectRef.current;
    const page = currentPageRef.current;
    const color = STAMP_COLOR[kind] ?? "#111827";
    if (kind === "stamp-check") {
      return [
        {
          id: uid(),
          type: "ink",
          page,
          points: [
            { x: clamp01(cx - hx), y: clamp01(cy + hy * 0.1) },
            { x: clamp01(cx - hx * 0.3), y: clamp01(cy + hy) },
            { x: clamp01(cx + hx), y: clamp01(cy - hy) },
          ],
          strokeColor: color,
          strokeWidth: 3,
        },
      ];
    }
    if (kind === "stamp-x") {
      return [
        { id: uid(), type: "line", page, x1: clamp01(cx - hx), y1: clamp01(cy - hy), x2: clamp01(cx + hx), y2: clamp01(cy + hy), strokeColor: color, strokeWidth: 3 },
        { id: uid(), type: "line", page, x1: clamp01(cx - hx), y1: clamp01(cy + hy), x2: clamp01(cx + hx), y2: clamp01(cy - hy), strokeColor: color, strokeWidth: 3 },
      ];
    }
    // stamp-dot: a small filled ellipse.
    return [
      {
        id: uid(),
        type: "ellipse",
        page,
        x: clamp01(cx - hx / 2),
        y: clamp01(cy - hy / 2),
        width: hx,
        height: hy,
        strokeColor: null,
        strokeWidth: 0,
        fillColor: color,
        opacity: 1,
      },
    ];
  };

  // Tool-button handlers. Signature/initials open the create dialog the first
  // time, then go straight to place mode (asset remembered). Date + stamps just
  // enter place mode.
  const startSignatureTool = () => {
    setSelectedIds([]);
    if (sigAsset) setTool("signature");
    else setSigDialog("signature");
  };
  const startInitialsTool = () => {
    setSelectedIds([]);
    if (initialsAsset) setTool("initials");
    else setSigDialog("initials");
  };
  const selectTool = (t: Tool) => {
    setTool(t);
    setSelectedIds([]);
  };
  // Resolve the create-signature dialog: remember the asset + enter place mode.
  const confirmSignature = (result: SigResult) => {
    if (sigDialog === "initials") {
      setInitialsAsset(result);
      setTool("initials");
    } else {
      setSigAsset(result);
      setTool("signature");
    }
    setSigDialog(null);
    setSelectedIds([]);
  };

  // ---- Move / draw / resize via global pointer listeners --------------------
  const startMove = (e: React.MouseEvent, ann: Annotation) => {
    if (tool !== "select") return;
    // Don't drag the box you're currently typing into — let the caret work.
    if (editingId === ann.id) return;
    gestureMoved.current = false;
    e.stopPropagation();
    // Shift/Cmd-click toggles the annotation in/out of the selection (no drag).
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => (prev.includes(ann.id) ? prev.filter((i) => i !== ann.id) : [...prev, ann.id]));
      return;
    }
    // Keep an existing multi-selection so a drag moves the whole group; a plain
    // click on an unselected item collapses the selection to just that item.
    const movingIds = selectedIds.includes(ann.id) && selectedIds.length > 1 ? selectedIds : [ann.id];
    setSelectedIds(movingIds);
    snapshot();
    const { x, y } = toNorm(e.clientX, e.clientY);
    // Combined start bbox of the moving set (for snapping the whole group).
    const pa = pageAspectRef.current;
    const moving = annotationsRef.current.filter((a) => movingIds.includes(a.id));
    const bbox0 = moving.reduce<NBox | null>((acc, a) => {
      const b = annotBBox(a, pa);
      return acc ? { x0: Math.min(acc.x0, b.x0), y0: Math.min(acc.y0, b.y0), x1: Math.max(acc.x1, b.x1), y1: Math.max(acc.y1, b.y1) } : b;
    }, null) ?? { x0: x, y0: y, x1: x, y1: y };
    // Snap against every other annotation on this page.
    const others = annotationsRef.current.filter((a) => a.page === currentPageRef.current && !movingIds.includes(a.id));
    dragState.current = { ids: movingIds, originX: x, originY: y, bbox0, applied: { dx: 0, dy: 0 }, targets: snapTargets(others, pa) };
  };
  const startResize = (e: React.MouseEvent, id: string, handle: ResizeHandle) => {
    e.stopPropagation();
    setSelectedIds([id]);
    snapshot();
    const a = annotationsRef.current.find((x) => x.id === id);
    const start = a && (isBox(a) || a.type === "image" || isField(a)) ? { x: a.x, y: a.y, width: a.width, height: a.height } : null;
    const others = annotationsRef.current.filter((o) => o.page === currentPageRef.current && o.id !== id);
    resizeState.current = { id, handle, start, targets: snapTargets(others, pageAspectRef.current) };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      const nx = clamp01((e.clientX - rect.left) / rect.width);
      const ny = clamp01((e.clientY - rect.top) / rect.height);

      // Eraser drag: erase whatever the cursor passes over (snapshot already
      // taken on mousedown).
      if (eraseState.current) {
        eraseAt(e.clientX, e.clientY);
        return;
      }
      // Rubber-band endpoint for an in-progress polygon/polyline.
      if (polyDraftRef.current) setPolyCursor({ x: nx, y: ny });

      // Drawing a new shape. Mirror the draft into draftRef immediately so the
      // mouseup commit reads it directly (never mutating state inside a state
      // updater — that double-commits under React StrictMode).
      const dw = drawState.current;
      if (dw) {
        if (dw.tool === "draw") {
          const prev = draftRef.current;
          const next: Annotation | null = prev && prev.type === "ink" ? { ...prev, points: [...prev.points, { x: nx, y: ny }] } : prev;
          draftRef.current = next;
          setDraft(next);
          return;
        }
        const x = Math.min(dw.sx, nx),
          y = Math.min(dw.sy, ny),
          w = Math.abs(nx - dw.sx),
          h = Math.abs(ny - dw.sy);
        if (isFieldTool(dw.tool)) {
          // Rubber-band preview box while dragging a field into place.
          const ft = FIELD_TOOL_TYPE[dw.tool];
          const draftField: FieldAnnotation = {
            id: "draft",
            type: "field",
            page: currentPage,
            x,
            y,
            width: w,
            height: h,
            fieldType: ft,
            name: "",
            value: ft === "checkbox" ? false : "",
          };
          draftRef.current = draftField;
          setDraft(draftField);
          return;
        }
        let next: Annotation;
        const dash = dw.style.dash || undefined;
        if (dw.tool === "line" || dw.tool === "arrow") {
          next = { id: "draft", type: dw.tool, page: currentPage, x1: dw.sx, y1: dw.sy, x2: nx, y2: ny, strokeColor: dw.style.strokeColor, strokeWidth: dw.style.strokeWidth, dash };
        } else if (dw.tool === "highlight") {
          next = { id: "draft", type: "highlight", page: currentPage, x, y, width: w, height: h, strokeColor: null, strokeWidth: 0, fillColor: "#ffeb3b", opacity: 0.35 };
        } else if (dw.tool === "underline" || dw.tool === "strikethrough") {
          next = { id: "draft", type: dw.tool, page: currentPage, x, y, width: w, height: h, strokeColor: dw.style.strokeColor, strokeWidth: Math.max(1.5, dw.style.strokeWidth), fillColor: null, opacity: 1 };
        } else if (dw.tool === "whiteout") {
          next = { id: "draft", type: "whiteout", page: currentPage, x, y, width: w, height: h, strokeColor: null, strokeWidth: 0, fillColor: "#ffffff", opacity: 1 };
        } else if (dw.tool === "redact") {
          next = { id: "draft", type: "redact", page: currentPage, x, y, width: w, height: h, strokeColor: null, strokeWidth: 0, fillColor: "#000000", opacity: 1 };
        } else {
          // rect / rrect. rrect carries a corner radius (pt) → rounded corners.
          next = { id: "draft", type: dw.tool === "ellipse" ? "ellipse" : "rect", page: currentPage, x, y, width: w, height: h, strokeColor: dw.style.strokeColor, strokeWidth: dw.style.strokeWidth, fillColor: dw.style.fillColor, opacity: 1, dash, rx: dw.tool === "rrect" ? DEFAULT_RX : undefined };
        }
        draftRef.current = next;
        setDraft(next);
        return;
      }

      // Resizing.
      const rs = resizeState.current;
      if (rs) {
        // Line endpoints: unchanged simple behavior.
        if (rs.handle === "p1" || rs.handle === "p2") {
          setAnnotations((prev) =>
            prev.map((a) => {
              if (a.id !== rs.id || !isLine(a)) return a;
              return rs.handle === "p1" ? { ...a, x1: nx, y1: ny } : { ...a, x2: nx, y2: ny };
            }),
          );
          return;
        }
        // Text: width-only resize via the corner handle.
        if (rs.handle === "br" && !rs.start) {
          setAnnotations((prev) => prev.map((a) => (a.id === rs.id && a.type === "text" ? { ...a, width: Math.max(0.05, nx - a.x) } : a)));
          return;
        }
        // Box/image: anchored perimeter resize with snapping + optional grid.
        if (rs.start) {
          const handle = rs.handle;
          const horiz = handle.includes("e") || handle.includes("w");
          const vert = handle.includes("n") || handle.includes("s");
          let px = nx;
          let py = ny;
          const gs: Guide[] = [];
          if (gridEnabledRef.current) {
            if (horiz) px = clamp01(snapToGrid(px, GRID_PX / rect.width));
            if (vert) py = clamp01(snapToGrid(py, GRID_PX / rect.height));
          } else if (snapEnabledRef.current && !e.shiftKey) {
            if (horiz) {
              const s = snapValue(px, rs.targets.xs, SNAP_PX / rect.width);
              if (s.snapped) {
                px = s.value;
                gs.push({ x: px });
              }
            }
            if (vert) {
              const s = snapValue(py, rs.targets.ys, SNAP_PX / rect.height);
              if (s.snapped) {
                py = s.value;
                gs.push({ y: py });
              }
            }
          }
          const box = resizeBox(rs.start, handle, px, py, e.shiftKey, MIN_SIZE);
          setAnnotations((prev) => prev.map((a) => (a.id === rs.id ? ({ ...a, x: box.x, y: box.y, width: box.width, height: box.height } as Annotation) : a)));
          setGuides(gs);
          return;
        }
        return;
      }

      // Marquee (rubber-band) selection on empty canvas.
      const mq = marqueeState.current;
      if (mq) {
        mq.moved = true;
        mq.box = { x0: Math.min(mq.sx, nx), y0: Math.min(mq.sy, ny), x1: Math.max(mq.sx, nx), y1: Math.max(mq.sy, ny) };
        setMarquee(mq.box);
        return;
      }

      // Moving (group move: apply the same delta to every selected annotation).
      // We work off the drag origin + start bbox so snapping/grid can act on the
      // absolute position, then translate by only the incremental change.
      const ds = dragState.current;
      if (ds) {
        const rawDx = nx - ds.originX;
        const rawDy = ny - ds.originY;
        const moving: NBox = { x0: ds.bbox0.x0 + rawDx, y0: ds.bbox0.y0 + rawDy, x1: ds.bbox0.x1 + rawDx, y1: ds.bbox0.y1 + rawDy };
        let finalDx = rawDx;
        let finalDy = rawDy;
        let gs: Guide[] = [];
        if (gridEnabledRef.current) {
          finalDx = snapToGrid(ds.bbox0.x0 + rawDx, GRID_PX / rect.width) - ds.bbox0.x0;
          finalDy = snapToGrid(ds.bbox0.y0 + rawDy, GRID_PX / rect.height) - ds.bbox0.y0;
        } else if (snapEnabledRef.current) {
          const snap = computeMoveSnap(moving, ds.targets, SNAP_PX / rect.width, SNAP_PX / rect.height);
          finalDx = rawDx + snap.dx;
          finalDy = rawDy + snap.dy;
          gs = snap.guides;
        }
        const incDx = finalDx - ds.applied.dx;
        const incDy = finalDy - ds.applied.dy;
        ds.applied.dx = finalDx;
        ds.applied.dy = finalDy;
        if (incDx !== 0 || incDy !== 0) {
          gestureMoved.current = true;
          setAnnotations((prev) => prev.map((a) => (ds.ids.includes(a.id) ? translate(a, incDx, incDy) : a)));
        }
        setGuides(gs);
      }
    };
    const onUp = () => {
      if (eraseState.current) {
        eraseState.current = false;
        return;
      }
      if (drawState.current) {
        const dtool = drawState.current.tool;
        const d = draftRef.current;
        if (isFieldTool(dtool)) {
          // Commit a field: use the dragged box if big enough, else a default
          // box at the mousedown point (a plain click places a default field).
          const ft = FIELD_TOOL_TYPE[dtool];
          const dragged = d && d.type === "field" && d.width > 0.02 && d.height > 0.01;
          const rect = dragged
            ? { x: d!.x, y: d!.y, width: (d as FieldAnnotation).width, height: (d as FieldAnnotation).height }
            : defaultFieldRect(ft, drawState.current.sx, drawState.current.sy, pageAspectRef.current);
          const committed = makeField(ft, rect);
          snapshot();
          setAnnotations((p) => [...p, committed]);
          setSelectedIds([committed.id]);
          setTool("select");
          suppressCanvasClick.current = true;
          draftRef.current = null;
          setDraft(null);
          drawState.current = null;
          return;
        }
        if (d) {
          const big =
            d.type === "ink"
              ? d.points.length > 2
              : isLine(d)
                ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.01
                : (d as BoxAnnotation).width > 0.01 && (d as BoxAnnotation).height > 0.01;
          if (big) {
            // Build the committed annotation exactly once (fixed id) so the
            // setAnnotations updater stays pure — no double-commit in StrictMode.
            const committed = { ...d, id: uid() } as Annotation;
            snapshot();
            setAnnotations((p) => [...p, committed]);
            setSelectedIds([committed.id]);
            setTool("select");
            // The drag emits a trailing overlay click; don't let it clear the
            // freshly-drawn (now-selected) shape.
            suppressCanvasClick.current = true;
          }
        }
        draftRef.current = null;
        setDraft(null);
        drawState.current = null;
      }
      // Resolve a marquee drag → select every annotation whose bbox intersects.
      const mq = marqueeState.current;
      if (mq) {
        const dragged = mq.moved && (mq.box.x1 - mq.box.x0 > 0.004 || mq.box.y1 - mq.box.y0 > 0.004);
        if (dragged) {
          const hits = annotationsRef.current
            .filter((a) => a.page === currentPageRef.current && boxesIntersect(annotBBox(a, pageAspectRef.current), mq.box))
            .map((a) => a.id);
          setSelectedIds((prev) => (mq.additive ? Array.from(new Set([...prev, ...hits])) : hits));
          suppressCanvasClick.current = true;
        }
        marqueeState.current = null;
        setMarquee(null);
      }
      dragState.current = null;
      resizeState.current = null;
      setGuides([]);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [currentPage, snapshot, eraseAt]);

  // ---- Selection ops: delete / clipboard / z-order --------------------------
  const deleteSelection = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (!ids.length) return;
    snapshot();
    setAnnotations((p) => p.filter((a) => !ids.includes(a.id)));
    setSelectedIds([]);
  }, [snapshot]);

  const copySelection = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (!ids.length) return;
    clipboard.current = annotationsRef.current.filter((a) => ids.includes(a.id)).map((a) => JSON.parse(JSON.stringify(a)) as Annotation);
  }, []);

  const cutSelection = useCallback(() => {
    copySelection();
    deleteSelection();
  }, [copySelection, deleteSelection]);

  const pasteClipboard = useCallback(() => {
    if (!clipboard.current.length) return;
    snapshot();
    const clones = clipboard.current.map((a) => {
      const c = translate(JSON.parse(JSON.stringify(a)) as Annotation, 0.02, 0.02);
      c.id = uid();
      c.page = currentPageRef.current;
      return c;
    });
    setAnnotations((p) => [...p, ...clones]);
    setSelectedIds(clones.map((c) => c.id));
  }, [snapshot]);

  // Z-order: annotations array order == stacking order (later = on top).
  const reorderSelection = useCallback(
    (mode: "front" | "back" | "forward" | "backward") => {
      const ids = selectedIdsRef.current;
      if (!ids.length) return;
      snapshot();
      setAnnotations((prev) => {
        if (mode === "front") {
          const sel = prev.filter((a) => ids.includes(a.id));
          const rest = prev.filter((a) => !ids.includes(a.id));
          return [...rest, ...sel];
        }
        if (mode === "back") {
          const sel = prev.filter((a) => ids.includes(a.id));
          const rest = prev.filter((a) => !ids.includes(a.id));
          return [...sel, ...rest];
        }
        const arr = [...prev];
        if (mode === "forward") {
          for (let i = arr.length - 2; i >= 0; i--) {
            if (ids.includes(arr[i].id) && !ids.includes(arr[i + 1].id)) {
              [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
            }
          }
        } else {
          for (let i = 1; i < arr.length; i++) {
            if (ids.includes(arr[i].id) && !ids.includes(arr[i - 1].id)) {
              [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
            }
          }
        }
        return arr;
      });
    },
    [snapshot],
  );

  // ---- Align & distribute (operate on the multi-selection's bounding boxes) --
  type AlignMode = "left" | "hcenter" | "right" | "top" | "vmiddle" | "bottom";
  const alignSelection = useCallback(
    (mode: AlignMode) => {
      const ids = selectedIdsRef.current;
      if (ids.length < 2) return;
      const pa = pageAspectRef.current;
      const boxes = annotationsRef.current.filter((a) => ids.includes(a.id)).map((a) => ({ id: a.id, b: annotBBox(a, pa) }));
      const minX = Math.min(...boxes.map((o) => o.b.x0));
      const maxX = Math.max(...boxes.map((o) => o.b.x1));
      const minY = Math.min(...boxes.map((o) => o.b.y0));
      const maxY = Math.max(...boxes.map((o) => o.b.y1));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const delta = new Map<string, { dx: number; dy: number }>();
      for (const { id, b } of boxes) {
        let dx = 0;
        let dy = 0;
        if (mode === "left") dx = minX - b.x0;
        else if (mode === "right") dx = maxX - b.x1;
        else if (mode === "hcenter") dx = cx - (b.x0 + b.x1) / 2;
        else if (mode === "top") dy = minY - b.y0;
        else if (mode === "bottom") dy = maxY - b.y1;
        else if (mode === "vmiddle") dy = cy - (b.y0 + b.y1) / 2;
        delta.set(id, { dx, dy });
      }
      snapshot();
      setAnnotations((prev) =>
        prev.map((a) => {
          const d = delta.get(a.id);
          return d ? translate(a, d.dx, d.dy) : a;
        }),
      );
    },
    [snapshot],
  );
  // Distribute so the selected annotations' centers are evenly spaced on the
  // chosen axis (endpoints fixed, gaps equalized). Needs ≥3 selected.
  const distributeSelection = useCallback(
    (axis: "h" | "v") => {
      const ids = selectedIdsRef.current;
      if (ids.length < 3) return;
      const pa = pageAspectRef.current;
      const boxes = annotationsRef.current.filter((a) => ids.includes(a.id)).map((a) => ({ id: a.id, b: annotBBox(a, pa) }));
      const center = (b: NBox) => (axis === "h" ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2);
      boxes.sort((p, q) => center(p.b) - center(q.b));
      const first = center(boxes[0].b);
      const last = center(boxes[boxes.length - 1].b);
      const n = boxes.length;
      const delta = new Map<string, { dx: number; dy: number }>();
      boxes.forEach((o, i) => {
        const target = first + ((last - first) * i) / (n - 1);
        const off = target - center(o.b);
        delta.set(o.id, axis === "h" ? { dx: off, dy: 0 } : { dx: 0, dy: off });
      });
      snapshot();
      setAnnotations((prev) =>
        prev.map((a) => {
          const d = delta.get(a.id);
          return d ? translate(a, d.dx, d.dy) : a;
        }),
      );
    },
    [snapshot],
  );

  // Keyboard: delete, escape, undo/redo, clipboard, z-order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      // Finish an in-progress polygon/polyline on Enter/Escape.
      if (polyDraftRef.current && (e.key === "Enter" || e.key === "Escape")) {
        e.preventDefault();
        finishPoly();
        return;
      }
      // Don't hijack shortcuts while typing in a field / editing text inline.
      const editing = editingId != null || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (editing) return;
      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        cutSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      // e.code is layout/shift-independent (Shift+] reports "}" as e.key).
      if (mod && e.code === "BracketRight") {
        e.preventDefault();
        reorderSelection(e.shiftKey ? "front" : "forward");
        return;
      }
      if (mod && e.code === "BracketLeft") {
        e.preventDefault();
        reorderSelection(e.shiftKey ? "back" : "backward");
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIdsRef.current.length) {
          e.preventDefault();
          deleteSelection();
        }
        return;
      }
      if (e.key === "Escape") setSelectedIds([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snapshot, undo, redo, copySelection, cutSelection, pasteClipboard, deleteSelection, reorderSelection, editingId, finishPoly]);

  const updateSelected = (patch: Record<string, unknown>) => {
    if (!selectedId) return;
    setAnnotations((prev) => prev.map((a) => (a.id === selectedId ? ({ ...a, ...patch } as Annotation) : a)));
  };
  // Update one annotation's text live while it's being typed on the page.
  const setText = (id: string, text: string) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? ({ ...a, text } as Annotation) : a)));
  };
  // Leave inline edit mode; discard a text box that was left empty.
  const stopEditing = (id: string) => {
    setEditingId(null);
    setAnnotations((prev) => prev.filter((a) => !(a.id === id && a.type === "text" && a.text.trim() === "")));
  };
  const duplicateSelected = () => {
    if (!selected) return;
    snapshot();
    const copy = translate(JSON.parse(JSON.stringify(selected)), 0.02, 0.02);
    copy.id = uid();
    setAnnotations((p) => [...p, copy]);
    setSelectedIds([copy.id]);
  };

  // ---- Export ---------------------------------------------------------------
  const buildFinalPdf = useCallback(async (): Promise<Uint8Array> => {
    if (!pdfBytes) throw new Error("Nothing to export");
    let doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    // ---- True redaction (Wave 5b) ------------------------------------------
    // Any page carrying a redaction mark is flattened to a raster image (its
    // original text/vector layer destroyed, regions blacked out) BEFORE we draw
    // annotations — so the surviving annotations composite on top of the raster,
    // and non-redacted pages stay untouched vector pages. `rasterizedPages`
    // records which pages were baked so the annotation loop skips their (already
    // black) redaction boxes; any page that failed to rasterize falls back to an
    // opaque pdf-lib black box below.
    const redactAnns = annotations.filter((a): a is BoxAnnotation => isBox(a) && a.type === "redact");
    const rasterizedPages = new Set<number>();
    if (redactAnns.length) {
      doc = await rasterizeRedactedPages(doc, pdfBytes, redactAnns, rasterizedPages);
    }
    const docPages = doc.getPages();

    const fontCache = new Map<string, PDFFont>();
    const getFont = async (a: TextAnnotation): Promise<PDFFont> => {
      const map: Record<string, StandardFonts> = {
        Helvetica: StandardFonts.Helvetica,
        HelveticaB: StandardFonts.HelveticaBold,
        HelveticaI: StandardFonts.HelveticaOblique,
        HelveticaBI: StandardFonts.HelveticaBoldOblique,
        Times: StandardFonts.TimesRoman,
        TimesB: StandardFonts.TimesRomanBold,
        TimesI: StandardFonts.TimesRomanItalic,
        TimesBI: StandardFonts.TimesRomanBoldItalic,
        Courier: StandardFonts.Courier,
        CourierB: StandardFonts.CourierBold,
        CourierI: StandardFonts.CourierOblique,
        CourierBI: StandardFonts.CourierBoldOblique,
      };
      const key = a.family + (a.bold ? "B" : "") + (a.italic ? "I" : "");
      if (!fontCache.has(key)) fontCache.set(key, await doc.embedFont(map[key] ?? StandardFonts.Helvetica));
      return fontCache.get(key)!;
    };

    for (const ann of annotations) {
      const page = docPages[ann.page - 1];
      if (!page) continue;
      const { width: pw, height: ph } = page.getSize();
      const PX = (nx: number) => nx * pw;
      const PY = (ny: number) => ph - ny * ph; // normalized-top → PDF y (bottom-up)

      if (ann.type === "text") {
        const { r, g, b } = hexToRgb(ann.color);
        const font = await getFont(ann);
        const color = rgb(r, g, b);
        const size = ann.fontSize;
        const maxWidth = ann.width * pw;
        const lineHeight = size * (ann.lineSpacing ?? 1.2);
        const align = ann.align ?? "left";
        // Prefix each logical line per the list mode, then word-wrap to maxWidth.
        const visual: string[] = [];
        ann.text.split("\n").forEach((ln, i) => {
          const prefixed = listPrefix(ann.list, i) + ln;
          for (const w of wrapText(prefixed, font, size, maxWidth)) visual.push(w);
        });
        let ty = PY(ann.y) - size;
        for (const line of visual) {
          const lw = font.widthOfTextAtSize(line, size);
          const lx =
            align === "right"
              ? PX(ann.x) + (maxWidth - lw)
              : align === "center"
                ? PX(ann.x) + (maxWidth - lw) / 2
                : PX(ann.x);
          page.drawText(line, { x: lx, y: ty, size, font, color });
          ty -= lineHeight;
        }
      } else if (ann.type === "image") {
        const bytes = Uint8Array.from(atob(ann.dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
        const img = ann.mime === "image/jpeg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
        page.drawImage(img, { x: PX(ann.x), y: PY(ann.y) - ann.height * ph, width: ann.width * pw, height: ann.height * ph });
      } else if (ann.type === "redact") {
        // Redaction: on a page we successfully rasterized the black region is
        // already baked into the flattened image — skip. Otherwise (rasterize
        // failed) draw an opaque black box so the region is never left exposed.
        if (rasterizedPages.has(ann.page - 1)) continue;
        page.drawRectangle({
          x: PX(ann.x),
          y: PY(ann.y) - ann.height * ph,
          width: ann.width * pw,
          height: ann.height * ph,
          color: rgb(0, 0, 0),
          opacity: 1,
        });
      } else if (isBox(ann)) {
        const dashArr = ann.dash ? DASH_PT.slice() : undefined;
        if (ann.type === "underline" || ann.type === "strikethrough") {
          const ny = ann.type === "underline" ? ann.y + ann.height : ann.y + ann.height / 2;
          const { r, g, b } = hexToRgb(ann.strokeColor ?? "#111111");
          page.drawLine({
            start: { x: PX(ann.x), y: PY(ny) },
            end: { x: PX(ann.x + ann.width), y: PY(ny) },
            thickness: Math.max(1, ann.strokeWidth),
            color: rgb(r, g, b),
            opacity: ann.opacity,
            dashArray: dashArr,
          });
        } else {
          const opts: Parameters<typeof page.drawRectangle>[0] = {
            x: PX(ann.x),
            y: PY(ann.y) - ann.height * ph,
            width: ann.width * pw,
            height: ann.height * ph,
            opacity: ann.opacity,
            borderOpacity: ann.opacity,
            borderDashArray: dashArr,
          };
          if (ann.fillColor) {
            const { r, g, b } = hexToRgb(ann.fillColor);
            opts.color = rgb(r, g, b);
          }
          if (ann.strokeColor && ann.strokeWidth > 0) {
            const { r, g, b } = hexToRgb(ann.strokeColor);
            opts.borderColor = rgb(r, g, b);
            opts.borderWidth = ann.strokeWidth;
          }
          if (ann.type === "ellipse") {
            const cx = PX(ann.x + ann.width / 2);
            const cy = PY(ann.y + ann.height / 2);
            page.drawEllipse({
              x: cx,
              y: cy,
              xScale: (ann.width * pw) / 2,
              yScale: (ann.height * ph) / 2,
              color: opts.color,
              borderColor: opts.borderColor,
              borderWidth: opts.borderWidth,
              opacity: ann.opacity,
              borderOpacity: ann.opacity,
              borderDashArray: dashArr,
            });
          } else if (ann.rx && ann.rx > 0) {
            // Rounded rect: pdf-lib's drawRectangle has no radius, so draw a
            // rounded-rect SVG path (fill + stroke). Fall back to a plain rect if
            // the path fails for any reason (never break the whole export).
            try {
              const L = ann.x * pw;
              const T = ann.y * ph;
              const R = (ann.x + ann.width) * pw;
              const B = (ann.y + ann.height) * ph;
              const rr = Math.max(0, Math.min(ann.rx, (R - L) / 2, (B - T) / 2));
              const d = `M ${L + rr} ${T} L ${R - rr} ${T} A ${rr} ${rr} 0 0 1 ${R} ${T + rr} L ${R} ${B - rr} A ${rr} ${rr} 0 0 1 ${R - rr} ${B} L ${L + rr} ${B} A ${rr} ${rr} 0 0 1 ${L} ${B - rr} L ${L} ${T + rr} A ${rr} ${rr} 0 0 1 ${L + rr} ${T} Z`;
              page.drawSvgPath(d, {
                x: 0,
                y: ph,
                color: opts.color,
                borderColor: opts.borderColor,
                borderWidth: opts.borderWidth,
                opacity: ann.opacity,
                borderOpacity: ann.opacity,
                borderDashArray: dashArr,
              });
            } catch {
              page.drawRectangle(opts);
            }
          } else {
            page.drawRectangle(opts);
          }
        }
      } else if (isLine(ann)) {
        const { r, g, b } = hexToRgb(ann.strokeColor);
        const start = { x: PX(ann.x1), y: PY(ann.y1) };
        const end = { x: PX(ann.x2), y: PY(ann.y2) };
        page.drawLine({ start, end, thickness: ann.strokeWidth, color: rgb(r, g, b), dashArray: ann.dash ? DASH_PT.slice() : undefined });
        if (ann.type === "arrow") {
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const head = Math.max(6, ann.strokeWidth * 4);
          for (const a of [angle + Math.PI - Math.PI / 7, angle + Math.PI + Math.PI / 7]) {
            page.drawLine({ start: end, end: { x: end.x + head * Math.cos(a), y: end.y + head * Math.sin(a) }, thickness: ann.strokeWidth, color: rgb(r, g, b) });
          }
        }
      } else if (ann.type === "poly") {
        const pts = ann.points;
        if (pts.length >= 2) {
          const dashArr = ann.dash ? DASH_PT.slice() : undefined;
          if (ann.closed && ann.fillColor && pts.length > 2) {
            // Filled polygon (+ optional stroke) via a closed SVG path.
            const f = hexToRgb(ann.fillColor);
            const s = ann.strokeColor && ann.strokeWidth > 0 ? hexToRgb(ann.strokeColor) : null;
            let d = `M ${PX(pts[0].x)} ${pts[0].y * ph}`;
            for (let i = 1; i < pts.length; i++) d += ` L ${PX(pts[i].x)} ${pts[i].y * ph}`;
            d += " Z";
            page.drawSvgPath(d, {
              x: 0,
              y: ph,
              color: rgb(f.r, f.g, f.b),
              borderColor: s ? rgb(s.r, s.g, s.b) : undefined,
              borderWidth: s ? ann.strokeWidth : 0,
              opacity: ann.opacity,
              borderOpacity: ann.opacity,
              borderDashArray: dashArr,
            });
          } else {
            // Stroke-only: draw each segment (plus the closing edge if closed).
            const { r, g, b } = hexToRgb(ann.strokeColor);
            const col = rgb(r, g, b);
            const seg = (p0: { x: number; y: number }, p1: { x: number; y: number }) =>
              page.drawLine({ start: { x: PX(p0.x), y: PY(p0.y) }, end: { x: PX(p1.x), y: PY(p1.y) }, thickness: ann.strokeWidth, color: col, opacity: ann.opacity, dashArray: dashArr });
            for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
            if (ann.closed && pts.length > 2) seg(pts[pts.length - 1], pts[0]);
          }
        }
      } else if (ann.type === "ink") {
        const { r, g, b } = hexToRgb(ann.strokeColor);
        for (let i = 1; i < ann.points.length; i++) {
          const p0 = ann.points[i - 1];
          const p1 = ann.points[i];
          page.drawLine({ start: { x: PX(p0.x), y: PY(p0.y) }, end: { x: PX(p1.x), y: PY(p1.y) }, thickness: ann.strokeWidth, color: rgb(r, g, b) });
        }
      }
    }

    // ---- Header / footer / page numbers / Bates (Wave 3c) -------------------
    // Draw the six resolved slots on every in-range page at its four anchors,
    // respecting the margin. Tokens resolve per-page; {date}/{time} use the
    // timestamp captured at Apply so the export matches the live preview.
    if (hf.enabled) {
      const hfFont = await doc.embedFont(StandardFonts.Helvetica);
      const { r, g, b } = hexToRgb(hf.color);
      const hfColor = rgb(r, g, b);
      const filename = docName || "document";
      for (let i = 0; i < docPages.length; i++) {
        if (!hfAppliesTo(hf, i, docPages.length)) continue;
        const page = docPages[i];
        const { width: pw, height: ph } = page.getSize();
        const topY = ph - hf.margin - hf.fontSize;
        const botY = hf.margin;
        const draw = (template: string, edge: "top" | "bottom", align: "left" | "center" | "right") => {
          const text = resolveHfText(template, hf, i, docPages.length, filename);
          if (!text) return;
          const tw = hfFont.widthOfTextAtSize(text, hf.fontSize);
          const x = align === "left" ? hf.margin : align === "right" ? pw - hf.margin - tw : (pw - tw) / 2;
          const y = edge === "top" ? topY : botY;
          page.drawText(text, { x, y, size: hf.fontSize, font: hfFont, color: hfColor });
        };
        draw(hf.headerLeft, "top", "left");
        draw(hf.headerCenter, "top", "center");
        draw(hf.headerRight, "top", "right");
        draw(hf.footerLeft, "bottom", "left");
        draw(hf.footerCenter, "bottom", "center");
        draw(hf.footerRight, "bottom", "right");
      }
    }

    // ---- AcroForm fields (Wave 4a) ------------------------------------------
    // Turn each field annotation into a REAL interactive AcroForm field via the
    // pdf-lib Form API. Normalized top-left rects convert to pdf-lib's bottom-up
    // rect: y = pageHeight - (top * pageHeight) - height. Field names are made
    // unique (radios join by shared groupName, which is intentional). With
    // `flattenForms` ON we bake the fields into static content after setting
    // values; OFF leaves them live and fillable.
    const fieldAnns = annotations.filter(isField);
    if (fieldAnns.length) {
      const form = doc.getForm();
      const formFont = await doc.embedFont(StandardFonts.Helvetica);
      const usedNames = new Set<string>();
      const uniqueName = (base: string): string => {
        const root = base || "field";
        let name = root;
        let i = 1;
        while (usedNames.has(name)) name = `${root}_${i++}`;
        usedNames.add(name);
        return name;
      };
      // Original groupName → created PDFRadioGroup, so annotations that share a
      // groupName add their options to the same group.
      const radioGroups = new Map<string, ReturnType<typeof form.createRadioGroup>>();
      for (const f of fieldAnns) {
        const page = docPages[f.page - 1];
        if (!page) continue;
        const { width: pw, height: ph } = page.getSize();
        const x = f.x * pw;
        const w = f.width * pw;
        const h = f.height * ph;
        const y = ph - f.y * ph - h; // top-left (normalized) → bottom-left (PDF)
        const size = f.fontSize ?? 12;
        try {
          if (f.fieldType === "text") {
            const tf = form.createTextField(uniqueName(f.name));
            if (typeof f.value === "string" && f.value) tf.setText(f.value);
            if (f.required) tf.enableRequired();
            tf.setFontSize(size);
            tf.addToPage(page, { x, y, width: w, height: h, font: formFont, borderWidth: 1 });
          } else if (f.fieldType === "checkbox") {
            const cb = form.createCheckBox(uniqueName(f.name));
            if (f.required) cb.enableRequired();
            cb.addToPage(page, { x, y, width: w, height: h });
            if (f.value === true) cb.check();
            else cb.uncheck();
          } else if (f.fieldType === "dropdown") {
            const dd = form.createDropdown(uniqueName(f.name));
            const opts = (f.options ?? []).filter(Boolean);
            if (opts.length) dd.addOptions(opts);
            if (f.required) dd.enableRequired();
            if (typeof f.value === "string" && f.value && opts.includes(f.value)) dd.select(f.value);
            dd.setFontSize(size);
            dd.addToPage(page, { x, y, width: w, height: h, font: formFont });
          } else if (f.fieldType === "radio") {
            const key = f.groupName || f.name || "radio";
            let rg = radioGroups.get(key);
            if (!rg) {
              rg = form.createRadioGroup(uniqueName(key));
              if (f.required) rg.enableRequired();
              radioGroups.set(key, rg);
            }
            const opts = (f.options ?? []).filter(Boolean);
            const n = Math.max(1, opts.length);
            const rowH = h / n;
            opts.forEach((opt, i) => {
              // Stack options top-to-bottom within the field box.
              const oy = y + (n - 1 - i) * rowH;
              rg!.addOptionToPage(opt, page, { x, y: oy, width: Math.min(rowH, w), height: rowH });
            });
            if (typeof f.value === "string" && f.value && opts.includes(f.value)) rg.select(f.value);
          }
        } catch {
          // Skip a single malformed field rather than failing the whole export.
        }
      }
      if (flattenForms) form.flatten();
    }
    return doc.save();
  }, [pdfBytes, annotations, hf, docName, flattenForms]);

  const handleDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      const bytes = await buildFinalPdf();
      const blob = new Blob([bytes.slice()], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${docName || "document"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  // Extract a range of pages into a downloaded PDF. Built from the CURRENT doc
  // via buildFinalPdf so flattened annotations are included.
  const handleExtract = useCallback(
    async (rangeStr: string) => {
      setBusy(true);
      setError(null);
      try {
        const finalBytes = await buildFinalPdf();
        const src = await PDFDocument.load(finalBytes, { ignoreEncryption: true });
        const indices = parsePageRange(rangeStr, src.getPageCount());
        if (!indices.length) {
          setError("No valid pages in range.");
          return;
        }
        const out = await PDFDocument.create();
        const copied = await out.copyPages(src, indices);
        copied.forEach((p) => out.addPage(p));
        const bytes = await out.save();
        const blob = new Blob([bytes.slice()], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${docName || "document"}-pages.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Extract failed");
      } finally {
        setBusy(false);
      }
    },
    [buildFinalPdf, docName],
  );

  const saveToDocuments = useMutation({
    mutationFn: async () => {
      const bytes = await buildFinalPdf();
      const response = await apiClient.post<{ document: { id: string }; uploadUrl: string }>("/documents", {
        name: docName || "Untitled",
        description: "",
        filename: `${docName || "document"}.pdf`,
      });
      if (response.uploadUrl) {
        const up = await fetch(response.uploadUrl, { method: "PUT", body: new Blob([bytes.slice()], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" } });
        if (!up.ok) throw new Error(`Upload failed: ${up.status}`);
      }
      return response;
    },
    onSuccess: (r) => {
      setSaveMsg("Saved to Documents ✓");
      setTimeout(() => navigate(`/documents/${r.document.id}`), 1200);
    },
    onError: (e: Error) => setError(e.message || "Failed to save"),
  });

  // ---- Empty state ----------------------------------------------------------
  if (!pdfBytes) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-2">PDF Editor</h1>
        <p className="text-text-muted mb-6">
          Open a PDF or start blank, then add text, shapes, drawings, highlights and images, manage pages, and download or save.
        </p>
        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>}
        <Card>
          <div className="p-6 space-y-4">
            <div
              data-testid="editor-dropzone"
              onDragEnter={(e: DragEvent) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e: DragEvent) => {
                e.preventDefault();
                setDragActive(false);
              }}
              onDragOver={(e: DragEvent) => e.preventDefault()}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                setDragActive(false);
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dragActive ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400"}`}
            >
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="mb-2">Drag and drop a PDF here, or</p>
              <label className="cursor-pointer inline-block px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors">
                Browse Files
                <input data-testid="editor-file-input" type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }} />
              </label>
            </div>
            <div className="flex items-center gap-3 text-text-muted text-sm">
              <div className="flex-1 h-px bg-gray-200" />
              or
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <Button testId="editor-new-blank" variant="outline" className="w-full flex items-center justify-center gap-2" onClick={handleNewBlank}>
              <FilePlus className="w-5 h-5" />
              New blank PDF
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ---- SVG vector shape rendering -------------------------------------------
  const renderShape = (a: Annotation, isDraft = false) => {
    const interactive = tool === "select" && !isDraft;
    // Test hook: expose id + array (z-order) index on each annotation's node.
    const dataAttrs = isDraft ? {} : { "data-annot-id": a.id, "data-annot-index": annotations.indexOf(a) };
    const common = {
      ...dataAttrs,
      onMouseDown: interactive ? (e: React.MouseEvent) => startMove(e, a) : undefined,
      style: { pointerEvents: (interactive ? "auto" : "none") as React.CSSProperties["pointerEvents"], cursor: interactive ? "move" : "default" },
    };
    const X = (nx: number) => nx * renderWidth;
    const Y = (ny: number) => ny * overlayH;
    const sw = (w: number) => Math.max(0.5, w * pxScale);
    if (isBox(a)) {
      // Test hook: normalized geometry on box nodes (used by align/snap specs).
      const boxData = isDraft ? {} : { "data-annot-x": a.x, "data-annot-y": a.y, "data-annot-w": a.width, "data-annot-h": a.height };
      const dashArray = a.dash ? `${DASH_PT[0] * pxScale} ${DASH_PT[1] * pxScale}` : undefined;
      if (a.type === "redact") {
        // Solid opaque black box + a red hatch/label so a redaction mark reads
        // differently from an ordinary filled-black rectangle. On export the
        // whole page is rasterized and this region destroyed (true removal).
        const rx = X(a.x);
        const ry = Y(a.y);
        const rw = X(a.width);
        const rh = Y(a.height);
        const kindData = isDraft ? {} : { "data-annot-kind": "redact" };
        const label = Math.min(11, Math.max(6, rh * 0.5));
        return (
          <g key={a.id} {...kindData} {...boxData} {...common}>
            <rect x={rx} y={ry} width={rw} height={rh} fill="#000000" fillOpacity={1} stroke="#dc2626" strokeWidth={1} />
            <line x1={rx} y1={ry} x2={rx + rw} y2={ry + rh} stroke="#dc2626" strokeWidth={1} strokeOpacity={0.55} />
            <line x1={rx + rw} y1={ry} x2={rx} y2={ry + rh} stroke="#dc2626" strokeWidth={1} strokeOpacity={0.55} />
            {rw > 44 && rh > 12 && (
              <text
                x={rx + rw / 2}
                y={ry + rh / 2}
                fill="#dc2626"
                fontSize={label}
                fontWeight="bold"
                letterSpacing={1}
                textAnchor="middle"
                dominantBaseline="central"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                REDACT
              </text>
            )}
          </g>
        );
      }
      if (a.type === "underline" || a.type === "strikethrough") {
        const ly = a.type === "underline" ? Y(a.y + a.height) : Y(a.y + a.height / 2);
        return (
          <line key={a.id} x1={X(a.x)} y1={ly} x2={X(a.x + a.width)} y2={ly} stroke={a.strokeColor ?? "#111"} strokeWidth={sw(Math.max(1.5, a.strokeWidth))} strokeOpacity={a.opacity} strokeDasharray={dashArray} {...boxData} {...common} />
        );
      }
      const stroke = a.strokeColor ?? "none";
      const fill = a.fillColor ?? "none";
      const shared = { fill, fillOpacity: a.opacity, stroke, strokeWidth: sw(a.strokeWidth), strokeOpacity: a.opacity, strokeDasharray: dashArray, ...boxData, ...common };
      return a.type === "ellipse" ? (
        <ellipse key={a.id} cx={X(a.x + a.width / 2)} cy={Y(a.y + a.height / 2)} rx={X(a.width / 2)} ry={Y(a.height / 2)} {...shared} />
      ) : (
        <rect key={a.id} x={X(a.x)} y={Y(a.y)} width={X(a.width)} height={Y(a.height)} rx={a.rx ? a.rx * pxScale : undefined} {...shared} />
      );
    }
    if (isLine(a)) {
      const { r, g, b } = hexToRgb(a.strokeColor);
      const col = `rgb(${r * 255},${g * 255},${b * 255})`;
      const ang = Math.atan2((a.y2 - a.y1) * overlayH, (a.x2 - a.x1) * renderWidth);
      const head = Math.max(6, sw(a.strokeWidth) * 3);
      const lineDash = a.dash ? `${DASH_PT[0] * pxScale} ${DASH_PT[1] * pxScale}` : undefined;
      return (
        <g key={a.id} {...common}>
          <line x1={X(a.x1)} y1={Y(a.y1)} x2={X(a.x2)} y2={Y(a.y2)} stroke={col} strokeWidth={sw(a.strokeWidth)} strokeLinecap="round" strokeDasharray={lineDash} />
          {a.type === "arrow" &&
            [ang + Math.PI - Math.PI / 7, ang + Math.PI + Math.PI / 7].map((t, i) => (
              <line key={i} x1={X(a.x2)} y1={Y(a.y2)} x2={X(a.x2) + head * Math.cos(t)} y2={Y(a.y2) + head * Math.sin(t)} stroke={col} strokeWidth={sw(a.strokeWidth)} strokeLinecap="round" />
            ))}
          {/* invisible fat hit line for easier selection */}
          {interactive && <line x1={X(a.x1)} y1={Y(a.y1)} x2={X(a.x2)} y2={Y(a.y2)} stroke="transparent" strokeWidth={Math.max(10, sw(a.strokeWidth) + 8)} />}
        </g>
      );
    }
    if (a.type === "ink") {
      const { r, g, b } = hexToRgb(a.strokeColor);
      const col = `rgb(${r * 255},${g * 255},${b * 255})`;
      const pts = a.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
      const inkData = isDraft ? {} : { "data-annot-kind": "ink", "data-ink-points": a.points.length };
      return <polyline key={a.id} points={pts} fill="none" stroke={col} strokeWidth={sw(a.strokeWidth)} strokeLinecap="round" strokeLinejoin="round" {...inkData} {...common} />;
    }
    if (a.type === "poly") {
      const { r, g, b } = hexToRgb(a.strokeColor);
      const col = `rgb(${r * 255},${g * 255},${b * 255})`;
      const pts = a.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
      const dashArray = a.dash ? `${DASH_PT[0] * pxScale} ${DASH_PT[1] * pxScale}` : undefined;
      const polyData = isDraft ? {} : { "data-annot-kind": "poly", "data-poly-points": a.points.length, "data-poly-closed": a.closed };
      const shared = { stroke: col, strokeWidth: sw(a.strokeWidth), strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeOpacity: a.opacity, strokeDasharray: dashArray, ...polyData, ...common };
      return a.closed ? (
        <polygon key={a.id} points={pts} fill={a.fillColor ?? "none"} fillOpacity={a.opacity} {...shared} />
      ) : (
        <polyline key={a.id} points={pts} fill="none" {...shared} />
      );
    }
    return null;
  };

  // Selection outline + handles. Draws a dashed outline on EVERY selected
  // annotation; resize handles only appear for a single selection (`selected`).
  const renderSelectionChrome = () => {
    if (tool !== "select" || !selectedIds.length) return null;
    const X = (nx: number) => nx * renderWidth;
    const Y = (ny: number) => ny * overlayH;
    const Handle = ({ cx, cy, on, cursor = "nwse-resize", testId }: { cx: number; cy: number; on: (e: React.MouseEvent) => void; cursor?: string; testId?: string }) => (
      <rect data-testid={testId} x={cx - 5} y={cy - 5} width={10} height={10} fill="#fff" stroke="#2563eb" strokeWidth={1.5} style={{ pointerEvents: "auto", cursor }} onMouseDown={on} />
    );
    // Multi-select: dashed bbox on each selected SVG shape (text/image get a DOM
    // ring already). Skip when exactly one is selected — handled below.
    const outlines =
      selectedIds.length > 1
        ? annotations
            .filter((a) => isSelected(a.id) && a.page === currentPage && (isBox(a) || isLine(a) || a.type === "ink" || a.type === "poly"))
            .map((a) => {
              const b = annotBBox(a, pageAspect);
              return (
                <rect
                  key={`sel-${a.id}`}
                  x={X(b.x0)}
                  y={Y(b.y0)}
                  width={X(b.x1 - b.x0)}
                  height={Y(b.y1 - b.y0)}
                  fill="none"
                  stroke="#2563eb"
                  strokeDasharray="4 3"
                  strokeWidth={1}
                  style={{ pointerEvents: "none" }}
                />
              );
            })
        : null;

    let single: React.ReactNode = null;
    if (selected && selected.page === currentPage) {
      if (isBox(selected) || selected.type === "image" || isField(selected)) {
        const a = selected as BoxAnnotation;
        const lx = X(a.x);
        const cx = X(a.x + a.width / 2);
        const rx = X(a.x + a.width);
        const ty = Y(a.y);
        const my = Y(a.y + a.height / 2);
        const by = Y(a.y + a.height);
        const H = (px: number, py: number, handle: ResizeHandle, cursor: string, testId: string) => (
          <Handle key={testId} cx={px} cy={py} cursor={cursor} testId={testId} on={(e) => startResize(e, a.id, handle)} />
        );
        // 8 perimeter handles: 4 corners + 4 edge midpoints.
        single = (
          <>
            <rect x={X(a.x)} y={Y(a.y)} width={X(a.width)} height={Y(a.height)} fill="none" stroke="#2563eb" strokeDasharray="4 3" strokeWidth={1} style={{ pointerEvents: "none" }} />
            {H(lx, ty, "nw", "nwse-resize", "resize-nw")}
            {H(cx, ty, "n", "ns-resize", "resize-n")}
            {H(rx, ty, "ne", "nesw-resize", "resize-ne")}
            {H(rx, my, "e", "ew-resize", "resize-e")}
            {H(rx, by, "se", "nwse-resize", "resize-se")}
            {H(cx, by, "s", "ns-resize", "resize-s")}
            {H(lx, by, "sw", "nesw-resize", "resize-sw")}
            {H(lx, my, "w", "ew-resize", "resize-w")}
          </>
        );
      } else if (isLine(selected)) {
        single = (
          <>
            <Handle cx={X(selected.x1)} cy={Y(selected.y1)} cursor="crosshair" testId="resize-p1" on={(e) => startResize(e, selected.id, "p1")} />
            <Handle cx={X(selected.x2)} cy={Y(selected.y2)} cursor="crosshair" testId="resize-p2" on={(e) => startResize(e, selected.id, "p2")} />
          </>
        );
      }
    }
    return (
      <>
        {outlines}
        {single}
      </>
    );
  };

  const cursorFor =
    tool === "text" ? "text" : tool === "image" ? "crosshair" : tool === "eraser" ? "cell" : SHAPE_TOOLS.includes(tool) || isPolyTool(tool) || isPlaceTool(tool) ? "crosshair" : "default";

  const toolButtons: { t: Tool; icon: typeof Type; label: string }[] = [
    { t: "select", icon: MousePointer2, label: "Select" },
    { t: "text", icon: Type, label: "Text" },
    { t: "draw", icon: Pencil, label: "Draw" },
    { t: "highlight", icon: Highlighter, label: "Highlight" },
    { t: "underline", icon: Underline, label: "Underline" },
    { t: "strikethrough", icon: Strikethrough, label: "Strikethrough" },
    { t: "rect", icon: Square, label: "Rectangle" },
    { t: "rrect", icon: Squircle, label: "Rounded" },
    { t: "ellipse", icon: Circle, label: "Ellipse" },
    { t: "line", icon: Minus, label: "Line" },
    { t: "arrow", icon: ArrowUpRight, label: "Arrow" },
    { t: "polygon", icon: Pentagon, label: "Polygon" },
    { t: "polyline", icon: Spline, label: "Polyline" },
    { t: "eraser", icon: Eraser, label: "Eraser" },
    { t: "whiteout", icon: PaintBucket, label: "Whiteout" },
    { t: "redact", icon: EyeOff, label: "Redact" },
    { t: "image", icon: ImageIcon, label: "Image" },
    { t: "field-text", icon: FormInput, label: "Text field" },
    { t: "field-check", icon: CheckSquare, label: "Checkbox" },
    { t: "field-radio", icon: CircleDot, label: "Radio" },
    { t: "field-dropdown", icon: ChevronDownSquare, label: "Dropdown" },
  ];
  // Playwright hooks map each Tool to a stable `tool-<name>` testid.
  const toolTestId: Record<Tool, string> = {
    select: "tool-select",
    text: "tool-text",
    draw: "tool-draw",
    highlight: "tool-highlight",
    underline: "tool-underline",
    strikethrough: "tool-strikethrough",
    rect: "tool-rect",
    rrect: "tool-rrect",
    ellipse: "tool-ellipse",
    line: "tool-line",
    arrow: "tool-arrow",
    polygon: "tool-polygon",
    polyline: "tool-polyline",
    eraser: "tool-eraser",
    whiteout: "tool-whiteout",
    redact: "tool-redact",
    image: "tool-image",
    "field-text": "tool-field-text",
    "field-check": "tool-field-check",
    "field-radio": "tool-field-radio",
    "field-dropdown": "tool-field-dropdown",
    signature: "tool-signature",
    initials: "tool-initials",
    date: "tool-date",
    "stamp-check": "stamp-check",
    "stamp-x": "stamp-x",
    "stamp-dot": "stamp-dot",
  };

  const showStylePanel = SHAPE_TOOLS.includes(tool) || isPolyTool(tool);

  // Resolve the blank dialog → a sized blank inserted after the current page.
  const confirmBlank = () => {
    let w: number;
    let h: number;
    if (blankSize === "Custom") {
      w = blankCustomW;
      h = blankCustomH;
    } else {
      [w, h] = PAGE_SIZES[blankSize];
    }
    if (blankOrient === "landscape") [w, h] = [h, w];
    w = Math.max(72, Math.round(w));
    h = Math.max(72, Math.round(h));
    setDialog(null);
    insertBlankAt(currentPageRef.current, { blankW: w, blankH: h, blankBg });
  };

  // Apply the header/footer: capture {date}/{time} ONCE (stable across renders
  // + export) and enable it. Clear turns it off (fields are kept so re-opening
  // the dialog restores them).
  const applyHeaderFooter = () => {
    const now = new Date();
    patchHf({ enabled: true, appliedDate: now.toLocaleDateString(), appliedTime: now.toLocaleTimeString() });
    setDialog(null);
  };
  const clearHeaderFooter = () => {
    patchHf({ enabled: false });
    setDialog(null);
  };

  // Live header/footer preview overlay for the CURRENT page (tokens resolved
  // per-page). Only shown when enabled and this page is in range.
  const renderHfPreview = () => {
    if (!hf.enabled || !hfAppliesTo(hf, currentPage - 1, pageCount)) return null;
    const mPx = hf.margin * pxScale;
    const fPx = hf.fontSize * pxScale;
    const slot = (key: HfSlot, testId: string, edge: "top" | "bottom", align: "left" | "center" | "right") => {
      const text = resolveHfText(hf[key] as string, hf, currentPage - 1, pageCount, docName);
      if (!text) return null;
      const style: React.CSSProperties = {
        position: "absolute",
        fontSize: fPx,
        lineHeight: 1.2,
        color: hf.color,
        fontFamily: "Helvetica, Arial, sans-serif",
        whiteSpace: "pre",
        [edge]: mPx,
      };
      if (align === "left") style.left = mPx;
      else if (align === "right") {
        style.right = mPx;
        style.textAlign = "right";
      } else {
        style.left = 0;
        style.right = 0;
        style.textAlign = "center";
      }
      return (
        <div key={testId} data-testid={testId} style={style}>
          {text}
        </div>
      );
    };
    return (
      <div data-testid="hf-preview" className="absolute inset-0" style={{ zIndex: 3, pointerEvents: "none" }}>
        {slot("headerLeft", "hf-preview-header-left", "top", "left")}
        {slot("headerCenter", "hf-preview-header-center", "top", "center")}
        {slot("headerRight", "hf-preview-header-right", "top", "right")}
        {slot("footerLeft", "hf-preview-footer-left", "bottom", "left")}
        {slot("footerCenter", "hf-preview-footer-center", "bottom", "center")}
        {slot("footerRight", "hf-preview-footer-right", "bottom", "right")}
      </div>
    );
  };

  // ---- Editor shell ---------------------------------------------------------
  return (
    <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-3rem)] gap-4 p-2">
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleImageChosen} />
      <input
        ref={importInputRef}
        data-testid="page-import-input"
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) handleImportPdf(f);
        }}
      />

      {/* Left toolbar */}
      <div className="w-full lg:w-64 flex flex-col gap-4 overflow-y-auto">
        <Card>
          <div className="p-3 border-b flex items-center justify-between">
            <h2 className="font-semibold">Tools</h2>
            <div className="flex gap-1">
              <button data-testid="editor-undo" onClick={undo} disabled={!undoStack.current.length} title="Undo (Ctrl+Z)" className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30">
                <Undo2 className="w-4 h-4" />
              </button>
              <button data-testid="editor-redo" onClick={redo} disabled={!redoStack.current.length} title="Redo (Ctrl+Shift+Z)" className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30">
                <Redo2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="p-2 grid grid-cols-3 gap-2">
            {toolButtons.map(({ t, icon: Icon, label }) => (
              <button
                key={t}
                data-testid={toolTestId[t]}
                onClick={() => {
                  setTool(t);
                  setSelectedIds([]);
                }}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border-2 transition-colors ${tool === t ? "bg-blue-50 border-blue-500 text-blue-600" : "bg-gray-50 border-transparent hover:bg-gray-100 text-gray-700"}`}
                title={label}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px]">{label}</span>
              </button>
            ))}
          </div>
          <div className="px-2 pb-2 flex gap-2">
            <button
              data-testid="toggle-snap"
              onClick={() => setSnapEnabled((v) => !v)}
              className={`flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg border-2 transition-colors ${snapEnabled ? "bg-blue-50 border-blue-500 text-blue-600" : "bg-gray-50 border-transparent text-gray-700 hover:bg-gray-100"}`}
              title="Snap to guides"
            >
              <Magnet className="w-4 h-4" /> Snap
            </button>
            <button
              data-testid="toggle-grid"
              onClick={() => setGridEnabled((v) => !v)}
              className={`flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg border-2 transition-colors ${gridEnabled ? "bg-blue-50 border-blue-500 text-blue-600" : "bg-gray-50 border-transparent text-gray-700 hover:bg-gray-100"}`}
              title="Snap to grid"
            >
              <Grid3x3 className="w-4 h-4" /> Grid
            </button>
          </div>
          {tool !== "select" && (
            <p className="px-4 pb-3 text-xs text-gray-500">
              {tool === "text"
                ? "Click the page to place text."
                : tool === "image"
                  ? "Click the page, then choose an image."
                  : tool === "draw"
                    ? "Drag on the page to draw freehand."
                    : tool === "eraser"
                      ? "Click or drag over marks to erase them."
                      : tool === "redact"
                        ? "Drag to mark an area to redact. Affected pages flatten to images on export."
                      : isPolyTool(tool)
                        ? "Click to add points; double-click, Enter or Esc to finish."
                        : isFieldTool(tool)
                          ? "Click or drag on the page to place a form field."
                          : tool === "signature" || tool === "initials"
                            ? `Click the page to place your ${tool}.`
                            : tool === "date"
                              ? "Click the page to stamp today's date."
                              : STAMP_TOOLS.includes(tool)
                                ? "Click the page to drop the mark."
                                : "Drag on the page to draw."}
            </p>
          )}
        </Card>

        {/* Sign & Fill (Wave 4b) */}
        <Card>
          <div className="p-3 border-b flex items-center justify-between">
            <h2 className="font-semibold text-sm">Sign &amp; Fill</h2>
            <button
              data-testid="toggle-fillsign"
              onClick={() => setFillSign((v) => !v)}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border-2 transition-colors ${fillSign ? "bg-blue-50 border-blue-500 text-blue-600" : "bg-gray-50 border-transparent text-gray-700 hover:bg-gray-100"}`}
              title="Fill & Sign quick mode"
            >
              <PenLine className="w-4 h-4" /> Fill &amp; Sign
            </button>
          </div>
          <div className="p-2 grid grid-cols-3 gap-2">
            <button
              data-testid="tool-signature"
              onClick={startSignatureTool}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border-2 transition-colors ${tool === "signature" ? "bg-blue-50 border-blue-500 text-blue-600" : "bg-gray-50 border-transparent hover:bg-gray-100 text-gray-700"}`}
              title="Signature"
            >
              <Signature className="w-5 h-5" />
              <span className="text-[10px]">Signature</span>
            </button>
            <button
              data-testid="tool-initials"
              onClick={startInitialsTool}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border-2 transition-colors ${tool === "initials" ? "bg-blue-50 border-blue-500 text-blue-600" : "bg-gray-50 border-transparent hover:bg-gray-100 text-gray-700"}`}
              title="Initials"
            >
              <PenTool className="w-5 h-5" />
              <span className="text-[10px]">Initials</span>
            </button>
            <button
              data-testid="tool-date"
              onClick={() => selectTool("date")}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border-2 transition-colors ${tool === "date" ? "bg-blue-50 border-blue-500 text-blue-600" : "bg-gray-50 border-transparent hover:bg-gray-100 text-gray-700"}`}
              title="Date stamp"
            >
              <CalendarDays className="w-5 h-5" />
              <span className="text-[10px]">Date</span>
            </button>
          </div>
          {(sigAsset || initialsAsset) && (
            <div className="px-2 pb-2 flex gap-2">
              {sigAsset && (
                <button data-testid="sig-new" onClick={() => setSigDialog("signature")} className="flex-1 text-xs py-1.5 rounded-lg border hover:bg-gray-50 text-gray-600">
                  New signature…
                </button>
              )}
              {initialsAsset && (
                <button data-testid="initials-new" onClick={() => setSigDialog("initials")} className="flex-1 text-xs py-1.5 rounded-lg border hover:bg-gray-50 text-gray-600">
                  New initials…
                </button>
              )}
            </div>
          )}

          {/* Quick-fill toolbar (revealed by the Fill & Sign toggle) */}
          {fillSign && (
            <div data-testid="fillsign-toolbar" className="px-2 pb-3 pt-1 border-t">
              <p className="text-[11px] text-gray-500 mt-2 mb-1">Quick fill</p>
              <div className="grid grid-cols-4 gap-2">
                <button data-testid="quick-signature" onClick={startSignatureTool} className="flex flex-col items-center gap-1 py-2 rounded-lg border hover:bg-gray-50 text-gray-700" title="Signature">
                  <Signature className="w-4 h-4" />
                  <span className="text-[9px]">Sign</span>
                </button>
                <button data-testid="quick-initials" onClick={startInitialsTool} className="flex flex-col items-center gap-1 py-2 rounded-lg border hover:bg-gray-50 text-gray-700" title="Initials">
                  <PenTool className="w-4 h-4" />
                  <span className="text-[9px]">Initials</span>
                </button>
                <button data-testid="quick-date" onClick={() => selectTool("date")} className="flex flex-col items-center gap-1 py-2 rounded-lg border hover:bg-gray-50 text-gray-700" title="Date">
                  <CalendarDays className="w-4 h-4" />
                  <span className="text-[9px]">Date</span>
                </button>
                <button data-testid="quick-text" onClick={() => selectTool("text")} className="flex flex-col items-center gap-1 py-2 rounded-lg border hover:bg-gray-50 text-gray-700" title="Add text">
                  <Type className="w-4 h-4" />
                  <span className="text-[9px]">Text</span>
                </button>
                <button data-testid="stamp-check" onClick={() => selectTool("stamp-check")} className={`flex flex-col items-center gap-1 py-2 rounded-lg border hover:bg-gray-50 ${tool === "stamp-check" ? "bg-blue-50 border-blue-500 text-blue-600" : "text-gray-700"}`} title="Checkmark">
                  <Check className="w-4 h-4" />
                  <span className="text-[9px]">Check</span>
                </button>
                <button data-testid="stamp-x" onClick={() => selectTool("stamp-x")} className={`flex flex-col items-center gap-1 py-2 rounded-lg border hover:bg-gray-50 ${tool === "stamp-x" ? "bg-blue-50 border-blue-500 text-blue-600" : "text-gray-700"}`} title="Cross">
                  <X className="w-4 h-4" />
                  <span className="text-[9px]">Cross</span>
                </button>
                <button data-testid="stamp-dot" onClick={() => selectTool("stamp-dot")} className={`flex flex-col items-center gap-1 py-2 rounded-lg border hover:bg-gray-50 ${tool === "stamp-dot" ? "bg-blue-50 border-blue-500 text-blue-600" : "text-gray-700"}`} title="Dot">
                  <Dot className="w-4 h-4" />
                  <span className="text-[9px]">Dot</span>
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Shape style defaults */}
        {showStylePanel && tool !== "whiteout" && tool !== "highlight" && (
          <Card>
            <div className="p-3 border-b">
              <h2 className="font-semibold text-sm">Shape style</h2>
            </div>
            <div className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Stroke</span>
                <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} className="h-7 w-10 border rounded" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Thickness: {strokeWidth}pt</label>
                <input type="range" min={1} max={12} value={strokeWidth} onChange={(e) => setStrokeWidth(parseInt(e.target.value))} className="w-full" />
              </div>
              {(tool === "rect" || tool === "rrect" || tool === "ellipse" || tool === "polygon") && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">Fill</span>
                  <div className="flex items-center gap-2">
                    {fillColor && <input type="color" value={fillColor} onChange={(e) => setFillColor(e.target.value)} className="h-7 w-10 border rounded" />}
                    <button className="text-xs px-2 py-1 rounded border hover:bg-gray-50" onClick={() => setFillColor(fillColor ? null : "#fde68a")}>
                      {fillColor ? "Clear" : "Add fill"}
                    </button>
                  </div>
                </div>
              )}
              {/* Wave 5a — dashed stroke default for shapes/lines/polys. */}
              <button
                data-testid="shape-dash"
                onClick={() => setShapeDash((v) => !v)}
                className={`w-full flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg border-2 transition-colors ${shapeDash ? "bg-blue-50 border-blue-500 text-blue-600" : "bg-gray-50 border-transparent text-gray-700 hover:bg-gray-100"}`}
                title="Dashed stroke"
              >
                <SquareDashed className="w-4 h-4" /> {shapeDash ? "Dashed" : "Solid"}
              </button>
            </div>
          </Card>
        )}

        {/* Eraser size (Wave 5a) */}
        {tool === "eraser" && (
          <Card>
            <div className="p-3 border-b">
              <h2 className="font-semibold text-sm">Eraser</h2>
            </div>
            <div className="p-3">
              <label className="block text-xs text-gray-600 mb-1">Size: {eraserSize}px</label>
              <input data-testid="eraser-size" type="range" min={4} max={60} value={eraserSize} onChange={(e) => setEraserSize(parseInt(e.target.value))} className="w-full" />
              <p className="text-xs text-gray-500 mt-2">Click or drag over marks to erase. Ink strokes split where crossed.</p>
            </div>
          </Card>
        )}

        {/* Arrange (z-order / clipboard) — shown whenever something is selected */}
        {selectedIds.length > 0 && (
          <Card>
            <div data-testid="arrange-panel" className="p-3 border-b flex items-center justify-between">
              <h2 className="font-semibold text-sm">Arrange</h2>
              <span className="text-xs text-gray-500">{selectedIds.length} selected</span>
            </div>
            <div className="p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button data-testid="z-front" onClick={() => reorderSelection("front")} className="flex items-center justify-center gap-1 text-xs py-1.5 rounded border hover:bg-gray-50" title="Bring to front (Ctrl+Shift+])">
                  <ChevronsUp className="w-4 h-4" /> To front
                </button>
                <button data-testid="z-back" onClick={() => reorderSelection("back")} className="flex items-center justify-center gap-1 text-xs py-1.5 rounded border hover:bg-gray-50" title="Send to back (Ctrl+Shift+[)">
                  <ChevronsDown className="w-4 h-4" /> To back
                </button>
                <button data-testid="z-forward" onClick={() => reorderSelection("forward")} className="flex items-center justify-center gap-1 text-xs py-1.5 rounded border hover:bg-gray-50" title="Bring forward (Ctrl+])">
                  <ChevronUp className="w-4 h-4" /> Forward
                </button>
                <button data-testid="z-backward" onClick={() => reorderSelection("backward")} className="flex items-center justify-center gap-1 text-xs py-1.5 rounded border hover:bg-gray-50" title="Send backward (Ctrl+[)">
                  <ChevronDown className="w-4 h-4" /> Backward
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button data-testid="clip-copy" onClick={copySelection} className="flex items-center justify-center gap-1 text-xs py-1.5 rounded border hover:bg-gray-50" title="Copy (Ctrl+C)">
                  <Copy className="w-4 h-4" /> Copy
                </button>
                <button data-testid="clip-paste" onClick={pasteClipboard} className="flex items-center justify-center gap-1 text-xs py-1.5 rounded border hover:bg-gray-50" title="Paste (Ctrl+V)">
                  <ClipboardPaste className="w-4 h-4" /> Paste
                </button>
              </div>

              {/* Align (≥2 selected) + Distribute (≥3 selected) */}
              <div className="pt-1 border-t">
                <p className="text-[11px] text-gray-500 mt-2 mb-1">Align</p>
                <div className="grid grid-cols-3 gap-1">
                  <button data-testid="align-left" onClick={() => alignSelection("left")} disabled={selectedIds.length < 2} className="flex items-center justify-center py-1.5 rounded border hover:bg-gray-50 disabled:opacity-40" title="Align left">
                    <AlignHorizontalJustifyStart className="w-4 h-4" />
                  </button>
                  <button data-testid="align-hcenter" onClick={() => alignSelection("hcenter")} disabled={selectedIds.length < 2} className="flex items-center justify-center py-1.5 rounded border hover:bg-gray-50 disabled:opacity-40" title="Align center">
                    <AlignHorizontalJustifyCenter className="w-4 h-4" />
                  </button>
                  <button data-testid="align-right" onClick={() => alignSelection("right")} disabled={selectedIds.length < 2} className="flex items-center justify-center py-1.5 rounded border hover:bg-gray-50 disabled:opacity-40" title="Align right">
                    <AlignHorizontalJustifyEnd className="w-4 h-4" />
                  </button>
                  <button data-testid="align-top" onClick={() => alignSelection("top")} disabled={selectedIds.length < 2} className="flex items-center justify-center py-1.5 rounded border hover:bg-gray-50 disabled:opacity-40" title="Align top">
                    <AlignVerticalJustifyStart className="w-4 h-4" />
                  </button>
                  <button data-testid="align-vmiddle" onClick={() => alignSelection("vmiddle")} disabled={selectedIds.length < 2} className="flex items-center justify-center py-1.5 rounded border hover:bg-gray-50 disabled:opacity-40" title="Align middle">
                    <AlignVerticalJustifyCenter className="w-4 h-4" />
                  </button>
                  <button data-testid="align-bottom" onClick={() => alignSelection("bottom")} disabled={selectedIds.length < 2} className="flex items-center justify-center py-1.5 rounded border hover:bg-gray-50 disabled:opacity-40" title="Align bottom">
                    <AlignVerticalJustifyEnd className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-2 mb-1">Distribute</p>
                <div className="grid grid-cols-2 gap-1">
                  <button data-testid="distribute-h" onClick={() => distributeSelection("h")} disabled={selectedIds.length < 3} className="flex items-center justify-center gap-1 text-xs py-1.5 rounded border hover:bg-gray-50 disabled:opacity-40" title="Distribute horizontally">
                    <AlignHorizontalDistributeCenter className="w-4 h-4" /> Horiz
                  </button>
                  <button data-testid="distribute-v" onClick={() => distributeSelection("v")} disabled={selectedIds.length < 3} className="flex items-center justify-center gap-1 text-xs py-1.5 rounded border hover:bg-gray-50 disabled:opacity-40" title="Distribute vertically">
                    <AlignVerticalDistributeCenter className="w-4 h-4" /> Vert
                  </button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Pages */}
        <Card>
          <div className="p-3 border-b">
            <h2 className="font-semibold">Pages</h2>
          </div>
          <div className="p-3 grid grid-cols-2 gap-2">
            <Button testId="page-add" size="sm" variant="outline" onClick={addBlankPage} disabled={busy}>
              <Plus className="w-4 h-4 inline mr-1" /> Add
            </Button>
            <Button testId="page-delete" size="sm" variant="outline" onClick={deletePage} disabled={busy || pageCount <= 1}>
              <Trash2 className="w-4 h-4 inline mr-1" /> Delete
            </Button>
            <Button testId="page-up" size="sm" variant="outline" onClick={() => movePage("up")} disabled={busy || currentPage <= 1}>
              <ArrowUp className="w-4 h-4 inline mr-1" /> Up
            </Button>
            <Button testId="page-down" size="sm" variant="outline" onClick={() => movePage("down")} disabled={busy || currentPage >= pageCount}>
              <ArrowDown className="w-4 h-4 inline mr-1" /> Down
            </Button>
            <Button testId="page-rotate" size="sm" variant="outline" onClick={rotatePage} disabled={busy} className="col-span-2">
              <RotateCw className="w-4 h-4 inline mr-1" /> Rotate page
            </Button>
          </div>
          <div className="px-3 pb-3 space-y-2 border-t pt-3">
            <Button testId="page-blank-dialog" size="sm" variant="outline" onClick={() => setDialog("blank")} disabled={busy} className="w-full">
              <FilePlus className="w-4 h-4 inline mr-1" /> Insert blank…
            </Button>
            <Button testId="page-import" size="sm" variant="outline" onClick={() => importInputRef.current?.click()} disabled={busy} className="w-full">
              <Upload className="w-4 h-4 inline mr-1" /> Import PDF…
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                testId="page-extract"
                size="sm"
                variant="outline"
                onClick={() => {
                  setExtractRange(String(currentPage));
                  setDialog("extract");
                }}
                disabled={busy}
              >
                <Download className="w-4 h-4 inline mr-1" /> Extract…
              </Button>
              <Button
                testId="page-delete-range"
                size="sm"
                variant="outline"
                onClick={() => {
                  setDeleteRangeStr(String(currentPage));
                  setDialog("deleteRange");
                }}
                disabled={busy || pageCount <= 1}
              >
                <Trash2 className="w-4 h-4 inline mr-1" /> Del range…
              </Button>
            </div>
            <Button testId="headerfooter-open" size="sm" variant={hf.enabled ? "primary" : "outline"} onClick={() => setDialog("headerfooter")} disabled={busy} className="w-full">
              <Type className="w-4 h-4 inline mr-1" /> Headers &amp; footers…
            </Button>
          </div>
        </Card>

        {/* Selected annotation properties */}
        {selected && (
          <Card>
            <div data-testid="props-panel" className="p-3 border-b flex items-center justify-between">
              <h2 className="font-semibold capitalize">{selected.type} properties</h2>
              <div className="flex gap-1">
                <button data-testid="props-duplicate" onClick={duplicateSelected} className="p-1 hover:bg-gray-100 rounded" title="Duplicate">
                  <Copy className="w-4 h-4 text-gray-600" />
                </button>
                <button data-testid="props-delete" onClick={deleteSelection} className="p-1 hover:bg-gray-100 rounded" title="Delete">
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            </div>
            <div className="p-3 space-y-3">
              {selected.type === "text" && (
                <>
                  <textarea className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} value={selected.text} onChange={(e) => updateSelected({ text: e.target.value })} />
                  <div className="flex items-center gap-2">
                    <select data-testid="text-font" className="text-sm border rounded px-2 py-1 flex-1" value={selected.family} onChange={(e) => updateSelected({ family: e.target.value as FontFamily })}>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Times">Times</option>
                      <option value="Courier">Courier</option>
                    </select>
                    <button data-testid="text-bold" onClick={() => updateSelected({ bold: !selected.bold })} className={`p-1.5 rounded border ${selected.bold ? "bg-blue-50 border-blue-400" : ""}`} title="Bold">
                      <Bold className="w-4 h-4" />
                    </button>
                    <button data-testid="text-italic" onClick={() => updateSelected({ italic: !selected.italic })} className={`p-1.5 rounded border ${selected.italic ? "bg-blue-50 border-blue-400" : ""}`} title="Italic">
                      <Italic className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Size: {selected.fontSize}pt</label>
                    <input data-testid="text-size" type="range" min={8} max={72} value={selected.fontSize} onChange={(e) => updateSelected({ fontSize: parseInt(e.target.value) })} className="w-full" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">Color</span>
                    <input data-testid="text-color" type="color" value={selected.color} onChange={(e) => updateSelected({ color: e.target.value })} className="h-8 w-12 border rounded" />
                  </div>
                  {/* Wave 5a — alignment / lists / line spacing */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-600 mr-1">Align</span>
                    {([
                      ["left", AlignLeft, "text-align-left"],
                      ["center", AlignCenter, "text-align-center"],
                      ["right", AlignRight, "text-align-right"],
                    ] as [TextAlign, typeof AlignLeft, string][]).map(([mode, Icon, tid]) => (
                      <button
                        key={mode}
                        data-testid={tid}
                        onClick={() => updateSelected({ align: mode })}
                        className={`p-1.5 rounded border ${(selected.align ?? "left") === mode ? "bg-blue-50 border-blue-400" : ""}`}
                        title={`Align ${mode}`}
                      >
                        <Icon className="w-4 h-4" />
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-600 mr-1">List</span>
                    <button
                      data-testid="text-list-bullet"
                      onClick={() => updateSelected({ list: (selected.list ?? "none") === "bullet" ? "none" : "bullet" })}
                      className={`p-1.5 rounded border ${selected.list === "bullet" ? "bg-blue-50 border-blue-400" : ""}`}
                      title="Bulleted list"
                    >
                      <List className="w-4 h-4" />
                    </button>
                    <button
                      data-testid="text-list-number"
                      onClick={() => updateSelected({ list: (selected.list ?? "none") === "number" ? "none" : "number" })}
                      className={`p-1.5 rounded border ${selected.list === "number" ? "bg-blue-50 border-blue-400" : ""}`}
                      title="Numbered list"
                    >
                      <ListOrdered className="w-4 h-4" />
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Baseline className="w-4 h-4 text-gray-600" />
                    <span className="text-xs text-gray-600">Line spacing</span>
                    <select
                      data-testid="text-line-spacing"
                      value={String(selected.lineSpacing ?? 1.2)}
                      onChange={(e) => updateSelected({ lineSpacing: parseFloat(e.target.value) })}
                      className="text-sm border rounded px-2 py-1 flex-1"
                    >
                      <option value="1">1.0</option>
                      <option value="1.15">1.15</option>
                      <option value="1.2">1.2</option>
                      <option value="1.5">1.5</option>
                      <option value="2">2.0</option>
                    </select>
                  </label>
                </>
              )}
              {(isBox(selected) && selected.type !== "whiteout") && (
                <>
                  {selected.type !== "highlight" && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">Stroke</span>
                      <input data-testid="shape-stroke-color" type="color" value={selected.strokeColor ?? "#000000"} onChange={(e) => updateSelected({ strokeColor: e.target.value })} className="h-7 w-10 border rounded" />
                    </div>
                  )}
                  {selected.type !== "highlight" && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Thickness: {selected.strokeWidth}pt</label>
                      <input data-testid="shape-stroke-width" type="range" min={1} max={12} value={selected.strokeWidth} onChange={(e) => updateSelected({ strokeWidth: parseInt(e.target.value) })} className="w-full" />
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{selected.type === "highlight" ? "Color" : "Fill"}</span>
                    <div className="flex items-center gap-2">
                      {selected.fillColor && <input data-testid="shape-fill-color" type="color" value={selected.fillColor} onChange={(e) => updateSelected({ fillColor: e.target.value })} className="h-7 w-10 border rounded" />}
                      {selected.type !== "highlight" && (
                        <button className="text-xs px-2 py-1 rounded border hover:bg-gray-50" onClick={() => updateSelected({ fillColor: selected.fillColor ? null : "#fde68a" })}>
                          {selected.fillColor ? "Clear" : "Add"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Opacity: {Math.round(selected.opacity * 100)}%</label>
                    <input data-testid="shape-opacity" type="range" min={10} max={100} value={Math.round(selected.opacity * 100)} onChange={(e) => updateSelected({ opacity: parseInt(e.target.value) / 100 })} className="w-full" />
                  </div>
                  {/* Wave 5a — corner radius (rect only) + dashed toggle (rect/ellipse) */}
                  {selected.type === "rect" && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Corner radius: {Math.round(selected.rx ?? 0)}pt</label>
                      <input data-testid="shape-corner-radius" type="range" min={0} max={60} value={Math.round(selected.rx ?? 0)} onChange={(e) => updateSelected({ rx: parseInt(e.target.value) || undefined })} className="w-full" />
                    </div>
                  )}
                  {(selected.type === "rect" || selected.type === "ellipse") && (
                    <button
                      data-testid="shape-dash"
                      onClick={() => updateSelected({ dash: !selected.dash || undefined })}
                      className={`w-full flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg border-2 transition-colors ${selected.dash ? "bg-blue-50 border-blue-500 text-blue-600" : "bg-gray-50 border-transparent text-gray-700 hover:bg-gray-100"}`}
                      title="Dashed stroke"
                    >
                      <SquareDashed className="w-4 h-4" /> {selected.dash ? "Dashed" : "Solid"}
                    </button>
                  )}
                </>
              )}
              {isLine(selected) && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">Stroke</span>
                    <input data-testid="shape-stroke-color" type="color" value={selected.strokeColor} onChange={(e) => updateSelected({ strokeColor: e.target.value })} className="h-7 w-10 border rounded" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Thickness: {selected.strokeWidth}pt</label>
                    <input data-testid="shape-stroke-width" type="range" min={1} max={12} value={selected.strokeWidth} onChange={(e) => updateSelected({ strokeWidth: parseInt(e.target.value) })} className="w-full" />
                  </div>
                  <button
                    data-testid="shape-dash"
                    onClick={() => updateSelected({ dash: !selected.dash || undefined })}
                    className={`w-full flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg border-2 transition-colors ${selected.dash ? "bg-blue-50 border-blue-500 text-blue-600" : "bg-gray-50 border-transparent text-gray-700 hover:bg-gray-100"}`}
                    title="Dashed stroke"
                  >
                    <SquareDashed className="w-4 h-4" /> {selected.dash ? "Dashed" : "Solid"}
                  </button>
                </>
              )}
              {isPoly(selected) && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">Stroke</span>
                    <input data-testid="shape-stroke-color" type="color" value={selected.strokeColor} onChange={(e) => updateSelected({ strokeColor: e.target.value })} className="h-7 w-10 border rounded" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Thickness: {selected.strokeWidth}pt</label>
                    <input data-testid="shape-stroke-width" type="range" min={1} max={12} value={selected.strokeWidth} onChange={(e) => updateSelected({ strokeWidth: parseInt(e.target.value) })} className="w-full" />
                  </div>
                  {selected.closed && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">Fill</span>
                      <div className="flex items-center gap-2">
                        {selected.fillColor && <input data-testid="shape-fill-color" type="color" value={selected.fillColor} onChange={(e) => updateSelected({ fillColor: e.target.value })} className="h-7 w-10 border rounded" />}
                        <button className="text-xs px-2 py-1 rounded border hover:bg-gray-50" onClick={() => updateSelected({ fillColor: selected.fillColor ? null : "#fde68a" })}>
                          {selected.fillColor ? "Clear" : "Add"}
                        </button>
                      </div>
                    </div>
                  )}
                  <button
                    data-testid="shape-dash"
                    onClick={() => updateSelected({ dash: !selected.dash || undefined })}
                    className={`w-full flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg border-2 transition-colors ${selected.dash ? "bg-blue-50 border-blue-500 text-blue-600" : "bg-gray-50 border-transparent text-gray-700 hover:bg-gray-100"}`}
                    title="Dashed stroke"
                  >
                    <SquareDashed className="w-4 h-4" /> {selected.dash ? "Dashed" : "Solid"}
                  </button>
                </>
              )}
              {isField(selected) && (
                <>
                  <label className="block">
                    <span className="text-xs text-gray-600">Field name</span>
                    <input data-testid="field-name" value={selected.name} onChange={(e) => updateSelected({ name: e.target.value })} className="w-full border rounded px-2 py-1 mt-0.5 text-sm" />
                  </label>
                  {selected.fieldType === "radio" && (
                    <label className="block">
                      <span className="text-xs text-gray-600">Group name</span>
                      <input data-testid="field-group" value={selected.groupName ?? ""} onChange={(e) => updateSelected({ groupName: e.target.value })} className="w-full border rounded px-2 py-1 mt-0.5 text-sm" />
                    </label>
                  )}
                  {(selected.fieldType === "dropdown" || selected.fieldType === "radio") && (
                    <label className="block">
                      <span className="text-xs text-gray-600">Options (comma or newline)</span>
                      <textarea
                        data-testid="field-options"
                        rows={2}
                        value={(selected.options ?? []).join(", ")}
                        onChange={(e) => updateSelected({ options: parseOptions(e.target.value) })}
                        className="w-full border rounded px-2 py-1 mt-0.5 text-sm"
                      />
                    </label>
                  )}
                  <div>
                    <span className="text-xs text-gray-600">Default value</span>
                    {selected.fieldType === "checkbox" ? (
                      <label className="flex items-center gap-2 mt-1 text-sm">
                        <input data-testid="field-value" type="checkbox" checked={selected.value === true} onChange={(e) => { snapshot(); updateSelected({ value: e.target.checked }); }} />
                        Checked by default
                      </label>
                    ) : selected.fieldType === "dropdown" || selected.fieldType === "radio" ? (
                      <select
                        data-testid="field-value"
                        value={typeof selected.value === "string" ? selected.value : ""}
                        onChange={(e) => { snapshot(); updateSelected({ value: e.target.value }); }}
                        className="w-full border rounded px-2 py-1 mt-0.5 text-sm"
                      >
                        <option value=""></option>
                        {(selected.options ?? []).map((opt, i) => (
                          <option key={i} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        data-testid="field-value"
                        value={typeof selected.value === "string" ? selected.value : ""}
                        onChange={(e) => updateSelected({ value: e.target.value })}
                        className="w-full border rounded px-2 py-1 mt-0.5 text-sm"
                      />
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input data-testid="field-required" type="checkbox" checked={selected.required === true} onChange={(e) => updateSelected({ required: e.target.checked })} />
                    Required
                  </label>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Font size: {selected.fontSize ?? 12}pt</label>
                    <input data-testid="field-fontsize" type="range" min={6} max={36} value={selected.fontSize ?? 12} onChange={(e) => updateSelected({ fontSize: parseInt(e.target.value) })} className="w-full" />
                  </div>
                </>
              )}
              {selected.type === "image" && <p className="text-xs text-gray-500">Drag the corner handle to resize, or drag the image to move it.</p>}
              {selected.type === "whiteout" && <p className="text-xs text-gray-500">Covers content with a solid white box. Drag to move, corner to resize.</p>}
            </div>
          </Card>
        )}
      </div>

      {/* Thumbnail sidebar (collapsible) */}
      {showThumbs && (
        <div data-testid="thumb-sidebar" className="w-full lg:w-40 flex-shrink-0 lg:overflow-y-auto">
          <Card className="lg:h-full">
            <div className="p-2 border-b flex items-center justify-between">
              <h2 className="font-semibold text-sm">Pages</h2>
              <span className="text-xs text-gray-500">{pageCount}</span>
            </div>
            <div className="p-2 flex lg:flex-col gap-2 flex-wrap">
              {fileUrl && (
                <Document file={fileUrl} loading={null}>
                  {pages.map((_, i) => (
                    <div
                      key={i}
                      data-testid={`thumb-${i}`}
                      draggable
                      onDragStart={() => (dragThumb.current = i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = dragThumb.current;
                        dragThumb.current = null;
                        if (from != null && from !== i) reorderPages(from, i);
                      }}
                      onClick={() => {
                        setCurrentPage(i + 1);
                        setSelectedIds([]);
                      }}
                      className={`relative cursor-pointer rounded border-2 bg-white ${currentPage === i + 1 ? "border-blue-500" : "border-gray-200 hover:border-blue-300"}`}
                      title={`Page ${i + 1}`}
                    >
                      <div className="pointer-events-none flex justify-center overflow-hidden" style={{ minHeight: 40 }}>
                        {i + 1 <= numRendered && (
                          <Page pageNumber={i + 1} width={THUMB_WIDTH} renderTextLayer={false} renderAnnotationLayer={false} loading={null} />
                        )}
                      </div>
                      <span className="absolute bottom-0 left-0 bg-black/60 text-white text-[10px] px-1 rounded-tr">{i + 1}</span>
                      <button
                        data-testid={`thumb-menu-${i}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setThumbMenu((m) => (m === i ? null : i));
                        }}
                        className="absolute top-0.5 right-0.5 bg-white/90 hover:bg-white text-gray-700 rounded p-0.5 border border-gray-200"
                        title="Page actions"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                      {thumbMenu === i && (
                        <div
                          className="absolute z-20 top-6 right-0 bg-white border rounded shadow-lg text-xs w-32 py-1"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <button data-testid="thumb-duplicate" onClick={() => { setThumbMenu(null); duplicatePageAt(i); }} className="block w-full text-left px-3 py-1.5 hover:bg-gray-100">
                            Duplicate
                          </button>
                          <button data-testid="thumb-delete" disabled={pageCount <= 1} onClick={() => { setThumbMenu(null); deletePageAt(i); }} className="block w-full text-left px-3 py-1.5 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">
                            Delete
                          </button>
                          <button data-testid="thumb-rotate" onClick={() => { setThumbMenu(null); rotatePageAt(i); }} className="block w-full text-left px-3 py-1.5 hover:bg-gray-100">
                            Rotate 90°
                          </button>
                          <button data-testid="thumb-insert-above" onClick={() => { setThumbMenu(null); insertBlankAt(i); }} className="block w-full text-left px-3 py-1.5 hover:bg-gray-100">
                            Insert blank above
                          </button>
                          <button data-testid="thumb-insert-below" onClick={() => { setThumbMenu(null); insertBlankAt(i + 1); }} className="block w-full text-left px-3 py-1.5 hover:bg-gray-100">
                            Insert blank below
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </Document>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Main canvas */}
      <div className="flex-1 min-w-0">
        <Card className="h-full flex flex-col">
          <div className="p-3 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <input data-testid="editor-docname" className="font-semibold border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none px-1 min-w-0" value={docName} onChange={(e) => setDocName(e.target.value)} title="Document name" />
            <div className="flex flex-wrap items-center gap-2">
              <button
                data-testid="thumb-toggle"
                onClick={() => setShowThumbs((v) => !v)}
                title={showThumbs ? "Hide page thumbnails" : "Show page thumbnails"}
                className={`p-1.5 rounded border ${showThumbs ? "bg-blue-50 border-blue-400 text-blue-600" : "hover:bg-gray-100 border-gray-300"}`}
              >
                <PanelLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1">
                <Button testId="editor-zoom-out" size="sm" variant="outline" onClick={() => { setZoomMode("manual"); setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2))); }} title="Zoom out">
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span data-testid="editor-zoom-level" className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
                <Button testId="editor-zoom-in" size="sm" variant="outline" onClick={() => { setZoomMode("manual"); setZoom((z) => Math.min(2, +(z + 0.25).toFixed(2))); }} title="Zoom in">
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <Button testId="zoom-fit-width" size="sm" variant={zoomMode === "fit-width" ? "primary" : "outline"} onClick={() => applyFit("fit-width")} title="Fit width">
                  <MoveHorizontal className="w-4 h-4" />
                </Button>
                <Button testId="zoom-fit-page" size="sm" variant={zoomMode === "fit-page" ? "primary" : "outline"} onClick={() => applyFit("fit-page")} title="Fit page">
                  <Maximize className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <Button testId="editor-prev-page" size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => {
                  setCurrentPage((p) => p - 1);
                  setSelectedIds([]);
                }}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span data-testid="editor-page-indicator" className="text-sm">{currentPage} / {pageCount}</span>
                <Button testId="editor-next-page" size="sm" variant="outline" disabled={currentPage >= pageCount} onClick={() => {
                  setCurrentPage((p) => p + 1);
                  setSelectedIds([]);
                }}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <input
                  data-testid="editor-page-jump"
                  type="number"
                  min={1}
                  max={pageCount}
                  placeholder="#"
                  title="Jump to page (Enter)"
                  className="w-14 text-sm border rounded px-1.5 py-1"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const el = e.target as HTMLInputElement;
                    const n = parseInt(el.value, 10);
                    if (!isNaN(n) && n >= 1 && n <= pageCount) {
                      setCurrentPage(n);
                      setSelectedIds([]);
                    }
                    el.blur();
                  }}
                />
              </div>
              <label data-testid="flatten-forms-label" className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer" title="Bake form fields into static content on export">
                <input data-testid="flatten-forms" type="checkbox" checked={flattenForms} onChange={(e) => setFlattenForms(e.target.checked)} />
                Flatten forms
              </label>
              {hasRedactions && (
                <span
                  data-testid="redact-notice"
                  className="flex items-center gap-1 text-xs text-red-600"
                  title="Pages with redaction marks are flattened to images on export; underlying text/vectors on those pages are permanently removed."
                >
                  <EyeOff className="w-3.5 h-3.5" /> Redaction flattens affected pages to images
                </span>
              )}
              <Button testId="editor-download" variant="outline" size="sm" onClick={handleDownload} disabled={busy}>
                <Download className="w-4 h-4 inline mr-1" /> Download
              </Button>
              <Button testId="editor-save" size="sm" onClick={() => saveToDocuments.mutate()} disabled={busy || saveToDocuments.isPending}>
                <Save className="w-4 h-4 inline mr-1" />
                {saveToDocuments.isPending ? "Saving…" : "Save"}
              </Button>
              <Button testId="editor-close" variant="ghost" size="sm" onClick={() => {
                setPdfBytes(null);
                setAnnotations([]);
                setPages([]);
              }} title="Close and open another">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {(error || saveMsg) && (
            <div className="px-4 pt-3">
              {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
              {saveMsg && <div className="p-2 bg-green-50 border border-green-200 rounded text-green-700 text-sm">{saveMsg}</div>}
            </div>
          )}

          <div ref={canvasScrollRef} className="flex-1 overflow-auto bg-gray-100 p-4">
            {fileUrl ? (
              <div className="flex justify-start sm:justify-center">
                <div className="relative bg-white shadow-lg" style={{ width: renderWidth }}>
                  <div className="[&_.react-pdf__Page__textContent]:pointer-events-none [&_.react-pdf__Page__annotations]:pointer-events-none">
                    <Document file={fileUrl} onLoadSuccess={({ numPages }) => setNumRendered(numPages)} loading={<div className="flex items-center justify-center h-96"><LoadingSpinner size="lg" /></div>}>
                      {currentPage <= numRendered && (
                        <Page pageNumber={currentPage} width={renderWidth} onLoadSuccess={(p) => setPageAspect(p.originalHeight / p.originalWidth)} />
                      )}
                    </Document>
                  </div>

                  {/* Optional snap-to grid overlay */}
                  {gridEnabled && (
                    <div
                      data-testid="editor-grid"
                      className="absolute inset-0"
                      style={{
                        zIndex: 4,
                        pointerEvents: "none",
                        backgroundImage:
                          "linear-gradient(to right, rgba(37,99,235,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(37,99,235,0.12) 1px, transparent 1px)",
                        backgroundSize: `${GRID_PX}px ${GRID_PX}px`,
                      }}
                    />
                  )}

                  {/* Live header/footer preview (Wave 3c) */}
                  {renderHfPreview()}

                  {/* Vector overlay (shapes/lines/ink) + selection chrome */}
                  <svg className="absolute inset-0" width={renderWidth} height={overlayH} style={{ zIndex: 5 }}>
                    {pageAnnotations.filter((a) => isBox(a) || isLine(a) || a.type === "ink" || a.type === "poly").map((a) => renderShape(a))}
                    {draft && (isBox(draft) || isLine(draft) || draft.type === "ink") && renderShape(draft, true)}
                    {/* Live polygon/polyline drafting preview (vertices + rubber-band). */}
                    {polyDraft && polyDraft.points.length > 0 && (
                      <g data-testid="poly-draft" style={{ pointerEvents: "none" }}>
                        <polyline
                          points={[...polyDraft.points, ...(polyCursor ? [polyCursor] : [])].map((p) => `${p.x * renderWidth},${p.y * overlayH}`).join(" ")}
                          fill="none"
                          stroke="#2563eb"
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                        />
                        {polyDraft.tool === "polygon" && polyDraft.points.length > 1 && (
                          <line
                            x1={(polyCursor ?? polyDraft.points[polyDraft.points.length - 1]).x * renderWidth}
                            y1={(polyCursor ?? polyDraft.points[polyDraft.points.length - 1]).y * overlayH}
                            x2={polyDraft.points[0].x * renderWidth}
                            y2={polyDraft.points[0].y * overlayH}
                            stroke="#2563eb"
                            strokeWidth={1}
                            strokeDasharray="2 3"
                          />
                        )}
                        {polyDraft.points.map((p, i) => (
                          <circle key={i} cx={p.x * renderWidth} cy={p.y * overlayH} r={3} fill="#fff" stroke="#2563eb" strokeWidth={1.5} />
                        ))}
                      </g>
                    )}
                    {draft && draft.type === "field" && (
                      <rect
                        x={draft.x * renderWidth}
                        y={draft.y * overlayH}
                        width={draft.width * renderWidth}
                        height={draft.height * overlayH}
                        fill="rgba(37,99,235,0.06)"
                        stroke="#2563eb"
                        strokeDasharray="4 3"
                        strokeWidth={1}
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                    {marquee && (
                      <rect
                        data-testid="editor-marquee"
                        x={marquee.x0 * renderWidth}
                        y={marquee.y0 * overlayH}
                        width={(marquee.x1 - marquee.x0) * renderWidth}
                        height={(marquee.y1 - marquee.y0) * overlayH}
                        fill="rgba(37,99,235,0.08)"
                        stroke="#2563eb"
                        strokeDasharray="4 3"
                        strokeWidth={1}
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                    {/* Live alignment/snap guides (magenta) */}
                    {guides.map((g, i) =>
                      g.x != null ? (
                        <line key={`g${i}`} data-testid="snap-guide" x1={g.x * renderWidth} y1={0} x2={g.x * renderWidth} y2={overlayH} stroke="#ff00ff" strokeWidth={1} style={{ pointerEvents: "none" }} />
                      ) : (
                        <line key={`g${i}`} data-testid="snap-guide" x1={0} y1={(g.y ?? 0) * overlayH} x2={renderWidth} y2={(g.y ?? 0) * overlayH} stroke="#ff00ff" strokeWidth={1} style={{ pointerEvents: "none" }} />
                      ),
                    )}
                  </svg>

                  {/* Interaction + text/image layer */}
                  <div
                    ref={overlayRef}
                    data-testid="editor-canvas"
                    className="absolute inset-0"
                    style={{ zIndex: 6, cursor: cursorFor, pointerEvents: "auto" }}
                    onMouseDown={handleOverlayMouseDown}
                    onClick={handleOverlayClick}
                    onDoubleClick={() => {
                      if (polyDraftRef.current) finishPoly();
                    }}
                  >
                    {pageAnnotations.filter((a) => a.type === "text" || a.type === "image" || a.type === "field").map((ann) => {
                      const isSel = isSelected(ann.id);
                      const isSingleSel = ann.id === selectedId;
                      const interactive = tool === "select";
                      const annIndex = annotations.indexOf(ann);
                      const selectOnClick = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        // Shift/Cmd-click toggling is resolved in startMove (onMouseDown).
                        if (e.shiftKey || e.metaKey || e.ctrlKey) return;
                        setSelectedIds([ann.id]);
                      };
                      if (ann.type === "text") {
                        const px = (ann.fontSize * renderWidth) / POINTS_WIDE;
                        const isEditing = ann.id === editingId;
                        const textStyle: React.CSSProperties = {
                          fontSize: px,
                          lineHeight: ann.lineSpacing ?? 1.2,
                          color: ann.color,
                          fontFamily: cssFamily(ann.family),
                          fontWeight: ann.bold ? 700 : 400,
                          fontStyle: ann.italic ? "italic" : "normal",
                          textAlign: ann.align ?? "left",
                        };
                        // Wave 5a — list-prefixed text for the on-screen render.
                        const displayText = ann.text
                          .split("\n")
                          .map((ln, i) => listPrefix(ann.list, i) + ln)
                          .join("\n");
                        if (isEditing) {
                          // True in-page editing: a transparent textarea sits exactly
                          // where the text renders, so you type on the document itself.
                          return (
                            <textarea
                              key={ann.id}
                              data-testid="editor-textarea"
                              autoFocus
                              value={ann.text}
                              onChange={(e) => setText(ann.id, e.target.value)}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                              onFocus={(e) => {
                                const v = e.target.value;
                                e.target.setSelectionRange(v.length, v.length);
                              }}
                              onBlur={() => stopEditing(ann.id)}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  (e.target as HTMLTextAreaElement).blur();
                                }
                              }}
                              className="absolute ring-2 ring-blue-500 bg-white/40"
                              style={{
                                ...textStyle,
                                left: `${ann.x * 100}%`,
                                top: `${ann.y * 100}%`,
                                width: `${ann.width * 100}%`,
                                margin: 0,
                                padding: 0,
                                border: "none",
                                outline: "none",
                                resize: "none",
                                overflow: "hidden",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                pointerEvents: "auto",
                                minHeight: px * 1.2,
                              }}
                              ref={(el) => {
                                if (el) {
                                  el.style.height = "auto";
                                  el.style.height = el.scrollHeight + "px";
                                }
                              }}
                            />
                          );
                        }
                        return (
                          <div
                            key={ann.id}
                            data-annot-id={ann.id}
                            data-annot-index={annIndex}
                            data-annot-kind="text"
                            data-text-align={ann.align ?? "left"}
                            data-text-list={ann.list ?? "none"}
                            data-text-linespacing={ann.lineSpacing ?? 1.2}
                            onMouseDown={(e) => startMove(e, ann)}
                            onClick={selectOnClick}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setSelectedIds([ann.id]);
                              setEditingId(ann.id);
                            }}
                            className={`absolute select-none ${isSel ? "ring-2 ring-blue-500" : "hover:ring-1 hover:ring-blue-300"} ${interactive ? "cursor-text" : ""}`}
                            title="Double-click to edit"
                            style={{
                              ...textStyle,
                              left: `${ann.x * 100}%`,
                              top: `${ann.y * 100}%`,
                              width: `${ann.width * 100}%`,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              overflow: "hidden",
                              pointerEvents: interactive ? "auto" : "none",
                            }}
                          >
                            {displayText || " "}
                            {isSingleSel && interactive && (
                              <span onMouseDown={(e) => startResize(e, ann.id, "br")} className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-white border-2 border-blue-600" style={{ cursor: "ew-resize", pointerEvents: "auto" }} />
                            )}
                          </div>
                        );
                      }
                      if (ann.type === "field") {
                        // Interactive-looking form control on the page overlay.
                        // Placing is via the field tools; filling happens here
                        // with the select tool (interactive). Move/select come
                        // from the container's startMove + onClick.
                        const fontPx = ((ann.fontSize ?? 12) * renderWidth) / POINTS_WIDE;
                        const fieldClick = (e: React.MouseEvent) => {
                          e.stopPropagation();
                          if (e.shiftKey || e.metaKey || e.ctrlKey) return; // toggle handled in startMove
                          setSelectedIds([ann.id]);
                          if (!interactive || gestureMoved.current) return;
                          if (ann.fieldType === "checkbox") {
                            snapshot();
                            setFieldValue(ann.id, { value: ann.value !== true });
                          }
                        };
                        const opts = ann.options ?? [];
                        return (
                          <div
                            key={ann.id}
                            data-testid={`field-${ann.id}`}
                            data-annot-id={ann.id}
                            data-annot-index={annIndex}
                            data-annot-x={ann.x}
                            data-annot-y={ann.y}
                            data-annot-w={ann.width}
                            data-annot-h={ann.height}
                            data-field-type={ann.fieldType}
                            onMouseDown={(e) => startMove(e, ann)}
                            onClick={fieldClick}
                            className={`absolute box-border ${isSel ? "ring-2 ring-blue-500" : "hover:ring-1 hover:ring-blue-300"} ${interactive ? "cursor-move" : ""}`}
                            style={{
                              left: `${ann.x * 100}%`,
                              top: `${ann.y * 100}%`,
                              width: `${ann.width * 100}%`,
                              height: `${ann.height * 100}%`,
                              border: ann.fieldType === "radio" ? "none" : "1px solid #6b7280",
                              background: "rgba(219,234,254,0.35)",
                              pointerEvents: interactive ? "auto" : "none",
                            }}
                          >
                            {ann.fieldType === "text" && (
                              <input
                                type="text"
                                data-testid={`field-input-${ann.id}`}
                                value={typeof ann.value === "string" ? ann.value : ""}
                                disabled={!interactive}
                                onFocus={() => {
                                  setSelectedIds([ann.id]);
                                  snapshot();
                                }}
                                onChange={(e) => setFieldValue(ann.id, { value: e.target.value })}
                                className="w-full h-full bg-transparent outline-none px-1"
                                style={{ fontSize: fontPx, pointerEvents: interactive ? "auto" : "none" }}
                              />
                            )}
                            {ann.fieldType === "checkbox" && (
                              <div className="w-full h-full flex items-center justify-center select-none" style={{ fontSize: fontPx, color: "#1d4ed8", lineHeight: 1 }}>
                                {ann.value === true ? "✓" : ""}
                              </div>
                            )}
                            {ann.fieldType === "dropdown" && (
                              <select
                                data-testid={`field-input-${ann.id}`}
                                value={typeof ann.value === "string" ? ann.value : ""}
                                disabled={!interactive}
                                onMouseDown={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  setSelectedIds([ann.id]);
                                  snapshot();
                                  setFieldValue(ann.id, { value: e.target.value });
                                }}
                                className="w-full h-full bg-transparent outline-none px-1"
                                style={{ fontSize: fontPx, pointerEvents: interactive ? "auto" : "none" }}
                              >
                                <option value=""></option>
                                {opts.map((opt, i) => (
                                  <option key={i} value={opt}>{opt}</option>
                                ))}
                              </select>
                            )}
                            {ann.fieldType === "radio" && (
                              <div className="w-full h-full flex flex-col justify-around px-0.5 select-none" style={{ fontSize: fontPx }}>
                                {(opts.length ? opts : ["Option 1"]).map((opt, i) => (
                                  <label
                                    key={i}
                                    className={`flex items-center gap-1 ${interactive ? "cursor-pointer" : ""}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedIds([ann.id]);
                                      if (!interactive || gestureMoved.current) return;
                                      snapshot();
                                      setFieldValue(ann.id, { value: opt });
                                    }}
                                  >
                                    <span
                                      className="inline-block rounded-full border border-gray-600 flex-shrink-0"
                                      style={{ width: fontPx * 0.85, height: fontPx * 0.85, background: ann.value === opt ? "#2563eb" : "transparent" }}
                                    />
                                    <span className="truncate">{opt}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={ann.id}
                          data-annot-id={ann.id}
                          data-annot-index={annIndex}
                          data-annot-x={ann.x}
                          data-annot-y={ann.y}
                          data-annot-w={ann.width}
                          data-annot-h={ann.height}
                          onMouseDown={(e) => startMove(e, ann)}
                          onClick={selectOnClick}
                          className={`absolute ${isSel ? "ring-2 ring-blue-500" : "hover:ring-1 hover:ring-blue-300"} ${interactive ? "cursor-move" : ""}`}
                          style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%`, width: `${ann.width * 100}%`, height: `${ann.height * 100}%`, pointerEvents: interactive ? "auto" : "none" }}
                        >
                          <img src={ann.dataUrl} alt="" className="w-full h-full object-fill pointer-events-none select-none" draggable={false} />
                          {/* Resize handles for images render in the top chrome SVG layer. */}
                        </div>
                      );
                    })}
                  </div>

                  {/* Top chrome layer: selection outlines + resize handles. Sits
                      above the interaction overlay so handles receive events;
                      the SVG itself is click-through (pointer-events: none). */}
                  <svg className="absolute inset-0" width={renderWidth} height={overlayH} style={{ zIndex: 7, pointerEvents: "none" }}>
                    {renderSelectionChrome()}
                  </svg>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <LoadingSpinner size="lg" />
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Create-signature dialog (Wave 4b) */}
      {sigDialog && (
        <SignatureDialog kind={sigDialog} onConfirm={confirmSignature} onCancel={() => setSigDialog(null)} />
      )}

      {/* Assemble dialogs: blank template / extract / delete-range */}
      {dialog && (
        <div
          data-testid="assemble-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={() => setDialog(null)}
        >
          <div className={`bg-white rounded-lg shadow-xl ${dialog === "headerfooter" ? "w-[30rem]" : "w-80"} max-w-[90vw] max-h-[90vh] overflow-y-auto p-4`} onMouseDown={(e) => e.stopPropagation()}>
            {dialog === "blank" && (
              <>
                <h3 className="font-semibold mb-3">Insert blank page</h3>
                <div className="space-y-3 text-sm">
                  <label className="block">
                    <span className="text-gray-600 text-xs">Size</span>
                    <select data-testid="blank-size" value={blankSize} onChange={(e) => setBlankSize(e.target.value as PageSizeName)} className="w-full border rounded px-2 py-1 mt-1">
                      <option value="Letter">Letter (8.5 × 11)</option>
                      <option value="Legal">Legal (8.5 × 14)</option>
                      <option value="A4">A4</option>
                      <option value="A3">A3</option>
                      <option value="Tabloid">Tabloid (11 × 17)</option>
                      <option value="Custom">Custom…</option>
                    </select>
                  </label>
                  {blankSize === "Custom" && (
                    <div className="flex gap-2">
                      <label className="flex-1">
                        <span className="text-gray-600 text-xs">Width (pt)</span>
                        <input data-testid="blank-width" type="number" min={72} value={blankCustomW} onChange={(e) => setBlankCustomW(parseInt(e.target.value) || 0)} className="w-full border rounded px-2 py-1 mt-1" />
                      </label>
                      <label className="flex-1">
                        <span className="text-gray-600 text-xs">Height (pt)</span>
                        <input data-testid="blank-height" type="number" min={72} value={blankCustomH} onChange={(e) => setBlankCustomH(parseInt(e.target.value) || 0)} className="w-full border rounded px-2 py-1 mt-1" />
                      </label>
                    </div>
                  )}
                  <label className="block">
                    <span className="text-gray-600 text-xs">Orientation</span>
                    <select data-testid="blank-orientation" value={blankOrient} onChange={(e) => setBlankOrient(e.target.value as "portrait" | "landscape")} className="w-full border rounded px-2 py-1 mt-1">
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-gray-600 text-xs">Background</span>
                    <select data-testid="blank-bg" value={blankBg} onChange={(e) => setBlankBg(e.target.value as PageBg)} className="w-full border rounded px-2 py-1 mt-1">
                      <option value="none">None</option>
                      <option value="lined">Lined</option>
                      <option value="dotted">Dotted</option>
                      <option value="grid">Grid</option>
                    </select>
                  </label>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <Button size="sm" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
                  <Button size="sm" testId="blank-confirm" onClick={confirmBlank}>Insert</Button>
                </div>
              </>
            )}
            {dialog === "extract" && (
              <>
                <h3 className="font-semibold mb-1">Extract pages</h3>
                <p className="text-xs text-gray-500 mb-3">Download a new PDF with the chosen pages, e.g. “1-3,5”.</p>
                <input data-testid="extract-range" value={extractRange} onChange={(e) => setExtractRange(e.target.value)} placeholder="1-3,5" className="w-full border rounded px-2 py-1 text-sm" />
                <div className="flex justify-end gap-2 mt-4">
                  <Button size="sm" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
                  <Button size="sm" testId="extract-confirm" onClick={() => { setDialog(null); handleExtract(extractRange); }}>Extract</Button>
                </div>
              </>
            )}
            {dialog === "deleteRange" && (
              <>
                <h3 className="font-semibold mb-1">Delete pages</h3>
                <p className="text-xs text-gray-500 mb-3">Remove a range of pages, e.g. “2-4”. This is undoable.</p>
                <input data-testid="delete-range" value={deleteRangeStr} onChange={(e) => setDeleteRangeStr(e.target.value)} placeholder="2-4" className="w-full border rounded px-2 py-1 text-sm" />
                <div className="flex justify-end gap-2 mt-4">
                  <Button size="sm" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
                  <Button size="sm" testId="delete-range-confirm" onClick={() => { setDialog(null); handleDeleteRange(deleteRangeStr); }}>Delete</Button>
                </div>
              </>
            )}
            {dialog === "headerfooter" && (
              <div data-testid="hf-dialog">
                <h3 className="font-semibold mb-1">Headers &amp; footers</h3>
                <p className="text-xs text-gray-500 mb-3">
                  Tokens:{" "}
                  <code className="bg-gray-100 px-1 rounded">{"{page}"}</code>{" "}
                  <code className="bg-gray-100 px-1 rounded">{"{pages}"}</code>{" "}
                  <code className="bg-gray-100 px-1 rounded">{"{date}"}</code>{" "}
                  <code className="bg-gray-100 px-1 rounded">{"{time}"}</code>{" "}
                  <code className="bg-gray-100 px-1 rounded">{"{filename}"}</code>{" "}
                  <code className="bg-gray-100 px-1 rounded">{"{bates}"}</code>
                </p>
                <div className="space-y-2 text-sm">
                  {HF_SLOTS.map(({ key, testId, label }) => (
                    <label key={testId} className="block">
                      <span className="text-gray-600 text-xs">{label}</span>
                      <input
                        data-testid={testId}
                        value={hf[key] as string}
                        onChange={(e) => patchHf({ [key]: e.target.value } as Partial<HeaderFooterConfig>)}
                        placeholder="e.g. {page} / {pages}"
                        className="w-full border rounded px-2 py-1 mt-0.5"
                      />
                    </label>
                  ))}
                </div>

                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs font-medium text-gray-700 mb-1">Bates numbering</p>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <label className="block">
                      <span className="text-gray-600 text-xs">Prefix</span>
                      <input data-testid="hf-bates-prefix" value={hf.batesPrefix} onChange={(e) => patchHf({ batesPrefix: e.target.value })} className="w-full border rounded px-2 py-1 mt-0.5" />
                    </label>
                    <label className="block">
                      <span className="text-gray-600 text-xs">Start</span>
                      <input data-testid="hf-bates-start" type="number" value={hf.batesStart} onChange={(e) => patchHf({ batesStart: parseInt(e.target.value) || 0 })} className="w-full border rounded px-2 py-1 mt-0.5" />
                    </label>
                    <label className="block">
                      <span className="text-gray-600 text-xs">Digits</span>
                      <input data-testid="hf-bates-digits" type="number" min={1} max={12} value={hf.batesDigits} onChange={(e) => patchHf({ batesDigits: parseInt(e.target.value) || 1 })} className="w-full border rounded px-2 py-1 mt-0.5" />
                    </label>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2 text-sm">
                  <label className="block">
                    <span className="text-gray-600 text-xs">Font size (pt)</span>
                    <input data-testid="hf-fontsize" type="number" min={6} max={48} value={hf.fontSize} onChange={(e) => patchHf({ fontSize: parseInt(e.target.value) || 1 })} className="w-full border rounded px-2 py-1 mt-0.5" />
                  </label>
                  <label className="block">
                    <span className="text-gray-600 text-xs">Color</span>
                    <input data-testid="hf-color" type="color" value={hf.color} onChange={(e) => patchHf({ color: e.target.value })} className="w-full h-9 border rounded px-1 py-1 mt-0.5" />
                  </label>
                  <label className="block">
                    <span className="text-gray-600 text-xs">Apply to pages</span>
                    <input data-testid="hf-range" value={hf.range} onChange={(e) => patchHf({ range: e.target.value })} placeholder="all or 1-3,5" className="w-full border rounded px-2 py-1 mt-0.5" />
                  </label>
                  <label className="block">
                    <span className="text-gray-600 text-xs">Margin (pt)</span>
                    <input data-testid="hf-margin" type="number" min={0} value={hf.margin} onChange={(e) => patchHf({ margin: parseInt(e.target.value) || 0 })} className="w-full border rounded px-2 py-1 mt-0.5" />
                  </label>
                </div>

                <div className="flex justify-between gap-2 mt-4">
                  <Button size="sm" variant="ghost" testId="hf-clear" onClick={clearHeaderFooter}>Clear</Button>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
                    <Button size="sm" testId="hf-apply" onClick={applyHeaderFooter}>Apply</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
