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
} from "@mui/joy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import TableChartIcon from "@mui/icons-material/TableChart";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — FortuneSheet ships its own types; we use loose typing here.
import { Workbook } from "@fortune-sheet/react";
import "@fortune-sheet/react/dist/index.css";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  getSheet,
  renameSheet,
  createSheet,
  trashSheet,
  saveSheet,
  collabURL,
} from "./api";
import { SheetMenuBar, type SheetActions } from "./SheetMenuBar";
import { FindReplaceDialog } from "./FindReplaceDialog";
import { ShareDialog } from "./ShareDialog";
import { ConditionalFormatDialog } from "./ConditionalFormatDialog";
import { NamedRangesDialog } from "./NamedRangesDialog";
import { DataValidationDialog } from "./DataValidationDialog";
import { downloadSheet } from "./export";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet models are loosely typed. */

interface SheetEditorProps {
  user: User;
}

const DEFAULT_DATA = [
  {
    name: "Sheet1",
    id: "sheet1",
    order: 0,
    row: 100,
    column: 26,
    celldata: [],
  },
];

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

export function SheetEditor({ user }: SheetEditorProps) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState("Untitled spreadsheet");
  const [data, setData] = useState<any[] | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [findOpen, setFindOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [cfOpen, setCfOpen] = useState(false);
  const [nrOpen, setNrOpen] = useState(false);
  const [dvOpen, setDvOpen] = useState(false);
  const ref = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const applyingRemote = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  const me = {
    userId: user.id,
    username: user.display_name || user.email,
    color: colorFor(user.id),
  };

  useEffect(() => {
    let cancelled = false;
    getSheet(id)
      .then((s) => {
        if (cancelled) return;
        setTitle(s.title);
        try {
          setData(s.data ? JSON.parse(s.data) : DEFAULT_DATA);
        } catch {
          setData(DEFAULT_DATA);
        }
      })
      .catch(() => !cancelled && setData(DEFAULT_DATA));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Live collaboration: relay ops + presence over the WebSocket.
  useEffect(() => {
    const ws = new WebSocket(collabURL(id));
    wsRef.current = ws;
    ws.onopen = () => setStatus("live");
    ws.onclose = () => setStatus("offline");
    ws.onerror = () => setStatus("offline");
    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (Array.isArray(msg)) {
        applyingRemote.current = true;
        try {
          ref.current?.applyOp(msg);
        } catch {
          /* ignore */
        }
        applyingRemote.current = false;
      } else if (msg && msg.type === "presence") {
        try {
          ref.current?.addPresences?.([msg.presence]);
        } catch {
          /* ignore */
        }
        const p = msg.presence;
        setPeers((cur) => ({
          ...cur,
          [p.userId]: {
            userId: p.userId,
            username: p.username,
            color: p.color,
            ts: Date.now(),
          },
        }));
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [id]);

  // Broadcast our selection as presence (heartbeat + on change) and prune stale peers.
  useEffect(() => {
    let lastKey = "";
    const send = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      let r = 0,
        c = 0,
        sheetId = "sheet1";
      try {
        const s = ref.current?.getSelection?.();
        const sel = Array.isArray(s) ? s[0] : s;
        r = sel?.row?.[0] ?? 0;
        c = sel?.column?.[0] ?? 0;
        sheetId = ref.current?.getSheet?.()?.id ?? sheetId;
      } catch {
        /* ignore */
      }
      ws.send(
        JSON.stringify({
          type: "presence",
          presence: { ...me, sheetId, selection: { r, c } },
        }),
      );
    };
    const tick = window.setInterval(() => {
      // selection changed? broadcast immediately; otherwise heartbeat every cycle.
      let key = "";
      try {
        const s = ref.current?.getSelection?.();
        const sel = Array.isArray(s) ? s[0] : s;
        key = `${sel?.row?.[0]},${sel?.column?.[0]}`;
      } catch {
        /* ignore */
      }
      if (key !== lastKey) {
        lastKey = key;
        send();
      }
      // prune peers not seen in 12s
      setPeers((cur) => {
        const now = Date.now();
        const next: Record<string, Peer> = {};
        for (const [k, p] of Object.entries(cur)) {
          if (now - p.ts < 12000) next[k] = p;
          else
            try {
              ref.current?.removePresences?.([
                { username: p.username, userId: p.userId },
              ]);
            } catch {
              /* ignore */
            }
        }
        return next;
      });
    }, 1000);
    const heartbeat = window.setInterval(send, 4000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(heartbeat);
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/Cmd+H opens Find & replace (mirrors Google Sheets). FortuneSheet doesn't
  // bind this key itself, so we capture it at the document level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function onOp(ops: any[]) {
    if (applyingRemote.current) return;
    const ws = wsRef.current;
    if (
      ws &&
      ws.readyState === WebSocket.OPEN &&
      Array.isArray(ops) &&
      ops.length
    )
      ws.send(JSON.stringify(ops));
  }
  function onChange(d: any[]) {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveSheet(id, JSON.stringify(d)).catch(() => {});
    }, 1500);
  }
  async function commitTitle() {
    const t = title.trim() || "Untitled spreadsheet";
    setTitle(t);
    try {
      await renameSheet(id, t);
    } catch {
      /* keep local title */
    }
  }

  const actions: SheetActions = {
    newSheet: async () => {
      const s = await createSheet();
      navigate(`/sheets/d/${s.id}`);
    },
    open: () => navigate("/sheets"),
    makeCopy: async () => {
      const s = await createSheet(`Copy of ${title}`);
      try {
        const all = ref.current?.getAllSheets?.();
        if (all) await saveSheet(s.id, JSON.stringify(all));
      } catch {
        /* ignore */
      }
      navigate(`/sheets/d/${s.id}`);
    },
    rename: () =>
      (
        document.querySelector(
          '[aria-label="Spreadsheet title"]',
        ) as HTMLInputElement | null
      )?.focus(),
    trash: async () => {
      await trashSheet(id);
      navigate("/sheets");
    },
    share: () => setShareOpen(true),
    download: async (fmt) => {
      try {
        await downloadSheet(ref.current, title, fmt);
      } catch (e) {
        window.alert(`Download failed: ${(e as Error).message}`);
      }
    },
  };

  if (data === null) {
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
        sx={{ px: 2, pt: 1, bgcolor: "background.body" }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconButton
            variant="plain"
            aria-label="Back to Sheets"
            onClick={() => navigate("/sheets")}
          >
            <ArrowBackIcon />
          </IconButton>
          <TableChartIcon sx={{ color: "#1D8348", fontSize: 26 }} />
          <Box sx={{ minWidth: 0 }}>
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
              }}
              slotProps={{ input: { "aria-label": "Spreadsheet title" } }}
            />
            <SheetMenuBar
              getWb={() => ref.current}
              actions={actions}
              onFindReplace={() => setFindOpen(true)}
              onConditionalFormat={() => setCfOpen(true)}
              onNamedRanges={() => setNrOpen(true)}
              onDataValidation={() => setDvOpen(true)}
            />
          </Box>
          <Box sx={{ flex: 1 }} />
          <Box sx={{ display: { xs: "none", sm: "flex" } }}>
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
      <Box
        sx={{ flex: 1, minHeight: 0, overflow: "auto" }}
        data-testid="sheet-editor"
      >
        <Box sx={{ minWidth: { xs: 600, md: "100%" }, height: "100%" }}>
          <Workbook ref={ref} data={data} onChange={onChange} onOp={onOp} />
        </Box>
      </Box>
      <FindReplaceDialog
        open={findOpen}
        onClose={() => setFindOpen(false)}
        getWb={() => ref.current}
      />
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        sheetId={id}
      />
      <ConditionalFormatDialog
        open={cfOpen}
        onClose={() => setCfOpen(false)}
        getWb={() => ref.current}
      />
      <NamedRangesDialog
        open={nrOpen}
        onClose={() => setNrOpen(false)}
        getWb={() => ref.current}
      />
      <DataValidationDialog
        open={dvOpen}
        onClose={() => setDvOpen(false)}
        getWb={() => ref.current}
      />
    </Box>
  );
}
