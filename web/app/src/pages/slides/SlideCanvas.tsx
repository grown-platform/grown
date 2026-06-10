import { useRef, useState } from "react";
import { Box } from "@mui/joy";
import { CANVAS_W, CANVAS_H, type Slide, type SlideElement } from "./model";
import { elementStyle } from "./SlideView";

interface SlideCanvasProps {
  slide: Slide;
  width: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (el: SlideElement) => void;
  onEditingText?: (editing: boolean) => void;
  onContext?: (x: number, y: number, elId: string | null) => void;
}

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

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
  const scale = width / CANVAS_W;
  const height = width * (CANVAS_H / CANVAS_W);
  const [editingId, setEditingId] = useState<string | null>(null);
  const drag = useRef<null | {
    mode: "move" | Handle;
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
    mode: "move" | Handle,
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
    const dx = (e.clientX - d.px) / scale;
    const dy = (e.clientY - d.py) / scale;
    const s = d.el;
    let next: SlideElement = { ...s };
    if (d.mode === "move") {
      next.x = s.x + dx;
      next.y = s.y + dy;
    } else {
      let { x, y, w, h } = s;
      if (d.mode.includes("e")) w = Math.max(10, s.w + dx);
      if (d.mode.includes("s"))
        h = Math.max(s.type === "line" ? 0 : 10, s.h + dy);
      if (d.mode.includes("w")) {
        w = Math.max(10, s.w - dx);
        x = s.x + (s.w - w);
      }
      if (d.mode.includes("n")) {
        h = Math.max(10, s.h - dy);
        y = s.y + (s.h - h);
      }
      next = { ...s, x, y, w, h };
    }
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
          const selected = el.id === selectedId;
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
                    {el.text}
                  </span>
                )
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
                      ...handlePos(h),
                      cursor: handleCursor(h),
                    }}
                  />
                ))}
              {selected &&
                !editing &&
                el.type === "line" &&
                (["w", "e"] as Handle[]).map((h) => (
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
                      ...handlePos(h),
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

function handlePos(h: Handle): React.CSSProperties {
  const at = { c: "50%", s: "100%", e: "100%", n: "0%", w: "0%" };
  const t = h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%";
  const l = h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%";
  void at;
  return { top: t, left: l, transform: "translate(-50%, -50%)" };
}
function handleCursor(h: Handle): string {
  if (h === "n" || h === "s") return "ns-resize";
  if (h === "e" || h === "w") return "ew-resize";
  if (h === "ne" || h === "sw") return "nesw-resize";
  return "nwse-resize";
}
