/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet workbooks are loosely typed. */
import { describe, expect, it, vi } from "vitest";
import {
  addThread,
  commentMarker,
  deleteComment,
  deleteThread,
  editComment,
  paintCommentMarker,
  reopenThread,
  replyTo,
  resolveThread,
  sheetComments,
  sortedThreads,
  threadAddress,
  threadAt,
  threadNoteText,
  type CommentThread,
} from "./cellComments";
import { applyStructureOp } from "./formulaShift";
import { workbookToXlsx } from "./xlsx/xlsxWrite";
import { readXlsx } from "./xlsx/xlsxRead";

const ann = { id: "u1", name: "Ann" };
const bob = { id: "u2", name: "Bob" };
const t0 = new Date("2026-09-26T10:00:00Z");

function sample(): CommentThread[] {
  let th: CommentThread[] = [];
  th = addThread(th, 4, 2, "Check this total", ann, t0);
  th = addThread(th, 1, 0, "Header?", bob, t0);
  return th;
}

describe("cell comment model", () => {
  it("adds threads, replies and finds them by cell", () => {
    let th = sample();
    expect(th).toHaveLength(2);
    const c5 = threadAt(th, 4, 2)!;
    expect(c5.comments[0]).toMatchObject({ authorId: "u1", authorName: "Ann", body: "Check this total", ts: t0.toISOString() });
    th = replyTo(th, c5.id, "  Fixed  ", bob, t0);
    expect(threadAt(th, 4, 2)!.comments.map((c) => c.body)).toEqual(["Check this total", "Fixed"]);
    expect(replyTo(th, c5.id, "   ", bob)).toBe(th);
    expect(sortedThreads(th).map(threadAddress)).toEqual(["A2", "C5"]);
    expect(threadAt(th, 0, 0)).toBeUndefined();
  });

  it("a second comment on the same cell joins its thread and reopens it", () => {
    let th = sample();
    const id = threadAt(th, 1, 0)!.id;
    th = resolveThread(th, id);
    th = addThread(th, 1, 0, "Still unclear", ann, t0);
    expect(th).toHaveLength(2);
    const t = threadAt(th, 1, 0)!;
    expect(t.resolved).toBe(false);
    expect(t.comments).toHaveLength(2);
  });

  it("edits and deletes only the author's own comments", () => {
    let th = sample();
    const t = threadAt(th, 4, 2)!;
    th = replyTo(th, t.id, "reply", bob, t0);
    const [first, reply] = threadAt(th, 4, 2)!.comments;
    // Bob can't edit Ann's comment.
    expect(editComment(th, t.id, first.id, "hijack", "u2")).toEqual(th);
    th = editComment(th, t.id, first.id, "Check this total again", "u1", t0);
    expect(threadAt(th, 4, 2)!.comments[0]).toMatchObject({ body: "Check this total again", edited: t0.toISOString() });
    // Deleting a reply keeps the thread; Ann can't delete Bob's reply.
    expect(deleteComment(th, t.id, reply.id, "u1")).toEqual(th);
    th = deleteComment(th, t.id, reply.id, "u2");
    expect(threadAt(th, 4, 2)!.comments).toHaveLength(1);
    // Deleting the first comment deletes the thread.
    th = deleteComment(th, t.id, first.id, "u1");
    expect(threadAt(th, 4, 2)).toBeUndefined();
    expect(deleteThread(sample(), "nope")).toHaveLength(2);
  });

  it("resolves and reopens", () => {
    let th = sample();
    const id = th[0].id;
    th = resolveThread(th, id);
    expect(th[0].resolved).toBe(true);
    th = reopenThread(th, id);
    expect(th[0].resolved).toBe(false);
  });

  it("reads the sheet field defensively", () => {
    expect(sheetComments({})).toEqual([]);
    expect(sheetComments({ grownComments: [null, { r: 1 }, { r: 0, c: 0, comments: [] }] })).toEqual([]);
    expect(sheetComments({ grownComments: sample() })).toHaveLength(2);
  });

  it("formats a thread as an xlsx note", () => {
    let th = sample();
    th = replyTo(th, threadAt(th, 4, 2)!.id, "Done", bob, t0);
    expect(threadNoteText(threadAt(th, 4, 2)!)).toBe("Ann: Check this total\nBob: Done");
  });
});

