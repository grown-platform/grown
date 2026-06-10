/**
 * ChatPanel — a collapsible Gmail-style Chat sidebar panel for use inside Mail.
 *
 * Shows a list of recent channels and, when one is selected, an inline compact
 * message thread with a composer. Completely self-contained: it owns its own
 * API calls and WebSocket, so it doesn't break the Mail app if chat is missing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Typography,
  Avatar,
  CircularProgress,
  IconButton,
  Textarea,
  Tooltip,
  Divider,
  Chip,
} from "@mui/joy";
import SendIcon from "@mui/icons-material/Send";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import GroupIcon from "@mui/icons-material/Group";
import PersonIcon from "@mui/icons-material/Person";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import { listChannels, listMessages, postMessage } from "./api";
import type { ChatChannel, ChatMessage, ChatWSEvent } from "./types";
import type { User } from "../../api/types";
import { MessageBody } from "./MessageBody";

// ---- helpers ---------------------------------------------------------------

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

function fmtTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function channelLabel(ch: ChatChannel, myId: string): string {
  if (ch.kind === "group") return ch.name || "Unnamed group";
  const other = ch.member_ids.find((id) => id !== myId);
  return other ? `DM (${other.slice(0, 8)}…)` : "DM";
}

// ---- ChatPanel component ---------------------------------------------------

interface ChatPanelProps {
  user: User;
}

export function ChatPanel({ user }: ChatPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChannel, setActiveChannel] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load channels.
  useEffect(() => {
    listChannels()
      .then((r) => setChannels((r.channels ?? []).slice(0, 10)))
      .catch(() => setError("Could not load chats"))
      .finally(() => setLoading(false));
  }, []);

  const openChannel = useCallback(async (ch: ChatChannel) => {
    setActiveChannel(ch);
    setMessages([]);
    setLoadingMsgs(true);
    try {
      const r = await listMessages(ch.id);
      setMessages(r.messages ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoadingMsgs(false);
    }
    setChannels((prev) =>
      prev.map((c) => (c.id === ch.id ? { ...c, unread_count: 0 } : c)),
    );
  }, []);

  // WebSocket for active channel.
  useEffect(() => {
    if (!activeChannel) return;
    const channelId = activeChannel.id;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${window.location.host}/api/v1/chat/channels/${channelId}/connect`,
    );
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as ChatWSEvent;
        if (evt.type === "message" && evt.channel_id === channelId) {
          setMessages((prev) =>
            prev.some((m) => m.id === evt.message.id)
              ? prev
              : [...prev, evt.message],
          );
        } else if (evt.type === "presence" && evt.channel_id === channelId) {
          setOnline(evt.online ?? []);
        } else if (evt.type === "deleted" && evt.channel_id === channelId) {
          setMessages((prev) => prev.filter((m) => m.id !== evt.id));
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!activeChannel || !composer.trim() || sending) return;
    const body = composer.trim();
    setComposer("");
    setSending(true);
    try {
      const m = await postMessage(activeChannel.id, body);
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setMessages((prev) => [...prev, m]);
      }
    } catch {
      setComposer(body);
    } finally {
      setSending(false);
    }
  }

  const totalUnread = channels.reduce((s, c) => s + (c.unread_count || 0), 0);

  return (
    <Box
      sx={{
        borderTop: "1px solid",
        borderColor: "divider",
        bgcolor: "background.surface",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Panel header — always visible */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1.5,
          py: 0.75,
          cursor: "pointer",
          userSelect: "none",
          gap: 1,
        }}
        onClick={() => {
          if (collapsed) setCollapsed(false);
        }}
      >
        <Typography level="body-sm" sx={{ fontWeight: 700, flex: 1 }}>
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
        <Tooltip title="New chat">
          <IconButton
            size="sm"
            variant="plain"
            onClick={(e) => {
              e.stopPropagation();
              // Navigate to chat app for full create UX.
              window.location.assign("/chat");
            }}
            aria-label="Open full Chat app"
          >
            <AddIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <IconButton
          size="sm"
          variant="plain"
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((c) => !c);
          }}
          aria-label={collapsed ? "Expand chat panel" : "Collapse chat panel"}
        >
          {collapsed ? (
            <ExpandLessIcon sx={{ fontSize: 18 }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: 18 }} />
          )}
        </IconButton>
      </Box>

      {!collapsed && (
        <Box
          sx={{
            height: 340,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {activeChannel ? (
            /* ---- Compact thread view ---- */
            <>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  px: 1.5,
                  py: 0.5,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  gap: 1,
                }}
              >
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={() => {
                    setActiveChannel(null);
                    setMessages([]);
                  }}
                  aria-label="Back to channels"
                >
                  <ArrowBackIcon sx={{ fontSize: 16 }} />
                </IconButton>
                <Typography
                  level="body-sm"
                  sx={{
                    fontWeight: 600,
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {channelLabel(activeChannel, user.id)}
                </Typography>
                {online.length > 0 && (
                  <Box
                    sx={{ display: "flex", alignItems: "center", gap: 0.25 }}
                  >
                    <FiberManualRecordIcon
                      sx={{ fontSize: 8, color: "success.500" }}
                    />
                    <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                      {online.length}
                    </Typography>
                  </Box>
                )}
              </Box>
              {/* Messages */}
              <Box
                sx={{ flex: 1, overflowY: "auto", px: 1.5, py: 1 }}
                aria-live="polite"
              >
                {loadingMsgs ? (
                  <Box
                    sx={{ display: "flex", justifyContent: "center", py: 3 }}
                  >
                    <CircularProgress size="sm" />
                  </Box>
                ) : messages.length === 0 ? (
                  <Typography
                    level="body-xs"
                    sx={{ textAlign: "center", opacity: 0.5, py: 2 }}
                  >
                    No messages yet.
                  </Typography>
                ) : (
                  messages.map((m) => (
                    <Box key={m.id} sx={{ display: "flex", gap: 1, mb: 1 }}>
                      <Avatar
                        size="sm"
                        sx={{
                          bgcolor: colorFor(m.sender_id),
                          color: "#fff",
                          width: 24,
                          height: 24,
                          fontSize: 11,
                          flexShrink: 0,
                        }}
                      >
                        {(m.sender_name || "?").charAt(0).toUpperCase()}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box
                          sx={{
                            display: "flex",
                            gap: 0.5,
                            alignItems: "baseline",
                          }}
                        >
                          <Typography level="body-xs" sx={{ fontWeight: 600 }}>
                            {m.sender_name}
                          </Typography>
                          <Typography level="body-xs" sx={{ opacity: 0.5 }}>
                            {fmtTime(m.sent_at)}
                          </Typography>
                        </Box>
                        <MessageBody
                          body={m.body}
                          attachments={m.attachments}
                        />
                      </Box>
                    </Box>
                  ))
                )}
                <div ref={bottomRef} />
              </Box>
              {/* Composer */}
              <Box
                sx={{
                  px: 1.5,
                  pb: 1,
                  pt: 0.5,
                  display: "flex",
                  gap: 0.5,
                  borderTop: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Textarea
                  placeholder="Message…"
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  minRows={1}
                  maxRows={3}
                  sx={{ flex: 1, fontSize: "xs" }}
                  aria-label="Quick reply"
                />
                <IconButton
                  size="sm"
                  color="primary"
                  variant="solid"
                  onClick={send}
                  disabled={!composer.trim() || sending}
                  aria-label="Send"
                  sx={{ alignSelf: "flex-end" }}
                >
                  <SendIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            </>
          ) : (
            /* ---- Channel list ---- */
            <Box sx={{ overflowY: "auto", flex: 1 }}>
              {loading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
                  <CircularProgress size="sm" />
                </Box>
              ) : error ? (
                <Typography
                  level="body-xs"
                  sx={{ textAlign: "center", opacity: 0.5, py: 2 }}
                >
                  {error}
                </Typography>
              ) : channels.length === 0 ? (
                <Typography
                  level="body-xs"
                  sx={{ textAlign: "center", opacity: 0.5, py: 2, px: 1 }}
                >
                  No chats yet.{" "}
                  <Box component="a" href="/chat" sx={{ color: "primary.500" }}>
                    Start one
                  </Box>
                </Typography>
              ) : (
                <>
                  {channels.map((ch, i) => (
                    <Box key={ch.id}>
                      {i > 0 && <Divider />}
                      <Box
                        onClick={() => openChannel(ch)}
                        role="button"
                        aria-label={channelLabel(ch, user.id)}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          px: 1.5,
                          py: 0.75,
                          cursor: "pointer",
                          "&:hover": { bgcolor: "background.level1" },
                        }}
                      >
                        <Avatar
                          size="sm"
                          sx={{
                            bgcolor: colorFor(ch.id),
                            color: "#fff",
                            width: 28,
                            height: 28,
                            flexShrink: 0,
                          }}
                        >
                          {ch.kind === "group" ? (
                            <GroupIcon sx={{ fontSize: 14 }} />
                          ) : (
                            <PersonIcon sx={{ fontSize: 14 }} />
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
                            {channelLabel(ch, user.id)}
                          </Typography>
                          {ch.last_message_at && (
                            <Typography level="body-xs" sx={{ opacity: 0.5 }}>
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
                    </Box>
                  ))}
                  <Divider />
                  <Box
                    component="a"
                    href="/chat"
                    sx={{
                      display: "block",
                      px: 1.5,
                      py: 0.75,
                      color: "primary.500",
                      fontSize: "xs",
                      textDecoration: "none",
                      "&:hover": { bgcolor: "background.level1" },
                    }}
                  >
                    Open Chat app →
                  </Box>
                </>
              )}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
