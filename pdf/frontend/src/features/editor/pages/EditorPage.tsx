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
} from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { PDFDocument, rgb, StandardFonts, degrees, type PDFFont } from "pdf-lib";
import { Card, LoadingSpinner } from "tibui";
import { apiClient } from "@/utils/apiClient";
// Self-host the pdf.js worker so the editor works offline / in CI (no CDN).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PAGE_RENDER_WIDTH = 700;
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
  | "whiteout";

type FontFamily = "Helvetica" | "Times" | "Courier";

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
  type: "rect" | "ellipse" | "highlight" | "underline" | "strikethrough" | "whiteout";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string | null;
  strokeWidth: number; // pt
  fillColor: string | null;
  opacity: number;
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
}
interface InkAnnotation {
  id: string;
  type: "ink";
  page: number;
  points: { x: number; y: number }[];
  strokeColor: string;
  strokeWidth: number; // pt
}
type Annotation =
  | TextAnnotation
  | ImageAnnotation
  | BoxAnnotation
  | LineAnnotation
  | InkAnnotation;

const isBox = (a: Annotation): a is BoxAnnotation =>
  a.type === "rect" || a.type === "ellipse" || a.type === "highlight" ||
  a.type === "underline" || a.type === "strikethrough" || a.type === "whiteout";
const isLine = (a: Annotation): a is LineAnnotation => a.type === "line" || a.type === "arrow";

interface PageEntry {
  srcIndex: number;
  rotation: number;
}

const DEFAULT_FONT_SIZE = 16;
const SHAPE_TOOLS: Tool[] = ["rect", "ellipse", "line", "arrow", "draw", "highlight", "underline", "strikethrough", "whiteout"];

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

// Translate an annotation by a normalized delta (for moving).
function translate(a: Annotation, dx: number, dy: number): Annotation {
  if (isLine(a)) return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
  if (a.type === "ink") return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  return { ...a, x: clamp01((a as BoxAnnotation).x + dx), y: clamp01((a as BoxAnnotation).y + dy) };
}

