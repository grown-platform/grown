import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { LoadingSpinner } from "tibui";
import {
  Plus,
  Type,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Trash2,
  Move,
  AlignJustify,
  Undo2,
  Redo2,
  MousePointer2,
} from "lucide-react";

// PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// One editable text item (either extracted from the PDF or added by the user).
export interface EditableTextItem {
  pageNumber: number; // 1-indexed
  // itemIndex disambiguates items on the same page. Extracted items use the
  // pdfjs index (>=0). Newly-added items use negative ids derived from
  // Date.now() so they never collide with extracted ones.
  itemIndex: number;
  originalText: string; // "" for newly-added items
  currentText: string;
  // PDF-space transform matrix [a, b, c, d, e, f]. Position is (e, f).
  // Font size lives in |transform[3]| (vertical scale).
  transform: number[];
  width: number;
  height: number;
  // Inline styling. Defaults false; user toggles in the toolbar.
  // We don't try to detect these on extracted items (pdfjs font-name
  // heuristics are unreliable across fonts).
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  // Soft-delete flag. When true, the editable span is not rendered, AND
  // on save the white rectangle is still drawn to cover the original
  // text underneath. Newly-added items (originalText === "") can also
  // be marked deleted, in which case save just skips them entirely.
  deleted?: boolean;
  // For extracted items, the transform at extract time. Used to render a
  // ghost white rectangle at the original position when the item has been
  // moved, so the original PDF text is visually covered in the editor
  // (matching what `applyTextEdits` does to the PDF on save).
  originalTransform?: number[];
  // True when this item matches what's currently saved in the PDF — set
  // on freshly-extracted items and after a successful save. The dirty
  // check ignores synced items so a re-mount after save doesn't flag
  // every persisted edit (e.g. a previously-deleted item) as unsaved.
  synced?: boolean;
}

interface PdfTextEditorProps {
  src: string;
  // Items are owned by the parent so edits survive component unmount/remount
  // (e.g., when toggling between annotate and text-edit modes).
  items: EditableTextItem[];
  onItemsChange: (items: EditableTextItem[]) => void;
}

interface PageInfo {
  pageNumber: number;
  viewport: { width: number; height: number };
}

const DEFAULT_NEW_FONT_SIZE = 12;
// Default page margins in PDF points (1pt ≈ 1/72 inch). The guides keep
// text blocks inside this safe area unless the user drags them.
const DEFAULT_MARGIN_LEFT = 72;
const DEFAULT_MARGIN_RIGHT = 72;

/**
 * In-place PDF text editor. Extracts text items via pdfjs on first page
 * render, then renders positioned contenteditable spans over the rendered
 * canvas so the user can modify the underlying text. Also lets the user
 * place new text blocks via the toolbar's "+ Text" button.
 *
 * Caveats (also surfaced in the parent UI):
 *  - Best effort. Scanned PDFs won't have editable items.
 *  - New text renders in Helvetica regardless of original font.
 *  - Width isn't recomputed — long replacements may overflow.
 */
const HISTORY_MAX = 50;

