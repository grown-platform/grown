/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet's API is loosely typed. */

// Editor glue for number formats: the Format ▸ Number presets, applying a
// format to the selection, and reading typed input with numberFormat.ts.
//
// FortuneSheet paints a cell's display text `m`, and computes it with its own
// formatter when a format is set or a value typed. That formatter knows fewer
// codes (accounting `_(`/`*` padding, elapsed time, fractions, conditions), so
// after each of those events the editor writes `m` from numberFormat.ts.

import { formatKind, formatValue, parseInput } from "./numberFormat";

export interface NumberFormatPreset {
  id: string;
  label: string;
  fa: string;
}

// Menu order follows Google Sheets' Format ▸ Number.
export const NUMBER_FORMAT_PRESETS: NumberFormatPreset[] = [
  { id: "automatic", label: "Automatic", fa: "General" },
  { id: "text", label: "Plain text", fa: "@" },
  { id: "number", label: "Number", fa: "#,##0.00" },
  { id: "percent", label: "Percent", fa: "0.00%" },
  { id: "scientific", label: "Scientific", fa: "0.00E+00" },
  { id: "accounting", label: "Accounting", fa: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)' },
  { id: "financial", label: "Financial", fa: "#,##0.00;(#,##0.00)" },
  { id: "currency", label: "Currency", fa: "$#,##0.00" },
  { id: "currency-rounded", label: "Currency (rounded)", fa: "$#,##0" },
  { id: "date", label: "Date", fa: "yyyy-mm-dd" },
  { id: "time", label: "Time", fa: "h:mm:ss AM/PM" },
  { id: "datetime", label: "Date time", fa: "yyyy-mm-dd h:mm:ss" },
  { id: "duration", label: "Duration", fa: "[h]:mm:ss" },
  { id: "fraction", label: "Fraction", fa: "# ?/?" },
];

/** Codes offered in the Custom number format dialog. */
export const CUSTOM_FORMAT_SUGGESTIONS = [
  "0",
  "0.00",
  "#,##0",
  "#,##0.00",
  "#,##0.00;[Red](#,##0.00)",
  "0%",
  "0.00%",
  "0.00E+00",
  "$#,##0.00_);[Red]($#,##0.00)",
  '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)',
  "# ?/?",
  "# ??/??",
  "m/d/yyyy",
  "d-mmm-yy",
  "dddd, mmmm d, yyyy",
  "h:mm AM/PM",
  "h:mm:ss",
  "[h]:mm:ss",
  "mm:ss.0",
  '0.0,,"M"',
  '[>=1000000]0.0,,"M";[>=1000]0.0,"K";0',
  "@",
];

/** FortuneSheet's content type for a format: "g" General, "s" text, "d" date/time, "n" number. */
export function cellTypeFor(fa: string): "g" | "s" | "d" | "n" {
  const k = formatKind(fa);
  if (k === "general") return "g";
  if (k === "text") return "s";
  if (k === "date" || k === "time") return "d";
  return "n";
}

/** A cell's display text under a format, or null when the cell has no value. */
export function displayFor(cell: any, fa: string): string | null {
  const v = cell?.v;
  if (v == null || v === "" || typeof v === "object") return null;
  if (typeof v === "number" || typeof v === "boolean") return formatValue(v, fa);
  if (typeof v === "string") return formatValue(v, fa);
  return null;
}

/**
 * The current selection as plain, mutable copies (FortuneSheet hands out
 * frozen objects, and setSelection normalises the ranges it is given in place).
 */
export function selectionRanges(w: any): any[] {
  try {
    const s = w?.getSelection?.();
    if (!s) return [];
    return (Array.isArray(s) ? s : [s]).map((r: any) => ({
      row: [...r.row],
      column: [...r.column],
      ...(r.row_focus != null ? { row_focus: r.row_focus } : {}),
      ...(r.column_focus != null ? { column_focus: r.column_focus } : {}),
    }));
  } catch {
    return [];
  }
}

/** Rewrite `m` of the non-empty cells in a range from their value and format. */
export function refreshDisplay(w: any, range: any) {
  let rows: any[][];
  try {
    rows = w.getCellsByRange(range) ?? [];
  } catch {
    return;
  }
  const r0 = range.row[0];
  const c0 = range.column[0];
  rows.forEach((row, i) =>
    (row ?? []).forEach((cell: any, j: number) => {
      const fa = cell?.ct?.fa;
      if (!fa || cell?.f) return;
      const m = displayFor(cell, fa);
      if (m == null || m === cell.m) return;
      const r = r0 + i;
      const c = c0 + j;
      try {
        w.setCellFormatByRange("m", m, { row: [r, r], column: [c, c] });
      } catch {
        /* ignore */
      }
    }),
  );
}

/** Apply a number format to the current selection (or the given ranges). */
export function applyNumberFormat(w: any, fa: string, given?: any[]) {
  const ranges = given ?? selectionRanges(w);
  const ct = { fa, t: cellTypeFor(fa) };
  for (const range of ranges) {
    try {
      w.setCellFormatByRange("ct", ct, range);
    } catch {
      continue;
    }
    refreshDisplay(w, range);
  }
}

/** The format code of the selection's (or the given range's) focus cell. */
export function currentFormat(w: any, given?: any[]): { fa: string; value: unknown } {
  const range = (given ?? selectionRanges(w))[0];
  if (!range) return { fa: "General", value: undefined };
  const r = range.row_focus ?? range.row[0];
  const c = range.column_focus ?? range.column[0];
  try {
    const cell = w.getCellsByRange({ row: [r, r], column: [c, c] })?.[0]?.[0];
    return { fa: cell?.ct?.fa ?? "General", value: cell?.v };
  } catch {
    return { fa: "General", value: undefined };
  }
}

/**
 * Workbook hooks that read typed input with numberFormat.ts: "1,234",
 * "12.5%", "$5", "(3)", "1 1/2", "Jan 15, 2023", "14:30" become numbers
 * with a matching format (or the cell's own format when it fits).
 */
export function typedInputHooks(getWb: () => any) {
  const typed = new Map<string, string>();
  return {
    beforeUpdateCell: (r: number, c: number, value: any) => {
      if (typeof value === "string") typed.set(`${r},${c}`, value);
      return true;
    },
    afterUpdateCell: (r: number, c: number, oldValue: any, newValue: any) => {
      const key = `${r},${c}`;
      const raw = typed.get(key);
      typed.delete(key);
      const w = getWb();
      if (!w || raw == null || newValue?.f) return;
      if (raw.startsWith("=") || raw.startsWith("'")) return;
      const cellFormat = oldValue?.ct?.fa ?? "General";
      if (cellFormat === "@") return;
      const parsed = parseInput(raw, { cellFormat });
      try {
        if (parsed) {
          const m = formatValue(parsed.value, parsed.format);
          if (newValue?.v === parsed.value && newValue?.ct?.fa === parsed.format && newValue?.m === m) return;
          w.setCellValue(r, c, { v: parsed.value, ct: { fa: parsed.format, t: cellTypeFor(parsed.format) }, m });
        } else if (typeof newValue?.v === "number" && newValue?.ct?.fa) {
          const m = formatValue(newValue.v, newValue.ct.fa);
          if (m !== newValue.m) w.setCellFormatByRange("m", m, { row: [r, r], column: [c, c] });
        }
      } catch {
        /* keep FortuneSheet's own reading */
      }
    },
  };
}
