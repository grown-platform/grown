import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Container,
  Typography,
  Input,
  Sheet,
  Avatar,
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
  LinearProgress,
  Alert,
  Stack,
  Drawer,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import PersonIcon from "@mui/icons-material/Person";
import LabelIcon from "@mui/icons-material/Label";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SettingsIcon from "@mui/icons-material/Settings";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import CloseIcon from "@mui/icons-material/Close";
import MenuIcon from "@mui/icons-material/Menu";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import MergeIcon from "@mui/icons-material/Merge";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import GroupIcon from "@mui/icons-material/Group";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listContacts,
  createContact,
  updateContact,
  trashContact,
  listContactGroups,
  createContactGroup,
  updateContactGroup,
  deleteContactGroup,
  addContactsToGroup,
  removeContactFromGroup,
  exportVCardServer,
} from "./api";
import type { Contact, ContactInput, ContactGroup } from "./types";
import { ContactDialog } from "./ContactDialog";
import {
  parseVCards,
  isMeaningful,
  toCreateInput,
  findDuplicates,
  mergeContacts,
  type ParsedContact,
  type DuplicateGroup,
} from "./vcard";
import { parseGoogleCSV } from "./googlecsv";

const AVATAR_COLORS = [
  "#3D5A80",
  "#E0777D",
  "#5B9279",
  "#C46B45",
  "#7A5980",
  "#2A9D8F",
  "#D9A441",
  "#1D8348",
  "#B5230D",
  "#6C5CE7",
];
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function nameOf(c: Contact): string {
  return (
    c.display_name ||
    `${c.first_name} ${c.last_name}`.trim() ||
    c.emails[0] ||
    "(no name)"
  );
}
function initials(c: Contact): string {
  const n = nameOf(c);
  const parts = n.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}
function toInput(c: Contact): ContactInput {
  return {
    display_name: c.display_name,
    first_name: c.first_name,
    last_name: c.last_name,
    company: c.company,
    job_title: c.job_title,
    emails: [...c.emails],
    phones: [...c.phones],
    labels: [...c.labels],
    notes: c.notes,
    starred: c.starred,
  };
}

interface ContactsAppProps {
  user: User;
}

type FilterKind = "all" | "starred" | "label" | "group";
interface Filter {
  kind: FilterKind;
  label?: string;
  groupId?: string;
  groupName?: string;
}

