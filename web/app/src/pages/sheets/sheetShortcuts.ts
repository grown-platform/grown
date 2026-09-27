// Keyboard shortcuts of the Sheets editor (M12): one binding table drives both
// the key handler in SheetEditor and Help ▸ Keyboard shortcuts. Entries marked
// `native` are handled by FortuneSheet (or the browser's cell editor) and are
// listed for reference only.
//
// A combo is written the way it is shown: "Ctrl+Shift+1", "Alt+=", "F4",
// "Ctrl+PageDown". "Ctrl" matches Ctrl or ⌘. Keys match on the physical key
// (KeyboardEvent.code) for letters, digits and punctuation, so Shift+1 still
// matches "1" although the character typed is "!".

export type ShortcutContext = "grid" | "editor" | "any";

export interface ShortcutDef {
  id: string;
  group: string;
  label: string;
  /** Combos, the first one is the main binding. */
  keys: string[];
  /** Where the binding applies: the grid (no cell being edited), the cell editor, or both. */
  ctx: ShortcutContext;
  /** Handled by FortuneSheet or the browser; listed only. */
  native?: boolean;
}

export const SHORTCUT_GROUPS = [
  "Formatting",
  "Number formats",
  "Cells and editing",
  "Formulas",
  "Navigation",
  "Insert",
  "Data",
  "Application",
] as const;

