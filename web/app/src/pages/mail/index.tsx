import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Typography,
  Input,
  IconButton,
  Button,
  Chip,
  CircularProgress,
  Avatar,
  Tooltip,
  Checkbox,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  ListItemDecorator,
  Snackbar,
  Drawer,
  ModalClose,
  Sheet,
} from "@mui/joy";
import SearchIcon from "@mui/icons-material/Search";
import EditIcon from "@mui/icons-material/Edit";
import InboxIcon from "@mui/icons-material/Inbox";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import SendIcon from "@mui/icons-material/Send";
import DraftsIcon from "@mui/icons-material/Drafts";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ReplyIcon from "@mui/icons-material/Reply";
import ForwardIcon from "@mui/icons-material/Forward";
import RefreshIcon from "@mui/icons-material/Refresh";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ReportGmailerrorredIcon from "@mui/icons-material/ReportGmailerrorred";
import SettingsIcon from "@mui/icons-material/Settings";
import MarkEmailReadIcon from "@mui/icons-material/MarkEmailRead";
import MarkEmailUnreadIcon from "@mui/icons-material/MarkEmailUnread";
import LabelIcon from "@mui/icons-material/Label";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import MenuIcon from "@mui/icons-material/Menu";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CodeIcon from "@mui/icons-material/Code";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import BlockIcon from "@mui/icons-material/Block";
import ReportOutlinedIcon from "@mui/icons-material/ReportOutlined";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import TranslateIcon from "@mui/icons-material/Translate";
import PrintIcon from "@mui/icons-material/Print";
import DownloadIcon from "@mui/icons-material/Download";
import {
  listThreads,
  getThread,
  getMessage,
  getRawSource,
  modifyMessage,
  deleteMessage,
  attachmentURL,
  listLabelsWithEntities,
  sendMessage,
} from "./api";
import type {
  MailLabelEntity,
  MailMessage,
  MailThread,
  SendInput,
} from "./types";
import { Compose, type ComposeInit } from "./Compose";
import { RulesDialog } from "./RulesDialog";
import { LabelManagerDialog } from "./LabelManagerDialog";
import { FiltersDialog } from "./FiltersDialog";
import { ChatPanel } from "../chat/ChatPanel";

type FolderId =
  | "inbox"
  | "starred"
  | "snoozed"
  | "sent"
  | "drafts"
  | "spam"
  | "trash";
const FOLDERS: { id: FolderId; name: string; icon: React.ReactNode }[] = [
  { id: "inbox", name: "Inbox", icon: <InboxIcon /> },
  { id: "starred", name: "Starred", icon: <StarIcon /> },
  { id: "snoozed", name: "Snoozed", icon: <AccessTimeIcon /> },
  { id: "sent", name: "Sent", icon: <SendIcon /> },
  { id: "drafts", name: "Drafts", icon: <DraftsIcon /> },
  { id: "spam", name: "Spam", icon: <ReportGmailerrorredIcon /> },
  { id: "trash", name: "Trash", icon: <DeleteOutlineIcon /> },
];

const COLORS = [
  "#3D5A80",
  "#E0777D",
  "#5B9279",
  "#C46B45",
  "#7A5980",
  "#2A9D8F",
  "#D9A441",
  "#1D8348",
];
function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Snooze presets: label -> a function returning the target Date.
const SNOOZE_PRESETS: { label: string; when: () => Date }[] = [
  {
    label: "Later today (3 hours)",
    when: () => new Date(Date.now() + 3 * 3600_000),
  },
  {
    label: "Tomorrow morning",
    when: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(8, 0, 0, 0);
      return d;
    },
  },
  {
    label: "Next week",
    when: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(8, 0, 0, 0);
      return d;
    },
  },
];

const UNDO_SEND_MS = 5000;

interface MailAppProps {
  user: User;
}