describe("comments follow structure ops", () => {
  const book = () => [{ id: "s1", name: "Sheet1", celldata: [], grownComments: sample() }, { id: "s2", name: "Other", celldata: [], grownComments: sample() }];
  const at = (s: any) => sortedThreads(s.grownComments).map(threadAddress);

  it("insert and delete rows", () => {
    let wb = applyStructureOp(book(), { kind: "insert", axis: "row", sheet: "s1", index: 2, count: 3 });
    expect(at(wb[0])).toEqual(["A2", "C8"]);
    expect(at(wb[1])).toEqual(["A2", "C5"]); // other sheets untouched
    wb = applyStructureOp(book(), { kind: "delete", axis: "row", sheet: "s1", index: 4, count: 1 });
    expect(at(wb[0])).toEqual(["A2"]); // C5's row is gone, and its thread with it
  });

  it("insert, delete and move columns", () => {
    expect(at(applyStructureOp(book(), { kind: "insert", axis: "col", sheet: "s1", index: 0, count: 1 })[0])).toEqual(["B2", "D5"]);
    expect(at(applyStructureOp(book(), { kind: "delete", axis: "col", sheet: "s1", index: 0, count: 1 })[0])).toEqual(["B5"]);
    expect(at(applyStructureOp(book(), { kind: "move", axis: "col", sheet: "s1", index: 2, count: 1, to: 0 })[0])).toEqual(["B2", "A5"]);
  });

  it("cell shifts", () => {
    const down = applyStructureOp(book(), { kind: "insertCells", sheet: "s1", rect: { r1: 0, c1: 2, r2: 1, c2: 2 }, shift: "down" });
    expect(at(down[0])).toEqual(["A2", "C7"]);
    const left = applyStructureOp(book(), { kind: "deleteCells", sheet: "s1", rect: { r1: 4, c1: 2, r2: 4, c2: 2 }, shift: "left" });
    expect(at(left[0])).toEqual(["A2"]);
  });
});

describe("comment marker", () => {
  const box = { row: 4, column: 2, startX: 100, startY: 40, endX: 173, endY: 59 };

  it("is a red triangle in the top-right corner of a cell with an open thread", () => {
    const m = commentMarker(sample(), box)!;
    expect(m.color).toBe("#d93025");
    expect(m.points).toEqual([
      [167, 40],
      [173, 40],
      [173, 46],
    ]);
    expect(commentMarker(sample(), { ...box, column: 3 })).toBeNull();
  });

  it("hides resolved threads unless asked, and fits tiny cells", () => {
    const th = resolveThread(sample(), threadAt(sample(), 4, 2)?.id ?? "");
    const resolved = th.map((t) => (t.r === 4 ? { ...t, resolved: true } : t));
    expect(commentMarker(resolved, box)).toBeNull();
    expect(commentMarker(resolved, box, { showResolved: true })!.color).toBe("#9aa0a6");
    const tiny = commentMarker(sample(), { ...box, endY: 43 })!;
    expect(tiny.points[2]).toEqual([173, 43]);
  });

  it("paints on the canvas", () => {
    const ctx = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), fillStyle: "" } as any;
    expect(paintCommentMarker(sample(), box, ctx)).toBe(true);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe("#d93025");
    expect(paintCommentMarker(sample(), { ...box, row: 0 }, ctx)).toBe(false);
  });
});

describe("comments in xlsx", () => {
  it("exports a thread as a note and reads it back as a thread", async () => {
    let th = sample();
    th = replyTo(th, threadAt(th, 4, 2)!.id, "Done", bob, t0);
    const wb = [
      {
        name: "Data",
        id: "s1",
        order: 0,
        celldata: [
          { r: 0, c: 0, v: { v: "x", m: "x", ps: { value: "Existing note", isShow: false } } },
          { r: 4, c: 2, v: { v: 5, m: "5" } },
        ],
        grownComments: [...th, ...addThread([], 0, 0, "ignored: cell has a note", ann, t0)],
      },
    ];
    const { sheets } = await readXlsx(await workbookToXlsx(wb), { userId: "u" });
    const s = sheets[0] as any;
    const got = sortedThreads(s.grownComments);
    expect(got.map(threadAddress)).toEqual(["A1", "A2", "C5"]);
    expect(got[0].comments[0].body).toBe("Existing note");
    // A2 has no cell at all; its thread still exported.
    expect(got[1].comments.map((c) => [c.authorName, c.body])).toEqual([["Bob", "Header?"]]);
    expect(got[2].comments.map((c) => [c.authorName, c.body])).toEqual([
      ["Ann", "Check this total"],
      ["Bob", "Done"],
    ]);
    expect(s.celldata.find((x: any) => x.r === 4 && x.c === 2).v.ps.value).toBe("Ann: Check this total\nBob: Done");
  });
});