export const SHEET_SHORTCUTS: ShortcutDef[] = [
  // Formatting
  { id: "bold", group: "Formatting", label: "Bold", keys: ["Ctrl+B"], ctx: "any" },
  { id: "italic", group: "Formatting", label: "Italic", keys: ["Ctrl+I"], ctx: "any" },
  { id: "underline", group: "Formatting", label: "Underline", keys: ["Ctrl+U"], ctx: "any" },
  { id: "strikethrough", group: "Formatting", label: "Strikethrough", keys: ["Alt+Shift+5", "Ctrl+5"], ctx: "any" },
  { id: "superscript", group: "Formatting", label: "Superscript", keys: ["Ctrl+."], ctx: "any" },
  { id: "subscript", group: "Formatting", label: "Subscript", keys: ["Ctrl+,"], ctx: "any" },
  { id: "fontBigger", group: "Formatting", label: "Increase font size", keys: ["Ctrl+]"], ctx: "grid" },
  { id: "fontSmaller", group: "Formatting", label: "Decrease font size", keys: ["Ctrl+["], ctx: "grid" },
  { id: "clearFormat", group: "Formatting", label: "Clear formatting", keys: ["Ctrl+\\"], ctx: "grid" },
  // Number formats
  { id: "fmtNumber", group: "Number formats", label: "Number (1,234.56)", keys: ["Ctrl+Shift+1"], ctx: "grid" },
  { id: "fmtTime", group: "Number formats", label: "Time (1:30:00 PM)", keys: ["Ctrl+Shift+2"], ctx: "grid" },
  { id: "fmtDate", group: "Number formats", label: "Date (9/26/2026)", keys: ["Ctrl+Shift+3"], ctx: "grid" },
  { id: "fmtCurrency", group: "Number formats", label: "Currency ($1,234.56)", keys: ["Ctrl+Shift+4"], ctx: "grid" },
  { id: "fmtPercent", group: "Number formats", label: "Percent (12.34%)", keys: ["Ctrl+Shift+5"], ctx: "grid" },
  { id: "fmtScientific", group: "Number formats", label: "Scientific (1.23E+03)", keys: ["Ctrl+Shift+6"], ctx: "grid" },
  { id: "fmtGeneral", group: "Number formats", label: "Automatic (General)", keys: ["Ctrl+Shift+`"], ctx: "grid" },
  // Cells and editing
  { id: "insertDate", group: "Cells and editing", label: "Insert today's date", keys: ["Ctrl+;"], ctx: "any" },
  { id: "insertTime", group: "Cells and editing", label: "Insert the current time", keys: ["Ctrl+Shift+;"], ctx: "any" },
  { id: "edit", group: "Cells and editing", label: "Edit the active cell", keys: ["F2"], ctx: "grid", native: true },
  { id: "newLine", group: "Cells and editing", label: "New line in a cell", keys: ["Alt+Enter"], ctx: "editor", native: true },
  { id: "saveDown", group: "Cells and editing", label: "Save and move down / up", keys: ["Enter", "Shift+Enter"], ctx: "editor", native: true },
  { id: "saveRight", group: "Cells and editing", label: "Save and move right / left", keys: ["Tab", "Shift+Tab"], ctx: "editor", native: true },
  { id: "cancel", group: "Cells and editing", label: "Cancel editing", keys: ["Escape"], ctx: "editor", native: true },
  { id: "dropdown", group: "Cells and editing", label: "Open the cell's dropdown list", keys: ["Alt+ArrowDown"], ctx: "grid" },
  { id: "clear", group: "Cells and editing", label: "Clear the selection", keys: ["Delete"], ctx: "grid", native: true },
  { id: "fillDown", group: "Cells and editing", label: "Fill down", keys: ["Ctrl+D"], ctx: "grid" },
  { id: "fillRight", group: "Cells and editing", label: "Fill right", keys: ["Ctrl+R"], ctx: "grid" },
  { id: "copy", group: "Cells and editing", label: "Copy / cut / paste", keys: ["Ctrl+C", "Ctrl+X", "Ctrl+V"], ctx: "grid", native: true },
  { id: "pasteValues", group: "Cells and editing", label: "Paste values only", keys: ["Ctrl+Shift+V"], ctx: "grid" },
  { id: "undo", group: "Cells and editing", label: "Undo / redo", keys: ["Ctrl+Z", "Ctrl+Y"], ctx: "any", native: true },
  { id: "selectAll", group: "Cells and editing", label: "Select all", keys: ["Ctrl+A"], ctx: "any", native: true },
  { id: "find", group: "Cells and editing", label: "Find and replace", keys: ["Ctrl+H"], ctx: "any" },
  // Formulas
  { id: "autoSum", group: "Formulas", label: "AutoSum", keys: ["Alt+="], ctx: "grid" },
  { id: "toggleRef", group: "Formulas", label: "Toggle absolute / relative reference", keys: ["F4"], ctx: "editor" },
  { id: "showFormulas", group: "Formulas", label: "Show formulas", keys: ["Ctrl+`"], ctx: "any" },
  { id: "recalcAll", group: "Formulas", label: "Recalculate the workbook", keys: ["F9"], ctx: "any" },
  { id: "recalcSheet", group: "Formulas", label: "Recalculate the active sheet", keys: ["Shift+F9"], ctx: "any" },
  { id: "insertFunction", group: "Formulas", label: "Insert function", keys: ["Shift+F3"], ctx: "grid" },
  // Navigation
  { id: "nextSheet", group: "Navigation", label: "Next sheet", keys: ["Ctrl+PageDown", "Ctrl+Shift+PageDown"], ctx: "grid" },
  { id: "prevSheet", group: "Navigation", label: "Previous sheet", keys: ["Ctrl+PageUp", "Ctrl+Shift+PageUp"], ctx: "grid" },
  { id: "moveEdge", group: "Navigation", label: "Move to the edge of the data", keys: ["Ctrl+Arrow"], ctx: "grid", native: true },
  { id: "selectEdge", group: "Navigation", label: "Extend the selection to the edge", keys: ["Ctrl+Shift+Arrow"], ctx: "grid", native: true },
  // Insert
  { id: "link", group: "Insert", label: "Insert link", keys: ["Ctrl+K"], ctx: "grid" },
  { id: "comment", group: "Insert", label: "Insert comment", keys: ["Ctrl+Alt+M"], ctx: "grid" },
  { id: "newSheet", group: "Insert", label: "Insert sheet", keys: ["Shift+F11"], ctx: "grid" },
  // Data
  { id: "refreshPivot", group: "Data", label: "Refresh pivot tables", keys: ["Alt+F5", "Ctrl+Alt+F5"], ctx: "grid" },
  // Application
  { id: "print", group: "Application", label: "Print", keys: ["Ctrl+P"], ctx: "any" },
  { id: "shortcuts", group: "Application", label: "Keyboard shortcuts", keys: ["Ctrl+/"], ctx: "any" },
];

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

