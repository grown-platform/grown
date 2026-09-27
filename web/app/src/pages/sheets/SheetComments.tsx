import { useEffect, useState } from "react";
import { Box, Button, Chip, Divider, IconButton, Sheet, Textarea, Typography } from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { threadAddress, type CellComment, type CommentThread } from "./cellComments";

// UI for threaded cell comments (model: cellComments.ts). The components are
// controlled: every change goes out through a callback, and the editor
// persists it on the sheet (grownComments) and relays it to collaborators.
// The look follows Docs' Comments.tsx.

/** "just now", "5 min ago", "3 h ago", then a short date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return "";
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Composer({
  label,
  placeholder,
  button,
  initial = "",
  autoFocus,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder: string;
  button: string;
  initial?: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initial);
  const submit = () => {
    if (!body.trim()) return;
    onSubmit(body.trim());
    setBody("");
  };
  return (
    <Box sx={{ mt: 1 }}>
      <Textarea
        autoFocus={autoFocus}
        minRows={2}
        size="sm"
        placeholder={placeholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        slotProps={{ textarea: { "aria-label": label } }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Box sx={{ display: "flex", gap: 1, mt: 0.5, justifyContent: "flex-end" }}>
        {onCancel && (
          <Button size="sm" variant="plain" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" disabled={!body.trim()} onClick={submit}>
          {button}
        </Button>
      </Box>
    </Box>
  );
}

function CommentEntry({
  comment,
  first,
  userId,
  onEdit,
  onDelete,
}: {
  comment: CellComment;
  first: boolean;
  userId: string;
  onEdit: (commentId: string, body: string) => void;
  onDelete: (commentId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const mine = comment.authorId !== "" && comment.authorId === userId;
  return (
    <Box sx={{ mb: 0.75 }} data-comment-id={comment.id}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.25 }}>
        <Typography level={first ? "body-sm" : "body-xs"} sx={{ fontWeight: 600, flex: 1 }}>
          {comment.authorName}
        </Typography>
        <Typography level="body-xs" sx={{ opacity: 0.6 }}>
          {relativeTime(comment.ts)}
          {comment.edited ? " (edited)" : ""}
        </Typography>
        {mine && !editing && (
          <>
            <IconButton size="sm" variant="plain" aria-label="Edit comment" sx={{ p: 0.25, minHeight: 0 }} onClick={() => setEditing(true)}>
              <EditOutlinedIcon sx={{ fontSize: 14 }} />
            </IconButton>
            <IconButton
              size="sm"
              variant="plain"
              color="danger"
              aria-label={first ? "Delete thread" : "Delete comment"}
              sx={{ p: 0.25, minHeight: 0 }}
              onClick={() => onDelete(comment.id)}
            >
              <DeleteOutlineIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </>
        )}
      </Box>
      {editing ? (
        <Composer
          label="Edit comment"
          placeholder="Edit comment…"
          button="Save"
          initial={comment.body}
          autoFocus
          onSubmit={(b) => {
            onEdit(comment.id, b);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Typography level={first ? "body-sm" : "body-xs"} sx={{ whiteSpace: "pre-wrap" }}>
          {comment.body}
        </Typography>
      )}
    </Box>
  );
}

export interface CommentThreadCardProps {
  /** The cell's thread; null opens the composer for a new thread. */
  thread: CommentThread | null;
  /** Cell the card belongs to (for the header and a new thread). */
  cell: { r: number; c: number };
  /** Viewport pixel position of the card's top-left corner. */
  x: number;
  y: number;
  userId: string;
  onAdd: (body: string) => void;
  onReply: (threadId: string, body: string) => void;
  onEdit: (threadId: string, commentId: string, body: string) => void;
  onDelete: (threadId: string, commentId: string) => void;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
  onClose: () => void;
}

