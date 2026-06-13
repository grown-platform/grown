import { useEffect, useMemo, useState } from "react";
import {
  Container,
  Box,
  Typography,
  Sheet,
  Input,
  Textarea,
  Button,
  IconButton,
  Chip,
  Badge,
  Select,
  Option,
  FormControl,
  FormLabel,
  RadioGroup,
  Radio,
  Checkbox,
  Modal,
  ModalDialog,
  DialogTitle,
  DialogContent,
  CircularProgress,
  Divider,
} from "@mui/joy";
import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PublicIcon from "@mui/icons-material/Public";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listProjects,
  createProject,
  listTickets,
  createTicket,
  getTicket,
  patchTicket,
  addComment,
  type Project,
  type Ticket,
  type Comment,
  type Priority,
  type IntakeMode,
} from "./api";

const ACCENT = "#2563EB";
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

const PRIORITY_COLOR: Record<
  Priority,
  "neutral" | "primary" | "warning" | "danger"
> = {
  low: "neutral",
  normal: "primary",
  high: "warning",
  urgent: "danger",
};

function fmtTime(sec: number): string {
  if (!sec) return "";
  return new Date(sec * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusColor(status: string): "neutral" | "success" | "primary" {
  const s = status.toLowerCase();
  if (s.includes("close") || s.includes("done") || s.includes("resolved"))
    return "neutral";
  if (s.includes("open") || s.includes("new")) return "primary";
  return "success";
}

export default function TicketsApp({ user }: { user: User }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newTicketOpen, setNewTicketOpen] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  // Load projects on mount.
  function reloadProjects() {
    return listProjects()
      .then(setProjects)
      .catch((e) => setError((e as Error).message));
  }
  useEffect(() => {
    reloadProjects().finally(() => setLoading(false));
  }, []);

  // Load tickets when the selected project or status filter changes.
  useEffect(() => {
    if (!selectedProjectId) {
      setTickets([]);
      return;
    }
    setTicketsLoading(true);
    listTickets(selectedProjectId, statusFilter || undefined)
      .then(setTickets)
      .catch((e) => setError((e as Error).message))
      .finally(() => setTicketsLoading(false));
  }, [selectedProjectId, statusFilter]);

  function selectProject(id: string) {
    setSelectedProjectId(id);
    setSelectedTicketId(null);
    setStatusFilter("");
  }

  function refreshTickets() {
    if (!selectedProjectId) return;
    listTickets(selectedProjectId, statusFilter || undefined)
      .then(setTickets)
      .catch(() => {});
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body" }}>
      <Header user={user} />
      <Container sx={{ py: 4, maxWidth: 1200 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
          <ConfirmationNumberIcon sx={{ color: ACCENT }} />
          <Typography level="h2">Tickets</Typography>
        </Box>
        <Typography level="body-sm" sx={{ mb: 3, opacity: 0.75 }}>
          Track requests across projects. Open a project to see its tickets, or
          share a public intake link so anyone can file a request.
        </Typography>

        {error && (
          <Typography color="danger" level="body-sm" sx={{ mb: 2 }}>
            {error}
          </Typography>
        )}

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "260px 1fr" },
              gap: 3,
              alignItems: "start",
            }}
          >
            {/* Projects sidebar */}
            <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 2 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 1.5,
                }}
              >
                <Typography level="title-sm">Projects</Typography>
                <IconButton
                  size="sm"
                  variant="soft"
                  onClick={() => setNewProjectOpen(true)}
                  title="New project"
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Box>
              {projects.length === 0 ? (
                <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                  No projects yet.
                </Typography>
              ) : (
                <Box
                  sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}
                >
                  {projects.map((p) => (
                    <Box
                      key={p.id}
                      onClick={() => selectProject(p.id)}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        p: 1,
                        borderRadius: "md",
                        cursor: "pointer",
                        bgcolor:
                          p.id === selectedProjectId
                            ? "primary.softBg"
                            : "transparent",
                        "&:hover": { bgcolor: "neutral.softBg" },
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                          {p.name}
                        </Typography>
                        <Typography
                          level="body-xs"
                          sx={{ fontFamily: "monospace", opacity: 0.6 }}
                        >
                          {p.key}
                        </Typography>
                      </Box>
                      <Badge
                        badgeContent={p.open_count}
                        max={99}
                        color="primary"
                        showZero={false}
                      />
                    </Box>
                  ))}
                </Box>
              )}
            </Sheet>

            {/* Main panel */}
            <Box sx={{ minWidth: 0 }}>
              {!selectedProject ? (
                <Sheet
                  variant="outlined"
                  sx={{
                    borderRadius: "lg",
                    p: 6,
                    textAlign: "center",
                    opacity: 0.7,
                  }}
                >
                  <Typography level="body-md">
                    Select a project to view its tickets.
                  </Typography>
                </Sheet>
              ) : selectedTicketId ? (
                <TicketDetail
                  ticketId={selectedTicketId}
                  project={selectedProject}
                  onBack={() => setSelectedTicketId(null)}
                  onChanged={refreshTickets}
                />
              ) : (
                <ProjectView
                  project={selectedProject}
                  tickets={tickets}
                  loading={ticketsLoading}
                  statusFilter={statusFilter}
                  onStatusFilter={setStatusFilter}
                  onOpenTicket={setSelectedTicketId}
                  onNewTicket={() => setNewTicketOpen(true)}
                />
              )}
            </Box>
          </Box>
        )}
      </Container>

      {newProjectOpen && (
        <NewProjectDialog
          onClose={() => setNewProjectOpen(false)}
          onCreated={(p) => {
            setNewProjectOpen(false);
            reloadProjects().then(() => selectProject(p.id));
          }}
        />
      )}

      {newTicketOpen && selectedProject && (
        <NewTicketDialog
          project={selectedProject}
          onClose={() => setNewTicketOpen(false)}
          onCreated={() => {
            setNewTicketOpen(false);
            refreshTickets();
            reloadProjects();
          }}
        />
      )}
    </Box>
  );
}