// Physical key names for the characters used in combos.
const CODE_FOR: Record<string, string> = {
  ";": "Semicolon",
  "=": "Equal",
  "`": "Backquote",
  "/": "Slash",
  "\\": "Backslash",
  ".": "Period",
  ",": "Comma",
  "[": "BracketLeft",
  "]": "BracketRight",
  "-": "Minus",
};

/** Whether a key event is the combo (modifiers must match exactly). */
export function matchCombo(combo: string, e: KeyLike): boolean {
  // "Ctrl++" is not used; split on "+" but keep a trailing "+" key if any.
  const parts = combo.split("+");
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const ctrl = !!(e.ctrlKey || e.metaKey);
  if (mods.has("ctrl") !== ctrl) return false;
  if (mods.has("shift") !== !!e.shiftKey) return false;
  if (mods.has("alt") !== !!e.altKey) return false;
  if (key.length === 1) {
    if (/[A-Za-z]/.test(key)) return e.code === `Key${key.toUpperCase()}` || (!e.code && e.key.toLowerCase() === key.toLowerCase());
    if (/[0-9]/.test(key)) return e.code === `Digit${key}` || (!e.code && e.key === key);
    const code = CODE_FOR[key];
    return (code !== undefined && e.code === code) || e.key === key;
  }
  return e.key === key;
}

/** The binding a key event triggers in a context, if any (native bindings excluded). */
export function findShortcut(e: KeyLike, ctx: "grid" | "editor"): ShortcutDef | undefined {
  return SHEET_SHORTCUTS.find(
    (s) => !s.native && (s.ctx === "any" || s.ctx === ctx) && s.keys.some((k) => matchCombo(k, e)),
  );
}

/** Shows ⌘ instead of Ctrl on a Mac. */
export function displayCombo(combo: string, mac = false): string {
  return mac ? combo.replace(/Ctrl\+/g, "⌘").replace(/Alt\+/g, "⌥").replace(/Shift\+/g, "⇧") : combo;
}

// ---- F4: cycle a reference A1 → $A$1 → A$1 → $A1 → A1 -----------------------

const REF_RE = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/g;

/**
 * Cycles the absolute/relative form of the cell reference at (or just before)
 * the caret, or of every reference inside a selection [caret, selEnd). Returns
 * the new text and caret. A reference inside a string literal is left alone.
 */
export function toggleReference(text: string, caret: number, selEnd = caret): { text: string; caret: number; selEnd: number } {
  const cycle = (abs1: string, abs2: string): [string, string] => {
    if (!abs1 && !abs2) return ["$", "$"];
    if (abs1 && abs2) return ["", "$"];
    if (!abs1 && abs2) return ["$", ""];
    return ["", ""];
  };
  const quoted: [number, number][] = [];
  const q = /"(?:[^"]|"")*"?/g;
  let qm: RegExpExecArray | null;
  while ((qm = q.exec(text))) quoted.push([qm.index, qm.index + qm[0].length]);
  const inQuote = (i: number) => quoted.some(([a, b]) => i > a && i < b);
  const refs: { start: number; end: number; m: RegExpExecArray }[] = [];
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(text))) {
    const start = m.index;
    const prev = start > 0 ? text[start - 1] : "";
    // Part of a longer name (e.g. LOG10, Sheet1) or a sheet-qualified name's text.
    if (/[A-Za-z0-9_.]/.test(prev) || inQuote(start)) continue;
    refs.push({ start, end: start + m[0].length, m });
  }
  const targets =
    selEnd > caret
      ? refs.filter((r) => r.end > caret && r.start < selEnd)
      : refs.filter((r) => caret >= r.start && caret <= r.end).slice(-1);
  if (!targets.length) return { text, caret, selEnd };
  let out = "";
  let last = 0;
  let newCaret = caret;
  let newSelEnd = selEnd;
  for (const r of targets) {
    const [, a1, col, a2, row] = r.m;
    const [n1, n2] = cycle(a1, a2);
    const rep = `${n1}${col}${n2}${row}`;
    out += text.slice(last, r.start) + rep;
    const delta = rep.length - (r.end - r.start);
    if (selEnd > caret) newSelEnd += delta;
    else newCaret = out.length;
    last = r.end;
  }
  out += text.slice(last);
  if (selEnd > caret) return { text: out, caret, selEnd: newSelEnd };
  return { text: out, caret: newCaret, selEnd: newCaret };
}

