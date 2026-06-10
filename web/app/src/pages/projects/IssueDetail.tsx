// Issue detail panel — the right-hand surface showing one issue with every
// property picker (status / priority / assignee / project / labels / estimate),
// editable title + description, sub-issues, and a comment thread. Mirrors Linear's issue view.
import { useEffect, useRef, useState } from "react";
import {
  Box,
  Sheet,
  Typography,
  Input,
  Textarea,
  Divider,
  IconButton,
  Avatar,
  Button,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  LinearProgress,
  Chip,
} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import AddIcon from "@mui/icons-material/Add";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import {
  StatusPicker,
  PriorityPicker,
  AssigneePicker,
  ProjectPicker,
  LabelPicker,
} from "./Pickers";
import { avatarColor, initials } from "./meta";
import type {
  Issue,
  Member,
  Project,
  Label,
  Comment,
  IssuePatch,
} from "./types";
import {
  listComments,
  createComment,
  listIssues,
  createIssue,
  updateIssue,
} from "./api";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 32 }}>
      <Typography
        level="body-xs"
        sx={{ width: 84, color: "#8a8f98", flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

export function IssueDetail({
  issue,
  members,
  projects,
  labels,
  onPatch,
  onDelete,
  onClose,
  onOpenIssue,
}: {
  issue: Issue;
  members: Member[];
  projects: Project[];
  labels: Label[];
  onPatch: (patch: IssuePatch) => void;
  onDelete: () => void;
  onClose: () => void;
  onOpenIssue?: (id: string) => void;
}) {
  const [title, setTitle] = useState(issue.title);
  const [desc, setDesc] = useState(issue.description);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [subIssues, setSubIssues] = useState<Issue[]>([]);
  const [subDraft, setSubDraft] = useState("");
  const [subAdding, setSubAdding] = useState(false);
  const issueId = issue.id;
  const lastSaved = useRef({ title: issue.title, desc: issue.description });

  useEffect(() => {
    setTitle(issue.title);
    setDesc(issue.description);
    lastSaved.current = { title: issue.title, desc: issue.description };
  }, [issue.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    listComments(issueId)
      .then((c) => alive && setComments(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [issueId]);

  // Load sub-issues whenever the parent issue changes.
  useEffect(() => {
    let alive = true;
    listIssues({ parent_issue_id: issueId })
      .then((s) => alive && setSubIssues(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [issueId]);

  const addSubIssue = async () => {
    const t = subDraft.trim();
    if (!t) return;
    try {
      const ni = await createIssue({
        team_id: issue.team_id,
        title: t,
        parent_issue_id: issue.id,
      });
      setSubIssues((s) => [...s, ni]);
      setSubDraft("");
      setSubAdding(false);
    } catch {
      /* ignore */
    }
  };

  const toggleSubStatus = async (sub: Issue) => {
    const nextStatus = sub.status === "done" ? "todo" : "done";
    try {
      const updated = await updateIssue(sub.id, {
        status: nextStatus,
        status_set: true,
      });
      setSubIssues((s) => s.map((x) => (x.id === sub.id ? updated : x)));
    } catch {
      /* ignore */
    }
  };

  const totalSub = subIssues.length;
  const doneSub = subIssues.filter(
    (s) => s.status === "done" || s.status === "canceled",
  ).length;
  const subProgress = totalSub > 0 ? Math.round((doneSub / totalSub) * 100) : 0;

  const saveTitle = () => {
    if (title !== lastSaved.current.title) {
      onPatch({ title, title_set: true });
      lastSaved.current.title = title;
    }
  };
  const saveDesc = () => {
    if (desc !== lastSaved.current.desc) {
      onPatch({ description: desc, description_set: true });
      lastSaved.current.desc = desc;
    }
  };

  const addComment = async () => {
    const body = draft.trim();
    if (!body) return;
    const c = await createComment(issueId, body);
    setComments((cs) => [...cs, c]);
    setDraft("");
  };

  return (
    <Sheet
      variant="outlined"
      sx={{
        width: { xs: "100%", md: 380 },
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
        borderTop: 0,
        borderBottom: 0,
        borderRight: 0,
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Typography
          level="body-xs"
          sx={{ color: "#8a8f98", fontWeight: 600, flex: 1 }}
        >
          {issue.identifier}
        </Typography>
        <Dropdown>
          <MenuButton
            slots={{ root: IconButton }}
            slotProps={{
              root: { size: "sm", variant: "plain", color: "neutral" },
            }}
          >
            <MoreHorizIcon />
          </MenuButton>
          <Menu size="sm" placement="bottom-end">
            <MenuItem
              onClick={() => navigator.clipboard?.writeText(issue.identifier)}
            >
              <ContentCopyIcon sx={{ fontSize: 16 }} /> Copy ID
            </MenuItem>
            <ListDivider />
            <MenuItem color="danger" onClick={onDelete}>
              <DeleteOutlineIcon sx={{ fontSize: 16 }} /> Delete issue
            </MenuItem>
          </Menu>
        </Dropdown>
        <IconButton size="sm" variant="plain" color="neutral" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", px: 1.5, py: 1.5 }}>
        <Input
          variant="plain"
          value={title}
          placeholder="Issue title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          sx={{
            "--Input-focusedThickness": "0",
            fontSize: 18,
            fontWeight: 600,
            mb: 1,
            px: 0,
            "& input": { p: 0 },
          }}
        />
        <Textarea
          variant="plain"
          minRows={3}
          value={desc}
          placeholder="Add description…"
          onChange={(e) => setDesc(e.target.value)}
          onBlur={saveDesc}
          sx={{
            "--Textarea-focusedThickness": "0",
            px: 0,
            mb: 2,
            fontSize: 14,
          }}
        />

        <Divider sx={{ my: 1 }} />
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          <Row label="Status">
            <StatusPicker
              value={issue.status}
              onChange={(v) => onPatch({ status: v, status_set: true })}
              showLabel
            />
          </Row>
          <Row label="Priority">
            <PriorityPicker
              value={issue.priority}
              onChange={(v) => onPatch({ priority: v, priority_set: true })}
              showLabel
            />
          </Row>
          <Row label="Assignee">
            <AssigneePicker
              members={members}
              value={issue.assignee_id}
              onChange={(v) => onPatch({ assignee_id: v, assignee_set: true })}
              showLabel
            />
          </Row>
          <Row label="Project">
            <ProjectPicker
              projects={projects}
              value={issue.project_id}
              onChange={(v) => onPatch({ project_id: v, project_set: true })}
              showLabel
            />
          </Row>
          <Row label="Labels">
            <LabelPicker
              labels={labels}
              value={issue.label_ids || []}
              onChange={(v) => onPatch({ label_ids: v, labels_set: true })}
            />
          </Row>
          <Row label="Estimate">
            <Dropdown>
              <MenuButton
                slots={{ root: Button }}
                slotProps={{
                  root: {
                    size: "sm",
                    variant: "plain",
                    color: "neutral",
                    sx: { fontWeight: 400 },
                  },
                }}
              >
                {issue.estimate ? `${issue.estimate} pts` : "—"}
              </MenuButton>
              <Menu size="sm">
                {[0, 1, 2, 3, 5, 8, 13].map((n) => (
                  <MenuItem
                    key={n}
                    onClick={() => onPatch({ estimate: n, estimate_set: true })}
                  >
                    {n === 0 ? "No estimate" : `${n} points`}
                  </MenuItem>
                ))}
              </Menu>
            </Dropdown>
          </Row>
        </Box>

        {/* ── Sub-issues ─────────────────────────────────────────── */}
        <Divider sx={{ my: 1.5 }} />
        <Box sx={{ display: "flex", alignItems: "center", mb: 0.75 }}>
          <Typography level="title-sm" sx={{ flex: 1 }}>
            Sub-issues
          </Typography>
          {totalSub > 0 && (
            <Chip size="sm" variant="soft" sx={{ mr: 1 }}>
              {doneSub}/{totalSub}
            </Chip>
          )}
          <IconButton
            size="sm"
            variant="plain"
            color="neutral"
            onClick={() => setSubAdding(true)}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
        {totalSub > 0 && (
          <LinearProgress
            determinate
            value={subProgress}
            sx={{
              mb: 1,
              "--LinearProgress-radius": "4px",
              "--LinearProgress-thickness": "6px",
            }}
          />
        )}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
          {subIssues.map((sub) => {
            const isDone = sub.status === "done" || sub.status === "canceled";
            const a = members.find((m) => m.id === sub.assignee_id);
            return (
              <Box
                key={sub.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  px: 0.5,
                  py: 0.5,
                  borderRadius: "6px",
                  cursor: "pointer",
                  "&:hover": { bgcolor: "var(--joy-palette-neutral-50)" },
                }}
                onClick={() => onOpenIssue?.(sub.id)}
              >
                <Box
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSubStatus(sub);
                  }}
                  sx={{
                    display: "flex",
                    color: isDone ? "success.500" : "#8a8f98",
                  }}
                >
                  {isDone ? (
                    <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />
                  ) : (
                    <RadioButtonUncheckedIcon sx={{ fontSize: 16 }} />
                  )}
                </Box>
                <Typography
                  level="body-xs"
                  sx={{ color: "#8a8f98", flexShrink: 0 }}
                >
                  {sub.identifier}
                </Typography>
                <Typography
                  level="body-sm"
                  sx={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textDecoration: isDone ? "line-through" : "none",
                    color: isDone ? "#8a8f98" : "inherit",
                  }}
                >
                  {sub.title || "Untitled"}
                </Typography>
                {a && (
                  <Avatar
                    sx={{
                      "--Avatar-size": "18px",
                      bgcolor: avatarColor(a.id),
                      fontSize: 9,
                    }}
                  >
                    {initials(a.name)}
                  </Avatar>
                )}
              </Box>
            );
          })}
          {subAdding && (
            <Box
              sx={{ display: "flex", gap: 0.5, alignItems: "center", mt: 0.5 }}
            >
              <Input
                size="sm"
                autoFocus
                placeholder="Sub-issue title…"
                value={subDraft}
                onChange={(e) => setSubDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSubIssue();
                  }
                  if (e.key === "Escape") {
                    setSubAdding(false);
                    setSubDraft("");
                  }
                }}
                sx={{ flex: 1, "--Input-focusedThickness": "1px" }}
              />
              <Button
                size="sm"
                disabled={!subDraft.trim()}
                onClick={addSubIssue}
              >
                Add
              </Button>
              <Button
                size="sm"
                variant="plain"
                color="neutral"
                onClick={() => {
                  setSubAdding(false);
                  setSubDraft("");
                }}
              >
                Cancel
              </Button>
            </Box>
          )}
          {!subAdding && (
            <Box
              onClick={() => setSubAdding(true)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                px: 0.5,
                py: 0.5,
                color: "#8a8f98",
                cursor: "pointer",
                borderRadius: "6px",
                "&:hover": {
                  bgcolor: "var(--joy-palette-neutral-50)",
                  color: "text.primary",
                },
              }}
            >
              <AddIcon sx={{ fontSize: 14 }} />
              <Typography level="body-xs">Add sub-issue</Typography>
            </Box>
          )}
        </Box>

        <Divider sx={{ my: 1.5 }} />
        <Typography level="title-sm" sx={{ mb: 1 }}>
          Activity
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {comments.map((c) => (
            <Box key={c.id} sx={{ display: "flex", gap: 1 }}>
              <Avatar
                sx={{
                  "--Avatar-size": "24px",
                  bgcolor: avatarColor(c.author_id),
                  fontSize: 11,
                }}
              >
                {initials(c.author_name)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography level="body-xs">
                  <b>{c.author_name}</b>{" "}
                  <span style={{ color: "#8a8f98" }}>
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </Typography>
                <Typography level="body-sm" sx={{ whiteSpace: "pre-wrap" }}>
                  {c.body}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      {/* comment composer */}
      <Box sx={{ p: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
        <Textarea
          size="sm"
          minRows={1}
          maxRows={4}
          placeholder="Leave a comment…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              addComment();
            }
          }}
          endDecorator={
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-end",
                width: "100%",
              }}
            >
              <Button size="sm" disabled={!draft.trim()} onClick={addComment}>
                Comment
              </Button>
            </Box>
          }
        />
      </Box>
    </Sheet>
  );
}
