import { useEffect, useRef, useState, useCallback } from "react";
import {
  Box,
  Button,
  Container,
  Typography,
  Sheet,
  IconButton,
  Avatar,
  Input,
  CircularProgress,
  Chip,
  Divider,
  Tooltip,
} from "@mui/joy";
import DialpadIcon from "@mui/icons-material/Dialpad";
import CallIcon from "@mui/icons-material/Call";
import CallEndIcon from "@mui/icons-material/CallEnd";
import CallMadeIcon from "@mui/icons-material/CallMade";
import CallReceivedIcon from "@mui/icons-material/CallReceived";
import CallMissedIcon from "@mui/icons-material/CallMissed";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import BackspaceIcon from "@mui/icons-material/Backspace";
import PersonIcon from "@mui/icons-material/Person";
import ChatIcon from "@mui/icons-material/ChatBubbleOutline";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { Messages } from "./Messages";
import { AdminArea } from "./AdminArea";
import { adminWhoAmI } from "../admin/usersApi";
import { listContacts } from "../contacts/api";
import {
  getMyExtension,
  listCallHistory,
  logCall,
  openSignalSocket,
} from "./api";
import type {
  DirectoryEntry,
  CallRecord,
  SignalMessage,
  CallState,
  ActiveCall,
} from "./types";

// ---- ICE servers (STUN only; mirrors Meet — no TURN) ----
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const DIALPAD_KEYS = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
  ["*", ""],
  ["0", "+"],
  ["#", ""],
];

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtCallTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Dialpad — number entry + call button (left column, top).
// ---------------------------------------------------------------------------
interface DialpadProps {
  disabled: boolean;
  onCall: (extension: string) => void;
}

function Dialpad({ disabled, onCall }: DialpadProps) {
  const [value, setValue] = useState("");

  const press = (key: string) => setValue((v) => v + key);
  const backspace = () => setValue((v) => v.slice(0, -1));
  const call = () => {
    const ext = value.trim();
    if (ext) onCall(ext);
  };

  return (
    <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9*#+]/g, ""))}
          placeholder="Extension"
          sx={{ flex: 1, fontFamily: "monospace", fontSize: 20, letterSpacing: 1 }}
          aria-label="Dial extension"
          onKeyDown={(e) => {
            if (e.key === "Enter") call();
          }}
        />
        {value && (
          <IconButton
            variant="plain"
            color="neutral"
            onClick={backspace}
            aria-label="Backspace"
          >
            <BackspaceIcon />
          </IconButton>
        )}
      </Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 1,
          mb: 1.5,
        }}
      >
        {DIALPAD_KEYS.map(([digit, letters]) => (
          <Button
            key={digit}
            variant="soft"
            color="neutral"
            onClick={() => press(digit)}
            sx={{
              flexDirection: "column",
              py: 1,
              minHeight: 52,
              lineHeight: 1,
            }}
          >
            <Typography level="title-md">{digit}</Typography>
            {letters && (
              <Typography level="body-xs" sx={{ opacity: 0.55, fontSize: 9 }}>
                {letters}
              </Typography>
            )}
          </Button>
        ))}
      </Box>
      <Button
        fullWidth
        color="success"
        startDecorator={<CallIcon />}
        onClick={call}
        disabled={disabled || !value.trim()}
      >
        Call
      </Button>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// RecentCalls — call history list (left column, bottom).
// ---------------------------------------------------------------------------
interface RecentCallsProps {
  calls: CallRecord[] | null;
  onCallBack: (extension: string) => void;
}

