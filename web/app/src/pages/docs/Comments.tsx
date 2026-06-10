import {
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  Sheet,
  Box,
  Typography,
  IconButton,
  Button,
  Textarea,
  CircularProgress,
  Divider,
  Chip,
} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ReplayIcon from "@mui/icons-material/Replay";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ReplyIcon from "@mui/icons-material/Reply";
import type { Editor } from "@tiptap/react";
import {
  listComments,
  addComment,
  resolveComment,
  reopenComment,
  replyToComment,
  deleteComment,
  type DocComment,
} from "./api";

export interface CommentsHandle {
  /** startFromSelection captures the current editor selection and opens the
   *  draft composer for a new anchored comment. Returns false if nothing is selected. */
  startFromSelection: () => boolean;
}

interface CommentsProps {
  docId: string;
  editor: Editor | null;
  onClose: () => void;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** CommentThread renders a single top-level comment and its replies. */
function CommentThread({
  comment,
  onResolve,
  onReopen,
  onDelete,
  onScrollTo,
  onReplySubmit,
}: {
  comment: DocComment;
  onResolve: (c: DocComment) => void;
  onReopen: (c: DocComment) => void;
  onDelete: (c: DocComment) => void;
  onScrollTo: (c: DocComment) => void;
  onReplySubmit: (commentId: string, body: string) => Promise<void>;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  async function submitReply() {
    if (!replyBody.trim()) return;
    setReplyBusy(true);
    try {
      await onReplySubmit(comment.id, replyBody.trim());
      setReplyBody("");
      setReplyOpen(false);
    } finally {
      setReplyBusy(false);
    }
  }

  return (
    <Sheet
      variant="outlined"
      sx={{
        p: 1.25,
        borderRadius: "sm",
        mb: 1,
        opacity: comment.resolved ? 0.65 : 1,
      }}
    >
      {/* Top-level comment header */}
      <Box
        sx={{ cursor: comment.resolved ? "default" : "pointer" }}
        onClick={() => onScrollTo(comment)}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
          <Typography level="body-sm" sx={{ fontWeight: 600, flex: 1 }}>
            {comment.author_name}
          </Typography>
          <Typography level="body-xs" sx={{ opacity: 0.6 }}>
            {fmtTime(comment.created_at)}
          </Typography>
        </Box>
        {comment.quote && (
          <Typography
            level="body-xs"
            sx={{
              fontStyle: "italic",
              opacity: 0.7,
              mb: 0.5,
              borderLeft: "3px solid #f4b400",
              pl: 1,
            }}
          >
            {comment.quote.slice(0, 120)}
            {comment.quote.length > 120 ? "…" : ""}
          </Typography>
        )}
        <Typography level="body-sm" sx={{ whiteSpace: "pre-wrap" }}>
          {comment.body}
        </Typography>
      </Box>

      {/* Reply list */}
      {(comment.replies ?? []).length > 0 && (
        <Box
          sx={{
            mt: 1,
            pl: 1.5,
            borderLeft: "2px solid",
            borderColor: "divider",
          }}
        >
          {(comment.replies ?? []).map((reply) => (
            <Box key={reply.id} sx={{ mb: 0.75 }}>
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.25 }}
              >
                <Typography level="body-xs" sx={{ fontWeight: 600, flex: 1 }}>
                  {reply.author_name}
                </Typography>
                <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                  {fmtTime(reply.created_at)}
                </Typography>
                <IconButton
                  size="sm"
                  variant="plain"
                  color="danger"
                  aria-label="Delete reply"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(reply);
                  }}
                  sx={{ p: 0.25 }}
                >
                  <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
              <Typography level="body-xs" sx={{ whiteSpace: "pre-wrap" }}>
                {reply.body}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* Reply composer */}
      {replyOpen && (
        <Box sx={{ mt: 1 }}>
          <Textarea
            autoFocus
            minRows={2}
            size="sm"
            placeholder="Add a reply…"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitReply();
            }}
          />
          <Box
            sx={{
              display: "flex",
              gap: 1,
              mt: 0.5,
              justifyContent: "flex-end",
            }}
          >
            <Button
              size="sm"
              variant="plain"
              onClick={() => {
                setReplyOpen(false);
                setReplyBody("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={replyBusy}
              disabled={!replyBody.trim()}
              onClick={submitReply}
            >
              Reply
            </Button>
          </Box>
        </Box>
      )}

      {/* Action row */}
      <Box sx={{ display: "flex", gap: 0.5, mt: 1, alignItems: "center" }}>
        {comment.resolved && (
          <Chip size="sm" variant="soft" color="success">
            Resolved
          </Chip>
        )}
        <Box sx={{ flex: 1 }} />
        {!comment.resolved && (
          <IconButton
            size="sm"
            variant="plain"
            aria-label="Reply"
            onClick={(e) => {
              e.stopPropagation();
              setReplyOpen((s) => !s);
            }}
          >
            <ReplyIcon />
          </IconButton>
        )}
        <IconButton
          size="sm"
          variant="plain"
          aria-label={comment.resolved ? "Reopen comment" : "Resolve comment"}
          onClick={(e) => {
            e.stopPropagation();
            comment.resolved ? onReopen(comment) : onResolve(comment);
          }}
        >
          {comment.resolved ? <ReplayIcon /> : <CheckCircleIcon />}
        </IconButton>
        <IconButton
          size="sm"
          variant="plain"
          color="danger"
          aria-label="Delete comment"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(comment);
          }}
        >
          <DeleteOutlineIcon />
        </IconButton>
      </Box>
    </Sheet>
  );
}

/** Comments is the comments sidebar: it lists anchored comment threads, lets the user
 *  add one from the current selection, reply, resolve/reopen, and delete threads.
 *  Comment anchors are highlighted in the editor via the commentMark extension. */
export const Comments = forwardRef<CommentsHandle, CommentsProps>(
  function Comments({ docId, editor, onClose }, ref) {
    const [comments, setComments] = useState<DocComment[] | null>(null);
    const [error, setError] = useState("");
    const [showResolved, setShowResolved] = useState(false);
    // Draft: a pending new comment anchored to a captured range.
    const [draft, setDraft] = useState<null | {
      from: number;
      to: number;
      quote: string;
      body: string;
    }>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
      setError("");
      setComments(null);
      listComments(docId)
        .then(setComments)
        .catch(() => setError("Could not load comments."));
    }, [docId]);

