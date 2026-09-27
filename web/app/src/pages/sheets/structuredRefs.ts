// Structured references to Excel tables (Table1[Column], [@Col], …): the
// text side. Parsing mirrors internal/sheets/formula_tables.go (which
// evaluates them); this module rewrites and generates the text:
//
// - normalizeStructuredRefs: the edit form ([@Col], shown while editing and
//   stored in Grown cells) or the file form ([#This Row], written to xlsx),
//   as Excel shows and saves them.
// - renameTableInFormula / renameColumnInFormula / dropTableColumnsInFormula:
//   formulas follow a renamed table or column, and a deleted column or table
//   becomes #REF!.
// - tableSelectionString: the reference a range selection inside a table
//   inserts while a formula is being edited (Table1[Col], Table1[[#All],[A]:[B]]).
// - structuredToA1: Convert to range replaces references by A1 text.

import type { CellRect } from "./cellRange";

/** The part of a table a structured reference needs (see tables.ts). */
export interface TableShape {
  name: string;
  ref: CellRect; // header row, data rows, totals row
  headerRowCount: number; // 0 or 1
  totalsRowCount: number; // 0 or 1
  columns: { name: string }[];
}

export type Specifier = "#All" | "#Data" | "#Headers" | "#Totals" | "#This Row";

/** A parsed structured reference (the bracket content). */
export interface StructSpec {
  /** Row specifiers in the order written ("@" is "#This Row"). */
  specs: Specifier[];
  col1?: string;
  col2?: string;
  /** Written with "@" (edit form) rather than [#This Row]. */
  at?: boolean;
  /** Written as [] (empty brackets). */
  empty?: boolean;
}

/** One structured reference in a formula: [start, end) covers name + brackets. */
export interface StructToken {
  start: number;
  end: number;
  table: string; // "" = the table the formula's cell belongs to
  inner: string; // bracket content (outer brackets removed)
}

const SPECIFIERS: Record<string, Specifier> = {
  "#ALL": "#All",
  "#DATA": "#Data",
  "#HEADERS": "#Headers",
  "#TOTALS": "#Totals",
  "#THIS ROW": "#This Row",
};

const NAME_CHAR = /[\p{L}\p{M}\p{N}_.\\]/u;

/** Index just past the ']' closing the '[' at s[i] ("'" escapes); s.length when unclosed. */
export function scanBracket(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (ch === "'") {
      j++;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return j + 1;
  }
  return s.length;
}