function RecentCalls({ calls, onCallBack }: RecentCallsProps) {
  return (
    <Sheet variant="outlined" sx={{ borderRadius: "md", overflow: "hidden" }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography level="title-sm">Recent</Typography>
      </Box>
      {calls === null && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size="sm" />
        </Box>
      )}
      {calls !== null && calls.length === 0 && (
        <Typography
          level="body-sm"
          sx={{ opacity: 0.6, textAlign: "center", py: 4 }}
        >
          No calls yet
        </Typography>
      )}
      {calls?.map((c) => {
        const missed = c.status === "missed";
        const outgoing = c.direction === "outgoing";
        const Icon = missed
          ? CallMissedIcon
          : outgoing
            ? CallMadeIcon
            : CallReceivedIcon;
        const color = missed ? "#d64550" : outgoing ? "#5f6368" : "#1D8348";
        return (
          <Box
            key={c.id}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 2,
              py: 1,
              borderTop: "1px solid",
              borderColor: "divider",
              "&:hover": { bgcolor: "background.level1" },
              "&:hover .callback-btn": { opacity: 1 },
            }}
          >
            <Icon sx={{ fontSize: 18, color }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography level="body-sm" sx={{ fontWeight: 600 }} noWrap>
                {c.peer_name || c.peer_extension || "Unknown"}
              </Typography>
              <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                {c.peer_extension ? `Ext. ${c.peer_extension} · ` : ""}
                {fmtCallTime(c.started_at)}
              </Typography>
            </Box>
            {c.peer_extension && (
              <IconButton
                className="callback-btn"
                size="sm"
                variant="plain"
                color="success"
                onClick={() => onCallBack(c.peer_extension)}
                aria-label={`Call back ${c.peer_name}`}
                sx={{ opacity: { xs: 1, md: 0 }, transition: "opacity 120ms" }}
              >
                <CallIcon />
              </IconButton>
            )}
          </Box>
        );
      })}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// InCallBar — overlay showing the active call with controls.
// ---------------------------------------------------------------------------
interface InCallBarProps {
  call: ActiveCall;
  state: CallState;
  durationSecs: number;
  muted: boolean;
  onToggleMute: () => void;
  onAccept: () => void;
  onHangup: () => void;
}

function InCallBar({
  call,
  state,
  durationSecs,
  muted,
  onToggleMute,
  onAccept,
  onHangup,
}: InCallBarProps) {
  const statusLabel =
    state === "ringing-out"
      ? "Ringing…"
      : state === "ringing-in"
        ? "Incoming call"
        : state === "connecting"
          ? "Connecting…"
          : state === "connected"
            ? fmtDuration(durationSecs)
            : "";

  return (
    <Box
      sx={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        width: { xs: "calc(100% - 24px)", sm: 420 },
        bgcolor: "#202124",
        color: "#fff",
        borderRadius: "lg",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        p: 2,
        zIndex: 1300,
        display: "flex",
        alignItems: "center",
        gap: 2,
      }}
    >
      <Avatar
        sx={{
          bgcolor: "#00897B40",
          color: "#4db6ac",
          width: 48,
          height: 48,
        }}
      >
        {(call.peerName || "?").charAt(0).toUpperCase()}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography level="title-sm" sx={{ color: "#fff" }} noWrap>
          {call.peerName || `Ext. ${call.peerExtension}`}
        </Typography>
        <Typography
          level="body-xs"
          sx={{ color: "rgba(255,255,255,0.6)" }}
          noWrap
        >
          {call.peerExtension ? `Ext. ${call.peerExtension} · ` : ""}
          {statusLabel}
        </Typography>
      </Box>

      {state === "ringing-in" && (
        <Tooltip title="Accept">
          <IconButton
            variant="solid"
            color="success"
            onClick={onAccept}
            aria-label="Accept call"
            sx={{ borderRadius: "50%" }}
          >
            <CallIcon />
          </IconButton>
        </Tooltip>
      )}

      {(state === "connected" || state === "connecting") && (
        <Tooltip title={muted ? "Unmute" : "Mute"}>
          <IconButton
            variant={muted ? "solid" : "soft"}
            color={muted ? "danger" : "neutral"}
            onClick={onToggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            sx={{ borderRadius: "50%", color: "#fff" }}
          >
            {muted ? <MicOffIcon /> : <MicIcon />}
          </IconButton>
        </Tooltip>
      )}

      <Tooltip title={state === "ringing-in" ? "Decline" : "Hang up"}>
        <IconButton
          variant="solid"
          color="danger"
          onClick={onHangup}
          aria-label="Hang up"
          sx={{ borderRadius: "50%" }}
        >
          <CallEndIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// TelephonyApp — top-level page.
// ---------------------------------------------------------------------------
interface TelephonyAppProps {
  user: User;
}

export default function TelephonyApp({ user }: TelephonyAppProps) {
  const [section, setSection] = useState<"phone" | "messages" | "admin">("phone");
  // The PBX admin console is gated to org admins; demo / regular users see the
  // Admin tab greyed out and never load it.
  const [isAdmin, setIsAdmin] = useState(false);
  const [myExt, setMyExt] = useState<string | null>(null);
  const [directory, setDirectory] = useState<DirectoryEntry[] | null>(null);
  const [calls, setCalls] = useState<CallRecord[] | null>(null);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Call lifecycle
  const [callState, setCallState] = useState<CallState>("idle");
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [muted, setMuted] = useState(false);
  const [durationSecs, setDurationSecs] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  // Mutable mirror of the active call for use inside WS callbacks.
  const activeCallRef = useRef<ActiveCall | null>(null);
  const callStartRef = useRef<number>(0);
  // Buffer ICE candidates that arrive before the remote description is set.
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const displayName = user.display_name || user.email || user.id;

  const setCall = useCallback((c: ActiveCall | null) => {
    activeCallRef.current = c;
    setActiveCall(c);
  }, []);

  // ---- Load initial data ----
  // The phone directory is sourced from the user's Contacts (not the org's
  // member list) for now — each contact's first phone number becomes its
  // dialable "extension".
  const reloadDirectory = useCallback(async () => {
    try {
      const contacts = await listContacts();
      const entries: DirectoryEntry[] = contacts
        .map((c) => ({
          user_id: c.id,
          display_name: c.display_name || c.first_name || c.last_name || "",
          email: c.emails?.[0] ?? "",
          extension: c.phones?.[0] ?? "",
          online: false,
        }))
        .filter((e) => e.extension); // only contacts with a number are dialable
      setDirectory(entries);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const reloadCalls = useCallback(async () => {
    try {
      setCalls(await listCallHistory());
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    getMyExtension()
      .then((e) => setMyExt(e.extension))
      .catch((e) => setError((e as Error).message));
    void reloadDirectory();
    void reloadCalls();
  }, [reloadDirectory, reloadCalls]);

  // Resolve admin status for PBX-admin gating (demo users get isAdmin=false).
  useEffect(() => {
    let alive = true;
    adminWhoAmI()
      .then((w) => alive && setIsAdmin(w.isAdmin))
      .catch(() => alive && setIsAdmin(false));
    return () => {
      alive = false;
    };
  }, []);

  // Never leave a non-admin parked on the admin console (e.g. after a refresh).
  useEffect(() => {
    if (!isAdmin && section === "admin") setSection("phone");
  }, [isAdmin, section]);

  // ---- Duration timer ----
  useEffect(() => {
    if (callState !== "connected") return;
    const id = window.setInterval(() => {
      setDurationSecs(Math.floor((Date.now() - callStartRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [callState]);

  // ---- Signaling ----
  const sendSignal = useCallback((msg: SignalMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const cleanupCall = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pendingCandidatesRef.current = [];
    setMuted(false);
    setDurationSecs(0);
  }, []);

  const recordCall = useCallback(
    (status: "completed" | "missed" | "rejected") => {
      const c = activeCallRef.current;
      if (!c) return;
      const startedAt =
        callStartRef.current > 0
          ? new Date(callStartRef.current).toISOString()
          : new Date().toISOString();
      void logCall({
        peer_id: c.peerId,
        direction: c.direction,
        status,
        started_at: startedAt,
        ended_at: new Date().toISOString(),
      }).then(() => void reloadCalls());
    },
    [reloadCalls],
  );

  // Build a peer connection wired to the current local stream + signaling.
  const createPeerConnection = useCallback(
    (peerId: string): RTCPeerConnection => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const ls = localStreamRef.current;
      if (ls) ls.getTracks().forEach((t) => pc.addTrack(t, ls));

      pc.ontrack = (evt) => {
        const [stream] = evt.streams;
        if (remoteAudioRef.current && stream) {
          remoteAudioRef.current.srcObject = stream;
          void remoteAudioRef.current.play().catch(() => {});
        }
      };
      pc.onicecandidate = (evt) => {
        if (evt.candidate) {
          sendSignal({
            type: "candidate",
            to: peerId,
            payload: evt.candidate.toJSON(),
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          if (callStartRef.current === 0) callStartRef.current = Date.now();
          setCallState("connected");
        } else if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          // Remote dropped — treat like a hangup.
          if (activeCallRef.current) {
            recordCall("completed");
          }
          cleanupCall();
          setCall(null);
          setCallState("idle");
        }
      };
      pcRef.current = pc;
      return pc;
    },
    [sendSignal, cleanupCall, recordCall, setCall],
  );

  const acquireMic = useCallback(async (): Promise<boolean> => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "Microphone needs a secure context. Open this site over HTTPS (or http://localhost:8080) to place calls.",
      );
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = stream;
      return true;
    } catch {
      setError("Microphone access was denied. Calls require a microphone.");
      return false;
    }
  }, []);

  // ---- Place an outgoing call ----
  const placeCall = useCallback(
    (peerId: string, peerName: string, peerExtension: string) => {
      if (callState !== "idle") return;
      callStartRef.current = 0;
      setCall({ peerId, peerName, peerExtension, direction: "outgoing" });
      setCallState("ringing-out");
      sendSignal({ type: "invite", to: peerId, name: displayName });
    },
    [callState, sendSignal, displayName, setCall],
  );

  const callExtension = useCallback(
    (extension: string) => {
      // Dial a contact when the number matches one, otherwise dial the raw
      // number. Contacts aren't presence-tracked, so there's no online gate.
      const entry = (directory ?? []).find((d) => d.extension === extension);
      const name = entry
        ? entry.display_name || entry.email || extension
        : extension;
      placeCall(entry ? entry.user_id : extension, name, extension);
    },
    [directory, placeCall],
  );

  // ---- Accept an incoming call ----
  const acceptCall = useCallback(async () => {
    const c = activeCallRef.current;
    if (!c || callState !== "ringing-in") return;
    if (!(await acquireMic())) {
      sendSignal({ type: "reject", to: c.peerId });
      cleanupCall();
      setCall(null);
      setCallState("idle");
      return;
    }
    setCallState("connecting");
    // The caller will send the offer once it receives our accept.
    sendSignal({ type: "accept", to: c.peerId, name: displayName });
  }, [callState, acquireMic, sendSignal, displayName, cleanupCall, setCall]);

  // ---- Hang up / decline ----
  const hangup = useCallback(() => {
    const c = activeCallRef.current;
    if (!c) return;
    sendSignal({ type: "hangup", to: c.peerId });
    if (callState === "ringing-in") {
      recordCall("rejected");
    } else if (callState === "connected") {
      recordCall("completed");
    } else {
      // ringing-out / connecting that never completed.
      recordCall("missed");
    }
    cleanupCall();
    setCall(null);
    setCallState("idle");
  }, [callState, sendSignal, recordCall, cleanupCall, setCall]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }, [muted]);

  // ---- Handle incoming signaling ----
  const handleSignal = useCallback(
    async (msg: SignalMessage) => {
      switch (msg.type) {
        case "presence":
          setOnline(new Set(msg.online ?? []));
          return;

        case "invite": {
          if (!msg.from) return;
          // Busy if already on a call.
          if (callState !== "idle" || activeCallRef.current) {
            sendSignal({ type: "busy", to: msg.from });
            return;
          }
          callStartRef.current = 0;
          setCall({
            peerId: msg.from,
            peerName: msg.name ?? "Unknown",
            peerExtension: "",
            direction: "incoming",
          });
          setCallState("ringing-in");
          return;
        }

        case "accept": {
          // Callee accepted our invite — acquire mic, create PC, send offer.
          const c = activeCallRef.current;
          if (!c || c.direction !== "outgoing") return;
          if (!(await acquireMic())) {
            sendSignal({ type: "hangup", to: c.peerId });
            cleanupCall();
            setCall(null);
            setCallState("idle");
            return;
          }
          setCallState("connecting");
          const pc = createPeerConnection(c.peerId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal({ type: "offer", to: c.peerId, payload: pc.localDescription });
          return;
        }

        case "reject": {
          if (activeCallRef.current) recordCall("missed");
          cleanupCall();
          setCall(null);
          setCallState("idle");
          setError("Call declined.");
          return;
        }

        case "busy": {
          if (activeCallRef.current) recordCall("missed");
          cleanupCall();
          setCall(null);
          setCallState("idle");
          setError("The person you called is busy.");
          return;
        }

        case "hangup": {
          if (activeCallRef.current) {
            recordCall(callState === "connected" ? "completed" : "missed");
          }
          cleanupCall();
          setCall(null);
          setCallState("idle");
          return;
        }

        case "offer": {
          // Incoming offer (we are the callee that accepted).
          const c = activeCallRef.current;
          if (!c || !msg.from || !msg.payload) return;
          const pc = pcRef.current ?? createPeerConnection(msg.from);
          await pc.setRemoteDescription(
            msg.payload as RTCSessionDescriptionInit,
          );
          // Flush any buffered candidates.
          for (const cand of pendingCandidatesRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          pendingCandidatesRef.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ type: "answer", to: msg.from, payload: pc.localDescription });
          return;
        }

        case "answer": {
          const pc = pcRef.current;
          if (!pc || !msg.payload) return;
          await pc.setRemoteDescription(
            msg.payload as RTCSessionDescriptionInit,
          );
          for (const cand of pendingCandidatesRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          pendingCandidatesRef.current = [];
          return;
        }

        case "candidate": {
          const pc = pcRef.current;
          if (!msg.payload) return;
          const cand = msg.payload as RTCIceCandidateInit;
          if (!pc || !pc.remoteDescription) {
            pendingCandidatesRef.current.push(cand);
            return;
          }
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          return;
        }
      }
    },
    [
      callState,
      sendSignal,
      acquireMic,
      createPeerConnection,
      cleanupCall,
      recordCall,
      setCall,
    ],
  );

  // ---- Open the persistent signaling socket ----
  useEffect(() => {
    const ws = openSignalSocket();
    wsRef.current = ws;
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as SignalMessage;
        void handleSignal(msg);
      } catch {
        // ignore malformed messages
      }
    };
    ws.onclose = () => setOnline(new Set());
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [handleSignal]);

  // Merge live presence into the directory's online flags.
  const dirWithPresence = (directory ?? []).map((d) => ({
    ...d,
    online: online.has(d.user_id),
  }));

  return (
    <>
      <Header user={user} />
      {/* Hidden audio sink for the remote party. */}
      <audio ref={remoteAudioRef} autoPlay style={{ display: "none" }} />

      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <DialpadIcon sx={{ color: "#00897B", fontSize: 32 }} />
          <Typography level="h2" sx={{ flex: 1 }}>
            Telephony
          </Typography>
          {myExt && (
            <Chip variant="soft" color="success" size="lg">
              Your extension: {myExt}
            </Chip>
          )}
        </Box>

        {/* Section nav: the softphone is the default; Messages is the
            Google-Voice-style texting area; Admin opens the PBX console. */}
        <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap" }}>
          {(
            [
              { key: "phone", label: "Phone", icon: <DialpadIcon /> },
              { key: "messages", label: "Messages", icon: <ChatIcon /> },
              { key: "admin", label: "Admin", icon: <AdminPanelSettingsIcon /> },
            ] as const
          ).map((t) => {
            const adminLocked = t.key === "admin" && !isAdmin;
            return (
              <Button
                key={t.key}
                size="sm"
                variant={section === t.key ? "solid" : "outlined"}
                color={section === t.key ? "primary" : "neutral"}
                startDecorator={t.icon}
                disabled={adminLocked}
                onClick={() => setSection(t.key)}
                data-testid={`telephony-nav-${t.key}`}
                title={adminLocked ? "PBX administration — admins only" : undefined}
              >
                {t.label}
              </Button>
            );
          })}
        </Box>

        {error && (
          <Sheet
            color="danger"
            variant="soft"
            sx={{
              p: 2,
              mb: 2,
              borderRadius: "md",
              display: "flex",
              alignItems: "center",
            }}
          >
            <Typography color="danger" sx={{ flex: 1 }}>
              {error}
            </Typography>
            <Button
              size="sm"
              variant="plain"
              color="danger"
              onClick={() => setError(null)}
            >
              Dismiss
            </Button>
          </Sheet>
        )}

        {section === "phone" && (
          <>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "320px 1fr" },
            gap: 3,
            alignItems: "start",
          }}
        >
          {/* Left column: dialpad + recent */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Dialpad disabled={callState !== "idle"} onCall={callExtension} />
            <RecentCalls calls={calls} onCallBack={callExtension} />
          </Box>

          {/* Main: directory */}
          <Sheet
            variant="outlined"
            sx={{ borderRadius: "md", overflow: "hidden" }}
          >
            <Box
              sx={{
                px: { xs: 2, sm: 3 },
                py: 1.5,
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              <Typography level="title-sm">Contacts</Typography>
            </Box>

            {directory === null && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                <CircularProgress />
              </Box>
            )}

            {directory !== null && dirWithPresence.length === 0 && (
              <Box sx={{ p: 6, textAlign: "center" }}>
                <PersonIcon sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
                <Typography level="body-lg" sx={{ opacity: 0.7 }}>
                  No contacts yet — add some in the Contacts app.
                </Typography>
              </Box>
            )}

            {dirWithPresence.map((m, i) => (
              <Box
                key={m.user_id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  px: { xs: 2, sm: 3 },
                  py: 1.5,
                  minHeight: 60,
                  borderTop: i === 0 ? "none" : "1px solid",
                  borderColor: "divider",
                  "&:hover": { bgcolor: "background.level1" },
                }}
              >
                <Box sx={{ position: "relative" }}>
                  <Avatar
                    variant="soft"
                    sx={{ bgcolor: "#00897B20", color: "#00897B" }}
                  >
                    {(m.display_name || m.email || "?")
                      .charAt(0)
                      .toUpperCase()}
                  </Avatar>
                  <Box
                    sx={{
                      position: "absolute",
                      bottom: 0,
                      right: 0,
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      bgcolor: m.online ? "#1D8348" : "#9aa0a6",
                      border: "2px solid",
                      borderColor: "background.surface",
                    }}
                    title={m.online ? "Online" : "Offline"}
                  />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography level="body-sm" sx={{ fontWeight: 600 }} noWrap>
                    {m.display_name || m.email}
                  </Typography>
                  <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
                    {m.extension ? `Ext. ${m.extension}` : "No extension"}
                    {m.email ? ` · ${m.email}` : ""}
                  </Typography>
                </Box>
                <Button
                  size="sm"
                  variant="soft"
                  color="success"
                  startDecorator={<CallIcon />}
                  disabled={callState !== "idle"}
                  onClick={() =>
                    placeCall(
                      m.user_id,
                      m.display_name || m.email,
                      m.extension,
                    )
                  }
                >
                  Call
                </Button>
              </Box>
            ))}
          </Sheet>
        </Box>

        <Divider sx={{ my: 4 }} />
        <Box sx={{ textAlign: "center", opacity: 0.6 }}>
          <Typography level="body-sm">
            Telephony uses peer-to-peer WebRTC audio — calls connect directly
            between members.
          </Typography>
        </Box>
          </>
        )}

        {section === "messages" && (
          <Messages user={user} directory={dirWithPresence} />
        )}
        {section === "admin" && isAdmin && <AdminArea user={user} />}
      </Container>

      {callState !== "idle" && activeCall && (
        <InCallBar
          call={activeCall}
          state={callState}
          durationSecs={durationSecs}
          muted={muted}
          onToggleMute={toggleMute}
          onAccept={() => void acceptCall()}
          onHangup={hangup}
        />
      )}
    </>
  );
}
