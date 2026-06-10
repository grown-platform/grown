import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Typography,
  Input,
  IconButton,
  Button,
  Avatar,
  CircularProgress,
  Tooltip,
  Divider,
  Chip,
  Sheet,
  Modal,
  ModalDialog,
  ModalClose,
  FormControl,
  FormLabel,
  RadioGroup,
  Radio,
  Autocomplete,
  AutocompleteOption,
  ListItemDecorator,
  ListItemContent,
  Drawer,
} from "@mui/joy";
import ChatIcon from "@mui/icons-material/Chat";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import GroupIcon from "@mui/icons-material/Group";
import PersonIcon from "@mui/icons-material/Person";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MenuIcon from "@mui/icons-material/Menu";
import ModeCommentOutlinedIcon from "@mui/icons-material/ModeCommentOutlined";
import CloseIcon from "@mui/icons-material/Close";
import EmojiEmotionsOutlinedIcon from "@mui/icons-material/EmojiEmotionsOutlined";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listChannels,
  createChannel,
  listMessages,
  postMessage,
  deleteMessage,
  reactToMessage,
  postThreadReply,
  listThreadReplies,
} from "./api";
import type {
  ChatChannel,
  ChatMessage,
  ChatWSEvent,
  ChatReaction,
} from "./types";
import { ChatComposer } from "./ChatComposer";
import { MessageBody } from "./MessageBody";

// ---- helpers ----------------------------------------------------------------

const COLORS = [
  "#3D5A80",
  "#E0777D",
  "#5B9279",
  "#C46B45",
  "#7A5980",
  "#2A9D8F",
  "#D9A441",
];
function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function avatarInitial(name: string): string {
  return (name || "?").charAt(0).toUpperCase();
}

function fmtTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function fmtTimeFull(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function channelLabel(ch: ChatChannel, myId: string): string {
  if (ch.kind === "group") return ch.name || "Unnamed group";
  const other = ch.member_ids.find((id) => id !== myId);
  if (!other) return "Notes to self"; // self-DM (only the caller is a member)
  return `DM (${other.slice(0, 8)}…)`;
}

// Common quick-react emojis shown in the picker.
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🙌", "🔥"];

// ---- component --------------------------------------------------------------

interface ChatAppProps {
  user: User;
}

export default function ChatApp({ user }: ChatAppProps) {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [activeChannel, setActiveChannel] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [online, setOnline] = useState<string[]>([]);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  // Mobile: channel-list drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Thread panel
  const [threadParent, setThreadParent] = useState<ChatMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<ChatMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // ---- data loading -------------------------------------------------------

  const reloadChannels = useCallback(async () => {
    try {
      const r = await listChannels();
      setChannels(r.channels ?? []);
    } catch {
      /* ignore */
    }
    setLoadingChannels(false);
  }, []);

  useEffect(() => {
    reloadChannels();
  }, [reloadChannels]);

  const openChannel = useCallback(async (ch: ChatChannel) => {
    setActiveChannel(ch);
    setMessages([]);
    setOnline([]);
    setLoadingMessages(true);
    setDrawerOpen(false);
    setThreadParent(null);
    setThreadMessages([]);
    try {
      const r = await listMessages(ch.id);
      setMessages(r.messages ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoadingMessages(false);
    }
    setChannels((prev) =>
      prev.map((c) => (c.id === ch.id ? { ...c, unread_count: 0 } : c)),
    );
  }, []);

  const openThread = useCallback(
    async (msg: ChatMessage) => {
      if (!activeChannel) return;
      setThreadParent(msg);
      setThreadMessages([]);
      setLoadingThread(true);
      try {
        const r = await listThreadReplies(activeChannel.id, msg.id);
        setThreadMessages(r.messages ?? []);
      } catch {
        /* ignore */
      } finally {
        setLoadingThread(false);
      }
    },
    [activeChannel],
  );

  // ---- WebSocket ----------------------------------------------------------

  useEffect(() => {
    if (!activeChannel) return;
    const channelId = activeChannel.id;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/v1/chat/channels/${channelId}/connect`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as ChatWSEvent;
        if (evt.type === "message" && evt.channel_id === channelId) {
          const incoming = evt.message;
          if (incoming.parent_id) {
            // Thread reply — update thread if it's open for this parent.
            setThreadParent((cur) => {
              if (cur?.id === incoming.parent_id) {
                setThreadMessages((prev) =>
                  prev.some((m) => m.id === incoming.id)
                    ? prev
                    : [...prev, incoming],
                );
                // Update reply_count on parent in message list.
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === incoming.parent_id
                      ? { ...m, reply_count: (m.reply_count ?? 0) + 1 }
                      : m,
                  ),
                );
              }
              return cur;
            });
          } else {
            setMessages((prev) => {
              if (prev.some((m) => m.id === incoming.id)) return prev;
              return [...prev, incoming];
            });
            setChannels((prev) =>
              prev.map((c) =>
                c.id === channelId
                  ? { ...c, last_message_at: incoming.sent_at, unread_count: 0 }
                  : c,
              ),
            );
          }
        } else if (evt.type === "presence" && evt.channel_id === channelId) {
          setOnline(evt.online ?? []);
        } else if (evt.type === "deleted" && evt.channel_id === channelId) {
          setMessages((prev) => prev.filter((m) => m.id !== evt.id));
          setThreadMessages((prev) => prev.filter((m) => m.id !== evt.id));
        }
      } catch {
        /* ignore */
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [activeChannel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when messages / thread change.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadMessages]);

  // ---- actions ------------------------------------------------------------

  async function handleComposerSend({
    body,
    attachmentIds,
  }: {
    body: string;
    attachmentIds: string[];
  }) {
    if (!activeChannel) throw new Error("No channel selected");
    const m = await postMessage(activeChannel.id, body, attachmentIds);
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setMessages((prev) => [...prev, m]);
    }
  }

  async function handleThreadReplySend({
    body,
    attachmentIds,
  }: {
    body: string;
    attachmentIds: string[];
  }) {
    if (!activeChannel || !threadParent) throw new Error("No thread open");
    const m = await postThreadReply(
      activeChannel.id,
      threadParent.id,
      body,
      attachmentIds,
    );
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setThreadMessages((prev) =>
        prev.some((x) => x.id === m.id) ? prev : [...prev, m],
      );
      setMessages((prev) =>
        prev.map((x) =>
          x.id === threadParent.id
            ? { ...x, reply_count: (x.reply_count ?? 0) + 1 }
            : x,
        ),
      );
    }
  }

  async function handleDelete(m: ChatMessage) {
    if (!activeChannel) return;
    if (!window.confirm("Delete this message?")) return;
    try {
      await deleteMessage(activeChannel.id, m.id);
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
    } catch {
      /* ignore */
    }
  }

  async function handleReact(m: ChatMessage, emoji: string) {
    if (!activeChannel) return;
    try {
      const resp = await reactToMessage(activeChannel.id, m.id, emoji);
      const updated = resp.reaction_details ?? [];
      setMessages((prev) =>
        prev.map((x) =>
          x.id === m.id ? { ...x, reaction_details: updated } : x,
        ),
      );
      setThreadMessages((prev) =>
        prev.map((x) =>
          x.id === m.id ? { ...x, reaction_details: updated } : x,
        ),
      );
    } catch {
      /* ignore */
    }
  }

  // ---- render -------------------------------------------------------------

  const totalUnread = channels.reduce((s, c) => s + (c.unread_count || 0), 0);

  // Channel list content — used in both the desktop sidebar and mobile Drawer
  const channelListContent = (
    <>
      {/* Sidebar header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.5,
        }}
      >
        <Typography level="title-sm" sx={{ fontWeight: 700 }}>
          Chat
          {totalUnread > 0 && (
            <Chip
              size="sm"
              color="primary"
              variant="solid"
              sx={{ ml: 0.75, fontSize: "xs" }}
            >
              {totalUnread}
            </Chip>
          )}
        </Typography>
        <Tooltip title="New channel or DM">
          <IconButton
            size="sm"
            variant="plain"
            onClick={() => setNewChannelOpen(true)}
            aria-label="New chat"
          >
            <AddIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Divider />

      {loadingChannels ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size="sm" />
        </Box>
      ) : channels.length === 0 ? (
        <Box sx={{ px: 2, py: 3, textAlign: "center", opacity: 0.6 }}>
          <ChatIcon
            sx={{ fontSize: 40, mb: 1, display: "block", mx: "auto" }}
          />
          <Typography level="body-sm">
            No chats yet.
            <br />
            Start one!
          </Typography>
        </Box>
      ) : (
        <Box sx={{ flex: 1 }}>
          {channels.map((ch) => {
            const label = channelLabel(ch, user.id);
            const isActive = activeChannel?.id === ch.id;
            return (
              <Box
                key={ch.id}
                onClick={() => openChannel(ch)}
                aria-label={label}
                aria-selected={isActive}
                role="option"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 2,
                  py: 0.875,
                  cursor: "pointer",
                  minHeight: 44,
                  bgcolor: isActive ? "primary.softBg" : "transparent",
                  borderLeft: isActive ? "3px solid" : "3px solid transparent",
                  borderColor: isActive ? "primary.500" : "transparent",
                  "&:hover": {
                    bgcolor: isActive ? "primary.softBg" : "background.level1",
                  },
                }}
              >
                <Avatar
                  size="sm"
                  sx={{
                    bgcolor: colorFor(ch.id),
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  {ch.kind === "group" ? (
                    <GroupIcon sx={{ fontSize: 16 }} />
                  ) : (
                    <PersonIcon sx={{ fontSize: 16 }} />
                  )}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    level="body-sm"
                    sx={{
                      fontWeight: ch.unread_count > 0 ? 700 : 400,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </Typography>
                  {ch.last_message_at && (
                    <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                      {fmtTime(ch.last_message_at)}
                    </Typography>
                  )}
                </Box>
                {ch.unread_count > 0 && (
                  <Chip size="sm" color="primary" variant="solid">
                    {ch.unread_count}
                  </Chip>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Box sx={{ flex: 1 }} />
    </>
  );

  return (
    <>
      <Header user={user} />
      <Box sx={{ display: "flex", height: "calc(100vh - 56px)" }}>
        {/* ---- Desktop Sidebar — hidden on mobile ---- */}
        <Sheet
          variant="soft"
          sx={{
            width: 260,
            flexShrink: 0,
            display: { xs: "none", md: "flex" },
            flexDirection: "column",
            borderRight: "1px solid",
            borderColor: "divider",
            overflowY: "auto",
          }}
        >
          {channelListContent}
        </Sheet>

        {/* ---- Mobile Drawer for channel list ---- */}
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
            <Box sx={{ display: "flex", alignItems: "center", px: 2, py: 1 }}>
              <Typography level="title-sm" sx={{ flex: 1 }}>
                Channels
              </Typography>
              <ModalClose sx={{ position: "static" }} />
            </Box>
            {channelListContent}
          </Box>
        </Drawer>

        {/* ---- Main content ---- */}
        <Box sx={{ flex: 1, display: "flex", minWidth: 0 }}>
          {/* ---- Message area ---- */}
          <Box
            sx={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
            }}
          >
            {activeChannel ? (
              <>
                {/* Channel header */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    px: { xs: 1.5, sm: 3 },
                    py: 1.25,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.surface",
                    minHeight: 52,
                  }}
                >
                  {/* Mobile back button */}
                  <IconButton
                    size="sm"
                    variant="plain"
                    onClick={() => setActiveChannel(null)}
                    aria-label="Back to channels"
                    sx={{
                      display: { xs: "inline-flex", md: "none" },
                      minWidth: 40,
                      minHeight: 40,
                    }}
                  >
                    <ArrowBackIcon />
                  </IconButton>
                  {/* Mobile hamburger for channel switcher */}
                  <IconButton
                    size="sm"
                    variant="plain"
                    onClick={() => setDrawerOpen(true)}
                    aria-label="Open channel list"
                    sx={{ display: { xs: "none", md: "none" } }}
                  >
                    <MenuIcon />
                  </IconButton>
                  <Avatar
                    size="sm"
                    sx={{ bgcolor: colorFor(activeChannel.id), color: "#fff" }}
                  >
                    {activeChannel.kind === "group" ? (
                      <GroupIcon sx={{ fontSize: 16 }} />
                    ) : (
                      <PersonIcon sx={{ fontSize: 16 }} />
                    )}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography level="title-sm" sx={{ fontWeight: 700 }}>
                      {channelLabel(activeChannel, user.id)}
                    </Typography>
                    {activeChannel.kind === "group" && (
                      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                        {activeChannel.member_ids.length} member
                        {activeChannel.member_ids.length !== 1 ? "s" : ""}
                      </Typography>
                    )}
                  </Box>
                  {online.length > 0 && (
                    <Box
                      sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                    >
                      <FiberManualRecordIcon
                        sx={{ fontSize: 10, color: "success.500" }}
                      />
                      <Typography
                        level="body-xs"
                        sx={{ color: "text.secondary" }}
                      >
                        {online.length} online
                      </Typography>
                    </Box>
                  )}
                </Box>

                {/* Message thread */}
                <Box
                  sx={{
                    flex: 1,
                    overflowY: "auto",
                    px: { xs: 1.5, sm: 3 },
                    py: 2,
                  }}
                  role="log"
                  aria-label="Message thread"
                  aria-live="polite"
                >
                  {loadingMessages ? (
                    <Box
                      sx={{ display: "flex", justifyContent: "center", py: 6 }}
                    >
                      <CircularProgress />
                    </Box>
                  ) : messages.length === 0 ? (
                    <Box sx={{ textAlign: "center", py: 8, opacity: 0.6 }}>
                      <ChatIcon sx={{ fontSize: 48, mb: 1 }} />
                      <Typography level="body-lg">
                        No messages yet. Say hello!
                      </Typography>
                    </Box>
                  ) : (
                    messages.map((m) => {
                      const isMe = m.sender_id === user.id;
                      return (
                        <MessageRow
                          key={m.id}
                          message={m}
                          isMe={isMe}
                          myId={user.id}
                          onDelete={() => handleDelete(m)}
                          onReact={(emoji) => handleReact(m, emoji)}
                          onOpenThread={() => openThread(m)}
                        />
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </Box>

                {/* Rich composer */}
                <Box
                  sx={{
                    px: { xs: 1.5, sm: 3 },
                    py: 1.5,
                    borderTop: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.surface",
                  }}
                >
                  <ChatComposer onSend={handleComposerSend} />
                </Box>
              </>
            ) : (
              <Box
                sx={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  opacity: 0.5,
                  gap: 2,
                  px: 2,
                }}
              >
                <IconButton
                  variant="soft"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Open channel list"
                  sx={{
                    display: { xs: "flex", md: "none" },
                    mb: 1,
                    minWidth: 48,
                    minHeight: 48,
                  }}
                >
                  <MenuIcon sx={{ fontSize: 28 }} />
                </IconButton>
                <ChatIcon sx={{ fontSize: 72 }} />
                <Typography level="body-lg" sx={{ textAlign: "center" }}>
                  Select a channel or DM to start chatting
                </Typography>
                <Button
                  variant="outlined"
                  startDecorator={<AddIcon />}
                  onClick={() => setNewChannelOpen(true)}
                >
                  Start a new chat
                </Button>
              </Box>
            )}
          </Box>

          {/* ---- Thread panel ---- */}
          {threadParent && activeChannel && (
            <Sheet
              variant="outlined"
              sx={{
                width: { xs: "100%", sm: 340 },
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                borderLeft: "1px solid",
                borderColor: "divider",
                position: { xs: "absolute", sm: "static" },
                right: 0,
                top: 56,
                bottom: 0,
                zIndex: { xs: 10, sm: "auto" },
                bgcolor: "background.surface",
              }}
            >
              {/* Thread panel header */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  px: 2,
                  py: 1.25,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  gap: 1,
                }}
              >
                <Typography level="title-sm" sx={{ flex: 1, fontWeight: 700 }}>
                  Thread
                </Typography>
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={() => {
                    setThreadParent(null);
                    setThreadMessages([]);
                  }}
                  aria-label="Close thread"
                >
                  <CloseIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>

              {/* Original message */}
              <Box
                sx={{
                  px: 2,
                  py: 1.5,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Box sx={{ display: "flex", gap: 1.5 }}>
                  <Avatar
                    size="sm"
                    sx={{
                      bgcolor: colorFor(threadParent.sender_id),
                      color: "#fff",
                      mt: 0.25,
                      flexShrink: 0,
                    }}
                  >
                    {avatarInitial(threadParent.sender_name)}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 1,
                        mb: 0.25,
                      }}
                    >
                      <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                        {threadParent.sender_name}
                      </Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                        {fmtTimeFull(threadParent.sent_at)}
                      </Typography>
                    </Box>
                    <MessageBody
                      body={threadParent.body}
                      attachments={threadParent.attachments}
                    />
                  </Box>
                </Box>
              </Box>

              {/* Replies */}
              <Box
                sx={{ flex: 1, overflowY: "auto", px: 2, py: 1.5 }}
                aria-live="polite"
              >
                {loadingThread ? (
                  <Box
                    sx={{ display: "flex", justifyContent: "center", py: 4 }}
                  >
                    <CircularProgress size="sm" />
                  </Box>
                ) : threadMessages.length === 0 ? (
                  <Typography
                    level="body-xs"
                    sx={{ textAlign: "center", opacity: 0.5, py: 2 }}
                  >
                    No replies yet.
                  </Typography>
                ) : (
                  threadMessages.map((m) => (
                    <MessageRow
                      key={m.id}
                      message={m}
                      isMe={m.sender_id === user.id}
                      myId={user.id}
                      compact
                      onReact={(emoji) => handleReact(m, emoji)}
                    />
                  ))
                )}
                <div ref={threadEndRef} />
              </Box>

              {/* Thread composer */}
              <Box
                sx={{
                  px: 2,
                  py: 1.5,
                  borderTop: "1px solid",
                  borderColor: "divider",
                }}
              >
                <ChatComposer
                  onSend={handleThreadReplySend}
                  placeholder={`Reply in thread…`}
                />
              </Box>
            </Sheet>
          )}
        </Box>
      </Box>

      {newChannelOpen && (
        <NewChannelDialog
          myId={user.id}
          onClose={() => setNewChannelOpen(false)}
          onCreate={async (input) => {
            const ch = await createChannel(input);
            setChannels((cur) =>
              cur.some((c) => c.id === ch.id) ? cur : [ch, ...cur],
            );
            setNewChannelOpen(false);
            openChannel(ch);
            reloadChannels();
          }}
        />
      )}
    </>
  );
}

// ---- MessageRow -------------------------------------------------------------

interface MessageRowProps {
  message: ChatMessage;
  isMe: boolean;
  myId: string;
  compact?: boolean;
  onDelete?: () => void;
  onReact: (emoji: string) => void;
  onOpenThread?: () => void;
}

function MessageRow({
  message: m,
  isMe,
  compact,
  onDelete,
  onReact,
  onOpenThread,
}: MessageRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <Box
      sx={{
        display: "flex",
        gap: 1.5,
        mb: compact ? 1 : 1.5,
        "&:hover .msg-actions": { opacity: 1 },
      }}
    >
      <Avatar
        size="sm"
        sx={{
          bgcolor: colorFor(m.sender_id),
          color: "#fff",
          mt: 0.25,
          flexShrink: 0,
          width: compact ? 28 : 32,
          height: compact ? 28 : 32,
        }}
      >
        {avatarInitial(m.sender_name)}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.25 }}>
          <Typography
            level="body-sm"
            sx={{ fontWeight: 600, fontSize: compact ? "xs" : undefined }}
          >
            {m.sender_name}
          </Typography>
          <Typography level="body-xs" sx={{ opacity: 0.6 }}>
            {fmtTimeFull(m.sent_at)}
          </Typography>
        </Box>
        <MessageBody body={m.body} attachments={m.attachments} />

        {/* Reaction chips */}
        {m.reaction_details && m.reaction_details.length > 0 && (
          <ReactionChips reactions={m.reaction_details} onReact={onReact} />
        )}

        {/* Thread reply count */}
        {!compact && onOpenThread && (m.reply_count ?? 0) > 0 && (
          <Box
            onClick={onOpenThread}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              mt: 0.5,
              cursor: "pointer",
              color: "primary.500",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            <ModeCommentOutlinedIcon sx={{ fontSize: 14 }} />
            <Typography level="body-xs" sx={{ color: "inherit" }}>
              {m.reply_count} {m.reply_count === 1 ? "reply" : "replies"}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Message actions (visible on hover) */}
      <Box
        className="msg-actions"
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: 0.25,
          opacity: { xs: 1, md: 0 },
          transition: "opacity 0.15s",
        }}
      >
        {/* Emoji reaction picker */}
        <Box sx={{ position: "relative" }}>
          <Tooltip title="Add reaction">
            <IconButton
              size="sm"
              variant="plain"
              onClick={() => setPickerOpen((v) => !v)}
              aria-label="Add reaction"
            >
              <EmojiEmotionsOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          {pickerOpen && (
            <EmojiPicker
              onPick={(emoji) => {
                onReact(emoji);
                setPickerOpen(false);
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </Box>

        {/* Reply in thread */}
        {!compact && onOpenThread && (
          <Tooltip title="Reply in thread">
            <IconButton
              size="sm"
              variant="plain"
              onClick={onOpenThread}
              aria-label="Reply in thread"
            >
              <ModeCommentOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}

        {/* Delete (own messages) */}
        {isMe && onDelete && (
          <Tooltip title="Delete">
            <IconButton
              size="sm"
              variant="plain"
              color="danger"
              onClick={onDelete}
              aria-label="Delete message"
            >
              <DeleteOutlineIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}

// ---- EmojiPicker ------------------------------------------------------------

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  // Close when clicking outside.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <Sheet
      ref={ref}
      variant="outlined"
      sx={{
        position: "absolute",
        top: "100%",
        right: 0,
        zIndex: 100,
        p: 0.75,
        borderRadius: "sm",
        boxShadow: "md",
        display: "flex",
        flexWrap: "wrap",
        gap: 0.25,
        width: 200,
      }}
    >
      {QUICK_EMOJIS.map((emoji) => (
        <IconButton
          key={emoji}
          size="sm"
          variant="plain"
          onClick={() => onPick(emoji)}
          sx={{ fontSize: 18, minWidth: 36, minHeight: 36 }}
        >
          {emoji}
        </IconButton>
      ))}
    </Sheet>
  );
}

// ---- ReactionChips ----------------------------------------------------------

interface ReactionChipsProps {
  reactions: ChatReaction[];
  onReact: (emoji: string) => void;
}

function ReactionChips({ reactions, onReact }: ReactionChipsProps) {
  const items = reactions.filter((r) => r.count > 0);
  if (items.length === 0) return null;
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
      {items.map((r) => (
        <Chip
          key={r.emoji}
          size="sm"
          variant={r.me ? "solid" : "soft"}
          color={r.me ? "primary" : "neutral"}
          onClick={() => onReact(r.emoji)}
          sx={{ cursor: "pointer", userSelect: "none", fontSize: "xs" }}
        >
          {r.emoji} {r.count}
        </Chip>
      ))}
    </Box>
  );
}

// ---- NewChannelDialog -------------------------------------------------------

interface NewChannelDialogProps {
  myId: string;
  onClose: () => void;
  onCreate: (input: {
    kind: "dm" | "group";
    name?: string;
    member_ids?: string[];
  }) => Promise<void>;
}

interface DirMember {
  id: string;
  name: string;
  email: string;
}

function NewChannelDialog({ onClose, onCreate }: NewChannelDialogProps) {
  const [kind, setKind] = useState<"dm" | "group">("group");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<DirMember[]>([]);
  const [options, setOptions] = useState<DirMember[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Debounced org-directory search.
  useEffect(() => {
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/v1/directory?q=${encodeURIComponent(query)}`,
          { credentials: "same-origin" },
        );
        const d = await r.json();
        if (alive) setOptions((d.members ?? []) as DirMember[]);
      } catch {
        /* ignore */
      } finally {
        if (alive) setSearching(false);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  async function submit() {
    setBusy(true);
    setError("");
    const picks = kind === "dm" ? selected.slice(0, 1) : selected;
    const memberIds = picks.map((m) => m.id);
    try {
      await onCreate({
        kind,
        name: name.trim() || undefined,
        member_ids: memberIds,
      });
    } catch (e) {
      setError((e as Error).message || "Failed to create channel");
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: { xs: "100vw", sm: 420 }, maxWidth: "100vw" }}>
        <ModalClose />
        <Typography level="title-md" sx={{ mb: 2 }}>
          New Chat
        </Typography>

        <FormControl sx={{ mb: 2 }}>
          <FormLabel>Type</FormLabel>
          <RadioGroup
            value={kind}
            onChange={(e) => setKind(e.target.value as "dm" | "group")}
            orientation="horizontal"
          >
            <Radio value="dm" label="Direct Message" />
            <Radio value="group" label="Group Channel" />
          </RadioGroup>
        </FormControl>

        {kind === "group" && (
          <FormControl sx={{ mb: 2 }}>
            <FormLabel>Channel name</FormLabel>
            <Input
              placeholder="e.g. general, team-eng"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </FormControl>
        )}

        <FormControl sx={{ mb: 2 }}>
          <FormLabel>{kind === "dm" ? "Person" : "Members"}</FormLabel>
          <Autocomplete
            multiple
            placeholder={kind === "dm" ? "Search a person…" : "Search people…"}
            autoFocus={kind === "dm"}
            options={options}
            value={selected}
            loading={searching}
            onInputChange={(_, v) => setQuery(v)}
            onChange={(_, v) =>
              setSelected(
                kind === "dm"
                  ? (v as DirMember[]).slice(-1)
                  : (v as DirMember[]),
              )
            }
            getOptionLabel={(o) =>
              (o as DirMember).name || (o as DirMember).email
            }
            isOptionEqualToValue={(o, v) =>
              (o as DirMember).id === (v as DirMember).id
            }
            filterOptions={(x) => x}
            renderOption={(props, o) => {
              const m = o as DirMember;
              return (
                <AutocompleteOption {...props} key={m.id}>
                  <ListItemDecorator>
                    <Avatar size="sm">
                      {(m.name || m.email || "?").charAt(0).toUpperCase()}
                    </Avatar>
                  </ListItemDecorator>
                  <ListItemContent>
                    <Typography level="body-sm">{m.name || m.email}</Typography>
                    {m.email && m.name && (
                      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                        {m.email}
                      </Typography>
                    )}
                  </ListItemContent>
                </AutocompleteOption>
              );
            }}
          />
          <Typography level="body-xs" sx={{ opacity: 0.6, mt: 0.5 }}>
            Search your organization's directory by name or email.
          </Typography>
        </FormControl>

        {error && (
          <Typography color="danger" level="body-sm" sx={{ mb: 1 }}>
            {error}
          </Typography>
        )}

        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button
            variant="outlined"
            color="neutral"
            onClick={onClose}
            disabled={busy}
            sx={{ minHeight: 40 }}
          >
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} sx={{ minHeight: 40 }}>
            {kind === "dm" ? "Open DM" : "Create channel"}
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