export default function ContactsApp({ user }: ContactsAppProps) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [editing, setEditing] = useState<Contact | null | "new">(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customLabels, setCustomLabels] = useState<string[]>([]);
  const [multiOpen, setMultiOpen] = useState(false);
  const [importParsed, setImportParsed] = useState<ParsedContact[] | null>(
    null,
  );
  const [importSource, setImportSource] = useState<"apple" | "google" | "file">(
    "file",
  );
  const [mergeOpen, setMergeOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    try {
      setContacts(await listContacts());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function reloadGroups() {
    try {
      setGroups(await listContactGroups());
    } catch {
      /* non-fatal */
    }
  }
  useEffect(() => {
    reload();
    reloadGroups();
  }, []);

  const labels = useMemo(() => {
    const s = new Set<string>(customLabels);
    (contacts ?? []).forEach((c) => c.labels.forEach((l) => s.add(l)));
    return [...s].sort();
  }, [contacts, customLabels]);

  const duplicateGroups = useMemo(
    () => findDuplicates(contacts ?? []),
    [contacts],
  );
  const dupCount = useMemo(
    () => duplicateGroups.reduce((n, g) => n + (g.contacts.length - 1), 0),
    [duplicateGroups],
  );

  // For group/starred filters we load from the server to keep it consistent.
  const shown = useMemo(() => {
    let list = contacts ?? [];
    if (filter.kind === "starred") list = list.filter((c) => c.starred);
    if (filter.kind === "label" && filter.label)
      list = list.filter((c) => c.labels.includes(filter.label!));
    if (filter.kind === "group" && filter.groupId) {
      // Group filtering is done server-side via listContacts({groupId}).
      // contacts is already the filtered set; no additional local filtering needed.
    }
    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter((c) =>
        [
          nameOf(c),
          c.company,
          c.job_title,
          ...c.emails,
          ...c.phones,
          ...c.labels,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    return list;
  }, [contacts, filter, query]);

  // When filter changes to a group, reload contacts filtered by that group.
  useEffect(() => {
    if (filter.kind === "group" && filter.groupId) {
      setContacts(null);
      listContacts({ groupId: filter.groupId })
        .then(setContacts)
        .catch((e) => setError((e as Error).message));
    } else if (filter.kind === "starred") {
      setContacts(null);
      listContacts({ starredOnly: true })
        .then(setContacts)
        .catch((e) => setError((e as Error).message));
    } else if (filter.kind === "all" || filter.kind === "label") {
      setContacts(null);
      listContacts()
        .then(setContacts)
        .catch((e) => setError((e as Error).message));
    }
  }, [filter]);

  async function toggleStar(c: Contact) {
    setContacts((cur) =>
      (cur ?? []).map((x) =>
        x.id === c.id ? { ...x, starred: !x.starred } : x,
      ),
    );
    try {
      await updateContact(c.id, { ...toInput(c), starred: !c.starred });
    } catch {
      reload();
    }
  }
  async function onSave(input: ContactInput) {
    if (editing && editing !== "new") await updateContact(editing.id, input);
    else await createContact(input);
    await reload();
  }
  async function onTrash(c: Contact) {
    setContacts((cur) => (cur ?? []).filter((x) => x.id !== c.id));
    try {
      await trashContact(c.id);
    } catch {
      reload();
    }
  }

  // ---- selection ----
  const sel = (id: string) => selected.has(id);
  function toggleSel(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function clearSel() {
    setSelected(new Set());
  }
  function selectAllShown() {
    setSelected(new Set(shown.map((c) => c.id)));
  }
  const selectedContacts = (contacts ?? []).filter((c) => selected.has(c.id));

  // ---- label ops ----
  async function addToLabel(cs: Contact[], label: string) {
    if (!label) return;
    if (!labels.includes(label))
      setCustomLabels((l) => [...new Set([...l, label])]);
    await Promise.all(
      cs
        .filter((c) => !c.labels.includes(label))
        .map((c) =>
          updateContact(c.id, {
            ...toInput(c),
            labels: [...c.labels, label],
          }).catch(() => {}),
        ),
    );
    await reload();
  }
  function promptAddToLabel(cs: Contact[]) {
    const existing = labels.length ? `\n\nExisting: ${labels.join(", ")}` : "";
    const l = window.prompt(`Add ${cs.length} contact(s) to label:${existing}`);
    if (l && l.trim()) addToLabel(cs, l.trim());
  }
  async function renameLabel(old: string) {
    const next = window.prompt("Rename label", old);
    if (!next || next === old) return;
    setCustomLabels((l) => l.map((x) => (x === old ? next : x)));
    const affected = (contacts ?? []).filter((c) => c.labels.includes(old));
    await Promise.all(
      affected.map((c) =>
        updateContact(c.id, {
          ...toInput(c),
          labels: c.labels.map((x) => (x === old ? next : x)),
        }).catch(() => {}),
      ),
    );
    if (filter.kind === "label" && filter.label === old)
      setFilter({ kind: "label", label: next });
    await reload();
  }
  async function deleteLabel(label: string) {
    if (!window.confirm(`Delete label "${label}"? Contacts are kept.`)) return;
    setCustomLabels((l) => l.filter((x) => x !== label));
    const affected = (contacts ?? []).filter((c) => c.labels.includes(label));
    await Promise.all(
      affected.map((c) =>
        updateContact(c.id, {
          ...toInput(c),
          labels: c.labels.filter((x) => x !== label),
        }).catch(() => {}),
      ),
    );
    if (filter.kind === "label" && filter.label === label)
      setFilter({ kind: "all" });
    await reload();
  }
  function createLabel() {
    const l = window.prompt("New label name");
    if (l && l.trim() && !labels.includes(l.trim()))
      setCustomLabels((cur) => [...cur, l.trim()]);
  }

  // ---- group ops ----
  async function handleCreateGroup() {
    const name = window.prompt("New group name");
    if (!name?.trim()) return;
    try {
      await createContactGroup(name.trim());
      await reloadGroups();
    } catch (e) {
      window.alert(`Failed: ${(e as Error).message}`);
    }
  }
  async function handleRenameGroup(g: ContactGroup) {
    const next = window.prompt("Rename group", g.name);
    if (!next || next === g.name) return;
    try {
      await updateContactGroup(g.id, next.trim());
      await reloadGroups();
      if (filter.kind === "group" && filter.groupId === g.id) {
        setFilter({ kind: "group", groupId: g.id, groupName: next.trim() });
      }
    } catch (e) {
      window.alert(`Failed: ${(e as Error).message}`);
    }
  }
  async function handleDeleteGroup(g: ContactGroup) {
    if (!window.confirm(`Delete group "${g.name}"? Contacts are kept.`)) return;
    try {
      await deleteContactGroup(g.id);
      await reloadGroups();
      if (filter.kind === "group" && filter.groupId === g.id)
        setFilter({ kind: "all" });
    } catch (e) {
      window.alert(`Failed: ${(e as Error).message}`);
    }
  }
  async function promptAddToGroup(cs: Contact[]) {
    if (!groups.length) {
      window.alert("No groups yet. Create a group first.");
      return;
    }
    const names = groups.map((g, i) => `${i + 1}. ${g.name}`).join("\n");
    const raw = window.prompt(
      `Add ${cs.length} contact(s) to group:\n${names}`,
    );
    if (!raw) return;
    const idx = parseInt(raw, 10) - 1;
    const g = groups[idx];
    if (!g) {
      window.alert("Invalid selection.");
      return;
    }
    try {
      await addContactsToGroup(
        g.id,
        cs.map((c) => c.id),
      );
    } catch (e) {
      window.alert(`Failed: ${(e as Error).message}`);
    }
  }
  async function handleRemoveFromCurrentGroup(c: Contact) {
    if (filter.kind !== "group" || !filter.groupId) return;
    try {
      await removeContactFromGroup(filter.groupId, c.id);
      setContacts((cur) => (cur ?? []).filter((x) => x.id !== c.id));
    } catch (e) {
      window.alert(`Failed: ${(e as Error).message}`);
    }
  }

  // ---- vCard export (server-side) ----
  async function exportVCard(cs: Contact[]) {
    if (!cs.length) return;
    setExportBusy(true);
    try {
      const vcf = await exportVCardServer({ contactIds: cs.map((c) => c.id) });
      const blob = new Blob([vcf], { type: "text/vcard" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "contacts.vcf";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      window.alert(`Export failed: ${(e as Error).message}`);
    } finally {
      setExportBusy(false);
    }
  }
  async function exportAllVCard() {
    setExportBusy(true);
    try {
      const opts =
        filter.kind === "group" && filter.groupId
          ? { groupId: filter.groupId }
          : {};
      const vcf = await exportVCardServer(opts);
      const blob = new Blob([vcf], { type: "text/vcard" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "contacts.vcf";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      window.alert(`Export failed: ${(e as Error).message}`);
    } finally {
      setExportBusy(false);
    }
  }

  function emailAll(cs: Contact[]) {
    const to = cs
      .map((c) => c.emails[0])
      .filter(Boolean)
      .join(",");
    if (to) window.open(`mailto:${to}`);
  }
  async function bulkDelete(cs: Contact[]) {
    if (!window.confirm(`Delete ${cs.length} contact(s)?`)) return;
    const ids = new Set(cs.map((c) => c.id));
    setContacts((cur) => (cur ?? []).filter((c) => !ids.has(c.id)));
    clearSel();
    await Promise.all(cs.map((c) => trashContact(c.id).catch(() => {})));
  }

  // ---- import: Apple (.vcf) or Google (.vcf or .csv) ----
  // Opens the file picker and records the intent so the dialog can show the right title.
  function openImportPicker(source: "apple" | "google" | "file") {
    setImportSource(source);
    fileRef.current?.click();
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      window.alert("Couldn’t read the file.");
      return;
    }

    // Auto-detect format: vCard files start with BEGIN:VCARD (after optional BOM/whitespace).
    const trimmed = text.trimStart();
    let parsed: ParsedContact[];
    if (trimmed.toUpperCase().startsWith("BEGIN:VCARD")) {
      parsed = parseVCards(text).filter(isMeaningful);
      if (!parsed.length) {
        window.alert("No contacts found in that .vcf file.");
        return;
      }
    } else {
      // Treat as Google CSV.
      try {
        parsed = parseGoogleCSV(text);
      } catch {
        window.alert(
          "Couldn’t parse the file. Expected a .vcf (vCard) or Google Contacts CSV (.csv) file.",
        );
        return;
      }
      if (!parsed.length) {
        window.alert(
          "No contacts found in that CSV file. Make sure it is a Google Contacts export.",
        );
        return;
      }
    }

    setImportParsed(parsed);
  }

  // ---- merge ----
  async function doMerge(primary: Contact, others: Contact[]) {
    const merged = mergeContacts(primary, others);
    await updateContact(primary.id, merged);
    await Promise.all(others.map((c) => trashContact(c.id).catch(() => {})));
  }
  function mergeSelected() {
    if (selectedContacts.length < 2) return;
    const [primary, ...others] = selectedContacts;
    const names = [primary, ...others].map(nameOf).join(", ");
    if (
      !window.confirm(
        `Merge ${selectedContacts.length} contacts into "${nameOf(primary)}"?\n\n${names}`,
      )
    )
      return;
    doMerge(primary, others).then(() => {
      clearSel();
      reload();
    });
  }

  // ---- sidebar content (shared desktop + mobile) ----
  function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <List size="sm" sx={{ "--ListItem-radius": "8px" }}>
        <ListItem>
          <ListItemButton
            selected={filter.kind === "all"}
            onClick={() => {
              setFilter({ kind: "all" });
              onNavigate?.();
            }}
          >
            <ListItemDecorator>
              <PersonIcon />
            </ListItemDecorator>
            Contacts
          </ListItemButton>
        </ListItem>
        <ListItem>
          <ListItemButton
            selected={filter.kind === "starred"}
            onClick={() => {
              setFilter({ kind: "starred" });
              onNavigate?.();
            }}
          >
            <ListItemDecorator>
              <StarIcon />
            </ListItemDecorator>
            Starred
          </ListItemButton>
        </ListItem>
        <ListItem>
          <ListItemButton
            onClick={() => {
              setMergeOpen(true);
              onNavigate?.();
            }}
            data-testid="merge-duplicates"
          >
            <ListItemDecorator>
              <MergeIcon />
            </ListItemDecorator>
            <Box sx={{ flex: 1 }}>Merge &amp; fix</Box>
            {dupCount > 0 && (
              <Chip size="sm" color="warning" variant="soft">
                {dupCount}
              </Chip>
            )}
          </ListItemButton>
        </ListItem>

        {/* Labels section */}
        {labels.length > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography level="body-xs" sx={{ px: 1, pb: 0.5, opacity: 0.6 }}>
              Labels
            </Typography>
            {labels.map((l) => (
              <ListItem
                key={l}
                sx={{ "&:hover .label-actions": { opacity: 1 } }}
                endAction={
                  <Dropdown>
                    <MenuButton
                      className="label-actions"
                      slots={{ root: IconButton }}
                      slotProps={{
                        root: {
                          size: "sm",
                          variant: "plain",
                          sx: { opacity: { xs: 1, md: 0 } },
                          "aria-label": `Options for ${l}`,
                        },
                      }}
                    >
                      <MoreVertIcon />
                    </MenuButton>
                    <Menu size="sm" placement="bottom-end">
                      <MenuItem onClick={() => renameLabel(l)}>
                        Rename label
                      </MenuItem>
                      <MenuItem color="danger" onClick={() => deleteLabel(l)}>
                        Delete label
                      </MenuItem>
                    </Menu>
                  </Dropdown>
                }
              >
                <ListItemButton
                  selected={filter.kind === "label" && filter.label === l}
                  onClick={() => {
                    setFilter({ kind: "label", label: l });
                    onNavigate?.();
                  }}
                >
                  <ListItemDecorator>
                    <LabelIcon />
                  </ListItemDecorator>
                  {l}
                </ListItemButton>
              </ListItem>
            ))}
          </>
        )}

        {/* Groups section */}
        {groups.length > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography level="body-xs" sx={{ px: 1, pb: 0.5, opacity: 0.6 }}>
              Groups
            </Typography>
            {groups.map((g) => (
              <ListItem
                key={g.id}
                sx={{ "&:hover .group-actions": { opacity: 1 } }}
                endAction={
                  <Dropdown>
                    <MenuButton
                      className="group-actions"
                      slots={{ root: IconButton }}
                      slotProps={{
                        root: {
                          size: "sm",
                          variant: "plain",
                          sx: { opacity: { xs: 1, md: 0 } },
                          "aria-label": `Options for ${g.name}`,
                        },
                      }}
                    >
                      <MoreVertIcon />
                    </MenuButton>
                    <Menu size="sm" placement="bottom-end">
                      <MenuItem onClick={() => handleRenameGroup(g)}>
                        Rename group
                      </MenuItem>
                      <MenuItem
                        color="danger"
                        onClick={() => handleDeleteGroup(g)}
                      >
                        Delete group
                      </MenuItem>
                    </Menu>
                  </Dropdown>
                }
              >
                <ListItemButton
                  selected={filter.kind === "group" && filter.groupId === g.id}
                  onClick={() => {
                    setFilter({
                      kind: "group",
                      groupId: g.id,
                      groupName: g.name,
                    });
                    onNavigate?.();
                  }}
                >
                  <ListItemDecorator>
                    <GroupIcon />
                  </ListItemDecorator>
                  {g.name}
                </ListItemButton>
              </ListItem>
            ))}
          </>
        )}
      </List>
    );
  }

  return (
    <>
      <Header user={user} />
      <Container
        maxWidth="lg"
        sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1.5, sm: 3 } }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            mb: 3,
            flexWrap: "wrap",
          }}
        >
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
            {filter.kind === "group" && filter.groupName
              ? filter.groupName
              : "Contacts"}
          </Typography>
          <Input
            size="sm"
            startDecorator={<SearchIcon />}
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{
              width: { xs: "100%", sm: 260 },
              order: { xs: 10, sm: "unset" },
            }}
          />
          <Dropdown>
            <MenuButton
              variant="solid"
              color="primary"
              startDecorator={<AddIcon />}
              data-testid="new-contact"
            >
              Create contact
            </MenuButton>
            <Menu placement="bottom-end">
              <MenuItem onClick={() => setEditing("new")}>
                Create a contact
              </MenuItem>
              <MenuItem onClick={() => setMultiOpen(true)}>
                Create multiple contacts
              </MenuItem>
              <MenuItem
                onClick={() => openImportPicker("apple")}
                data-testid="import-apple"
              >
                <ListItemDecorator>
                  <UploadFileIcon />
                </ListItemDecorator>
                Import from Apple Contacts (.vcf)
              </MenuItem>
              <MenuItem
                onClick={() => openImportPicker("google")}
                data-testid="import-google"
              >
                <ListItemDecorator>
                  <UploadFileIcon />
                </ListItemDecorator>
                Import from Google Contacts (.vcf or .csv)
              </MenuItem>
              <ListDivider />
              <MenuItem onClick={createLabel}>Create a label</MenuItem>
              <MenuItem onClick={handleCreateGroup}>Create a group</MenuItem>
            </Menu>
          </Dropdown>
          <input
            ref={fileRef}
            type="file"
            accept=".vcf,.csv,text/vcard,text/x-vcard,text/csv"
            hidden
            onChange={onPickFile}
            aria-hidden="true"
            tabIndex={-1}
          />
          <IconButton
            variant="plain"
            color="neutral"
            loading={exportBusy}
            onClick={exportAllVCard}
            aria-label="Export contacts as .vcf"
            title={
              filter.kind === "group" && filter.groupName
                ? `Export group "${filter.groupName}"`
                : "Export all contacts"
            }
          >
            <FileDownloadIcon />
          </IconButton>
          <Dropdown>
            <MenuButton
              slots={{ root: IconButton }}
              slotProps={{
                root: {
                  variant: "plain",
                  color: "neutral",
                  "aria-label": "Settings menu",
                },
              }}
            >
              <SettingsIcon />
            </MenuButton>
            <Menu placement="bottom-end">
              <MenuItem disabled>Delegate access</MenuItem>
              <MenuItem disabled>Undo changes</MenuItem>
              <MenuItem disabled>More settings</MenuItem>
            </Menu>
          </Dropdown>
          <Dropdown>
            <MenuButton
              slots={{ root: IconButton }}
              slotProps={{
                root: {
                  variant: "plain",
                  color: "neutral",
                  "aria-label": "Help menu",
                },
              }}
            >
              <HelpOutlineIcon />
            </MenuButton>
            <Menu placement="bottom-end">
              <MenuItem disabled>How to sync contacts</MenuItem>
              <MenuItem disabled>Help</MenuItem>
              <MenuItem disabled>Training</MenuItem>
              <MenuItem disabled>Send feedback</MenuItem>
            </Menu>
          </Dropdown>
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
            Contacts
          </Typography>
          <SidebarContent onNavigate={() => setDrawerOpen(false)} />
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
            <SidebarContent />
          </Box>

          {/* Main */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Bulk-selection toolbar */}
            {selected.size > 0 && (
              <Sheet
                variant="soft"
                color="primary"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  mb: 1,
                  borderRadius: "md",
                }}
              >
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={clearSel}
                  aria-label="Clear selection"
                >
                  <CloseIcon />
                </IconButton>
                <Typography level="body-sm" sx={{ flex: 1, minWidth: 60 }}>
                  {selected.size} selected
                </Typography>
                <Button
                  size="sm"
                  variant="plain"
                  startDecorator={<LabelIcon />}
                  onClick={() => promptAddToLabel(selectedContacts)}
                >
                  Label
                </Button>
                <Button
                  size="sm"
                  variant="plain"
                  startDecorator={<GroupIcon />}
                  onClick={() => promptAddToGroup(selectedContacts)}
                >
                  Group
                </Button>
                <Button
                  size="sm"
                  variant="plain"
                  onClick={() => emailAll(selectedContacts)}
                >
                  Email
                </Button>
                <Button
                  size="sm"
                  variant="plain"
                  startDecorator={<MergeIcon />}
                  disabled={selected.size < 2}
                  onClick={mergeSelected}
                >
                  Merge
                </Button>
                <Button
                  size="sm"
                  variant="plain"
                  startDecorator={<FileDownloadIcon />}
                  onClick={() => exportVCard(selectedContacts)}
                >
                  Export
                </Button>
                <Button
                  size="sm"
                  variant="plain"
                  color="danger"
                  onClick={() => bulkDelete(selectedContacts)}
                >
                  Delete
                </Button>
              </Sheet>
            )}

            {error && (
              <Sheet
                color="danger"
                variant="soft"
                sx={{ p: 2, mb: 2, borderRadius: "md" }}
              >
                <Typography color="danger">
                  Couldn't load contacts: {error}
                </Typography>
              </Sheet>
            )}
            {contacts === null && !error && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress />
              </Box>
            )}
            {contacts !== null && shown.length === 0 && (
              <Sheet
                variant="soft"
                sx={{ p: 4, borderRadius: "md", textAlign: "center" }}
              >
                <Typography level="body-lg" sx={{ opacity: 0.7 }}>
                  {query || filter.kind !== "all"
                    ? "No matching contacts."
                    : "No contacts yet. Create your first one."}
                </Typography>
              </Sheet>
            )}
            {shown.length > 0 && (
              <Sheet
                variant="outlined"
                sx={{ borderRadius: "md", overflow: "hidden" }}
              >
                {shown.map((c, i) => (
                  <Box
                    key={c.id}
                    data-testid={`contact-${c.id}`}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      px: 2,
                      py: 1,
                      cursor: "pointer",
                      borderTop: i === 0 ? "none" : "1px solid",
                      borderColor: "divider",
                      bgcolor: sel(c.id) ? "primary.softBg" : undefined,
                      "&:hover": {
                        bgcolor: sel(c.id)
                          ? "primary.softBg"
                          : "background.level1",
                      },
                      "&:hover .row-actions": { opacity: 1 },
                    }}
                    onClick={() => setEditing(c)}
                  >
                    <Box
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSel(c.id);
                      }}
                      sx={{ display: "flex" }}
                    >
                      <Checkbox
                        size="sm"
                        checked={sel(c.id)}
                        onChange={() => toggleSel(c.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Select"
                      />
                    </Box>
                    <Avatar
                      sx={{
                        bgcolor: colorFor(c.id),
                        color: "#fff",
                        "--Avatar-size": "40px",
                      }}
                    >
                      {initials(c)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        level="body-sm"
                        sx={{ fontWeight: 500 }}
                        noWrap
                      >
                        {nameOf(c)}
                      </Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
                        {[c.job_title, c.company].filter(Boolean).join(" · ")}
                      </Typography>
                      {/* Email/phone shown inline on mobile */}
                      <Typography
                        level="body-xs"
                        sx={{
                          opacity: 0.7,
                          display: { xs: "block", sm: "none" },
                        }}
                        noWrap
                      >
                        {c.emails[0] || c.phones[0] || ""}
                      </Typography>
                    </Box>
                    <Typography
                      level="body-sm"
                      sx={{
                        width: 220,
                        opacity: 0.85,
                        display: { xs: "none", sm: "block" },
                      }}
                      noWrap
                    >
                      {c.emails[0] || ""}
                    </Typography>
                    <Typography
                      level="body-sm"
                      sx={{
                        width: 150,
                        opacity: 0.85,
                        display: { xs: "none", md: "block" },
                      }}
                      noWrap
                    >
                      {c.phones[0] || ""}
                    </Typography>
                    <Box
                      sx={{
                        width: 120,
                        display: { xs: "none", md: "flex" },
                        gap: 0.5,
                        flexWrap: "wrap",
                      }}
                    >
                      {c.labels.slice(0, 2).map((l) => (
                        <Chip key={l} size="sm" variant="soft">
                          {l}
                        </Chip>
                      ))}
                    </Box>
                    <Box
                      className="row-actions"
                      sx={{
                        display: "flex",
                        opacity: { xs: 1, md: 0 },
                        transition: "opacity 120ms",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconButton
                        size="sm"
                        variant="plain"
                        onClick={() => toggleStar(c)}
                        aria-label="Star"
                      >
                        {c.starred ? (
                          <StarIcon sx={{ color: "#f9ab00" }} />
                        ) : (
                          <StarBorderIcon />
                        )}
                      </IconButton>
                      <Dropdown>
                        <MenuButton
                          slots={{ root: IconButton }}
                          slotProps={{
                            root: {
                              size: "sm",
                              variant: "plain",
                              "aria-label": "More",
                            },
                          }}
                        >
                          <MoreVertIcon />
                        </MenuButton>
                        <Menu size="sm" placement="bottom-end">
                          {c.emails[0] && (
                            <MenuItem
                              component="a"
                              href={`mailto:${c.emails[0]}`}
                            >
                              Email contact
                            </MenuItem>
                          )}
                          <MenuItem onClick={() => setEditing(c)}>
                            Edit
                          </MenuItem>
                          <MenuItem onClick={() => promptAddToLabel([c])}>
                            Add to label
                          </MenuItem>
                          <MenuItem onClick={() => promptAddToGroup([c])}>
                            Add to group
                          </MenuItem>
                          {filter.kind === "group" && (
                            <MenuItem
                              onClick={() => handleRemoveFromCurrentGroup(c)}
                            >
                              Remove from group
                            </MenuItem>
                          )}
                          <MenuItem onClick={() => exportVCard([c])}>
                            Export
                          </MenuItem>
                          <ListDivider />
                          <MenuItem color="danger" onClick={() => onTrash(c)}>
                            Delete contact
                          </MenuItem>
                        </Menu>
                      </Dropdown>
                    </Box>
                  </Box>
                ))}
              </Sheet>
            )}
            {contacts !== null && (
              <Box sx={{ display: "flex", alignItems: "center", mt: 1 }}>
                {shown.length > 0 && (
                  <Button
                    size="sm"
                    variant="plain"
                    color="neutral"
                    onClick={() =>
                      selected.size === shown.length
                        ? clearSel()
                        : selectAllShown()
                    }
                  >
                    {selected.size === shown.length
                      ? "Deselect all"
                      : "Select all"}
                  </Button>
                )}
                <Box sx={{ flex: 1 }} />
                <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                  {shown.length} contact{shown.length === 1 ? "" : "s"}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Container>

      {editing !== null && (
        <ContactDialog
          contact={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={onSave}
        />
      )}
      {multiOpen && (
        <MultiCreateDialog
          onClose={() => setMultiOpen(false)}
          onDone={reload}
        />
      )}
      {importParsed && (
        <ImportDialog
          parsed={importParsed}
          source={importSource}
          onClose={() => setImportParsed(null)}
          onDone={reload}
        />
      )}
      {mergeOpen && (
        <MergeDialog
          groups={duplicateGroups}
          onClose={() => setMergeOpen(false)}
          onMerge={doMerge}
          onDone={reload}
        />
      )}
    </>
  );
}

// MultiCreateDialog — Google's "Create multiple contacts": one contact per line,
// "Name, email, phone" (comma-separated; email/phone optional).
function MultiCreateDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    const rows = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!rows.length) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        rows.map((row) => {
          const parts = row.split(",").map((p) => p.trim());
          const name = parts[0] || "";
          const email = parts.find((p) => p.includes("@")) || "";
          const phone =
            parts.find((p) => /\d/.test(p) && !p.includes("@") && p !== name) ||
            "";
          const [first, ...rest] = name.split(/\s+/);
          return createContact({
            display_name: name,
            first_name: first || "",
            last_name: rest.join(" "),
            emails: email ? [email] : [],
            phones: phone ? [phone] : [],
          }).catch(() => {});
        }),
      );
      await onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: 480, maxWidth: "95vw" }}>
        <ModalClose />
        <Typography level="h4">Create multiple contacts</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7, mt: 0.5 }}>
          One per line — <code>Name, email, phone</code> (email &amp; phone
          optional).
        </Typography>
        <Textarea
          minRows={6}
          placeholder={
            "Ada Lovelace, ada@example.com, +1 555 0100\nAlan Turing, alan@example.com"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          sx={{ mt: 1.5, fontFamily: "monospace" }}
        />
        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}
        >
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={create}>
            Create
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// ImportDialog — preview parsed contacts and create them via createContact.
// `source` controls the title and inline help text.
function ImportDialog({
  parsed,
  source,
  onClose,
  onDone,
}: {
  parsed: ParsedContact[];
  source: "apple" | "google" | "file";
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [failed, setFailed] = useState(0);

  async function importAll() {
    setBusy(true);
    setDone(null);
    setFailed(0);
    try {
      // Build vcf text from parsed contacts and send to server in one call.
      let ok = 0,
        bad = 0;
      // Serialize to keep the UI count honest and avoid hammering the API.
      for (const c of parsed) {
        try {
          await createContact(toCreateInput(c));
          ok++;
        } catch {
          bad++;
        }
        setDone(ok + bad);
      }
      setFailed(bad);
      await onDone();
      setBusy(false);
      setDone(ok);
      if (bad === 0) onClose();
    } catch {
      setBusy(false);
    }
  }

  const label = (c: ParsedContact) =>
    c.display_name ||
    `${c.first_name} ${c.last_name}`.trim() ||
    c.emails[0] ||
    "(no name)";

  const title =
    source === "apple"
      ? "Import from Apple Contacts"
      : source === "google"
        ? "Import from Google Contacts"
        : "Import contacts";

  const helpText =
    source === "apple"
      ? "Exported from Apple Contacts via File → Export → Export vCard."
      : source === "google"
        ? "Exported from Google Contacts via Export → vCard or Google CSV."
        : null;

  return (
    <Modal open onClose={busy ? undefined : onClose}>
      <ModalDialog sx={{ width: 520, maxWidth: "95vw", maxHeight: "90vh" }}>
        {!busy && <ModalClose />}
        <Typography level="h4">{title}</Typography>
        {helpText && (
          <Typography level="body-xs" sx={{ opacity: 0.55, mt: 0.25 }}>
            {helpText}
          </Typography>
        )}
        <Typography level="body-sm" sx={{ opacity: 0.7, mt: 0.5 }}>
          {parsed.length} contact{parsed.length === 1 ? "" : "s"} found in the
          file.
        </Typography>
        {failed > 0 && done !== null && (
          <Alert color="warning" variant="soft" sx={{ mt: 1 }}>
            Imported {done - failed} of {parsed.length}; {failed} failed.
          </Alert>
        )}
        <Sheet
          variant="outlined"
          sx={{
            mt: 1.5,
            borderRadius: "md",
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          <List size="sm">
            {parsed.map((c, i) => (
              <ListItem key={i}>
                <ListItemDecorator>
                  <Avatar
                    size="sm"
                    sx={{ bgcolor: colorFor(label(c)), color: "#fff" }}
                  >
                    {(label(c)[0] || "?").toUpperCase()}
                  </Avatar>
                </ListItemDecorator>
                <Box sx={{ minWidth: 0 }}>
                  <Typography level="body-sm" noWrap>
                    {label(c)}
                  </Typography>
                  <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
                    {[c.emails[0], c.phones[0], c.company]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                </Box>
              </ListItem>
            ))}
          </List>
        </Sheet>
        {busy && done !== null && (
          <LinearProgress
            determinate
            value={(done / parsed.length) * 100}
            sx={{ mt: 1.5 }}
          />
        )}
        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}
        >
          <Button
            variant="plain"
            color="neutral"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={importAll}
            startDecorator={<UploadFileIcon />}
            data-testid="import-confirm"
          >
            Import {parsed.length}
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// MergeDialog — lists detected duplicate groups and merges each into its primary contact.
function MergeDialog({
  groups,
  onClose,
  onMerge,
  onDone,
}: {
  groups: DuplicateGroup[];
  onClose: () => void;
  onMerge: (primary: Contact, others: Contact[]) => Promise<void>;
  onDone: () => Promise<void>;
}) {
  // Track which contact is the "keeper" for each group (defaults to the first).
  const [primaryByKey, setPrimaryByKey] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((g) => [g.key, g.contacts[0].id])),
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [mergedKeys, setMergedKeys] = useState<Set<string>>(new Set());

  const remaining = groups.filter((g) => !mergedKeys.has(g.key));

  async function mergeGroup(g: DuplicateGroup) {
    const primaryId = primaryByKey[g.key] ?? g.contacts[0].id;
    const primary = g.contacts.find((c) => c.id === primaryId) ?? g.contacts[0];
    const others = g.contacts.filter((c) => c.id !== primary.id);
    setBusyKey(g.key);
    try {
      await onMerge(primary, others);
      setMergedKeys((s) => new Set(s).add(g.key));
    } catch (e) {
      window.alert(`Merge failed: ${(e as Error).message}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function close() {
    if (mergedKeys.size > 0) await onDone();
    onClose();
  }

  const name = (c: Contact) =>
    c.display_name ||
    `${c.first_name} ${c.last_name}`.trim() ||
    c.emails[0] ||
    "(no name)";

  return (
    <Modal open onClose={close}>
      <ModalDialog
        sx={{
          width: 600,
          maxWidth: "96vw",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <ModalClose />
        <Typography level="h4">Merge &amp; fix duplicates</Typography>
        {groups.length === 0 ? (
          <Sheet
            variant="soft"
            sx={{ p: 4, mt: 1.5, borderRadius: "md", textAlign: "center" }}
          >
            <Typography level="body-lg" sx={{ opacity: 0.7 }}>
              No duplicates found. Your contacts look tidy.
            </Typography>
          </Sheet>
        ) : remaining.length === 0 ? (
          <Sheet
            variant="soft"
            color="success"
            sx={{ p: 4, mt: 1.5, borderRadius: "md", textAlign: "center" }}
          >
            <Typography level="body-lg">All duplicates merged.</Typography>
          </Sheet>
        ) : (
          <>
            <Typography level="body-sm" sx={{ opacity: 0.7, mb: 1 }}>
              {remaining.length} group{remaining.length === 1 ? "" : "s"} of
              duplicates. Pick which contact to keep — its details are kept and
              the others' emails, phones and labels are merged in.
            </Typography>
            <Stack spacing={1.5}>
              {remaining.map((g) => {
                const primaryId = primaryByKey[g.key] ?? g.contacts[0].id;
                return (
                  <Sheet
                    key={g.key}
                    variant="outlined"
                    sx={{ p: 1.5, borderRadius: "md" }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 1,
                      }}
                    >
                      <Chip size="sm" color="warning" variant="soft">
                        {g.reason === "email" ? "Same email" : "Same name"}
                      </Chip>
                      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                        {g.contacts.length} contacts
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Button
                        size="sm"
                        loading={busyKey === g.key}
                        startDecorator={<MergeIcon />}
                        onClick={() => mergeGroup(g)}
                      >
                        Merge
                      </Button>
                    </Box>
                    <List size="sm">
                      {g.contacts.map((c) => (
                        <ListItem key={c.id}>
                          <ListItemButton
                            selected={c.id === primaryId}
                            onClick={() =>
                              setPrimaryByKey((m) => ({ ...m, [g.key]: c.id }))
                            }
                          >
                            <ListItemDecorator>
                              <Checkbox
                                size="sm"
                                variant="outlined"
                                checked={c.id === primaryId}
                                onChange={() =>
                                  setPrimaryByKey((m) => ({
                                    ...m,
                                    [g.key]: c.id,
                                  }))
                                }
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Keep ${name(c)}`}
                              />
                            </ListItemDecorator>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography level="body-sm" noWrap>
                                {name(c)}{" "}
                                {c.id === primaryId && (
                                  <Chip
                                    size="sm"
                                    variant="soft"
                                    color="primary"
                                  >
                                    keep
                                  </Chip>
                                )}
                              </Typography>
                              <Typography
                                level="body-xs"
                                sx={{ opacity: 0.7 }}
                                noWrap
                              >
                                {[...c.emails, ...c.phones]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </Typography>
                            </Box>
                          </ListItemButton>
                        </ListItem>
                      ))}
                    </List>
                  </Sheet>
                );
              })}
            </Stack>
          </>
        )}
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2 }}>
          <Button variant="plain" color="neutral" onClick={close}>
            Done
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
