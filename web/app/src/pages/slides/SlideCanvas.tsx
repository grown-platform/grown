import { useRef, useState } from "react";
import { Box } from "@mui/joy";
import { CANVAS_W, CANVAS_H, type Slide, type SlideElement } from "./model";
import { elementStyle, SlideTable, renderSlideText } from "./SlideView";
import {
  HANDLES,
  LINE_HANDLES,
  canvasHeight,
  canvasScale,
  dragElement,
  handleCursor,
  handlePosition,
  screenToLogical,
  type DragMode,
} from "./geometry";
import { isSelected } from "./selection";
import { setTableCell } from "./deckOps";

interface SlideCanvasProps {
  slide: Slide;
  width: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (el: SlideElement) => void;
  onEditingText?: (editing: boolean) => void;
  onContext?: (x: number, y: number, elId: string | null) => void;
}

/** SlideCanvas renders the active slide for editing: elements are selectable,
 *  draggable, resizable (8 handles), and text elements are editable in place. */
export function SlideCanvas({
  slide,
  width,
  selectedId,
  onSelect,
  onChange,
  onEditingText,
  onContext,
}: SlideCanvasProps) {
  const scale = canvasScale(width);
  const height = canvasHeight(width);
  const [editingId, setEditingId] = useState<string | null>(null);
  const drag = useRef<null | {
    mode: DragMode;
    el: SlideElement;
    px: number;
    py: number;
  }>(null);

  function beginEdit(id: string) {
    setEditingId(id);
    onEditingText?.(true);
  }
  function endEdit() {
    setEditingId(null);
    onEditingText?.(false);
  }

  function onPointerDown(
    e: React.PointerEvent,
    el: SlideElement,
    mode: DragMode,
  ) {
    if (editingId === el.id) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    onSelect(el.id);
    drag.current = { mode, el: { ...el }, px: e.clientX, py: e.clientY };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const { dx, dy } = screenToLogical(e.clientX - d.px, e.clientY - d.py, scale);
    const next = dragElement(d.el, d.mode, dx, dy);
    onChange(next);
  }
  function onPointerUp() {
    drag.current = null;
  }

  return (
    <Box
      onPointerDown={() => onSelect(null)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
        bgcolor: slide.background,
        boxShadow: "md",
        flexShrink: 0,
        userSelect: "none",
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
        {slide.elements.map((el) => {
          const selected = isSelected(selectedId, el.id);
          const editing = el.id === editingId;
          const style = elementStyle(el);
          return (
            <div
              key={el.id}
              style={{
                ...style,
                cursor: editing ? "text" : "move",
                outline: selected ? "2px solid #4285f4" : "none",
              }}
              onPointerDown={(e) => onPointerDown(e, el, "move")}
              onContextMenu={(e) => {
                if (onContext) {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect(el.id);
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
              {el.type === "image" ? (
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
                  <div
                    contentEditable
                    suppressContentEditableWarning
                    style={{
                      width: "100%",
                      height: "100%",
                      outline: "none",
                      cursor: "text",
                    }}
                    ref={(n) => {
                      if (n && n.innerText !== el.text)
                        n.innerText = el.text || "";
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      onChange({
                        ...el,
                        text: (e.target as HTMLElement).innerText,
                      });
                      endEdit();
                    }}
                  />
                ) : (
                  <span style={{ width: "100%", pointerEvents: "none" }}>
                    {renderSlideText(el)}
                  </span>
                )
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

              {/* resize handles */}
              {selected &&
                !editing &&
                el.type !== "line" &&
                HANDLES.map((h) => (
                  <div
                    key={h}
                    onPointerDown={(e) => onPointerDown(e, el, h)}
                    style={{
                      position: "absolute",
                      width: 10 / scale,
                      height: 10 / scale,
                      background: "#fff",
                      border: "1.5px solid #4285f4",
                      borderRadius: "50%",
                      ...handlePosition(h),
                      cursor: handleCursor(h),
                    }}
                  />
                ))}
              {selected &&
                !editing &&
                el.type === "line" &&
                LINE_HANDLES.map((h) => (
                  <div
                    key={h}
                    onPointerDown={(e) => onPointerDown(e, el, h)}
                    style={{
                      position: "absolute",
                      width: 10 / scale,
                      height: 10 / scale,
                      background: "#fff",
                      border: "1.5px solid #4285f4",
                      borderRadius: "50%",
                      ...handlePosition(h),
                      cursor: "ew-resize",
                    }}
                  />
                ))}
            </div>
          );
        })}
      </Box>
    </Box>
  );
}