// Normalized bounding box {x0,y0,x1,y1} for an annotation (used by marquee +
// multi-select outlines). Text height is approximated from its font size.
type NBox = { x0: number; y0: number; x1: number; y1: number };
function annotBBox(a: Annotation, pageAspect: number): NBox {
  if (isLine(a)) {
    return { x0: Math.min(a.x1, a.x2), y0: Math.min(a.y1, a.y2), x1: Math.max(a.x1, a.x2), y1: Math.max(a.y1, a.y2) };
  }
  if (a.type === "ink") {
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

  const [numRendered, setNumRendered] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pageAspect, setPageAspect] = useState(792 / POINTS_WIDE);
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

  const overlayRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImagePoint = useRef<{ x: number; y: number } | null>(null);

  // A move drags every id in `ids` (group move); startX/startY track the pointer.
  const dragState = useRef<{ ids: string[]; startX: number; startY: number } | null>(null);
  const drawState = useRef<{
    tool: Tool;
    sx: number;
    sy: number;
    style: { strokeColor: string; strokeWidth: number; fillColor: string | null };
  } | null>(null);
  const resizeState = useRef<{ id: string; handle: "br" | "p1" | "p2" } | null>(null);
  // Marquee selection drag on empty canvas.
  const marqueeState = useRef<{ sx: number; sy: number; additive: boolean; box: NBox; moved: boolean } | null>(null);
  // A shape click/marquee-drag already resolved selection — stop the trailing
  // canvas onClick from clearing it.
  const suppressCanvasClick = useRef(false);

  // ---- Undo / redo ----------------------------------------------------------
  const undoStack = useRef<Annotation[][]>([]);
  const redoStack = useRef<Annotation[][]>([]);
  const [, setHistTick] = useState(0);
  const snapshot = useCallback(() => {
    undoStack.current.push(JSON.parse(JSON.stringify(annotationsRef.current)));
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
    setHistTick((t) => t + 1);
  }, []);
  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    redoStack.current.push(JSON.parse(JSON.stringify(annotationsRef.current)));
    setAnnotations(undoStack.current.pop()!);
    setSelectedIds([]);
    setHistTick((t) => t + 1);
  }, []);
  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current.push(JSON.parse(JSON.stringify(annotationsRef.current)));
    setAnnotations(redoStack.current.pop()!);
    setSelectedIds([]);
    setHistTick((t) => t + 1);
  }, []);

  // ---- Blob URL lifecycle ---------------------------------------------------
  useEffect(() => {
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
            const p = out.addPage([612, 792]);
            if (entry.rotation) p.setRotation(degrees(entry.rotation % 360));
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

  const addBlankPage = () => {
    const next = [...pages];
    next.splice(currentPage, 0, { srcIndex: -1, rotation: 0 });
    rebuildPdf(next).then(() => setCurrentPage(currentPage + 1));
  };
  const deletePage = () => {
    if (pageCount <= 1) return;
    const next = pages.filter((_, i) => i !== currentPage - 1);
    setAnnotations((prev) =>
      prev.filter((a) => a.page !== currentPage).map((a) => (a.page > currentPage ? { ...a, page: a.page - 1 } : a)),
    );
    rebuildPdf(next).then(() => setCurrentPage(Math.min(currentPage, next.length)));
  };
  const movePage = (dir: "up" | "down") => {
    const idx = currentPage - 1;
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= pageCount) return;
    const next = [...pages];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    const a = currentPage;
    const b = swap + 1;
    setAnnotations((prev) => prev.map((an) => (an.page === a ? { ...an, page: b } : an.page === b ? { ...an, page: a } : an)));
    rebuildPdf(next).then(() => setCurrentPage(swap + 1));
  };
  const rotatePage = () => {
    const next = pages.map((p, i) => (i === currentPage - 1 ? { ...p, rotation: (p.rotation + 90) % 360 } : p));
    rebuildPdf(next);
  };

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
    return false;
  };

  // ---- Placement (text/image) + draw start ----------------------------------
  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Fresh gesture — clear any stale click-suppression from the previous one.
    suppressCanvasClick.current = false;
    // Interacting with the canvas should take focus off any sidebar field (we
    // preventDefault below, which otherwise keeps the field focused) so keyboard
    // shortcuts like Ctrl+C/V aren't swallowed by the "editing a field" guard.
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === "INPUT" || active.tagName === "SELECT")) active.blur();
    if (SHAPE_TOOLS.includes(tool)) {
      e.preventDefault();
      const { x, y } = toNorm(e.clientX, e.clientY);
      drawState.current = {
        tool,
        sx: clamp01(x),
        sy: clamp01(y),
        style: { strokeColor, strokeWidth, fillColor },
      };
      if (tool === "draw") {
        setDraft({ id: "draft", type: "ink", page: currentPage, points: [{ x: clamp01(x), y: clamp01(y) }], strokeColor, strokeWidth });
      }
      return;
    }
    if (tool !== "select") return;
    // Topmost-first hit-test of SVG shapes on this page (array order = z-order).
    const shapes = annotations.filter((a) => a.page === currentPage && (isBox(a) || isLine(a) || a.type === "ink"));
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

  // ---- Move / draw / resize via global pointer listeners --------------------
  const startMove = (e: React.MouseEvent, ann: Annotation) => {
    if (tool !== "select") return;
    // Don't drag the box you're currently typing into — let the caret work.
    if (editingId === ann.id) return;
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
    dragState.current = { ids: movingIds, startX: x, startY: y };
  };
  const startResize = (e: React.MouseEvent, id: string, handle: "br" | "p1" | "p2") => {
    e.stopPropagation();
    setSelectedIds([id]);
    snapshot();
    resizeState.current = { id, handle };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      const nx = clamp01((e.clientX - rect.left) / rect.width);
      const ny = clamp01((e.clientY - rect.top) / rect.height);

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
        let next: Annotation;
        if (dw.tool === "line" || dw.tool === "arrow") {
          next = { id: "draft", type: dw.tool, page: currentPage, x1: dw.sx, y1: dw.sy, x2: nx, y2: ny, strokeColor: dw.style.strokeColor, strokeWidth: dw.style.strokeWidth };
        } else if (dw.tool === "highlight") {
          next = { id: "draft", type: "highlight", page: currentPage, x, y, width: w, height: h, strokeColor: null, strokeWidth: 0, fillColor: "#ffeb3b", opacity: 0.35 };
        } else if (dw.tool === "underline" || dw.tool === "strikethrough") {
          next = { id: "draft", type: dw.tool, page: currentPage, x, y, width: w, height: h, strokeColor: dw.style.strokeColor, strokeWidth: Math.max(1.5, dw.style.strokeWidth), fillColor: null, opacity: 1 };
        } else if (dw.tool === "whiteout") {
          next = { id: "draft", type: "whiteout", page: currentPage, x, y, width: w, height: h, strokeColor: null, strokeWidth: 0, fillColor: "#ffffff", opacity: 1 };
        } else {
          next = { id: "draft", type: dw.tool as "rect" | "ellipse", page: currentPage, x, y, width: w, height: h, strokeColor: dw.style.strokeColor, strokeWidth: dw.style.strokeWidth, fillColor: dw.style.fillColor, opacity: 1 };
        }
        draftRef.current = next;
        setDraft(next);
        return;
      }

      // Resizing.
      const rs = resizeState.current;
      if (rs) {
        setAnnotations((prev) =>
          prev.map((a) => {
            if (a.id !== rs.id) return a;
            if (isLine(a)) {
              return rs.handle === "p1" ? { ...a, x1: nx, y1: ny } : { ...a, x2: nx, y2: ny };
            }
            if (isBox(a) || a.type === "image") {
              return { ...a, width: Math.max(0.02, nx - (a as BoxAnnotation).x), height: Math.max(0.02, ny - (a as BoxAnnotation).y) };
            }
            if (a.type === "text") {
              return { ...a, width: Math.max(0.05, nx - a.x) };
            }
            return a;
          }),
        );
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

      // Moving (group move: apply delta to every selected annotation).
      const ds = dragState.current;
      if (ds) {
        const dx = nx - ds.startX;
        const dy = ny - ds.startY;
        ds.startX = nx;
        ds.startY = ny;
        setAnnotations((prev) => prev.map((a) => (ds.ids.includes(a.id) ? translate(a, dx, dy) : a)));
      }
    };
    const onUp = () => {
      if (drawState.current) {
        const d = draftRef.current;
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
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [currentPage, snapshot]);

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

  // Keyboard: delete, escape, undo/redo, clipboard, z-order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
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
  }, [snapshot, undo, redo, copySelection, cutSelection, pasteClipboard, deleteSelection, reorderSelection, editingId]);

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
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
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
        page.drawText(ann.text, {
          x: PX(ann.x),
          y: PY(ann.y) - ann.fontSize,
          size: ann.fontSize,
          font,
          color: rgb(r, g, b),
          maxWidth: ann.width * pw,
          lineHeight: ann.fontSize * 1.2,
        });
      } else if (ann.type === "image") {
        const bytes = Uint8Array.from(atob(ann.dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
        const img = ann.mime === "image/jpeg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
        page.drawImage(img, { x: PX(ann.x), y: PY(ann.y) - ann.height * ph, width: ann.width * pw, height: ann.height * ph });
      } else if (isBox(ann)) {
        if (ann.type === "underline" || ann.type === "strikethrough") {
          const ny = ann.type === "underline" ? ann.y + ann.height : ann.y + ann.height / 2;
          const { r, g, b } = hexToRgb(ann.strokeColor ?? "#111111");
          page.drawLine({
            start: { x: PX(ann.x), y: PY(ny) },
            end: { x: PX(ann.x + ann.width), y: PY(ny) },
            thickness: Math.max(1, ann.strokeWidth),
            color: rgb(r, g, b),
            opacity: ann.opacity,
          });
        } else {
          const opts: Parameters<typeof page.drawRectangle>[0] = {
            x: PX(ann.x),
            y: PY(ann.y) - ann.height * ph,
            width: ann.width * pw,
            height: ann.height * ph,
            opacity: ann.opacity,
            borderOpacity: ann.opacity,
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
            });
          } else {
            page.drawRectangle(opts);
          }
        }
      } else if (isLine(ann)) {
        const { r, g, b } = hexToRgb(ann.strokeColor);
        const start = { x: PX(ann.x1), y: PY(ann.y1) };
        const end = { x: PX(ann.x2), y: PY(ann.y2) };
        page.drawLine({ start, end, thickness: ann.strokeWidth, color: rgb(r, g, b) });
        if (ann.type === "arrow") {
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const head = Math.max(6, ann.strokeWidth * 4);
          for (const a of [angle + Math.PI - Math.PI / 7, angle + Math.PI + Math.PI / 7]) {
            page.drawLine({ start: end, end: { x: end.x + head * Math.cos(a), y: end.y + head * Math.sin(a) }, thickness: ann.strokeWidth, color: rgb(r, g, b) });
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
    return doc.save();
  }, [pdfBytes, annotations]);

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
      if (a.type === "underline" || a.type === "strikethrough") {
        const ly = a.type === "underline" ? Y(a.y + a.height) : Y(a.y + a.height / 2);
        return (
          <line key={a.id} x1={X(a.x)} y1={ly} x2={X(a.x + a.width)} y2={ly} stroke={a.strokeColor ?? "#111"} strokeWidth={sw(Math.max(1.5, a.strokeWidth))} strokeOpacity={a.opacity} {...common} />
        );
      }
      const stroke = a.strokeColor ?? "none";
      const fill = a.fillColor ?? "none";
      const shared = { fill, fillOpacity: a.opacity, stroke, strokeWidth: sw(a.strokeWidth), strokeOpacity: a.opacity, ...common };
      return a.type === "ellipse" ? (
        <ellipse key={a.id} cx={X(a.x + a.width / 2)} cy={Y(a.y + a.height / 2)} rx={X(a.width / 2)} ry={Y(a.height / 2)} {...shared} />
      ) : (
        <rect key={a.id} x={X(a.x)} y={Y(a.y)} width={X(a.width)} height={Y(a.height)} {...shared} />
      );
    }
    if (isLine(a)) {
      const { r, g, b } = hexToRgb(a.strokeColor);
      const col = `rgb(${r * 255},${g * 255},${b * 255})`;
      const ang = Math.atan2((a.y2 - a.y1) * overlayH, (a.x2 - a.x1) * renderWidth);
      const head = Math.max(6, sw(a.strokeWidth) * 3);
      return (
        <g key={a.id} {...common}>
          <line x1={X(a.x1)} y1={Y(a.y1)} x2={X(a.x2)} y2={Y(a.y2)} stroke={col} strokeWidth={sw(a.strokeWidth)} strokeLinecap="round" />
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
      return <polyline key={a.id} points={pts} fill="none" stroke={col} strokeWidth={sw(a.strokeWidth)} strokeLinecap="round" strokeLinejoin="round" {...common} />;
    }
    return null;
  };

  // Selection outline + handles. Draws a dashed outline on EVERY selected
  // annotation; resize handles only appear for a single selection (`selected`).
  const renderSelectionChrome = () => {
    if (tool !== "select" || !selectedIds.length) return null;
    const X = (nx: number) => nx * renderWidth;
    const Y = (ny: number) => ny * overlayH;
    const Handle = ({ cx, cy, on }: { cx: number; cy: number; on: (e: React.MouseEvent) => void }) => (
      <rect x={cx - 5} y={cy - 5} width={10} height={10} fill="#fff" stroke="#2563eb" strokeWidth={1.5} style={{ pointerEvents: "auto", cursor: "nwse-resize" }} onMouseDown={on} />
    );
    // Multi-select: dashed bbox on each selected SVG shape (text/image get a DOM
    // ring already). Skip when exactly one is selected — handled below.
    const outlines =
      selectedIds.length > 1
        ? annotations
            .filter((a) => isSelected(a.id) && a.page === currentPage && (isBox(a) || isLine(a) || a.type === "ink"))
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
      if (isBox(selected) || selected.type === "image") {
        const a = selected as BoxAnnotation;
        single = (
          <>
            <rect x={X(a.x)} y={Y(a.y)} width={X(a.width)} height={Y(a.height)} fill="none" stroke="#2563eb" strokeDasharray="4 3" strokeWidth={1} style={{ pointerEvents: "none" }} />
            <Handle cx={X(a.x + a.width)} cy={Y(a.y + a.height)} on={(e) => startResize(e, a.id, "br")} />
          </>
        );
      } else if (isLine(selected)) {
        single = (
          <>
            <Handle cx={X(selected.x1)} cy={Y(selected.y1)} on={(e) => startResize(e, selected.id, "p1")} />
            <Handle cx={X(selected.x2)} cy={Y(selected.y2)} on={(e) => startResize(e, selected.id, "p2")} />
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
    tool === "text" ? "text" : tool === "image" ? "crosshair" : SHAPE_TOOLS.includes(tool) ? "crosshair" : "default";

  const toolButtons: { t: Tool; icon: typeof Type; label: string }[] = [
    { t: "select", icon: MousePointer2, label: "Select" },
    { t: "text", icon: Type, label: "Text" },
    { t: "draw", icon: Pencil, label: "Draw" },
    { t: "highlight", icon: Highlighter, label: "Highlight" },
    { t: "underline", icon: Underline, label: "Underline" },
    { t: "strikethrough", icon: Strikethrough, label: "Strikethrough" },
    { t: "rect", icon: Square, label: "Rectangle" },
    { t: "ellipse", icon: Circle, label: "Ellipse" },
    { t: "line", icon: Minus, label: "Line" },
    { t: "arrow", icon: ArrowUpRight, label: "Arrow" },
    { t: "whiteout", icon: Eraser, label: "Whiteout" },
    { t: "image", icon: ImageIcon, label: "Image" },
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
    ellipse: "tool-ellipse",
    line: "tool-line",
    arrow: "tool-arrow",
    whiteout: "tool-whiteout",
    image: "tool-image",
  };

  const showStylePanel = SHAPE_TOOLS.includes(tool);

  // ---- Editor shell ---------------------------------------------------------
  return (
    <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-3rem)] gap-4 p-2">
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleImageChosen} />

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
          {tool !== "select" && (
            <p className="px-4 pb-3 text-xs text-gray-500">
              {tool === "text"
                ? "Click the page to place text."
                : tool === "image"
                  ? "Click the page, then choose an image."
                  : tool === "draw"
                    ? "Drag on the page to draw freehand."
                    : "Drag on the page to draw."}
            </p>
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
              {(tool === "rect" || tool === "ellipse") && (
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
                </>
              )}
              {selected.type === "image" && <p className="text-xs text-gray-500">Drag the corner handle to resize, or drag the image to move it.</p>}
              {selected.type === "whiteout" && <p className="text-xs text-gray-500">Covers content with a solid white box. Drag to move, corner to resize.</p>}
            </div>
          </Card>
        )}
      </div>

      {/* Main canvas */}
      <div className="flex-1 min-w-0">
        <Card className="h-full flex flex-col">
          <div className="p-3 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <input data-testid="editor-docname" className="font-semibold border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none px-1 min-w-0" value={docName} onChange={(e) => setDocName(e.target.value)} title="Document name" />
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <Button testId="editor-zoom-out" size="sm" variant="outline" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Zoom out">
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span data-testid="editor-zoom-level" className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
                <Button testId="editor-zoom-in" size="sm" variant="outline" onClick={() => setZoom((z) => Math.min(2, +(z + 0.25).toFixed(2)))} title="Zoom in">
                  <ZoomIn className="w-4 h-4" />
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
              </div>
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

          <div className="flex-1 overflow-auto bg-gray-100 p-4">
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

                  {/* Vector overlay (shapes/lines/ink) + selection chrome */}
                  <svg className="absolute inset-0" width={renderWidth} height={overlayH} style={{ zIndex: 5 }}>
                    {pageAnnotations.filter((a) => isBox(a) || isLine(a) || a.type === "ink").map((a) => renderShape(a))}
                    {draft && (isBox(draft) || isLine(draft) || draft.type === "ink") && renderShape(draft, true)}
                    {renderSelectionChrome()}
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
                  </svg>

                  {/* Interaction + text/image layer */}
                  <div
                    ref={overlayRef}
                    data-testid="editor-canvas"
                    className="absolute inset-0"
                    style={{ zIndex: 6, cursor: cursorFor, pointerEvents: "auto" }}
                    onMouseDown={handleOverlayMouseDown}
                    onClick={handleOverlayClick}
                  >
                    {pageAnnotations.filter((a) => a.type === "text" || a.type === "image").map((ann) => {
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
                          lineHeight: 1.2,
                          color: ann.color,
                          fontFamily: cssFamily(ann.family),
                          fontWeight: ann.bold ? 700 : 400,
                          fontStyle: ann.italic ? "italic" : "normal",
                        };
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
                            {ann.text || " "}
                            {isSingleSel && interactive && (
                              <span onMouseDown={(e) => startResize(e, ann.id, "br")} className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-white border-2 border-blue-600" style={{ cursor: "ew-resize", pointerEvents: "auto" }} />
                            )}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={ann.id}
                          data-annot-id={ann.id}
                          data-annot-index={annIndex}
                          onMouseDown={(e) => startMove(e, ann)}
                          onClick={selectOnClick}
                          className={`absolute ${isSel ? "ring-2 ring-blue-500" : "hover:ring-1 hover:ring-blue-300"} ${interactive ? "cursor-move" : ""}`}
                          style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%`, width: `${ann.width * 100}%`, height: `${ann.height * 100}%`, pointerEvents: interactive ? "auto" : "none" }}
                        >
                          <img src={ann.dataUrl} alt="" className="w-full h-full object-fill pointer-events-none select-none" draggable={false} />
                          {isSingleSel && interactive && (
                            <span onMouseDown={(e) => startResize(e, ann.id, "br")} className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-white border-2 border-blue-600" style={{ cursor: "nwse-resize", pointerEvents: "auto" }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
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
    </div>
  );
}
