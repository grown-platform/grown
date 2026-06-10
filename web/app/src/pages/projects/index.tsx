// Projects — a Linear-style issue tracker. Sidebar of teams/views, grouped list
// and board views, full issue detail with property pickers, command palette
// (Cmd/Ctrl+K), filters, and live multi-user updates over a per-team WebSocket.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Sheet,
  Typography,
  IconButton,
  Button,
  Input,
  Textarea,
  Avatar,
  Chip,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  Modal,
  ModalDialog,
  ModalClose,
  CircularProgress,
  Tooltip,
  Divider,
  Drawer,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";
import TuneIcon from "@mui/icons-material/Tune";
import ViewListIcon from "@mui/icons-material/ViewList";
import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import AssignmentIndIcon from "@mui/icons-material/AssignmentInd";
import GroupsIcon from "@mui/icons-material/Groups";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import MenuIcon from "@mui/icons-material/Menu";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  listTeamMembers,
  addTeamMember,
  removeTeamMember,
  listIssues,
  createIssue,
  updateIssue,
  deleteIssue,
  listProjects,
  createProject,
  deleteProject,
  listLabels,
  createLabel,
  deleteLabel,
  listMembers,
  listAssignable,
} from "./api";
import type {
  Team,
  Issue,
  Project,
  Label,
  Member,
  TeamMember,
  IssuePatch,
} from "./types";
import {
  STATUSES,
  PRIORITIES,
  PROJECT_STATES,
  statusMeta,
  priorityMeta,
  projectStateMeta,
  avatarColor,
  initials,
  LABEL_COLORS,
} from "./meta";
import {
  StatusPicker,
  PriorityPicker,
  AssigneePicker,
  ProjectPicker,
  LabelPicker,
} from "./Pickers";
import { IssueDetail } from "./IssueDetail";
import { CommandPalette, type Command } from "./CommandPalette";

type ViewMode = "list" | "board" | "my" | "projects" | "labels" | "teams";

interface Props {
  user: User;
}

/** Small hook: returns true when window.innerWidth < 900 (no Joy useMediaQuery needed). */
function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.innerWidth < 900);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 900);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile;
}