    useEffect(() => {
      load();
    }, [load]);

    // Decorate the editor with anchor marks for every open comment. Re-applied
    // when the comment list changes. Marks are visual only (not persisted to Yjs).
    useEffect(() => {
      if (!editor || !comments) return;
      const docSize = editor.state.doc.content.size;
      // Clear existing anchor marks, then re-apply for unresolved comments.
      editor.commands.command(({ tr, state, dispatch }) => {
        const markType = state.schema.marks.commentMark;
        if (markType) tr.removeMark(0, state.doc.content.size, markType);
        if (dispatch) dispatch(tr);
        return true;
      });
      for (const c of comments) {
        if (c.resolved) continue;
        const from = Math.min(Math.max(1, c.anchor_from), docSize);
        const to = Math.min(Math.max(from, c.anchor_to), docSize);
        if (to > from) {
          editor
            .chain()
            .setTextSelection({ from, to })
            .setCommentMark(c.id)
            .run();
        }
      }
      // Collapse selection back to the start so we don't leave text selected.
      editor.commands.setTextSelection(editor.state.selection.from);
    }, [editor, comments]);

    const startFromSelection = useCallback((): boolean => {
      if (!editor) return false;
      const { from, to } = editor.state.selection;
      if (from === to) return false;
      const quote = editor.state.doc.textBetween(from, to, " ");
      setDraft({ from, to, quote, body: "" });
      return true;
    }, [editor]);

    useImperativeHandle(ref, () => ({ startFromSelection }), [
      startFromSelection,
    ]);

    async function submitDraft() {
      if (!draft || !draft.body.trim()) return;
      setBusy(true);
      setError("");
      try {
        await addComment(
          docId,
          draft.body.trim(),
          draft.quote,
          draft.from,
          draft.to,
        );
        setDraft(null);
        load();
      } catch {
        setError("Could not add comment.");
      } finally {
        setBusy(false);
      }
    }

