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
} from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
// @ts-ignore - CSS imports from react-pdf
import "react-pdf/dist/Page/AnnotationLayer.css";
// @ts-ignore - CSS imports from react-pdf
import "react-pdf/dist/Page/TextLayer.css";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import { Card, LoadingSpinner } from "tibui";
import { apiClient } from "@/utils/apiClient";

// Set up PDF.js worker (mirrors PrepareDocumentPage).
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const PAGE_RENDER_WIDTH = 700;

// Local Button — matches the lightweight button used across the documents
// pages (blue primary / outline / ghost variants).
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
  const sizeStyles = {
    sm: "px-2 py-1 text-sm",
    md: "px-4 py-2",
    lg: "px-6 py-3 text-lg",
  };
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
// All overlay annotations use normalized coordinates (0-1) relative to the
// rendered page, exactly like the signing field model. x/y are the top-left
// corner. This makes export math identical regardless of zoom/render size.

type Tool = "select" | "text" | "image";

interface TextAnnotation {
  id: string;
  type: "text";
  page: number; // 1-based page index
  x: number;
  y: number;
  width: number; // normalized box width (for wrapping/hit area)
  text: string;
  fontSize: number; // in PDF points (page coordinate space)
  color: string; // hex
}

interface ImageAnnotation {
  id: string;
  type: "image";
  page: number;
  x: number;
  y: number;
  width: number; // normalized
  height: number; // normalized
  dataUrl: string; // data:image/...;base64,...
  mime: "image/png" | "image/jpeg";
}

type Annotation = TextAnnotation | ImageAnnotation;

