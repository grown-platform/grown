/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet models are loosely typed. */

// Threaded comments on cells (M12). Each sheet keeps its threads in
// `grownComments`; the model is pure (every function returns a new list) so
// the editor can persist a change with patchSheet (sheetDataTools.ts), which
// also relays it to collaborators.
//
// The shape mirrors Docs' comments (web/app/src/pages/docs/api.ts DocComment):
// a thread is a top-level comment with replies and a resolved flag; here the
// first entry of `comments` is the top-level comment and the rest are its
// replies, and the anchor is a cell instead of a text range.
//
// Structure ops (insert/delete/move rows or columns, cell shifts) move threads
// with their cells through formulaShift.ts (modelFields → shiftCommentThreads);
// a thread whose cell is deleted is dropped. The Go twin of applyStructureOp
// (internal/sheets/structure.go) does not shift grownComments yet.

export interface CellComment {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  /** ISO timestamp of creation. */
  ts: string;
  /** ISO timestamp of the last edit, when edited. */
  edited?: string;
}

export interface CommentThread {
  id: string;
  r: number;
  c: number;
  resolved?: boolean;
  comments: CellComment[];
}

export interface CommentAuthor {
  id: string;
  name: string;
}

let seq = 0;
function newId(prefix: string): string {
  const rnd = globalThis.crypto?.randomUUID?.();
  if (rnd) return `${prefix}-${rnd}`;
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

function isThread(t: any): t is CommentThread {
  return !!t && typeof t === "object" && typeof t.r === "number" && typeof t.c === "number" && Array.isArray(t.comments);
}

/** The threads stored on a sheet (tolerates a missing or malformed field). */
export function sheetComments(sheet: any): CommentThread[] {
  const list = sheet?.grownComments;
  return Array.isArray(list) ? list.filter(isThread).filter((t) => t.comments.length > 0) : [];
}

/** The thread anchored at (r, c), if any. */
export function threadAt(threads: CommentThread[], r: number, c: number): CommentThread | undefined {
  return threads.find((t) => t.r === r && t.c === c);
}

/** Threads in reading order (row, then column). */
export function sortedThreads(threads: CommentThread[]): CommentThread[] {
  return [...threads].sort((a, b) => a.r - b.r || a.c - b.c);
}

function makeComment(author: CommentAuthor, body: string, now: Date): CellComment {
  return { id: newId("cm"), authorId: author.id, authorName: author.name, body, ts: now.toISOString() };
}

/**
 * Starts a thread at (r, c). A cell holds one thread: commenting on a cell
 * that already has one adds a reply to it (and reopens it).
 */
export function addThread(
  threads: CommentThread[],
  r: number,
  c: number,
  body: string,
  author: CommentAuthor,
  now = new Date(),
): CommentThread[] {
  const text = body.trim();
  if (!text) return threads;
  const existing = threadAt(threads, r, c);
  if (existing) return replyTo(threads, existing.id, text, author, now).map((t) => (t.id === existing.id ? { ...t, resolved: false } : t));
  return [...threads, { id: newId("th"), r, c, comments: [makeComment(author, text, now)] }];
}

/** Adds a reply to a thread. */
export function replyTo(
  threads: CommentThread[],
  threadId: string,
  body: string,
  author: CommentAuthor,
  now = new Date(),
): CommentThread[] {
  const text = body.trim();
  if (!text) return threads;
  return threads.map((t) => (t.id === threadId ? { ...t, comments: [...t.comments, makeComment(author, text, now)] } : t));
}

/** Replaces a comment's text (only the comment's author may edit). */
export function editComment(
  threads: CommentThread[],
  threadId: string,
  commentId: string,
  body: string,
  userId: string,
  now = new Date(),
): CommentThread[] {
  const text = body.trim();
  if (!text) return threads;
  return threads.map((t) =>
    t.id !== threadId
      ? t
      : {
          ...t,
          comments: t.comments.map((cm) =>
            cm.id === commentId && cm.authorId === userId ? { ...cm, body: text, edited: now.toISOString() } : cm,
          ),
        },
  );
}

/**
 * Deletes a comment (only its author may). Deleting the first comment of a
 * thread deletes the whole thread, like deleting a Docs top-level comment.
 */
export function deleteComment(threads: CommentThread[], threadId: string, commentId: string, userId: string): CommentThread[] {
  const out: CommentThread[] = [];
  for (const t of threads) {
    if (t.id !== threadId) {
      out.push(t);
      continue;
    }
    const idx = t.comments.findIndex((cm) => cm.id === commentId);
    if (idx < 0 || t.comments[idx].authorId !== userId) {
      out.push(t);
      continue;
    }
    if (idx === 0) continue;
    out.push({ ...t, comments: t.comments.filter((_, i) => i !== idx) });
  }
  return out;
}

/** Removes a whole thread (e.g. Delete comment from the cell's menu). */
export function deleteThread(threads: CommentThread[], threadId: string): CommentThread[] {
  return threads.filter((t) => t.id !== threadId);
}

export function resolveThread(threads: CommentThread[], threadId: string): CommentThread[] {
  return threads.map((t) => (t.id === threadId ? { ...t, resolved: true } : t));
}

export function reopenThread(threads: CommentThread[], threadId: string): CommentThread[] {
  return threads.map((t) => (t.id === threadId ? { ...t, resolved: false } : t));
}

/**
 * Moves threads with their cells: `map` gives a cell's new position, or null
 * when the cell is deleted (its thread is dropped).
 */
export function shiftCommentThreads(
  threads: CommentThread[],
  map: (r: number, c: number) => [number, number] | null,
): CommentThread[] {
  const out: CommentThread[] = [];
  for (const t of Array.isArray(threads) ? threads : []) {
    if (!isThread(t)) continue;
    const p = map(t.r, t.c);
    if (!p) continue;
    out.push(p[0] === t.r && p[1] === t.c ? t : { ...t, r: p[0], c: p[1] });
  }
  return out;
}

/** Plain-text form of a thread for an xlsx note: "Author: text" per comment. */
export function threadNoteText(t: CommentThread): string {
  return t.comments.map((cm) => `${cm.authorName || "Unknown"}: ${cm.body}`).join("\n");
}

/** A one-comment thread for an imported note (xlsx `<comment>`). */
export function importedThread(r: number, c: number, text: string, author = "Imported"): CommentThread {
  return {
    id: newId("th"),
    r,
    c,
    comments: [{ id: newId("cm"), authorId: "", authorName: author || "Imported", body: text, ts: new Date(0).toISOString() }],
  };
}

// ---- grid marker --------------------------------------------------------------------------

/** Excel's comment indicator colour. */
export const COMMENT_MARKER_COLOR = "#d93025";
export const COMMENT_MARKER_SIZE = 6;

/** Cell bounds as FortuneSheet's afterRenderCell passes them. */
export interface CellBox {
  row: number;
  column: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/**
 * The corner triangle for a cell with an open thread (resolved threads show
 * none unless showResolved): three points, top-right corner inward.
 */
export function commentMarker(
  threads: CommentThread[],
  box: CellBox,
  opts: { showResolved?: boolean; size?: number } = {},
): { points: [number, number][]; color: string } | null {
  const t = threadAt(threads, box.row, box.column);
  if (!t || (t.resolved && !opts.showResolved)) return null;
  const w = box.endX - box.startX;
  const h = box.endY - box.startY;
  const s = Math.max(2, Math.min(opts.size ?? COMMENT_MARKER_SIZE, w, h));
  const x = box.endX;
  const y = box.startY;
  return {
    points: [
      [x - s, y],
      [x, y],
      [x, y + s],
    ],
    color: t.resolved ? "#9aa0a6" : COMMENT_MARKER_COLOR,
  };
}

/** Paints the marker; call from FortuneSheet's afterRenderCell hook. */
export function paintCommentMarker(
  threads: CommentThread[],
  box: CellBox,
  ctx: CanvasRenderingContext2D,
  opts: { showResolved?: boolean; size?: number } = {},
): boolean {
  const m = commentMarker(threads, box, opts);
  if (!m) return false;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(m.points[0][0], m.points[0][1]);
  ctx.lineTo(m.points[1][0], m.points[1][1]);
  ctx.lineTo(m.points[2][0], m.points[2][1]);
  ctx.closePath();
  ctx.fillStyle = m.color;
  ctx.fill();
  ctx.restore();
  return true;
}

/** A1 address of a thread's cell. */
export function threadAddress(t: { r: number; c: number }): string {
  let s = "";
  let n = t.c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `${s}${t.r + 1}`;
}
