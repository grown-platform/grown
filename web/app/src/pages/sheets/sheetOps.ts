/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet cell model is loosely typed. */

// Pure, framework-free helpers backing the Sheets Data menu (sort / filter /
// find-replace / randomize). Kept separate from the React/FortuneSheet glue so
// they can be unit-tested in isolation (see sheetOps.test.ts). Everything here
// operates on FortuneSheet "cell objects" ({ v, m, ct, bl, ... } | null) so that
// reordering rows preserves per-cell formatting, formulas and number formats.

export type Cell = Record<string, any> | null;
export type CellGrid = Cell[][];

/** Display/comparison text for a cell: prefer the masked display value, fall back to raw. */
export function cellText(cell: Cell): string {
  if (cell == null) return "";
  const v = cell.m ?? cell.v;
  return v == null ? "" : String(v);
}

/** Natural comparison: numbers before text, numeric-aware, case-insensitive, blanks last. */
export function compareCells(a: Cell, b: Cell): number {
  const ta = cellText(a);
  const tb = cellText(b);
  const ea = ta === "";
  const eb = tb === "";
  // Blanks always sort to the bottom regardless of direction (matches Sheets).
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;
  const na = Number(ta);
  const nb = Number(tb);
  const aNum = ta.trim() !== "" && !Number.isNaN(na);
  const bNum = tb.trim() !== "" && !Number.isNaN(nb);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1; // numbers before text
  if (bNum) return 1;
  return ta.localeCompare(tb, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Sort a grid of rows by the value in `colInGrid` (column index relative to the
 * grid, i.e. 0 = first column of the range). Returns a NEW grid; original is
 * untouched. Blanks sink to the bottom; `asc=false` reverses non-blank order.
 */
export function sortGridRows(
  grid: CellGrid,
  colInGrid: number,
  asc: boolean,
): CellGrid {
  const dir = asc ? 1 : -1;
  return [...grid].sort((rowA, rowB) => {
    const a = rowA?.[colInGrid] ?? null;
    const b = rowB?.[colInGrid] ?? null;
    const ta = cellText(a);
    const tb = cellText(b);
    // Keep blanks at the bottom for both directions.
    if (ta === "" && tb === "") return 0;
    if (ta === "") return 1;
    if (tb === "") return -1;
    return dir * compareCells(a, b);
  });
}

/** Fisher-Yates shuffle of the grid's rows. Returns a NEW grid. `rng` defaults to Math.random. */
export function shuffleGridRows(
  grid: CellGrid,
  rng: () => number = Math.random,
): CellGrid {
  const out = [...grid];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface FindOptions {
  matchCase: boolean;
  matchEntireCell: boolean;
  useRegex: boolean;
}

/** Build a matcher predicate from the query + options. Invalid regex throws (caught by caller). */
export function buildMatcher(
  query: string,
  opts: FindOptions,
): (text: string) => boolean {
  if (opts.useRegex) {
    const re = new RegExp(query, opts.matchCase ? "g" : "gi");
    return (text: string) => {
      re.lastIndex = 0;
      const m = re.test(text);
      if (opts.matchEntireCell) {
        re.lastIndex = 0;
        const full = new RegExp(`^(?:${query})$`, opts.matchCase ? "" : "i");
        return full.test(text);
      }
      return m;
    };
  }
  const needle = opts.matchCase ? query : query.toLowerCase();
  return (text: string) => {
    const hay = opts.matchCase ? text : text.toLowerCase();
    return opts.matchEntireCell ? hay === needle : hay.includes(needle);
  };
}

/** Replace occurrences of `query` in `text`. For non-regex, replaces all (case per opts). */
export function replaceInText(
  text: string,
  query: string,
  replacement: string,
  opts: FindOptions,
): string {
  if (query === "") return text;
  if (opts.matchEntireCell) {
    // Whole-cell match → swap the entire value if it matches.
    return buildMatcher(query, opts)(text) ? replacement : text;
  }
  if (opts.useRegex) {
    const re = new RegExp(query, opts.matchCase ? "g" : "gi");
    return text.replace(re, replacement);
  }
  if (opts.matchCase) {
    return text.split(query).join(replacement);
  }
  // Case-insensitive literal replace: escape regex metachars in the needle.
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), replacement);
}

export interface CellRef {
  r: number;
  c: number;
}

/**
 * Scan a grid for cells matching the query. `origin` is the absolute (row,col) of
 * grid[0][0] so returned refs are absolute sheet coordinates.
 */
export function findMatches(
  grid: CellGrid,
  origin: CellRef,
  query: string,
  opts: FindOptions,
): CellRef[] {
  if (query === "") return [];
  const match = buildMatcher(query, opts);
  const hits: CellRef[] = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (match(cellText(row[c])))
        hits.push({ r: origin.r + r, c: origin.c + c });
    }
  }
  return hits;
}

/** Split a single string into fields using the given delimiter (literal, not regex). */
export function splitDelimited(text: string, delimiter: string): string[] {
  if (delimiter === "") return [text];
  return text.split(delimiter);
}

/** Detect the most likely delimiter in a sample of strings. Falls back to comma. */
export function detectDelimiter(samples: string[]): string {
  const candidates = [",", "\t", ";", "|", " "];
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const score = samples.reduce(
      (n, s) => n + (s.includes(d) ? s.split(d).length - 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}
