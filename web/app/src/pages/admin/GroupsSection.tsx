// ---------------------------------------------------------------------------
// Groups — admin view of the org's Groups (Google Groups clone: mailing
// lists / forums). Reuses the existing member-facing GroupsService REST gateway
// (web/app/src/pages/groups/api.ts) since admins are org members; the admin
// console page is admin-gated at the nav level. Mirrors the styling of the
// other admin sections (Users, Sessions) in ./index.tsx.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Dropdown,
  FormControl,
  FormHelperText,
  FormLabel,
  IconButton,
  Input,
  ListItemDecorator,
  Menu,
  MenuButton,
  MenuItem,
  Modal,
  ModalClose,
  ModalDialog,
  Sheet,
  Table,
  Typography,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import SearchIcon from "@mui/icons-material/Search";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import GroupIcon from "@mui/icons-material/Group";
import {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  listMembers,
} from "../groups/api";
import type { Group, GroupMember } from "../groups/types";

export function GroupsSection() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [gs, ms] = await Promise.all([listGroups(), listMembers()]);
      setGroups(gs);
      setMembers(ms);
    } catch (e) {
      setGroups([]);
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(g: Group) {
    if (
      !window.confirm(
        `Delete the group “${g.name || g.email || "this group"}”?\n\n` +
          `This removes the group and all of its topics and posts. This can’t be undone.`,
      )
    )
      return;
    setBusyId(g.id);
    setError(null);
    try {
      await deleteGroup(g.id);
      setNotice(`Deleted group “${g.name || g.email}”.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const shown = useMemo(() => {
    const list = groups ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((g) =>
      `${g.name} ${g.email} ${g.description}`.toLowerCase().includes(q),
    );
  }, [groups, query]);

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          mb: 2,
          flexWrap: "wrap",
        }}
      >
        <Box sx={{ flex: 1, minWidth: 180 }}>
          <Typography level="h4">Groups</Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Mailing lists and forums for your organization.
          </Typography>
        </Box>
        <Input
          size="sm"
          startDecorator={<SearchIcon />}
          placeholder="Search groups"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ width: { xs: "100%", sm: 220 }, order: { xs: 10, sm: "unset" } }}
        />
        <Button
          size="sm"
          startDecorator={<GroupIcon />}
          onClick={() => setCreateOpen(true)}
          data-testid="admin-create-group"
        >
          Create group
        </Button>
      </Box>

      {notice && (
        <Alert
          color="success"
          variant="soft"
          sx={{ mb: 2 }}
          endDecorator={
            <IconButton
              size="sm"
              variant="plain"
              onClick={() => setNotice(null)}
            >
              <Icons.Close />
            </IconButton>
          }
        >
          {notice}
        </Alert>
      )}
      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {groups === null && !error && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {groups !== null && (
        <Sheet
          variant="outlined"
          sx={{ borderRadius: "md", overflow: "hidden", overflowX: "auto" }}
        >
          <Table
            hoverRow
            sx={{ "--TableCell-paddingX": { xs: "8px", sm: "16px" }, minWidth: 520 }}
          >
            <thead>
              <tr>
                <th style={{ width: "40%" }}>Name</th>
                <th>Email</th>
                <th style={{ width: 90 }}>Members</th>
                <th style={{ width: 90 }}>Topics</th>
                <th style={{ width: 48 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => (
                <tr key={g.id} data-testid={`admin-group-${g.id}`}>
                  <td>
                    <Box
                      sx={{ display: "flex", alignItems: "center", gap: 1.25 }}
                    >
                      <Avatar size="sm">
                        {(g.name || g.email || "?").charAt(0).toUpperCase()}
                      </Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          level="body-sm"
                          sx={{ fontWeight: 500 }}
                          noWrap
                        >
                          {g.name || "(unnamed group)"}
                        </Typography>
                        {g.description && (
                          <Typography
                            level="body-xs"
                            sx={{ opacity: 0.6 }}
                            noWrap
                          >
                            {g.description}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </td>
                  <td>
                    <Typography level="body-sm" noWrap>
                      {g.email || "—"}
                    </Typography>
                  </td>
                  <td>
                    <Chip size="sm" variant="soft">
                      {g.member_count}
                    </Chip>
                  </td>
                  <td>
                    <Typography level="body-sm">{g.topic_count}</Typography>
                  </td>
                  <td>
                    <Dropdown>
                      <MenuButton
                        slots={{ root: IconButton }}
                        slotProps={{
                          root: {
                            size: "sm",
                            variant: "plain",
                            color: "neutral",
                            loading: busyId === g.id,
                          },
                        }}
                        data-testid={`admin-group-menu-${g.id}`}
                      >
                        <MoreVertIcon />
                      </MenuButton>
                      <Menu placement="bottom-end" size="sm">
                        <MenuItem onClick={() => setEditing(g)}>
                          <ListItemDecorator>
                            <Icons.Edit />
                          </ListItemDecorator>{" "}
                          Edit
                        </MenuItem>
                        <Divider />
                        <MenuItem color="danger" onClick={() => onDelete(g)}>
                          <ListItemDecorator>
                            <Icons.DeleteForever />
                          </ListItemDecorator>{" "}
                          Delete
                        </MenuItem>
                      </Menu>
                    </Dropdown>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {shown.length === 0 && (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                {query
                  ? "No groups match your search."
                  : "No groups yet. Create the first one."}
              </Typography>
            </Box>
          )}
        </Sheet>
      )}

      {createOpen && (
        <GroupFormDialog
          mode="create"
          members={members}
          onClose={() => setCreateOpen(false)}
          onSaved={async (name) => {
            setCreateOpen(false);
            setNotice(`Created group “${name}”.`);
            await load();
          }}
        />
      )}
      {editing && (
        <GroupFormDialog
          mode="edit"
          group={editing}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={async (name) => {
            setEditing(null);
            setNotice(`Updated group “${name}”.`);
            await load();
          }}
        />
      )}
    </>
  );
}

// Shared create/edit dialog. Collects name/email/description and a member set
// (checkbox list of org members). Both modes send the full editable field set,
// matching the GroupsService Create/Update RPCs.
function GroupFormDialog(props: {
  mode: "create" | "edit";
  group?: Group;
  members: GroupMember[];
  onClose: () => void;
  onSaved: (name: string) => Promise<void> | void;
}) {
  const { mode, group, members } = props;
  const [name, setName] = useState(group?.name ?? "");
  const [email, setEmail] = useState(group?.email ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [memberIds, setMemberIds] = useState<string[]>(group?.member_ids ?? []);
  const [memberQuery, setMemberQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shownMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      `${m.name} ${m.email}`.toLowerCase().includes(q),
    );
  }, [members, memberQuery]);

  function toggleMember(id: string, on: boolean) {
    setMemberIds((cur) =>
      on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id),
    );
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const fields = {
        name: name.trim(),
        email: email.trim(),
        description: description.trim(),
        member_ids: memberIds,
      };
      if (mode === "create") await createGroup(fields);
      else if (group) await updateGroup(group.id, fields);
      await props.onSaved(fields.name || fields.email);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={props.onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 460 },
          maxWidth: "100vw",
          borderRadius: { xs: 0, sm: "md" },
        }}
      >
        <ModalClose />
        <Typography level="title-lg">
          {mode === "create" ? "Create group" : "Edit group"}
        </Typography>
        {error && (
          <Alert color="danger" variant="soft" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1.5 }}>
          <FormControl>
            <FormLabel>Name</FormLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Engineering"
              autoFocus
            />
          </FormControl>
          <FormControl>
            <FormLabel>Email</FormLabel>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="engineering@yourdomain.com"
            />
            <FormHelperText>The list address members post to.</FormHelperText>
          </FormControl>
          <FormControl>
            <FormLabel>Description</FormLabel>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this group is for"
            />
          </FormControl>

          <FormControl>
            <FormLabel>
              Members{" "}
              <Typography component="span" level="body-xs" sx={{ opacity: 0.6 }}>
                ({memberIds.length} selected)
              </Typography>
            </FormLabel>
            <Input
              size="sm"
              startDecorator={<SearchIcon />}
              placeholder="Filter members"
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              sx={{ mb: 1 }}
            />
            <Sheet
              variant="outlined"
              sx={{ borderRadius: "sm", maxHeight: 200, overflowY: "auto", p: 1 }}
            >
              {shownMembers.length === 0 && (
                <Typography
                  level="body-xs"
                  sx={{ opacity: 0.6, textAlign: "center", py: 1 }}
                >
                  No members match.
                </Typography>
              )}
              {shownMembers.map((m) => (
                <Box
                  key={m.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    py: 0.5,
                  }}
                >
                  <Checkbox
                    size="sm"
                    checked={memberIds.includes(m.id)}
                    onChange={(e) => toggleMember(m.id, e.target.checked)}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography level="body-sm" noWrap>
                      {m.name || m.email}
                    </Typography>
                    {m.name && m.email && (
                      <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
                        {m.email}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Sheet>
          </FormControl>
        </Box>

        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2.5 }}
        >
          <Button
            variant="plain"
            color="neutral"
            onClick={props.onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={saving}
            disabled={!name.trim() && !email.trim()}
            data-testid="admin-group-save"
          >
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