/** A thread shown next to its cell (or the composer for a new one). */
export function CommentThreadCard(props: CommentThreadCardProps) {
  const { thread, cell, x, y, userId, onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const addr = threadAddress(cell);
  return (
    <Sheet
      variant="outlined"
      data-testid="cell-comment-card"
      role="dialog"
      aria-label={`Comments on ${addr}`}
      onMouseDown={(e) => e.stopPropagation()}
      sx={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 1300,
        width: 280,
        maxHeight: 420,
        overflow: "auto",
        p: 1.25,
        borderRadius: "sm",
        boxShadow: "md",
        bgcolor: "background.surface",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <Typography level="title-sm" sx={{ flex: 1 }}>
          {addr}
        </Typography>
        {thread?.resolved && (
          <Chip size="sm" variant="soft" color="success">
            Resolved
          </Chip>
        )}
        {thread && !thread.resolved && (
          <Button size="sm" variant="plain" onClick={() => props.onResolve(thread.id)}>
            Resolve
          </Button>
        )}
        {thread?.resolved && (
          <Button size="sm" variant="plain" onClick={() => props.onReopen(thread.id)}>
            Reopen
          </Button>
        )}
        <IconButton size="sm" variant="plain" aria-label="Close comment" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>
      {thread ? (
        <>
          <Box sx={{ opacity: thread.resolved ? 0.7 : 1 }}>
            {thread.comments.map((cm, i) => (
              <Box key={cm.id} sx={i > 0 ? { pl: 1.5, borderLeft: "2px solid", borderColor: "divider" } : undefined}>
                <CommentEntry
                  comment={cm}
                  first={i === 0}
                  userId={userId}
                  onEdit={(id, b) => props.onEdit(thread.id, id, b)}
                  onDelete={(id) => props.onDelete(thread.id, id)}
                />
              </Box>
            ))}
          </Box>
          <Composer label="Reply" placeholder="Reply…" button="Reply" autoFocus onSubmit={(b) => props.onReply(thread.id, b)} />
        </>
      ) : (
        <Composer label="Comment" placeholder="Add a comment…" button="Comment" autoFocus onSubmit={props.onAdd} onCancel={onClose} />
      )}
    </Sheet>
  );
}

export interface CommentsPanelSheet {
  id: string;
  name: string;
  threads: CommentThread[];
}

export interface CommentsPanelProps {
  sheets: CommentsPanelSheet[];
  onJump: (sheetId: string, r: number, c: number) => void;
  onClose: () => void;
}

/** Side panel listing every thread of the workbook, grouped by sheet. */
export function CommentsPanel({ sheets, onJump, onClose }: CommentsPanelProps) {
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const keep = (t: CommentThread) => (filter === "all" ? true : filter === "open" ? !t.resolved : !!t.resolved);
  const groups = sheets
    .map((s) => ({ ...s, threads: [...s.threads].sort((a, b) => a.r - b.r || a.c - b.c).filter(keep) }))
    .filter((s) => s.threads.length > 0);
  return (
    <Sheet
      variant="outlined"
      data-testid="comments-panel"
      sx={{ width: 320, flexShrink: 0, height: "100%", display: "flex", flexDirection: "column", borderTop: 0, borderBottom: 0, borderRight: 0 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5 }}>
        <ChatBubbleOutlineIcon />
        <Typography level="title-md" sx={{ flex: 1 }}>
          Comments
        </Typography>
        <IconButton size="sm" variant="plain" aria-label="Close comments" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider />
      <Box sx={{ p: 1, display: "flex", gap: 0.5 }} role="group" aria-label="Comment filter">
        {(["open", "resolved", "all"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "soft" : "plain"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "open" ? "Open" : f === "resolved" ? "Resolved" : "All"}
          </Button>
        ))}
      </Box>
      <Box sx={{ flex: 1, overflow: "auto", px: 1.5, pb: 1.5 }}>
        {groups.length === 0 && (
          <Typography level="body-sm" sx={{ py: 2, opacity: 0.6 }}>
            {filter === "resolved" ? "No resolved comments." : "No comments. Select a cell and choose Insert ▸ Comment."}
          </Typography>
        )}
        {groups.map((g) => (
          <Box key={g.id} sx={{ mb: 1.5 }}>
            {sheets.length > 1 && (
              <Typography level="body-xs" sx={{ fontWeight: 600, textTransform: "uppercase", opacity: 0.7, mb: 0.5 }}>
                {g.name}
              </Typography>
            )}
            {g.threads.map((t) => {
              const addr = threadAddress(t);
              const first = t.comments[0];
              return (
                <Sheet
                  key={t.id}
                  variant="outlined"
                  data-testid={`comment-thread-${addr}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onJump(g.id, t.r, t.c)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onJump(g.id, t.r, t.c);
                  }}
                  sx={{ p: 1.25, borderRadius: "sm", mb: 1, cursor: "pointer", opacity: t.resolved ? 0.65 : 1 }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                    <Chip size="sm" variant="soft">
                      {addr}
                    </Chip>
                    <Typography level="body-sm" sx={{ fontWeight: 600, flex: 1 }}>
                      {first?.authorName}
                    </Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                      {relativeTime(first?.ts ?? "")}
                    </Typography>
                  </Box>
                  <Typography level="body-sm" sx={{ whiteSpace: "pre-wrap" }}>
                    {first?.body}
                  </Typography>
                  {t.comments.length > 1 && (
                    <Typography level="body-xs" sx={{ mt: 0.5, opacity: 0.7 }}>
                      {t.comments.length - 1} {t.comments.length === 2 ? "reply" : "replies"}
                    </Typography>
                  )}
                </Sheet>
              );
            })}
          </Box>
        ))}
      </Box>
    </Sheet>
  );
}
