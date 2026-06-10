import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Container,
  Typography,
  Input,
  Sheet,
  IconButton,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Divider,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  Checkbox,
  Modal,
  ModalDialog,
  ModalClose,
  Textarea,
  Button,
  Tooltip,
  Drawer,
} from "@mui/joy";
import SearchIcon from "@mui/icons-material/Search";
import MenuIcon from "@mui/icons-material/Menu";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import UnarchiveOutlinedIcon from "@mui/icons-material/UnarchiveOutlined";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import LabelIcon from "@mui/icons-material/Label";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import CheckBoxOutlinedIcon from "@mui/icons-material/CheckBoxOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CheckIcon from "@mui/icons-material/Check";
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";
import NotificationsOffOutlinedIcon from "@mui/icons-material/NotificationsOffOutlined";
import PeopleOutlinedIcon from "@mui/icons-material/PeopleOutlined";
import PersonAddOutlinedIcon from "@mui/icons-material/PersonAddOutlined";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import { Header } from "../../components/Header";
import { PeopleGrants } from "../../components/PeopleGrants";
import type { User } from "../../api/types";
import {
  listNotes,
  createNote,
  updateNote,
  trashNote,
  listReminders,
  setReminder,
  clearReminder,
  listSharedWithMe,
  listNoteGrants,
  grantNoteAccess,
  revokeNoteAccess,
  listLabels,
  createLabel,
  deleteLabel,
  applyLabel,
  removeLabel,
} from "./api";
import type { Note, NoteInput, ChecklistItem, KeepLabel } from "./types";

// 12 Keep swatches (see docs/google-reference/keep.md color picker).
const COLORS: { name: string; label: string; bg: string }[] = [
  { name: "default", label: "Default", bg: "transparent" },
  { name: "coral", label: "Coral", bg: "#faafa8" },
  { name: "peach", label: "Peach", bg: "#f39f76" },
  { name: "sand", label: "Sand", bg: "#fff8b8" },
  { name: "mint", label: "Mint", bg: "#e2f6d3" },
  { name: "sage", label: "Sage", bg: "#b4ddd3" },
  { name: "fog", label: "Fog", bg: "#d4e4ed" },
  { name: "storm", label: "Storm", bg: "#aeccdc" },
  { name: "dusk", label: "Dusk", bg: "#d3bfdb" },
  { name: "blossom", label: "Blossom", bg: "#f6e2dd" },
  { name: "clay", label: "Clay", bg: "#e9e3d4" },
  { name: "chalk", label: "Chalk", bg: "#efeff1" },
];
const COLOR_BG: Record<string, string> = Object.fromEntries(
  COLORS.map((c) => [c.name, c.bg]),
);
function bgFor(color: string): string {
  return COLOR_BG[color] && color !== "default"
    ? COLOR_BG[color]
    : "transparent";
}

function emptyInput(): NoteInput {
  return {
    title: "",
    body: "",
    color: "default",
    pinned: false,
    archived: false,
    labels: [],
    checklist: [],
  };
}
function toInput(n: Note): NoteInput {
  return {
    title: n.title,
    body: n.body,
    color: n.color || "default",
    pinned: n.pinned,
    archived: n.archived,
    labels: [...n.labels],
    checklist: n.checklist.map((c) => ({ ...c })),
  };
}

