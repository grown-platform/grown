/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet cells are loosely typed. */

// Superscript / subscript cells (Ctrl+. / Ctrl+,). FortuneSheet has no
// vertical text alignment, so the cell keeps Grown's `va` field (1 =
// superscript, 2 = subscript, like the OOXML vertAlign values) and the text is
// painted here from the beforeRenderCell hook: smaller and raised or lowered.

export const VA_SUPER = 1;
export const VA_SUB = 2;

/** The next `va` after toggling superscript or subscript. */
export function toggleScript(current: unknown, which: typeof VA_SUPER | typeof VA_SUB): number {
  return Number(current) === which ? 0 : which;
}

export interface ScriptCellInfo {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/** Paints a script cell; false when the cell is not one (FortuneSheet paints it). */
export function paintScriptCell(cell: any, info: ScriptCellInfo, ctx: CanvasRenderingContext2D, opts: { zoom?: number; gridlines?: boolean } = {}): boolean {
  const va = Number(cell?.va);
  if (va !== VA_SUPER && va !== VA_SUB) return false;
  const text = cell?.m ?? (cell?.v == null ? "" : String(cell.v));
  if (text === "") return false;
  const zoom = opts.zoom || 1;
  const w = info.endX - info.startX;
  const h = info.endY - info.startY;
  ctx.save();
  ctx.beginPath();
  ctx.rect(info.startX, info.startY, w, h);
  ctx.clip();
  ctx.fillStyle = cell?.bg || "#ffffff";
  ctx.fillRect(info.startX, info.startY, w, h);
  if (opts.gridlines !== false) {
    ctx.strokeStyle = "#dfdfdf";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(info.endX - 0.5, info.startY);
    ctx.lineTo(info.endX - 0.5, info.endY);
    ctx.moveTo(info.startX, info.endY - 0.5);
    ctx.lineTo(info.endX, info.endY - 0.5);
    ctx.stroke();
  }
  const base = (Number(cell?.fs) || 10) * (4 / 3); // pt → px
  const size = Math.max(6, Math.round(base * 0.65 * zoom));
  ctx.fillStyle = cell?.fc || "#000000";
  ctx.font = `${cell?.it ? "italic " : ""}${cell?.bl ? "bold " : ""}${size}px ${cell?.ff || "Arial"}, sans-serif`;
  const ht = String(cell?.ht ?? "1");
  ctx.textAlign = ht === "0" ? "center" : ht === "2" ? "right" : "left";
  const x = ht === "0" ? info.startX + w / 2 : ht === "2" ? info.endX - 3 * zoom : info.startX + 3 * zoom;
  ctx.textBaseline = va === VA_SUPER ? "top" : "bottom";
  const y = va === VA_SUPER ? info.startY + 1 * zoom : info.endY - 1 * zoom;
  ctx.fillText(text, x, y);
  const tw = ctx.measureText(text).width;
  const x0 = ctx.textAlign === "center" ? x - tw / 2 : ctx.textAlign === "right" ? x - tw : x;
  if (cell?.cl) {
    const ym = va === VA_SUPER ? y + size / 2 : y - size / 2;
    ctx.fillRect(x0, Math.round(ym), tw, Math.max(1, zoom));
  }
  if (cell?.un) {
    const yu = va === VA_SUPER ? y + size : y;
    ctx.fillRect(x0, Math.round(yu), tw, Math.max(1, zoom));
  }
  ctx.restore();
  return true;
}
