import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommentThreadCard, CommentsPanel, relativeTime } from "./SheetComments";
import { addThread, replyTo, resolveThread, type CommentThread } from "./cellComments";

const ann = { id: "u1", name: "Ann" };
const bob = { id: "u2", name: "Bob" };

function thread(): CommentThread {
  let th = addThread([], 4, 2, "Check this total", ann);
  th = replyTo(th, th[0].id, "Looks off by one", bob);
  return th[0];
}

function handlers() {
  return {
    onAdd: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onResolve: vi.fn(),
    onReopen: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("CommentThreadCard", () => {
  it("shows the thread and replies with Ctrl+Enter", () => {
    const h = handlers();
    const t = thread();
    render(<CommentThreadCard thread={t} cell={{ r: 4, c: 2 }} x={10} y={10} userId="u1" {...h} />);
    const card = screen.getByTestId("cell-comment-card");
    expect(card).toHaveTextContent("C5");
    expect(card).toHaveTextContent("Check this total");
    expect(card).toHaveTextContent("Looks off by one");
    const reply = screen.getByLabelText("Reply");
    fireEvent.change(reply, { target: { value: "Fixed now" } });
    fireEvent.keyDown(reply, { key: "Enter", ctrlKey: true });
    expect(h.onReply).toHaveBeenCalledWith(t.id, "Fixed now");
  });

  it("resolves, and only offers edit/delete on own comments", () => {
    const h = handlers();
    const t = thread();
    render(<CommentThreadCard thread={t} cell={{ r: 4, c: 2 }} x={0} y={0} userId="u2" {...h} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(h.onResolve).toHaveBeenCalledWith(t.id);
    // Bob owns only the reply.
    expect(screen.queryByRole("button", { name: "Delete thread" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    expect(h.onDelete).toHaveBeenCalledWith(t.id, t.comments[1].id);
    fireEvent.click(screen.getByRole("button", { name: "Edit comment" }));
    const edit = screen.getByLabelText("Edit comment");
    fireEvent.change(edit, { target: { value: "Off by two" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.onEdit).toHaveBeenCalledWith(t.id, t.comments[1].id, "Off by two");
  });

  it("reopens a resolved thread and closes on Escape", () => {
    const h = handlers();
    const t = resolveThread([thread()], thread().id)[0];
    const resolved = { ...t, resolved: true };
    render(<CommentThreadCard thread={resolved} cell={{ r: 4, c: 2 }} x={0} y={0} userId="u1" {...h} />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(h.onReopen).toHaveBeenCalledWith(resolved.id);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(h.onClose).toHaveBeenCalled();
  });

  it("starts a new thread from the composer", () => {
    const h = handlers();
    render(<CommentThreadCard thread={null} cell={{ r: 0, c: 0 }} x={0} y={0} userId="u1" {...h} />);
    const box = screen.getByLabelText("Comment");
    fireEvent.change(box, { target: { value: "New one" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(h.onAdd).toHaveBeenCalledWith("New one");
  });
});

describe("CommentsPanel", () => {
  it("lists threads by sheet, filters, and jumps", () => {
    const onJump = vi.fn();
    const open = thread();
    const done = { ...addThread([], 0, 0, "Old question", ann)[0], resolved: true };
    render(
      <CommentsPanel
        sheets={[
          { id: "s1", name: "Sheet1", threads: [open, done] },
          { id: "s2", name: "Other", threads: [] },
        ]}
        onJump={onJump}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("comment-thread-C5")).toHaveTextContent("1 reply");
    expect(screen.queryByTestId("comment-thread-A1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resolved" }));
    expect(screen.getByTestId("comment-thread-A1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("comment-thread-A1"));
    expect(onJump).toHaveBeenCalledWith("s1", 0, 0);
  });
});

describe("relativeTime", () => {
  it("formats recent times", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    expect(relativeTime("2026-09-26T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-09-26T11:50:00Z", now)).toBe("10 min ago");
    expect(relativeTime("2026-09-26T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime(new Date(0).toISOString(), now)).toBe("");
  });
});
