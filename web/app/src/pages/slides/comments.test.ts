import { describe, expect, it } from "vitest";
import type { DeckDoc, SlideElement } from "./model";
import {
  applyCommentOp,
  commentsFor,
  insertMention,
  markerPosition,
  matchMentions,
  mentionQuery,
  mentionedIds,
  newComment,
  newReply,
  openCountBySlide,
} from "./comments";

const ann = { id: "u1", name: "Ann Lee" };
const bob = { id: "u2", name: "Bob" };
const box = { id: "e1", type: "shape", x: 100, y: 50, w: 200, h: 80 } as SlideElement;
const deck = (): DeckDoc => ({
  slides: [
    { id: "s1", background: "#fff", elements: [box] },
    { id: "s2", background: "#fff", elements: [] },
  ],
});
const t0 = new Date("2026-09-27T10:00:00Z");
const t1 = new Date("2026-09-27T10:01:00Z");

describe("comment ops", () => {
  it("adds a thread anchored to an element's top-right corner", () => {
    const c = newComment(ann, "s1", "Fix this", { el: box, now: t0, id: "c1" });
    expect(c).toMatchObject({ slideId: "s1", elId: "e1", x: 300, y: 50, authorName: "Ann Lee" });
    const d = applyCommentOp(deck(), { t: "comment", c });
    expect(d.comments).toHaveLength(1);
    // Idempotent.
    expect(applyCommentOp(d, { t: "comment", c }).comments).toHaveLength(1);
  });

  it("threads replies; editing the head keeps them; concurrent replies both land", () => {
    const c = newComment(ann, "s1", "Q", { now: t0, id: "c1" });
    let d = applyCommentOp(deck(), { t: "comment", c });
    d = applyCommentOp(d, { t: "commentReply", commentId: "c1", r: newReply(bob, "later", t1, "r2") });
    d = applyCommentOp(d, { t: "commentReply", commentId: "c1", r: newReply(ann, "first", t0, "r1") });
    expect(d.comments![0].replies.map((r) => r.id)).toEqual(["r1", "r2"]);
    d = applyCommentOp(d, { t: "comment", c: { ...c, body: "Q (edited)", replies: [] } });
    expect(d.comments![0].body).toBe("Q (edited)");
    expect(d.comments![0].replies).toHaveLength(2);
    d = applyCommentOp(d, { t: "commentReplyRemove", commentId: "c1", replyId: "r1" });
    expect(d.comments![0].replies.map((r) => r.id)).toEqual(["r2"]);
  });

  it("resolves, reopens and removes", () => {
    let d = applyCommentOp(deck(), { t: "comment", c: newComment(ann, "s2", "x", { id: "c1", now: t0 }) });
    d = applyCommentOp(d, { t: "commentResolve", commentId: "c1", resolved: true, by: "Bob" });
    expect(d.comments![0]).toMatchObject({ resolved: true, resolvedBy: "Bob" });
    expect(commentsFor(d, "open")).toHaveLength(0);
    expect(commentsFor(d, "resolved")).toHaveLength(1);
    d = applyCommentOp(d, { t: "commentResolve", commentId: "c1", resolved: false });
    expect(openCountBySlide(d).get("s2")).toBe(1);
    d = applyCommentOp(d, { t: "commentRemove", commentId: "c1" });
    expect(d.comments).toEqual([]);
  });

  it("lists in slide order and drops threads of deleted slides", () => {
    let d = deck();
    d = applyCommentOp(d, { t: "comment", c: newComment(ann, "s2", "b", { id: "b", now: t0 }) });
    d = applyCommentOp(d, { t: "comment", c: newComment(ann, "s1", "a", { id: "a", now: t1 }) });
    d = applyCommentOp(d, { t: "comment", c: newComment(ann, "gone", "z", { id: "z", now: t0 }) });
    expect(commentsFor(d, "all").map((c) => c.id)).toEqual(["a", "b"]);
    expect(commentsFor(d, "all", "s2").map((c) => c.id)).toEqual(["b"]);
  });

  it("markers follow their element, else stay where they were", () => {
    const c = newComment(ann, "s1", "x", { el: box, id: "c" });
    expect(markerPosition(c, [{ ...box, x: 0 }])).toEqual({ x: 200, y: 50, orphan: false });
    expect(markerPosition(c, [])).toEqual({ x: 300, y: 50, orphan: true });
  });
});

describe("@mentions", () => {
  const cands = [
    { id: "u1", name: "Ann Lee", email: "ann@x.io" },
    { id: "u2", name: "Bob", email: "bob@x.io" },
  ];
  it("finds the query at the caret", () => {
    expect(mentionQuery("hi @an", 6)).toEqual({ start: 3, query: "an" });
    expect(mentionQuery("mail a@b", 8)).toBeNull();
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });
  it("matches names and emails by word prefix", () => {
    expect(matchMentions(cands, "le").map((c) => c.id)).toEqual(["u1"]);
    expect(matchMentions(cands, "bob").map((c) => c.id)).toEqual(["u2"]);
    expect(matchMentions(cands, "")).toHaveLength(2);
  });
  it("inserts a mention and extracts mentioned ids", () => {
    const r = insertMention("hi @an", { start: 3, query: "an" }, cands[0]);
    expect(r.text).toBe("hi @Ann Lee ");
    expect(mentionedIds(r.text + "and @Bob.", cands)).toEqual(["u1", "u2"]);
    expect(mentionedIds("@Bobby", cands)).toEqual([]);
  });
});
