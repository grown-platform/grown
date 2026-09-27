import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/joy";
import { CANVAS_W, CANVAS_H, type Slide, type SlideElement } from "./model";
import {
  elementStyle,
  GroupChildren,
  ShapeSvg,
  ShrinkFit,
  SlideTable,
  renderSlideText,
} from "./SlideView";
import { EDITOR_CSS, TextEditor, type TextEditorHandle } from "./TextEditor";
import type { TextKeyAction } from "./keymap";
import {
  GLUE_DISTANCE,
  adjustHandles,
  connectionSites,
  connectorEnds,
  dragAdjustHandle,
  nearestSite,
  setConnectorEnds,
} from "./connectorOps";
import { drawnElement, type DrawTool } from "./drawTool";
import {
  GRID_SIZE,
  HANDLES,
  LINE_HANDLES,
  canvasHeight,
  canvasScale,
  dragElement,
  handleCursor,
  handlePosition,
  marqueeSelect,
  normalizeRect,
  resizeBox,
  resizeSelection,
  screenToLogical,
  selectionBounds,
  setElementBox,
  snapMove,
  snapResize,
  snapTargets,
  type DragMode,
  type Guide,
  type Handle,
  type Rect,
  type SnapOptions,
} from "./geometry";
import { clickSelect, marqueeMerge } from "./selection";
import { moveElementBy, setTableCell } from "./deckOps";

interface SlideCanvasProps {
  slide: Slide;
  width: number;
  /** Selected top-level element ids (last = primary). */
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  /** A single-element edit (in-place text, table cell). */
  onChange: (el: SlideElement) => void;
  /** A drag step over the selection. `history` is true for the first step
   *  of a gesture only, so a whole move/resize is one undo entry. */
  onChangeMany: (els: SlideElement[], opts: { history: boolean }) => void;
  /** Snapping while dragging (Alt held disables it). */
  snap?: SnapOptions;
  /** Draw the snapping grid. */
  showGrid?: boolean;
  onEditingText?: (editing: boolean) => void;
  onContext?: (x: number, y: number, elId: string | null) => void;
  /** Armed draw-to-insert tool (shape gallery); null = normal editing. */
  drawTool?: DrawTool | null;
  /** A draw gesture finished: insert this element. */
  onDrawn?: (el: SlideElement) => void;
  /** Filled with the active text editor while a text box is being edited. */
  textEditorRef?: React.MutableRefObject<TextEditorHandle | null>;
  /** A formatting shortcut inside the text editor (see TextEditor). */
  onTextKey?: (a: TextKeyAction, h: TextEditorHandle) => boolean;
  /** Text editing ended on element `id` with this selection. */
  onEditExit?: (id: string, sel: [number, number]) => void;
  /** Mouse up inside the text editor (paint format applies here). */
  onEditorMouseUp?: (h: TextEditorHandle) => void;
  /** Start editing a text box with a selection (bump `nonce` to re-request). */
  editRequest?: { id: string; sel: [number, number]; nonce: number } | null;
  /** Paint format is armed: clicking a text box applies it. */
  painting?: boolean;
  onPaint?: (el: SlideElement) => void;
  /** Ctrl/Cmd+click on a text link (outside text editing). */
  onFollowLink?: (url: string) => void;
}

type Drag =
  | {
      kind: "move" | "resize";
      mode: DragMode;
      starts: SlideElement[];
      box0: Rect;
      targets: Rect[];
      px: number;
      py: number;
      moved: boolean;
    }
  | {
      kind: "marquee";
      x0: number;
      y0: number;
      additive: boolean;
      prior: string[];
    }
  | { kind: "adjust"; el0: SlideElement; index: number; moved: boolean }
  | { kind: "endpoint"; el0: SlideElement; end: "start" | "end"; moved: boolean }
  | { kind: "draw"; x0: number; y0: number };

const SELECT_BLUE = "#4285f4";
const GUIDE_COLOR = "#e8398d";
const ADJUST_YELLOW = "#f9ce1d";

/** SlideCanvas renders the active slide for editing: elements are selectable
 *  (click, Shift/Ctrl+click, rubber-band), draggable and resizable as a
 *  selection with smart-guide/grid snapping, and text elements are editable
 *  in place. */