// Reminder preset helpers — matching Google Keep's "Remind me" preset list.
function remindLaterToday(): string {
  const d = new Date();
  d.setHours(20, 0, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
function remindTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}
function remindNextWeek(): string {
  const d = new Date();
  const dayOfWeek = d.getDay();
  const daysUntilMonday = (1 - dayOfWeek + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

function formatRemindAt(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type Filter = {
  kind: "notes" | "archive" | "reminders" | "shared-with-me";
  label?: string;
};

interface KeepAppProps {
  user: User;
}

export default function KeepApp({ user }: KeepAppProps) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "notes" });
  const [editing, setEditing] = useState<Note | null>(null);
  const [sharingNote, setSharingNote] = useState<Note | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Managed labels loaded from the server.
  const [managedLabels, setManagedLabels] = useState<KeepLabel[]>([]);
  const [labelManagerOpen, setLabelManagerOpen] = useState(false);
  // Label picker for a specific note (card "Add label" button).
  const [labelPickerNote, setLabelPickerNote] = useState<Note | null>(null);

  async function reloadLabels() {
    try {
      setManagedLabels(await listLabels());
    } catch {
      /* ignore */
    }
  }

  async function reload() {
    try {
      if (filter.kind === "reminders") {
        setNotes(await listReminders());
      } else if (filter.kind === "shared-with-me") {
        setNotes(await listSharedWithMe());
      } else if (filter.kind === "archive") {
        setNotes(await listNotes({ archived: true }));
      } else {
        // Default notes view — server already excludes archived notes.
        const labelId = filter.label
          ? managedLabels.find((l) => l.name === filter.label)?.id
          : undefined;
        setNotes(await listNotes({ archived: false, labelId }));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  // Reload notes + labels whenever filter changes.
  useEffect(() => {
    setNotes(null);
    reloadLabels();
    reload();
  }, [filter.kind, filter.label]); // eslint-disable-line react-hooks/exhaustive-deps
  // Initial labels load.
  useEffect(() => {
    reloadLabels();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    let list = notes ?? [];
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((n) =>
        [n.title, n.body, ...n.labels, ...n.checklist.map((c) => c.text)]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return list;
  }, [notes, filter, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinned = shown.filter((n) => n.pinned);
  const others = shown.filter((n) => !n.pinned);

  // ---- optimistic mutations ----
  function patchLocal(id: string, patch: Partial<Note>) {
    setNotes((cur) =>
      (cur ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)),
    );
  }
  async function togglePin(n: Note) {
    patchLocal(n.id, { pinned: !n.pinned });
    try {
      await updateNote(n.id, { ...toInput(n), pinned: !n.pinned });
    } catch {
      reload();
    }
  }
  async function toggleArchive(n: Note) {
    patchLocal(n.id, { archived: !n.archived });
    try {
      await updateNote(n.id, { ...toInput(n), archived: !n.archived });
    } catch {
      reload();
    }
  }
  async function setColor(n: Note, color: string) {
    patchLocal(n.id, { color });
    try {
      await updateNote(n.id, { ...toInput(n), color });
    } catch {
      reload();
    }
  }
  async function onTrash(n: Note) {
    setNotes((cur) => (cur ?? []).filter((x) => x.id !== n.id));
    try {
      await trashNote(n.id);
    } catch {
      reload();
    }
  }
  async function toggleCheck(n: Note, idx: number) {
    const checklist = n.checklist.map((c, i) =>
      i === idx ? { ...c, checked: !c.checked } : c,
    );
    patchLocal(n.id, { checklist });
    try {
      await updateNote(n.id, { ...toInput(n), checklist });
    } catch {
      reload();
    }
  }

  async function applyLabelToNote(note: Note, label: KeepLabel) {
    // Update JSONB labels on the note (for display chips) and call the junction RPC.
    if (note.labels.includes(label.name)) return;
    const next = [...note.labels, label.name];
    patchLocal(note.id, { labels: next });
    try {
      await applyLabel(note.id, label.id);
      await updateNote(note.id, { ...toInput(note), labels: next });
    } catch {
      reload();
    }
  }
  async function removeLabelFromNote(note: Note, label: KeepLabel) {
    const next = note.labels.filter((n) => n !== label.name);
    patchLocal(note.id, { labels: next });
    try {
      await removeLabel(note.id, label.id);
      await updateNote(note.id, { ...toInput(note), labels: next });
    } catch {
      reload();
    }
  }

  async function onSetReminder(n: Note, isoTime: string) {
    patchLocal(n.id, { remind_at: isoTime });
    try {
      const updated = await setReminder(n.id, isoTime);
      patchLocal(n.id, { remind_at: updated.remind_at });
    } catch {
      reload();
    }
  }
  async function onClearReminder(n: Note) {
    patchLocal(n.id, { remind_at: "" });
    try {
      await clearReminder(n.id);
    } catch {
      reload();
    }
  }

  async function onSave(id: string | null, input: NoteInput) {
    if (id) await updateNote(id, input);
    else if (input.title || input.body || input.checklist.length)
      await createNote(input);
    await reload();
  }

  // Nav sidebar items (desktop + drawer).
  function navItems(onSelect: (f: Filter) => void) {
    return (
      <>
        <ListItem>
          <ListItemButton
            selected={filter.kind === "notes" && !filter.label}
            onClick={() => onSelect({ kind: "notes" })}
          >
            <ListItemDecorator>
              <LightbulbOutlinedIcon />
            </ListItemDecorator>
            Notes
          </ListItemButton>
        </ListItem>
        <ListItem>
          <ListItemButton
            selected={filter.kind === "reminders"}
            onClick={() => onSelect({ kind: "reminders" })}
          >
            <ListItemDecorator>
              <NotificationsOutlinedIcon />
            </ListItemDecorator>
            Reminders
          </ListItemButton>
        </ListItem>
        <ListItem>
          <ListItemButton
            selected={filter.kind === "archive"}
            onClick={() => onSelect({ kind: "archive" })}
          >
            <ListItemDecorator>
              <ArchiveOutlinedIcon />
            </ListItemDecorator>
            Archive
          </ListItemButton>
        </ListItem>
        <ListItem>
          <ListItemButton
            selected={filter.kind === "shared-with-me"}
            onClick={() => onSelect({ kind: "shared-with-me" })}
          >
            <ListItemDecorator>
              <PeopleAltOutlinedIcon />
            </ListItemDecorator>
            Shared with me
          </ListItemButton>
        </ListItem>
        <Divider sx={{ my: 1 }} />
        <Box sx={{ display: "flex", alignItems: "center", px: 1, pb: 0.5 }}>
          <Typography level="body-xs" sx={{ flex: 1, opacity: 0.6 }}>
            Labels
          </Typography>
          <Tooltip title="Manage labels" size="sm">
            <IconButton
              size="sm"
              variant="plain"
              onClick={() => setLabelManagerOpen(true)}
              aria-label="Manage labels"
            >
              <LabelOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
        {managedLabels.map((l) => (
          <ListItem key={l.id}>
            <ListItemButton
              selected={filter.label === l.name}
              onClick={() => onSelect({ kind: "notes", label: l.name })}
            >
              <ListItemDecorator>
                <LabelIcon />
              </ListItemDecorator>
              {l.name}
            </ListItemButton>
          </ListItem>
        ))}
        {managedLabels.length === 0 && (
          <Typography
            level="body-xs"
            sx={{ px: 1, opacity: 0.4, fontStyle: "italic" }}
          >
            No labels yet
          </Typography>
        )}
      </>
    );
  }

  return (
    <>
      <Header user={user} />
      <Container
        maxWidth="lg"
        sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1.5, sm: 3 } }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <IconButton
            variant="plain"
            sx={{ display: { xs: "flex", sm: "none" } }}
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          <Typography
            level="h2"
            sx={{ flex: 1, fontSize: { xs: "xl", sm: "xl3" } }}
          >
            Keep
          </Typography>
          <Input
            size="sm"
            startDecorator={<SearchIcon />}
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ width: { xs: 160, sm: 260 } }}
          />
        </Box>

        {/* Mobile sidebar drawer */}
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          anchor="left"
          size="sm"
        >
          <ModalClose />
          <Typography level="title-lg" sx={{ p: 2, pb: 1 }}>
            Keep
          </Typography>
          <List size="sm" sx={{ "--ListItem-radius": "8px", px: 1 }}>
            {navItems((f) => {
              setFilter(f);
              setDrawerOpen(false);
            })}
          </List>
        </Drawer>

        <Box sx={{ display: "flex", gap: 3 }}>
          {/* Sidebar — desktop only */}
          <Box
            sx={{
              width: 200,
              flexShrink: 0,
              display: { xs: "none", sm: "block" },
            }}
          >
            <List size="sm" sx={{ "--ListItem-radius": "8px" }}>
              {navItems(setFilter)}
            </List>
          </Box>

          {/* Main */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {filter.kind === "notes" && !filter.label && (
              <Box sx={{ maxWidth: 600, mx: "auto", mb: 3 }}>
                <Composer onCreate={(input) => onSave(null, input)} />
              </Box>
            )}

            {filter.kind === "reminders" && (
              <Typography level="body-sm" sx={{ opacity: 0.6, mb: 2 }}>
                Notes with reminders, ordered by soonest first.
              </Typography>
            )}
            {filter.kind === "shared-with-me" && (
              <Typography level="body-sm" sx={{ opacity: 0.6, mb: 2 }}>
                Notes others have shared with you.
              </Typography>
            )}

            {error && (
              <Sheet
                color="danger"
                variant="soft"
                sx={{ p: 2, mb: 2, borderRadius: "md" }}
              >
                <Typography color="danger">
                  Couldn't load notes: {error}
                </Typography>
              </Sheet>
            )}
            {notes === null && !error && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress />
              </Box>
            )}
            {notes !== null && shown.length === 0 && (
              <Sheet
                variant="soft"
                sx={{ p: 4, borderRadius: "md", textAlign: "center" }}
              >
                <Typography level="body-lg" sx={{ opacity: 0.7 }}>
                  {filter.kind === "reminders"
                    ? "No notes with reminders."
                    : filter.kind === "shared-with-me"
                      ? "No notes shared with you yet."
                      : query || filter.label || filter.kind === "archive"
                        ? "No matching notes."
                        : "Notes you add appear here."}
                </Typography>
              </Sheet>
            )}

            {pinned.length > 0 && (
              <>
                <Typography
                  level="body-xs"
                  sx={{
                    opacity: 0.6,
                    mb: 1,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Pinned
                </Typography>
                <MasonryGrid>
                  {pinned.map((n) => (
                    <NoteCard
                      key={n.id}
                      note={n}
                      onOpen={() => setEditing(n)}
                      onPin={() => togglePin(n)}
                      onArchive={() => toggleArchive(n)}
                      onColor={(c) => setColor(n, c)}
                      onTrash={() => onTrash(n)}
                      onLabel={() => setLabelPickerNote(n)}
                      onToggleCheck={(i) => toggleCheck(n, i)}
                      onSetReminder={(iso) => onSetReminder(n, iso)}
                      onClearReminder={() => onClearReminder(n)}
                      onShare={() => setSharingNote(n)}
                    />
                  ))}
                </MasonryGrid>
                {others.length > 0 && (
                  <Typography
                    level="body-xs"
                    sx={{
                      opacity: 0.6,
                      mt: 3,
                      mb: 1,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                    }}
                  >
                    Others
                  </Typography>
                )}
              </>
            )}
            {others.length > 0 && (
              <MasonryGrid>
                {others.map((n) => (
                  <NoteCard
                    key={n.id}
                    note={n}
                    onOpen={() => setEditing(n)}
                    onPin={() => togglePin(n)}
                    onArchive={() => toggleArchive(n)}
                    onColor={(c) => setColor(n, c)}
                    onTrash={() => onTrash(n)}
                    onLabel={() => setLabelPickerNote(n)}
                    onToggleCheck={(i) => toggleCheck(n, i)}
                    onSetReminder={(iso) => onSetReminder(n, iso)}
                    onClearReminder={() => onClearReminder(n)}
                    onShare={() => setSharingNote(n)}
                  />
                ))}
              </MasonryGrid>
            )}
          </Box>
        </Box>
      </Container>

      {editing && (
        <NoteEditor
          note={editing}
          onClose={() => setEditing(null)}
          onSave={(input) => onSave(editing.id, input)}
          onSetReminder={(iso) => onSetReminder(editing, iso)}
          onClearReminder={() => onClearReminder(editing)}
          onShare={() => {
            setSharingNote(editing);
            setEditing(null);
          }}
          managedLabels={managedLabels}
        />
      )}

      {sharingNote && (
        <ShareDialog note={sharingNote} onClose={() => setSharingNote(null)} />
      )}

      {labelManagerOpen && (
        <LabelManagerDialog
          labels={managedLabels}
          onClose={() => setLabelManagerOpen(false)}
          onCreated={async (name) => {
            const l = await createLabel(name);
            setManagedLabels((cur) =>
              [...cur, l].sort((a, b) => a.name.localeCompare(b.name)),
            );
          }}
          onDeleted={async (id) => {
            await deleteLabel(id);
            setManagedLabels((cur) => cur.filter((l) => l.id !== id));
            // If we were filtering by this label, reset to notes.
            if (
              filter.label &&
              managedLabels.find((l) => l.id === id)?.name === filter.label
            ) {
              setFilter({ kind: "notes" });
            }
          }}
        />
      )}

      {labelPickerNote && (
        <LabelPickerDialog
          note={labelPickerNote}
          labels={managedLabels}
          onClose={() => setLabelPickerNote(null)}
          onApply={(label) => applyLabelToNote(labelPickerNote, label)}
          onRemove={(label) => removeLabelFromNote(labelPickerNote, label)}
        />
      )}
    </>
  );
}

// LabelManagerDialog — create and delete named labels.
function LabelManagerDialog({
  labels,
  onClose,
  onCreated,
  onDeleted,
}: {
  labels: KeepLabel[];
  onClose: () => void;
  onCreated: (name: string) => Promise<void>;
  onDeleted: (id: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      await onCreated(name);
      setNewName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: { xs: "100vw", sm: 400 }, maxWidth: "100vw" }}>
        <ModalClose />
        <Typography level="title-md" sx={{ mb: 2 }}>
          Manage labels
        </Typography>
        <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
          <Input
            size="sm"
            placeholder="New label name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            sx={{ flex: 1 }}
          />
          <Button
            size="sm"
            loading={busy}
            onClick={handleCreate}
            disabled={!newName.trim()}
          >
            Add
          </Button>
        </Box>
        {error && (
          <Typography level="body-sm" color="danger" sx={{ mb: 1 }}>
            {error}
          </Typography>
        )}
        {labels.length === 0 && (
          <Typography level="body-sm" sx={{ opacity: 0.6 }}>
            No labels yet. Add one above.
          </Typography>
        )}
        <List size="sm">
          {labels.map((l) => (
            <ListItem
              key={l.id}
              endAction={
                <IconButton
                  size="sm"
                  variant="plain"
                  color="danger"
                  aria-label={`Delete ${l.name}`}
                  onClick={async () => {
                    try {
                      await onDeleted(l.id);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                </IconButton>
              }
            >
              <ListItemDecorator>
                <LabelIcon sx={{ fontSize: 18 }} />
              </ListItemDecorator>
              {l.name}
            </ListItem>
          ))}
        </List>
      </ModalDialog>
    </Modal>
  );
}

// LabelPickerDialog — apply/remove labels on a specific note.
function LabelPickerDialog({
  note,
  labels,
  onClose,
  onApply,
  onRemove,
}: {
  note: Note;
  labels: KeepLabel[];
  onClose: () => void;
  onApply: (label: KeepLabel) => Promise<void>;
  onRemove: (label: KeepLabel) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(label: KeepLabel) {
    setBusy(label.id);
    try {
      if (note.labels.includes(label.name)) await onRemove(label);
      else await onApply(label);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: { xs: "100vw", sm: 340 }, maxWidth: "100vw" }}>
        <ModalClose />
        <Typography level="title-md" sx={{ mb: 2 }}>
          Label note
        </Typography>
        {labels.length === 0 && (
          <Typography level="body-sm" sx={{ opacity: 0.6 }}>
            No labels yet. Create one from the sidebar.
          </Typography>
        )}
        <List size="sm">
          {labels.map((l) => {
            const active = note.labels.includes(l.name);
            return (
              <ListItem key={l.id}>
                <ListItemButton
                  onClick={() => toggle(l)}
                  disabled={busy === l.id}
                  sx={{ borderRadius: "sm" }}
                >
                  <ListItemDecorator>
                    {active ? (
                      <LabelIcon sx={{ fontSize: 18, color: "primary.500" }} />
                    ) : (
                      <LabelOutlinedIcon sx={{ fontSize: 18 }} />
                    )}
                  </ListItemDecorator>
                  <Typography sx={{ flex: 1 }}>{l.name}</Typography>
                  {active && (
                    <CheckIcon sx={{ fontSize: 16, color: "primary.500" }} />
                  )}
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </ModalDialog>
    </Modal>
  );
}

// MasonryGrid — CSS columns give a Keep-style masonry layout without JS.
function MasonryGrid({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        columnGap: 1.5,
        columnWidth: { xs: 160, sm: 240 },
        "& > *": {
          breakInside: "avoid",
          mb: 1.5,
          display: "inline-block",
          width: "100%",
        },
      }}
    >
      {children}
    </Box>
  );
}

// ColorPickerMenu — the 12-swatch color picker, reused by cards and editor.
function ColorPickerMenu({
  value,
  onPick,
}: {
  value: string;
  onPick: (c: string) => void;
}) {
  return (
    <Dropdown>
      <Tooltip title="Background options" size="sm">
        <MenuButton
          slots={{ root: IconButton }}
          slotProps={{
            root: {
              size: "sm",
              variant: "plain",
              "aria-label": "Background options",
            },
          }}
        >
          <PaletteOutlinedIcon />
        </MenuButton>
      </Tooltip>
      <Menu placement="bottom-start" sx={{ maxWidth: 230, p: 0.75 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 0.5,
          }}
        >
          {COLORS.map((c) => (
            <Tooltip key={c.name} title={c.label} size="sm">
              <IconButton
                size="sm"
                aria-label={c.label}
                onClick={() => onPick(c.name)}
                sx={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  bgcolor: c.bg === "transparent" ? "background.surface" : c.bg,
                  border: "2px solid",
                  borderColor: value === c.name ? "primary.500" : "neutral.300",
                  "&:hover": { borderColor: "primary.400" },
                }}
              >
                {value === c.name ? <CheckIcon sx={{ fontSize: 16 }} /> : null}
              </IconButton>
            </Tooltip>
          ))}
        </Box>
      </Menu>
    </Dropdown>
  );
}

// ReminderMenu — the "Remind me" preset + custom picker.
function ReminderMenu({
  remindAt,
  onSet,
  onClear,
}: {
  remindAt: string;
  onSet: (iso: string) => void;
  onClear: () => void;
}) {
  return (
    <Dropdown>
      <Tooltip
        title={remindAt ? `Reminder: ${formatRemindAt(remindAt)}` : "Remind me"}
        size="sm"
      >
        <MenuButton
          slots={{ root: IconButton }}
          slotProps={{
            root: {
              size: "sm",
              variant: "plain",
              "aria-label": "Remind me",
              color: remindAt ? "primary" : "neutral",
            },
          }}
        >
          <NotificationsOutlinedIcon sx={{ fontSize: 18 }} />
        </MenuButton>
      </Tooltip>
      <Menu placement="bottom-start" sx={{ minWidth: 200 }}>
        {remindAt && (
          <MenuItem sx={{ fontSize: "sm", opacity: 0.7 }}>
            <NotificationsOutlinedIcon sx={{ fontSize: 16, mr: 1 }} />
            {formatRemindAt(remindAt)}
          </MenuItem>
        )}
        {remindAt && <ListDivider />}
        <MenuItem onClick={() => onSet(remindLaterToday())}>
          Later today
        </MenuItem>
        <MenuItem onClick={() => onSet(remindTomorrow())}>Tomorrow</MenuItem>
        <MenuItem onClick={() => onSet(remindNextWeek())}>Next week</MenuItem>
        <ListDivider />
        <MenuItem
          onClick={() => {
            // Simple native date-time picker via prompt for now.
            const val = window.prompt(
              "Enter reminder date/time (e.g. 2025-06-10T09:00):",
            );
            if (val) {
              const d = new Date(val);
              if (!isNaN(d.getTime())) onSet(d.toISOString());
              else window.alert("Invalid date/time");
            }
          }}
        >
          Pick date & time…
        </MenuItem>
        {remindAt && <ListDivider />}
        {remindAt && (
          <MenuItem color="danger" onClick={onClear}>
            <ListItemDecorator>
              <NotificationsOffOutlinedIcon />
            </ListItemDecorator>
            Remove reminder
          </MenuItem>
        )}
      </Menu>
    </Dropdown>
  );
}

interface NoteCardProps {
  note: Note;
  onOpen: () => void;
  onPin: () => void;
  onArchive: () => void;
  onColor: (c: string) => void;
  onTrash: () => void;
  onLabel: () => void;
  onToggleCheck: (idx: number) => void;
  onSetReminder: (iso: string) => void;
  onClearReminder: () => void;
  onShare: () => void;
}

function NoteCard({
  note,
  onOpen,
  onPin,
  onArchive,
  onColor,
  onTrash,
  onLabel,
  onToggleCheck,
  onSetReminder,
  onClearReminder,
  onShare,
}: NoteCardProps) {
  const bg = bgFor(note.color);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <Sheet
      variant="outlined"
      data-testid={`note-${note.id}`}
      onClick={onOpen}
      sx={{
        borderRadius: "lg",
        p: 1.5,
        cursor: "pointer",
        position: "relative",
        bgcolor: bg === "transparent" ? undefined : bg,
        "&:hover": { boxShadow: "sm" },
        "&:hover .card-actions": { opacity: 1 },
      }}
    >
      <Box sx={{ position: "absolute", top: 4, right: 4 }} onClick={stop}>
        <IconButton
          size="sm"
          variant="plain"
          onClick={onPin}
          aria-label={note.pinned ? "Unpin note" : "Pin note"}
        >
          {note.pinned ? (
            <PushPinIcon sx={{ fontSize: 18 }} />
          ) : (
            <PushPinOutlinedIcon sx={{ fontSize: 18 }} />
          )}
        </IconButton>
      </Box>

      {note.title && (
        <Typography level="title-sm" sx={{ pr: 3, mb: 0.5, fontWeight: 600 }}>
          {note.title}
        </Typography>
      )}
      {note.body && (
        <Typography
          level="body-sm"
          sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {note.body}
        </Typography>
      )}
      {note.checklist.length > 0 && (
        <List size="sm" sx={{ "--List-gap": "2px", py: 0.5 }} onClick={stop}>
          {note.checklist.slice(0, 12).map((it, i) => (
            <ListItem key={i} sx={{ minBlockSize: 0 }}>
              <Checkbox
                size="sm"
                checked={it.checked}
                onChange={() => onToggleCheck(i)}
                label={
                  <Typography
                    level="body-sm"
                    sx={{
                      textDecoration: it.checked ? "line-through" : "none",
                      opacity: it.checked ? 0.5 : 1,
                    }}
                  >
                    {it.text}
                  </Typography>
                }
              />
            </ListItem>
          ))}
        </List>
      )}
      {note.remind_at && (
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}
          onClick={stop}
        >
          <Chip
            size="sm"
            variant="soft"
            color="primary"
            startDecorator={<NotificationsOutlinedIcon sx={{ fontSize: 14 }} />}
          >
            {formatRemindAt(note.remind_at)}
          </Chip>
        </Box>
      )}
      {note.labels.length > 0 && (
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1 }}>
          {note.labels.map((l) => (
            <Chip
              key={l}
              size="sm"
              variant="soft"
              startDecorator={<LabelOutlinedIcon sx={{ fontSize: 14 }} />}
            >
              {l}
            </Chip>
          ))}
        </Box>
      )}

      <Box
        className="card-actions"
        onClick={stop}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.25,
          mt: 1,
          opacity: { xs: 1, md: 0 },
          transition: "opacity 120ms",
        }}
      >
        <ColorPickerMenu value={note.color || "default"} onPick={onColor} />
        <ReminderMenu
          remindAt={note.remind_at ?? ""}
          onSet={onSetReminder}
          onClear={onClearReminder}
        />
        <Tooltip title={note.archived ? "Unarchive" : "Archive"} size="sm">
          <IconButton
            size="sm"
            variant="plain"
            onClick={onArchive}
            aria-label={note.archived ? "Unarchive" : "Archive"}
          >
            {note.archived ? (
              <UnarchiveOutlinedIcon />
            ) : (
              <ArchiveOutlinedIcon />
            )}
          </IconButton>
        </Tooltip>
        <Dropdown>
          <MenuButton
            slots={{ root: IconButton }}
            slotProps={{
              root: { size: "sm", variant: "plain", "aria-label": "More" },
            }}
          >
            <MoreVertIcon />
          </MenuButton>
          <Menu size="sm" placement="bottom-end">
            <MenuItem onClick={onLabel}>
              <ListItemDecorator>
                <LabelOutlinedIcon />
              </ListItemDecorator>
              Add label
            </MenuItem>
            <MenuItem onClick={onShare}>
              <ListItemDecorator>
                <PeopleOutlinedIcon />
              </ListItemDecorator>
              Share
            </MenuItem>
            <ListDivider />
            <MenuItem color="danger" onClick={onTrash}>
              <ListItemDecorator>
                <DeleteOutlineIcon />
              </ListItemDecorator>
              Delete note
            </MenuItem>
          </Menu>
        </Dropdown>
      </Box>
    </Sheet>
  );
}

// Composer — the always-visible "Take a note…" bar that expands into an editor.
function Composer({
  onCreate,
}: {
  onCreate: (input: NoteInput) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NoteInput>(emptyInput());
  const [checklistMode, setChecklistMode] = useState(false);

  function reset() {
    setDraft(emptyInput());
    setChecklistMode(false);
    setOpen(false);
  }
  async function commit() {
    const cleaned: NoteInput = {
      ...draft,
      checklist: draft.checklist.filter((c) => c.text.trim()),
    };
    if (
      cleaned.title.trim() ||
      cleaned.body.trim() ||
      cleaned.checklist.length
    ) {
      await onCreate(cleaned);
    }
    reset();
  }

  if (!open) {
    return (
      <Sheet
        variant="outlined"
        sx={{
          borderRadius: "md",
          display: "flex",
          alignItems: "center",
          px: 2,
          py: 1,
        }}
      >
        <Input
          variant="plain"
          placeholder="Take a note…"
          sx={{ flex: 1, "--Input-focusedThickness": "0px" }}
          onFocus={() => setOpen(true)}
        />
        <Tooltip title="New list" size="sm">
          <IconButton
            size="sm"
            variant="plain"
            aria-label="New list"
            onClick={() => {
              setChecklistMode(true);
              setDraft((d) => ({
                ...d,
                checklist: [{ text: "", checked: false }],
              }));
              setOpen(true);
            }}
          >
            <CheckBoxOutlinedIcon />
          </IconButton>
        </Tooltip>
      </Sheet>
    );
  }

  return (
    <Sheet
      variant="outlined"
      sx={{ borderRadius: "md", p: 1.5, boxShadow: "sm" }}
    >
      <NoteFields
        draft={draft}
        setDraft={setDraft}
        checklistMode={checklistMode}
        setChecklistMode={setChecklistMode}
        autoFocusBody
      />
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, mt: 1 }}>
        <ColorPickerMenu
          value={draft.color}
          onPick={(c) => setDraft((d) => ({ ...d, color: c }))}
        />
        <Tooltip
          title={checklistMode ? "Hide checkboxes" : "Show checkboxes"}
          size="sm"
        >
          <IconButton
            size="sm"
            variant="plain"
            aria-label="Show checkboxes"
            onClick={() => {
              setChecklistMode((m) => !m);
              setDraft((d) =>
                d.checklist.length
                  ? d
                  : { ...d, checklist: [{ text: "", checked: false }] },
              );
            }}
          >
            <CheckBoxOutlinedIcon />
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Button size="sm" variant="plain" color="neutral" onClick={reset}>
          Cancel
        </Button>
        <Button size="sm" onClick={commit} data-testid="composer-save">
          Done
        </Button>
      </Box>
    </Sheet>
  );
}

