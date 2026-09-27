import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Input,
  IconButton,
  Button,
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
import BarChartIcon from "@mui/icons-material/BarChart";
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
  recalcSheet,
  collabURL,
} from "./api";
import {
  recalcWrites,
  renameSheetInNamedRanges,
  sheetRenameEdits,
  workbookHasFormulas,
} from "./formulaRefs";
import { SheetMenuBar, type SheetActions } from "./SheetMenuBar";
import { FindReplaceDialog } from "./FindReplaceDialog";
import { ShareDialog } from "./ShareDialog";
import { ConditionalFormatDialog } from "./ConditionalFormatDialog";
import { NamedRangesDialog } from "./NamedRangesDialog";
import { DataValidationDialog } from "./DataValidationDialog";
import { ChartDialog } from "./ChartDialog";
import { ChartsPanel } from "./ChartsPanel";
import type { ChartConfig } from "./chartData";
import { PivotDialog } from "./PivotDialog";
import { PivotPanel } from "./PivotPanel";
import type { PivotConfig } from "./pivotData";
import {
  applyIconSets,
  clearIconSets,
  rangeFromSelection,
  type IconSetRule,
  type IconStyle,
} from "./iconSets";
import { downloadSheet } from "./export";
import { storableWorkbook } from "./workbookJson";
import { normalizeWorkbook, seedSelection } from "./normalize";
import { FilterDialog } from "./FilterDialog";
import { SheetNotice } from "./SheetNotice";
import {
  bindDataTools,
  currentSheet,
  dataToolHooks,
  migrateWorkbook,
  setCircleInvalid,
  setSheetCF,
  sheetCF,
  syncDerived,
} from "./sheetDataTools";
import { addRule, newRule, type IconSetName } from "./cfOps";
import { NumberFormatDialog } from "./NumberFormatDialog";
import { selectionRanges, typedInputHooks } from "./numberFormatActions";
import { useStableCallback } from "./useStableCallback";
import {
  afterDragFill,
  fillSelection,
  fixUpAfterStructure,
  pasteSpecialHere,
  rememberCopy,
  selectionRect,
  structureOpFromOps,
} from "./editActions";
import type { CellRect } from "./cellRange";
import { FillSeriesDialog } from "./FillSeriesDialog";
import { SortDialog } from "./SortDialog";
import { PasteSpecialDialog } from "./PasteSpecialDialog";

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

