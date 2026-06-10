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
  Modal,
  ModalDialog,
  ModalClose,
  Tooltip,
  Chip,
  Divider,
  Badge,
} from "@mui/joy";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import CallEndIcon from "@mui/icons-material/CallEnd";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PeopleIcon from "@mui/icons-material/People";
import DeleteIcon from "@mui/icons-material/Delete";
import ChatIcon from "@mui/icons-material/Chat";
import SendIcon from "@mui/icons-material/Send";
import PanToolIcon from "@mui/icons-material/PanTool";
import CloseIcon from "@mui/icons-material/Close";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listRooms,
  createMeeting,
  deleteRoom,
  openSignalSocket,
  resolveCode,
  meetingLink,
} from "./api";
import type { MeetRoom, RemotePeer, SignalMessage, ChatEntry } from "./types";

// ---- ICE servers (STUN only; no TURN needed for same-LAN or cloud mesh) ----
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// ---------------------------------------------------------------------------
// VideoTile — renders one participant's camera/screen share.
// ---------------------------------------------------------------------------
interface VideoTileProps {
  stream: MediaStream | null;
  label: string;
  muted?: boolean; // mute own audio to avoid feedback
  noVideo?: boolean; // camera is off
  audioMuted?: boolean; // remote peer has muted their mic
  videoOff?: boolean; // remote peer has turned off camera
  handRaised?: boolean; // remote peer has raised their hand
}