// NoteEditor — the full-note edit modal.
function NoteEditor({
  note,
  onClose,
  onSave,
  onSetReminder,
  onClearReminder,
  onShare,
  managedLabels,
}: {
  note: Note;
  onClose: () => void;
  onSave: (input: NoteInput) => Promise<void>;
  onSetReminder: (iso: string) => void;
  onClearReminder: () => void;
  onShare: () => void;
  managedLabels?: KeepLabel[];
}) {
  const [draft, setDraft] = useState<NoteInput>(() => toInput(note));
  const [checklistMode, setChecklistMode] = useState(note.checklist.length > 0);
  const [busy, setBusy] = useState(false);
  const [remindAt, setRemindAt] = useState(note.remind_at ?? "");
  const [showLabelPicker, setShowLabelPicker] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await onSave({
        ...draft,
        checklist: draft.checklist.filter((c) => c.text.trim() || c.checked),
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function handleSetReminder(iso: string) {
    setRemindAt(iso);
    onSetReminder(iso);
  }
  function handleClearReminder() {
    setRemindAt("");
    onClearReminder();
  }

  return (
    <>
      <Modal open onClose={busy ? undefined : onClose}>
        <ModalDialog
          sx={{
            width: { xs: "100vw", sm: 560 },
            maxWidth: "100vw",
            maxHeight: { xs: "100dvh", sm: "90vh" },
            overflowY: "auto",
            borderRadius: { xs: 0, sm: "md" },
            bgcolor:
              bgFor(draft.color) === "transparent"
                ? undefined
                : bgFor(draft.color),
          }}
        >
          <NoteFields
            draft={draft}
            setDraft={setDraft}
            checklistMode={checklistMode}
            setChecklistMode={setChecklistMode}
          />
          {draft.labels.length > 0 && (
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1 }}>
              {draft.labels.map((l) => (
                <Chip
                  key={l}
                  size="sm"
                  variant="soft"
                  endDecorator={
                    <IconButton
                      size="sm"
                      variant="plain"
                      aria-label={`Remove ${l}`}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          labels: d.labels.filter((x) => x !== l),
                        }))
                      }
                    >
                      ×
                    </IconButton>
                  }
                >
                  {l}
                </Chip>
              ))}
            </Box>
          )}
          {remindAt && (
            <Box sx={{ mt: 1 }}>
              <Chip
                size="sm"
                variant="soft"
                color="primary"
                startDecorator={
                  <NotificationsOutlinedIcon sx={{ fontSize: 14 }} />
                }
                endDecorator={
                  <IconButton
                    size="sm"
                    variant="plain"
                    aria-label="Remove reminder"
                    onClick={handleClearReminder}
                  >
                    ×
                  </IconButton>
                }
              >
                {formatRemindAt(remindAt)}
              </Chip>
            </Box>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, mt: 2 }}>
            <ColorPickerMenu
              value={draft.color}
              onPick={(c) => setDraft((d) => ({ ...d, color: c }))}
            />
            <ReminderMenu
              remindAt={remindAt}
              onSet={handleSetReminder}
              onClear={handleClearReminder}
            />
            <Tooltip title={draft.archived ? "Unarchive" : "Archive"} size="sm">
              <IconButton
                size="sm"
                variant="plain"
                aria-label={draft.archived ? "Unarchive" : "Archive"}
                onClick={() =>
                  setDraft((d) => ({ ...d, archived: !d.archived }))
                }
              >
                {draft.archived ? (
                  <UnarchiveOutlinedIcon />
                ) : (
                  <ArchiveOutlinedIcon />
                )}
              </IconButton>
            </Tooltip>
            <Tooltip title={draft.pinned ? "Unpin note" : "Pin note"} size="sm">
              <IconButton
                size="sm"
                variant="plain"
                aria-label={draft.pinned ? "Unpin note" : "Pin note"}
                onClick={() => setDraft((d) => ({ ...d, pinned: !d.pinned }))}
              >
                {draft.pinned ? <PushPinIcon /> : <PushPinOutlinedIcon />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Show checkboxes" size="sm">
              <IconButton
                size="sm"
                variant="plain"
                aria-label="Show checkboxes"
                onClick={() => {
                  setChecklistMode((m) => !m);
                  setDraft((d) =>
                    d.checklist.length
                      ? d
                      : { ...d, checklist: [{ text: "", checked: false }] },
                  );
                }}
              >
                <CheckBoxOutlinedIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Add label" size="sm">
              <IconButton
                size="sm"
                variant="plain"
                aria-label="Add label"
                onClick={() => setShowLabelPicker(true)}
              >
                <LabelOutlinedIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Share note" size="sm">
              <IconButton
                size="sm"
                variant="plain"
                aria-label="Share note"
                onClick={onShare}
              >
                <PersonAddOutlinedIcon />
              </IconButton>
            </Tooltip>
            <Box sx={{ flex: 1 }} />
            <Button
              size="sm"
              variant="plain"
              color="neutral"
              onClick={onClose}
              disabled={busy}
            >
              Close
            </Button>
            <Button
              size="sm"
              loading={busy}
              onClick={save}
              data-testid="editor-save"
            >
              Save
            </Button>
          </Box>
        </ModalDialog>
      </Modal>
      {showLabelPicker && managedLabels && (
        <LabelPickerDialog
          note={{ ...note, labels: draft.labels }}
          labels={managedLabels}
          onClose={() => setShowLabelPicker(false)}
          onApply={async (label) => {
            if (!draft.labels.includes(label.name)) {
              setDraft((d) => ({ ...d, labels: [...d.labels, label.name] }));
            }
          }}
          onRemove={async (label) => {
            setDraft((d) => ({
              ...d,
              labels: d.labels.filter((x) => x !== label.name),
            }));
          }}
        />
      )}
    </>
  );
}

