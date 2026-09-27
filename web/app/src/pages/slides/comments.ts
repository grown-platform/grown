// Slide comments (M10): threads anchored to a slide, optionally to an
// element on it, at a point in logical slide coordinates. Like Sheets'
// `grownComments`, the threads live in the document (`DeckDoc.comments`), so
// they autosave, travel over the collab hub, are captured by version history
// and round-trip through pptx. The thread shape mirrors Docs comments
// (author, body, replies, resolved).
//
// Each change is its own collab op, keyed so two people replying to one
// thread at once do not conflict: `comment` (create / edit the thread head;
// replies are kept), `commentResolve`, `commentRemove`, `commentReply` (add
// or edit one reply) and `commentReplyRemove`.

import type { DeckDoc, SlideElement } from "./model";
import { uid } from "./model";

export interface CommentReply {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  /** ISO time. */
  createdAt: string;
  editedAt?: string;
}

export interface SlideComment extends CommentReply {
  slideId: string;
  /** The element the comment is on, if any. */
  elId?: string;
  /** Marker position, logical slide coordinates. */
  x: number;
  y: number;
  resolved?: boolean;
  resolvedBy?: string;
  replies: CommentReply[];
  /** User ids @-mentioned in the thread head. */
  mentions?: string[];
}

export type CommentOp =
  | { t: "comment"; c: SlideComment }
  | { t: "commentResolve"; commentId: string; resolved: boolean; by?: string }
  | { t: "commentRemove"; commentId: string }
  | { t: "commentReply"; commentId: string; r: CommentReply }
  | { t: "commentReplyRemove"; commentId: string; replyId: string };

export const COMMENT_OPS = new Set([
  "comment",
  "commentResolve",
  "commentRemove",
  "commentReply",
  "commentReplyRemove",
]);

export function isCommentOp(m: { t?: unknown }): boolean {
  return typeof m.t === "string" && COMMENT_OPS.has(m.t);
}

/** Maximum comment body length (as Docs' maxCommentBytes). */
export const MAX_COMMENT = 8192;

function mapComment(doc: DeckDoc, id: string, fn: (c: SlideComment) => SlideComment): DeckDoc {
  const list = doc.comments ?? [];
  if (!list.some((c) => c.id === id)) return doc;
  return { ...doc, comments: list.map((c) => (c.id === id ? fn(c) : c)) };
}

/** applyCommentOp applies a comment op; anything else returns doc as is.
 *  Every op is idempotent. */
export function applyCommentOp(doc: DeckDoc, m: Record<string, unknown> & { t: string }): DeckDoc {
  const op = m as unknown as CommentOp;
  switch (op.t) {
    case "comment": {
      const c = op.c;
      if (!c || !c.id || !c.slideId) return doc;
      const list = doc.comments ?? [];
      const cur = list.find((x) => x.id === c.id);
      if (!cur) return { ...doc, comments: [...list, { ...c, replies: c.replies ?? [] }] };
      // The head changes; replies are their own ops.
      return mapComment(doc, c.id, () => ({ ...c, replies: cur.replies }));
    }
    case "commentResolve":
      return mapComment(doc, op.commentId, (c) => ({
        ...c,
        resolved: !!op.resolved,
        resolvedBy: op.resolved ? op.by : undefined,
      }));
    case "commentRemove": {
      const list = doc.comments ?? [];
      if (!list.some((c) => c.id === op.commentId)) return doc;
      return { ...doc, comments: list.filter((c) => c.id !== op.commentId) };
    }
    case "commentReply": {
      const r = op.r;
      if (!r || !r.id) return doc;
      return mapComment(doc, op.commentId, (c) => {
        const has = c.replies.some((x) => x.id === r.id);
        const replies = has ? c.replies.map((x) => (x.id === r.id ? r : x)) : [...c.replies, r];
        replies.sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : 0));
        return { ...c, replies };
      });
    }
    case "commentReplyRemove":
      return mapComment(doc, op.commentId, (c) => ({
        ...c,
        replies: c.replies.filter((x) => x.id !== op.replyId),
      }));
  }
  return doc;
}