export function SlideCanvas({
  slide,
  width,
  selectedIds,
  onSelect,
  onChange,
  onChangeMany,
  snap,
  showGrid,
  onEditingText,
  onContext,
  drawTool,
  onDrawn,
  textEditorRef,
  onTextKey,
  onEditExit,
  onEditorMouseUp,
  editRequest,
  painting,
  onPaint,
  onFollowLink,
}: SlideCanvasProps) {
  const scale = canvasScale(width);
  const height = canvasHeight(width);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<{ id: string; sel?: [number, number] | "all" } | null>(null);
  const editingId = editing?.id ?? null;
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  // Connection sites shown while a connector end is dragged or drawn.
  const [sites, setSites] = useState<[number, number][]>([]);
  // Live preview of a draw-to-insert gesture.
  const [drawPreview, setDrawPreview] = useState<SlideElement | null>(null);
  const drag = useRef<Drag | null>(null);

  const selSet = new Set(selectedIds);
  const selectedEls = slide.elements.filter((e) => selSet.has(e.id));
  const multi = selectedEls.length > 1;
  const selBox = multi ? selectionBounds(selectedEls) : null;
  const anyLocked = selectedEls.some((e) => e.locked);

  function toLogical(e: { clientX: number; clientY: number }) {
    const r = rootRef.current?.getBoundingClientRect();
    return {
      x: (e.clientX - (r?.left ?? 0)) / scale,
      y: (e.clientY - (r?.top ?? 0)) / scale,
    };
  }

  function beginEdit(id: string, sel?: [number, number] | "all") {
    setEditing({ id, sel });
    onEditingText?.(true);
  }
  function endEdit() {
    setEditing(null);
    onEditingText?.(false);
  }
  // Re-enter a text box with a selection (after a menu/dialog applied a
  // format to the saved selection).
  useEffect(() => {
    if (editRequest && slide.elements.some((e) => e.id === editRequest.id && e.type === "text"))
      beginEdit(editRequest.id, editRequest.sel);
  }, [editRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  function startDrag(e: React.PointerEvent, mode: DragMode, ids: string[]) {
    const starts = slide.elements.filter((x) => ids.includes(x.id) && !x.locked);
    if (!starts.length) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = {
      kind: mode === "move" ? "move" : "resize",
      mode,
      starts: starts.map((s) => ({ ...s })),
      box0: selectionBounds(starts)!,
      targets: snapTargets(slide.elements, new Set(ids)),
      px: e.clientX,
      py: e.clientY,
      moved: false,
    };
  }

  function onElementPointerDown(e: React.PointerEvent, el: SlideElement) {
    if (editingId === el.id || e.button !== 0) return;
    e.stopPropagation();
    const link = (e.target as HTMLElement).closest?.("[data-link]");
    if (link && (e.ctrlKey || e.metaKey) && onFollowLink) {
      onFollowLink(link.getAttribute("data-link") || "");
      return;
    }
    if (painting && el.type === "text" && onPaint) onPaint(el);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const next = clickSelect(selectedIds, el.id, additive);
    onSelect(next);
    if (!next.includes(el.id)) return; // toggled off: nothing to drag
    startDrag(e, "move", next);
  }

  function onHandlePointerDown(e: React.PointerEvent, h: Handle) {
    if (e.button !== 0) return;
    e.stopPropagation();
    startDrag(e, h, selectedIds);
  }

  function onBackgroundPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const p = toLogical(e);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind: "marquee", x0: p.x, y0: p.y, additive, prior: selectedIds };
    if (!additive) onSelect([]);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "marquee") {
      const p = toLogical(e);
      setMarquee(normalizeRect(d.x0, d.y0, p.x, p.y));
      return;
    }
    if (d.kind === "draw") {
      const p = toLogical(e);
      if (!drawTool) return;
      if (drawTool.kind === "connector") setSites(sitesNear(p.x, p.y));
      setDrawPreview(
        drawnElement(drawTool, d.x0, d.y0, p.x, p.y, {
          elements: slide.elements,
          shift: e.shiftKey,
          glue: glueDist,
        }),
      );
      return;
    }
    if (d.kind === "adjust") {
      const p = toLogical(e);
      onChangeMany([dragAdjustHandle(d.el0, d.index, p.x, p.y)], { history: !d.moved });
      d.moved = true;
      return;
    }
    if (d.kind === "endpoint") {
      const p = toLogical(e);
      const hit = e.altKey ? null : nearestSite(slide.elements, p.x, p.y, d.el0.id, glueDist);
      const at: [number, number] = hit ? [hit.x, hit.y] : [p.x, p.y];
      const { start, end } = connectorEnds(d.el0);
      const next =
        d.end === "start"
          ? setConnectorEnds(d.el0, at, end, { stCxn: hit ? hit.ref : null })
          : setConnectorEnds(d.el0, start, at, { endCxn: hit ? hit.ref : null });
      setSites(sitesNear(p.x, p.y, d.el0.id));
      onChangeMany([next], { history: !d.moved });
      d.moved = true;
      return;
    }
    let { dx, dy } = screenToLogical(e.clientX - d.px, e.clientY - d.py, scale);
    if (!d.moved && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    const snapOn = !!snap && (snap.guides || !!snap.grid) && !e.altKey;
    let els: SlideElement[];
    let g: Guide[] = [];
    if (d.kind === "move") {
      if (snapOn) {
        const box = { ...d.box0, x: d.box0.x + dx, y: d.box0.y + dy };
        const s = snapMove(box, d.targets, snap!);
        dx += s.dx;
        dy += s.dy;
        g = s.guides;
      }
      // Keep stored positions tidy (0.01 px), so a snapped edge lands exactly.
      dx = Math.round(dx * 100) / 100;
      dy = Math.round(dy * 100) / 100;
      els = d.starts.map((s) => moveElementBy(s, dx, dy));
    } else if (d.starts.length === 1) {
      const s0 = d.starts[0];
      let next = dragElement(s0, d.mode, dx, dy);
      if (snapOn && s0.type !== "line" && !s0.rotation) {
        const r = snapResize(
          { x: next.x, y: next.y, w: next.w, h: next.h },
          d.mode as Handle,
          d.targets,
          snap!,
        );
        next = setElementBox(s0, r.box);
        g = r.guides;
      }
      els = [next];
    } else {
      let box = resizeBox(d.box0, d.mode as Handle, dx, dy);
      if (snapOn) {
        const r = snapResize(box, d.mode as Handle, d.targets, snap!);
        box = r.box;
        g = r.guides;
      }
      els = resizeSelection(d.starts, box);
    }
    setGuides(g);
    onChangeMany(els, { history: !d.moved });
    d.moved = true;
  }

  function onPointerUp(e?: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    setGuides([]);
    setSites([]);
    if (d?.kind === "draw") {
      setDrawPreview(null);
      if (!drawTool || !e) return;
      const p = toLogical(e);
      onDrawn?.(
        drawnElement(drawTool, d.x0, d.y0, p.x, p.y, {
          elements: slide.elements,
          shift: e.shiftKey,
          glue: glueDist,
        }),
      );
      return;
    }
    if (d?.kind === "marquee") {
      const rect = marquee;
      setMarquee(null);
      if (!rect || (rect.w < 3 && rect.h < 3)) return;
      const hits = marqueeSelect(slide.elements, rect);
      onSelect(marqueeMerge(d.prior, hits, d.additive));
    }
  }

  // Glue radius: 10 logical px, but at least ~12 screen px when zoomed out.
  const glueDist = Math.max(GLUE_DISTANCE, 12 / scale);
  /** Connection sites of the elements near (x, y). */
  function sitesNear(x: number, y: number, excludeId?: string): [number, number][] {
    const pad = 30;
    return slide.elements
      .filter(
        (el) =>
          el.id !== excludeId &&
          x >= el.x - pad &&
          x <= el.x + el.w + pad &&
          y >= el.y - pad &&
          y <= el.y + el.h + pad,
      )
      .flatMap(connectionSites);
  }

  function onDrawPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !drawTool) return;
    e.stopPropagation();
    const p = toLogical(e);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind: "draw", x0: p.x, y0: p.y };
  }

  function onAdjustPointerDown(e: React.PointerEvent, el: SlideElement, index: number) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind: "adjust", el0: { ...el }, index, moved: false };
  }

  function onEndpointPointerDown(e: React.PointerEvent, el: SlideElement, end: "start" | "end") {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind: "endpoint", el0: { ...el }, end, moved: false };
  }

  function editingSel(el: SlideElement): [number, number] | "all" | "end" {
    if (editing?.id === el.id && editing.sel) return editing.sel;
    return "end";
  }

  const handleSize = 10 / scale;
  const handleStyle = (h: Handle): React.CSSProperties => ({
    position: "absolute",
    width: handleSize,
    height: handleSize,
    background: "#fff",
    border: `${1.5 / scale}px solid ${SELECT_BLUE}`,
    borderRadius: "50%",
    boxSizing: "border-box",
    ...handlePosition(h),
    cursor: handleCursor(h),
  });

  return (
    <Box
      ref={rootRef}
      data-testid="slide-canvas"
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => onPointerUp()}
      onContextMenu={(e) => {
        if (onContext) {
          e.preventDefault();
          onContext(e.clientX, e.clientY, null);
        }
      }}
      sx={{
        position: "relative",
        width,
        height,
        cursor: painting ? "copy" : undefined,
        bgcolor: slide.background,
        boxShadow: "md",
        flexShrink: 0,
        userSelect: "none",
        touchAction: "none",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: CANVAS_W,
          height: CANVAS_H,
        }}
      >
        <style>{EDITOR_CSS}</style>
        {showGrid && (
          <div
            data-testid="snap-grid"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              backgroundImage: `linear-gradient(to right, rgba(0,0,0,0.08) ${1 / scale}px, transparent ${1 / scale}px), linear-gradient(to bottom, rgba(0,0,0,0.08) ${1 / scale}px, transparent ${1 / scale}px)`,
              backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
            }}
          />
        )}
        {slide.elements.map((el) => {
          const selected = selSet.has(el.id);
          const editing = el.id === editingId;
          const style = elementStyle(el);
          const single = selected && !multi && !editing && !el.locked;
          const isConnector = el.type === "connector";
          return (
            <div
              key={el.id}
              data-el-id={el.id}
              data-el-type={el.type}
              data-selected={selected ? "true" : undefined}
              style={{
                ...style,
                cursor: editing ? "text" : el.locked ? "default" : "move",
                outline:
                  selected && !(isConnector && single)
                    ? `${2 / scale}px ${el.locked ? "dashed" : "solid"} ${SELECT_BLUE}`
                    : "none",
                // A connector is clicked on its stroke, not its (often 0-high) box.
                ...(isConnector ? { pointerEvents: "none" as const } : {}),
              }}
              onPointerDown={(e) => onElementPointerDown(e, el)}
              onContextMenu={(e) => {
                if (onContext) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!selSet.has(el.id)) onSelect([el.id]);
                  onContext(e.clientX, e.clientY, el.id);
                }
              }}
              onDoubleClick={(e) => {
                if (el.type === "text") {
                  e.stopPropagation();
                  beginEdit(el.id);
                }
              }}
            >
              {el.type === "group" ? (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    pointerEvents: "none",
                  }}
                >
                  <GroupChildren el={el} />
                </div>
              ) : el.type === "image" ? (
                el.src ? (
                  <img
                    src={el.src}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      pointerEvents: "none",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      background: "#f1f3f4",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#9aa0a6",
                      fontSize: 12,
                    }}
                  >
                    Image
                  </div>
                )
              ) : el.type === "text" ? (
                editing ? (
                  <TextEditor
                    el={el}
                    initialSel={editingSel(el)}
                    handleRef={textEditorRef}
                    onCommit={(next) => onChange(next)}
                    onExit={(next, sel) => {
                      if (next) onChange(next);
                      endEdit();
                      onEditExit?.(el.id, sel);
                    }}
                    onTextKey={onTextKey}
                    onMouseUp={onEditorMouseUp}
                  />
                ) : (
                  <div style={{ width: "100%", pointerEvents: "none" }}>
                    <ShrinkFit on={el.autofit === "shrink"}>{renderSlideText(el)}</ShrinkFit>
                  </div>
                )
              ) : el.type === "shape" || isConnector ? (
                <ShapeSvg el={el} hit />
              ) : el.type === "table" ? (
                <SlideTable
                  el={el}
                  onCellChange={(r, c, v) => {
                    const t = el.table;
                    if (!t) return;
                    onChange({ ...el, table: setTableCell(t, r, c, v) });
                  }}
                />
              ) : null}

              {/* connector end handles (single selection) */}
              {single &&
                isConnector &&
                ([
                  ["start", 0, 0],
                  ["end", el.w, el.h],
                ] as const).map(([end, x, y]) => (
                  <div
                    key={end}
                    data-handle={`cxn-${end}`}
                    onPointerDown={(e) => onEndpointPointerDown(e, el, end)}
                    style={{
                      position: "absolute",
                      left: x - handleSize / 2,
                      top: y - handleSize / 2,
                      width: handleSize,
                      height: handleSize,
                      background: "#fff",
                      border: `${1.5 / scale}px solid ${SELECT_BLUE}`,
                      borderRadius: "50%",
                      boxSizing: "border-box",
                      cursor: "crosshair",
                      pointerEvents: "auto",
                    }}
                  />
                ))}

              {/* adjust handles: yellow diamonds (single selection) */}
              {single &&
                adjustHandles(el).map((h, i) => (
                  <div
                    key={`adj${i}`}
                    data-handle={`adj-${i}`}
                    onPointerDown={(e) => onAdjustPointerDown(e, el, i)}
                    style={{
                      position: "absolute",
                      left: h.x - handleSize / 2,
                      top: h.y - handleSize / 2,
                      width: handleSize,
                      height: handleSize,
                      background: ADJUST_YELLOW,
                      border: `${1 / scale}px solid #7a5c00`,
                      boxSizing: "border-box",
                      transform: "rotate(45deg) scale(0.85)",
                      cursor: "pointer",
                      pointerEvents: "auto",
                      zIndex: 2,
                    }}
                  />
                ))}

              {/* resize handles (single selection) */}
              {single &&
                !isConnector &&
                (el.type === "line" ? LINE_HANDLES : HANDLES).map((h) => (
                  <div
                    key={h}
                    data-handle={h}
                    onPointerDown={(e) => onHandlePointerDown(e, h)}
                    style={{
                      ...handleStyle(h),
                      ...(el.type === "line" ? { cursor: "ew-resize" } : {}),
                    }}
                  />
                ))}
            </div>
          );
        })}

        {/* multi-selection box with shared resize handles */}
        {selBox && (
          <div
            data-testid="selection-box"
            style={{
              position: "absolute",
              left: selBox.x,
              top: selBox.y,
              width: selBox.w,
              height: selBox.h,
              outline: `${1 / scale}px dashed ${SELECT_BLUE}`,
              pointerEvents: "none",
            }}
          >
            {!anyLocked &&
              HANDLES.map((h) => (
                <div
                  key={h}
                  data-handle={h}
                  onPointerDown={(e) => onHandlePointerDown(e, h)}
                  style={{ ...handleStyle(h), pointerEvents: "auto" }}
                />
              ))}
          </div>
        )}

        {/* smart guides */}
        {guides.map((g, i) => (
          <div
            key={i}
            data-testid="snap-guide"
            style={{
              position: "absolute",
              pointerEvents: "none",
              background: GUIDE_COLOR,
              ...(g.axis === "x"
                ? { left: g.pos - 0.5 / scale, top: g.from, width: 1 / scale, height: g.to - g.from }
                : { top: g.pos - 0.5 / scale, left: g.from, height: 1 / scale, width: g.to - g.from }),
            }}
          />
        ))}

        {/* connection sites while a connector end is dragged/drawn */}
        {sites.map(([x, y], i) => (
          <div
            key={`site${i}`}
            data-testid="cxn-site"
            style={{
              position: "absolute",
              left: x - 4 / scale,
              top: y - 4 / scale,
              width: 8 / scale,
              height: 8 / scale,
              borderRadius: "50%",
              background: "rgba(66,133,244,0.35)",
              border: `${1 / scale}px solid ${SELECT_BLUE}`,
              boxSizing: "border-box",
              pointerEvents: "none",
            }}
          />
        ))}

        {/* draw-to-insert preview */}
        {drawPreview && (
          <div
            style={{ ...elementStyle(drawPreview), opacity: 0.6, pointerEvents: "none" }}
          >
            <ShapeSvg el={drawPreview} />
          </div>
        )}

        {/* draw-to-insert: captures the next drag (Esc cancels upstream) */}
        {drawTool && (
          <div
            data-testid="draw-overlay"
            onPointerDown={onDrawPointerDown}
            style={{ position: "absolute", inset: 0, cursor: "crosshair", zIndex: 10 }}
          />
        )}

        {/* rubber-band marquee */}
        {marquee && (
          <div
            data-testid="marquee"
            style={{
              position: "absolute",
              left: marquee.x,
              top: marquee.y,
              width: marquee.w,
              height: marquee.h,
              background: "rgba(66,133,244,0.12)",
              border: `${1 / scale}px solid ${SELECT_BLUE}`,
              pointerEvents: "none",
            }}
          />
        )}
      </Box>
    </Box>
  );
}
