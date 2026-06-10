import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Input,
  IconButton,
  Sheet as JoySheet,
  Divider,
  CircularProgress,
  Chip,
  Avatar,
  AvatarGroup,
  Tooltip,
  Button,
} from "@mui/joy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import GestureIcon from "@mui/icons-material/Gesture";
import ShareIcon from "@mui/icons-material/Share";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  getWhiteboard,
  renameWhiteboard,
  saveWhiteboard,
  collabURL,
} from "./api";
import { ShareDialog } from "./ShareDialog";

/* eslint-disable @typescript-eslint/no-explicit-any -- Excalidraw types are heavy; we use loose typing. */

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
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

interface Peer {
  userId: string;
  username: string;
  color: string;
  ts: number;
}

export function WhiteboardEditor({ user }: { user: User }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState("Untitled whiteboard");
  const [initial, setInitial] = useState<any | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [shareOpen, setShareOpen] = useState(false);
  const apiRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const applyingRemote = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const bcastTimer = useRef<number | undefined>(undefined);

  const me = {
    userId: user.id,
    username: user.display_name || user.email,
    color: colorFor(user.id),
  };

  useEffect(() => {
    let cancelled = false;
    getWhiteboard(id)
      .then((wb) => {
        if (cancelled) return;
        setTitle(wb.title);
        let data: any = { elements: [], files: {} };
        try {
          if (wb.data) data = JSON.parse(wb.data);
        } catch {
          /* ignore */
        }
        setInitial({
          elements: data.elements || [],
          files: data.files || {},
          scrollToContent: true,
        });
      })
      .catch(() => !cancelled && setInitial({ elements: [], files: {} }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Live collaboration: relay scene + presence over the WebSocket.
  useEffect(() => {
    const ws = new WebSocket(collabURL(id));
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus("live");
      ws.send(JSON.stringify({ type: "presence", presence: me }));
    };
    ws.onclose = () => setStatus("offline");
    ws.onerror = () => setStatus("offline");
    ws.onmessage = (ev) => {
      let m: any;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.type === "scene" && apiRef.current) {
        applyingRemote.current = true;
        try {
          if (m.files && Object.keys(m.files).length)
            apiRef.current.addFiles(Object.values(m.files));
          apiRef.current.updateScene({ elements: m.elements || [] });
        } catch {
          /* ignore */
        }
        window.setTimeout(() => {
          applyingRemote.current = false;
        }, 0);
      } else if (m.type === "presence" && m.presence) {
        const p = m.presence;
        setPeers((cur) => ({ ...cur, [p.userId]: { ...p, ts: Date.now() } }));
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Presence heartbeat + prune.
  useEffect(() => {
    const send = () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "presence", presence: me }));
    };
    const hb = window.setInterval(send, 4000);
    const prune = window.setInterval(
      () =>
        setPeers((cur) => {
          const now = Date.now();
          const next: Record<string, Peer> = {};
          for (const [k, p] of Object.entries(cur))
            if (now - p.ts < 12000) next[k] = p;
          return next;
        }),
      2000,
    );
    return () => {
      window.clearInterval(hb);
      window.clearInterval(prune);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function onChange(elements: readonly any[], _appState: any, files: any) {
    if (applyingRemote.current) return;
    // Broadcast scene (throttled).
    window.clearTimeout(bcastTimer.current);
    bcastTimer.current = window.setTimeout(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "scene", elements, files }));
    }, 250);
    // Autosave.
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveWhiteboard(id, JSON.stringify({ elements, files })).catch(() => {});
    }, 1500);
  }

  async function commitTitle() {
    const t = title.trim() || "Untitled whiteboard";
    setTitle(t);
    try {
      await renameWhiteboard(id, t);
    } catch {
      /* keep local */
    }
  }

  if (initial === null) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  const peerList = Object.values(peers);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header user={user} />
      <JoySheet
        variant="plain"
        sx={{ px: 2, py: 0.5, bgcolor: "background.body" }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconButton
            variant="plain"
            aria-label="Back to Whiteboards"
            onClick={() => navigate("/whiteboard")}
          >
            <ArrowBackIcon />
          </IconButton>
          <GestureIcon sx={{ color: "#C46B45", fontSize: 26 }} />
          <Input
            value={title}
            variant="plain"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            sx={{
              fontSize: "1.1rem",
              fontWeight: 500,
              "--Input-focusedThickness": "0",
              px: 0.5,
              minWidth: 0,
              flex: 1,
              maxWidth: { xs: 160, sm: "none" },
            }}
            slotProps={{ input: { "aria-label": "Whiteboard title" } }}
          />
          <Box sx={{ flex: 1 }} />
          <Box
            sx={{
              display: { xs: "none", sm: "flex" },
              alignItems: "center",
              gap: 1,
            }}
          >
            <AvatarGroup size="sm">
              {peerList.map((p) => (
                <Tooltip key={p.userId} title={p.username}>
                  <Avatar sx={{ bgcolor: p.color, color: "#fff" }}>
                    {p.username.charAt(0).toUpperCase()}
                  </Avatar>
                </Tooltip>
              ))}
            </AvatarGroup>
          </Box>
          <Button
            size="sm"
            variant="outlined"
            startDecorator={<ShareIcon />}
            onClick={() => setShareOpen(true)}
            aria-label="Share whiteboard"
          >
            Share
          </Button>
          <Chip
            size="sm"
            variant="soft"
            color={
              status === "live"
                ? "success"
                : status === "offline"
                  ? "danger"
                  : "warning"
            }
          >
            {status}
          </Chip>
        </Box>
      </JoySheet>
      <Divider />
      <Box sx={{ flex: 1, minHeight: 0 }} data-testid="whiteboard-canvas">
        <Excalidraw
          excalidrawAPI={(api: any) => (apiRef.current = api)}
          initialData={initial}
          onChange={onChange}
        />
      </Box>

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        boardId={id}
      />
    </Box>
  );
}
