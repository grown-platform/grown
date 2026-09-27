import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Box, IconButton, Tooltip } from "@mui/joy";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { ChartRenderer } from "./ChartRenderer";
import { buildChartInput, chartSheetId, type ChartAnchor, type ChartConfig } from "./chartData";
import { anchorAt, anchorRect, gridGeometry } from "./chartAnchor";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Charts drawn on the grid (M10): each anchored chart of the active sheet is
// an absolutely positioned box inside FortuneSheet's cell area, so it scrolls
// with the cells. Drag to move, drag the corner to resize, double-click (or
// the pencil) to edit, Delete to remove. Moves and resizes are saved as a new
// anchor (cell + offset), so row/column inserts carry the chart along.

// A tiny change feed: the editor calls chartsChanged() after grid edits so
// charts re-read their data without re-rendering the whole editor.
let version = 0;
const listeners = new Set<() => void>();
export function chartsChanged(): void {
  version++;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

interface ChartOverlayProps {
  getWb: () => any;
  charts: ChartConfig[];
  /** The editor's root (its .fortune-cell-area is the portal target). */
  container: HTMLElement | null;
  onChange: (cfg: ChartConfig) => void;
  onEdit: (cfg: ChartConfig) => void;
  onDelete: (id: string) => void;
}

interface Drag {
  id: string;
  mode: "move" | "resize";
  x0: number;
  y0: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function ChartOverlay({ getWb, charts, container, onChange, onEdit, onDelete }: ChartOverlayProps) {
  useSyncExternalStore(subscribe, () => version);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<(Drag & { dx: number; dy: number }) | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  // FortuneSheet mounts its cell area after the workbook loads (and again on a remount).
  useEffect(() => {
    if (!container) return;
    const find = () => {
      const el = container.querySelector<HTMLElement>(".fortune-cell-area");
      setTarget((cur) => (cur === el ? cur : el));
    };
    find();
    const mo = new MutationObserver(find);
    mo.observe(container, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [container]);

  // Clicking elsewhere drops the selection; Delete removes the selected chart.
  useEffect(() => {
    if (!selected) return;
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(`[data-chart-id="${selected}"]`)) setSelected(null);
    };
    const key = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && !(e.target as HTMLElement)?.closest?.("input,textarea,[contenteditable=true]")) {
        e.preventDefault();
        e.stopPropagation();
        onDelete(selected);
        setSelected(null);
      }
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [selected, onDelete]);

  const wb = getWb();
  let sheet: any = null;
  let sheets: any[] = [];
  try {
    sheets = wb?.getAllSheets?.() ?? [];
    const cur = wb?.getSheet?.();
    sheet = sheets.find((s) => s?.id === cur?.id) ?? cur;
  } catch {
    /* not mounted yet */
  }
  const g = gridGeometry(sheet);

  // Global mouse tracking while dragging.
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setDrag({ ...d, dx: e.clientX - d.x0, dy: e.clientY - d.y0 });
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const cfg = charts.find((c) => c.id === d.id);
      if (!cfg?.anchor || (Math.abs(d.dx) < 2 && Math.abs(d.dy) < 2)) return;
      const box =
        d.mode === "move"
          ? { left: d.left + d.dx, top: d.top + d.dy, width: d.width, height: d.height }
          : { left: d.left, top: d.top, width: Math.max(160, d.width + d.dx), height: Math.max(110, d.height + d.dy) };
      const next: ChartAnchor = anchorAt(box.left, box.top, box.width / g.zoom, box.height / g.zoom, g);
      onChange({ ...cfg, anchor: next });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target || !sheet) return null;
  const curId = String(sheet.id ?? "");
  const mine = charts.filter((c) => c.anchor && chartSheetId(c, sheets) === curId);
  if (!mine.length) return null;

  return createPortal(
    <>
      {mine.map((cfg) => {
        const a = cfg.anchor as ChartAnchor;
        let box = anchorRect(a, g);
        if (drag?.id === cfg.id) {
          box =
            drag.mode === "move"
              ? { ...box, left: drag.left + drag.dx, top: drag.top + drag.dy }
              : { ...box, width: Math.max(160, drag.width + drag.dx), height: Math.max(110, drag.height + drag.dy) };
        }
        const input = buildChartInput(wb, cfg);
        const isSel = selected === cfg.id;
        const start = (mode: Drag["mode"]) => (e: React.MouseEvent) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          setSelected(cfg.id);
          setDrag({ id: cfg.id, mode, x0: e.clientX, y0: e.clientY, left: box.left, top: box.top, width: box.width, height: box.height, dx: 0, dy: 0 });
        };
        return (
          <Box
            key={cfg.id}
            data-chart-id={cfg.id}
            data-testid="grid-chart"
            onMouseDown={start("move")}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onEdit(cfg);
            }}
            onContextMenu={(e) => e.stopPropagation()}
            sx={{
              position: "absolute",
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              zIndex: isSel ? 120 : 110,
              bgcolor: "#fff",
              border: "1px solid",
              borderColor: isSel ? "#1a73e8" : "#d0d0d0",
              boxShadow: isSel ? "0 0 0 1px #1a73e8" : "0 1px 2px rgba(0,0,0,.08)",
              cursor: drag?.id === cfg.id && drag.mode === "move" ? "grabbing" : "default",
              userSelect: "none",
              overflow: "hidden",
            }}
          >
            <div style={{ transform: `scale(${g.zoom})`, transformOrigin: "0 0", width: box.width / g.zoom, height: box.height / g.zoom, pointerEvents: drag ? "none" : undefined }}>
              <ChartRenderer config={cfg} input={input} width={Math.max(160, box.width / g.zoom)} height={Math.max(110, box.height / g.zoom)} />
            </div>
            {isSel && (
              <>
                <Box sx={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 0.5, bgcolor: "rgba(255,255,255,.92)", borderRadius: "sm" }}>
                  <Tooltip title="Edit chart" size="sm">
                    <IconButton size="sm" variant="plain" aria-label="Edit chart" onMouseDown={(e) => e.stopPropagation()} onClick={() => onEdit(cfg)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete chart" size="sm">
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="danger"
                      aria-label="Delete chart"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        onDelete(cfg.id);
                        setSelected(null);
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Box
                  aria-label="Resize chart"
                  onMouseDown={start("resize")}
                  sx={{ position: "absolute", right: 0, bottom: 0, width: 12, height: 12, cursor: "nwse-resize", bgcolor: "#1a73e8", borderTopLeftRadius: 3 }}
                />
              </>
            )}
          </Box>
        );
      })}
    </>,
    target,
  );
}