function VideoTile({
  stream,
  label,
  muted = false,
  noVideo = false,
  audioMuted = false,
  videoOff = false,
  handRaised = false,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream ?? null;
    }
  }, [stream]);

  const hideVideo = noVideo || videoOff;

  return (
    <Box
      sx={{
        position: "relative",
        bgcolor: "background.level2",
        borderRadius: "md",
        overflow: "hidden",
        aspectRatio: "16/9",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 0,
      }}
    >
      {stream && !hideVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          aria-label={`${label}'s video`}
        />
      ) : (
        <Avatar sx={{ width: 56, height: 56, fontSize: 24 }}>
          {label.charAt(0).toUpperCase()}
        </Avatar>
      )}

      {/* Bottom label bar */}
      <Box
        sx={{
          position: "absolute",
          bottom: 8,
          left: 8,
          right: 8,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
        }}
      >
        <Box
          sx={{
            bgcolor: "rgba(0,0,0,0.55)",
            color: "#fff",
            px: 1,
            py: 0.25,
            borderRadius: "sm",
            fontSize: 13,
            fontWeight: 500,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </Box>
        {audioMuted && (
          <Box
            sx={{
              bgcolor: "rgba(0,0,0,0.65)",
              color: "#ff6b6b",
              borderRadius: "50%",
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Microphone muted"
          >
            <MicOffIcon sx={{ fontSize: 14 }} />
          </Box>
        )}
        {videoOff && !noVideo && (
          <Box
            sx={{
              bgcolor: "rgba(0,0,0,0.65)",
              color: "#ff6b6b",
              borderRadius: "50%",
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Camera off"
          >
            <VideocamOffIcon sx={{ fontSize: 14 }} />
          </Box>
        )}
      </Box>

      {/* Hand-raise indicator (top-right corner) */}
      {handRaised && (
        <Box
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            bgcolor: "#f4a11d",
            color: "#000",
            borderRadius: "50%",
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
          }}
          title="Hand raised"
        >
          <PanToolIcon sx={{ fontSize: 16 }} />
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// ChatPanel — slide-in side panel for in-call messaging.
// ---------------------------------------------------------------------------
interface ChatPanelProps {
  messages: ChatEntry[];
  localName: string;
  onSend: (text: string) => void;
  onClose: () => void;
}

function ChatPanel({ messages, onSend, onClose }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        width: { xs: "100%", sm: 300 },
        bgcolor: "#2d2e31",
        borderLeft: "1px solid rgba(255,255,255,0.1)",
        height: "100%",
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 2,
          py: 1.5,
          borderBottom: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <Typography level="title-sm" sx={{ color: "#fff", flex: 1 }}>
          In-call messages
        </Typography>
        <IconButton
          size="sm"
          variant="plain"
          sx={{ color: "#aaa" }}
          onClick={onClose}
          aria-label="Close chat"
        >
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Messages list */}
      <Box sx={{ flex: 1, overflowY: "auto", px: 2, py: 1 }}>
        {messages.length === 0 && (
          <Typography
            level="body-xs"
            sx={{ color: "#888", textAlign: "center", mt: 4 }}
          >
            No messages yet
          </Typography>
        )}
        {messages.map((m) => (
          <Box key={m.id} sx={{ mb: 1.5 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "baseline",
                gap: 0.75,
                mb: 0.25,
              }}
            >
              <Typography
                level="body-xs"
                sx={{ color: "#a8c7fa", fontWeight: 600 }}
              >
                {m.fromName}
              </Typography>
              <Typography level="body-xs" sx={{ color: "#666", fontSize: 11 }}>
                {new Date(m.sentAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Typography>
            </Box>
            <Typography
              level="body-sm"
              sx={{ color: "#e8eaed", wordBreak: "break-word" }}
            >
              {m.text}
            </Typography>
          </Box>
        ))}
        <div ref={bottomRef} />
      </Box>

      {/* Composer */}
      <Box
        sx={{
          display: "flex",
          gap: 1,
          px: 2,
          py: 1.5,
          borderTop: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <Input
          size="sm"
          placeholder="Send a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          sx={{
            flex: 1,
            bgcolor: "#3d3f44",
            color: "#fff",
            "--Input-placeholderColor": "#888",
          }}
          aria-label="Chat message"
        />
        <IconButton
          size="sm"
          variant="soft"
          color="primary"
          onClick={send}
          disabled={!draft.trim()}
          aria-label="Send message"
        >
          <SendIcon />
        </IconButton>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// RosterPanel — slide-in side panel listing all participants.
// ---------------------------------------------------------------------------
interface RosterPanelProps {
  localName: string;
  localMicOn: boolean;
  localCamOn: boolean;
  localHandRaised: boolean;
  remotePeers: RemotePeer[];
  onClose: () => void;
}

function RosterPanel({
  localName,
  localMicOn,
  localCamOn,
  localHandRaised,
  remotePeers,
  onClose,
}: RosterPanelProps) {
  const total = 1 + remotePeers.length;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        width: { xs: "100%", sm: 260 },
        bgcolor: "#2d2e31",
        borderLeft: "1px solid rgba(255,255,255,0.1)",
        height: "100%",
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 2,
          py: 1.5,
          borderBottom: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <Typography level="title-sm" sx={{ color: "#fff", flex: 1 }}>
          People ({total})
        </Typography>
        <IconButton
          size="sm"
          variant="plain"
          sx={{ color: "#aaa" }}
          onClick={onClose}
          aria-label="Close participants panel"
        >
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Participants list */}
      <Box sx={{ flex: 1, overflowY: "auto" }}>
        {/* Local user */}
        <RosterRow
          name={`${localName} (You)`}
          audioMuted={!localMicOn}
          videoOff={!localCamOn}
          handRaised={localHandRaised}
          isLocal
        />
        {remotePeers.map((p) => (
          <RosterRow
            key={p.id}
            name={p.name}
            audioMuted={p.audioMuted}
            videoOff={p.videoOff}
            handRaised={p.handRaised}
          />
        ))}
      </Box>
    </Box>
  );
}

interface RosterRowProps {
  name: string;
  audioMuted: boolean;
  videoOff: boolean;
  handRaised: boolean;
  isLocal?: boolean;
}

function RosterRow({
  name,
  audioMuted,
  videoOff,
  handRaised,
  isLocal = false,
}: RosterRowProps) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <Avatar size="sm" sx={{ bgcolor: isLocal ? "#2A9D8F40" : "#3a5ca840" }}>
        {name.charAt(0).toUpperCase()}
      </Avatar>
      <Typography
        level="body-sm"
        sx={{
          color: "#e8eaed",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </Typography>
      <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
        {handRaised && (
          <Tooltip title="Hand raised">
            <PanToolIcon sx={{ fontSize: 16, color: "#f4a11d" }} />
          </Tooltip>
        )}
        {audioMuted && (
          <Tooltip title="Microphone muted">
            <MicOffIcon sx={{ fontSize: 16, color: "#ff6b6b" }} />
          </Tooltip>
        )}
        {videoOff && (
          <Tooltip title="Camera off">
            <VideocamOffIcon sx={{ fontSize: 16, color: "#ff6b6b" }} />
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// CallView — the active call UI (video grid + controls + side panels).
// ---------------------------------------------------------------------------
interface CallViewProps {
  room: MeetRoom;
  user: User;
  onLeave: () => void;
}

function CallView({ room, user, onLeave }: CallViewProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [wsState, setWsState] = useState<"connecting" | "open" | "error">(
    "connecting",
  );
  const [copyFeedback, setCopyFeedback] = useState(false);

  // New: chat + hand-raise + side panels
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const [unreadChat, setUnreadChat] = useState(0);
  const [handRaised, setHandRaised] = useState(false);
  const [sidePanel, setSidePanel] = useState<"none" | "chat" | "roster">(
    "none",
  );

  const wsRef = useRef<WebSocket | null>(null);
  // peerConns maps remote peer id → RTCPeerConnection
  const peerConnsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Track which offers we've sent to avoid duplicate negotiation
  const pendingOffersRef = useRef<Set<string>>(new Set());
  // Keep latest localStream ref for adding tracks to new connections
  const localStreamRef = useRef<MediaStream | null>(null);

  const displayName = user.display_name || user.email || user.id;

  // The shareable link: use the short code if available, else fall back to current URL.
  const shareLink = room.code ? meetingLink(room.code) : window.location.href;
  const codeDisplay = room.code ?? null;

  // ---- Media acquisition ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setMediaError(
            "Camera & microphone need a secure context. Open this site over HTTPS " +
              "(or via http://localhost:8080) to enable video — you can still join to see and hear others.",
          );
        }
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (!cancelled) {
          setLocalStream(stream);
          localStreamRef.current = stream;
        } else {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes("Permission") ||
            msg.includes("NotAllowed") ||
            msg.includes("denied")
          ) {
            setMediaError(
              "Camera and microphone access was denied. You can still join with audio only or no media.",
            );
          } else if (msg.includes("NotFound") || msg.includes("Devices")) {
            setMediaError(
              "No camera or microphone found. Joining without local media.",
            );
          } else {
            setMediaError(`Media error: ${msg}`);
          }
          try {
            const audioOnly = await navigator.mediaDevices.getUserMedia({
              video: false,
              audio: true,
            });
            if (!cancelled) {
              setLocalStream(audioOnly);
              localStreamRef.current = audioOnly;
              setCamOn(false);
            } else {
              audioOnly.getTracks().forEach((t) => t.stop());
            }
          } catch {
            // No media at all — continue without it
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- WebSocket signaling ----
  const sendSignal = useCallback((msg: SignalMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const createPeerConnection = useCallback(
    (peerId: string, peerName: string, polite: boolean): RTCPeerConnection => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      const ls = localStreamRef.current;
      if (ls) {
        ls.getTracks().forEach((track) => pc.addTrack(track, ls));
      }

      const remoteStream = new MediaStream();
      pc.ontrack = (evt) => {
        evt.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
        setRemotePeers((prev) =>
          prev.map((p) =>
            p.id === peerId ? { ...p, stream: remoteStream } : p,
          ),
        );
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

      let makingOffer = false;
      pc.onnegotiationneeded = async () => {
        if (polite || pendingOffersRef.current.has(peerId)) return;
        try {
          makingOffer = true;
          await pc.setLocalDescription();
          sendSignal({
            type: "offer",
            to: peerId,
            payload: pc.localDescription,
          });
          pendingOffersRef.current.add(peerId);
        } finally {
          makingOffer = false;
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          setRemotePeers((prev) => prev.filter((p) => p.id !== peerId));
          peerConnsRef.current.delete(peerId);
        }
      };

      peerConnsRef.current.set(peerId, pc);

      setRemotePeers((prev) => {
        if (prev.some((p) => p.id === peerId)) return prev;
        return [
          ...prev,
          {
            id: peerId,
            name: peerName,
            conn: pc,
            stream: null,
            audioMuted: false,
            videoOff: false,
            handRaised: false,
          },
        ];
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      void makingOffer;
      return pc;
    },
    [sendSignal],
  );

  // Handle incoming signal messages
  const handleSignal = useCallback(
    async (msg: SignalMessage) => {
      switch (msg.type) {
        case "presence": {
          // Initial presence list — create connections to all existing peers.
          for (const peer of msg.peers ?? []) {
            if (!peerConnsRef.current.has(peer.id)) {
              createPeerConnection(peer.id, peer.name, false);
            }
          }
          break;
        }
        case "roster_state": {
          // Full roster snapshot with states — update existing remote peers' state.
          const byId = new Map((msg.peers ?? []).map((p) => [p.id, p]));
          setRemotePeers((prev) =>
            prev.map((p) => {
              const info = byId.get(p.id);
              if (!info) return p;
              return {
                ...p,
                audioMuted: info.audio_muted ?? false,
                videoOff: info.video_off ?? false,
                handRaised: info.hand_raised ?? false,
              };
            }),
          );
          break;
        }
        case "join": {
          if (msg.from && !peerConnsRef.current.has(msg.from)) {
            createPeerConnection(msg.from, msg.name ?? msg.from, true);
          }
          break;
        }
        case "leave": {
          if (msg.from) {
            const pc = peerConnsRef.current.get(msg.from);
            pc?.close();
            peerConnsRef.current.delete(msg.from);
            pendingOffersRef.current.delete(msg.from);
            setRemotePeers((prev) => prev.filter((p) => p.id !== msg.from));
          }
          break;
        }
        case "offer": {
          if (!msg.from || !msg.payload) break;
          let pc = peerConnsRef.current.get(msg.from);
          if (!pc) {
            pc = createPeerConnection(msg.from, msg.name ?? msg.from, true);
          }
          const sdp = msg.payload as RTCSessionDescriptionInit;
          const offerCollision = pc.signalingState !== "stable";
          const isPolite = true;
          if (!isPolite && offerCollision) break;
          if (offerCollision) {
            await Promise.all([
              pc.setLocalDescription({ type: "rollback" }),
              pc.setRemoteDescription(sdp),
            ]);
          } else {
            await pc.setRemoteDescription(sdp);
          }
          await pc.setLocalDescription();
          sendSignal({
            type: "answer",
            to: msg.from,
            payload: pc.localDescription,
          });
          break;
        }
        case "answer": {
          if (!msg.from || !msg.payload) break;
          const pc = peerConnsRef.current.get(msg.from);
          if (!pc) break;
          if (pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(
              msg.payload as RTCSessionDescriptionInit,
            );
            pendingOffersRef.current.delete(msg.from);
          }
          break;
        }
        case "candidate": {
          if (!msg.from || !msg.payload) break;
          const pc = peerConnsRef.current.get(msg.from);
          if (!pc) break;
          try {
            await pc.addIceCandidate(
              new RTCIceCandidate(msg.payload as RTCIceCandidateInit),
            );
          } catch {
            // Safe to ignore for rolled-back candidates
          }
          break;
        }
        case "chat": {
          if (!msg.from) break;
          const entry: ChatEntry = {
            id: `${msg.from}-${Date.now()}-${Math.random()}`,
            fromId: msg.from,
            fromName: msg.name ?? msg.from,
            text: msg.text ?? "",
            sentAt: Date.now(),
          };
          setChatMessages((prev) => [...prev, entry]);
          // Increment unread badge if chat panel is not open.
          setSidePanel((panel) => {
            if (panel !== "chat") setUnreadChat((n) => n + 1);
            return panel;
          });
          break;
        }
        case "media_state": {
          if (!msg.from) break;
          setRemotePeers((prev) =>
            prev.map((p) =>
              p.id === msg.from
                ? {
                    ...p,
                    audioMuted: msg.audio_muted ?? false,
                    videoOff: msg.video_off ?? false,
                  }
                : p,
            ),
          );
          break;
        }
        case "hand_raise": {
          if (!msg.from) break;
          setRemotePeers((prev) =>
            prev.map((p) =>
              p.id === msg.from
                ? { ...p, handRaised: msg.hand_raised ?? false }
                : p,
            ),
          );
          break;
        }
      }
    },
    [createPeerConnection, sendSignal],
  );

  // Open WS after media is settled (or after timeout)
  useEffect(() => {
    const ws = openSignalSocket(room.id);
    wsRef.current = ws;
    setWsState("connecting");

    ws.onopen = () => setWsState("open");
    ws.onerror = () => setWsState("error");
    ws.onclose = () => setWsState("error");
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as SignalMessage;
        void handleSignal(msg);
      } catch {
        // ignore malformed messages
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [room.id, handleSignal]);

  // ---- Control: mute/unmute — broadcast state change ----
  const toggleMic = () => {
    const stream = localStream ?? localStreamRef.current;
    if (!stream) return;
    const nextMicOn = !micOn;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = nextMicOn;
    });
    setMicOn(nextMicOn);
    sendSignal({
      type: "media_state",
      audio_muted: !nextMicOn,
      video_off: !camOn,
    });
  };

  const toggleCam = () => {
    const stream = localStream ?? localStreamRef.current;
    if (!stream) return;
    const nextCamOn = !camOn;
    stream.getVideoTracks().forEach((t) => {
      t.enabled = nextCamOn;
    });
    setCamOn(nextCamOn);
    sendSignal({
      type: "media_state",
      audio_muted: !micOn,
      video_off: !nextCamOn,
    });
  };

  // ---- Control: hand raise ----
  const toggleHandRaise = () => {
    const next = !handRaised;
    setHandRaised(next);
    sendSignal({ type: "hand_raise", hand_raised: next });
  };

  // ---- Control: screen share ----
  const toggleScreenShare = async () => {
    if (sharing) {
      screenStream?.getTracks().forEach((t) => t.stop());
      setScreenStream(null);
      setSharing(false);
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        peerConnsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          sender?.replaceTrack(camTrack).catch(() => {});
        });
      }
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      setScreenStream(screen);
      setSharing(true);
      const screenTrack = screen.getVideoTracks()[0];
      if (screenTrack) {
        peerConnsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          sender?.replaceTrack(screenTrack).catch(() => {});
        });
        screenTrack.onended = () => {
          setScreenStream(null);
          setSharing(false);
          const cam = localStreamRef.current?.getVideoTracks()[0];
          if (cam) {
            peerConnsRef.current.forEach((pc) => {
              const s = pc
                .getSenders()
                .find((sx) => sx.track?.kind === "video");
              s?.replaceTrack(cam).catch(() => {});
            });
          }
        };
      }
    } catch {
      // User cancelled or not supported — silently ignore
    }
  };

  // ---- Control: send chat message ----
  const sendChatMessage = (text: string) => {
    const entry: ChatEntry = {
      id: `local-${Date.now()}-${Math.random()}`,
      fromId: "local",
      fromName: displayName,
      text,
      sentAt: Date.now(),
    };
    setChatMessages((prev) => [...prev, entry]);
    sendSignal({ type: "chat", name: displayName, text });
  };

  // ---- Control: open side panel ----
  const openPanel = (panel: "chat" | "roster") => {
    setSidePanel((cur) => (cur === panel ? "none" : panel));
    if (panel === "chat") setUnreadChat(0);
  };

  // ---- Leave ----
  const leave = () => {
    localStream?.getTracks().forEach((t) => t.stop());
    screenStream?.getTracks().forEach((t) => t.stop());
    wsRef.current?.close();
    peerConnsRef.current.forEach((pc) => pc.close());
    peerConnsRef.current.clear();
    onLeave();
  };

  // ---- Copy invite link ----
  const copyLink = () => {
    navigator.clipboard
      .writeText(shareLink)
      .then(() => {
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 2000);
      })
      .catch(() => {});
  };

  const localVideoStream = sharing ? screenStream : localStream;
  const participantCount = 1 + remotePeers.length;
  const hasSidePanel = sidePanel !== "none";

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        bgcolor: "#202124",
      }}
    >
      {/* Top bar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: { xs: 1.5, sm: 3 },
          py: 1.5,
          bgcolor: "#202124",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          flexShrink: 0,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography level="title-md" sx={{ color: "#fff" }} noWrap>
            {room.name}
          </Typography>
          {codeDisplay && (
            <Typography
              level="body-xs"
              sx={{ color: "rgba(255,255,255,0.55)", letterSpacing: 1 }}
            >
              {codeDisplay}
            </Typography>
          )}
        </Box>
        <Chip
          size="sm"
          variant="soft"
          color="neutral"
          startDecorator={<PeopleIcon sx={{ fontSize: 14 }} />}
          sx={{ mr: 1 }}
        >
          {participantCount}
        </Chip>
        {wsState === "connecting" && (
          <CircularProgress size="sm" sx={{ color: "#aaa", mr: 1 }} />
        )}
        {wsState === "error" && (
          <Typography level="body-xs" sx={{ color: "#ff6b6b", mr: 1 }}>
            Signaling disconnected
          </Typography>
        )}
        <Tooltip
          title={
            copyFeedback
              ? "Copied!"
              : codeDisplay
                ? `Copy link (${codeDisplay})`
                : "Copy invite link"
          }
        >
          <IconButton
            onClick={copyLink}
            size="sm"
            variant="soft"
            color="neutral"
            sx={{ color: "#fff", mr: 1 }}
            aria-label="Copy invite link"
          >
            <ContentCopyIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Media error banner */}
      {mediaError && (
        <Box sx={{ bgcolor: "#3d2b00", px: 3, py: 1, flexShrink: 0 }}>
          <Typography level="body-sm" sx={{ color: "#ffd166" }}>
            {mediaError}
          </Typography>
        </Box>
      )}

      {/* Main area: video grid + optional side panel */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Video grid */}
        <Box
          sx={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm:
                participantCount === 1
                  ? "1fr"
                  : participantCount <= 4
                    ? "repeat(2, 1fr)"
                    : "repeat(3, 1fr)",
            },
            gap: 1.5,
            p: { xs: 1, sm: 2 },
            alignItems: "start",
            alignContent: "start",
            overflow: "auto",
          }}
        >
          {/* Local tile */}
          <VideoTile
            stream={localVideoStream}
            label={`${displayName} (You)`}
            muted
            noVideo={!camOn && !sharing}
            audioMuted={!micOn}
            videoOff={!camOn && !sharing}
            handRaised={handRaised}
          />
          {/* Remote tiles */}
          {remotePeers.map((peer) => (
            <VideoTile
              key={peer.id}
              stream={peer.stream}
              label={peer.name}
              noVideo={
                peer.stream === null ||
                peer.stream.getVideoTracks().length === 0
              }
              audioMuted={peer.audioMuted}
              videoOff={peer.videoOff}
              handRaised={peer.handRaised}
            />
          ))}
        </Box>

        {/* Side panel */}
        {hasSidePanel && sidePanel === "chat" && (
          <ChatPanel
            messages={chatMessages}
            localName={displayName}
            onSend={sendChatMessage}
            onClose={() => setSidePanel("none")}
          />
        )}
        {hasSidePanel && sidePanel === "roster" && (
          <RosterPanel
            localName={displayName}
            localMicOn={micOn}
            localCamOn={camOn}
            localHandRaised={handRaised}
            remotePeers={remotePeers}
            onClose={() => setSidePanel("none")}
          />
        )}
      </Box>

      {/* Controls bar */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 1.5,
          py: { xs: 1.5, sm: 2 },
          px: 1,
          bgcolor: "#202124",
          flexShrink: 0,
        }}
      >
        <Tooltip title={micOn ? "Mute microphone" : "Unmute microphone"}>
          <IconButton
            size="lg"
            variant={micOn ? "soft" : "solid"}
            color={micOn ? "neutral" : "danger"}
            onClick={toggleMic}
            disabled={!localStream}
            aria-label={micOn ? "Mute" : "Unmute"}
            sx={{ borderRadius: "50%" }}
          >
            {micOn ? <MicIcon /> : <MicOffIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip title={camOn ? "Turn off camera" : "Turn on camera"}>
          <IconButton
            size="lg"
            variant={camOn ? "soft" : "solid"}
            color={camOn ? "neutral" : "danger"}
            onClick={toggleCam}
            disabled={!localStream}
            aria-label={camOn ? "Turn off camera" : "Turn on camera"}
            sx={{ borderRadius: "50%" }}
          >
            {camOn ? <VideocamIcon /> : <VideocamOffIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip title={sharing ? "Stop screen share" : "Share screen"}>
          <IconButton
            size="lg"
            variant={sharing ? "solid" : "soft"}
            color={sharing ? "primary" : "neutral"}
            onClick={() => void toggleScreenShare()}
            aria-label={sharing ? "Stop sharing" : "Share screen"}
            sx={{ borderRadius: "50%" }}
          >
            {sharing ? <StopScreenShareIcon /> : <ScreenShareIcon />}
          </IconButton>
        </Tooltip>

        {/* Hand raise */}
        <Tooltip title={handRaised ? "Lower hand" : "Raise hand"}>
          <IconButton
            size="lg"
            variant={handRaised ? "solid" : "soft"}
            color={handRaised ? "warning" : "neutral"}
            onClick={toggleHandRaise}
            aria-label={handRaised ? "Lower hand" : "Raise hand"}
            sx={{ borderRadius: "50%" }}
          >
            <PanToolIcon />
          </IconButton>
        </Tooltip>

        {/* Participant list toggle */}
        <Tooltip title="Participants">
          <IconButton
            size="lg"
            variant={sidePanel === "roster" ? "solid" : "soft"}
            color={sidePanel === "roster" ? "primary" : "neutral"}
            onClick={() => openPanel("roster")}
            aria-label="Show participants"
            sx={{ borderRadius: "50%" }}
          >
            <PeopleIcon />
          </IconButton>
        </Tooltip>

        {/* Chat toggle */}
        <Tooltip title="Chat">
          <IconButton
            size="lg"
            variant={sidePanel === "chat" ? "solid" : "soft"}
            color={sidePanel === "chat" ? "primary" : "neutral"}
            onClick={() => openPanel("chat")}
            aria-label="Show chat"
            sx={{ borderRadius: "50%" }}
          >
            <Badge
              badgeContent={unreadChat > 0 ? unreadChat : undefined}
              color="danger"
              size="sm"
            >
              <ChatIcon />
            </Badge>
          </IconButton>
        </Tooltip>

        <Tooltip title="Leave call">
          <IconButton
            size="lg"
            variant="solid"
            color="danger"
            onClick={leave}
            aria-label="Leave call"
            sx={{ borderRadius: "50%", px: 3 }}
          >
            <CallEndIcon />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Lobby — room list + create/join.
// ---------------------------------------------------------------------------
interface LobbyProps {
  user: User;
  onJoin: (room: MeetRoom) => void;
}

function Lobby({ user, onJoin }: LobbyProps) {
  const [rooms, setRooms] = useState<MeetRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // "Join with a code" state
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);

  async function reload() {
    try {
      setRooms(await listRooms());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleCreate() {
    if (busy) return;
    setBusy(true);
    try {
      const room = await createMeeting(newName.trim() || "Quick meeting");
      await reload();
      setCreateOpen(false);
      setNewName("");
      onJoin(room);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinByCode() {
    const code = joinCode.trim().toLowerCase();
    if (!code) return;
    setJoinError(null);
    setJoinBusy(true);
    try {
      const room = await resolveCode(code);
      onJoin(room);
    } catch (e) {
      const msg = (e as Error).message;
      setJoinError(
        msg.includes("404")
          ? "Meeting not found for that code."
          : `Error: ${msg}`,
      );
    } finally {
      setJoinBusy(false);
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm("Delete this room?")) return;
    setDeletingId(id);
    try {
      await deleteRoom(id);
      await reload();
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  }

  // Suppress unused variable warning
  void user;

  return (
    <>
      <Header user={user} />
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <Typography level="h2" sx={{ flex: 1 }}>
            Meet
          </Typography>
          <Button
            variant="solid"
            color="primary"
            startDecorator={<AddIcon />}
            onClick={() => setCreateOpen(true)}
          >
            New meeting
          </Button>
        </Box>

        {/* Join with a code */}
        <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2, mb: 3 }}>
          <Typography level="title-sm" sx={{ mb: 1 }}>
            Join with a code
          </Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Input
              placeholder="abc-defg-hij"
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value);
                setJoinError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !joinBusy) void handleJoinByCode();
              }}
              sx={{ flex: 1, fontFamily: "monospace", letterSpacing: 1 }}
              aria-label="Meeting code"
              error={!!joinError}
            />
            <Button
              variant="soft"
              loading={joinBusy}
              onClick={() => void handleJoinByCode()}
              disabled={!joinCode.trim()}
            >
              Join
            </Button>
          </Box>
          {joinError && (
            <Typography level="body-xs" color="danger" sx={{ mt: 0.5 }}>
              {joinError}
            </Typography>
          )}
        </Sheet>

        {error && (
          <Sheet
            color="danger"
            variant="soft"
            sx={{ p: 2, mb: 2, borderRadius: "md" }}
          >
            <Typography color="danger">{error}</Typography>
          </Sheet>
        )}

        {rooms === null && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {rooms !== null && rooms.length === 0 && (
          <Sheet
            variant="soft"
            sx={{ p: 6, borderRadius: "md", textAlign: "center" }}
          >
            <VideocamIcon sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
            <Typography level="body-lg" sx={{ opacity: 0.7 }}>
              No meeting rooms yet. Create one to get started.
            </Typography>
          </Sheet>
        )}

        {rooms !== null && rooms.length > 0 && (
          <Sheet
            variant="outlined"
            sx={{ borderRadius: "md", overflow: "hidden" }}
          >
            {rooms.map((room, i) => (
              <Box
                key={room.id}
                data-testid={`room-${room.id}`}
                onClick={() => onJoin(room)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  px: { xs: 2, sm: 3 },
                  py: 1.5,
                  cursor: "pointer",
                  minHeight: 56,
                  borderTop: i === 0 ? "none" : "1px solid",
                  borderColor: "divider",
                  "&:hover": { bgcolor: "background.level1" },
                  "&:hover .row-actions": { opacity: 1 },
                }}
              >
                <Avatar
                  variant="soft"
                  color="primary"
                  sx={{ bgcolor: "#2A9D8F20", "--Avatar-size": "40px" }}
                >
                  <VideocamIcon sx={{ color: "#2A9D8F" }} />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography level="body-sm" sx={{ fontWeight: 600 }} noWrap>
                    {room.name}
                  </Typography>
                  <Typography
                    level="body-xs"
                    sx={{
                      opacity: 0.6,
                      fontFamily: room.code ? "monospace" : undefined,
                    }}
                  >
                    {room.code
                      ? room.code
                      : `Created ${new Date(room.created_at).toLocaleDateString()}`}
                  </Typography>
                </Box>
                <Button size="sm" variant="soft" color="primary">
                  Join
                </Button>
                <Box
                  className="row-actions"
                  sx={{
                    opacity: { xs: 1, md: 0 },
                    transition: "opacity 120ms",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Tooltip title="Delete room">
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="danger"
                      loading={deletingId === room.id}
                      onClick={(e) => void handleDelete(room.id, e)}
                      aria-label="Delete room"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            ))}
          </Sheet>
        )}

        <Divider sx={{ my: 4 }} />
        <Box sx={{ textAlign: "center", opacity: 0.6 }}>
          <Typography level="body-sm">
            Meet uses peer-to-peer WebRTC — your video goes directly to other
            participants.
          </Typography>
        </Box>
      </Container>

      {/* Create room modal */}
      {createOpen && (
        <Modal
          open
          onClose={() => {
            if (!busy) {
              setCreateOpen(false);
              setNewName("");
            }
          }}
        >
          <ModalDialog
            sx={{ width: { xs: "100vw", sm: 400 }, maxWidth: "100vw" }}
          >
            <ModalClose />
            <Typography level="h4">New meeting</Typography>
            <Typography level="body-sm" sx={{ opacity: 0.7, mt: 0.5 }}>
              Give your meeting a name, or leave blank for a default.
            </Typography>
            <Input
              autoFocus
              placeholder="Meeting name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) void handleCreate();
              }}
              sx={{ mt: 2 }}
              aria-label="Meeting name"
            />
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 1,
                mt: 2,
              }}
            >
              <Button
                variant="plain"
                color="neutral"
                onClick={() => {
                  setCreateOpen(false);
                  setNewName("");
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button loading={busy} onClick={() => void handleCreate()}>
                Create &amp; join
              </Button>
            </Box>
          </ModalDialog>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// MeetApp — top-level: lobby vs. active call.
// Reads the URL path to detect /meet/:code and auto-resolves it.
// ---------------------------------------------------------------------------
interface MeetAppProps {
  user: User;
}

export default function MeetApp({ user }: MeetAppProps) {
  const [activeRoom, setActiveRoom] = useState<MeetRoom | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Extract a code from the URL path if present: /meet/:code
  useEffect(() => {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    // pathParts[0] === "meet", pathParts[1] === code (if present)
    const maybeCode = pathParts[1] ?? "";
    // Only attempt if it looks like a meet code (xxx-xxxx-xxx)
    if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(maybeCode)) return;

    setResolving(true);
    resolveCode(maybeCode)
      .then((room) => {
        setActiveRoom(room);
        setResolving(false);
      })
      .catch((e: Error) => {
        const msg = e.message.includes("404")
          ? "Meeting not found."
          : `Could not join: ${e.message}`;
        setResolveError(msg);
        setResolving(false);
      });
    // Run only on mount — the code comes from the URL, not from React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (resolving) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (resolveError) {
    return (
      <>
        <Header user={user} />
        <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
          <Sheet
            color="danger"
            variant="soft"
            sx={{ p: 4, borderRadius: "md" }}
          >
            <Typography color="danger" level="title-md">
              {resolveError}
            </Typography>
            <Button
              sx={{ mt: 2 }}
              onClick={() => {
                setResolveError(null);
              }}
            >
              Back to Meet
            </Button>
          </Sheet>
        </Container>
      </>
    );
  }

  if (activeRoom) {
    return (
      <CallView
        room={activeRoom}
        user={user}
        onLeave={() => {
          setActiveRoom(null);
          // Navigate back to /meet (remove the code from the URL).
          if (window.location.pathname !== "/meet") {
            window.history.pushState(null, "", "/meet");
          }
        }}
      />
    );
  }

  return (
    <Lobby
      user={user}
      onJoin={(room) => {
        setActiveRoom(room);
        // Update the URL to the room's code if available.
        if (room.code && window.location.pathname !== `/meet/${room.code}`) {
          window.history.pushState(null, "", `/meet/${room.code}`);
        }
      }}
    />
  );
}
