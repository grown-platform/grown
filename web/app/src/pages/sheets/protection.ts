/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet sheets are loosely typed. */

// Protected sheets and ranges. Stored per sheet as `grownProtection`:
//
//   { sheet: { users, by, except, allowFormat? } | null,
//     ranges: [{ id, name, ranges, users, by, description }] }
//
// Who may edit is an ACL, not a password: the workbook owner always may, and
// so may the user who set a protection and the users listed on it. A
// protected sheet locks every cell except the `except` ranges and cells whose
// format is unlocked (`lo: 0`, from xlsx). The same rules are enforced on the
// server (internal/sheets/protection.go) for saves and relayed ops; this module
// drives the editor so blocked edits are refused before they happen.

import type { CellRect } from "./cellRange";
import { normalizeRect, rectIntersection } from "./cellRange";
import { colToLetters } from "./cellValue";
import { MAX_COLS, MAX_ROWS, shiftRect, type StructureOp } from "./formulaShift";

export interface SheetProtection {
  /** Users (ids) who may still edit locked cells. */
  users: string[];
  /** Who protected the sheet. */
  by?: string;
  /** Ranges left editable ("Except certain cells"). */
  except: CellRect[];
  /** Formatting cells is allowed for everyone. */
  allowFormat?: boolean;
  description?: string;
}

export interface ProtectedRange {
  id: string;
  name: string;
  ranges: CellRect[];
  users: string[];
  by?: string;
  description?: string;
}

export interface ProtectionModel {
  sheet: SheetProtection | null;
  ranges: ProtectedRange[];
}

export interface EditContext {
  /** The user trying to edit. */
  user: string;
  /** The workbook owner (always allowed). */
  owner?: string;
}

export function emptyProtection(): ProtectionModel {
  return { sheet: null, ranges: [] };
}

export function sheetProtection(sheet: any): ProtectionModel {
  const p = sheet?.grownProtection;
  if (!p || typeof p !== "object") return emptyProtection();
  return {
    sheet: p.sheet && typeof p.sheet === "object" ? { users: [], except: [], ...p.sheet } : null,
    ranges: Array.isArray(p.ranges) ? p.ranges.filter((r: any) => r && Array.isArray(r.ranges)) : [],
  };
}

export function isProtected(model: ProtectionModel): boolean {
  return !!model.sheet || model.ranges.length > 0;
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `pr-${Date.now().toString(36)}-${seq.toString(36)}`;
}

// ---- names -----------------------------------------------------------------------------

/**
 * A protected range's title: starts with a letter or underscore and holds
 * letters, digits, underscores, dots and spaces (so "test _ 1" is fine, and
 * "1test" or "test!" are not).
 */
export function validRangeName(name: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_. ]*$/u.test(name) && name.trim() !== "";
}