export default function ProjectsApp({ user }: Props) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [view, setView] = useState<ViewMode>("list");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  // Mobile: sidebar drawer open state
  const isMobile = useMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // filters
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fPriority, setFPriority] = useState<number[]>([]);
  const [fAssignee, setFAssignee] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<"status" | "priority" | "assignee">(
    "status",
  );

  // context menu
  const [ctx, setCtx] = useState<{ issue: Issue; x: number; y: number } | null>(
    null,
  );

  const team = teams.find((t) => t.id === teamId);
  const selected = issues.find((i) => i.id === selectedId) || null;

  // ── initial load ──
  useEffect(() => {
    (async () => {
      const [ts, ps, ls] = await Promise.all([
        listTeams(),
        listProjects(),
        listLabels(),
      ]);
      setTeams(ts);
      setProjects(ps);
      setLabels(ls);
      if (ts.length) {
        setTeamId(ts[0].id);
        // Load assignable members for the first team.
        const ms = await listAssignable(ts[0].id).catch(() => listMembers());
        setMembers(ms);
      } else {
        const ms = await listMembers().catch(() => []);
        setMembers(ms);
      }
      setLoading(false);
    })().catch(() => setLoading(false));
  }, []);

  // ── load issues for the active team ──
  const reloadIssues = useCallback(async (tid: string) => {
    if (!tid) {
      setIssues([]);
      return;
    }
    setIssues(await listIssues({ team_id: tid }));
  }, []);
  useEffect(() => {
    if (teamId) reloadIssues(teamId);
  }, [teamId, reloadIssues]);

  // ── reload assignable members when active team changes ──
  useEffect(() => {
    if (!teamId) return;
    listAssignable(teamId)
      .catch(() => listMembers())
      .then(setMembers)
      .catch(() => {});
  }, [teamId]);

  // ── live updates over the team WebSocket ──
  useEffect(() => {
    if (!teamId) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(
        `${proto}://${location.host}/api/v1/projects/teams/${teamId}/connect`,
      );
    } catch {
      return;
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "issue" && msg.issue) {
          setIssues((cur) => {
            const i = msg.issue as Issue;
            const idx = cur.findIndex((x) => x.id === i.id);
            if (idx === -1) return [...cur, i];
            const next = cur.slice();
            next[idx] = i;
            return next;
          });
        } else if (msg.type === "deleted" && msg.id) {
          setIssues((cur) => cur.filter((x) => x.id !== msg.id));
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      ws?.close();
    };
  }, [teamId]);

  // ── keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setNewOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── optimistic patch ──
  const patchIssue = useCallback(
    async (id: string, patch: IssuePatch) => {
      setIssues((cur) =>
        cur.map((i) => (i.id === id ? applyPatch(i, patch) : i)),
      );
      try {
        const updated = await updateIssue(id, patch);
        setIssues((cur) => cur.map((i) => (i.id === id ? updated : i)));
      } catch {
        reloadIssues(teamId);
      }
    },
    [teamId, reloadIssues],
  );

  const removeIssue = useCallback(
    async (id: string) => {
      setIssues((cur) => cur.filter((i) => i.id !== id));
      if (selectedId === id) setSelectedId("");
      try {
        await deleteIssue(id);
      } catch {
        reloadIssues(teamId);
      }
    },
    [selectedId, teamId, reloadIssues],
  );

  // ── filtering ──
  const visible = useMemo(() => {
    let xs = issues;
    if (view === "my") xs = xs.filter((i) => i.assignee_id === user.id);
    if (fStatus.length) xs = xs.filter((i) => fStatus.includes(i.status));
    if (fPriority.length) xs = xs.filter((i) => fPriority.includes(i.priority));
    if (fAssignee.length)
      xs = xs.filter((i) => fAssignee.includes(i.assignee_id));
    return xs;
  }, [issues, view, fStatus, fPriority, fAssignee, user.id]);

  // ── grouping for list view ──
  const groups = useMemo(
    () => groupIssues(visible, groupBy, members),
    [visible, groupBy, members],
  );

  // ── commands for the palette ──
  const commands: Command[] = useMemo(
    () => [
      {
        id: "new",
        label: "New issue",
        hint: "C",
        icon: <AddIcon sx={{ fontSize: 18 }} />,
        run: () => setNewOpen(true),
      },
      {
        id: "v-list",
        label: "Go to Issues (list)",
        icon: <ViewListIcon sx={{ fontSize: 18 }} />,
        run: () => setView("list"),
      },
      {
        id: "v-board",
        label: "Go to Board",
        icon: <ViewKanbanIcon sx={{ fontSize: 18 }} />,
        run: () => setView("board"),
      },
      {
        id: "v-my",
        label: "Go to My issues",
        icon: <AssignmentIndIcon sx={{ fontSize: 18 }} />,
        run: () => setView("my"),
      },
      {
        id: "v-projects",
        label: "Go to Projects",
        icon: <FolderOutlinedIcon sx={{ fontSize: 18 }} />,
        run: () => setView("projects"),
      },
      {
        id: "v-labels",
        label: "Go to Labels",
        icon: <LabelOutlinedIcon sx={{ fontSize: 18 }} />,
        run: () => setView("labels"),
      },
    ],
    [],
  );

  if (loading) {
    return (
      <>
        <Header user={user} />
        <Box sx={{ display: "flex", justifyContent: "center", pt: 10 }}>
          <CircularProgress />
        </Box>
      </>
    );
  }

  // first-run: no teams yet
  if (teams.length === 0) {
    return (
      <>
        <Header user={user} />
        <FirstRun
          onCreate={async (name, key) => {
            const t = await createTeam({ name, key });
            setTeams([t]);
            setTeamId(t.id);
          }}
        />
      </>
    );
  }

  const navItem = (
    label: string,
    icon: React.ReactNode,
    active: boolean,
    onClick: () => void,
  ) => (
    <Box
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.5,
        borderRadius: "6px",
        cursor: "pointer",
        minHeight: 40,
        bgcolor: active ? "var(--joy-palette-primary-softBg)" : "transparent",
        color: active ? "primary.plainColor" : "text.primary",
        "&:hover": {
          bgcolor: active
            ? "var(--joy-palette-primary-softBg)"
            : "var(--joy-palette-neutral-100)",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          fontSize: 18,
          color: active ? "primary.plainColor" : "#8a8f98",
        }}
      >
        {icon}
      </Box>
      <Typography level="body-sm" sx={{ fontWeight: active ? 600 : 400 }}>
        {label}
      </Typography>
    </Box>
  );

  const viewTitle =
    view === "my"
      ? "My issues"
      : view === "board"
        ? `${team?.name} board`
        : view === "projects"
          ? "Projects"
          : view === "labels"
            ? "Labels"
            : view === "teams"
              ? "Teams & Members"
              : `${team?.name} issues`;

  // Sidebar content shared between desktop Sheet and mobile Drawer
  const sidebarContent = (
    <>
      <Box
        onClick={() => {
          setPaletteOpen(true);
          if (isMobile) setSidebarOpen(false);
        }}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.75,
          mb: 1,
          borderRadius: "8px",
          border: "1px solid",
          borderColor: "divider",
          cursor: "pointer",
          color: "#8a8f98",
          "&:hover": { bgcolor: "var(--joy-palette-neutral-100)" },
        }}
      >
        <SearchIcon sx={{ fontSize: 16 }} />
        <Typography level="body-xs" sx={{ flex: 1 }}>
          Search…
        </Typography>
        <Chip size="sm" variant="soft">
          ⌘K
        </Chip>
      </Box>
      {navItem("My issues", <AssignmentIndIcon />, view === "my", () => {
        setView("my");
        setSelectedId("");
        if (isMobile) setSidebarOpen(false);
      })}
      <Typography
        level="body-xs"
        sx={{ color: "#8a8f98", px: 1, mt: 1.5, mb: 0.5, fontWeight: 600 }}
      >
        TEAMS
      </Typography>
      {teams.map((t) => (
        <Box key={t.id}>
          <Box
            onClick={() => {
              setTeamId(t.id);
              setView("list");
              setSelectedId("");
              if (isMobile) setSidebarOpen(false);
            }}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1,
              py: 0.5,
              borderRadius: "6px",
              cursor: "pointer",
              minHeight: 40,
              "&:hover": { bgcolor: "var(--joy-palette-neutral-100)" },
            }}
          >
            <Box
              sx={{
                width: 18,
                height: 18,
                borderRadius: "5px",
                bgcolor: t.color,
                color: "#fff",
                fontSize: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
              }}
            >
              {t.key.slice(0, 2)}
            </Box>
            <Typography
              level="body-sm"
              sx={{ fontWeight: t.id === teamId ? 600 : 400 }}
            >
              {t.name}
            </Typography>
          </Box>
          {t.id === teamId && (
            <Box sx={{ pl: 2 }}>
              {navItem("Issues", <ViewListIcon />, view === "list", () => {
                setView("list");
                setSelectedId("");
                if (isMobile) setSidebarOpen(false);
              })}
              {navItem("Board", <ViewKanbanIcon />, view === "board", () => {
                setView("board");
                setSelectedId("");
                if (isMobile) setSidebarOpen(false);
              })}
            </Box>
          )}
        </Box>
      ))}
      <Divider sx={{ my: 1 }} />
      {navItem("Projects", <FolderOutlinedIcon />, view === "projects", () => {
        setView("projects");
        setSelectedId("");
        if (isMobile) setSidebarOpen(false);
      })}
      {navItem("Labels", <LabelOutlinedIcon />, view === "labels", () => {
        setView("labels");
        setSelectedId("");
        if (isMobile) setSidebarOpen(false);
      })}
      {navItem("Teams", <GroupsIcon />, view === "teams", () => {
        setView("teams");
        setSelectedId("");
        if (isMobile) setSidebarOpen(false);
      })}
    </>
  );

  // On mobile: show detail pane only (no list) when an issue is selected
  const showDetailOnly =
    isMobile &&
    !!selected &&
    (view === "list" || view === "board" || view === "my");

  return (
    <>
      <Header user={user} />
      <Box
        sx={{
          display: "flex",
          height: "calc(100vh - 56px)",
          overflow: "hidden",
        }}
      >
        {/* Desktop Sidebar */}
        <Sheet
          variant="outlined"
          sx={{
            width: 240,
            flexShrink: 0,
            borderRadius: 0,
            borderTop: 0,
            borderBottom: 0,
            borderLeft: 0,
            p: 1.5,
            display: { xs: "none", md: "flex" },
            flexDirection: "column",
            gap: 0.25,
            overflow: "auto",
          }}
        >
          {sidebarContent}
        </Sheet>

        {/* Mobile Drawer Sidebar */}
        <Drawer
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          size="sm"
          sx={{ display: { xs: "flex", md: "none" } }}
        >
          <Box
            sx={{
              p: 1.5,
              display: "flex",
              flexDirection: "column",
              gap: 0.25,
              overflow: "auto",
              height: "100%",
            }}
          >
            {sidebarContent}
          </Box>
        </Drawer>

        {/* Main */}
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          {/* toolbar */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: { xs: 1, sm: 2 },
              py: 1,
              borderBottom: "1px solid",
              borderColor: "divider",
              flexShrink: 0,
              flexWrap: "wrap",
            }}
          >
            {/* Mobile hamburger */}
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              sx={{ display: { xs: "inline-flex", md: "none" } }}
              onClick={() => setSidebarOpen(true)}
            >
              <MenuIcon />
            </IconButton>
            {/* Mobile back button when detail is shown */}
            {showDetailOnly && (
              <IconButton
                size="sm"
                variant="plain"
                color="neutral"
                onClick={() => setSelectedId("")}
              >
                <ArrowBackIcon />
              </IconButton>
            )}
            <Typography
              level="title-sm"
              sx={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {viewTitle}
              {(view === "list" || view === "board" || view === "my") && (
                <Chip size="sm" variant="soft" sx={{ ml: 1 }}>
                  {visible.length}
                </Chip>
              )}
            </Typography>
            {(view === "list" || view === "board" || view === "my") && (
              <>
                <FilterMenu
                  members={members}
                  fStatus={fStatus}
                  setFStatus={setFStatus}
                  fPriority={fPriority}
                  setFPriority={setFPriority}
                  fAssignee={fAssignee}
                  setFAssignee={setFAssignee}
                />
                <Dropdown>
                  <MenuButton
                    slots={{ root: Button }}
                    slotProps={{
                      root: {
                        size: "sm",
                        variant: "plain",
                        color: "neutral",
                        startDecorator: <TuneIcon sx={{ fontSize: 16 }} />,
                      },
                    }}
                  >
                    Display
                  </MenuButton>
                  <Menu size="sm" placement="bottom-end">
                    <Typography
                      level="body-xs"
                      sx={{ px: 1.5, py: 0.5, color: "#8a8f98" }}
                    >
                      Group by
                    </Typography>
                    {(["status", "priority", "assignee"] as const).map((g) => (
                      <MenuItem
                        key={g}
                        selected={groupBy === g}
                        onClick={() => setGroupBy(g)}
                      >
                        {g[0].toUpperCase() + g.slice(1)}
                      </MenuItem>
                    ))}
                  </Menu>
                </Dropdown>
                <IconButton
                  size="sm"
                  variant={view === "board" ? "soft" : "plain"}
                  color="neutral"
                  onClick={() => setView("board")}
                >
                  <ViewKanbanIcon />
                </IconButton>
                <IconButton
                  size="sm"
                  variant={view !== "board" ? "soft" : "plain"}
                  color="neutral"
                  onClick={() => setView(view === "my" ? "my" : "list")}
                >
                  <ViewListIcon />
                </IconButton>
              </>
            )}
            <Button
              size="sm"
              startDecorator={<AddIcon />}
              onClick={() => setNewOpen(true)}
            >
              New issue
            </Button>
          </Box>

          {/* content + optional detail */}
          <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
            {/* List / board — hide on mobile when detail is open */}
            {!showDetailOnly && (
              <Box sx={{ flex: 1, overflow: "auto", minWidth: 0 }}>
                {view === "board" ? (
                  <BoardView
                    issues={visible}
                    members={members}
                    onOpen={setSelectedId}
                    onPatch={patchIssue}
                  />
                ) : view === "projects" ? (
                  <ProjectsView
                    projects={projects}
                    onCreate={async (b) => {
                      const np = await createProject(b);
                      setProjects((p) => [np, ...p]);
                    }}
                    onDelete={async (id) => {
                      await deleteProject(id);
                      setProjects((p) => p.filter((x) => x.id !== id));
                    }}
                  />
                ) : view === "labels" ? (
                  <LabelsView
                    labels={labels}
                    onCreate={async (b) => {
                      const nl = await createLabel(b);
                      setLabels((l) =>
                        [...l, nl].sort((a, c) => a.name.localeCompare(c.name)),
                      );
                    }}
                    onDelete={async (id) => {
                      await deleteLabel(id);
                      setLabels((l) => l.filter((x) => x.id !== id));
                    }}
                  />
                ) : view === "teams" ? (
                  <TeamsView
                    teams={teams}
                    onCreate={async (b) => {
                      const t = await createTeam(b);
                      setTeams((ts) => [...ts, t]);
                    }}
                    onUpdate={async (id, b) => {
                      const t = await updateTeam(id, b);
                      setTeams((ts) => ts.map((x) => (x.id === id ? t : x)));
                    }}
                    onDelete={async (id) => {
                      await deleteTeam(id);
                      setTeams((ts) => ts.filter((x) => x.id !== id));
                      if (teamId === id)
                        setTeamId(teams.find((x) => x.id !== id)?.id ?? "");
                    }}
                  />
                ) : (
                  <ListView
                    groups={groups}
                    members={members}
                    labels={labels}
                    selectedId={selectedId}
                    onOpen={setSelectedId}
                    onPatch={patchIssue}
                    onContext={(issue, x, y) => setCtx({ issue, x, y })}
                  />
                )}
              </Box>
            )}
            {/* Detail panel: full-width on mobile, side panel on desktop */}
            {selected &&
              (view === "list" || view === "board" || view === "my") && (
                <Box
                  sx={{
                    flex: isMobile ? "1 1 100%" : undefined,
                    width: isMobile ? "100%" : undefined,
                    display: "flex",
                    minHeight: 0,
                    overflow: "hidden",
                  }}
                >
                  <IssueDetail
                    issue={selected}
                    members={members}
                    projects={projects}
                    labels={labels}
                    onPatch={(p) => patchIssue(selected.id, p)}
                    onDelete={() => removeIssue(selected.id)}
                    onClose={() => setSelectedId("")}
                    onOpenIssue={setSelectedId}
                  />
                </Box>
              )}
          </Box>
        </Box>
      </Box>

      {/* context menu */}
      {ctx && (
        <Menu
          open
          anchorEl={virtualAnchor(ctx.x, ctx.y)}
          onClose={() => setCtx(null)}
          size="sm"
          placement="bottom-start"
          sx={{ minWidth: 200 }}
        >
          <Typography
            level="body-xs"
            sx={{ px: 1.5, py: 0.5, color: "#8a8f98" }}
          >
            Status
          </Typography>
          {STATUSES.map((s) => (
            <MenuItem
              key={s.value}
              onClick={() => {
                patchIssue(ctx.issue.id, { status: s.value, status_set: true });
                setCtx(null);
              }}
            >
              {s.icon(16)}
              {s.label}
            </MenuItem>
          ))}
          <ListDivider />
          <MenuItem
            onClick={() => {
              navigator.clipboard?.writeText(ctx.issue.identifier);
              setCtx(null);
            }}
          >
            <ContentCopyIcon sx={{ fontSize: 16 }} />
            Copy ID
          </MenuItem>
          <MenuItem
            color="danger"
            onClick={() => {
              removeIssue(ctx.issue.id);
              setCtx(null);
            }}
          >
            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
            Delete
          </MenuItem>
        </Menu>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        issues={issues}
        onOpenIssue={setSelectedId}
      />

      {newOpen && team && (
        <NewIssueModal
          team={team}
          teams={teams}
          members={members}
          projects={projects}
          labels={labels}
          onClose={() => setNewOpen(false)}
          onCreate={async (body) => {
            const i = await createIssue(body);
            if (body.team_id === teamId) setIssues((cur) => [...cur, i]);
            setNewOpen(false);
            setSelectedId(i.id);
          }}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function applyPatch(i: Issue, p: IssuePatch): Issue {
  return {
    ...i,
    ...(p.title_set ? { title: p.title! } : {}),
    ...(p.description_set ? { description: p.description! } : {}),
    ...(p.status_set ? { status: p.status! } : {}),
    ...(p.priority_set ? { priority: p.priority! } : {}),
    ...(p.assignee_set ? { assignee_id: p.assignee_id! } : {}),
    ...(p.labels_set ? { label_ids: p.label_ids! } : {}),
    ...(p.project_set ? { project_id: p.project_id! } : {}),
    ...(p.estimate_set ? { estimate: p.estimate! } : {}),
  };
}

interface Group {
  key: string;
  label: string;
  icon?: React.ReactNode;
  items: Issue[];
}

function groupIssues(
  issues: Issue[],
  by: "status" | "priority" | "assignee",
  members: Member[],
): Group[] {
  if (by === "status") {
    return STATUSES.map((s) => ({
      key: s.value,
      label: s.label,
      icon: s.icon(16),
      items: issues.filter((i) => i.status === s.value),
    })).filter((g) => g.items.length);
  }
  if (by === "priority") {
    return PRIORITIES.map((p) => ({
      key: String(p.value),
      label: p.label,
      icon: p.icon(16),
      items: issues.filter((i) => i.priority === p.value),
    })).filter((g) => g.items.length);
  }
  // assignee
  const byId = new Map<string, Issue[]>();
  for (const i of issues) {
    const k = i.assignee_id || "";
    (byId.get(k) ?? byId.set(k, []).get(k)!).push(i);
  }
  const out: Group[] = [];
  for (const [k, items] of byId) {
    const m = members.find((x) => x.id === k);
    out.push({ key: k || "none", label: m ? m.name : "Unassigned", items });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function virtualAnchor(x: number, y: number): any {
  return {
    getBoundingClientRect: () => ({
      width: 0,
      height: 0,
      top: y,
      right: x,
      bottom: y,
      left: x,
      x,
      y,
      toJSON: () => {},
    }),
  };
}

// ── List view ──
function ListView({
  groups,
  members,
  labels,
  selectedId,
  onOpen,
  onPatch,
  onContext,
}: {
  groups: Group[];
  members: Member[];
  labels: Label[];
  selectedId: string;
  onOpen: (id: string) => void;
  onPatch: (id: string, p: IssuePatch) => void;
  onContext: (i: Issue, x: number, y: number) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  if (groups.length === 0)
    return <Empty text="No issues. Press C to create one." />;
  return (
    <Box>
      {groups.map((g) => (
        <Box key={g.key}>
          <Box
            onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 2,
              py: 0.75,
              bgcolor: "var(--joy-palette-neutral-50)",
              cursor: "pointer",
              position: "sticky",
              top: 0,
              zIndex: 1,
            }}
          >
            {collapsed[g.key] ? (
              <ChevronRightIcon sx={{ fontSize: 16 }} />
            ) : (
              <ExpandMoreIcon sx={{ fontSize: 16 }} />
            )}
            {g.icon}
            <Typography level="body-sm" sx={{ fontWeight: 600 }}>
              {g.label}
            </Typography>
            <Typography level="body-xs" sx={{ color: "#8a8f98" }}>
              {g.items.length}
            </Typography>
          </Box>
          {!collapsed[g.key] &&
            g.items.map((i) => (
              <IssueRow
                key={i.id}
                issue={i}
                members={members}
                labels={labels}
                selected={i.id === selectedId}
                onOpen={onOpen}
                onPatch={onPatch}
                onContext={onContext}
              />
            ))}
        </Box>
      ))}
    </Box>
  );
}

function IssueRow({
  issue,
  members,
  labels,
  selected,
  onOpen,
  onPatch,
  onContext,
}: {
  issue: Issue;
  members: Member[];
  labels: Label[];
  selected: boolean;
  onOpen: (id: string) => void;
  onPatch: (id: string, p: IssuePatch) => void;
  onContext: (i: Issue, x: number, y: number) => void;
}) {
  const assignee = members.find((m) => m.id === issue.assignee_id);
  const issueLabels = labels.filter((l) =>
    (issue.label_ids || []).includes(l.id),
  );
  return (
    <Box
      onClick={() => onOpen(issue.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(issue, e.clientX, e.clientY);
      }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: { xs: 1, sm: 2 },
        py: 0.75,
        borderBottom: "1px solid",
        borderColor: "divider",
        cursor: "pointer",
        minHeight: 44,
        bgcolor: selected ? "var(--joy-palette-primary-softBg)" : "transparent",
        "&:hover": {
          bgcolor: selected
            ? "var(--joy-palette-primary-softBg)"
            : "var(--joy-palette-neutral-50)",
        },
      }}
    >
      <Box onClick={(e) => e.stopPropagation()} sx={{ display: "flex" }}>
        <PriorityPicker
          value={issue.priority}
          onChange={(v) =>
            onPatch(issue.id, { priority: v, priority_set: true })
          }
        />
      </Box>
      <Typography
        level="body-xs"
        sx={{
          color: "#8a8f98",
          width: { xs: 48, sm: 64 },
          flexShrink: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {issue.identifier}
      </Typography>
      <Box onClick={(e) => e.stopPropagation()} sx={{ display: "flex" }}>
        <StatusPicker
          value={issue.status}
          onChange={(v) => onPatch(issue.id, { status: v, status_set: true })}
        />
      </Box>
      <Typography
        level="body-sm"
        sx={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {issue.title || "Untitled"}
      </Typography>
      {/* Hide labels on xs to prevent overflow */}
      <Box
        sx={{
          display: { xs: "none", sm: "flex" },
          alignItems: "center",
          gap: 0.5,
        }}
      >
        {issueLabels.slice(0, 3).map((l) => (
          <Chip
            key={l.id}
            size="sm"
            variant="soft"
            sx={{
              "--Chip-radius": "6px",
              bgcolor: `${l.color}22`,
              color: l.color,
            }}
          >
            {l.name}
          </Chip>
        ))}
      </Box>
      {(issue.sub_issue_count ?? 0) > 0 && (
        <Chip
          size="sm"
          variant="soft"
          sx={{
            display: { xs: "none", sm: "inline-flex" },
            fontSize: 11,
            "--Chip-radius": "6px",
          }}
        >
          {issue.sub_issue_done_count ?? 0}/{issue.sub_issue_count}
        </Chip>
      )}
      {issue.estimate > 0 && (
        <Chip
          size="sm"
          variant="soft"
          sx={{ display: { xs: "none", sm: "inline-flex" } }}
        >
          {issue.estimate}
        </Chip>
      )}
      {assignee ? (
        <Tooltip title={assignee.name}>
          <Avatar
            sx={{
              "--Avatar-size": "22px",
              bgcolor: avatarColor(assignee.id),
              fontSize: 10,
            }}
          >
            {initials(assignee.name)}
          </Avatar>
        </Tooltip>
      ) : (
        <Box sx={{ width: 22 }} />
      )}
    </Box>
  );
}

// ── Board view ──
function BoardView({
  issues,
  members,
  onOpen,
  onPatch,
}: {
  issues: Issue[];
  members: Member[];
  onOpen: (id: string) => void;
  onPatch: (id: string, p: IssuePatch) => void;
}) {
  const onDrop = (status: string, id: string) =>
    onPatch(id, { status, status_set: true });
  return (
    <Box
      sx={{
        display: "flex",
        gap: 1.5,
        p: 1.5,
        height: "100%",
        alignItems: "flex-start",
        overflowX: "auto",
      }}
    >
      {STATUSES.map((s) => {
        const col = issues.filter((i) => i.status === s.value);
        return (
          <Box
            key={s.value}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("text/issue");
              if (id) onDrop(s.value, id);
            }}
            sx={{
              width: { xs: 240, sm: 280 },
              flexShrink: 0,
              bgcolor: "var(--joy-palette-neutral-50)",
              borderRadius: "8px",
              p: 1,
              maxHeight: "100%",
              overflow: "auto",
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 0.5,
                py: 0.5,
                mb: 0.5,
              }}
            >
              {s.icon(16)}
              <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                {s.label}
              </Typography>
              <Typography level="body-xs" sx={{ color: "#8a8f98" }}>
                {col.length}
              </Typography>
            </Box>
            {col.map((i) => {
              const a = members.find((m) => m.id === i.assignee_id);
              return (
                <Sheet
                  key={i.id}
                  variant="outlined"
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/issue", i.id)
                  }
                  onClick={() => onOpen(i.id)}
                  sx={{
                    p: 1,
                    mb: 0.75,
                    borderRadius: "8px",
                    cursor: "pointer",
                    "&:hover": { borderColor: "primary.outlinedBorder" },
                  }}
                >
                  <Typography
                    level="body-xs"
                    sx={{ color: "#8a8f98", mb: 0.5 }}
                  >
                    {i.identifier}
                  </Typography>
                  <Typography
                    level="body-sm"
                    sx={{
                      mb: 0.5,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {i.title || "Untitled"}
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    {priorityMeta(i.priority).icon(14)}
                    <Box sx={{ flex: 1 }} />
                    {(i.sub_issue_count ?? 0) > 0 && (
                      <Chip
                        size="sm"
                        variant="soft"
                        sx={{
                          fontSize: 10,
                          "--Chip-radius": "5px",
                          "--Chip-paddingInline": "4px",
                          minHeight: "18px",
                        }}
                      >
                        {i.sub_issue_done_count ?? 0}/{i.sub_issue_count}
                      </Chip>
                    )}
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
                </Sheet>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}

// ── Projects view ──
function ProjectsView({
  projects,
  onCreate,
  onDelete,
}: {
  projects: Project[];
  onCreate: (b: Partial<Project>) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [state, setState] = useState("backlog");
  return (
    <Box sx={{ p: 2 }}>
      <Button
        size="sm"
        startDecorator={<AddIcon />}
        sx={{ mb: 2 }}
        onClick={() => {
          setName("");
          setDesc("");
          setState("backlog");
          setOpen(true);
        }}
      >
        New project
      </Button>
      {projects.length === 0 && <Empty text="No projects yet." />}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 1.5,
        }}
      >
        {projects.map((p) => {
          const sm = projectStateMeta(p.state);
          return (
            <Sheet
              key={p.id}
              variant="outlined"
              sx={{ p: 1.5, borderRadius: "10px" }}
            >
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}
              >
                <FolderOutlinedIcon sx={{ color: p.color }} />
                <Typography level="title-sm" sx={{ flex: 1 }}>
                  {p.name}
                </Typography>
                <Dropdown>
                  <MenuButton
                    slots={{ root: IconButton }}
                    slotProps={{
                      root: { size: "sm", variant: "plain", color: "neutral" },
                    }}
                  >
                    ⋯
                  </MenuButton>
                  <Menu size="sm" placement="bottom-end">
                    <MenuItem color="danger" onClick={() => onDelete(p.id)}>
                      <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                      Delete
                    </MenuItem>
                  </Menu>
                </Dropdown>
              </Box>
              {p.description && (
                <Typography level="body-xs" sx={{ color: "#8a8f98", mb: 1 }}>
                  {p.description}
                </Typography>
              )}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Chip
                  size="sm"
                  variant="soft"
                  sx={{ bgcolor: `${sm.color}22`, color: sm.color }}
                >
                  {sm.label}
                </Chip>
                {p.lead_name && (
                  <Typography level="body-xs" sx={{ color: "#8a8f98" }}>
                    {p.lead_name}
                  </Typography>
                )}
                {p.target_date && (
                  <Typography
                    level="body-xs"
                    sx={{ color: "#8a8f98", ml: "auto" }}
                  >
                    {p.target_date}
                  </Typography>
                )}
              </Box>
            </Sheet>
          );
        })}
      </Box>
      <Modal open={open} onClose={() => setOpen(false)}>
        <ModalDialog
          sx={{ width: { xs: "100vw", sm: 460 }, maxWidth: "100vw" }}
        >
          <ModalClose />
          <Typography level="title-lg">New project</Typography>
          <Input
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            sx={{ mt: 1 }}
          />
          <Textarea
            placeholder="Description"
            minRows={2}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            sx={{ mt: 1 }}
          />
          <Dropdown>
            <MenuButton
              slots={{ root: Button }}
              slotProps={{
                root: {
                  variant: "outlined",
                  color: "neutral",
                  size: "sm",
                  sx: { mt: 1, alignSelf: "flex-start" },
                },
              }}
            >
              {projectStateMeta(state).label}
            </MenuButton>
            <Menu size="sm">
              {PROJECT_STATES.map((s) => (
                <MenuItem key={s.value} onClick={() => setState(s.value)}>
                  {s.label}
                </MenuItem>
              ))}
            </Menu>
          </Dropdown>
          <Button
            sx={{ mt: 2 }}
            disabled={!name.trim()}
            onClick={() => {
              onCreate({ name: name.trim(), description: desc, state });
              setOpen(false);
            }}
          >
            Create project
          </Button>
        </ModalDialog>
      </Modal>
    </Box>
  );
}

// ── Labels view ──
function LabelsView({
  labels,
  onCreate,
  onDelete,
}: {
  labels: Label[];
  onCreate: (b: { name: string; color: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);
  return (
    <Box sx={{ p: 2, maxWidth: 560 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Input
          size="sm"
          placeholder="New label name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ flex: 1 }}
        />
        <Dropdown>
          <MenuButton
            slots={{ root: IconButton }}
            slotProps={{
              root: { size: "sm", variant: "outlined", color: "neutral" },
            }}
          >
            <Box
              sx={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                bgcolor: color,
              }}
            />
          </MenuButton>
          <Menu size="sm">
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                gap: 0.5,
                p: 1,
                width: 160,
              }}
            >
              {LABEL_COLORS.map((c) => (
                <Box
                  key={c}
                  onClick={() => setColor(c)}
                  sx={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    bgcolor: c,
                    cursor: "pointer",
                    border: c === color ? "2px solid #000" : "none",
                  }}
                />
              ))}
            </Box>
          </Menu>
        </Dropdown>
        <Button
          size="sm"
          disabled={!name.trim()}
          onClick={() => {
            onCreate({ name: name.trim(), color });
            setName("");
          }}
        >
          Add
        </Button>
      </Box>
      {labels.length === 0 && <Empty text="No labels yet." />}
      {labels.map((l) => (
        <Box
          key={l.id}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            py: 0.75,
            borderBottom: "1px solid",
            borderColor: "divider",
            minHeight: 44,
          }}
        >
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              bgcolor: l.color,
            }}
          />
          <Typography level="body-sm" sx={{ flex: 1 }}>
            {l.name}
          </Typography>
          <IconButton
            size="sm"
            variant="plain"
            color="danger"
            onClick={() => onDelete(l.id)}
          >
            <DeleteOutlineIcon />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}

// ── Filter menu ──
function FilterMenu({
  members,
  fStatus,
  setFStatus,
  fPriority,
  setFPriority,
  fAssignee,
  setFAssignee,
}: {
  members: Member[];
  fStatus: string[];
  setFStatus: (v: string[]) => void;
  fPriority: number[];
  setFPriority: (v: number[]) => void;
  fAssignee: string[];
  setFAssignee: (v: string[]) => void;
}) {
  const count = fStatus.length + fPriority.length + fAssignee.length;
  const tog = <T,>(arr: T[], v: T, set: (x: T[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <Dropdown>
      <MenuButton
        slots={{ root: Button }}
        slotProps={{
          root: {
            size: "sm",
            variant: count ? "soft" : "plain",
            color: "neutral",
            startDecorator: <FilterListIcon sx={{ fontSize: 16 }} />,
          },
        }}
      >
        Filter{count ? ` (${count})` : ""}
      </MenuButton>
      <Menu size="sm" placement="bottom-end" sx={{ minWidth: 220 }}>
        <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, color: "#8a8f98" }}>
          Status
        </Typography>
        {STATUSES.map((s) => (
          <MenuItem
            key={s.value}
            selected={fStatus.includes(s.value)}
            onClick={() => tog(fStatus, s.value, setFStatus)}
          >
            {s.icon(16)}
            {s.label}
          </MenuItem>
        ))}
        <ListDivider />
        <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, color: "#8a8f98" }}>
          Priority
        </Typography>
        {PRIORITIES.map((p) => (
          <MenuItem
            key={p.value}
            selected={fPriority.includes(p.value)}
            onClick={() => tog(fPriority, p.value, setFPriority)}
          >
            {p.icon(16)}
            {p.label}
          </MenuItem>
        ))}
        <ListDivider />
        <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, color: "#8a8f98" }}>
          Assignee
        </Typography>
        {members.map((m) => (
          <MenuItem
            key={m.id}
            selected={fAssignee.includes(m.id)}
            onClick={() => tog(fAssignee, m.id, setFAssignee)}
          >
            <Avatar
              sx={{
                "--Avatar-size": "18px",
                bgcolor: avatarColor(m.id),
                fontSize: 9,
              }}
            >
              {initials(m.name)}
            </Avatar>
            {m.name}
          </MenuItem>
        ))}
        {count > 0 && (
          <>
            <ListDivider />
            <MenuItem
              onClick={() => {
                setFStatus([]);
                setFPriority([]);
                setFAssignee([]);
              }}
            >
              Clear filters
            </MenuItem>
          </>
        )}
      </Menu>
    </Dropdown>
  );
}

// ── New issue modal ──
function NewIssueModal({
  team,
  teams,
  members,
  projects,
  labels,
  onClose,
  onCreate,
}: {
  team: Team;
  teams: Team[];
  members: Member[];
  projects: Project[];
  labels: Label[];
  onClose: () => void;
  onCreate: (b: {
    team_id: string;
    title: string;
    description?: string;
    status?: string;
    priority?: number;
    assignee_id?: string;
    project_id?: string;
    label_ids?: string[];
    estimate?: number;
  }) => void;
}) {
  const [tid, setTid] = useState(team.id);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [status, setStatus] = useState("backlog");
  const [priority, setPriority] = useState(0);
  const [assignee, setAssignee] = useState("");
  const [project, setProject] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const curTeam = teams.find((t) => t.id === tid) || team;

  const submit = () => {
    if (title.trim())
      onCreate({
        team_id: tid,
        title: title.trim(),
        description: desc,
        status,
        priority,
        assignee_id: assignee,
        project_id: project,
        label_ids: labelIds,
      });
  };

  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: { xs: "100vw", sm: 600 }, maxWidth: "100vw" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <Dropdown>
            <MenuButton
              slots={{ root: Button }}
              slotProps={{
                root: { size: "sm", variant: "soft", color: "neutral" },
              }}
            >
              {curTeam.key}
            </MenuButton>
            <Menu size="sm">
              {teams.map((t) => (
                <MenuItem key={t.id} onClick={() => setTid(t.id)}>
                  {t.name}
                </MenuItem>
              ))}
            </Menu>
          </Dropdown>
          <Typography level="body-sm" sx={{ color: "#8a8f98" }}>
            New issue
          </Typography>
          <Box sx={{ flex: 1 }} />
          <ModalClose />
        </Box>
        <Input
          variant="plain"
          placeholder="Issue title"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          sx={{
            "--Input-focusedThickness": "0",
            fontSize: 18,
            fontWeight: 600,
            px: 0,
            "& input": { p: 0 },
          }}
        />
        <Textarea
          variant="plain"
          placeholder="Add description…"
          minRows={3}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          sx={{ "--Textarea-focusedThickness": "0", px: 0, mb: 1 }}
        />
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            gap: 1,
            alignItems: "center",
          }}
        >
          <Chip variant="outlined" startDecorator={statusMeta(status).icon(14)}>
            <StatusPicker value={status} onChange={setStatus} showLabel />
          </Chip>
          <Chip variant="outlined">
            <PriorityPicker value={priority} onChange={setPriority} showLabel />
          </Chip>
          <Chip variant="outlined">
            <AssigneePicker
              members={members}
              value={assignee}
              onChange={setAssignee}
              showLabel
            />
          </Chip>
          <Chip variant="outlined">
            <ProjectPicker
              projects={projects}
              value={project}
              onChange={setProject}
              showLabel
            />
          </Chip>
          <LabelPicker
            labels={labels}
            value={labelIds}
            onChange={setLabelIds}
          />
        </Box>
        <Box
          sx={{ display: "flex", justifyContent: "flex-end", mt: 2, gap: 1 }}
        >
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim()} onClick={submit}>
            Create issue
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// ── Teams management view ──
function TeamsView({
  teams,
  onCreate,
  onUpdate,
  onDelete,
}: {
  teams: Team[];
  onCreate: (b: { name: string; key: string; color?: string }) => void;
  onUpdate: (id: string, b: { name: string; color?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [color, setColor] = useState("#6e79d6");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [membersTeamId, setMembersTeamId] = useState<string | null>(null);

  return (
    <Box sx={{ p: 2 }}>
      <Button
        size="sm"
        startDecorator={<AddIcon />}
        sx={{ mb: 2 }}
        onClick={() => {
          setName("");
          setKey("");
          setColor("#6e79d6");
          setNewOpen(true);
        }}
      >
        New team
      </Button>

      {teams.length === 0 && <Empty text="No teams yet." />}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {teams.map((t) => (
          <Sheet
            key={t.id}
            variant="outlined"
            sx={{ p: 1.5, borderRadius: "10px" }}
          >
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}
            >
              <Box
                sx={{
                  width: 20,
                  height: 20,
                  borderRadius: "5px",
                  bgcolor: t.color,
                  color: "#fff",
                  fontSize: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                }}
              >
                {t.key.slice(0, 2)}
              </Box>
              {editId === t.id ? (
                <Input
                  size="sm"
                  value={editName}
                  autoFocus
                  sx={{ flex: 1 }}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => {
                    if (editName.trim())
                      onUpdate(t.id, { name: editName.trim(), color: t.color });
                    setEditId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (editName.trim())
                        onUpdate(t.id, {
                          name: editName.trim(),
                          color: t.color,
                        });
                      setEditId(null);
                    }
                    if (e.key === "Escape") setEditId(null);
                  }}
                />
              ) : (
                <Typography
                  level="title-sm"
                  sx={{ flex: 1, cursor: "pointer" }}
                  onClick={() => {
                    setEditId(t.id);
                    setEditName(t.name);
                  }}
                >
                  {t.name}{" "}
                  <Typography level="body-xs" sx={{ color: "#8a8f98" }}>
                    ({t.key})
                  </Typography>
                </Typography>
              )}
              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                onClick={() =>
                  setMembersTeamId(membersTeamId === t.id ? null : t.id)
                }
              >
                {membersTeamId === t.id ? "Hide members" : "Members"}
              </Button>
              <Dropdown>
                <MenuButton
                  slots={{ root: IconButton }}
                  slotProps={{
                    root: { size: "sm", variant: "plain", color: "neutral" },
                  }}
                >
                  ⋯
                </MenuButton>
                <Menu size="sm" placement="bottom-end">
                  <MenuItem color="danger" onClick={() => onDelete(t.id)}>
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                    Delete team
                  </MenuItem>
                </Menu>
              </Dropdown>
            </Box>
            {membersTeamId === t.id && <TeamMembersPanel teamId={t.id} />}
          </Sheet>
        ))}
      </Box>

      <Modal open={newOpen} onClose={() => setNewOpen(false)}>
        <ModalDialog
          sx={{ width: { xs: "100vw", sm: 420 }, maxWidth: "100vw" }}
        >
          <ModalClose />
          <Typography level="title-lg">New team</Typography>
          <Input
            placeholder="Team name"
            value={name}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              if (!key) setKey(e.target.value.slice(0, 3).toUpperCase());
            }}
            sx={{ mt: 1 }}
          />
          <Input
            placeholder="Key (e.g. ENG)"
            value={key}
            onChange={(e) =>
              setKey(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 5),
              )
            }
            sx={{ mt: 1 }}
          />
          <Button
            sx={{ mt: 2 }}
            disabled={!name.trim() || !key.trim()}
            onClick={() => {
              onCreate({ name: name.trim(), key, color });
              setNewOpen(false);
            }}
          >
            Create team
          </Button>
        </ModalDialog>
      </Modal>
    </Box>
  );
}

// ── Team members panel (inside TeamsView) ──
function TeamMembersPanel({ teamId }: { teamId: string }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [orgMembers, setOrgMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([listTeamMembers(teamId), listMembers()])
      .then(([tm, om]) => {
        if (!alive) return;
        setMembers(tm);
        setOrgMembers(om);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      alive = false;
    };
  }, [teamId]);

  const handleAdd = async (userId: string) => {
    await addTeamMember(teamId, userId);
    setMembers((ms) => {
      const om = orgMembers.find((o) => o.id === userId);
      if (!om || ms.find((m) => m.user_id === userId)) return ms;
      return [...ms, { user_id: om.id, name: om.name, email: om.email }];
    });
  };

  const handleRemove = async (userId: string) => {
    await removeTeamMember(teamId, userId);
    setMembers((ms) => ms.filter((m) => m.user_id !== userId));
  };

  const nonMembers = orgMembers.filter(
    (o) => !members.find((m) => m.user_id === o.id),
  );

  if (loading)
    return (
      <Box sx={{ pt: 1 }}>
        <CircularProgress size="sm" />
      </Box>
    );

  return (
    <Box sx={{ mt: 1, borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
      <Typography
        level="body-xs"
        sx={{ color: "#8a8f98", mb: 0.5, fontWeight: 600 }}
      >
        MEMBERS
      </Typography>
      {members.length === 0 && (
        <Typography level="body-xs" sx={{ color: "#8a8f98", mb: 0.75 }}>
          No members yet — all org members can be assigned
        </Typography>
      )}
      {members.map((m) => (
        <Box
          key={m.user_id}
          sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5 }}
        >
          <Avatar
            sx={{
              "--Avatar-size": "20px",
              bgcolor: avatarColor(m.user_id),
              fontSize: 10,
            }}
          >
            {initials(m.name)}
          </Avatar>
          <Typography level="body-sm" sx={{ flex: 1 }}>
            {m.name || m.email}
          </Typography>
          <IconButton
            size="sm"
            variant="plain"
            color="danger"
            onClick={() => handleRemove(m.user_id)}
          >
            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      ))}
      {nonMembers.length > 0 && (
        <Box sx={{ mt: 0.75 }}>
          <Typography
            level="body-xs"
            sx={{ color: "#8a8f98", mb: 0.5, fontWeight: 600 }}
          >
            ADD MEMBER
          </Typography>
          {nonMembers.map((o) => (
            <Box
              key={o.id}
              sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5 }}
            >
              <Avatar
                sx={{
                  "--Avatar-size": "20px",
                  bgcolor: avatarColor(o.id),
                  fontSize: 10,
                }}
              >
                {initials(o.name)}
              </Avatar>
              <Typography level="body-sm" sx={{ flex: 1 }}>
                {o.name || o.email}
              </Typography>
              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                onClick={() => handleAdd(o.id)}
              >
                Add
              </Button>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function FirstRun({
  onCreate,
}: {
  onCreate: (name: string, key: string) => void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  return (
    <Box sx={{ maxWidth: 420, mx: "auto", mt: 10, textAlign: "center", px: 2 }}>
      <GroupsIcon sx={{ fontSize: 48, color: "#8a8f98" }} />
      <Typography level="h4" sx={{ mt: 1 }}>
        Create your first team
      </Typography>
      <Typography level="body-sm" sx={{ color: "#8a8f98", mb: 2 }}>
        Teams own issues. Pick a name and a short key (e.g. ENG → ENG-1).
      </Typography>
      <Input
        placeholder="Team name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!key) setKey(e.target.value.slice(0, 3).toUpperCase());
        }}
        sx={{ mb: 1 }}
      />
      <Input
        placeholder="Key (e.g. ENG)"
        value={key}
        onChange={(e) =>
          setKey(
            e.target.value
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "")
              .slice(0, 5),
          )
        }
        sx={{ mb: 2 }}
      />
      <Button
        disabled={!name.trim() || !key.trim()}
        onClick={() => onCreate(name.trim(), key.trim())}
      >
        Create team
      </Button>
    </Box>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Box sx={{ textAlign: "center", color: "#8a8f98", py: 8 }}>
      <Typography level="body-sm">{text}</Typography>
    </Box>
  );
}