export default function MailApp({ user }: MailAppProps) {
  const [folder, setFolder] = useState<FolderId>("inbox");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [labelEntities, setLabelEntities] = useState<MailLabelEntity[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  // open thread (all messages, oldest first) + the representative summary.
  const [openThread, setOpenThread] = useState<{
    summary: MailThread;
    messages: MailMessage[];
  } | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rulesOpen, setRulesOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [labelManagerOpen, setLabelManagerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Undo-send toast state. The pending timeout is held in a ref so Undo can cancel it.
  const [undo, setUndo] = useState<{ subject: string } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const undoCancelled = useRef(false);
  // Mobile: sidebar drawer
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Resolve label color: use named entity color if available, otherwise hash-based.
  const labelColor = (name: string): string => {
    const entity = labelEntities.find((l) => l.name === name);
    return entity?.color ?? colorFor(name);
  };

  const effectiveFolder = labelFilter ? "" : folder;

  const reload = useCallback(async () => {
    setLoading(true);
    setOpenThread(null);
    setSelected(new Set());
    try {
      const opts = { query: search, label: labelFilter ?? undefined };
      const r =
        folder === "starred" && !labelFilter
          ? await listThreads("", { ...opts, starred: true })
          : await listThreads(labelFilter ? "" : folder, opts);
      setThreads(r.threads ?? []);
      setUnread(r.unread ?? {});
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [folder, search, labelFilter]);
  useEffect(() => {
    reload();
  }, [reload]);

  const refreshLabels = useCallback(async () => {
    try {
      const r = await listLabelsWithEntities();
      setLabels(r.labels ?? []);
      setLabelEntities(r.label_objects ?? []);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    refreshLabels();
  }, [refreshLabels]);

  // ---- open / read a thread ----
  async function openThreadFor(t: MailThread) {
    setOpenLoading(true);
    setOpenThread({ summary: t, messages: [] });
    try {
      // getThread is unavailable on the IMAP bridge (no server-side threading);
      // fall back to fetching the single message by id.
      let msgs: MailMessage[] = [];
      try {
        msgs = await getThread(t.thread_id, effectiveFolder || undefined);
      } catch {
        msgs = [];
      }
      const full = msgs.length > 0 ? msgs : [await getMessage(t.latest.id)];
      setOpenThread({ summary: t, messages: full });
      if (t.any_unread) {
        setThreads((cur) =>
          cur.map((x) =>
            x.thread_id === t.thread_id ? { ...x, any_unread: false } : x,
          ),
        );
        setUnread((u) => ({
          ...u,
          [folder]: Math.max(0, (u[folder] || 1) - 1),
        }));
      }
    } catch {
      setOpenThread(null);
    } finally {
      setOpenLoading(false);
    }
  }

  // latest message of the open thread, used for thread-level actions.
  const openLatest = (): MailMessage | null => {
    const t = openThread;
    if (!t || t.messages.length === 0) return null;
    return t.messages[t.messages.length - 1];
  };

  async function toggleStarThread(t: MailThread, e?: React.MouseEvent) {
    e?.stopPropagation();
    const next = !t.starred;
    setThreads((cur) =>
      cur.map((x) =>
        x.thread_id === t.thread_id ? { ...x, starred: next } : x,
      ),
    );
    try {
      await modifyMessage(t.latest.id, {
        is_read: !t.any_unread,
        starred: next,
      });
    } catch {
      reload();
    }
  }
  async function toggleStarMsg(m: MailMessage) {
    const next = !m.starred;
    setOpenThread(
      (cur) =>
        cur && {
          ...cur,
          messages: cur.messages.map((x) =>
            x.id === m.id ? { ...x, starred: next } : x,
          ),
        },
    );
    try {
      await modifyMessage(m.id, { is_read: m.is_read, starred: next });
    } catch {
      /* ignore */
    }
  }

  async function trashThread(t: MailThread) {
    await Promise.all(
      [
        t.latest,
        ...(openThread?.summary.thread_id === t.thread_id
          ? openThread.messages
          : []),
      ]
        .filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i)
        .map((m) =>
          folder === "trash"
            ? deleteMessage(m.id).catch(() => {})
            : modifyMessage(m.id, {
                is_read: true,
                starred: m.starred,
                folder: "trash",
              }).catch(() => {}),
        ),
    );
    setOpenThread(null);
    reload();
  }

  // ---- snooze ----
  async function snooze(ids: string[], until: Date | null) {
    const snooze_until = until ? until.toISOString() : "";
    await Promise.all(
      ids.map((id) =>
        modifyMessage(id, {
          set_snooze: true,
          snooze_until,
          is_read: true,
        }).catch(() => {}),
      ),
    );
    setOpenThread(null);
    setSelected(new Set());
    reload();
  }
  function promptCustomSnooze(ids: string[]) {
    const v = window.prompt("Snooze until (YYYY-MM-DD HH:MM):");
    if (!v) return;
    const d = new Date(v.replace(" ", "T"));
    if (isNaN(d.getTime())) {
      window.alert("Couldn't parse that date/time.");
      return;
    }
    snooze(ids, d);
  }

  // ---- labels ----
  async function applyLabel(m: MailMessage, label: string, add: boolean) {
    const next = add
      ? [...new Set([...m.labels, label])]
      : m.labels.filter((l) => l !== label);
    setOpenThread(
      (cur) =>
        cur && {
          ...cur,
          messages: cur.messages.map((x) =>
            x.id === m.id ? { ...x, labels: next } : x,
          ),
        },
    );
    try {
      await modifyMessage(m.id, {
        is_read: m.is_read,
        starred: m.starred,
        set_labels: true,
        labels: next,
      });
      refreshLabels();
    } catch {
      /* ignore */
    }
  }
  async function createLabel() {
    const name = window.prompt("New label name:");
    if (!name || !name.trim()) return;
    const n = name.trim();
    if (!labels.includes(n))
      setLabels((l) => [...l, n].sort((a, b) => a.localeCompare(b)));
    // Apply to the open message or current selection, if any, so the label persists.
    const m = openLatest();
    if (m) {
      await applyLabel(m, n, true);
    } else if (selected.size > 0) {
      await bulkSet((sm) => ({
        is_read: sm.any_unread === false,
        starred: sm.starred,
        set_labels: true,
        labels: [...new Set([...sm.latest.labels, n])],
      }));
    }
  }

  // ---- bulk selection (operates on thread summaries) ----
  function toggleSel(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  const selectedThreads = () =>
    threads.filter((t) => selected.has(t.thread_id));
  async function bulkSet(
    fn: (t: MailThread) => Parameters<typeof modifyMessage>[1],
  ) {
    const ts = selectedThreads();
    setSelected(new Set());
    await Promise.all(
      ts.map((t) => modifyMessage(t.latest.id, fn(t)).catch(() => {})),
    );
    reload();
  }
  function bulkLabel() {
    const l = window.prompt("Label selected conversations as:");
    if (l && l.trim()) {
      bulkSet((t) => ({
        is_read: !t.any_unread,
        starred: t.starred,
        set_labels: true,
        labels: [...new Set([...t.latest.labels, l.trim()])],
      }));
      refreshLabels();
    }
  }
  async function bulkTrash() {
    const ts = selectedThreads();
    setSelected(new Set());
    await Promise.all(
      ts.map((t) =>
        folder === "trash"
          ? deleteMessage(t.latest.id).catch(() => {})
          : modifyMessage(t.latest.id, {
              is_read: true,
              starred: t.starred,
              folder: "trash",
            }).catch(() => {}),
      ),
    );
    reload();
  }
  function bulkSnooze() {
    snooze(
      selectedThreads().map((t) => t.latest.id),
      SNOOZE_PRESETS[0].when(),
    );
  }

  // ---- undo-send: delay the actual send by UNDO_SEND_MS, show an Undo toast ----
  const deliver = useCallback(
    (input: SendInput): Promise<void> => {
      // Drafts send immediately (no undo window).
      if (input.draft)
        return sendMessage(input).then(() => {
          reload();
        });
      undoCancelled.current = false;
      setUndo({ subject: input.subject || "(no subject)" });
      return new Promise<void>((resolve, reject) => {
        undoTimer.current = window.setTimeout(async () => {
          undoTimer.current = null;
          setUndo(null);
          if (undoCancelled.current) {
            reject(new Error("undo"));
            return;
          }
          try {
            await sendMessage(input);
            reload();
            resolve();
          } catch (e) {
            reject(e as Error);
          }
        }, UNDO_SEND_MS);
      });
    },
    [reload],
  );

  function undoSend() {
    undoCancelled.current = true;
    if (undoTimer.current) {
      window.clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    setUndo(null);
  }
  useEffect(
    () => () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    },
    [],
  );

  function reply(m: MailMessage) {
    setCompose({
      to: m.from_addr,
      subject: m.subject.startsWith("Re:") ? m.subject : `Re: ${m.subject}`,
      body: `\n\n---\nOn ${new Date(m.sent_at).toLocaleString()}, ${m.from_name || m.from_addr} wrote:\n> ${m.body.replace(/\n/g, "\n> ")}`,
    });
  }
  // Per-message ⋮ menu actions (mirrors Gmail's open-message overflow menu).
  async function onMessageAction(action: string, m: MailMessage) {
    const move = async (folder: string, note: string) => {
      await modifyMessage(m.id, {
        is_read: m.is_read,
        starred: m.starred,
        folder,
      }).catch(() => {});
      setNotice(note);
      reload();
    };
    switch (action) {
      case "reply":
        reply(m);
        break;
      case "forward":
        forward(m);
        break;
      case "delete":
        await move("trash", "Moved to Trash");
        break;
      case "unread":
        await modifyMessage(m.id, { is_read: false, starred: m.starred }).catch(
          () => {},
        );
        setOpenThread(null);
        reload();
        break;
      case "spam":
        await move("spam", "Reported spam");
        break;
      case "phishing":
        await move("spam", "Reported phishing");
        break;
      case "block":
        await move("spam", `Blocked ${m.from_name || m.from_addr}`);
        break;
      case "filter":
        setFiltersOpen(true);
        break;
      case "translate":
        setNotice("Translation isn’t available yet.");
        break;
    }
  }

  function forward(m: MailMessage) {
    setCompose({
      subject: m.subject.startsWith("Fwd:") ? m.subject : `Fwd: ${m.subject}`,
      body: `\n\n---------- Forwarded message ----------\nFrom: ${m.from_name || m.from_addr}\nSubject: ${m.subject}\n\n${m.body}`,
    });
  }

  const isSentLike = folder === "sent" || folder === "drafts";
  const peerName = (t: MailThread) =>
    isSentLike
      ? `To: ${t.latest.to_addrs[0] || "(no recipient)"}`
      : t.participants.join(", ") || t.latest.from_addr || "(unknown)";

  const labelMenuItems = (m: MailMessage) => {
    const all = [...new Set([...labels, ...m.labels])].sort((a, b) =>
      a.localeCompare(b),
    );
    if (all.length === 0) return <MenuItem disabled>No labels yet</MenuItem>;
    return all.map((l) => {
      const on = m.labels.includes(l);
      return (
        <MenuItem key={l} onClick={() => applyLabel(m, l, !on)}>
          <Checkbox
            size="sm"
            checked={on}
            sx={{ pointerEvents: "none", mr: 1 }}
          />
          {l}
        </MenuItem>
      );
    });
  };

  // Sidebar content — shared between desktop sidebar and mobile Drawer
  const sidebarContent = (
    <Box sx={{ flex: 1, p: 1.5, overflowY: "auto" }}>
      <Button
        startDecorator={<EditIcon />}
        onClick={() => {
          setCompose({});
          setDrawerOpen(false);
        }}
        sx={{ borderRadius: "xl", px: 2.5, py: 1.25, mb: 2, boxShadow: "sm" }}
      >
        Compose
      </Button>
      {FOLDERS.map((f) => {
        const count =
          f.id === "inbox"
            ? unread.inbox || 0
            : f.id === "snoozed"
              ? unread.snoozed || 0
              : 0;
        const active = !labelFilter && folder === f.id;
        return (
          <Box
            key={f.id}
            onClick={() => {
              setLabelFilter(null);
              setFolder(f.id);
              setDrawerOpen(false);
            }}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              pl: 1.5,
              pr: 1,
              py: 0.75,
              borderRadius: "0 16px 16px 0",
              cursor: "pointer",
              bgcolor: active ? "primary.softBg" : "transparent",
              fontWeight: active ? 700 : 400,
              "&:hover": {
                bgcolor: active ? "primary.softBg" : "background.level1",
              },
            }}
          >
            <Box
              sx={{
                color: active ? "primary.plainColor" : "text.secondary",
                display: "flex",
              }}
            >
              {f.icon}
            </Box>
            <Typography level="body-sm" sx={{ flex: 1, fontWeight: "inherit" }}>
              {f.name}
            </Typography>
            {count > 0 && (
              <Typography level="body-xs" sx={{ fontWeight: 700 }}>
                {count}
              </Typography>
            )}
          </Box>
        );
      })}

      {/* Labels section */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          mt: 2,
          mb: 0.5,
          pl: 1.5,
          pr: 0.5,
        }}
      >
        <Typography
          level="body-xs"
          sx={{
            flex: 1,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            opacity: 0.7,
          }}
        >
          Labels
        </Typography>
        <Tooltip title="Manage labels">
          <IconButton
            size="sm"
            variant="plain"
            onClick={() => setLabelManagerOpen(true)}
            aria-label="Manage labels"
          >
            <AddIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>
      {labels.length === 0 ? (
        <Typography level="body-xs" sx={{ pl: 1.5, opacity: 0.5 }}>
          No labels yet
        </Typography>
      ) : (
        labels.map((l) => {
          const active = labelFilter === l;
          return (
            <Box
              key={l}
              onClick={() => {
                setLabelFilter(l);
                setOpenThread(null);
                setDrawerOpen(false);
              }}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                pl: 1.5,
                pr: 1,
                py: 0.5,
                borderRadius: "0 16px 16px 0",
                cursor: "pointer",
                bgcolor: active ? "primary.softBg" : "transparent",
                fontWeight: active ? 700 : 400,
                "&:hover": {
                  bgcolor: active ? "primary.softBg" : "background.level1",
                },
              }}
            >
              <LabelOutlinedIcon sx={{ fontSize: 18, color: labelColor(l) }} />
              <Typography
                level="body-sm"
                sx={{ flex: 1, fontWeight: "inherit" }}
                noWrap
              >
                {l}
              </Typography>
            </Box>
          );
        })
      )}
    </Box>
  );

  return (
    <>
      <Header user={user} />
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - 56px)",
        }}
      >
        {/* Search bar + quick settings */}
        <Box
          sx={{
            p: 1.5,
            borderBottom: "1px solid",
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          {/* Hamburger: only on mobile */}
          <IconButton
            size="sm"
            variant="plain"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open folders"
            sx={{
              display: { xs: "inline-flex", md: "none" },
              minWidth: 40,
              minHeight: 40,
            }}
          >
            <MenuIcon />
          </IconButton>
          <Input
            size="lg"
            startDecorator={<SearchIcon />}
            placeholder="Search mail"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSearch(query);
            }}
            endDecorator={
              query && (
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={() => {
                    setQuery("");
                    setSearch("");
                  }}
                >
                  ✕
                </IconButton>
              )
            }
            sx={{
              flex: "1 1 720px",
              maxWidth: 720,
              bgcolor: "background.level1",
              borderRadius: "xl",
            }}
          />
          <Box sx={{ flex: 1 }} />
          <Dropdown>
            <MenuButton
              slots={{ root: IconButton }}
              slotProps={{
                root: {
                  variant: "plain",
                  color: "neutral",
                  "aria-label": "Settings",
                },
              }}
            >
              <SettingsIcon />
            </MenuButton>
            <Menu placement="bottom-end" sx={{ minWidth: 220 }}>
              <Typography level="title-sm" sx={{ px: 1.5, py: 0.5 }}>
                Quick settings
              </Typography>
              <ListDivider />
              <MenuItem onClick={() => setFiltersOpen(true)}>
                Mail filters
              </MenuItem>
              <MenuItem onClick={() => setRulesOpen(true)}>
                Rules (legacy)
              </MenuItem>
              <MenuItem onClick={() => setLabelManagerOpen(true)}>
                Manage labels
              </MenuItem>
              <ListDivider />
              <MenuItem disabled>See all settings</MenuItem>
              <MenuItem disabled>Reading pane</MenuItem>
              <MenuItem disabled>Inbox density</MenuItem>
              <MenuItem disabled>Inbox type</MenuItem>
              <MenuItem disabled>Themes</MenuItem>
            </Menu>
          </Dropdown>
        </Box>

        <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Desktop Sidebar — hidden on mobile */}
          <Box
            sx={{
              width: 220,
              flexShrink: 0,
              display: { xs: "none", md: "flex" },
              flexDirection: "column",
              overflowY: "hidden",
            }}
          >
            {sidebarContent}
            {/* Gmail-style Chat panel at the bottom of the left rail */}
            <ChatPanel user={user} />
          </Box>

          {/* Mobile sidebar Drawer */}
          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            size="sm"
            sx={{ display: { xs: "flex", md: "none" } }}
          >
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                overflowY: "auto",
              }}
            >
              <Box
                sx={{ display: "flex", alignItems: "center", px: 1.5, py: 1 }}
              >
                <Typography level="title-sm" sx={{ flex: 1 }}>
                  Mail
                </Typography>
                <ModalClose sx={{ position: "static" }} />
              </Box>
              {sidebarContent}
              <ChatPanel user={user} />
            </Box>
          </Drawer>

          {/* Main: list or reading view */}
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              borderLeft: { xs: "none", md: "1px solid" },
              borderColor: "divider",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* toolbar */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                px: 1.5,
                py: 0.75,
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              {openThread ? (
                <>
                  <IconButton
                    size="sm"
                    variant="plain"
                    onClick={() => setOpenThread(null)}
                    aria-label="Back"
                  >
                    <ArrowBackIcon />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="plain"
                    color="danger"
                    onClick={() => trashThread(openThread.summary)}
                    aria-label="Delete"
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                  <Dropdown>
                    <MenuButton
                      slots={{ root: IconButton }}
                      slotProps={{
                        root: {
                          size: "sm",
                          variant: "plain",
                          "aria-label": "Snooze",
                        },
                      }}
                    >
                      <AccessTimeIcon />
                    </MenuButton>
                    <Menu size="sm" placement="bottom-start">
                      <Typography
                        level="body-xs"
                        sx={{ px: 1.5, py: 0.5, opacity: 0.7 }}
                      >
                        Snooze until…
                      </Typography>
                      {SNOOZE_PRESETS.map((p) => {
                        const m = openLatest();
                        return (
                          <MenuItem
                            key={p.label}
                            onClick={() => m && snooze([m.id], p.when())}
                          >
                            {p.label}
                          </MenuItem>
                        );
                      })}
                      <ListDivider />
                      <MenuItem
                        onClick={() => {
                          const m = openLatest();
                          if (m) promptCustomSnooze([m.id]);
                        }}
                      >
                        Pick date & time…
                      </MenuItem>
                    </Menu>
                  </Dropdown>
                  <Dropdown>
                    <MenuButton
                      slots={{ root: IconButton }}
                      slotProps={{
                        root: {
                          size: "sm",
                          variant: "plain",
                          "aria-label": "Labels",
                        },
                      }}
                    >
                      <LabelIcon />
                    </MenuButton>
                    <Menu
                      size="sm"
                      placement="bottom-start"
                      sx={{ minWidth: 200 }}
                    >
                      <Typography
                        level="body-xs"
                        sx={{ px: 1.5, py: 0.5, opacity: 0.7 }}
                      >
                        Label as
                      </Typography>
                      {openLatest() && labelMenuItems(openLatest()!)}
                      <ListDivider />
                      <MenuItem onClick={createLabel}>
                        <AddIcon sx={{ fontSize: 16, mr: 1 }} />
                        Create new label
                      </MenuItem>
                    </Menu>
                  </Dropdown>
                </>
              ) : selected.size > 0 ? (
                <>
                  <Checkbox
                    size="sm"
                    checked
                    indeterminate
                    onChange={() => setSelected(new Set())}
                    sx={{ mx: 0.5 }}
                  />
                  <Typography level="body-sm" sx={{ mr: 1 }}>
                    {selected.size} selected
                  </Typography>
                  <Tooltip title="Mark read">
                    <IconButton
                      size="sm"
                      variant="plain"
                      onClick={() =>
                        bulkSet((t) => ({ is_read: true, starred: t.starred }))
                      }
                      aria-label="Mark read"
                    >
                      <MarkEmailReadIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Mark unread">
                    <IconButton
                      size="sm"
                      variant="plain"
                      onClick={() =>
                        bulkSet((t) => ({ is_read: false, starred: t.starred }))
                      }
                      aria-label="Mark unread"
                    >
                      <MarkEmailUnreadIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Snooze">
                    <IconButton
                      size="sm"
                      variant="plain"
                      onClick={bulkSnooze}
                      aria-label="Snooze"
                    >
                      <AccessTimeIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Add star">
                    <IconButton
                      size="sm"
                      variant="plain"
                      onClick={() =>
                        bulkSet((t) => ({
                          is_read: !t.any_unread,
                          starred: true,
                        }))
                      }
                      aria-label="Star"
                    >
                      <StarIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Label">
                    <IconButton
                      size="sm"
                      variant="plain"
                      onClick={bulkLabel}
                      aria-label="Label"
                    >
                      <LabelIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="danger"
                      onClick={bulkTrash}
                      aria-label="Delete"
                    >
                      <DeleteOutlineIcon />
                    </IconButton>
                  </Tooltip>
                </>
              ) : (
                <>
                  <IconButton
                    size="sm"
                    variant="plain"
                    onClick={reload}
                    aria-label="Refresh"
                  >
                    <RefreshIcon />
                  </IconButton>
                  <Typography
                    level="body-xs"
                    sx={{ ml: 1, opacity: 0.6, textTransform: "capitalize" }}
                  >
                    {labelFilter ? `Label: ${labelFilter}` : folder}
                  </Typography>
                  {labelFilter && (
                    <IconButton
                      size="sm"
                      variant="plain"
                      onClick={() => {
                        setLabelFilter(null);
                        setFolder("inbox");
                      }}
                      aria-label="Clear label filter"
                    >
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  )}
                </>
              )}
            </Box>

            {/* On mobile: show list OR reading pane, never both */}
            <Box sx={{ flex: 1, overflowY: "auto" }}>
              {loading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                  <CircularProgress />
                </Box>
              ) : openThread ? (
                <ThreadView
                  t={openThread}
                  loading={openLoading}
                  onStar={toggleStarMsg}
                  onReply={reply}
                  onForward={forward}
                  onMessageAction={onMessageAction}
                  resolveColor={labelColor}
                />
              ) : threads.length === 0 ? (
                <Box sx={{ textAlign: "center", py: 8, opacity: 0.6 }}>
                  <Typography level="body-lg">
                    {search
                      ? "No matching mail."
                      : labelFilter
                        ? `No mail labeled "${labelFilter}".`
                        : `No mail in ${folder}.`}
                  </Typography>
                </Box>
              ) : (
                threads.map((t) => (
                  <Box
                    key={t.thread_id}
                    onClick={() => openThreadFor(t)}
                    data-testid={`mail-${t.latest.id}`}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      px: { xs: 1, sm: 2 },
                      py: 1,
                      cursor: "pointer",
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      bgcolor: selected.has(t.thread_id)
                        ? "primary.softBg"
                        : t.any_unread
                          ? "background.body"
                          : "background.level1",
                      "&:hover": { boxShadow: "sm", zIndex: 1 },
                    }}
                  >
                    <Checkbox
                      size="sm"
                      checked={selected.has(t.thread_id)}
                      onChange={() => toggleSel(t.thread_id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Select"
                      sx={{ display: { xs: "none", sm: "inline-flex" } }}
                    />
                    <IconButton
                      size="sm"
                      variant="plain"
                      onClick={(e) => toggleStarThread(t, e)}
                      aria-label="Star"
                    >
                      {t.starred ? (
                        <StarIcon sx={{ color: "#f9ab00", fontSize: 18 }} />
                      ) : (
                        <StarBorderIcon sx={{ fontSize: 18 }} />
                      )}
                    </IconButton>
                    <Typography
                      level="body-sm"
                      sx={{
                        width: { xs: 120, sm: 180 },
                        fontWeight: t.any_unread ? 700 : 400,
                      }}
                      noWrap
                    >
                      {peerName(t)}
                      {t.message_count > 1 && (
                        <Typography
                          component="span"
                          level="body-xs"
                          sx={{ ml: 0.5, opacity: 0.6 }}
                        >
                          ({t.message_count})
                        </Typography>
                      )}
                    </Typography>
                    <Box
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        gap: 1,
                        alignItems: "center",
                      }}
                    >
                      <Typography
                        level="body-sm"
                        sx={{ fontWeight: t.any_unread ? 700 : 400 }}
                        noWrap
                      >
                        {t.latest.subject || "(no subject)"}
                      </Typography>
                      <Typography
                        level="body-sm"
                        sx={{
                          opacity: 0.6,
                          flexShrink: 1,
                          minWidth: 0,
                          display: { xs: "none", sm: "block" },
                        }}
                        noWrap
                      >
                        — {t.latest.snippet}
                      </Typography>
                      {t.labels.map((l) => (
                        <Chip
                          key={l}
                          size="sm"
                          variant="soft"
                          sx={{
                            flexShrink: 0,
                            "--Chip-radius": "6px",
                            bgcolor: "transparent",
                            border: "1px solid",
                            borderColor: labelColor(l),
                            color: labelColor(l),
                            display: { xs: "none", sm: "inline-flex" },
                          }}
                        >
                          {l}
                        </Chip>
                      ))}
                    </Box>
                    {folder === "snoozed" && t.latest.snooze_until && (
                      <Tooltip
                        title={`Snoozed until ${new Date(t.latest.snooze_until).toLocaleString()}`}
                      >
                        <Chip
                          size="sm"
                          variant="soft"
                          color="warning"
                          startDecorator={
                            <AccessTimeIcon sx={{ fontSize: 14 }} />
                          }
                        >
                          {fmtDate(t.latest.snooze_until)}
                        </Chip>
                      </Tooltip>
                    )}
                    <Typography
                      level="body-xs"
                      sx={{
                        width: 56,
                        textAlign: "right",
                        fontWeight: t.any_unread ? 700 : 400,
                        opacity: 0.8,
                      }}
                    >
                      {fmtDate(t.latest.sent_at)}
                    </Typography>
                    <Tooltip title="Snooze">
                      <IconButton
                        className="row-del"
                        size="sm"
                        variant="plain"
                        onClick={(e) => {
                          e.stopPropagation();
                          snooze([t.latest.id], SNOOZE_PRESETS[0].when());
                        }}
                        aria-label="Snooze"
                        sx={{ display: { xs: "none", sm: "inline-flex" } }}
                      >
                        <AccessTimeIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        className="row-del"
                        size="sm"
                        variant="plain"
                        onClick={(e) => {
                          e.stopPropagation();
                          trashThread(t);
                        }}
                        aria-label="Delete"
                        sx={{ display: { xs: "none", sm: "inline-flex" } }}
                      >
                        <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                ))
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {compose !== null && (
        <Compose
          init={compose}
          sendFn={deliver}
          onClose={() => setCompose(null)}
          onSent={() => {
            /* delivery handles reload */
          }}
        />
      )}
      {rulesOpen && <RulesDialog onClose={() => setRulesOpen(false)} />}
      {labelManagerOpen && (
        <LabelManagerDialog
          onClose={() => setLabelManagerOpen(false)}
          onChange={refreshLabels}
        />
      )}
      {filtersOpen && <FiltersDialog onClose={() => setFiltersOpen(false)} />}

      {/* Undo-send toast */}
      <Snackbar
        open={!!undo}
        variant="solid"
        color="neutral"
        autoHideDuration={UNDO_SEND_MS}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        endDecorator={
          <Button
            onClick={undoSend}
            size="sm"
            variant="plain"
            color="primary"
            sx={{ color: "#8ab4f8" }}
          >
            Undo
          </Button>
        }
      >
        Sending "{undo?.subject}"…
      </Snackbar>
      <Snackbar
        open={!!notice}
        variant="soft"
        color="neutral"
        autoHideDuration={3000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        {notice}
      </Snackbar>
    </>
  );
}