// ShareDialog — wraps PeopleGrants for Keep notes.
function ShareDialog({ note, onClose }: { note: Note; onClose: () => void }) {
  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: { xs: "100vw", sm: 520 }, maxWidth: "100vw" }}>
        <ModalClose />
        <Typography level="title-md" sx={{ mb: 2 }}>
          Share "{note.title || "Untitled"}"
        </Typography>
        <PeopleGrants
          listGrants={() => listNoteGrants(note.id)}
          grantAccess={(userId, role) => grantNoteAccess(note.id, userId, role)}
          revokeAccess={(userId) => revokeNoteAccess(note.id, userId)}
        />
      </ModalDialog>
    </Modal>
  );
}

// NoteFields — shared title/body/checklist editing surface.
function NoteFields({
  draft,
  setDraft,
  checklistMode,
  autoFocusBody,
}: {
  draft: NoteInput;
  setDraft: React.Dispatch<React.SetStateAction<NoteInput>>;
  checklistMode: boolean;
  setChecklistMode: React.Dispatch<React.SetStateAction<boolean>>;
  autoFocusBody?: boolean;
}) {
  function setItem(i: number, patch: Partial<ChecklistItem>) {
    setDraft((d) => ({
      ...d,
      checklist: d.checklist.map((c, idx) =>
        idx === i ? { ...c, ...patch } : c,
      ),
    }));
  }
  function addItem() {
    setDraft((d) => ({
      ...d,
      checklist: [...d.checklist, { text: "", checked: false }],
    }));
  }
  function removeItem(i: number) {
    setDraft((d) => ({
      ...d,
      checklist: d.checklist.filter((_, idx) => idx !== i),
    }));
  }

  return (
    <>
      <Input
        variant="plain"
        placeholder="Title"
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        sx={{ fontWeight: 600, "--Input-focusedThickness": "0px", px: 0 }}
      />
      {checklistMode ? (
        <List size="sm" sx={{ "--List-gap": "2px", mt: 0.5 }}>
          {draft.checklist.map((it, i) => (
            <ListItem key={i} sx={{ minBlockSize: 0 }}>
              <Checkbox
                size="sm"
                checked={it.checked}
                onChange={() => setItem(i, { checked: !it.checked })}
              />
              <Input
                variant="plain"
                placeholder="List item"
                value={it.text}
                onChange={(e) => setItem(i, { text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addItem();
                  }
                }}
                sx={{ flex: 1, ml: 1, "--Input-focusedThickness": "0px" }}
              />
              <IconButton
                size="sm"
                variant="plain"
                aria-label="Remove item"
                onClick={() => removeItem(i)}
              >
                ×
              </IconButton>
            </ListItem>
          ))}
          <ListItem sx={{ minBlockSize: 0 }}>
            <Button size="sm" variant="plain" color="neutral" onClick={addItem}>
              + List item
            </Button>
          </ListItem>
        </List>
      ) : (
        <Textarea
          variant="plain"
          placeholder="Take a note…"
          minRows={2}
          value={draft.body}
          autoFocus={autoFocusBody}
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          sx={{ mt: 0.5, "--Textarea-focusedThickness": "0px", p: 0 }}
        />
      )}
    </>
  );
}
