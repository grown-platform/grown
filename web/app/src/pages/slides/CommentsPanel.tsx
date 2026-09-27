// Comments sidebar for Slides (M10): threads on the deck's slides and
// objects, with replies, resolve/reopen, delete, a composer for a new
// comment on the current slide (or the selected object) and @mentions. The
// look follows Docs' Comments panel; the data is DeckDoc.comments
// (comments.ts), changed through comment ops the editor applies, sends and
// autosaves.

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Chip, IconButton, Option, Select, Sheet, Textarea, Typography } from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ReplayIcon from "@mui/icons-material/Replay";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AddCommentIcon from "@mui/icons-material/AddComment";
import type { DeckDoc, Slide, SlideElement } from "./model";
import { elementName } from "./elementOps";
import {
  commentsFor,
  insertMention,
  matchMentions,
  mentionQuery,
  mentionedIds,
  newComment,
  newReply,
  type Author,
  type CommentFilter,
  type CommentOp,
  type MentionCandidate,
  type SlideComment,
} from "./comments";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** A textarea with @mention suggestions. */
function MentionInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  candidates,
  autoFocus,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  candidates: () => MentionCandidate[];
  autoFocus?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [q, setQ] = useState<{ start: number; query: string } | null>(null);
  const [hi, setHi] = useState(0);
  const matches = q ? matchMentions(candidates(), q.query) : [];
  const pick = (c: MentionCandidate) => {
    if (!q) return;
    const r = insertMention(value, q, c);
    onChange(r.text);
    setQ(null);
    requestAnimationFrame(() => {
      const ta = ref.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(r.caret, r.caret);
      }
    });
  };
  return (
    <Box sx={{ position: "relative" }}>
      <Textarea
        autoFocus={autoFocus}
        minRows={2}
        size="sm"
        placeholder={placeholder}
        value={value}
        slotProps={{ textarea: { ref, ...({ "data-testid": testId } as object) } }}
        onChange={(e) => {
          onChange(e.target.value);
          setQ(mentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length));
          setHi(0);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (matches.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => (h + 1) % matches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => (h - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(matches[Math.min(hi, matches.length - 1)]);
              return;
            }
            if (e.key === "Escape") {
              setQ(null);
              return;
            }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {matches.length > 0 && (
        <Sheet
          variant="outlined"
          role="listbox"
          data-testid="mention-list"
          sx={{ position: "absolute", zIndex: 10, left: 0, right: 0, top: "100%", borderRadius: "sm", boxShadow: "md", py: 0.5 }}
        >
          {matches.map((c, i) => (
            <Box
              key={c.id}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              sx={{ px: 1, py: 0.5, cursor: "pointer", bgcolor: i === hi ? "background.level2" : undefined }}
            >
              <Typography level="body-sm">{c.name}</Typography>
              {c.email && (
                <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                  {c.email}
                </Typography>
              )}
            </Box>
          ))}
        </Sheet>
      )}
    </Box>
  );
}

function Thread({
  c,
  me,
  active,
  where,
  canEdit,
  onActivate,
  onOp,
  candidates,
  onMentions,
}: {
  c: SlideComment;
  me: Author;
  active: boolean;
  where: string;
  canEdit: boolean;
  onActivate: () => void;
  onOp: (op: CommentOp) => void;
  candidates: () => MentionCandidate[];
  onMentions: (ids: string[], c: SlideComment, text: string) => void;
}) {
  const [reply, setReply] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const sendReply = () => {
    const body = reply.trim();
    if (!body) return;
    onOp({ t: "commentReply", commentId: c.id, r: newReply(me, body) });
    const ids = mentionedIds(body, candidates());
    if (ids.length) onMentions(ids, c, body);
    setReply("");
  };
  return (
    <Sheet
      ref={ref}
      variant="outlined"
      data-testid="comment-thread"
      data-comment={c.id}
      data-resolved={c.resolved ? "true" : "false"}
      onClick={onActivate}
      sx={{
        p: 1.25,
        borderRadius: "sm",
        mb: 1,
        cursor: "pointer",
        opacity: c.resolved ? 0.7 : 1,
        borderColor: active ? "#e37400" : undefined,
        boxShadow: active ? "sm" : undefined,
      }}
    >
      <Typography level="body-xs" sx={{ opacity: 0.6, mb: 0.5 }}>
        {where}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <Typography level="body-sm" sx={{ fontWeight: 600, flex: 1 }}>
          {c.authorName}
        </Typography>
        <Typography level="body-xs" sx={{ opacity: 0.6 }}>
          {fmtTime(c.createdAt)}
        </Typography>
      </Box>
      <Typography level="body-sm" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }} data-testid="comment-body">
        {c.body}
      </Typography>

      {c.replies.length > 0 && (
        <Box sx={{ mt: 1, pl: 1.5, borderLeft: "2px solid", borderColor: "divider" }}>
          {c.replies.map((r) => (
            <Box key={r.id} sx={{ mb: 0.75 }} data-testid="comment-reply">
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.25 }}>
                <Typography level="body-xs" sx={{ fontWeight: 600, flex: 1 }}>
                  {r.authorName}
                </Typography>
                <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                  {fmtTime(r.createdAt)}
                </Typography>
                {canEdit && r.authorId === me.id && (
                  <IconButton
                    size="sm"
                    variant="plain"
                    color="danger"
                    aria-label="Delete reply"
                    sx={{ p: 0.25, minHeight: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOp({ t: "commentReplyRemove", commentId: c.id, replyId: r.id });
                    }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                )}
              </Box>
              <Typography level="body-xs" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {r.body}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {canEdit && active && !c.resolved && (
        <Box sx={{ mt: 1 }} onClick={(e) => e.stopPropagation()}>
          <MentionInput
            value={reply}
            onChange={setReply}
            onSubmit={sendReply}
            placeholder="Reply or add others with @"
            candidates={candidates}
            testId="comment-reply-input"
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 0.5 }}>
            <Button size="sm" disabled={!reply.trim()} onClick={sendReply}>
              Reply
            </Button>
          </Box>
        </Box>
      )}

      <Box sx={{ display: "flex", gap: 0.5, mt: 1, alignItems: "center" }}>
        {c.resolved && (
          <Chip size="sm" variant="soft" color="success">
            Resolved{c.resolvedBy ? ` by ${c.resolvedBy}` : ""}
          </Chip>
        )}
        <Box sx={{ flex: 1 }} />
        {canEdit && (
          <IconButton
            size="sm"
            variant="plain"
            aria-label={c.resolved ? "Reopen comment" : "Resolve comment"}
            title={c.resolved ? "Reopen" : "Resolve"}
            onClick={(e) => {
              e.stopPropagation();
              onOp({ t: "commentResolve", commentId: c.id, resolved: !c.resolved, by: me.name });
            }}
          >
            {c.resolved ? <ReplayIcon /> : <CheckCircleIcon color="success" />}
          </IconButton>
        )}
        {canEdit && c.authorId === me.id && (
          <IconButton
            size="sm"
            variant="plain"
            color="danger"
            aria-label="Delete comment"
            title="Delete thread"
            onClick={(e) => {
              e.stopPropagation();
              onOp({ t: "commentRemove", commentId: c.id });
            }}
          >
            <DeleteOutlineIcon />
          </IconButton>
        )}
      </Box>
    </Sheet>
  );
}

export function CommentsPanel({
  doc,
  slide,
  selected,
  me,
  canEdit,
  active,
  onActive,
  onOp,
  onGoto,
  draftNonce,
  candidates,
  onMentions,
  onClose,
}: {
  doc: DeckDoc;
  slide: Slide | undefined;
  /** The selected object: a new comment is anchored to it. */
  selected: SlideElement | undefined;
  me: Author;
  canEdit: boolean;
  active: string | null;
  onActive: (id: string | null) => void;
  onOp: (op: CommentOp) => void;
  /** Show a thread's slide (and select its object). */
  onGoto: (c: SlideComment) => void;
  /** Bumped by Insert ▸ Comment / Ctrl+Alt+M: open the composer. */
  draftNonce: number;
  candidates: () => MentionCandidate[];
  onMentions: (ids: string[], c: SlideComment, text: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<CommentFilter>("open");
  const [scope, setScope] = useState<"deck" | "slide">("deck");
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    if (draftNonce > 0) setDraft("");
  }, [draftNonce]);
  const list = useMemo(
    () => commentsFor(doc, filter, scope === "slide" ? slide?.id : undefined),
    [doc, filter, scope, slide?.id],
  );
  const slideNo = new Map(doc.slides.map((s, i) => [s.id, i + 1]));
  const whereOf = (c: SlideComment) => {
    const s = doc.slides.find((x) => x.id === c.slideId);
    const el = c.elId ? s?.elements.find((e) => e.id === c.elId) : undefined;
    const n = `Slide ${slideNo.get(c.slideId) ?? "?"}`;
    if (!c.elId) return n;
    return el ? `${n} · ${elementName(el, s!.elements)}` : `${n} · (deleted object)`;
  };
  const submit = () => {
    const body = (draft ?? "").trim();
    if (!body || !slide) return;
    const ids = mentionedIds(body, candidates());
    const c = newComment(me, slide.id, body, { el: selected, mentions: ids });
    onOp({ t: "comment", c });
    if (ids.length) onMentions(ids, c, body);
    setDraft(null);
    onActive(c.id);
  };
  return (
    <Box
      data-testid="comments-panel"
      sx={{
        width: 300,
        flexShrink: 0,
        borderLeft: "1px solid",
        borderColor: "divider",
        bgcolor: "background.body",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", gap: 1 }}>
        <Typography level="title-sm">Comments</Typography>
        <Box sx={{ flex: 1 }} />
        {canEdit && (
          <IconButton size="sm" variant="plain" aria-label="New comment" title="New comment (Ctrl+Alt+M)" onClick={() => setDraft("")}>
            <AddCommentIcon />
          </IconButton>
        )}
        <IconButton size="sm" variant="plain" aria-label="Close comments" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Box sx={{ display: "flex", gap: 1, px: 1.5, py: 1 }}>
        <Select size="sm" value={filter} onChange={(_, v) => v && setFilter(v)} sx={{ flex: 1 }} aria-label="Show comments">
          <Option value="open">Open</Option>
          <Option value="resolved">Resolved</Option>
          <Option value="all">All</Option>
        </Select>
        <Select size="sm" value={scope} onChange={(_, v) => v && setScope(v)} sx={{ flex: 1 }} aria-label="Comments on">
          <Option value="deck">All slides</Option>
          <Option value="slide">This slide</Option>
        </Select>
      </Box>
      <Box sx={{ flex: 1, overflowY: "auto", px: 1.5, pb: 1.5 }}>
        {draft !== null && canEdit && (
          <Sheet variant="outlined" sx={{ p: 1.25, borderRadius: "sm", mb: 1, borderColor: "#e37400" }} data-testid="comment-composer">
            <Typography level="body-xs" sx={{ opacity: 0.6, mb: 0.5 }}>
              {slide ? `Slide ${slideNo.get(slide.id)}` : ""}
              {selected ? ` · ${elementName(selected, slide?.elements ?? [])}` : ""}
            </Typography>
            <MentionInput
              autoFocus
              value={draft}
              onChange={setDraft}
              onSubmit={submit}
              placeholder="Comment or add others with @"
              candidates={candidates}
              testId="comment-input"
            />
            <Box sx={{ display: "flex", gap: 1, mt: 0.5, justifyContent: "flex-end" }}>
              <Button size="sm" variant="plain" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button size="sm" disabled={!draft.trim()} onClick={submit} data-testid="comment-submit">
                Comment
              </Button>
            </Box>
          </Sheet>
        )}
        {list.length === 0 && draft === null && (
          <Typography level="body-sm" sx={{ opacity: 0.6, textAlign: "center", mt: 3 }}>
            {filter === "resolved" ? "No resolved comments." : "No comments yet."}
          </Typography>
        )}
        {list.map((c) => (
          <Thread
            key={c.id}
            c={c}
            me={me}
            active={c.id === active}
            where={whereOf(c)}
            canEdit={canEdit}
            onActivate={() => {
              onActive(c.id);
              onGoto(c);
            }}
            onOp={onOp}
            candidates={candidates}
            onMentions={onMentions}
          />
        ))}
      </Box>
    </Box>
  );
}
