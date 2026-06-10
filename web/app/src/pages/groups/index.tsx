import { useEffect, useMemo, useState } from "react";
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
  Modal,
  ModalDialog,
  ModalClose,
  Textarea,
  Button,
  Stack,
  FormControl,
  FormLabel,
  Checkbox,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  Drawer,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import GroupsIcon from "@mui/icons-material/Groups";
import ForumIcon from "@mui/icons-material/Forum";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PersonIcon from "@mui/icons-material/Person";
import MenuIcon from "@mui/icons-material/Menu";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  listTopics,
  createTopic,
  listPosts,
  createPost,
  listMembers,
} from "./api";
import type {
  Group,
  GroupTopic,
  GroupPost,
  GroupMember,
  CreateGroupInput,
} from "./types";

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
function initialsOf(s: string): string {
  const parts = s.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}
function timeAgo(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Returns true when window.innerWidth < 900. */
function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.innerWidth < 900);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 900);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile;
}

interface GroupsAppProps {
  user: User;
}

export default function GroupsApp({ user }: GroupsAppProps) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const isMobile = useMobile();
  // On mobile the group list is in a drawer
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function reloadGroups() {
    try {
      setGroups(await listGroups());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    reloadGroups();
    // Resolve member identities from BOTH the groups member list and the org
    // directory (the canonical source — includes everyone with id+name+email),
    // so a member id always renders as a name/email, never a raw UUID.
    (async () => {
      const [gm, dir] = await Promise.all([
        listMembers().catch(() => [] as GroupMember[]),
        fetch("/api/v1/directory", { credentials: "same-origin" })
          .then((r) => (r.ok ? r.json() : { members: [] }))
          .then((d) => (d.members ?? []) as GroupMember[])
          .catch(() => [] as GroupMember[]),
      ]);
      const byId = new Map<string, GroupMember>();
      [...gm, ...dir].forEach((m) => {
        if (m.id) byId.set(m.id, m);
      });
      setMembers([...byId.values()]);
    })();
  }, []);

  const shown = useMemo(() => {
    const list = groups ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((g) =>
      [g.name, g.email, g.description].join(" ").toLowerCase().includes(q),
    );
  }, [groups, query]);

  const memberName = useMemo(() => {
    const m = new Map<string, GroupMember>();
    members.forEach((x) => m.set(x.id, x));
    return (id: string) => m.get(id)?.name || m.get(id)?.email || id;
  }, [members]);

  async function onCreate(input: CreateGroupInput) {
    const g = await createGroup(input);
    await reloadGroups();
    setSelectedId(g.id);
    if (isMobile) setDrawerOpen(false);
  }
  async function onDelete(g: Group) {
    if (
      !window.confirm(
        `Delete group "${g.name}"? All topics and posts are removed.`,
      )
    )
      return;
    setGroups((cur) => (cur ?? []).filter((x) => x.id !== g.id));
    if (selectedId === g.id) setSelectedId(null);
    try {
      await deleteGroup(g.id);
    } catch {
      reloadGroups();
    }
  }

  const selected = (groups ?? []).find((g) => g.id === selectedId) ?? null;

  // On mobile: show the detail pane (group detail or thread) when something is selected
  const showDetail = isMobile ? !!selectedId : true;
  const showList = isMobile ? !selectedId : true;

  const groupList = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: isMobile ? "100%" : "auto",
      }}
    >
      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        <Input
          size="sm"
          startDecorator={<SearchIcon />}
          placeholder="Search groups"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ flex: 1 }}
        />
        <Button
          variant="solid"
          color="primary"
          size="sm"
          startDecorator={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          data-testid="create-group"
        >
          New
        </Button>
      </Box>
      {groups === null && !error && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {groups !== null && shown.length === 0 && (
        <Sheet
          variant="soft"
          sx={{ p: 3, borderRadius: "md", textAlign: "center" }}
        >
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            {query
              ? "No matching groups."
              : "No groups yet. Create your first one."}
          </Typography>
        </Sheet>
      )}
      {shown.length > 0 && (
        <Sheet
          variant="outlined"
          sx={{ borderRadius: "md", overflow: "hidden" }}
        >
          <List sx={{ "--ListItem-paddingY": "10px" }}>
            {shown.map((g, i) => (
              <ListItem
                key={g.id}
                endAction={
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
                      <MenuItem
                        onClick={() => {
                          setSelectedId(g.id);
                          setOpenTopicId(null);
                          if (isMobile) setDrawerOpen(false);
                        }}
                      >
                        Open
                      </MenuItem>
                      <ListDivider />
                      <MenuItem color="danger" onClick={() => onDelete(g)}>
                        Delete group
                      </MenuItem>
                    </Menu>
                  </Dropdown>
                }
                sx={{
                  borderTop: i === 0 ? "none" : "1px solid",
                  borderColor: "divider",
                }}
              >
                <ListItemButton
                  selected={g.id === selectedId}
                  onClick={() => {
                    setSelectedId(g.id);
                    setOpenTopicId(null);
                    if (isMobile) setDrawerOpen(false);
                  }}
                  data-testid={`group-${g.id}`}
                  sx={{ minHeight: 44 }}
                >
                  <ListItemDecorator>
                    <Avatar
                      size="sm"
                      sx={{ bgcolor: colorFor(g.id), color: "#fff" }}
                    >
                      <GroupsIcon fontSize="small" />
                    </Avatar>
                  </ListItemDecorator>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography level="body-sm" sx={{ fontWeight: 500 }} noWrap>
                      {g.name}
                    </Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
                      {g.email || "—"}
                    </Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.55 }} noWrap>
                      {g.member_count} member{g.member_count === 1 ? "" : "s"} ·{" "}
                      {g.topic_count} topic{g.topic_count === 1 ? "" : "s"}
                    </Typography>
                  </Box>
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Sheet>
      )}
    </Box>
  );

  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: { xs: 2, sm: 4 } }}>
        {/* Mobile toolbar row */}
        {isMobile && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            {selectedId ? (
              <IconButton
                size="sm"
                variant="plain"
                onClick={() => {
                  setSelectedId(null);
                  setOpenTopicId(null);
                }}
              >
                <ArrowBackIcon />
              </IconButton>
            ) : (
              <IconButton
                size="sm"
                variant="plain"
                onClick={() => setDrawerOpen(true)}
              >
                <MenuIcon />
              </IconButton>
            )}
            <Typography level="h3" sx={{ flex: 1 }}>
              {selected ? selected.name : "Groups"}
            </Typography>
            {!selectedId && (
              <Button
                variant="solid"
                color="primary"
                size="sm"
                startDecorator={<AddIcon />}
                onClick={() => setCreateOpen(true)}
                data-testid="create-group"
              >
                New
              </Button>
            )}
          </Box>
        )}

        {/* Desktop header */}
        {!isMobile && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
            <Typography level="h2" sx={{ flex: 1 }}>
              Groups
            </Typography>
            <Input
              size="sm"
              startDecorator={<SearchIcon />}
              placeholder="Search groups"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              sx={{ width: 260 }}
            />
            <Button
              variant="solid"
              color="primary"
              startDecorator={<AddIcon />}
              onClick={() => setCreateOpen(true)}
              data-testid="create-group"
            >
              Create group
            </Button>
          </Box>
        )}

        {error && (
          <Sheet
            color="danger"
            variant="soft"
            sx={{ p: 2, mb: 2, borderRadius: "md" }}
          >
            <Typography color="danger">
              Couldn't load groups: {error}
            </Typography>
          </Sheet>
        )}

        {/* Mobile drawer for group list */}
        {isMobile && (
          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            size="sm"
          >
            <Box sx={{ p: 2, height: "100%" }}>{groupList}</Box>
          </Drawer>
        )}

        <Box sx={{ display: "flex", gap: 3 }}>
          {/* Left: groups list — desktop only inline */}
          {!isMobile && showList && (
            <Box sx={{ width: 280, flexShrink: 0 }}>{groupList}</Box>
          )}

          {/* Right: group detail or empty state */}
          {(!isMobile || showDetail) && (
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {!selected ? (
                isMobile ? null : (
                  <Sheet
                    variant="soft"
                    sx={{ p: 6, borderRadius: "md", textAlign: "center" }}
                  >
                    <GroupsIcon sx={{ fontSize: 48, opacity: 0.4 }} />
                    <Typography level="body-lg" sx={{ opacity: 0.7, mt: 1 }}>
                      Select a group to view its conversations.
                    </Typography>
                  </Sheet>
                )
              ) : openTopicId ? (
                <TopicThread
                  group={selected}
                  topicId={openTopicId}
                  onBack={() => setOpenTopicId(null)}
                />
              ) : (
                <GroupDetail
                  group={selected}
                  members={members}
                  memberName={memberName}
                  onOpenTopic={(id) => setOpenTopicId(id)}
                  onChanged={reloadGroups}
                />
              )}
            </Box>
          )}

          {/* Mobile: show group list when no group is selected */}
          {isMobile && !selectedId && (
            <Box sx={{ flex: 1, minWidth: 0 }}>{groupList}</Box>
          )}
        </Box>
      </Container>

      {createOpen && (
        <CreateGroupDialog
          members={members}
          onClose={() => setCreateOpen(false)}
          onCreate={onCreate}
        />
      )}
    </>
  );
}