// ThreadView renders all messages in a conversation, oldest first. The newest is
// expanded; older messages are collapsed to a one-line summary that expands on click.
function ThreadView({
  t,
  loading,
  onStar,
  onReply,
  onForward,
  onMessageAction,
  resolveColor,
}: {
  t: { summary: MailThread; messages: MailMessage[] };
  loading: boolean;
  onStar: (m: MailMessage) => void;
  onReply: (m: MailMessage) => void;
  onForward: (m: MailMessage) => void;
  onMessageAction: (action: string, m: MailMessage) => void;
  resolveColor?: (name: string) => string;
}) {
  const getColor = resolveColor ?? colorFor;
  const msgs = t.messages;
  const lastIdx = msgs.length - 1;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Per-message "Show original" raw-source inspection.
  const [rawFor, setRawFor] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [rawLoading, setRawLoading] = useState(false);
  async function toggleRaw(m: MailMessage) {
    if (rawFor === m.id) {
      setRawFor(null);
      return;
    }
    setRawFor(m.id);
    setRawText("");
    setRawLoading(true);
    try {
      setRawText(await getRawSource(m.id));
    } catch {
      setRawText("(could not load original source)");
    } finally {
      setRawLoading(false);
    }
  }
  async function downloadEml(m: MailMessage) {
    try {
      const raw = await getRawSource(m.id);
      const blob = new Blob([raw], { type: "message/rfc822" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(m.subject || "message").replace(/[^\w.-]+/g, "_")}.eml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  // The newest message always starts expanded.
  const isOpen = (i: number) => i === lastIdx || expanded.has(i);
  const toggle = (i: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  const subject = useMemo(
    () => msgs.find((m) => m.subject)?.subject || "(no subject)",
    [msgs],
  );

  if (loading && msgs.length === 0) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 860 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <Typography
          level="h4"
          sx={{ flex: 1, fontSize: { xs: "lg", sm: "xl2" } }}
        >
          {subject}
        </Typography>
        {msgs.length > 1 && (
          <Chip size="sm" variant="soft" sx={{ mr: 1 }}>
            {msgs.length} messages
          </Chip>
        )}
      </Box>
      {msgs.map((m, i) => (
        <Box
          key={m.id}
          sx={{
            mb: 2,
            borderBottom: i < lastIdx ? "1px solid" : "none",
            borderColor: "divider",
            pb: 2,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              cursor: i === lastIdx ? "default" : "pointer",
            }}
            onClick={() => {
              if (i !== lastIdx) toggle(i);
            }}
          >
            <Avatar
              size="sm"
              sx={{ bgcolor: colorFor(m.from_addr), color: "#fff" }}
            >
              {(m.from_name || m.from_addr || "?").charAt(0).toUpperCase()}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography level="body-sm" sx={{ fontWeight: 600 }} noWrap>
                {m.from_name || m.from_addr}
              </Typography>
              {isOpen(i) ? (
                <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                  to {m.to_addrs.join(", ") || "me"}
                  {m.cc_addrs.length ? ` · cc ${m.cc_addrs.join(", ")}` : ""}
                </Typography>
              ) : (
                <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
                  {m.snippet}
                </Typography>
              )}
            </Box>
            <Typography level="body-xs" sx={{ opacity: 0.7, flexShrink: 0 }}>
              {new Date(m.sent_at).toLocaleString()}
            </Typography>
            <Dropdown>
              <MenuButton
                slots={{ root: IconButton }}
                slotProps={{
                  root: {
                    size: "sm",
                    variant: "plain",
                    color: "neutral",
                    onClick: (e: React.MouseEvent) => e.stopPropagation(),
                    "aria-label": "More",
                  },
                }}
              >
                <MoreVertIcon />
              </MenuButton>
              <Menu
                placement="bottom-end"
                size="sm"
                onClick={(e) => e.stopPropagation()}
                sx={{ "--ListItemDecorator-size": "28px", minWidth: 240 }}
              >
                <MenuItem onClick={() => onMessageAction("reply", m)}>
                  <ListItemDecorator>
                    <ReplyIcon />
                  </ListItemDecorator>
                  Reply
                </MenuItem>
                <MenuItem onClick={() => onMessageAction("forward", m)}>
                  <ListItemDecorator>
                    <ForwardIcon />
                  </ListItemDecorator>
                  Forward
                </MenuItem>
                <ListDivider />
                <MenuItem onClick={() => onMessageAction("delete", m)}>
                  <ListItemDecorator>
                    <DeleteOutlineIcon />
                  </ListItemDecorator>
                  Delete
                </MenuItem>
                <MenuItem onClick={() => onMessageAction("unread", m)}>
                  <ListItemDecorator>
                    <MarkEmailUnreadIcon />
                  </ListItemDecorator>
                  Mark unread from here
                </MenuItem>
                <ListDivider />
                <MenuItem onClick={() => onMessageAction("block", m)}>
                  <ListItemDecorator>
                    <BlockIcon />
                  </ListItemDecorator>
                  Block &quot;{m.from_name || m.from_addr}&quot;
                </MenuItem>
                <MenuItem onClick={() => onMessageAction("spam", m)}>
                  <ListItemDecorator>
                    <ReportOutlinedIcon />
                  </ListItemDecorator>
                  Report spam
                </MenuItem>
                <MenuItem onClick={() => onMessageAction("phishing", m)}>
                  <ListItemDecorator>
                    <ReportGmailerrorredIcon />
                  </ListItemDecorator>
                  Report phishing
                </MenuItem>
                <ListDivider />
                <MenuItem onClick={() => onMessageAction("filter", m)}>
                  <ListItemDecorator>
                    <FilterAltIcon />
                  </ListItemDecorator>
                  Filter messages like this
                </MenuItem>
                <MenuItem onClick={() => onMessageAction("translate", m)}>
                  <ListItemDecorator>
                    <TranslateIcon />
                  </ListItemDecorator>
                  Translate
                </MenuItem>
                <MenuItem onClick={() => window.print()}>
                  <ListItemDecorator>
                    <PrintIcon />
                  </ListItemDecorator>
                  Print
                </MenuItem>
                <MenuItem onClick={() => downloadEml(m)}>
                  <ListItemDecorator>
                    <DownloadIcon />
                  </ListItemDecorator>
                  Download message
                </MenuItem>
                <MenuItem onClick={() => toggleRaw(m)}>
                  <ListItemDecorator>
                    <CodeIcon />
                  </ListItemDecorator>
                  Show original
                </MenuItem>
              </Menu>
            </Dropdown>
            <IconButton
              size="sm"
              variant="plain"
              onClick={(e) => {
                e.stopPropagation();
                onStar(m);
              }}
              aria-label="Star"
            >
              {m.starred ? (
                <StarIcon sx={{ color: "#f9ab00" }} />
              ) : (
                <StarBorderIcon />
              )}
            </IconButton>
          </Box>
          {isOpen(i) && (
            <>
              {m.labels.length > 0 && (
                <Box sx={{ display: "flex", gap: 0.5, mt: 1, ml: 5 }}>
                  {m.labels.map((l) => (
                    <Chip
                      key={l}
                      size="sm"
                      variant="soft"
                      sx={{
                        bgcolor: "transparent",
                        border: "1px solid",
                        borderColor: getColor(l),
                        color: getColor(l),
                      }}
                    >
                      {l}
                    </Chip>
                  ))}
                </Box>
              )}
              {rawFor === m.id ? (
                <Box sx={{ mt: 1.5, ml: { xs: 0, sm: 5 } }}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      mb: 0.5,
                    }}
                  >
                    <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                      Original message source
                    </Typography>
                    <Box sx={{ display: "flex", gap: 0.5 }}>
                      <Button
                        size="sm"
                        variant="plain"
                        onClick={() =>
                          navigator.clipboard?.writeText(rawText).catch(() => {})
                        }
                      >
                        Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="plain"
                        onClick={() => setRawFor(null)}
                      >
                        Close
                      </Button>
                    </Box>
                  </Box>
                  <Sheet
                    variant="soft"
                    sx={{
                      p: 1.5,
                      borderRadius: "sm",
                      maxHeight: 480,
                      overflow: "auto",
                      fontFamily: "monospace",
                      fontSize: "12px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {rawLoading ? "Loading…" : rawText}
                  </Sheet>
                </Box>
              ) : (
                <Typography
                  sx={{
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.6,
                    mt: 1.5,
                    ml: { xs: 0, sm: 5 },
                    wordBreak: "break-word",
                  }}
                >
                  {m.body}
                </Typography>
              )}
              {m.attachments && m.attachments.length > 0 && (
                <Box sx={{ mt: 2, ml: { xs: 0, sm: 5 } }}>
                  <Typography level="body-xs" sx={{ opacity: 0.6, mb: 0.5 }}>
                    {m.attachments.length} attachment
                    {m.attachments.length === 1 ? "" : "s"}
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {m.attachments.map((a) => (
                      <Chip
                        key={a.id}
                        variant="outlined"
                        startDecorator={
                          <AttachFileIcon sx={{ fontSize: 16 }} />
                        }
                        component="a"
                        href={attachmentURL(a.id)}
                        slotProps={{ root: { download: a.filename } }}
                        sx={{ cursor: "pointer" }}
                      >
                        {a.filename} ({Math.max(1, Math.round(a.size / 1024))}{" "}
                        KB)
                      </Chip>
                    ))}
                  </Box>
                </Box>
              )}
            </>
          )}
        </Box>
      ))}
      <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
        <Button
          variant="outlined"
          color="neutral"
          startDecorator={<ReplyIcon />}
          onClick={() => onReply(msgs[lastIdx])}
          sx={{ minHeight: 40 }}
        >
          Reply
        </Button>
        <Button
          variant="outlined"
          color="neutral"
          startDecorator={<ForwardIcon />}
          onClick={() => onForward(msgs[lastIdx])}
          sx={{ minHeight: 40 }}
        >
          Forward
        </Button>
      </Box>
    </Box>
  );
}
