/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Icon-set conditional formatting. FortuneSheet renders color scales, data bars,
// and single-color rules natively but has NO icon-set support, so we overlay the
// icon onto each cell's DISPLAY string (`m`) while leaving the value (`v`)
// untouched so formulas keep working. Cells are bucketed into thirds of the
// range's min–max. The rules ride a `grownIconSets` field on the workbook (the
// same round-trip trick as charts/pivots) and are re-applied on every change.

export type IconStyle = "arrows" | "traffic" | "signs";

export interface IconSetRule {
  id: string;
  range: { r0: number; r1: number; c0: number; c1: number };
  style: IconStyle;
}

const ICONS: Record<IconStyle, [string, string, string]> = {
  arrows: ["🔻", "🔸", "🔺"],
  traffic: ["🔴", "🟡", "🟢"],
  signs: ["❌", "➖", "✅"],
};

export const ICON_STYLE_LABELS: Record<IconStyle, string> = {
  arrows: "Arrows  🔻 🔸 🔺",
  traffic: "Traffic lights  🔴 🟡 🟢",
  signs: "Signs  ❌ ➖ ✅",
};

// Every glyph we might prepend — used to strip a prior icon before re-applying.
const ALL_ICONS = new Set<string>(Object.values(ICONS).flat());

export function newIconSetId(): string {
  return `is-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function cellNum(cell: any): number {
  if (cell == null) return NaN;
  const raw = typeof cell === "object" ? (cell.v ?? cell.m) : cell;
  const n =
    typeof raw === "number"
      ? raw
      : parseFloat(String(raw ?? "").replace(/[, $%]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

// baseDisplay returns the cell's display with any leading icon we previously
// added stripped, so re-applying never stacks icons.
function baseDisplay(cell: any): string {
  if (cell == null) return "";
  let s = String(
    (typeof cell === "object" ? (cell.m ?? cell.v) : cell) ?? "",
  );
  const first = [...s][0];
  if (first && ALL_ICONS.has(first)) {
    s = s.slice(first.length).replace(/^\s+/, "");
  }
  return s;
}

function pickIcon(
  n: number,
  lo: number,
  hi: number,
  icons: [string, string, string],
): string {
  if (hi <= lo) return icons[1];
  const t1 = lo + (hi - lo) / 3;
  const t2 = lo + (2 * (hi - lo)) / 3;
  return n < t1 ? icons[0] : n < t2 ? icons[1] : icons[2];
}

// applyIconSets overlays icons onto the cell display. Idempotent: a cell already
// showing the correct icon is skipped, so it converges in one pass and is safe
// to call from onChange without looping.
export function applyIconSets(wb: any, rules: IconSetRule[]): void {
  if (!wb || !rules || rules.length === 0) return;
  const grid: any[][] = wb.getSheet?.()?.data ?? [];
  for (const rule of rules) {
    const icons = ICONS[rule.style] ?? ICONS.traffic;
    const { r0, r1, c0, c1 } = rule.range;
    const items: { r: number; c: number; n: number }[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const n = cellNum(grid[r]?.[c]);
        if (Number.isFinite(n)) items.push({ r, c, n });
      }
    }
    if (items.length === 0) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (const it of items) {
      lo = Math.min(lo, it.n);
      hi = Math.max(hi, it.n);
    }
    for (const it of items) {
      const cell = grid[it.r]?.[it.c];
      const targetM = `${pickIcon(it.n, lo, hi, icons)} ${baseDisplay(cell)}`;
      const curM = cell && typeof cell === "object" ? cell.m : undefined;
      if (curM === targetM) continue; // idempotent
      const merged =
        cell && typeof cell === "object"
          ? { ...cell, m: targetM }
          : { v: it.n, m: targetM };
      wb.setCellValuesByRange?.([[merged]], {
        row: [it.r, it.r],
        column: [it.c, it.c],
      });
    }
  }
}

// clearIconSets removes the icon overlay for the cells covered by the rules,
// letting FortuneSheet recompute each display from its value.
export function clearIconSets(wb: any, rules: IconSetRule[]): void {
  if (!wb || !rules) return;
  const grid: any[][] = wb.getSheet?.()?.data ?? [];
  for (const rule of rules) {
    const { r0, r1, c0, c1 } = rule.range;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = grid[r]?.[c];
        if (!cell || typeof cell !== "object" || cell.m == null) continue;
        const first = [...String(cell.m)][0];
        if (!first || !ALL_ICONS.has(first)) continue;
        const merged = { ...cell };
        delete merged.m;
        wb.setCellValuesByRange?.([[merged]], {
          row: [r, r],
          column: [c, c],
        });
      }
    }
  }
}

// rangeFromSelection reads the active selection as an icon-set range.
export function rangeFromSelection(
  wb: any,
): { r0: number; r1: number; c0: number; c1: number } | null {
  const s = wb?.getSelection?.();
  const sel = Array.isArray(s) ? s[0] : s;
  if (!sel) return null;
  return { r0: sel.row[0], r1: sel.row[1], c0: sel.column[0], c1: sel.column[1] };
}