/** Escapes a column name for use inside brackets (' # @ [ ] get a leading '). */
export function escapeColumn(name: string): string {
  return name.replace(/(['#@[\]])/g, "'$1");
}

export function unescapeColumn(s: string): string {
  return s.replace(/'(.)/g, "$1");
}

/** Every structured reference in a formula (outside string literals and quoted sheet names). */
export function structuredTokens(formula: string): StructToken[] {
  const out: StructToken[] = [];
  const s = formula;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      // Quoted sheet name ('My sheet'!A1).
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === "'") {
          if (s[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      i = j + 1;
      continue;
    }
    if (ch === "[") {
      // Name: the identifier run just before the bracket.
      let k = i;
      while (k > 0 && NAME_CHAR.test(s[k - 1])) k--;
      const end = scanBracket(s, i);
      const closed = s[end - 1] === "]" && end > i + 1;
      out.push({ start: k, end, table: s.slice(k, i), inner: s.slice(i + 1, closed ? end - 1 : end) });
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

function special(s: string): Specifier | undefined {
  return SPECIFIERS[s.trim().replace(/\s+/g, " ").toUpperCase()];
}

/** Parses the bracket content; null for text Excel refuses (unknown or clashing specifiers). */
export function parseStructSpec(inner: string): StructSpec | null {
  const s = inner.trim();
  if (s === "") return { specs: ["#Data"], empty: true };
  if (s[0] === "@") {
    const rest = s.slice(1).trim();
    const base: StructSpec = { specs: ["#This Row"], at: true };
    if (rest === "") return base;
    if (rest[0] === "[") return columnItems(base, rest);
    return { ...base, col1: unescapeColumn(rest) };
  }
  if (s[0] === "#") {
    const sp = special(s);
    return sp ? { specs: [sp] } : null;
  }
  if (s[0] === "[") return columnItems({ specs: [] }, s);
  return { specs: [], col1: unescapeColumn(s) };
}

function columnItems(base: StructSpec, s: string): StructSpec | null {
  const sp: StructSpec = { ...base, specs: [...base.specs] };
  let i = 0;
  let haveCols = false;
  while (i < s.length) {
    while (i < s.length && /[ ,;]/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] !== "[") return null;
    const end = scanBracket(s, i);
    if (s[end - 1] !== "]") return null;
    let item = s.slice(i + 1, end - 1);
    i = end;
    if (item.trim().startsWith("#")) {
      const x = special(item);
      if (haveCols || !x || sp.specs.includes(x)) return null;
      sp.specs.push(x);
      continue;
    }
    if (haveCols) return null;
    if (item.startsWith("@") && !sp.specs.includes("#This Row")) {
      sp.specs.push("#This Row");
      sp.at = true;
      item = item.slice(1);
    }
    haveCols = true;
    sp.col1 = unescapeColumn(item);
    let j = i;
    while (s[j] === " ") j++;
    if (s[j] === ":") {
      j++;
      while (s[j] === " ") j++;
      if (s[j] !== "[") return null;
      const e2 = scanBracket(s, j);
      if (s[e2 - 1] !== "]") return null;
      sp.col2 = unescapeColumn(s.slice(j + 1, e2 - 1));
      i = e2;
    }
  }
  return validSpecs(sp.specs) ? sp : null;
}

/** One specifier alone, #Headers + #Data, or #Data + #Totals (in either order). */
function validSpecs(specs: Specifier[]): boolean {
  if (specs.length <= 1) return true;
  if (specs.length !== 2) return false;
  const set = new Set(specs);
  return (set.has("#Headers") && set.has("#Data")) || (set.has("#Data") && set.has("#Totals"));
}

/** A column name that can follow "@" without brackets ([@Qty], but [@[Unit price]]). */
function plainColumn(name: string): boolean {
  return /^[\p{L}\p{N}_]+$/u.test(name);
}

/**
 * Renders a structured reference. "edit" is the form Excel shows while
 * editing ([@Col], [@]); "file" the saved form ([[#This Row],[Col]]).
 */
export function formatStructRef(table: string, sp: StructSpec, mode: "edit" | "file"): string {
  const cols = sp.col1 === undefined ? "" : sp.col2 === undefined ? `[${escapeColumn(sp.col1)}]` : `[${escapeColumn(sp.col1)}]:[${escapeColumn(sp.col2)}]`;
  const thisRow = sp.specs.length === 1 && sp.specs[0] === "#This Row";
  if (thisRow && mode === "edit") {
    if (sp.col1 === undefined) return `${table}[@]`;
    if (sp.col2 === undefined && plainColumn(sp.col1)) return `${table}[@${sp.col1}]`;
    return `${table}[@${cols}]`;
  }
  if (sp.empty && !cols) return `${table}[]`;
  if (sp.specs.length === 0) {
    if (sp.col2 === undefined && sp.col1 !== undefined) return `${table}[${escapeColumn(sp.col1)}]`;
    return `${table}[${cols}]`;
  }
  if (sp.specs.length === 1 && !cols) return `${table}[${sp.specs[0]}]`;
  return `${table}[${sp.specs.map((x) => `[${x}]`).join(",")}${cols ? "," + cols : ""}]`;
}

/**
 * Rewrites every structured reference in a formula to the edit or file form.
 * `host` (file form) qualifies references made inside a table ([@Qty] →
 * Table1[[#This Row],[Qty]]). References that do not parse are left alone.
 */
export function normalizeStructuredRefs(formula: string, mode: "edit" | "file", host?: string): string {
  return rewriteStructured(formula, (tok) => {
    const sp = parseStructSpec(tok.inner);
    if (!sp) return undefined;
    const table = tok.table || (mode === "file" && host ? host : "");
    return formatStructRef(table, sp, mode);
  });
}

/** True when every structured reference in the formula parses. */
export function structuredRefsValid(formula: string): boolean {
  return structuredTokens(formula).every((t) => parseStructSpec(t.inner) !== null);
}

/** Replaces structured-reference tokens: fn returns new text, or undefined to keep one. */
export function rewriteStructured(formula: string, fn: (tok: StructToken) => string | undefined): string {
  const toks = structuredTokens(formula);
  if (!toks.length) return formula;
  let out = "";
  let at = 0;
  for (const t of toks) {
    const next = fn(t);
    if (next === undefined) continue;
    out += formula.slice(at, t.start) + next;
    at = t.end;
  }
  return out + formula.slice(at);
}

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0 || a.toUpperCase() === b.toUpperCase();

/**
 * Bare identifiers equal to `name` (a table used as Table1), outside strings,
 * brackets and function calls: [start, end) offsets.
 */
function bareNameSpans(formula: string, name: string): [number, number][] {
  const spans: [number, number][] = [];
  const brackets = structuredTokens(formula);
  let i = 0;
  const s = formula;
  const inBracket = (p: number) => brackets.some((t) => p >= t.start && p < t.end);
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === q) {
          if (s[j + 1] === q) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      i = j + 1;
      continue;
    }
    if (NAME_CHAR.test(ch) && (i === 0 || !NAME_CHAR.test(s[i - 1]))) {
      let j = i;
      while (j < s.length && NAME_CHAR.test(s[j])) j++;
      const word = s.slice(i, j);
      const next = s[j];
      if (same(word, name) && next !== "(" && next !== "[" && next !== "!" && !inBracket(i) && s[i - 1] !== "$") spans.push([i, j]);
      i = j;
      continue;
    }
    i++;
  }
  return spans;
}

/** Formula text after a table is renamed (Table1[..] and a bare Table1). */
export function renameTableInFormula(formula: string, oldName: string, newName: string): string {
  let f = rewriteStructured(formula, (t) => (t.table && same(t.table, oldName) ? newName + formula.slice(t.start + t.table.length, t.end) : undefined));
  const spans = bareNameSpans(f, oldName);
  for (let k = spans.length - 1; k >= 0; k--) f = f.slice(0, spans[k][0]) + newName + f.slice(spans[k][1]);
  return f;
}

/**
 * Formula text after a column of `table` is renamed. `host` is the table the
 * formula's cell belongs to (for unqualified [@Col]). The reference keeps the
 * form it was written in.
 */
export function renameColumnInFormula(formula: string, table: string, oldName: string, newName: string, host?: string): string {
  return rewriteStructured(formula, (t) => {
    const owner = t.table || host || "";
    if (!owner || !same(owner, table)) return undefined;
    const sp = parseStructSpec(t.inner);
    if (!sp) return undefined;
    const hit = (c?: string) => c !== undefined && same(c, oldName);
    if (!hit(sp.col1) && !hit(sp.col2)) return undefined;
    const next: StructSpec = { ...sp, col1: hit(sp.col1) ? newName : sp.col1, col2: hit(sp.col2) ? newName : sp.col2 };
    return formatStructRef(t.table, next, sp.at || !sp.specs.includes("#This Row") ? "edit" : "file");
  });
}

/**
 * Formula text after columns of tables were deleted (or whole tables, with
 * columns "*"): references that point at them become #REF!.
 */
export function dropTableColumnsInFormula(formula: string, removed: Record<string, string[] | "*">, host?: string): string {
  const lookup = (name: string) => {
    for (const [k, v] of Object.entries(removed)) if (same(k, name)) return v;
    return undefined;
  };
  let f = rewriteStructured(formula, (t) => {
    const owner = t.table || host || "";
    const gone = owner ? lookup(owner) : undefined;
    if (!gone) return undefined;
    if (gone === "*") return "#REF!";
    const sp = parseStructSpec(t.inner);
    if (!sp) return undefined;
    const hit = (c?: string) => c !== undefined && gone.some((g) => same(g, c));
    return hit(sp.col1) || hit(sp.col2) ? "#REF!" : undefined;
  });
  for (const [name, cols] of Object.entries(removed)) {
    if (cols !== "*") continue;
    const spans = bareNameSpans(f, name);
    for (let k = spans.length - 1; k >= 0; k--) f = f.slice(0, spans[k][0]) + "#REF!" + f.slice(spans[k][1]);
  }
  return f;
}

// ---- resolving to cells ---------------------------------------------------------------

/** The cells a structured reference covers, or null (as the engine's #NAME?/#REF!). */
export function structRefRect(t: TableShape, sp: StructSpec, row?: number): CellRect | null {
  const hdr = t.headerRowCount ? 1 : 0;
  const tot = t.totalsRowCount ? 1 : 0;
  const d1 = t.ref.r1 + hdr;
  const d2 = t.ref.r2 - tot;
  const set = new Set(sp.specs);
  let r1 = d1;
  let r2 = d2;
  if (set.has("#All")) {
    r1 = t.ref.r1;
    r2 = t.ref.r2;
  } else if (set.has("#This Row")) {
    if (row === undefined || row < d1 || row > d2) return null;
    r1 = r2 = row;
  } else if (set.has("#Headers") && set.has("#Data")) r1 = t.ref.r1;
  else if (set.has("#Data") && set.has("#Totals")) r2 = t.ref.r2;
  else if (set.has("#Headers")) {
    if (!hdr) return null;
    r1 = r2 = t.ref.r1;
  } else if (set.has("#Totals")) {
    if (!tot) return null;
    r1 = r2 = t.ref.r2;
  }
  let c1 = t.ref.c1;
  let c2 = t.ref.c2;
  if (sp.col1 !== undefined) {
    const i1 = t.columns.findIndex((c) => same(c.name, sp.col1!));
    const i2 = sp.col2 === undefined ? i1 : t.columns.findIndex((c) => same(c.name, sp.col2!));
    if (i1 < 0 || i2 < 0) return null;
    c1 = t.ref.c1 + Math.min(i1, i2);
    c2 = t.ref.c1 + Math.max(i1, i2);
  }
  return { r1, c1, r2, c2 };
}

function colLetters(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Convert to range: structured references to `table` become A1 references
 * (absolute, like Excel; [@Col] becomes the cell in the formula's row).
 */
export function structuredToA1(formula: string, t: TableShape, cell?: { r: number; c: number }, host?: string): string {
  let f = rewriteStructured(formula, (tok) => {
    const owner = tok.table || host || "";
    if (!owner || !same(owner, t.name)) return undefined;
    const sp = parseStructSpec(tok.inner);
    const rc = sp && structRefRect(t, sp, cell?.r);
    if (!rc) return "#REF!";
    const one = (r: number, c: number) => (sp!.specs.includes("#This Row") ? `$${colLetters(c)}${r + 1}` : `$${colLetters(c)}$${r + 1}`);
    return rc.r1 === rc.r2 && rc.c1 === rc.c2 ? one(rc.r1, rc.c1) : `${one(rc.r1, rc.c1)}:${one(rc.r2, rc.c2)}`;
  });
  const hdr = t.headerRowCount ? 1 : 0;
  const data = `$${colLetters(t.ref.c1)}$${t.ref.r1 + hdr + 1}:$${colLetters(t.ref.c2)}$${t.ref.r2 - (t.totalsRowCount ? 1 : 0) + 1}`;
  const spans = bareNameSpans(f, t.name);
  for (let k = spans.length - 1; k >= 0; k--) f = f.slice(0, spans[k][0]) + data + f.slice(spans[k][1]);
  return f;
}

// ---- picking cells while editing a formula ---------------------------------------------

/**
 * The structured reference for a range selected (with the mouse or keys)
 * while a formula is edited in `active`, or null when the range is not a
 * whole part of the table (then A1 text is used). Columns: one → Table1[Col],
 * several → [[A]:[B]]; rows: the data → no specifier, the header → #Headers,
 * header + data → #All (no totals row) or [#Headers],[#Data], data + totals →
 * [#Data],[#Totals], everything → #All; one data row in the active cell's own
 * row → @.
 */
export function tableSelectionString(t: TableShape, active: { r: number; c: number }, sel: CellRect): string | null {
  const s = { r1: Math.min(sel.r1, sel.r2), r2: Math.max(sel.r1, sel.r2), c1: Math.min(sel.c1, sel.c2), c2: Math.max(sel.c1, sel.c2) };
  const ref = t.ref;
  if (s.c1 < ref.c1 || s.c2 > ref.c2 || s.r1 < ref.r1 || s.r2 > ref.r2) return null;
  const hdr = t.headerRowCount ? 1 : 0;
  const tot = t.totalsRowCount ? 1 : 0;
  const d1 = ref.r1 + hdr;
  const d2 = ref.r2 - tot;
  const allCols = s.c1 === ref.c1 && s.c2 === ref.c2;
  const cols: StructSpec = allCols
    ? { specs: [] }
    : s.c1 === s.c2
      ? { specs: [], col1: t.columns[s.c1 - ref.c1]?.name }
      : { specs: [], col1: t.columns[s.c1 - ref.c1]?.name, col2: t.columns[s.c2 - ref.c1]?.name };
  if (!allCols && (cols.col1 === undefined || (s.c1 !== s.c2 && cols.col2 === undefined))) return null;
  // One data row in the active cell's row: Table1[@…].
  if (s.r1 === s.r2 && s.r1 >= d1 && s.r1 <= d2 && active.r === s.r1) {
    return formatStructRef(t.name, { ...cols, specs: ["#This Row"], at: true }, "edit");
  }
  const has = { hdr: hdr && s.r1 === ref.r1, tot: tot && s.r2 === ref.r2 };
  const startsAtData = s.r1 === d1;
  const endsAtData = s.r2 === d2;
  let specs: Specifier[] | null = null;
  if (has.hdr && s.r2 === ref.r1) specs = ["#Headers"];
  else if (has.tot && s.r1 === ref.r2) specs = ["#Totals"];
  else if (has.hdr && has.tot) specs = ["#All"];
  else if (has.hdr && endsAtData) specs = tot ? ["#Headers", "#Data"] : ["#All"];
  else if (!hdr && s.r1 === ref.r1 && has.tot) specs = ["#All"];
  else if (startsAtData && has.tot) specs = ["#Data", "#Totals"];
  else if (startsAtData && endsAtData) specs = [];
  if (specs === null) return null;
  if (specs.length === 0 && allCols) return t.name;
  return formatStructRef(t.name, { ...cols, specs }, "edit");
}