// ----------------------------------------------------------------------------

function ProjectView({
  project,
  tickets,
  loading,
  statusFilter,
  onStatusFilter,
  onOpenTicket,
  onNewTicket,
}: {
  project: Project;
  tickets: Ticket[];
  loading: boolean;
  statusFilter: string;
  onStatusFilter: (s: string) => void;
  onOpenTicket: (id: string) => void;
  onNewTicket: () => void;
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          flexWrap: "wrap",
        }}
      >
        <Box>
          <Typography level="title-lg">{project.name}</Typography>
          {project.description && (
            <Typography level="body-sm" sx={{ opacity: 0.7 }}>
              {project.description}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Select
            size="sm"
            value={statusFilter}
            onChange={(_, v) => onStatusFilter(v ?? "")}
            sx={{ minWidth: 140 }}
          >
            <Option value="">All statuses</Option>
            {project.statuses.map((s) => (
              <Option key={s} value={s}>
                {s}
              </Option>
            ))}
          </Select>
          <Button
            size="sm"
            startDecorator={<AddIcon />}
            onClick={onNewTicket}
            sx={{ bgcolor: ACCENT }}
          >
            New ticket
          </Button>
        </Box>
      </Box>

      {project.intake_mode === "public" && project.public_url && (
        <PublicLinkBanner url={project.public_url} />
      )}

      <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 0 }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : tickets.length === 0 ? (
          <Typography level="body-sm" sx={{ opacity: 0.6, p: 3 }}>
            No tickets{statusFilter ? ` with status "${statusFilter}"` : ""}.
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column" }}>
            {tickets.map((t, i) => (
              <Box
                key={t.id}
                onClick={() => onOpenTicket(t.id)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  p: 1.5,
                  cursor: "pointer",
                  borderTop: i === 0 ? "none" : "1px solid",
                  borderColor: "divider",
                  "&:hover": { bgcolor: "neutral.softBg" },
                }}
              >
                <Typography
                  level="body-xs"
                  sx={{
                    fontFamily: "monospace",
                    opacity: 0.6,
                    minWidth: 72,
                  }}
                >
                  {t.ref}
                </Typography>
                <Typography
                  level="body-sm"
                  sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}
                  noWrap
                >
                  {t.title}
                </Typography>
                <Chip size="sm" variant="soft" color={statusColor(t.status)}>
                  {t.status}
                </Chip>
                <Chip
                  size="sm"
                  variant="soft"
                  color={PRIORITY_COLOR[t.priority]}
                >
                  {t.priority}
                </Chip>
                <Typography
                  level="body-xs"
                  sx={{ opacity: 0.6, minWidth: 110, textAlign: "right" }}
                  noWrap
                >
                  {t.requester_name || "—"}
                </Typography>
                <Typography
                  level="body-xs"
                  sx={{ opacity: 0.5, minWidth: 110, textAlign: "right" }}
                  noWrap
                >
                  {fmtTime(t.updated_at)}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Sheet>
    </Box>
  );
}

// ----------------------------------------------------------------------------

function PublicLinkBanner({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const absolute = url.startsWith("http")
    ? url
    : `${window.location.origin}${url}`;
  return (
    <Sheet
      variant="soft"
      color="primary"
      sx={{
        borderRadius: "md",
        p: 1.5,
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        flexWrap: "wrap",
      }}
    >
      <PublicIcon fontSize="small" />
      <Box sx={{ flex: 1, minWidth: 200 }}>
        <Typography level="body-xs" sx={{ fontWeight: 600 }}>
          Public intake link — anyone with this link can file a request.
        </Typography>
        <Typography
          level="body-xs"
          sx={{ fontFamily: "monospace", wordBreak: "break-all", opacity: 0.8 }}
        >
          {absolute}
        </Typography>
      </Box>
      <Button
        size="sm"
        variant="outlined"
        startDecorator={<ContentCopyIcon fontSize="small" />}
        onClick={() => {
          navigator.clipboard?.writeText(absolute);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </Sheet>
  );
}

// ----------------------------------------------------------------------------

function TicketDetail({
  ticketId,
  project,
  onBack,
  onChanged,
}: {
  ticketId: string;
  project: Project;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [commentBody, setCommentBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [posting, setPosting] = useState(false);

  function load() {
    setLoading(true);
    getTicket(ticketId)
      .then((d) => {
        setTicket(d.ticket);
        setComments(d.comments ?? []);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function applyPatch(body: {
    status?: string;
    priority?: Priority;
  }) {
    if (!ticket) return;
    try {
      const updated = await patchTicket(ticket.id, body);
      setTicket(updated);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function postComment() {
    if (!commentBody.trim()) return;
    setPosting(true);
    try {
      const c = await addComment(ticketId, {
        body: commentBody.trim(),
        is_internal: internal,
      });
      setComments((cur) => [...cur, c]);
      setCommentBody("");
      setInternal(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!ticket) {
    return (
      <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 3 }}>
        <Button
          size="sm"
          variant="plain"
          startDecorator={<ArrowBackIcon />}
          onClick={onBack}
        >
          Back
        </Button>
        <Typography color="danger" level="body-sm" sx={{ mt: 2 }}>
          {error || "Ticket not found."}
        </Typography>
      </Sheet>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Button
        size="sm"
        variant="plain"
        startDecorator={<ArrowBackIcon />}
        onClick={onBack}
        sx={{ alignSelf: "flex-start" }}
      >
        Back to {project.name}
      </Button>

      <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 2.5 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              level="body-xs"
              sx={{ fontFamily: "monospace", opacity: 0.6 }}
            >
              {ticket.ref}
            </Typography>
            <Typography level="title-lg">{ticket.title}</Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <FormControl size="sm">
              <FormLabel>Status</FormLabel>
              <Select
                value={ticket.status}
                onChange={(_, v) => v && applyPatch({ status: v })}
                sx={{ minWidth: 130 }}
              >
                {project.statuses.map((s) => (
                  <Option key={s} value={s}>
                    {s}
                  </Option>
                ))}
              </Select>
            </FormControl>
            <FormControl size="sm">
              <FormLabel>Priority</FormLabel>
              <Select
                value={ticket.priority}
                onChange={(_, v) =>
                  v && applyPatch({ priority: v as Priority })
                }
                sx={{ minWidth: 110 }}
              >
                {PRIORITIES.map((p) => (
                  <Option key={p} value={p}>
                    {p}
                  </Option>
                ))}
              </Select>
            </FormControl>
          </Box>
        </Box>

        <Divider sx={{ my: 1.5 }} />

        <Typography level="body-sm" sx={{ whiteSpace: "pre-wrap" }}>
          {ticket.body}
        </Typography>

        <Box
          sx={{
            display: "flex",
            gap: 2,
            mt: 2,
            flexWrap: "wrap",
            opacity: 0.75,
          }}
        >
          <Typography level="body-xs">
            Requester: {ticket.requester_name || "—"}
            {ticket.requester_email ? ` <${ticket.requester_email}>` : ""}
          </Typography>
          <Typography level="body-xs">
            Source:{" "}
            <Chip size="sm" variant="soft">
              {ticket.source}
            </Chip>
          </Typography>
          <Typography level="body-xs">
            Created {fmtTime(ticket.created_at)}
          </Typography>
        </Box>
        {error && (
          <Typography color="danger" level="body-sm" sx={{ mt: 1 }}>
            {error}
          </Typography>
        )}
      </Sheet>

      {/* Comment thread */}
      <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 2.5 }}>
        <Typography level="title-sm" sx={{ mb: 1.5 }}>
          Comments
        </Typography>
        {comments.length === 0 ? (
          <Typography level="body-sm" sx={{ opacity: 0.6, mb: 2 }}>
            No comments yet.
          </Typography>
        ) : (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              mb: 2,
            }}
          >
            {comments.map((c) => (
              <Box
                key={c.id}
                sx={{
                  p: 1.5,
                  borderRadius: "md",
                  bgcolor: c.is_internal
                    ? "warning.softBg"
                    : "neutral.softBg",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 0.5,
                  }}
                >
                  <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                    {c.author_name || "Unknown"}
                  </Typography>
                  {c.is_internal && (
                    <Chip size="sm" variant="soft" color="warning">
                      internal
                    </Chip>
                  )}
                  <Typography level="body-xs" sx={{ opacity: 0.55 }}>
                    {fmtTime(c.created_at)}
                  </Typography>
                </Box>
                <Typography
                  level="body-sm"
                  sx={{ whiteSpace: "pre-wrap" }}
                >
                  {c.body}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Textarea
            minRows={2}
            placeholder={
              internal
                ? "Add an internal note (not visible to the requester)…"
                : "Add a comment…"
            }
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
          />
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
            }}
          >
            <Checkbox
              size="sm"
              label="Internal note"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
            />
            <Button
              size="sm"
              onClick={postComment}
              loading={posting}
              disabled={!commentBody.trim()}
              sx={{ bgcolor: ACCENT }}
            >
              Comment
            </Button>
          </Box>
        </Box>
      </Sheet>
    </Box>
  );
}

// ----------------------------------------------------------------------------

function NewProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [intakeMode, setIntakeMode] = useState<IntakeMode>("team");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const p = await createProject({
        name: name.trim(),
        key: key.trim().toUpperCase(),
        description: description.trim(),
        intake_mode: intakeMode,
      });
      onCreated(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = name.trim() !== "" && key.trim() !== "" && !busy;

  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ maxWidth: 460, width: "100%" }}>
        <DialogTitle>New project</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1 }}>
            <FormControl size="sm">
              <FormLabel>Name</FormLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer Support"
              />
            </FormControl>
            <FormControl size="sm">
              <FormLabel>Key</FormLabel>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase())}
                placeholder="SUP"
                slotProps={{ input: { style: { textTransform: "uppercase" } } }}
              />
            </FormControl>
            <FormControl size="sm">
              <FormLabel>Description</FormLabel>
              <Textarea
                minRows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project for?"
              />
            </FormControl>
            <FormControl size="sm">
              <FormLabel>Intake mode</FormLabel>
              <RadioGroup
                orientation="horizontal"
                value={intakeMode}
                onChange={(e) => setIntakeMode(e.target.value as IntakeMode)}
              >
                <Radio value="team" label="Team only" />
                <Radio value="public" label="Public link" />
              </RadioGroup>
            </FormControl>
            {error && (
              <Typography color="danger" level="body-sm">
                {error}
              </Typography>
            )}
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 1,
                mt: 1,
              }}
            >
              <Button variant="plain" color="neutral" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                loading={busy}
                disabled={!canSubmit}
                sx={{ bgcolor: ACCENT }}
              >
                Create
              </Button>
            </Box>
          </Box>
        </DialogContent>
      </ModalDialog>
    </Modal>
  );
}

// ----------------------------------------------------------------------------

function NewTicketDialog({
  project,
  onClose,
  onCreated,
}: {
  project: Project;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await createTicket(project.id, {
        title: title.trim(),
        body: body.trim(),
        priority,
      });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = title.trim() !== "" && !busy;

  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ maxWidth: 460, width: "100%" }}>
        <DialogTitle>New ticket — {project.name}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1 }}>
            <FormControl size="sm">
              <FormLabel>Title</FormLabel>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short summary"
              />
            </FormControl>
            <FormControl size="sm">
              <FormLabel>Details</FormLabel>
              <Textarea
                minRows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe the request…"
              />
            </FormControl>
            <FormControl size="sm">
              <FormLabel>Priority</FormLabel>
              <Select
                value={priority}
                onChange={(_, v) => v && setPriority(v as Priority)}
              >
                {PRIORITIES.map((p) => (
                  <Option key={p} value={p}>
                    {p}
                  </Option>
                ))}
              </Select>
            </FormControl>
            {error && (
              <Typography color="danger" level="body-sm">
                {error}
              </Typography>
            )}
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 1,
                mt: 1,
              }}
            >
              <Button variant="plain" color="neutral" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                loading={busy}
                disabled={!canSubmit}
                sx={{ bgcolor: ACCENT }}
              >
                Create ticket
              </Button>
            </Box>
          </Box>
        </DialogContent>
      </ModalDialog>
    </Modal>
  );
}