// Sheets added from the tab bar also start without a saved selection; seed
// one so the name box doesn't read "A1:NaN" there either (see normalize.ts).
const WORKBOOK_HOOKS = {
  beforeAddSheet: (sheet: any) => {
    try {
      seedSelection(sheet);
    } catch {
      /* a frozen sheet object: FortuneSheet's own default applies */
    }
    return true;
  },
};

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
  const [numFmtOpen, setNumFmtOpen] = useState(false);
  const [numFmtRanges, setNumFmtRanges] = useState<any[]>([]);
  const [dvOpen, setDvOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  // Dialogs that act on a range keep the selection taken when they opened.
  const [seriesRange, setSeriesRange] = useState<CellRect | null>(null);
  const [sortRangeSel, setSortRangeSel] = useState<CellRect | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [chartsOpen, setChartsOpen] = useState(false);
  const [charts, setCharts] = useState<ChartConfig[]>([]);
  const chartsRef = useRef<ChartConfig[]>([]);
  const [pivotOpen, setPivotOpen] = useState(false);
  const [pivotsOpen, setPivotsOpen] = useState(false);
  const [pivots, setPivots] = useState<PivotConfig[]>([]);
  const pivotsRef = useRef<PivotConfig[]>([]);
  const iconSetsRef = useRef<IconSetRule[]>([]);
  const dataRef = useRef<any[] | null>(null);
  const ref = useRef<any>(null);
  // Stable across renders: FortuneSheet keeps the hooks object it mounted with.
  const hooks = useRef<any>(null);
  if (!hooks.current) {
    const typed = typedInputHooks(() => ref.current);
    hooks.current = {
      ...WORKBOOK_HOOKS,
      ...typed,
      ...dataToolHooks,
      // Validation runs first; a rejected value never reaches typed-input parsing.
      beforeUpdateCell: (r: number, c: number, v: any) =>
        dataToolHooks.beforeUpdateCell(r, c, v) !== false && typed.beforeUpdateCell(r, c, v),
    };
  }
  const getWbRef = useRef(() => ref.current);
  // <Workbook> needs stable onOp/onChange: a new onOp on each render (presence
  // ticks, dialogs, autosave status) re-runs FortuneSheet's selection restore,
  // which snapped the selection back to A1 (see useStableCallback.ts).
  const stableOnOp = useStableCallback((ops: any[]) => onOp(ops));
  const stableOnChange = useStableCallback((d: any[]) => onChange(d));
  const wsRef = useRef<WebSocket | null>(null);
  const applyingRemote = useRef(false);
  // Last known tab name per sheet id (to spot renames in onChange).
  const sheetNamesRef = useRef(new Map<string, string>());
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
          // Fill display text the API/imports may have left out, so the
          // canvas paints every value, and seed a complete A1 selection
          // (see normalize.ts).
          // Older FortuneSheet-native CF/validation rules become Grown rules
          // (see sheetDataTools.ts).
          const parsed = migrateWorkbook(
            normalizeWorkbook(s.data ? JSON.parse(s.data) : structuredClone(DEFAULT_DATA)),
          );
          // Charts persist on the first sheet under `grownCharts`.
          const loaded: ChartConfig[] = Array.isArray(parsed?.[0]?.grownCharts)
            ? parsed[0].grownCharts
            : [];
          chartsRef.current = loaded;
          setCharts(loaded);
          const loadedPivots: PivotConfig[] = Array.isArray(parsed?.[0]?.grownPivots)
            ? parsed[0].grownPivots
            : [];
          pivotsRef.current = loadedPivots;
          setPivots(loadedPivots);
          iconSetsRef.current = Array.isArray(parsed?.[0]?.grownIconSets)
            ? parsed[0].grownIconSets
            : [];
          dataRef.current = parsed;
          sheetNamesRef.current = new Map(
            (Array.isArray(parsed) ? parsed : [])
              .filter((sh: any) => sh?.id)
              .map((sh: any) => [sh.id, sh.name]),
          );
          setData(parsed);
          // Re-apply icon overlays once the grid has mounted.
          if (iconSetsRef.current.length) {
            setTimeout(() => applyIconSets(ref.current, iconSetsRef.current), 300);
          }
        } catch {
          setData(DEFAULT_DATA);
        }
      })
      .catch(() => !cancelled && setData(DEFAULT_DATA));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Filters, conditional formats and validation write their models with
  // applyOp; the same ops go to collaborators over the socket.
  useEffect(
    () =>
      bindDataTools(
        () => ref.current,
        (ops) => {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN && ops.length) ws.send(JSON.stringify(ops));
        },
      ),
    [],
  );

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

  // Grid shortcuts FortuneSheet lacks: Ctrl+D / Ctrl+R fill down / right,
  // Ctrl+Shift+V paste values only; Ctrl+C / Ctrl+X also remember the block
  // for Paste special. Only while the grid (not a cell editor or dialog) has
  // the keyboard. After a fill-handle drag, Grown's autofill replaces
  // FortuneSheet's (see editActions.afterDragFill).
  useEffect(() => {
    const inGrid = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.('[data-testid="sheet-editor"]')) return false;
      const box = document.querySelector<HTMLElement>(".luckysheet-input-box");
      const editing = box ? box.style.zIndex === "19" : false;
      return !editing;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !inGrid(e)) return;
      const wb = ref.current;
      if (!wb) return;
      const k = e.key.toLowerCase();
      if (!e.shiftKey && (k === "d" || k === "r")) {
        e.preventDefault();
        e.stopPropagation();
        fillSelection(wb, k === "d" ? "down" : "right");
      } else if (e.shiftKey && k === "v") {
        e.preventDefault();
        e.stopPropagation();
        pasteSpecialHere(wb, { what: "values" });
      } else if (!e.shiftKey && (k === "c" || k === "x")) {
        rememberCopy(wb);
      }
    };
    const onMouseUp = () =>
      window.setTimeout(() => {
        try {
          if (ref.current) afterDragFill(ref.current);
        } catch (err) {
          // FortuneSheet's own fill stays.
          console.warn("autofill failed", err);
        }
      }, 0);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mouseup", onMouseUp, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mouseup", onMouseUp, true);
    };
  }, []);

  function onOp(ops: any[]) {
    if (applyingRemote.current) return;
    // Row/column inserts and deletes from FortuneSheet's own header menus:
    // fix formulas, named ranges and rule models from the pre-op workbook.
    const before = dataRef.current;
    const structOp = before ? structureOpFromOps(ops, before) : null;
    if (structOp && before) {
      setTimeout(() => {
        try {
          if (ref.current) fixUpAfterStructure(ref.current, before, structOp);
        } catch {
          /* keep FortuneSheet's own shift */
        }
      }, 0);
    }
    const ws = wsRef.current;
    if (
      ws &&
      ws.readyState === WebSocket.OPEN &&
      Array.isArray(ops) &&
      ops.length
    )
      ws.send(JSON.stringify(ops));
  }
  // withCharts attaches the current chart definitions onto the first sheet so
  // they round-trip through the saved workbook JSON (FortuneSheet ignores the
  // extra field; we read it back on load).
  function withExtras(d: any[]): any[] {
    if (!Array.isArray(d) || d.length === 0) return d;
    const copy = storableWorkbook(d);
    copy[0] = {
      ...copy[0],
      grownCharts: chartsRef.current,
      grownPivots: pivotsRef.current,
      grownIconSets: iconSetsRef.current,
    };
    return copy;
  }
  function onChange(d: any[]) {
    // FortuneSheet re-invokes onChange with the same workbook object whenever
    // the prop identity changes. The prop is stable now (stableOnChange), but
    // treat a repeat as no change anyway, otherwise each call would push the
    // debounced save back and it would never fire.
    if (d === dataRef.current) return;
    dataRef.current = d;
    // A tab rename shows up as a changed name for a known sheet id.
    // (FortuneSheet's afterUpdateSheetName hook reads a revoked draft in
    // 1.0.4 and never fires, so renames are detected here.)
    const names = sheetNamesRef.current;
    for (const sh of Array.isArray(d) ? d : []) {
      if (!sh?.id) continue;
      const prev = names.get(sh.id);
      if (prev !== undefined && prev !== sh.name) {
        const from = prev;
        const to = sh.name;
        setTimeout(() => onSheetRenamed(sh.id, from, to), 0);
      }
      names.set(sh.id, sh.name);
    }
    // Keep derived CF/validation/filter fields in step with the edit.
    setTimeout(() => {
      try {
        syncDerived(ref.current);
      } catch {
        /* ignore */
      }
    }, 0);
    // Re-apply icon-set overlays after edits. applyIconSets is idempotent, so
    // the write it triggers settles in one pass without looping.
    if (iconSetsRef.current.length) {
      setTimeout(() => applyIconSets(ref.current, iconSetsRef.current), 0);
    }
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const json = JSON.stringify(withExtras(d));
      saveSheet(id, json).catch(() => {});
      if (workbookHasFormulas(d)) {
        recalcSheet(id, json)
          .then(applyServerValues)
          .catch(() => {});
      }
    }, 1500);
  }
  // applyServerValues writes the server engine's results into the grid where
  // they differ from what fortune-sheet's own engine shows (cross-sheet refs,
  // named ranges, QUERY, LAMBDA, spills …). The writes are local: peers run
  // their own recalc after their save, so they are not broadcast.
  function applyServerValues(cells: Parameters<typeof recalcWrites>[1]) {
    const wb = ref.current;
    if (!wb) return;
    let writes;
    try {
      writes = recalcWrites(wb.getAllSheets?.() ?? [], cells);
    } catch {
      return;
    }
    if (!writes.length) return;
    applyingRemote.current = true;
    try {
      for (const w of writes) {
        try {
          wb.setCellValue(w.r, w.c, w.value, { id: w.sheetId });
        } catch {
          /* ignore */
        }
      }
    } finally {
      applyingRemote.current = false;
    }
  }
  // onSheetRenamed keeps formulas and named ranges pointing at a renamed tab
  // (FortuneSheet renames the tab but leaves Sheet1!A1 text untouched).
  function onSheetRenamed(_sheetId: string, oldName: string, newName: string) {
    const wb = ref.current;
    if (!wb || !oldName || oldName === newName) return;
    try {
      const all: any[] = wb.getAllSheets?.() ?? [];
      const nr = all[0]?._namedRanges;
      if (Array.isArray(nr) && nr.length) {
        const next = renameSheetInNamedRanges(nr, oldName, newName);
        if (JSON.stringify(next) !== JSON.stringify(nr)) {
          // updateSheet mutates what it is given; getAllSheets() is frozen.
          const copy = JSON.parse(JSON.stringify(all));
          copy[0]._namedRanges = next;
          wb.updateSheet?.(copy);
        }
      }
      const edits = sheetRenameEdits(wb.getAllSheets?.() ?? [], oldName, newName);
      for (const e of edits) {
        // Object form: writes into the target sheet (a formula string would go
        // through the cell editor path, which acts on the active sheet).
        wb.setCellValue(e.r, e.c, { f: e.f, v: e.v ?? "", m: e.m ?? "" }, { id: e.sheetId });
      }
    } catch {
      /* keep the rename even if the fix-up fails */
    }
  }

  // Format ▸ Icon set adds a conditional-format icon-set rule (cfOps.ts);
  // sheets that still carry the older display-overlay icons are cleared too.
  function addIconSet(style: IconStyle) {
    const range = rangeFromSelection(ref.current);
    const sheet = currentSheet(ref.current);
    if (!range || !sheet?.id) return;
    const set: Record<IconStyle, IconSetName> = { arrows: "3Arrows", traffic: "3TrafficLights1", signs: "3Signs" };
    const rule = newRule("iconSet", [{ r1: range.r0, r2: range.r1, c1: range.c0, c2: range.c1 }], { iconSet: set[style] });
    setSheetCF(ref.current, sheet.id, addRule(sheetCF(sheet), rule));
  }
  function clearAllIconSets() {
    const sheet = currentSheet(ref.current);
    if (sheet?.id) setSheetCF(ref.current, sheet.id, sheetCF(sheet).filter((r) => r.type !== "iconSet"));
    if (iconSetsRef.current.length) {
      clearIconSets(ref.current, iconSetsRef.current);
      iconSetsRef.current = [];
      persistExtras();
    }
  }
  // persistExtras saves charts/pivots immediately (they aren't FortuneSheet
  // cell edits, so they won't trigger onChange).
  function persistExtras() {
    const d = dataRef.current;
    if (d) saveSheet(id, JSON.stringify(withExtras(d))).catch(() => {});
  }
  function persistCharts(next: ChartConfig[]) {
    chartsRef.current = next;
    setCharts(next);
    persistExtras();
  }
  function persistPivots(next: PivotConfig[]) {
    pivotsRef.current = next;
    setPivots(next);
    persistExtras();
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
        if (all) await saveSheet(s.id, JSON.stringify(storableWorkbook(all)));
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
              onInsertChart={() => setChartOpen(true)}
              onInsertPivot={() => setPivotOpen(true)}
              onIconSet={addIconSet}
              onClearIconSets={clearAllIconSets}
              onFilterColumn={() => setFilterOpen(true)}
              onCircleInvalid={() => {
                const sheet = currentSheet(ref.current);
                if (sheet?.id) setCircleInvalid(ref.current, sheet.id, !sheet.grownCircleInvalid);
              }}
              onFillSeries={() => setSeriesRange(selectionRect(ref.current))}
              onSortDialog={() => setSortRangeSel(selectionRect(ref.current))}
              onPasteSpecial={() => setPasteOpen(true)}
              onCustomNumberFormat={() => {
                setNumFmtRanges(selectionRanges(ref.current));
                setNumFmtOpen(true);
              }}
            />
          </Box>
          <Box sx={{ flex: 1 }} />
          {charts.length > 0 && (
            <Button
              size="sm"
              variant="outlined"
              startDecorator={<BarChartIcon fontSize="small" />}
              onClick={() => setChartsOpen(true)}
              sx={{ mr: 1 }}
            >
              Charts ({charts.length})
            </Button>
          )}
          {pivots.length > 0 && (
            <Button
              size="sm"
              variant="outlined"
              startDecorator={<TableChartIcon fontSize="small" />}
              onClick={() => setPivotsOpen(true)}
              sx={{ mr: 1 }}
            >
              Pivots ({pivots.length})
            </Button>
          )}
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
          <Workbook
            ref={ref}
            data={data}
            onChange={stableOnChange}
            onOp={stableOnOp}
            hooks={hooks.current}
          />
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
      <NumberFormatDialog
        open={numFmtOpen}
        onClose={() => setNumFmtOpen(false)}
        getWb={getWbRef.current}
        ranges={numFmtRanges}
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
      <FilterDialog
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        getWb={() => ref.current}
      />
      <SheetNotice />
      <FillSeriesDialog
        open={seriesRange !== null}
        onClose={() => setSeriesRange(null)}
        getWb={getWbRef.current}
        range={seriesRange}
      />
      <SortDialog
        open={sortRangeSel !== null}
        onClose={() => setSortRangeSel(null)}
        getWb={getWbRef.current}
        range={sortRangeSel}
      />
      <PasteSpecialDialog open={pasteOpen} onClose={() => setPasteOpen(false)} getWb={getWbRef.current} />
      <ChartDialog
        open={chartOpen}
        onClose={() => setChartOpen(false)}
        getWb={() => ref.current}
        onAdd={(cfg) => {
          persistCharts([...chartsRef.current, cfg]);
          setChartsOpen(true);
        }}
      />
      <ChartsPanel
        open={chartsOpen}
        onClose={() => setChartsOpen(false)}
        getWb={() => ref.current}
        charts={charts}
        onDelete={(cid) => persistCharts(chartsRef.current.filter((c) => c.id !== cid))}
        onNew={() => {
          setChartsOpen(false);
          setChartOpen(true);
        }}
      />
      <PivotDialog
        open={pivotOpen}
        onClose={() => setPivotOpen(false)}
        getWb={() => ref.current}
        onAdd={(cfg) => {
          persistPivots([...pivotsRef.current, cfg]);
          setPivotsOpen(true);
        }}
      />
      <PivotPanel
        open={pivotsOpen}
        onClose={() => setPivotsOpen(false)}
        getWb={() => ref.current}
        pivots={pivots}
        onDelete={(pid) => persistPivots(pivotsRef.current.filter((p) => p.id !== pid))}
        onNew={() => {
          setPivotsOpen(false);
          setPivotOpen(true);
        }}
      />
    </Box>
  );
}