// ---- Alt+=: the range AutoSum proposes ----------------------------------------

export type CellAt = (r: number, c: number) => unknown;

const isNumberCell = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));
const isBlank = (v: unknown) => v === undefined || v === null || v === "";

function colLetters(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const x = (n - 1) % 26;
    s = String.fromCharCode(65 + x) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export function a1(r: number, c: number): string {
  return `${colLetters(c)}${r + 1}`;
}

/**
 * The range AutoSum sums for the cell (r, c): the run of numbers directly
 * above it (blanks between the cell and the numbers are skipped, the run
 * stops at the first text or blank cell above the numbers); otherwise the run
 * to the left. "" when there is nothing to sum.
 */
export function autoSumRange(cell: CellAt, r: number, c: number): string {
  const run = (dr: number, dc: number): string => {
    let i = r + dr;
    let j = c + dc;
    while (i >= 0 && j >= 0 && isBlank(cell(i, j)) && Math.abs(i - r) + Math.abs(j - c) <= 1) {
      i += dr;
      j += dc;
    }
    if (i < 0 || j < 0 || !isNumberCell(cell(i, j))) return "";
    const endR = i;
    const endC = j;
    while (i + dr >= 0 && j + dc >= 0 && isNumberCell(cell(i + dr, j + dc))) {
      i += dr;
      j += dc;
    }
    return `${a1(i, j)}:${a1(endR, endC)}`;
  };
  return run(-1, 0) || run(0, -1);
}

// ---- Ctrl+] / Ctrl+[: font sizes ---------------------------------------------

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

/** The next size up or down the list from `size` (sizes between steps snap to the neighbour). */
export function stepFontSize(size: number, dir: 1 | -1): number {
  if (dir > 0) return FONT_SIZES.find((s) => s > size) ?? FONT_SIZES[FONT_SIZES.length - 1];
  for (let i = FONT_SIZES.length - 1; i >= 0; i--) if (FONT_SIZES[i] < size) return FONT_SIZES[i];
  return FONT_SIZES[0];
}

// ---- Ctrl+; / Ctrl+Shift+; ----------------------------------------------------

/** The spreadsheet serial of a local date-time (1900 system). */
export function serialOf(d: Date): number {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return utc / 86400000 + 25569;
}
export const DATE_SHORTCUT_FORMAT = "m/d/yyyy";
export const TIME_SHORTCUT_FORMAT = "h:mm:ss AM/PM";

/** Number formats the Ctrl+Shift+digit shortcuts apply. */
export const SHORTCUT_NUMBER_FORMATS: Record<string, string> = {
  fmtNumber: "#,##0.00",
  fmtTime: TIME_SHORTCUT_FORMAT,
  fmtDate: DATE_SHORTCUT_FORMAT,
  fmtCurrency: "$#,##0.00",
  fmtPercent: "0.00%",
  fmtScientific: "0.00E+00",
  fmtGeneral: "General",
};