// ── Group detail (About / Members + topic list) ──────────────────────────────
function GroupDetail({
  group,
  members,
  memberName,
  onOpenTopic,
  onChanged,
}: {
  group: Group;
  members: GroupMember[];
  memberName: (id: string) => string;
  onOpenTopic: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [topics, setTopics] = useState<GroupTopic[] | null>(null);
  const [newTopicOpen, setNewTopicOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  async function reload() {
    try {
      setTopics(await listTopics(group.id));
    } catch {
      setTopics([]);
    }
  }
  useEffect(() => {
    setTopics(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);

  return (
    <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5 }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
        <Avatar
          sx={{
            bgcolor: colorFor(group.id),
            color: "#fff",
            "--Avatar-size": "48px",
          }}
        >
          <GroupsIcon />
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography level="h3" noWrap>
            {group.name}
          </Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }} noWrap>
            {group.email || "—"}
          </Typography>
        </Box>
        <Button
          size="sm"
          variant="solid"
          startDecorator={<AddIcon />}
          onClick={() => setNewTopicOpen(true)}
          data-testid="new-topic"
        >
          New topic
        </Button>
      </Box>

      <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
        <Chip size="sm" variant="soft" startDecorator={<PersonIcon />}>
          {group.member_count} members
        </Chip>
        <Chip size="sm" variant="soft" startDecorator={<ForumIcon />}>
          {group.topic_count} topics
        </Chip>
        <Chip size="sm" variant="soft">
          {group.post_count} posts
        </Chip>
      </Box>

      <Tabs defaultValue="conversations" sx={{ mt: 2, bgcolor: "transparent" }}>
        <TabList>
          <Tab value="conversations">Conversations</Tab>
          <Tab value="about">About</Tab>
          <Tab value="members">Members</Tab>
        </TabList>

        <TabPanel value="conversations" sx={{ px: 0 }}>
          {topics === null && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {topics !== null && topics.length === 0 && (
            <Sheet
              variant="soft"
              sx={{ p: 4, borderRadius: "md", textAlign: "center" }}
            >
              <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                No conversations yet. Start one.
              </Typography>
            </Sheet>
          )}
          {topics && topics.length > 0 && (
            <List sx={{ "--ListItem-radius": "8px" }}>
              {topics.map((t) => (
                <ListItem key={t.id}>
                  <ListItemButton
                    onClick={() => onOpenTopic(t.id)}
                    data-testid={`topic-${t.id}`}
                    sx={{ minHeight: 48 }}
                  >
                    <ListItemDecorator>
                      <Avatar
                        size="sm"
                        sx={{
                          bgcolor: colorFor(t.author_id || t.id),
                          color: "#fff",
                        }}
                      >
                        {initialsOf(t.author_name || "?")}
                      </Avatar>
                    </ListItemDecorator>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        level="body-sm"
                        sx={{ fontWeight: 500 }}
                        noWrap
                      >
                        {t.subject}
                      </Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
                        {t.author_name} · {t.post_count} post
                        {t.post_count === 1 ? "" : "s"}
                      </Typography>
                    </Box>
                    <Typography
                      level="body-xs"
                      sx={{ opacity: 0.6, whiteSpace: "nowrap" }}
                    >
                      {timeAgo(t.last_post_at || t.created_at)}
                    </Typography>
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </TabPanel>

        <TabPanel value="about" sx={{ px: 0 }}>
          <Typography level="title-sm" sx={{ mb: 0.5 }}>
            Description
          </Typography>
          <Typography
            level="body-sm"
            sx={{ whiteSpace: "pre-wrap", opacity: 0.85 }}
          >
            {group.description || "No description."}
          </Typography>
          <Divider sx={{ my: 2 }} />
          <Typography level="body-sm">
            <strong>Email:</strong> {group.email || "—"}
          </Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7, mt: 0.5 }}>
            Created {timeAgo(group.created_at)}
          </Typography>
        </TabPanel>

        <TabPanel value="members" sx={{ px: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
            <Typography level="title-sm" sx={{ flex: 1 }}>
              {group.member_count} member{group.member_count === 1 ? "" : "s"}
            </Typography>
            <Button
              size="sm"
              variant="outlined"
              onClick={() => setManageOpen(true)}
              data-testid="manage-members"
            >
              Manage members
            </Button>
          </Box>
          <List size="sm">
            {group.member_ids.map((id) => (
              <ListItem key={id} sx={{ minHeight: 40 }}>
                <ListItemDecorator>
                  <Avatar
                    size="sm"
                    sx={{ bgcolor: colorFor(id), color: "#fff" }}
                  >
                    {initialsOf(memberName(id))}
                  </Avatar>
                </ListItemDecorator>
                <Typography level="body-sm">{memberName(id)}</Typography>
              </ListItem>
            ))}
            {group.member_ids.length === 0 && (
              <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                No members.
              </Typography>
            )}
          </List>
        </TabPanel>
      </Tabs>

      {newTopicOpen && (
        <NewTopicDialog
          onClose={() => setNewTopicOpen(false)}
          onCreate={async (subject, body) => {
            const t = await createTopic(group.id, subject, body);
            await reload();
            await onChanged();
            onOpenTopic(t.id);
          }}
        />
      )}
      {manageOpen && (
        <ManageMembersDialog
          group={group}
          members={members}
          onClose={() => setManageOpen(false)}
          onSaved={onChanged}
        />
      )}
    </Sheet>
  );
}

// ── Topic thread (posts + reply composer) ────────────────────────────────────
function TopicThread({
  group,
  topicId,
  onBack,
}: {
  group: Group;
  topicId: string;
  onBack: () => void;
}) {
  const [posts, setPosts] = useState<GroupPost[] | null>(null);
  const [topic, setTopic] = useState<GroupTopic | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const [ps, ts] = await Promise.all([
        listPosts(topicId),
        listTopics(group.id),
      ]);
      setPosts(ps);
      setTopic(ts.find((t) => t.id === topicId) ?? null);
    } catch {
      setPosts([]);
    }
  }
  useEffect(() => {
    setPosts(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);

  async function send() {
    const body = reply.trim();
    if (!body) return;
    setBusy(true);
    try {
      await createPost(topicId, body);
      setReply("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <IconButton
          size="sm"
          variant="plain"
          onClick={onBack}
          aria-label="Back to topics"
        >
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography level="h3" noWrap>
            {topic?.subject || "Conversation"}
          </Typography>
          <Typography level="body-xs" sx={{ opacity: 0.65 }}>
            {group.name}
          </Typography>
        </Box>
      </Box>
      <Divider />

      {posts === null && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}
      {posts && (
        <Stack spacing={1.5} sx={{ my: 2 }}>
          {posts.map((p) => (
            <Box
              key={p.id}
              sx={{ display: "flex", gap: 1.5 }}
              data-testid={`post-${p.id}`}
            >
              <Avatar
                size="sm"
                sx={{ bgcolor: colorFor(p.author_id || p.id), color: "#fff" }}
              >
                {initialsOf(p.author_name || "?")}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
                  <Typography level="body-sm" sx={{ fontWeight: 500 }}>
                    {p.author_name}
                  </Typography>
                  <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                    {timeAgo(p.created_at)}
                  </Typography>
                </Box>
                <Typography level="body-sm" sx={{ whiteSpace: "pre-wrap" }}>
                  {p.body}
                </Typography>
              </Box>
            </Box>
          ))}
          {posts.length === 0 && (
            <Typography level="body-sm" sx={{ opacity: 0.7 }}>
              No posts yet.
            </Typography>
          )}
        </Stack>
      )}

      <Divider />
      <Box sx={{ mt: 1.5 }}>
        <Textarea
          minRows={2}
          placeholder="Write a reply…"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          data-testid="reply-body"
        />
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
          <Button
            loading={busy}
            disabled={!reply.trim()}
            onClick={send}
            data-testid="send-reply"
          >
            Reply
          </Button>
        </Box>
      </Box>
    </Sheet>
  );
}

// ── Create group dialog ───────────────────────────────────────────────────────
function CreateGroupDialog({
  members,
  onClose,
  onCreate,
}: {
  members: GroupMember[];
  onClose: () => void;
  onCreate: (input: CreateGroupInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setMemberIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate({
        name: name.trim(),
        email: email.trim(),
        description: description.trim(),
        member_ids: [...memberIds],
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 480 },
          maxWidth: "100vw",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <ModalClose disabled={busy} />
        <Typography level="h4">Create group</Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <FormControl required>
            <FormLabel>Group name</FormLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              data-testid="group-name"
            />
          </FormControl>
          <FormControl>
            <FormLabel>Group email</FormLabel>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="team@org"
              data-testid="group-email"
            />
          </FormControl>
          <FormControl>
            <FormLabel>Description</FormLabel>
            <Textarea
              minRows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Members</FormLabel>
            <Sheet
              variant="outlined"
              sx={{
                borderRadius: "md",
                maxHeight: 200,
                overflowY: "auto",
                p: 0.5,
              }}
            >
              <List size="sm">
                {members.map((m) => (
                  <ListItem key={m.id}>
                    <ListItemButton
                      onClick={() => toggle(m.id)}
                      sx={{ minHeight: 40 }}
                    >
                      <ListItemDecorator>
                        <Checkbox
                          size="sm"
                          checked={memberIds.has(m.id)}
                          onChange={() => toggle(m.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Add ${m.name}`}
                        />
                      </ListItemDecorator>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography level="body-sm" noWrap>
                          {m.name}
                        </Typography>
                        <Typography
                          level="body-xs"
                          sx={{ opacity: 0.6 }}
                          noWrap
                        >
                          {m.email}
                        </Typography>
                      </Box>
                    </ListItemButton>
                  </ListItem>
                ))}
                {members.length === 0 && (
                  <Typography level="body-xs" sx={{ p: 1, opacity: 0.6 }}>
                    No other org members.
                  </Typography>
                )}
              </List>
            </Sheet>
          </FormControl>
        </Stack>
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
            disabled={!name.trim()}
            onClick={submit}
            data-testid="create-group-confirm"
          >
            Create
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// ── New topic dialog ──────────────────────────────────────────────────────────
function NewTopicDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (subject: string, body: string) => Promise<void>;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      await onCreate(subject.trim(), body.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose}>
      <ModalDialog sx={{ width: { xs: "100vw", sm: 480 }, maxWidth: "100vw" }}>
        <ModalClose disabled={busy} />
        <Typography level="h4">New topic</Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <FormControl required>
            <FormLabel>Subject</FormLabel>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              autoFocus
              data-testid="topic-subject"
            />
          </FormControl>
          <FormControl>
            <FormLabel>Message</FormLabel>
            <Textarea
              minRows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              data-testid="topic-body"
            />
          </FormControl>
        </Stack>
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
            disabled={!subject.trim()}
            onClick={submit}
            data-testid="create-topic-confirm"
          >
            Post
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// ── Manage members dialog ─────────────────────────────────────────────────────
function ManageMembersDialog({
  group,
  members,
  onClose,
  onSaved,
}: {
  group: Group;
  members: GroupMember[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [memberIds, setMemberIds] = useState<Set<string>>(
    new Set(group.member_ids),
  );
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  // Directory of candidate members. Seeded with the members handed in (current
  // group members + already-known org users) and grown by live directory
  // search so ANY org user — including people who haven't signed into grown yet
  // — can be found and added, not just the pre-loaded roster.
  const [roster, setRoster] = useState<Map<string, GroupMember>>(
    () => new Map(members.map((m) => [m.id, m])),
  );
  const [searching, setSearching] = useState(false);

  // Live directory search (debounced). Merges hits into the roster so they can
  // be toggled on. Empty query still returns the org roster (up to 50).
  useEffect(() => {
    const q = query.trim();
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/v1/directory?q=${encodeURIComponent(q)}`, {
          credentials: "same-origin",
        });
        const d = r.ok ? await r.json() : { members: [] };
        if (cancelled) return;
        const hits = (d.members ?? []) as GroupMember[];
        setRoster((prev) => {
          const next = new Map(prev);
          hits.forEach((m) => next.set(m.id, m));
          return next;
        });
      } catch {
        /* best-effort: keep existing roster */
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  function toggle(id: string) {
    setMemberIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function save() {
    setBusy(true);
    try {
      await updateGroup(group.id, {
        name: group.name,
        email: group.email,
        description: group.description,
        member_ids: [...memberIds],
      });
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  // Show selected members first, then everyone else, filtered by the query.
  const q = query.trim().toLowerCase();
  const all = [...roster.values()];
  const matches = (m: GroupMember) =>
    !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  const visible = all
    .filter((m) => memberIds.has(m.id) || matches(m))
    .sort((a, b) => {
      const sa = memberIds.has(a.id) ? 0 : 1;
      const sb = memberIds.has(b.id) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return (a.name || a.email).localeCompare(b.name || b.email);
    });

  return (
    <Modal open onClose={busy ? undefined : onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 440 },
          maxWidth: "100vw",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <ModalClose disabled={busy} />
        <Typography level="h4">Manage members</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7 }}>
          Search the org directory to add anyone, or untick to remove.{" "}
          {memberIds.size} selected.
        </Typography>
        <Input
          size="sm"
          startDecorator={<SearchIcon />}
          endDecorator={searching ? <CircularProgress size="sm" /> : null}
          placeholder="Search people by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ mt: 1.5 }}
          autoFocus
          data-testid="member-search"
        />
        <Sheet
          variant="outlined"
          sx={{
            borderRadius: "md",
            mt: 1.5,
            maxHeight: 320,
            overflowY: "auto",
            p: 0.5,
          }}
        >
          <List size="sm">
            {visible.map((m) => (
              <ListItem key={m.id}>
                <ListItemButton
                  onClick={() => toggle(m.id)}
                  sx={{ minHeight: 40 }}
                >
                  <ListItemDecorator>
                    <Checkbox
                      size="sm"
                      checked={memberIds.has(m.id)}
                      onChange={() => toggle(m.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Toggle ${m.name}`}
                    />
                  </ListItemDecorator>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography level="body-sm" noWrap>
                      {m.name}
                    </Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
                      {m.email}
                    </Typography>
                  </Box>
                </ListItemButton>
              </ListItem>
            ))}
            {visible.length === 0 && (
              <Typography level="body-xs" sx={{ p: 1, opacity: 0.6 }}>
                {searching
                  ? "Searching…"
                  : q
                    ? "No matches."
                    : "No org members."}
              </Typography>
            )}
          </List>
        </Sheet>
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
          <Button loading={busy} onClick={save} data-testid="save-members">
            Save
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
