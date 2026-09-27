/* eslint-disable @typescript-eslint/no-explicit-any -- stored models are loosely typed JSON. */
/**
 * diff.ts — pure "what changed" helpers for version history. Each takes two
 * stored document blobs (the JSON strings the editors autosave) and reports
 * what differs, cheaply: cells for a workbook, slides for a deck, elements for
 * a whiteboard scene. Unparseable input counts as empty.
 */

function parse(json: string | null | undefined): any {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ---- Sheets ----

/** A sheet of a stored workbook, flattened to sparse cells keyed "r,c". */
export interface SheetCells {
  id: string;
  name: string;
  cells: Map<string, any>;
  rows: number;
  cols: number;
}

/** cellText is what a cell shows: its formatted text, raw value or formula. */
export function cellText(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v !== "object") return String(v);
  if (v.m !== undefined && v.m !== null && v.m !== "") return String(v.m);
  if (v.v !== undefined && v.v !== null) return String(v.v);
  if (v.ct?.s && Array.isArray(v.ct.s)) return v.ct.s.map((r: any) => r?.v ?? "").join("");
  if (v.f) return String(v.f);
  return "";
}

// A cell with no value, formula or formatting is the same as no cell.
function isBlank(v: any): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v !== "object") return v === "";
  return Object.keys(v).length === 0;
}

/** workbookSheets reads a stored FortuneSheet workbook (celldata or data). */
export function workbookSheets(json: string | null | undefined): SheetCells[] {
  const wb = parse(json);
  if (!Array.isArray(wb)) return [];
  return wb
    .filter((s: any) => s && typeof s === "object")
    .map((s: any, i: number) => {
      const cells = new Map<string, any>();
      let rows = 0;
      let cols = 0;
      const put = (r: number, c: number, v: any) => {
        if (isBlank(v)) return;
        cells.set(`${r},${c}`, v);
        rows = Math.max(rows, r + 1);
        cols = Math.max(cols, c + 1);
      };
      if (Array.isArray(s.celldata)) {
        for (const cell of s.celldata) {
          if (cell && Number.isInteger(cell.r) && Number.isInteger(cell.c)) put(cell.r, cell.c, cell.v);
        }
      } else if (Array.isArray(s.data)) {
        s.data.forEach((row: any, r: number) => {
          if (Array.isArray(row)) row.forEach((v: any, c: number) => put(r, c, v));
        });
      }
      return {
        id: String(s.id ?? s.index ?? i),
        name: String(s.name ?? `Sheet${i + 1}`),
        cells,
        rows,
        cols,
      };
    });
}

export interface WorkbookDiff {
  /** Cells added, removed or changed (value, formula or formatting). */
  cellsChanged: number;
  /** Changed cell keys ("r,c") per sheet id, in the newer workbook. */
  changed: Map<string, Set<string>>;
  sheetsAdded: string[];
  sheetsRemoved: string[];
  sheetsRenamed: Array<{ from: string; to: string }>;
}

/** diffWorkbooks compares an older and a newer stored workbook. */
export function diffWorkbooks(older: string | null, newer: string): WorkbookDiff {
  const a = workbookSheets(older);
  const b = workbookSheets(newer);
  const byId = new Map(a.map((s) => [s.id, s]));
  const out: WorkbookDiff = {
    cellsChanged: 0,
    changed: new Map(),
    sheetsAdded: [],
    sheetsRemoved: [],
    sheetsRenamed: [],
  };
  const seen = new Set<string>();
  for (const s of b) {
    const prev = byId.get(s.id);
    const keys = new Set<string>();
    if (!prev) {
      if (older !== null) out.sheetsAdded.push(s.name);
      s.cells.forEach((_, k) => keys.add(k));
    } else {
      seen.add(s.id);
      if (prev.name !== s.name) out.sheetsRenamed.push({ from: prev.name, to: s.name });
      s.cells.forEach((v, k) => {
        const pv = prev.cells.get(k);
        if (pv === undefined || JSON.stringify(pv) !== JSON.stringify(v)) keys.add(k);
      });
      prev.cells.forEach((_, k) => {
        if (!s.cells.has(k)) keys.add(k);
      });
    }
    if (keys.size) out.changed.set(s.id, keys);
    out.cellsChanged += keys.size;
  }
  for (const s of a) {
    if (!seen.has(s.id)) {
      out.sheetsRemoved.push(s.name);
      out.cellsChanged += s.cells.size;
    }
  }
  return out;
}