/** The range as a formula reference, e.g. "=Sheet1!$B$2:$B$5". */
export function protectedRangeRef(sheetName: string, pr: Pick<ProtectedRange, "ranges">): string {
  const q = /^[A-Za-z_][\w.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
  const abs = (r: CellRect) => {
    const n = normalizeRect(r);
    const a = `$${colToLetters(n.c1)}$${n.r1 + 1}`;
    const b = `$${colToLetters(n.c2)}$${n.r2 + 1}`;
    return a === b ? a : `${a}:${b}`;
  };
  return "=" + pr.ranges.map((r) => `${q}!${abs(r)}`).join(",");
}

// ---- CRUD ------------------------------------------------------------------------------

export function addProtectedRange(
  model: ProtectionModel,
  init: { name: string; ranges: CellRect[]; users?: string[]; by?: string; description?: string },
): ProtectionModel {
  const pr: ProtectedRange = {
    id: newId(),
    name: init.name,
    ranges: init.ranges.map(normalizeRect),
    users: [...new Set(init.users ?? [])],
    by: init.by,
    description: init.description,
  };
  return { ...model, ranges: [...model.ranges, pr] };
}

export function changeProtectedRange(model: ProtectionModel, id: string, patch: Partial<Omit<ProtectedRange, "id">>): ProtectionModel {
  return {
    ...model,
    ranges: model.ranges.map((r) =>
      r.id === id ? { ...r, ...patch, ranges: (patch.ranges ?? r.ranges).map(normalizeRect) } : r,
    ),
  };
}

export function deleteProtectedRanges(model: ProtectionModel, ids: string[]): ProtectionModel {
  return { ...model, ranges: model.ranges.filter((r) => !ids.includes(r.id)) };
}

export function protectSheet(model: ProtectionModel, p: Partial<SheetProtection> & { by?: string }): ProtectionModel {
  return { ...model, sheet: { users: [], except: [], ...p } };
}

export function unprotectSheet(model: ProtectionModel): ProtectionModel {
  return { ...model, sheet: null };
}

// ---- checks ----------------------------------------------------------------------------

function listed(users: string[] | undefined, by: string | undefined, ctx: EditContext): boolean {
  if (ctx.owner && ctx.user === ctx.owner) return true;
  if (by && by === ctx.user) return true;
  return !!users?.includes(ctx.user);
}

function inRects(rects: CellRect[], r: number, c: number): boolean {
  return rects.some((x) => {
    const n = normalizeRect(x);
    return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
  });
}

/** Whether the user may change the protection item (owner, its author, or a listed editor). */
export function canManage(item: { users?: string[]; by?: string }, ctx: EditContext): boolean {
  return listed(item.users, item.by, ctx);
}

/**
 * Whether the user may change cell (r, c). `cellUnlocked` is true when the
 * cell's own format is unlocked (FortuneSheet `lo: 0`).
 */
export function canEditCell(model: ProtectionModel, r: number, c: number, ctx: EditContext, cellUnlocked = false): boolean {
  if (ctx.owner && ctx.user === ctx.owner) return true;
  for (const pr of model.ranges) {
    if (inRects(pr.ranges, r, c) && !listed(pr.users, pr.by, ctx)) return false;
  }
  const sp = model.sheet;
  if (sp && !cellUnlocked && !inRects(sp.except ?? [], r, c) && !listed(sp.users, sp.by, ctx)) return false;
  return true;
}

/** The first protected range (or the sheet) blocking an edit of `rect`, or null. */
export function blockingProtection(
  model: ProtectionModel,
  rect: CellRect,
  ctx: EditContext,
  isUnlocked: (r: number, c: number) => boolean = () => false,
): { kind: "range"; range: ProtectedRange } | { kind: "sheet" } | null {
  if (ctx.owner && ctx.user === ctx.owner) return null;
  const n = normalizeRect(rect);
  for (const pr of model.ranges) {
    if (listed(pr.users, pr.by, ctx)) continue;
    if (pr.ranges.some((x) => rectIntersection(normalizeRect(x), n))) return { kind: "range", range: pr };
  }
  const sp = model.sheet;
  if (sp && !listed(sp.users, sp.by, ctx)) {
    // Bounded scan: a huge selection is checked on its corners and the except ranges.
    const cells = (n.r2 - n.r1 + 1) * (n.c2 - n.c1 + 1);
    if (cells > 20000) return { kind: "sheet" };
    for (let r = n.r1; r <= n.r2; r++) {
      for (let c = n.c1; c <= n.c2; c++) {
        if (!isUnlocked(r, c) && !inRects(sp.except ?? [], r, c)) return { kind: "sheet" };
      }
    }
  }
  return null;
}

/** Whether a formatting change of `rect` is allowed (a protected sheet may allow formatting). */
export function canFormat(model: ProtectionModel, rect: CellRect, ctx: EditContext, isUnlocked?: (r: number, c: number) => boolean): boolean {
  const b = blockingProtection(model, rect, ctx, isUnlocked);
  if (!b) return true;
  return b.kind === "sheet" && !!model.sheet?.allowFormat;
}

/**
 * Whether a structure change (insert/delete/move rows, columns or cells) may
 * run: it must not cut through, delete or move cells of a range the user may
 * not edit. On a protected sheet a user without rights cannot change the
 * structure at all.
 */
export function canChangeStructure(model: ProtectionModel, op: StructureOp, ctx: EditContext): boolean {
  if (ctx.owner && ctx.user === ctx.owner) return true;
  if (model.sheet && !listed(model.sheet.users, model.sheet.by, ctx)) return false;
  for (const pr of model.ranges) {
    if (listed(pr.users, pr.by, ctx)) continue;
    for (const x of pr.ranges) {
      if (affects(normalizeRect(x), op)) return false;
    }
  }
  return true;
}

/**
 * Whether rows (axis "row") or columns at [from, to] may be resized, hidden,
 * shown or grouped: not when they cross a range the user may not edit, nor
 * on a protected sheet without rights.
 */
export function canChangeRowsCols(model: ProtectionModel, axis: "row" | "col", from: number, to: number, ctx: EditContext): boolean {
  if (ctx.owner && ctx.user === ctx.owner) return true;
  if (model.sheet && !listed(model.sheet.users, model.sheet.by, ctx)) return false;
  return !model.ranges.some(
    (pr) =>
      !listed(pr.users, pr.by, ctx) &&
      pr.ranges.some((x) => {
        const n = normalizeRect(x);
        const [lo, hi] = axis === "row" ? [n.r1, n.r2] : [n.c1, n.c2];
        return from <= hi && to >= lo;
      }),
  );
}

/** Whether cells may be moved from `from` to the block at `to` (both ends must be editable). */
export function canMoveCells(model: ProtectionModel, from: CellRect, to: { r: number; c: number }, ctx: EditContext): boolean {
  const src = normalizeRect(from);
  const dest = { r1: to.r, c1: to.c, r2: to.r + src.r2 - src.r1, c2: to.c + src.c2 - src.c1 };
  return !blockingProtection(model, src, ctx) && !blockingProtection(model, dest, ctx);
}

/** Whether `op` touches cells of `rect` (anything other than moving it whole along with its rows/columns). */
function affects(rect: CellRect, op: StructureOp): boolean {
  switch (op.kind) {
    case "insert": {
      const [lo, hi] = op.axis === "row" ? [rect.r1, rect.r2] : [rect.c1, rect.c2];
      const max = op.axis === "row" ? MAX_ROWS : MAX_COLS;
      // Inserting inside the range would split it; inserting so much before it
      // would push it off the sheet.
      return (op.index > lo && op.index <= hi) || (op.index <= lo && hi + op.count >= max);
    }
    case "delete": {
      const [lo, hi] = op.axis === "row" ? [rect.r1, rect.r2] : [rect.c1, rect.c2];
      return op.index <= hi && op.index + op.count - 1 >= lo;
    }
    case "move": {
      const [lo, hi] = op.axis === "row" ? [rect.r1, rect.r2] : [rect.c1, rect.c2];
      const a = op.index;
      const b = op.index + op.count - 1;
      const dest = op.to;
      return (a <= hi && b >= lo) || (dest > lo && dest <= hi);
    }
    case "insertCells":
    case "deleteCells": {
      const sel = normalizeRect(op.rect);
      const vertical = op.kind === "insertCells" ? op.shift === "down" : op.shift === "up";
      if (rectIntersection(sel, rect)) return true;
      // Cells that would be pushed into or pulled out of the range.
      if (vertical) return sel.c1 <= rect.c2 && sel.c2 >= rect.c1 && sel.r1 <= rect.r2 && !(sel.c1 <= rect.c1 && sel.c2 >= rect.c2);
      return sel.r1 <= rect.r2 && sel.r2 >= rect.r1 && sel.c1 <= rect.c2 && !(sel.r1 <= rect.r1 && sel.r2 >= rect.r2);
    }
  }
}

// ---- following structure changes ------------------------------------------------------

/** The model after a structure op on its sheet: ranges shift, shrink or are dropped. */
export function shiftProtection(model: ProtectionModel, op: StructureOp): ProtectionModel {
  const shiftAll = (rects: CellRect[]) => rects.map((r) => shiftRect(r, op)).filter((r): r is CellRect => r !== null);
  const ranges = model.ranges
    .map((pr) => ({ ...pr, ranges: shiftAll(pr.ranges) }))
    .filter((pr) => pr.ranges.length > 0);
  const sheet = model.sheet ? { ...model.sheet, except: shiftAll(model.sheet.except ?? []) } : null;
  return { sheet, ranges };
}

/**
 * Moving (or copying) a block of cells: ranges entirely inside the block go
 * with it; a copy leaves the original and adds a protected copy at the
 * destination.
 */
export function moveProtectedCells(model: ProtectionModel, from: CellRect, to: { r: number; c: number }, copy = false): ProtectionModel {
  const src = normalizeRect(from);
  const dr = to.r - src.r1;
  const dc = to.c - src.c1;
  const inside = (x: CellRect) => {
    const n = normalizeRect(x);
    return n.r1 >= src.r1 && n.r2 <= src.r2 && n.c1 >= src.c1 && n.c2 <= src.c2;
  };
  const moved = (x: CellRect) => {
    const n = normalizeRect(x);
    return { r1: n.r1 + dr, r2: n.r2 + dr, c1: n.c1 + dc, c2: n.c2 + dc };
  };
  const out: ProtectedRange[] = [];
  const copies: ProtectedRange[] = [];
  for (const pr of model.ranges) {
    if (!pr.ranges.every(inside)) {
      out.push(pr);
      continue;
    }
    if (copy) {
      out.push(pr);
      copies.push({ ...pr, id: newId(), ranges: pr.ranges.map(moved) });
    } else {
      out.push({ ...pr, ranges: pr.ranges.map(moved) });
    }
  }
  return { ...model, ranges: [...out, ...copies] };
}
