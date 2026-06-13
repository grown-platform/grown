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
} from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
// @ts-ignore - CSS imports from react-pdf
import "react-pdf/dist/Page/AnnotationLayer.css";
// @ts-ignore - CSS imports from react-pdf
import "react-pdf/dist/Page/TextLayer.css";
import { PDFDocument, rgb, StandardFonts, degrees, type PDFFont } from "pdf-lib";
import { Card, LoadingSpinner } from "tibui";
import { apiClient } from "@/utils/apiClient";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

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
}: {
  children: React.ReactNode;
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);

  // Default style for newly drawn shapes.
  const [strokeColor, setStrokeColor] = useState("#e11d48");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fillColor, setFillColor] = useState<string | null>(null);
  const [textColor] = useState("#111111");

  const overlayRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImagePoint = useRef<{ x: number; y: number } | null>(null);

  const dragState = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const drawState = useRef<{
    tool: Tool;
    sx: number;
    sy: number;
    style: { strokeColor: string; strokeWidth: number; fillColor: string | null };
  } | null>(null);
  const resizeState = useRef<{ id: string; handle: "br" | "p1" | "p2" } | null>(null);

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
    setSelectedId(null);
    setHistTick((t) => t + 1);
  }, []);
  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current.push(JSON.parse(JSON.stringify(annotationsRef.current)));
    setAnnotations(redoStack.current.pop()!);
    setSelectedId(null);
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
  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  // ---- Loading --------------------------------------------------------------
  const loadFromBytes = useCallback(async (bytes: Uint8Array, name: string) => {
    setError(null);
    try {
      const doc = await PDFDocument.load(bytes);
      const count = doc.getPageCount();
      setPdfBytes(bytes);
      setDocName(name);
      setPages(Array.from({ length: count }, (_, i) => ({ srcIndex: i, rotation: 0 })));
      setAnnotations([]);
      undoStack.current = [];
      redoStack.current = [];
      setCurrentPage(1);
      setSelectedId(null);
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
    setSelectedId(null);
  }, []);

  // ---- Page structure -------------------------------------------------------
  const rebuildPdf = useCallback(
    async (nextPages: PageEntry[]) => {
      if (!pdfBytes) return;
      setBusy(true);
      try {
        const src = await PDFDocument.load(pdfBytes);
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

  // ---- Placement (text/image) + draw start ----------------------------------
  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!SHAPE_TOOLS.includes(tool)) return;
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
        text: "Text",
        fontSize: DEFAULT_FONT_SIZE,
        color: textColor,
        family: "Helvetica",
        bold: false,
        italic: false,
      };
      snapshot();
      setAnnotations((p) => [...p, ann]);
      setSelectedId(ann.id);
      setTool("select");
      return;
    }
    if (tool === "image") {
      pendingImagePoint.current = toNorm(e.clientX, e.clientY);
      imageInputRef.current?.click();
      return;
    }
    if (tool === "select") setSelectedId(null);
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
    setSelectedId(ann.id);
    setTool("select");
    pendingImagePoint.current = null;
  };

  // ---- Move / draw / resize via global pointer listeners --------------------
  const startMove = (e: React.MouseEvent, ann: Annotation) => {
    if (tool !== "select") return;
    e.stopPropagation();
    setSelectedId(ann.id);
    snapshot();
    const { x, y } = toNorm(e.clientX, e.clientY);
    dragState.current = { id: ann.id, startX: x, startY: y };
  };
  const startResize = (e: React.MouseEvent, id: string, handle: "br" | "p1" | "p2") => {
    e.stopPropagation();
    setSelectedId(id);
    snapshot();
    resizeState.current = { id, handle };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      const nx = clamp01((e.clientX - rect.left) / rect.width);
      const ny = clamp01((e.clientY - rect.top) / rect.height);

      // Drawing a new shape.
      const dw = drawState.current;
      if (dw) {
        if (dw.tool === "draw") {
          setDraft((d) => (d && d.type === "ink" ? { ...d, points: [...d.points, { x: nx, y: ny }] } : d));
          return;
        }
        const x = Math.min(dw.sx, nx),
          y = Math.min(dw.sy, ny),
          w = Math.abs(nx - dw.sx),
          h = Math.abs(ny - dw.sy);
        if (dw.tool === "line" || dw.tool === "arrow") {
          setDraft({ id: "draft", type: dw.tool, page: currentPage, x1: dw.sx, y1: dw.sy, x2: nx, y2: ny, strokeColor: dw.style.strokeColor, strokeWidth: dw.style.strokeWidth });
        } else if (dw.tool === "highlight") {
          setDraft({ id: "draft", type: "highlight", page: currentPage, x, y, width: w, height: h, strokeColor: null, strokeWidth: 0, fillColor: "#ffeb3b", opacity: 0.35 });
        } else if (dw.tool === "underline" || dw.tool === "strikethrough") {
          setDraft({ id: "draft", type: dw.tool, page: currentPage, x, y, width: w, height: h, strokeColor: dw.style.strokeColor, strokeWidth: Math.max(1.5, dw.style.strokeWidth), fillColor: null, opacity: 1 });
        } else if (dw.tool === "whiteout") {
          setDraft({ id: "draft", type: "whiteout", page: currentPage, x, y, width: w, height: h, strokeColor: null, strokeWidth: 0, fillColor: "#ffffff", opacity: 1 });
        } else {
          setDraft({ id: "draft", type: dw.tool as "rect" | "ellipse", page: currentPage, x, y, width: w, height: h, strokeColor: dw.style.strokeColor, strokeWidth: dw.style.strokeWidth, fillColor: dw.style.fillColor, opacity: 1 });
        }
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

      // Moving.
      const ds = dragState.current;
      if (ds) {
        const dx = nx - ds.startX;
        const dy = ny - ds.startY;
        ds.startX = nx;
        ds.startY = ny;
        setAnnotations((prev) => prev.map((a) => (a.id === ds.id ? translate(a, dx, dy) : a)));
      }
    };
    const onUp = () => {
      const dw = drawState.current;
      if (dw) {
        setDraft((d) => {
          if (d) {
            const big =
              d.type === "ink"
                ? d.points.length > 2
                : isLine(d)
                  ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.01
                  : (d as BoxAnnotation).width > 0.01 && (d as BoxAnnotation).height > 0.01;
            if (big) {
              const committed = { ...d, id: uid() } as Annotation;
              snapshot();
              setAnnotations((p) => [...p, committed]);
              setSelectedId(committed.id);
              setTool("select");
            }
          }
          return null;
        });
        drawState.current = null;
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

  // Keyboard: delete, escape, undo/redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const editing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (editing) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        snapshot();
        setAnnotations((p) => p.filter((a) => a.id !== selectedId));
        setSelectedId(null);
      }
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, snapshot, undo, redo]);

  const updateSelected = (patch: Record<string, unknown>) => {
    if (!selectedId) return;
    setAnnotations((prev) => prev.map((a) => (a.id === selectedId ? ({ ...a, ...patch } as Annotation) : a)));
  };
  const deleteSelected = () => {
    if (!selectedId) return;
    snapshot();
    setAnnotations((p) => p.filter((a) => a.id !== selectedId));
    setSelectedId(null);
  };
  const duplicateSelected = () => {
    if (!selected) return;
    snapshot();
    const copy = translate(JSON.parse(JSON.stringify(selected)), 0.02, 0.02);
    copy.id = uid();
    setAnnotations((p) => [...p, copy]);
    setSelectedId(copy.id);
  };

  // ---- Export ---------------------------------------------------------------
  const buildFinalPdf = useCallback(async (): Promise<Uint8Array> => {
    if (!pdfBytes) throw new Error("Nothing to export");
    const doc = await PDFDocument.load(pdfBytes);
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
                <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => {
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
            <Button variant="outline" className="w-full flex items-center justify-center gap-2" onClick={handleNewBlank}>
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
    const common = {
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

  // Selection outline + handles for the selected vector/box (SVG).
  const renderSelectionChrome = () => {
    if (!selected || selected.page !== currentPage || tool !== "select") return null;
    const X = (nx: number) => nx * renderWidth;
    const Y = (ny: number) => ny * overlayH;
    const Handle = ({ cx, cy, on }: { cx: number; cy: number; on: (e: React.MouseEvent) => void }) => (
      <rect x={cx - 5} y={cy - 5} width={10} height={10} fill="#fff" stroke="#2563eb" strokeWidth={1.5} style={{ pointerEvents: "auto", cursor: "nwse-resize" }} onMouseDown={on} />
    );
    if (isBox(selected) || selected.type === "image") {
      const a = selected as BoxAnnotation;
      return (
        <>
          <rect x={X(a.x)} y={Y(a.y)} width={X(a.width)} height={Y(a.height)} fill="none" stroke="#2563eb" strokeDasharray="4 3" strokeWidth={1} style={{ pointerEvents: "none" }} />
          <Handle cx={X(a.x + a.width)} cy={Y(a.y + a.height)} on={(e) => startResize(e, a.id, "br")} />
        </>
      );
    }
    if (isLine(selected)) {
      return (
        <>
          <Handle cx={X(selected.x1)} cy={Y(selected.y1)} on={(e) => startResize(e, selected.id, "p1")} />
          <Handle cx={X(selected.x2)} cy={Y(selected.y2)} on={(e) => startResize(e, selected.id, "p2")} />
        </>
      );
    }
    return null;
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
              <button onClick={undo} disabled={!undoStack.current.length} title="Undo (Ctrl+Z)" className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30">
                <Undo2 className="w-4 h-4" />
              </button>
              <button onClick={redo} disabled={!redoStack.current.length} title="Redo (Ctrl+Shift+Z)" className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30">
                <Redo2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="p-2 grid grid-cols-3 gap-2">
            {toolButtons.map(({ t, icon: Icon, label }) => (
              <button
                key={t}
                onClick={() => {
                  setTool(t);
                  setSelectedId(null);
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

        {/* Pages */}
        <Card>
          <div className="p-3 border-b">
            <h2 className="font-semibold">Pages</h2>
          </div>
          <div className="p-3 grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={addBlankPage} disabled={busy}>
              <Plus className="w-4 h-4 inline mr-1" /> Add
            </Button>
            <Button size="sm" variant="outline" onClick={deletePage} disabled={busy || pageCount <= 1}>
              <Trash2 className="w-4 h-4 inline mr-1" /> Delete
            </Button>
            <Button size="sm" variant="outline" onClick={() => movePage("up")} disabled={busy || currentPage <= 1}>
              <ArrowUp className="w-4 h-4 inline mr-1" /> Up
            </Button>
            <Button size="sm" variant="outline" onClick={() => movePage("down")} disabled={busy || currentPage >= pageCount}>
              <ArrowDown className="w-4 h-4 inline mr-1" /> Down
            </Button>
            <Button size="sm" variant="outline" onClick={rotatePage} disabled={busy} className="col-span-2">
              <RotateCw className="w-4 h-4 inline mr-1" /> Rotate page
            </Button>
          </div>
        </Card>

        {/* Selected annotation properties */}
        {selected && (
          <Card>
            <div className="p-3 border-b flex items-center justify-between">
              <h2 className="font-semibold capitalize">{selected.type} properties</h2>
              <div className="flex gap-1">
                <button onClick={duplicateSelected} className="p-1 hover:bg-gray-100 rounded" title="Duplicate">
                  <Copy className="w-4 h-4 text-gray-600" />
                </button>
                <button onClick={deleteSelected} className="p-1 hover:bg-gray-100 rounded" title="Delete">
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            </div>
            <div className="p-3 space-y-3">
              {selected.type === "text" && (
                <>
                  <textarea className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} value={selected.text} onChange={(e) => updateSelected({ text: e.target.value })} />
                  <div className="flex items-center gap-2">
                    <select className="text-sm border rounded px-2 py-1 flex-1" value={selected.family} onChange={(e) => updateSelected({ family: e.target.value as FontFamily })}>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Times">Times</option>
                      <option value="Courier">Courier</option>
                    </select>
                    <button onClick={() => updateSelected({ bold: !selected.bold })} className={`p-1.5 rounded border ${selected.bold ? "bg-blue-50 border-blue-400" : ""}`} title="Bold">
                      <Bold className="w-4 h-4" />
                    </button>
                    <button onClick={() => updateSelected({ italic: !selected.italic })} className={`p-1.5 rounded border ${selected.italic ? "bg-blue-50 border-blue-400" : ""}`} title="Italic">
                      <Italic className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Size: {selected.fontSize}pt</label>
                    <input type="range" min={8} max={72} value={selected.fontSize} onChange={(e) => updateSelected({ fontSize: parseInt(e.target.value) })} className="w-full" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">Color</span>
                    <input type="color" value={selected.color} onChange={(e) => updateSelected({ color: e.target.value })} className="h-8 w-12 border rounded" />
                  </div>
                </>
              )}
              {(isBox(selected) && selected.type !== "whiteout") && (
                <>
                  {selected.type !== "highlight" && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">Stroke</span>
                      <input type="color" value={selected.strokeColor ?? "#000000"} onChange={(e) => updateSelected({ strokeColor: e.target.value })} className="h-7 w-10 border rounded" />
                    </div>
                  )}
                  {selected.type !== "highlight" && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Thickness: {selected.strokeWidth}pt</label>
                      <input type="range" min={1} max={12} value={selected.strokeWidth} onChange={(e) => updateSelected({ strokeWidth: parseInt(e.target.value) })} className="w-full" />
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{selected.type === "highlight" ? "Color" : "Fill"}</span>
                    <div className="flex items-center gap-2">
                      {selected.fillColor && <input type="color" value={selected.fillColor} onChange={(e) => updateSelected({ fillColor: e.target.value })} className="h-7 w-10 border rounded" />}
                      {selected.type !== "highlight" && (
                        <button className="text-xs px-2 py-1 rounded border hover:bg-gray-50" onClick={() => updateSelected({ fillColor: selected.fillColor ? null : "#fde68a" })}>
                          {selected.fillColor ? "Clear" : "Add"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Opacity: {Math.round(selected.opacity * 100)}%</label>
                    <input type="range" min={10} max={100} value={Math.round(selected.opacity * 100)} onChange={(e) => updateSelected({ opacity: parseInt(e.target.value) / 100 })} className="w-full" />
                  </div>
                </>
              )}
              {isLine(selected) && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">Stroke</span>
                    <input type="color" value={selected.strokeColor} onChange={(e) => updateSelected({ strokeColor: e.target.value })} className="h-7 w-10 border rounded" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Thickness: {selected.strokeWidth}pt</label>
                    <input type="range" min={1} max={12} value={selected.strokeWidth} onChange={(e) => updateSelected({ strokeWidth: parseInt(e.target.value) })} className="w-full" />
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
            <input className="font-semibold border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none px-1 min-w-0" value={docName} onChange={(e) => setDocName(e.target.value)} title="Document name" />
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Zoom out">
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
                <Button size="sm" variant="outline" onClick={() => setZoom((z) => Math.min(2, +(z + 0.25).toFixed(2)))} title="Zoom in">
                  <ZoomIn className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => {
                  setCurrentPage((p) => p - 1);
                  setSelectedId(null);
                }}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm">{currentPage} / {pageCount}</span>
                <Button size="sm" variant="outline" disabled={currentPage >= pageCount} onClick={() => {
                  setCurrentPage((p) => p + 1);
                  setSelectedId(null);
                }}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={handleDownload} disabled={busy}>
                <Download className="w-4 h-4 inline mr-1" /> Download
              </Button>
              <Button size="sm" onClick={() => saveToDocuments.mutate()} disabled={busy || saveToDocuments.isPending}>
                <Save className="w-4 h-4 inline mr-1" />
                {saveToDocuments.isPending ? "Saving…" : "Save"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => {
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
                  </svg>

                  {/* Interaction + text/image layer */}
                  <div
                    ref={overlayRef}
                    className="absolute inset-0"
                    style={{ zIndex: 6, cursor: cursorFor, pointerEvents: "auto" }}
                    onMouseDown={handleOverlayMouseDown}
                    onClick={handleOverlayClick}
                  >
                    {pageAnnotations.filter((a) => a.type === "text" || a.type === "image").map((ann) => {
                      const isSel = ann.id === selectedId;
                      const interactive = tool === "select";
                      if (ann.type === "text") {
                        const px = (ann.fontSize * renderWidth) / POINTS_WIDE;
                        return (
                          <div
                            key={ann.id}
                            onMouseDown={(e) => startMove(e, ann)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(ann.id);
                            }}
                            className={`absolute select-none ${isSel ? "ring-2 ring-blue-500" : "hover:ring-1 hover:ring-blue-300"} ${interactive ? "cursor-move" : ""}`}
                            style={{
                              left: `${ann.x * 100}%`,
                              top: `${ann.y * 100}%`,
                              width: `${ann.width * 100}%`,
                              fontSize: px,
                              lineHeight: 1.2,
                              color: ann.color,
                              fontFamily: cssFamily(ann.family),
                              fontWeight: ann.bold ? 700 : 400,
                              fontStyle: ann.italic ? "italic" : "normal",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              overflow: "hidden",
                              pointerEvents: interactive ? "auto" : "none",
                            }}
                          >
                            {ann.text || " "}
                            {isSel && interactive && (
                              <span onMouseDown={(e) => startResize(e, ann.id, "br")} className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-white border-2 border-blue-600" style={{ cursor: "ew-resize", pointerEvents: "auto" }} />
                            )}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={ann.id}
                          onMouseDown={(e) => startMove(e, ann)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(ann.id);
                          }}
                          className={`absolute ${isSel ? "ring-2 ring-blue-500" : "hover:ring-1 hover:ring-blue-300"} ${interactive ? "cursor-move" : ""}`}
                          style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%`, width: `${ann.width * 100}%`, height: `${ann.height * 100}%`, pointerEvents: interactive ? "auto" : "none" }}
                        >
                          <img src={ann.dataUrl} alt="" className="w-full h-full object-fill pointer-events-none select-none" draggable={false} />
                          {isSel && interactive && (
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