/** summarizeWorkbookDiff renders a WorkbookDiff as one short line. */
export function summarizeWorkbookDiff(d: WorkbookDiff): string {
  const parts: string[] = [];
  if (d.cellsChanged) parts.push(plural(d.cellsChanged, "cell") + " changed");
  if (d.sheetsAdded.length) parts.push(plural(d.sheetsAdded.length, "sheet") + " added");
  if (d.sheetsRemoved.length) parts.push(plural(d.sheetsRemoved.length, "sheet") + " removed");
  if (d.sheetsRenamed.length) parts.push(plural(d.sheetsRenamed.length, "sheet") + " renamed");
  return parts.length ? parts.join(", ") : "No cell changes";
}

// ---- Slides ----

export interface DeckDiff {
  added: number;
  removed: number;
  /** Ids (in the newer deck) of slides whose content changed. */
  changed: Set<string>;
  /** Ids of slides that were added. */
  addedIds: Set<string>;
  /** True when the surviving slides are in a different order. */
  reordered: boolean;
}

function deckSlides(json: string | null | undefined): any[] {
  const d = parse(json);
  return Array.isArray(d?.slides) ? d.slides.filter((s: any) => s && typeof s === "object") : [];
}

/** diffDecks compares an older and a newer stored deck, slide by slide id. */
export function diffDecks(older: string | null, newer: string): DeckDiff {
  const a = deckSlides(older);
  const b = deckSlides(newer);
  const prev = new Map(a.map((s, i) => [String(s.id ?? i), s]));
  const next = new Set(b.map((s, i) => String(s.id ?? i)));
  const out: DeckDiff = { added: 0, removed: 0, changed: new Set(), addedIds: new Set(), reordered: false };
  b.forEach((s, i) => {
    const id = String(s.id ?? i);
    const p = prev.get(id);
    if (!p) {
      if (older !== null) {
        out.added++;
        out.addedIds.add(id);
      }
    } else if (JSON.stringify(p) !== JSON.stringify(s)) {
      out.changed.add(id);
    }
  });
  for (const id of prev.keys()) if (!next.has(id)) out.removed++;
  const keptA = [...prev.keys()].filter((id) => next.has(id));
  const keptB = b.map((s, i) => String(s.id ?? i)).filter((id) => prev.has(id));
  out.reordered = keptA.join("\u0000") !== keptB.join("\u0000");
  return out;
}

export function summarizeDeckDiff(d: DeckDiff): string {
  const parts: string[] = [];
  if (d.changed.size) parts.push(plural(d.changed.size, "slide") + " changed");
  if (d.added) parts.push(plural(d.added, "slide") + " added");
  if (d.removed) parts.push(plural(d.removed, "slide") + " removed");
  if (d.reordered) parts.push("slides reordered");
  return parts.length ? parts.join(", ") : "No slide changes";
}

// ---- Whiteboards ----

export interface SceneDiff {
  added: number;
  removed: number;
  changed: number;
}

function sceneElements(json: string | null | undefined): Map<string, any> {
  const d = parse(json);
  const els: any[] = Array.isArray(d?.elements) ? d.elements : [];
  return new Map(els.filter((e) => e && e.id && !e.isDeleted).map((e) => [String(e.id), e]));
}

// Excalidraw bumps version/versionNonce/updated on every touch; compare the
// drawing itself.
function drawingOf(e: any): string {
  const { version, versionNonce, updated, seed, ...rest } = e; // eslint-disable-line @typescript-eslint/no-unused-vars
  return JSON.stringify(rest);
}

/** diffScenes compares two stored Excalidraw scenes element by element. */
export function diffScenes(older: string | null, newer: string): SceneDiff {
  const a = sceneElements(older);
  const b = sceneElements(newer);
  const out: SceneDiff = { added: 0, removed: 0, changed: 0 };
  b.forEach((e, id) => {
    const p = a.get(id);
    if (!p) out.added++;
    else if (drawingOf(p) !== drawingOf(e)) out.changed++;
  });
  a.forEach((_, id) => {
    if (!b.has(id)) out.removed++;
  });
  return out;
}

export function summarizeSceneDiff(d: SceneDiff): string {
  const parts: string[] = [];
  if (d.added) parts.push(plural(d.added, "element") + " added");
  if (d.changed) parts.push(plural(d.changed, "element") + " changed");
  if (d.removed) parts.push(plural(d.removed, "element") + " removed");
  return parts.length ? parts.join(", ") : "No drawing changes";
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** columnName turns a 0-based column index into A, B, …, Z, AA, … */
export function columnName(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