export function PdfTextEditor({
  src,
  items,
  onItemsChange,
}: PdfTextEditorProps) {
  const [numPages, setNumPages] = useState(0);
  const [pages, setPages] = useState<Record<number, PageInfo>>({});
  const [extractedPages, setExtractedPages] = useState<Set<number>>(new Set());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  // Active tool. "select" is the default (click text to edit/move/delete);
  // "add-text" switches the cursor and turns page clicks into "drop a new
  // text block here".
  const [tool, setTool] = useState<"select" | "add-text">("select");
  const placingText = tool === "add-text";
  const [marginLeft, setMarginLeft] = useState(DEFAULT_MARGIN_LEFT);
  const [marginRight, setMarginRight] = useState(DEFAULT_MARGIN_RIGHT);
  const containerRef = useRef<HTMLDivElement>(null);

  // Undo/redo stacks. Each entry is a full items snapshot. Capped at
  // HISTORY_MAX. Whole-drag operations push a single snapshot at
  // mousedown so undoing a drag is one step.
  const [past, setPast] = useState<EditableTextItem[][]>([]);
  const [future, setFuture] = useState<EditableTextItem[][]>([]);
  const pushHistory = useCallback(() => {
    setPast((p) => {
      const next = [...p, items];
      return next.length > HISTORY_MAX ? next.slice(-HISTORY_MAX) : next;
    });
    setFuture([]);
  }, [items]);
  // Internal change wrapper: pushes the pre-change snapshot to undo
  // history unless skipHistory is set (used during drag mousemove,
  // and by the undo/redo dispatchers themselves).
  const change = useCallback(
    (next: EditableTextItem[], opts?: { skipHistory?: boolean }) => {
      if (!opts?.skipHistory) {
        setPast((p) => {
          const out = [...p, items];
          return out.length > HISTORY_MAX ? out.slice(-HISTORY_MAX) : out;
        });
        setFuture([]);
      }
      onItemsChange(next);
    },
    [items, onItemsChange],
  );
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  const handleUndo = useCallback(() => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture((f) => [items, ...f]);
    onItemsChange(prev);
  }, [past, items, onItemsChange]);
  const handleRedo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast((p) => [...p, items]);
    onItemsChange(next);
  }, [future, items, onItemsChange]);
  // Live-measured width of the focused editable span. Used so the trash
  // button stays anchored to the right edge as the user types.
  const focusedSpanRef = useRef<HTMLSpanElement | null>(null);
  const [focusedSpanWidth, setFocusedSpanWidth] = useState<number | null>(null);
  useEffect(() => {
    setFocusedSpanWidth(null);
    const el = focusedSpanRef.current;
    if (!el) return;
    // Seed with the current width so the trash starts in the right spot.
    setFocusedSpanWidth(el.offsetWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setFocusedSpanWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [focusedKey]);

  // Drag state — both for text-block drag and margin-guide drag.
  // Using a ref because we update position on every mousemove and don't
  // want a re-render per event.
  type DragState =
    | {
        kind: "item";
        key: string;
        startMouseX: number;
        startMouseY: number;
        startTx: number;
        startTy: number;
      }
    | { kind: "margin"; side: "left" | "right"; startMouseX: number };
  const dragRef = useRef<DragState | null>(null);

  // Latest items for use in mousemove handlers (which capture the closure
  // at mousedown time). Using a ref avoids stale closures.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const itemKey = (it: EditableTextItem) => `${it.pageNumber}-${it.itemIndex}`;
  const focusedItem = items.find((it) => itemKey(it) === focusedKey) ?? null;

  // In-component "object clipboard" for copy/paste of whole text blocks.
  // Distinct from the OS clipboard — Ctrl+C only stashes here when no
  // text selection exists (so plain-text copy still works inside a span).
  const clipboardItemRef = useRef<EditableTextItem | null>(null);

  // Deselect when the user mousedowns anywhere outside a text item or the
  // toolbar. Skips when no item is focused so we don't run a no-op listener.
  useEffect(() => {
    if (!focusedKey) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-text-item]")) return;
      if (target.closest("[data-text-toolbar]")) return;
      setFocusedKey(null);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [focusedKey]);

  // Ctrl/Cmd+C copies the focused block as an object (only when no text
  // selection exists, so partial-text copy inside the span still works).
  // Ctrl/Cmd+V pastes a duplicate offset slightly so it doesn't overlap.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "c") {
        if (!focusedKey) return;
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().length > 0) return;
        const it = items.find((i) => itemKey(i) === focusedKey);
        if (!it) return;
        clipboardItemRef.current = it;
        e.preventDefault();
      } else if (k === "v") {
        const tmpl = clipboardItemRef.current;
        if (!tmpl) return;
        // If the cursor is in a contentEditable span the user is typing —
        // let the browser handle text paste.
        const active = document.activeElement as HTMLElement | null;
        if (active && active.isContentEditable) return;
        const OFFSET = 12;
        const t = [...tmpl.transform];
        t[4] = (t[4] || 0) + OFFSET;
        t[5] = (t[5] || 0) - OFFSET;
        const dup: EditableTextItem = {
          ...tmpl,
          itemIndex: -Date.now(),
          originalText: "",
          transform: t,
          originalTransform: undefined,
          deleted: false,
        };
        change([...items, dup]);
        setFocusedKey(itemKey(dup));
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusedKey, items, change]);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
    },
    [],
  );

  const onPageRenderSuccess = useCallback(
    async (page: any) => {
      const pageNumber: number = page.pageNumber;
      const viewport = page.getViewport({ scale: 1 });
      setPages((prev) => ({
        ...prev,
        [pageNumber]: {
          pageNumber,
          viewport: { width: viewport.width, height: viewport.height },
        },
      }));
      // Skip extraction if this page has already been extracted this
      // session, OR if the parent already has items for this page from a
      // prior mount. The parent persists items across mode switches and
      // saves, so re-extracting would resurrect previously-deleted text
      // (the underlying glyphs remain in the PDF stream; we just cover
      // them with a white rect on save).
      if (extractedPages.has(pageNumber)) return;
      if (items.some((it) => it.pageNumber === pageNumber)) {
        setExtractedPages((prev) => new Set(prev).add(pageNumber));
        return;
      }
      try {
        const tc = await page.getTextContent();
        const extracted: EditableTextItem[] = (tc.items as any[])
          .map((it, idx) => ({
            pageNumber,
            itemIndex: idx,
            originalText: it.str ?? "",
            currentText: it.str ?? "",
            transform: it.transform as number[],
            // Snapshot the original transform so we can render a ghost
            // white rect at the original position when the item is moved.
            originalTransform: [...(it.transform as number[])],
            width: it.width as number,
            height: it.height as number,
            // Freshly extracted items match what's in the PDF.
            synced: true,
          }))
          .filter((it) => it.originalText.length > 0);
        // Merge: keep existing items for this page (in case the parent already
        // has edits from a previous session), append any newly-extracted items
        // not already present.
        const existing = items.filter((it) => it.pageNumber === pageNumber);
        const existingIndices = new Set(existing.map((it) => it.itemIndex));
        const toAdd = extracted.filter(
          (it) => !existingIndices.has(it.itemIndex),
        );
        if (toAdd.length > 0) {
          // Initial text extraction shouldn't be undoable — it's not a
          // user action. Skip history.
          change([...items, ...toAdd], { skipHistory: true });
        }
        setExtractedPages((prev) => new Set(prev).add(pageNumber));
      } catch (err) {
        console.warn("Text extraction failed for page", pageNumber, err);
      }
    },
    // items + onItemsChange intentionally omitted from deps: pdfjs renders
    // pages once per Page mount, and we only want to extract once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extractedPages],
  );

  const updateItem = (key: string, patch: Partial<EditableTextItem>) => {
    change(
      items.map((it) =>
        itemKey(it) === key ? { ...it, ...patch, synced: false } : it,
      ),
    );
  };

  const handleBlur = (pageNumber: number, itemIndex: number, value: string) => {
    // Only push history if the value actually changed (blur fires even
    // when the user just clicked in/out without typing).
    const existing = items.find(
      (it) => it.pageNumber === pageNumber && it.itemIndex === itemIndex,
    );
    if (!existing || existing.currentText === value) return;
    change(
      items.map((it) =>
        it.pageNumber === pageNumber && it.itemIndex === itemIndex
          ? { ...it, currentText: value, synced: false }
          : it,
      ),
    );
  };

  // Drag handlers — installed as window listeners while a drag is active.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === "item") {
        const dx = e.clientX - drag.startMouseX;
        const dy = e.clientY - drag.startMouseY;
        const item = itemsRef.current.find((i) => itemKey(i) === drag.key);
        if (!item) return;
        const pageInfo = pages[item.pageNumber];
        if (!pageInfo) return;
        const fontSize = Math.abs(item.transform[3] || item.height);
        const boxWidth = Math.max(item.width + 4, 40);
        // PDF y origin is bottom-left; CSS y is top-down. Vertical drag in CSS
        // (down +) corresponds to PDF y decreasing.
        let newTx = drag.startTx + dx;
        let newTy = drag.startTy - dy;
        // Clamp to margins horizontally and to page bounds vertically.
        newTx = Math.max(
          marginLeft,
          Math.min(pageInfo.viewport.width - marginRight - boxWidth, newTx),
        );
        newTy = Math.max(
          0,
          Math.min(pageInfo.viewport.height - fontSize, newTy),
        );
        const t = [...item.transform];
        t[4] = newTx;
        t[5] = newTy;
        // Drag mousemove fires many times per drag; skip history on each.
        // A single snapshot was pushed in startItemDrag.
        change(
          itemsRef.current.map((i) =>
            itemKey(i) === drag.key ? { ...i, transform: t, synced: false } : i,
          ),
          { skipHistory: true },
        );
      } else if (drag.kind === "margin") {
        const dx = e.clientX - drag.startMouseX;
        if (drag.side === "left") {
          setMarginLeft((m) => Math.max(0, Math.min(300, m + dx)));
        } else {
          setMarginRight((m) => Math.max(0, Math.min(300, m - dx)));
        }
        // Reset the anchor so subsequent moves are incremental.
        drag.startMouseX = e.clientX;
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [pages, marginLeft, marginRight, onItemsChange]);

  const startItemDrag = (e: React.MouseEvent, item: EditableTextItem) => {
    e.preventDefault();
    e.stopPropagation();
    // Snapshot before the drag so the whole drag is one undo step.
    pushHistory();
    dragRef.current = {
      kind: "item",
      key: itemKey(item),
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startTx: item.transform[4],
      startTy: item.transform[5],
    };
  };

  const startMarginDrag = (e: React.MouseEvent, side: "left" | "right") => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { kind: "margin", side, startMouseX: e.clientX };
  };

  // Click on a page in "placing text" mode → drop a new editable item there.
  const handlePageClick = (
    e: React.MouseEvent<HTMLDivElement>,
    pageNumber: number,
  ) => {
    if (!placingText) return;
    const info = pages[pageNumber];
    if (!info) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    // Convert CSS pixel coords to PDF user units. The canvas is rendered at
    // scale=1 so 1 CSS pixel == 1 PDF unit. PDF y-origin is bottom-left.
    const fontSize = DEFAULT_NEW_FONT_SIZE;
    const tx = cssX;
    const ty = info.viewport.height - cssY - fontSize;
    const newItem: EditableTextItem = {
      pageNumber,
      itemIndex: -Date.now(), // unique negative id
      originalText: "",
      currentText: "New text",
      transform: [1, 0, 0, fontSize, tx, ty],
      width: 80,
      height: fontSize,
    };
    change([...items, newItem]);
    setTool("select");
    setFocusedKey(itemKey(newItem));
  };

  return (
    <div className="relative bg-gray-100">
      {/* Toolbar */}
      <div
        data-text-toolbar
        className="sticky top-0 z-10 bg-white border-b border-border px-2 sm:px-4 py-2 flex flex-wrap items-center gap-2"
      >
        <button
          type="button"
          onClick={handleUndo}
          disabled={!canUndo}
          title="Undo"
          aria-label="Undo"
          className="px-2 py-1 rounded-md border border-border bg-transparent hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={!canRedo}
          title="Redo"
          aria-label="Redo"
          className="px-2 py-1 rounded-md border border-border bg-transparent hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Redo2 className="w-4 h-4" />
        </button>
        <div className="w-px h-6 bg-border mx-1" />
        <button
          type="button"
          onClick={() => setTool("select")}
          title="Select tool (click text blocks to edit, move, or delete)"
          className={`px-3 py-1 rounded-md text-sm font-medium border ${
            tool === "select"
              ? "border-primary bg-primary text-white"
              : "border-border bg-transparent hover:bg-background"
          }`}
        >
          <MousePointer2 className="w-4 h-4 inline mr-1" />
          Select
        </button>
        <button
          type="button"
          onClick={() => {
            setTool((t) => (t === "add-text" ? "select" : "add-text"));
            setFocusedKey(null);
          }}
          className={`px-3 py-1 rounded-md text-sm font-medium border ${
            placingText
              ? "border-primary bg-primary text-white"
              : "border-border bg-transparent hover:bg-background"
          }`}
          title="Click then click on the document to place a new text block"
        >
          <Plus className="w-4 h-4 inline mr-1" />
          {placingText ? "Click on PDF to place…" : "Add text"}
        </button>
        {(marginLeft !== DEFAULT_MARGIN_LEFT ||
          marginRight !== DEFAULT_MARGIN_RIGHT) && (
          <button
            type="button"
            onClick={() => {
              setMarginLeft(DEFAULT_MARGIN_LEFT);
              setMarginRight(DEFAULT_MARGIN_RIGHT);
            }}
            title={`Reset margins to ${DEFAULT_MARGIN_LEFT}pt (1 inch)`}
            className="px-3 py-1 rounded-md text-sm font-medium border border-border bg-transparent hover:bg-background"
          >
            <AlignJustify className="w-4 h-4 inline mr-1" />
            Reset margins
          </button>
        )}

        {focusedItem && (
          <div className="flex items-center gap-2 ml-2">
            <Type className="w-4 h-4 text-text-muted" />
            <label className="text-xs text-text-muted">Size</label>
            <input
              type="number"
              min={4}
              max={144}
              value={Math.round(
                Math.abs(focusedItem.transform[3] || focusedItem.height),
              )}
              onChange={(e) => {
                const next = Math.max(
                  4,
                  Math.min(144, parseInt(e.target.value, 10) || 12),
                );
                const t = [...focusedItem.transform];
                t[3] = next;
                updateItem(focusedKey!, { transform: t, height: next });
              }}
              className="w-16 px-2 py-1 border border-border rounded-md text-sm"
            />
            <span className="text-xs text-text-muted">pt</span>
            <div className="ml-1 flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  updateItem(focusedKey!, { bold: !focusedItem.bold })
                }
                title={focusedItem.bold ? "Remove bold" : "Bold (B)"}
                className={`px-2 py-1 rounded-md border text-sm font-medium ${
                  focusedItem.bold
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-transparent hover:bg-background"
                }`}
              >
                <Bold className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  updateItem(focusedKey!, { italic: !focusedItem.italic })
                }
                title={focusedItem.italic ? "Remove italic" : "Italic (I)"}
                className={`px-2 py-1 rounded-md border text-sm font-medium ${
                  focusedItem.italic
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-transparent hover:bg-background"
                }`}
              >
                <Italic className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  updateItem(focusedKey!, {
                    underline: !focusedItem.underline,
                  })
                }
                title={
                  focusedItem.underline ? "Remove underline" : "Underline (U)"
                }
                className={`px-2 py-1 rounded-md border text-sm font-medium ${
                  focusedItem.underline
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-transparent hover:bg-background"
                }`}
              >
                <Underline className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  updateItem(focusedKey!, { strike: !focusedItem.strike })
                }
                title={
                  focusedItem.strike ? "Remove strikethrough" : "Strikethrough"
                }
                className={`px-2 py-1 rounded-md border text-sm font-medium ${
                  focusedItem.strike
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-transparent hover:bg-background"
                }`}
              >
                <Strikethrough className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div ref={containerRef} className="p-4 overflow-auto">
        <Document
          file={src}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex justify-center p-8">
              <LoadingSpinner />
            </div>
          }
        >
          {Array.from(new Array(numPages), (_, i) => i + 1).map(
            (pageNumber) => {
              const info = pages[pageNumber];
              const pageItems = items.filter(
                (it) => it.pageNumber === pageNumber,
              );
              return (
                <div
                  key={pageNumber}
                  className="relative sm:mx-auto mb-6 shadow-lg"
                  style={{
                    width: info?.viewport.width,
                    height: info?.viewport.height,
                    cursor: placingText ? "crosshair" : "default",
                  }}
                  onClick={(e) => handlePageClick(e, pageNumber)}
                >
                  <Page
                    pageNumber={pageNumber}
                    scale={1}
                    onRenderSuccess={(page: any) => onPageRenderSuccess(page)}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                  {info && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        width: info.viewport.width,
                        height: info.viewport.height,
                      }}
                    >
                      {pageItems
                        .filter((it) => !it.deleted)
                        .map((it) => {
                          const [, , , , tx, ty] = it.transform;
                          const fontSize = Math.abs(
                            it.transform[3] || it.height,
                          );
                          const left = tx;
                          const top = info.viewport.height - ty - fontSize;
                          const key = itemKey(it);
                          const isFocused = focusedKey === key;
                          // Width estimate. Generous horizontal floor for clickability.
                          const boxWidth = Math.max(it.width + 8, 40);
                          // Ghost white rect at the original position when this
                          // extracted item has been moved. Covers the underlying
                          // PDF body text so the editor view matches what will
                          // be written on save.
                          const orig = it.originalTransform;
                          const moved =
                            orig &&
                            (orig[4] !== it.transform[4] ||
                              orig[5] !== it.transform[5]);
                          const ghostLeft = orig ? orig[4] : 0;
                          const ghostTop = orig
                            ? info.viewport.height -
                              orig[5] -
                              Math.abs(orig[3] || fontSize)
                            : 0;
                          const ghostFontSize = orig
                            ? Math.abs(orig[3] || fontSize)
                            : fontSize;
                          return (
                            <span key={key} data-text-item>
                              {moved && (
                                <span
                                  aria-hidden
                                  className="absolute pointer-events-none"
                                  style={{
                                    left: ghostLeft,
                                    top: ghostTop,
                                    width: Math.max(it.width + 4, 1),
                                    height: ghostFontSize * 1.1,
                                    backgroundColor: "white",
                                  }}
                                />
                              )}
                              <span
                                ref={isFocused ? focusedSpanRef : undefined}
                                contentEditable
                                suppressContentEditableWarning
                                spellCheck={false}
                                onFocus={() => setFocusedKey(key)}
                                onBlur={(e) =>
                                  handleBlur(
                                    it.pageNumber,
                                    it.itemIndex,
                                    e.currentTarget.textContent ?? "",
                                  )
                                }
                                title="Click to edit"
                                className={`absolute outline-none pointer-events-auto cursor-text hover:ring-1 hover:ring-blue-400 ${
                                  isFocused ? "ring-2 ring-blue-500" : ""
                                }`}
                                style={{
                                  left,
                                  top,
                                  minWidth: boxWidth,
                                  height: fontSize * 1.25,
                                  fontSize: `${fontSize}px`,
                                  lineHeight: `${fontSize * 1.2}px`,
                                  whiteSpace: "pre",
                                  backgroundColor: "white",
                                  color: "black",
                                  caretColor: "black",
                                  fontFamily: "sans-serif",
                                  fontWeight: it.bold ? 700 : 400,
                                  fontStyle: it.italic ? "italic" : "normal",
                                  textDecoration:
                                    [
                                      it.underline ? "underline" : null,
                                      it.strike ? "line-through" : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" ") || "none",
                                  padding: "0 1px",
                                  boxSizing: "border-box",
                                }}
                              >
                                {it.currentText}
                              </span>
                              {isFocused && (
                                <>
                                  {/* Move handle */}
                                  <button
                                    type="button"
                                    onMouseDown={(e) => startItemDrag(e, it)}
                                    title="Drag to move"
                                    className="absolute pointer-events-auto bg-gray-700 text-white rounded-md p-1 hover:bg-gray-800 shadow-md cursor-move"
                                    style={{
                                      left:
                                        left - Math.max(fontSize * 1.4, 24) - 4,
                                      top: top - 2,
                                      width: Math.max(fontSize * 1.4, 24),
                                      height: Math.max(fontSize * 1.4, 24),
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                  >
                                    <Move className="w-3.5 h-3.5" />
                                  </button>
                                  {/* Trash — anchored to the right edge of the
                                  editable span. Use the live-measured width
                                  if available (so it follows as text grows),
                                  otherwise fall back to the box's minimum. */}
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          "Delete this text block?",
                                        )
                                      ) {
                                        change(
                                          items.map((i) =>
                                            itemKey(i) === key
                                              ? {
                                                  ...i,
                                                  deleted: true,
                                                  synced: false,
                                                }
                                              : i,
                                          ),
                                        );
                                        setFocusedKey(null);
                                      }
                                    }}
                                    title="Delete this text block"
                                    className="absolute pointer-events-auto bg-red-600 text-white rounded-md p-1 hover:bg-red-700 shadow-md"
                                    style={{
                                      left:
                                        left +
                                        (focusedSpanWidth ?? boxWidth) +
                                        4,
                                      top: top - 2,
                                      width: Math.max(fontSize * 1.4, 24),
                                      height: Math.max(fontSize * 1.4, 24),
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </span>
                          );
                        })}
                      {/* Margin guides */}
                      <div
                        className="absolute pointer-events-auto cursor-ew-resize"
                        onMouseDown={(e) => startMarginDrag(e, "left")}
                        title={`Left margin: ${Math.round(marginLeft)}pt — drag to adjust`}
                        style={{
                          left: marginLeft - 1,
                          top: 0,
                          width: 3,
                          height: info.viewport.height,
                          backgroundColor: "rgba(59, 130, 246, 0.35)",
                        }}
                      />
                      <div
                        className="absolute pointer-events-auto cursor-ew-resize"
                        onMouseDown={(e) => startMarginDrag(e, "right")}
                        title={`Right margin: ${Math.round(marginRight)}pt — drag to adjust`}
                        style={{
                          left: info.viewport.width - marginRight - 1,
                          top: 0,
                          width: 3,
                          height: info.viewport.height,
                          backgroundColor: "rgba(59, 130, 246, 0.35)",
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            },
          )}
        </Document>
      </div>
    </div>
  );
}

/**
 * Apply text-edit changes to a PDF and return a new Blob.
 * - For modified extracted items: cover original with white rect, draw new text.
 * - For newly-added items (originalText === ""): just draw text at position.
 */
export async function applyTextEdits(
  src: string,
  items: EditableTextItem[],
): Promise<Blob> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);
  const original = await response.arrayBuffer();
  const pdf = await PDFDocument.load(original);
  // Embed all four Helvetica variants so we can pick based on bold+italic.
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  const pickFont = (it: EditableTextItem) => {
    if (it.bold && it.italic) return fonts.boldItalic;
    if (it.bold) return fonts.bold;
    if (it.italic) return fonts.italic;
    return fonts.regular;
  };

  const pages = pdf.getPages();
  for (const item of items) {
    const isNew = item.originalText === "";

    // Deleted items: if they had original text, cover it with a white
    // rectangle so the PDF body content goes away. If they were newly
    // added, there's nothing to do — skip.
    if (item.deleted) {
      if (isNew) continue;
      const page = pages[item.pageNumber - 1];
      if (!page) continue;
      const [, , , , tx, ty] = item.transform;
      const fontSize = Math.abs(item.transform[3] || item.height);
      page.drawRectangle({
        x: tx,
        y: ty,
        width: item.width,
        height: fontSize * 1.1,
        color: rgb(1, 1, 1),
      });
      continue;
    }

    const unchangedText = !isNew && item.currentText === item.originalText;
    const styleChanged =
      !!item.bold || !!item.italic || !!item.underline || !!item.strike;
    if (unchangedText && !styleChanged && !isNew) continue;
    const page = pages[item.pageNumber - 1];
    if (!page) continue;

    const [, , , , tx, ty] = item.transform;
    const fontSize = Math.abs(item.transform[3] || item.height);

    // Standard Helvetica uses WinAnsi encoding, which can't encode \n/\r/\t
    // and various Unicode chars. Split on newlines so multi-line blocks
    // render as stacked lines; expand tabs; strip anything else WinAnsi
    // can't represent.
    const font = pickFont(item);
    // Replace tabs with 4 spaces; drop anything outside WinAnsi printable
    // range (ASCII + Latin-1 supplement). Smart quotes / em-dash etc. would
    // need a Type 0 font — out of scope for now.
    const sanitizeLine = (s: string) =>
      s.replace(/\t/g, "    ").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
    const rawLines = item.currentText.split(/\r\n|\r|\n/);
    const lines = rawLines.map(sanitizeLine);
    const lineHeight = fontSize * 1.2;

    if (!isNew) {
      // Cover the original text. For multi-line edits the covered area
      // grows downward in CSS (i.e. y decreases in PDF coords).
      page.drawRectangle({
        x: tx,
        y: ty - Math.max(0, lines.length - 1) * lineHeight,
        width: item.width,
        height: fontSize * 1.1 + Math.max(0, lines.length - 1) * lineHeight,
        color: rgb(1, 1, 1),
      });
    }
    if (lines.some((l) => l.length > 0)) {
      const lineThickness = Math.max(0.6, fontSize * 0.06);
      lines.forEach((line, i) => {
        const yLine = ty - i * lineHeight;
        if (line.length > 0) {
          page.drawText(line, {
            x: tx,
            y: yLine,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
          });
        }
        if (line.length > 0 && (item.underline || item.strike)) {
          const textWidth = font.widthOfTextAtSize(line, fontSize);
          if (item.underline) {
            page.drawRectangle({
              x: tx,
              y: yLine - lineThickness * 1.5,
              width: textWidth,
              height: lineThickness,
              color: rgb(0, 0, 0),
            });
          }
          if (item.strike) {
            page.drawRectangle({
              x: tx,
              y: yLine + fontSize * 0.32,
              width: textWidth,
              height: lineThickness,
              color: rgb(0, 0, 0),
            });
          }
        }
      });
    }
  }

  const bytes = await pdf.save();
  return new Blob([bytes], { type: "application/pdf" });
}