// Per-page metadata tracked client-side. The source-of-truth page bytes live
// in pdf-lib; we keep an ordered list of original page indices plus rotation
// so add/delete/reorder/rotate are all just list operations applied at export.
interface PageEntry {
  // Index into the ORIGINAL loaded PDFDocument's pages. Blank pages get -1
  // and are created fresh at export time.
  srcIndex: number;
  rotation: number; // additional rotation in degrees (0/90/180/270)
}

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_COLOR = "#111111";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "");
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const n = parseInt(full, 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

export function EditorPage() {
  const navigate = useNavigate();

  // The working PDF as bytes, rendered by react-pdf. We re-derive this Blob
  // URL whenever the underlying document changes (load / page structure ops).
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [docName, setDocName] = useState("Untitled");

  const [pages, setPages] = useState<PageEntry[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const [numRendered, setNumRendered] = useState(0);
  const [currentPage, setCurrentPage] = useState(1); // 1-based, index into `pages`
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Drag state for moving annotations on the overlay.
  const dragState = useRef<{
    id: string;
    startX: number;
    startY: number;
    annX: number;
    annY: number;
  } | null>(null);

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
  const pageCount = pages.length;
  const pageAnnotations = annotations.filter((a) => a.page === currentPage);
  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  // ---- Loading a source PDF -------------------------------------------------
  const loadFromBytes = useCallback(async (bytes: Uint8Array, name: string) => {
    setError(null);
    try {
      const doc = await PDFDocument.load(bytes);
      const count = doc.getPageCount();
      setPdfBytes(bytes);
      setDocName(name);
      setPages(
        Array.from({ length: count }, (_, i) => ({
          srcIndex: i,
          rotation: 0,
        })),
      );
      setAnnotations([]);
      setCurrentPage(1);
      setSelectedId(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to read PDF — is it valid?",
      );
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");
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
    doc.addPage([612, 792]); // US Letter
    const bytes = await doc.save();
    setPdfBytes(bytes);
    setDocName("Untitled");
    setPages([{ srcIndex: -1, rotation: 0 }]);
    setAnnotations([]);
    setCurrentPage(1);
    setSelectedId(null);
  }, []);

  // ---- Page structure operations -------------------------------------------
  // These mutate the `pages` list and the underlying pdfBytes so react-pdf
  // shows an accurate live preview (add/delete/reorder). Rotation is tracked
  // per-entry and applied to the live bytes too.
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
        // After a rebuild, every page is "original" in the new doc — reset
        // srcIndex to identity and clear baked-in rotation.
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
    // Drop annotations on the deleted page; shift later pages down by one.
    setAnnotations((prev) =>
      prev
        .filter((a) => a.page !== currentPage)
        .map((a) => (a.page > currentPage ? { ...a, page: a.page - 1 } : a)),
    );
    rebuildPdf(next).then(() =>
      setCurrentPage(Math.min(currentPage, next.length)),
    );
  };

  const movePage = (dir: "up" | "down") => {
    const idx = currentPage - 1;
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= pageCount) return;
    const next = [...pages];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    // Swap annotation page assignments for the two affected pages.
    const a = currentPage;
    const b = swap + 1;
    setAnnotations((prev) =>
      prev.map((an) =>
        an.page === a ? { ...an, page: b } : an.page === b ? { ...an, page: a } : an,
      ),
    );
    rebuildPdf(next).then(() => setCurrentPage(swap + 1));
  };

  const rotatePage = () => {
    const next = pages.map((p, i) =>
      i === currentPage - 1 ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
    );
    rebuildPdf(next);
  };

  // ---- Placing annotations --------------------------------------------------
  const overlayPointToNorm = (clientX: number, clientY: number) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool === "text") {
      const { x, y } = overlayPointToNorm(e.clientX, e.clientY);
      const ann: TextAnnotation = {
        id: uid(),
        type: "text",
        page: currentPage,
        x: Math.max(0, Math.min(0.95, x)),
        y: Math.max(0, Math.min(0.95, y)),
        width: 0.4,
        text: "Text",
        fontSize: DEFAULT_FONT_SIZE,
        color: DEFAULT_COLOR,
      };
      setAnnotations((p) => [...p, ann]);
      setSelectedId(ann.id);
      setTool("select");
      return;
    }
    if (tool === "image") {
      // Stash the click position, then open the file picker.
      pendingImagePoint.current = overlayPointToNorm(e.clientX, e.clientY);
      imageInputRef.current?.click();
      return;
    }
    // select tool: clicking empty space deselects
    setSelectedId(null);
  };

  const pendingImagePoint = useRef<{ x: number; y: number } | null>(null);

  const handleImageChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    const mime: "image/png" | "image/jpeg" =
      file.type === "image/jpeg" || file.type === "image/jpg"
        ? "image/jpeg"
        : "image/png";
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    // Derive intrinsic aspect ratio so the placed box isn't distorted.
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.width, h: img.height });
      img.src = dataUrl;
    });
    const pt = pendingImagePoint.current ?? { x: 0.3, y: 0.3 };
    const normWidth = 0.3;
    // Convert aspect ratio into normalized height using the page render box
    // (square-ish approximation: page is ~612x792, ratio 0.77).
    const aspect = dims.h / dims.w;
    const normHeight = normWidth * aspect * (PAGE_RENDER_WIDTH / (PAGE_RENDER_WIDTH * 1.294));
    const ann: ImageAnnotation = {
      id: uid(),
      type: "image",
      page: currentPage,
      x: Math.max(0, Math.min(0.7, pt.x)),
      y: Math.max(0, Math.min(0.7, pt.y)),
      width: normWidth,
      height: Math.max(0.05, normHeight),
      dataUrl,
      mime,
    };
    setAnnotations((p) => [...p, ann]);
    setSelectedId(ann.id);
    setTool("select");
    pendingImagePoint.current = null;
  };

  // ---- Dragging annotations -------------------------------------------------
  const onAnnMouseDown = (e: React.MouseEvent, ann: Annotation) => {
    if (tool !== "select") return;
    e.stopPropagation();
    setSelectedId(ann.id);
    dragState.current = {
      id: ann.id,
      startX: e.clientX,
      startY: e.clientY,
      annX: ann.x,
      annY: ann.y,
    };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds || !overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      const dx = (e.clientX - ds.startX) / rect.width;
      const dy = (e.clientY - ds.startY) / rect.height;
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === ds.id
            ? {
                ...a,
                x: Math.max(0, Math.min(0.98, ds.annX + dx)),
                y: Math.max(0, Math.min(0.98, ds.annY + dy)),
              }
            : a,
        ),
      );
    };
    const onUp = () => {
      dragState.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Delete selected annotation with keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const editing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (editing) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        setAnnotations((p) => p.filter((a) => a.id !== selectedId));
        setSelectedId(null);
      }
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const updateSelected = (patch: Partial<TextAnnotation> & Partial<ImageAnnotation>) => {
    if (!selectedId) return;
    setAnnotations((prev) =>
      prev.map((a) => (a.id === selectedId ? ({ ...a, ...patch } as Annotation) : a)),
    );
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setAnnotations((p) => p.filter((a) => a.id !== selectedId));
    setSelectedId(null);
  };

  // ---- Export ---------------------------------------------------------------
  // Bakes annotations into the (already structurally-correct) pdfBytes via
  // pdf-lib drawText / drawImage. Returns final bytes.
  const buildFinalPdf = useCallback(async (): Promise<Uint8Array> => {
    if (!pdfBytes) throw new Error("Nothing to export");
    const doc = await PDFDocument.load(pdfBytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const docPages = doc.getPages();

    for (const ann of annotations) {
      const page = docPages[ann.page - 1];
      if (!page) continue;
      const { width: pw, height: ph } = page.getSize();

      if (ann.type === "text") {
        const { r, g, b } = hexToRgb(ann.color);
        // Normalized y is from the top; PDF origin is bottom-left. Baseline
        // sits ~one font-size below the box top.
        page.drawText(ann.text, {
          x: ann.x * pw,
          y: ph - ann.y * ph - ann.fontSize,
          size: ann.fontSize,
          font,
          color: rgb(r, g, b),
          maxWidth: ann.width * pw,
          lineHeight: ann.fontSize * 1.2,
        });
      } else {
        const bytes = Uint8Array.from(
          atob(ann.dataUrl.split(",")[1]),
          (c) => c.charCodeAt(0),
        );
        const img =
          ann.mime === "image/jpeg"
            ? await doc.embedJpg(bytes)
            : await doc.embedPng(bytes);
        const w = ann.width * pw;
        const h = ann.height * ph;
        page.drawImage(img, {
          x: ann.x * pw,
          y: ph - ann.y * ph - h,
          width: w,
          height: h,
        });
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

  // Save to Documents — mirrors CreateDocumentPage: create the document
  // record, then PUT the bytes to the returned presigned upload URL.
  const saveToDocuments = useMutation({
    mutationFn: async () => {
      const bytes = await buildFinalPdf();
      const response = await apiClient.post<{
        document: { id: string };
        uploadUrl: string;
      }>("/documents", {
        name: docName || "Untitled",
        description: "",
        filename: `${docName || "document"}.pdf`,
      });
      if (response.uploadUrl) {
        const up = await fetch(response.uploadUrl, {
          method: "PUT",
          body: new Blob([bytes.slice()], { type: "application/pdf" }),
          headers: { "Content-Type": "application/pdf" },
        });
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

  // ---- Empty state: pick a source ------------------------------------------
  if (!pdfBytes) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">PDF Editor</h1>
        <p className="text-text-muted mb-6">
          Open an existing PDF or start from a blank page, then add text and
          images, manage pages, and download or save the result.
        </p>
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}
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
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-300 hover:border-blue-400"
              }`}
            >
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="mb-2">Drag and drop a PDF here, or</p>
              <label className="cursor-pointer inline-block px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors">
                Browse Files
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>
            </div>
            <div className="flex items-center gap-3 text-text-muted text-sm">
              <div className="flex-1 h-px bg-gray-200" />
              or
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <Button
              variant="outline"
              className="w-full flex items-center justify-center gap-2"
              onClick={handleNewBlank}
            >
              <FilePlus className="w-5 h-5" />
              New blank PDF
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ---- Editor shell ---------------------------------------------------------
  return (
    <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-8rem)] gap-4">
      {/* Hidden image picker, used by the image tool. */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={handleImageChosen}
      />

      {/* Left toolbar */}
      <div className="w-full lg:w-64 flex flex-col gap-4">
        <Card>
          <div className="p-4 border-b">
            <h2 className="font-semibold">Tools</h2>
          </div>
          <div className="p-2 grid grid-cols-3 gap-2">
            {(
              [
                { t: "select", icon: MousePointer2, label: "Select" },
                { t: "text", icon: Type, label: "Text" },
                { t: "image", icon: ImageIcon, label: "Image" },
              ] as const
            ).map(({ t, icon: Icon, label }) => (
              <button
                key={t}
                onClick={() => {
                  setTool(t);
                  setSelectedId(null);
                }}
                className={`flex flex-col items-center gap-1 py-3 rounded-lg border-2 transition-colors ${
                  tool === t
                    ? "bg-blue-50 border-blue-500 text-blue-600"
                    : "bg-gray-50 border-transparent hover:bg-gray-100 text-gray-700"
                }`}
                title={label}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs">{label}</span>
              </button>
            ))}
          </div>
          {tool !== "select" && (
            <p className="px-4 pb-3 text-xs text-gray-500">
              {tool === "text"
                ? "Click on the page to place a text box."
                : "Click on the page, then choose an image file."}
            </p>
          )}
        </Card>

        {/* Page management */}
        <Card>
          <div className="p-4 border-b">
            <h2 className="font-semibold">Pages</h2>
          </div>
          <div className="p-3 grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={addBlankPage} disabled={busy}>
              <Plus className="w-4 h-4 inline mr-1" /> Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={deletePage}
              disabled={busy || pageCount <= 1}
            >
              <Trash2 className="w-4 h-4 inline mr-1" /> Delete
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => movePage("up")}
              disabled={busy || currentPage <= 1}
            >
              <ArrowUp className="w-4 h-4 inline mr-1" /> Up
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => movePage("down")}
              disabled={busy || currentPage >= pageCount}
            >
              <ArrowDown className="w-4 h-4 inline mr-1" /> Down
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={rotatePage}
              disabled={busy}
              className="col-span-2"
            >
              <RotateCw className="w-4 h-4 inline mr-1" /> Rotate page
            </Button>
          </div>
        </Card>

        {/* Selected annotation properties */}
        {selected && (
          <Card>
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-semibold">
                {selected.type === "text" ? "Text" : "Image"} properties
              </h2>
              <button
                onClick={deleteSelected}
                className="p-1 hover:bg-gray-100 rounded"
                title="Delete"
              >
                <Trash2 className="w-4 h-4 text-red-500" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {selected.type === "text" ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Text
                    </label>
                    <textarea
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                      rows={3}
                      value={selected.text}
                      onChange={(e) => updateSelected({ text: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Font size: {selected.fontSize}pt
                    </label>
                    <input
                      type="range"
                      min={8}
                      max={72}
                      value={selected.fontSize}
                      onChange={(e) =>
                        updateSelected({ fontSize: parseInt(e.target.value) })
                      }
                      className="w-full"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700">
                      Color
                    </label>
                    <input
                      type="color"
                      value={selected.color}
                      onChange={(e) => updateSelected({ color: e.target.value })}
                      className="h-8 w-12 border rounded"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Width: {Math.round(selected.width * 100)}%
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    value={Math.round(selected.width * 100)}
                    onChange={(e) => {
                      const w = parseInt(e.target.value) / 100;
                      // Preserve aspect ratio relative to current box.
                      const aspect = selected.height / selected.width;
                      updateSelected({ width: w, height: w * aspect });
                    }}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Drag the image on the page to reposition.
                  </p>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Main canvas */}
      <div className="flex-1 min-w-0">
        <Card className="h-full flex flex-col">
          <div className="p-4 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2">
              <input
                className="font-semibold border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none px-1 min-w-0"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                title="Document name"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Zoom */}
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                  title="Zoom out"
                >
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-sm w-12 text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setZoom((z) => Math.min(2, +(z + 0.25).toFixed(2)))}
                  title="Zoom in"
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
              </div>
              {/* Page nav */}
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage <= 1}
                  onClick={() => {
                    setCurrentPage((p) => p - 1);
                    setSelectedId(null);
                  }}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm">
                  {currentPage} / {pageCount}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage >= pageCount}
                  onClick={() => {
                    setCurrentPage((p) => p + 1);
                    setSelectedId(null);
                  }}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                disabled={busy}
              >
                <Download className="w-4 h-4 inline mr-1" /> Download
              </Button>
              <Button
                size="sm"
                onClick={() => saveToDocuments.mutate()}
                disabled={busy || saveToDocuments.isPending}
              >
                <Save className="w-4 h-4 inline mr-1" />
                {saveToDocuments.isPending ? "Saving…" : "Save to Documents"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPdfBytes(null);
                  setAnnotations([]);
                  setPages([]);
                }}
                title="Close and open another"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {(error || saveMsg) && (
            <div className="px-4 pt-3">
              {error && (
                <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {error}
                </div>
              )}
              {saveMsg && (
                <div className="p-2 bg-green-50 border border-green-200 rounded text-green-700 text-sm">
                  {saveMsg}
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-auto bg-gray-100 p-4">
            {fileUrl ? (
              <div className="flex justify-start sm:justify-center">
                <div
                  className="relative bg-white shadow-lg"
                  style={{ width: renderWidth }}
                >
                  <div className="[&_.react-pdf__Page__textContent]:pointer-events-none [&_.react-pdf__Page__annotations]:pointer-events-none">
                    <Document
                      file={fileUrl}
                      onLoadSuccess={({ numPages }) => setNumRendered(numPages)}
                      loading={
                        <div className="flex items-center justify-center h-96">
                          <LoadingSpinner size="lg" />
                        </div>
                      }
                    >
                      {currentPage <= numRendered && (
                        <Page pageNumber={currentPage} width={renderWidth} />
                      )}
                    </Document>
                  </div>

                  {/* Edit overlay */}
                  <div
                    ref={overlayRef}
                    className="absolute inset-0"
                    style={{
                      zIndex: 5,
                      cursor:
                        tool === "text"
                          ? "text"
                          : tool === "image"
                            ? "crosshair"
                            : "default",
                    }}
                    onClick={handleOverlayClick}
                  >
                    {pageAnnotations.map((ann) => {
                      const isSel = ann.id === selectedId;
                      if (ann.type === "text") {
                        // Scale font from PDF points → on-screen px. The page
                        // renders at renderWidth for a 612pt-wide page, so the
                        // scale factor is renderWidth/612.
                        const px = (ann.fontSize * renderWidth) / 612;
                        return (
                          <div
                            key={ann.id}
                            onMouseDown={(e) => onAnnMouseDown(e, ann)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(ann.id);
                            }}
                            className={`absolute select-none ${
                              isSel
                                ? "ring-2 ring-blue-500"
                                : "hover:ring-1 hover:ring-blue-300"
                            } ${tool === "select" ? "cursor-move" : ""}`}
                            style={{
                              left: `${ann.x * 100}%`,
                              top: `${ann.y * 100}%`,
                              width: `${ann.width * 100}%`,
                              fontSize: px,
                              lineHeight: 1.2,
                              color: ann.color,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              overflow: "hidden",
                            }}
                          >
                            {ann.text || " "}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={ann.id}
                          onMouseDown={(e) => onAnnMouseDown(e, ann)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(ann.id);
                          }}
                          className={`absolute ${
                            isSel
                              ? "ring-2 ring-blue-500"
                              : "hover:ring-1 hover:ring-blue-300"
                          } ${tool === "select" ? "cursor-move" : ""}`}
                          style={{
                            left: `${ann.x * 100}%`,
                            top: `${ann.y * 100}%`,
                            width: `${ann.width * 100}%`,
                            height: `${ann.height * 100}%`,
                          }}
                        >
                          <img
                            src={ann.dataUrl}
                            alt=""
                            className="w-full h-full object-fill pointer-events-none select-none"
                            draggable={false}
                          />
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