export interface Author {
  id: string;
  name: string;
}

/** newComment builds a thread on a slide. With an element, the marker sits
 *  at the element's top-right corner; else at `at` (default top-left). */
export function newComment(
  author: Author,
  slideId: string,
  body: string,
  opts: { el?: SlideElement; at?: { x: number; y: number }; now?: Date; id?: string; mentions?: string[] } = {},
): SlideComment {
  const el = opts.el;
  const pos = el ? { x: el.x + el.w, y: el.y } : (opts.at ?? { x: 16, y: 16 });
  return {
    id: opts.id ?? uid(),
    slideId,
    elId: el?.id,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    authorId: author.id,
    authorName: author.name,
    body: body.slice(0, MAX_COMMENT),
    createdAt: (opts.now ?? new Date()).toISOString(),
    replies: [],
    ...(opts.mentions?.length ? { mentions: opts.mentions } : {}),
  };
}

export function newReply(author: Author, body: string, now = new Date(), id = uid()): CommentReply {
  return { id, authorId: author.id, authorName: author.name, body: body.slice(0, MAX_COMMENT), createdAt: now.toISOString() };
}

/** Where a comment's marker is drawn: on its element (following moves) when
 *  the element still exists, else at its stored point. */
export function markerPosition(c: SlideComment, elements: SlideElement[]): { x: number; y: number; orphan: boolean } {
  if (c.elId) {
    const el = elements.find((e) => e.id === c.elId);
    if (el) return { x: el.x + el.w, y: el.y, orphan: false };
    return { x: c.x, y: c.y, orphan: true };
  }
  return { x: c.x, y: c.y, orphan: false };
}

export type CommentFilter = "open" | "resolved" | "all";

/** commentsFor lists threads in deck order (slide, then creation time),
 *  optionally for one slide, filtered by state. */
export function commentsFor(doc: DeckDoc, filter: CommentFilter = "open", slideId?: string): SlideComment[] {
  const order = new Map(doc.slides.map((s, i) => [s.id, i]));
  return (doc.comments ?? [])
    .filter((c) => order.has(c.slideId))
    .filter((c) => !slideId || c.slideId === slideId)
    .filter((c) => (filter === "all" ? true : filter === "resolved" ? !!c.resolved : !c.resolved))
    .sort((a, b) => order.get(a.slideId)! - order.get(b.slideId)! || (a.createdAt < b.createdAt ? -1 : 1));
}

/** Open comment count per slide id. */
export function openCountBySlide(doc: DeckDoc): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of doc.comments ?? []) if (!c.resolved) m.set(c.slideId, (m.get(c.slideId) ?? 0) + 1);
  return m;
}

// ---- @mentions ----

export interface MentionCandidate {
  id: string;
  name: string;
  email?: string;
}

/** The @query being typed at the caret, if any ("@al" → "al"). */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([\w.\-]*)$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

/** Candidates whose name or email starts a word with the query. */
export function matchMentions(cands: MentionCandidate[], query: string, limit = 6): MentionCandidate[] {
  const q = query.toLowerCase();
  return cands
    .filter((c) => {
      if (!q) return true;
      const words = `${c.name} ${c.email ?? ""}`.toLowerCase().split(/[\s@.]+/);
      return words.some((w) => w.startsWith(q));
    })
    .slice(0, limit);
}

/** Insert "@Name " for a candidate over the typed query. */
export function insertMention(text: string, at: { start: number; query: string }, c: MentionCandidate): { text: string; caret: number } {
  const token = `@${c.name} `;
  const end = at.start + 1 + at.query.length;
  return { text: text.slice(0, at.start) + token + text.slice(end), caret: at.start + token.length };
}

/** The ids of candidates mentioned ("@Full Name") in a body. */
export function mentionedIds(body: string, cands: MentionCandidate[]): string[] {
  const out: string[] = [];
  for (const c of cands) {
    if (!c.name) continue;
    const re = new RegExp(`(^|\\s)@${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s.,;:!?])`);
    if (re.test(body) && !out.includes(c.id)) out.push(c.id);
  }
  return out;
}
