import { useMemo, useRef, useState, useEffect } from "react";
import {
  Box,
  Sheet,
  Typography,
  Input,
  Button,
  IconButton,
  Avatar,
  Chip,
  Divider,
} from "@mui/joy";
import AddCommentIcon from "@mui/icons-material/AddComment";
import SendIcon from "@mui/icons-material/Send";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import SmsIcon from "@mui/icons-material/Sms";
import CloseIcon from "@mui/icons-material/Close";
import type { User } from "../../api/types";
import type { DirectoryEntry } from "./types";

// Phase 1 scaffold — real SMS/messaging backend (via the SIP trunk) is wired in a later phase.

// ---------------------------------------------------------------------------
// Local data model (front-end only).
// ---------------------------------------------------------------------------

interface Message {
  id: string;
  /** "out" = sent by me, "in" = received. */
  direction: "out" | "in";
  text: string;
  /** Epoch millis — kept numeric so relative-time math is trivial. */
  at: number;
}

interface Thread {
  id: string;
  /** Display name for the contact (falls back to the number). */
  name: string;
  /** Phone number or extension this thread is addressed to. */
  address: string;
  /** Optional directory user this thread maps to. */
  userId?: string;
  messages: Message[];
  unread: boolean;
}

// ---------------------------------------------------------------------------
// Seed data — 2–3 example conversations so the UI has something to show.
// ---------------------------------------------------------------------------

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function seedThreads(): Thread[] {
  return [
    {
      id: "t1",
      name: "Front Desk",
      address: "101",
      messages: [
        {
          id: "m1",
          direction: "in",
          text: "Hey, the package for you just arrived at reception.",
          at: NOW - 2 * HOUR,
        },
        {
          id: "m2",
          direction: "out",
          text: "Thanks! I'll come grab it in a few minutes.",
          at: NOW - 2 * HOUR + 3 * MIN,
        },
        {
          id: "m3",
          direction: "in",
          text: "No rush — we'll keep it behind the desk.",
          at: NOW - 2 * HOUR + 5 * MIN,
        },
      ],
      unread: false,
    },
    {
      id: "t2",
      name: "+1 (415) 555-0142",
      address: "+14155550142",
      messages: [
        {
          id: "m4",
          direction: "in",
          text: "Your appointment is confirmed for tomorrow at 10:00 AM.",
          at: NOW - 26 * HOUR,
        },
        {
          id: "m5",
          direction: "out",
          text: "Perfect, see you then.",
          at: NOW - 25 * HOUR,
        },
      ],
      unread: true,
    },
    {
      id: "t3",
      name: "On-call Support",
      address: "+18005551234",
      messages: [
        {
          id: "m6",
          direction: "in",
          text: "Ticket #4821 has been resolved. Let us know if anything else comes up!",
          at: NOW - 3 * DAY,
        },
      ],
      unread: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function relativeTime(at: number): string {
  const diff = Date.now() - at;
  if (diff < MIN) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initialOf(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "#";
}

function lastMessage(t: Thread): Message | undefined {
  return t.messages[t.messages.length - 1];
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

const TEAL = "#00897B";

// ---------------------------------------------------------------------------
// New-message composer dialog (inline panel, no Modal dependency).
// ---------------------------------------------------------------------------

interface NewMessagePanelProps {
  directory: DirectoryEntry[];
  onCancel: () => void;
  onStart: (target: { name: string; address: string; userId?: string }) => void;
}

function NewMessagePanel({ directory, onCancel, onStart }: NewMessagePanelProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return directory;
    return directory.filter(
      (d) =>
        d.display_name.toLowerCase().includes(q) ||
        d.extension.toLowerCase().includes(q),
    );
  }, [directory, query]);

  // Treat a query that looks like a number/extension as a free-form address.
  const looksLikeNumber = /^[+]?[0-9*#\s()-]{2,}$/.test(query.trim());

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Typography level="title-sm" sx={{ flex: 1 }}>
          New message
        </Typography>
        <IconButton
          size="sm"
          variant="plain"
          color="neutral"
          onClick={onCancel}
          aria-label="Cancel new message"
        >
          <CloseIcon />
        </IconButton>
      </Box>

      <Box sx={{ px: 2, py: 1.5 }}>
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, phone number, or extension"
          aria-label="Search contacts or enter a number"
          onKeyDown={(e) => {
            if (e.key === "Enter" && looksLikeNumber) {
              const addr = query.trim();
              onStart({ name: addr, address: addr });
            }
          }}
        />
        {looksLikeNumber && (
          <Button
            fullWidth
            variant="soft"
            color="primary"
            startDecorator={<SmsIcon />}
            sx={{ mt: 1.5 }}
            onClick={() => {
              const addr = query.trim();
              onStart({ name: addr, address: addr });
            }}
          >
            Message {query.trim()}
          </Button>
        )}
      </Box>

      <Divider />

      <Box sx={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {filtered.length === 0 && (
          <Typography
            level="body-sm"
            sx={{ opacity: 0.6, textAlign: "center", py: 4 }}
          >
            No matching contacts
          </Typography>
        )}
        {filtered.map((d, i) => (
          <Box
            key={d.user_id}
            role="button"
            tabIndex={0}
            onClick={() =>
              onStart({
                name: d.display_name || d.extension,
                address: d.extension,
                userId: d.user_id,
              })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                onStart({
                  name: d.display_name || d.extension,
                  address: d.extension,
                  userId: d.user_id,
                });
              }
            }}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 2,
              py: 1.25,
              cursor: "pointer",
              borderTop: i === 0 ? "none" : "1px solid",
              borderColor: "divider",
              "&:hover": { bgcolor: "background.level1" },
            }}
          >
            <Avatar
              variant="soft"
              size="sm"
              sx={{ bgcolor: `${TEAL}20`, color: TEAL }}
            >
              {initialOf(d.display_name || d.extension)}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography level="body-sm" sx={{ fontWeight: 600 }} noWrap>
                {d.display_name || "Unknown"}
              </Typography>
              <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
                {d.extension ? `Ext. ${d.extension}` : "No extension"}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Thread list (left pane).
// ---------------------------------------------------------------------------

interface ThreadListProps {
  threads: Thread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

function ThreadList({ threads, activeId, onSelect, onNew }: ThreadListProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Typography level="title-sm" sx={{ flex: 1 }}>
          Messages
        </Typography>
        <Button
          size="sm"
          variant="soft"
          color="primary"
          startDecorator={<AddCommentIcon />}
          onClick={onNew}
        >
          New
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {threads.length === 0 && (
          <Box sx={{ p: 5, textAlign: "center" }}>
            <ChatBubbleOutlineIcon sx={{ fontSize: 40, opacity: 0.3, mb: 1 }} />
            <Typography level="body-sm" sx={{ opacity: 0.65 }}>
              No conversations yet
            </Typography>
          </Box>
        )}

        {threads.map((t, i) => {
          const last = lastMessage(t);
          const active = t.id === activeId;
          return (
            <Box
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect(t.id);
              }}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                px: 2,
                py: 1.5,
                cursor: "pointer",
                borderTop: i === 0 ? "none" : "1px solid",
                borderColor: "divider",
                bgcolor: active ? "background.level1" : "transparent",
                "&:hover": { bgcolor: "background.level1" },
              }}
            >
              <Avatar
                variant="soft"
                sx={{ bgcolor: `${TEAL}20`, color: TEAL }}
              >
                {initialOf(t.name)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
                  <Typography
                    level="body-sm"
                    sx={{ fontWeight: t.unread ? 700 : 600, flex: 1 }}
                    noWrap
                  >
                    {t.name}
                  </Typography>
                  {last && (
                    <Typography
                      level="body-xs"
                      sx={{ opacity: 0.55, flexShrink: 0 }}
                    >
                      {relativeTime(last.at)}
                    </Typography>
                  )}
                </Box>
                <Typography
                  level="body-xs"
                  sx={{
                    opacity: t.unread ? 0.9 : 0.6,
                    fontWeight: t.unread ? 600 : 400,
                  }}
                  noWrap
                >
                  {last
                    ? `${last.direction === "out" ? "You: " : ""}${last.text}`
                    : "No messages"}
                </Typography>
              </Box>
              {t.unread && (
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: TEAL,
                    flexShrink: 0,
                  }}
                  aria-label="Unread"
                />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Conversation view (right pane).
// ---------------------------------------------------------------------------

interface ConversationProps {
  thread: Thread;
  onSend: (text: string) => void;
  /** Shown only on small screens to return to the thread list. */
  onBack: () => void;
}

function Conversation({ thread, onSend, onBack }: ConversationProps) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest message in view whenever the thread changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.id, thread.messages.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* Conversation header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 2,
          py: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <IconButton
          size="sm"
          variant="plain"
          color="neutral"
          onClick={onBack}
          aria-label="Back to conversations"
          sx={{ display: { xs: "inline-flex", md: "none" } }}
        >
          <ArrowBackIcon />
        </IconButton>
        <Avatar variant="soft" size="sm" sx={{ bgcolor: `${TEAL}20`, color: TEAL }}>
          {initialOf(thread.name)}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography level="title-sm" noWrap>
            {thread.name}
          </Typography>
          <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
            {thread.address}
          </Typography>
        </Box>
      </Box>

      {/* Message bubbles */}
      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          overflowY: "auto",
          minHeight: 0,
          px: 2,
          py: 2,
          display: "flex",
          flexDirection: "column",
          gap: 0.75,
        }}
      >
        {thread.messages.length === 0 && (
          <Typography
            level="body-sm"
            sx={{ opacity: 0.6, textAlign: "center", m: "auto" }}
          >
            Send a message to start the conversation.
          </Typography>
        )}
        {thread.messages.map((m) => {
          const out = m.direction === "out";
          return (
            <Box
              key={m.id}
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: out ? "flex-end" : "flex-start",
                maxWidth: "100%",
              }}
            >
              <Sheet
                variant="soft"
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: "lg",
                  maxWidth: "min(78%, 480px)",
                  bgcolor: out ? TEAL : "background.level2",
                  color: out ? "#fff" : "inherit",
                  borderTopRightRadius: out ? "4px" : "lg",
                  borderTopLeftRadius: out ? "lg" : "4px",
                }}
              >
                <Typography
                  level="body-sm"
                  sx={{
                    color: out ? "#fff" : "inherit",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {m.text}
                </Typography>
              </Sheet>
              <Typography
                level="body-xs"
                sx={{ opacity: 0.5, mt: 0.25, px: 0.5 }}
              >
                {clockTime(m.at)}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* Composer */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1.5,
          borderTop: "1px solid",
          borderColor: "divider",
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Text message"
          aria-label="Message text"
          sx={{ flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <IconButton
          variant="solid"
          color="primary"
          onClick={send}
          disabled={!draft.trim()}
          aria-label="Send message"
          sx={{ bgcolor: TEAL, "&:hover": { bgcolor: "#00796B" } }}
        >
          <SendIcon />
        </IconButton>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Messages — top-level texting UI.
// ---------------------------------------------------------------------------

interface MessagesProps {
  user: User | null;
  directory: DirectoryEntry[];
}

export function Messages({ user, directory }: MessagesProps) {
  // `user` is accepted for parity with the rest of the Telephony app (e.g. to
  // label outbound messages later); the Phase 1 scaffold doesn't need it yet.
  void user;

  const [threads, setThreads] = useState<Thread[]>(() => seedThreads());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composingNew, setComposingNew] = useState(false);

  const activeThread = threads.find((t) => t.id === activeId) ?? null;

  const openThread = (id: string) => {
    setComposingNew(false);
    setActiveId(id);
    // Clear the unread marker when a conversation is opened.
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, unread: false } : t)),
    );
  };

  const startNew = (target: {
    name: string;
    address: string;
    userId?: string;
  }) => {
    // Reuse an existing thread for the same address if one exists.
    const existing = threads.find((t) => t.address === target.address);
    if (existing) {
      setComposingNew(false);
      openThread(existing.id);
      return;
    }
    const thread: Thread = {
      id: nextId("t"),
      name: target.name,
      address: target.address,
      userId: target.userId,
      messages: [],
      unread: false,
    };
    setThreads((prev) => [thread, ...prev]);
    setComposingNew(false);
    setActiveId(thread.id);
  };

  const sendMessage = (text: string) => {
    if (!activeId) return;
    const msg: Message = {
      id: nextId("m"),
      direction: "out",
      text,
      at: Date.now(),
    };
    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeId ? { ...t, messages: [...t.messages, msg] } : t,
      ),
    );
    // Optional Phase 1 nicety: simulate a canned inbound reply so the thread
    // feels alive. The real reply path arrives with the SIP-trunk backend.
    const replyToId = activeId;
    window.setTimeout(() => {
      setThreads((prev) =>
        prev.map((t) =>
          t.id === replyToId
            ? {
                ...t,
                messages: [
                  ...t.messages,
                  {
                    id: nextId("m"),
                    direction: "in",
                    text: "Got it — thanks for the message!",
                    at: Date.now(),
                  },
                ],
                // Mark unread only if the user has navigated away.
                unread: replyToId !== activeIdRef.current,
              }
            : t,
        ),
      );
    }, 1800);
  };

  // Track the currently-open thread for the delayed reply closure above.
  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // On md+ both panes are visible; on xs we show one at a time.
  const showListOnXs = !activeThread && !composingNew;

  return (
    <Sheet
      variant="outlined"
      sx={{
        borderRadius: "md",
        overflow: "hidden",
        height: { xs: "70vh", md: "640px" },
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "320px 1fr" },
      }}
    >
      {/* LEFT pane: thread list (or the new-message picker) */}
      <Box
        sx={{
          minHeight: 0,
          borderRight: { md: "1px solid" },
          borderColor: { md: "divider" },
          // On xs, hide the list whenever a conversation/new-compose is open.
          display: {
            xs: showListOnXs ? "block" : "none",
            md: "block",
          },
        }}
      >
        {composingNew ? (
          <NewMessagePanel
            directory={directory}
            onCancel={() => setComposingNew(false)}
            onStart={startNew}
          />
        ) : (
          <ThreadList
            threads={threads}
            activeId={activeId}
            onSelect={openThread}
            onNew={() => {
              setComposingNew(true);
              setActiveId(null);
            }}
          />
        )}
      </Box>

      {/* RIGHT pane: the open conversation */}
      <Box
        sx={{
          minHeight: 0,
          display: {
            xs: showListOnXs ? "none" : "block",
            md: "block",
          },
        }}
      >
        {activeThread ? (
          <Conversation
            thread={activeThread}
            onSend={sendMessage}
            onBack={() => setActiveId(null)}
          />
        ) : (
          <Box
            sx={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              p: 4,
              textAlign: "center",
            }}
          >
            <Chip variant="soft" color="primary" startDecorator={<SmsIcon />}>
              Messages
            </Chip>
            <Typography level="body-md" sx={{ opacity: 0.65, mt: 1 }}>
              {composingNew
                ? "Pick a contact or enter a number to start."
                : "Select a conversation"}
            </Typography>
          </Box>
        )}
      </Box>
    </Sheet>
  );
}