    async function handleResolve(c: DocComment) {
      try {
        await resolveComment(docId, c.id);
        load();
      } catch {
        setError("Could not resolve comment.");
      }
    }

    async function handleReopen(c: DocComment) {
      try {
        await reopenComment(docId, c.id);
        load();
      } catch {
        setError("Could not reopen comment.");
      }
    }

    async function handleReply(commentId: string, body: string) {
      try {
        await replyToComment(docId, commentId, body);
        load();
      } catch {
        setError("Could not add reply.");
        throw new Error("reply failed");
      }
    }

    async function remove(c: DocComment) {
      try {
        await deleteComment(docId, c.id);
        load();
      } catch {
        setError("Could not delete comment.");
      }
    }

    function scrollToAnchor(c: DocComment) {
      if (!editor || c.resolved) return;
      const docSize = editor.state.doc.content.size;
      const from = Math.min(Math.max(1, c.anchor_from), docSize);
      editor.chain().focus().setTextSelection(from).scrollIntoView().run();
    }

    const visible = (comments ?? []).filter((c) => showResolved || !c.resolved);
    const resolvedCount = (comments ?? []).filter((c) => c.resolved).length;

    return (
      <Sheet
        variant="outlined"
        sx={{
          width: 320,
          flexShrink: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          borderTop: 0,
          borderBottom: 0,
          borderRight: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5 }}>
          <ChatBubbleOutlineIcon />
          <Typography level="title-md" sx={{ flex: 1 }}>
            Comments
          </Typography>
          <IconButton
            size="sm"
            variant="plain"
            aria-label="Close comments"
            onClick={onClose}
          >
            <CloseIcon />
          </IconButton>
        </Box>
        <Divider />

        <Box sx={{ p: 1.5, display: "flex", gap: 1, alignItems: "center" }}>
          <Button
            size="sm"
            variant="soft"
            startDecorator={<ChatBubbleOutlineIcon />}
            disabled={!editor}
            onClick={() => {
              if (!startFromSelection()) setError("Select text to comment on.");
            }}
          >
            Comment on selection
          </Button>
          {resolvedCount > 0 && (
            <Button
              size="sm"
              variant="plain"
              onClick={() => setShowResolved((s) => !s)}
            >
              {showResolved ? "Hide resolved" : `Resolved (${resolvedCount})`}
            </Button>
          )}
        </Box>

        {draft && (
          <Box sx={{ px: 1.5, pb: 1.5 }}>
            <Sheet variant="soft" sx={{ p: 1, borderRadius: "sm" }}>
              <Typography
                level="body-xs"
                sx={{ fontStyle: "italic", opacity: 0.8, mb: 0.5 }}
              >
                "{draft.quote.slice(0, 120)}
                {draft.quote.length > 120 ? "…" : ""}"
              </Typography>
              <Textarea
                autoFocus
                minRows={2}
                placeholder="Add a comment…"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                    submitDraft();
                }}
              />
              <Box
                sx={{
                  display: "flex",
                  gap: 1,
                  mt: 1,
                  justifyContent: "flex-end",
                }}
              >
                <Button
                  size="sm"
                  variant="plain"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={busy}
                  disabled={!draft.body.trim()}
                  onClick={submitDraft}
                >
                  Comment
                </Button>
              </Box>
            </Sheet>
          </Box>
        )}

        <Box sx={{ flex: 1, overflow: "auto", px: 1.5, pb: 1.5 }}>
          {error && (
            <Typography level="body-xs" color="danger" sx={{ mb: 1 }}>
              {error}
            </Typography>
          )}
          {comments === null && !error && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size="sm" />
            </Box>
          )}
          {comments !== null && visible.length === 0 && !draft && (
            <Typography level="body-sm" sx={{ py: 2, opacity: 0.6 }}>
              No comments yet. Select text and choose "Comment on selection".
            </Typography>
          )}
          {visible.map((c) => (
            <CommentThread
              key={c.id}
              comment={c}
              onResolve={handleResolve}
              onReopen={handleReopen}
              onDelete={remove}
              onScrollTo={scrollToAnchor}
              onReplySubmit={handleReply}
            />
          ))}
        </Box>
      </Sheet>
    );
  },
);
