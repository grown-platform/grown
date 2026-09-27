import { useEffect, useMemo, useRef, useState } from "react";
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
  traceDeps,
  goalSeek,
  type GoalSeekResult,
} from "./api";
import {
  recalcWrites,
  renameSheetInNamedRanges,
  sheetRenameEdits,
  workbookHasFormulas,
} from "./formulaRefs";
import { SheetMenuBar, type SheetActions, type ViewState } from "./SheetMenuBar";
import { ImportDialog } from "./ImportDialog";
import { PrintDialog } from "./PrintDialog";
import { ProtectDialog } from "./ProtectDialog";
import { applyImport, type ImportMode, type ImportedWorkbook } from "./sheetImport";
import {
  insertPageBreak,
  removePageBreak,
  resetAllPageBreaks,
  sheetPrintSettings,
  type PrintSettings,
} from "./printSettings";
import { canChangeStructure, sheetProtection, type ProtectionModel } from "./protection";
import { sheetViewOptions, viewFields } from "./sheetView";
import {
  bindViewTools,
  blockedCellOps,
  editContext,
  invalidateView,
  protectedNotice,
  setEditContext,
  viewHooks,
} from "./viewTools";
import { SheetVersionHistory } from "../../components/versions/SheetVersionPreview";
import { VERSION_RESTORED_MSG, isVersionRestoredMsg } from "../../components/versions/api";
import { FindReplaceDialog } from "./FindReplaceDialog";
import { ShareDialog } from "./ShareDialog";
import { ConditionalFormatDialog } from "./ConditionalFormatDialog";
import { NamedRangesDialog } from "./NamedRangesDialog";
import { DataValidationDialog } from "./DataValidationDialog";
import { ChartDialog } from "./ChartDialog";
import { ChartsPanel } from "./ChartsPanel";
import type { ChartConfig } from "./chartData";
import { ChartOverlay, chartsChanged } from "./ChartOverlay";
import { SparklineDialog } from "./SparklineDialog";
import type { PivotConfig } from "./pivotData";
import { usePivotTools } from "./usePivotTools";
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
  patchSheet,
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
import { findShortcut, arrayFormulaText, a1, serialOf, stepFontSize, toggleReference, SHORTCUT_NUMBER_FORMATS, DATE_SHORTCUT_FORMAT, TIME_SHORTCUT_FORMAT } from "./sheetShortcuts";
import { SheetShortcutsDialog } from "./SheetShortcutsDialog";
import { FunctionWizard } from "./FunctionWizard";
import { GoalSeekDialog } from "./GoalSeekDialog";
import { LinkDialog, type LinkValue } from "./LinkDialog";
import { TraceOverlay, type TraceState } from "./TraceOverlay";
import { CellCommentsLayer, activeCellStore, refreshPaintThreads, threadsForPaint, type CellCommentsHandle } from "./CellCommentsLayer";
import { paintCommentMarker } from "./cellComments";
import { paintScriptCell, toggleScript, VA_SUB, VA_SUPER } from "./cellScript";
import { applyNumberFormat } from "./numberFormatActions";
import { formatKind, formatValue } from "./numberFormat";
import { parseA1Range } from "./cellValue";
import { gridGeometry } from "./chartAnchor";
import { translateFormula } from "./formulaShift";
import { selectAllTarget } from "./selectAll";
import { autoSumSelection, proposeSum, type CellKind } from "./autoSum";

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

// FortuneSheet shows its cell editor (the input box) above the grid while a
// cell is being edited.
function isEditingCell(): boolean {
  const box = document.querySelector<HTMLElement>(".luckysheet-input-box");
  if (box && box.style.zIndex === "19") return true;
  const a = document.activeElement as HTMLElement | null;
  return !!a?.closest?.(".fortune-fx-input") && a.isContentEditable;
}

// Caret / selection offsets inside a contenteditable, as plain-text offsets.
function textOffsets(el: HTMLElement): [number, number] {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return [el.innerText.length, el.innerText.length];
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  pre.setEnd(r.endContainer, r.endOffset);
  return [start, pre.toString().length];
}
function setTextSelection(el: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let sNode: Node | null = null;
  let sOff = 0;
  let eNode: Node | null = null;
  let eOff = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent?.length ?? 0;
    if (!sNode && start <= pos + len) {
      sNode = n;
      sOff = start - pos;
    }
    if (!eNode && end <= pos + len) {
      eNode = n;
      eOff = end - pos;
      break;
    }
    pos += len;
  }
  const range = document.createRange();
  if (sNode && eNode) {
    range.setStart(sNode, sOff);
    range.setEnd(eNode, eOff);
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
// Replaces a cell editor's text (FortuneSheet reads innerText when it
// commits). A keydown + input pair with a character key code makes
// FortuneSheet re-render a formula into its coloured reference spans (so its
// own caret bookkeeping works for the next typed key); the caret is then put
// back where it belongs.
function setEditorText(el: HTMLElement, text: string, start: number, end = start) {
  el.textContent = text;
  setTextSelection(el, start, end);
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", keyCode: 65, which: 65, bubbles: true } as KeyboardEventInit));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  const restore = () => {
    if (el.innerText.replace(/\n$/, "") === text) setTextSelection(el, start, end);
  };
  restore();
  window.setTimeout(restore, 0);
  window.setTimeout(restore, 40);
}

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
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const [importOpen, setImportOpen] = useState(false);
  // Print / Protect dialogs work on the sheet and selection taken when they opened.
  const [printFor, setPrintFor] = useState<{ sheet: any; selection: CellRect | null } | null>(null);
  const [protectFor, setProtectFor] = useState<{ sheet: any; selection: CellRect | null } | null>(null);
  const [ownerId, setOwnerId] = useState("");
  // Bumped to remount the grid after an import replaced the workbook.
  const [wbKey, setWbKey] = useState(0);
  const [view, setView] = useState<ViewState>(() => sheetViewOptions({}));
  // M12: shortcuts dialog, function wizard, link, comments; M5: goal seek, trace arrows.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [wizardFor, setWizardFor] = useState<{ formula: string; sheetId: string; r: number; c: number } | null>(null);
  const [goalSeekCell, setGoalSeekCell] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<{ sheetId: string; r: number; c: number; text: string; address: string } | null>(null);
  const [trace, setTrace] = useState<TraceState | null>(null);
  const traceRef = useRef<TraceState | null>(null);
  traceRef.current = trace;
  const [commentsPanel, setCommentsPanel] = useState(false);
  const commentsRef = useRef<CellCommentsHandle | null>(null);
  // A new generateSheetId identity makes FortuneSheet re-read gridlines/zoom from the sheet.
  const [viewGen, setViewGen] = useState(0);
  const generateSheetId = useMemo(() => {
    void viewGen;
    return () => (globalThis.crypto?.randomUUID?.() ?? `s${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
  }, [viewGen]);
  const refreshViewRef = useRef<() => void>(() => {});
  const [chartOpen, setChartOpen] = useState(false);
  const [chartsOpen, setChartsOpen] = useState(false);
  const [charts, setCharts] = useState<ChartConfig[]>([]);
  const chartsRef = useRef<ChartConfig[]>([]);
  const [chartEdit, setChartEdit] = useState<ChartConfig | null>(null);
  const [sparkOpen, setSparkOpen] = useState(false);
  const [editorEl, setEditorEl] = useState<HTMLElement | null>(null);
  const [pivotOpen, setPivotOpen] = useState(false);
  const [pivotsOpen, setPivotsOpen] = useState(false);
  const [pivots, setPivots] = useState<PivotConfig[]>([]);
  const pivotsRef = useRef<PivotConfig[]>([]);
  // Pivot tables on the grid (usePivotTools): typing guard and refresh after edits.
  const pivotToolsRef = useRef<{ guard: (r: number, c: number, v?: unknown) => boolean; changed: () => void } | null>(null);
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
      // Protection first, then validation; a rejected value never reaches typed-input parsing.
      beforeUpdateCell: (r: number, c: number, v: any) =>
        viewHooks.beforeUpdateCell(r, c) !== false &&
        pivotToolsRef.current?.guard(r, c, v) !== false &&
        dataToolHooks.beforeUpdateCell(r, c, v) !== false &&
        typed.beforeUpdateCell(r, c, v),
      beforePaste: (selection: any) => viewHooks.beforePaste(selection),
      beforeRenderCellArea: (cells: any, ctx: CanvasRenderingContext2D) => {
        viewHooks.beforeRenderCellArea();
        refreshPaintThreads(ref.current);
        return dataToolHooks.beforeRenderCellArea(cells, ctx);
      },
      // Formulas shown (View ▸ Show ▸ Formulas) are painted by viewTools;
      // superscript/subscript cells by cellScript.
      beforeRenderCell: (cell: any, info: any, ctx: CanvasRenderingContext2D) => {
        if (viewHooks.beforeRenderCell(cell, info, ctx) === false) return false;
        if (dataToolHooks.beforeRenderCell(cell, info, ctx) === false) return false;
        try {
          const v = sheetViewOptions(currentSheet(ref.current));
          if (paintScriptCell(cell, info, ctx, { zoom: v.zoom, gridlines: v.showGridLines })) return false;
        } catch {
          /* FortuneSheet paints it */
        }
        return true;
      },
      afterRenderCell: (cell: any, info: any, ctx: CanvasRenderingContext2D) => {
        dataToolHooks.afterRenderCell(cell, info, ctx);
        viewHooks.afterRenderCell(cell, info, ctx);
        paintCommentMarker(threadsForPaint(), info, ctx);
      },
      afterSelectionChange: (sheetId: string, sel: any) => {
        const r = sel?.row_focus ?? sel?.row?.[0];
        const c = sel?.column_focus ?? sel?.column?.[0];
        if (typeof r === "number" && typeof c === "number") activeCellStore.set({ sheetId: String(sheetId), r, c });
      },
      beforeRenderRowHeaderCell: viewHooks.beforeRenderRowHeaderCell,
      beforeRenderColumnHeaderCell: viewHooks.beforeRenderColumnHeaderCell,
      afterActivateSheet: () => setTimeout(() => refreshViewRef.current(), 0),
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

  // Loads a stored workbook into the grid (also after an import replaced it).
  function loadWorkbook(raw: any[] | null, remount = false) {
    // Fill display text the API/imports may have left out, so the
    // canvas paints every value, and seed a complete A1 selection
    // (see normalize.ts).
    // Older FortuneSheet-native CF/validation rules become Grown rules
    // (see sheetDataTools.ts).
    const parsed = migrateWorkbook(normalizeWorkbook(raw ?? structuredClone(DEFAULT_DATA)));
    const loaded: ChartConfig[] = Array.isArray(parsed?.[0]?.grownCharts) ? parsed[0].grownCharts : [];
    chartsRef.current = loaded;
    setCharts(loaded);
    const loadedPivots: PivotConfig[] = Array.isArray(parsed?.[0]?.grownPivots) ? parsed[0].grownPivots : [];
    pivotsRef.current = loadedPivots;
    setPivots(loadedPivots);
    iconSetsRef.current = Array.isArray(parsed?.[0]?.grownIconSets) ? parsed[0].grownIconSets : [];
    dataRef.current = parsed;
    sheetNamesRef.current = new Map(
      (Array.isArray(parsed) ? parsed : []).filter((sh: any) => sh?.id).map((sh: any) => [sh.id, sh.name]),
    );
    const first = (Array.isArray(parsed) ? parsed : []).find((sh: any) => !sh?.hide) ?? parsed?.[0];
    setView(sheetViewOptions(first));
    invalidateView();
    setData(parsed);
    if (remount) setWbKey((k) => k + 1);
    if (loadedPivots.some((p) => p.anchor)) setTimeout(() => pivotToolsRef.current?.changed(), 800);
    if (iconSetsRef.current.length) {
      setTimeout(() => applyIconSets(ref.current, iconSetsRef.current), 300);
    }
  }

  useEffect(() => {
    let cancelled = false;
    getSheet(id)
      .then((s) => {
        if (cancelled) return;
        setTitle(s.title);
        setOwnerId(s.owner_id);
        setEditContext({ user: user.id, owner: s.owner_id });
        try {
          loadWorkbook(s.data ? JSON.parse(s.data) : null);
        } catch {
          setData(DEFAULT_DATA);
        }
      })
      .catch(() => !cancelled && setData(DEFAULT_DATA));
    return () => {
      cancelled = true;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // View options and protection checks read the grid through viewTools.
  useEffect(() => {
    bindViewTools(() => ref.current, { user: user.id, owner: ownerId || undefined });
  }, [user.id, ownerId]);

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
      if (isVersionRestoredMsg(msg)) {
        // A collaborator restored a version: reload so this tab's stale
        // workbook can't autosave over it.
        window.clearTimeout(saveTimer.current);
        window.location.reload();
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

  // Keyboard shortcuts (sheetShortcuts.ts is the binding table; Help ▸
  // Keyboard shortcuts lists the same table). One capture-phase handler for
  // the grid and the cell editor; FortuneSheet's own bindings (native in the
  // table) pass through. Commands read the live selection when they run.
  // Ctrl+C / Ctrl+X also remember the block for Paste special. After a
  // fill-handle drag, Grown's autofill replaces FortuneSheet's
  // (see editActions.afterDragFill).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.('[data-testid="sheet-editor"]')) {
        // Outside the grid only the app-level bindings apply (not while typing in a dialog).
        if (t?.closest?.('[role="dialog"]') || t?.closest?.("input,textarea,[contenteditable=true]")) return;
      }
      const wb = ref.current;
      if (!wb) return;
      const editing = isEditingCell();
      // Ctrl/⌘+arrows while typing move the caret by word / to the line end
      // (FortuneSheet would move the grid selection instead).
      if (editing && (e.ctrlKey || e.metaKey) && e.key.startsWith("Arrow")) {
        e.stopPropagation();
        return;
      }
      if (!editing && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === "KeyC" || e.code === "KeyX")) rememberCopy(wb);
      const def = findShortcut(e, editing ? "editor" : "grid");
      if (!def) return;
      if (!t?.closest?.('[data-testid="sheet-editor"]') && !["shortcuts", "print", "find", "showFormulas"].includes(def.id)) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        shortcutActionRef.current(def.id, editing);
      } catch (err) {
        console.warn("shortcut failed", def.id, err);
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

  function onOp(opsIn: any[]) {
    if (applyingRemote.current) return;
    let ops = opsIn;
    // Row/column inserts and deletes from FortuneSheet's own header menus:
    // fix formulas, named ranges and rule models from the pre-op workbook.
    const before = dataRef.current;
    const structOp = before ? structureOpFromOps(ops, before) : null;
    // Protected sheets/ranges: undo edits the user may not make (the server
    // would revert them on save and drop them from the relay anyway).
    if (before) {
      const ctx = editContext();
      if (structOp) {
        const target = before.find((sh: any) => sh?.id === structOp.sheet || sh?.name === structOp.sheet);
        if (target && !canChangeStructure(sheetProtection(target), structOp, ctx)) {
          protectedNotice("range");
          setTimeout(() => {
            try {
              ref.current?.handleUndo?.();
            } catch {
              /* ignore */
            }
          }, 0);
          return;
        }
      }
      const blocked = blockedCellOps(ops, before, ctx);
      if (blocked.length) {
        const keys = new Set(blocked.map((b) => `${b.sheetId}:${b.r}:${b.c}`));
        ops = ops.filter((op) => !(Array.isArray(op?.path) && op.path[0] === "data" && keys.has(`${op.id}:${op.path[1]}:${op.path[2]}`)));
        protectedNotice();
        setTimeout(() => restoreCells(before, blocked), 0);
      }
    }
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
  // restoreCells puts protected cells back to their pre-edit content.
  function restoreCells(before: any[], cells: { sheetId: string; r: number; c: number }[]) {
    const wb = ref.current;
    if (!wb) return;
    applyingRemote.current = true;
    try {
      for (const { sheetId, r, c } of cells) {
        const sheet = before.find((sh: any) => String(sh?.id) === sheetId);
        const old = Array.isArray(sheet?.data)
          ? sheet.data[r]?.[c]
          : sheet?.celldata?.find((cd: any) => cd.r === r && cd.c === c)?.v;
        try {
          if (old) wb.setCellValue(r, c, JSON.parse(JSON.stringify(old)), { id: sheetId });
          else wb.clearCell(r, c, { id: sheetId });
        } catch {
          /* ignore */
        }
      }
    } finally {
      applyingRemote.current = false;
    }
  }

  // View ▸ Show / Zoom / Page breaks for the active sheet.
  function applyView(patch: Partial<ViewState>) {
    const wb = ref.current;
    const sheet = currentSheet(wb);
    if (!wb || !sheet?.id) return;
    const next = { ...sheetViewOptions(sheet), ...patch };
    patchSheet(wb, sheet.id, viewFields(next));
    setView(next);
    invalidateView();
    // Gridlines and zoom are read from the sheet when FortuneSheet re-initialises
    // it; headings repaint with the grid.
    if (patch.showGridLines !== undefined || patch.zoom !== undefined || patch.showHeadings !== undefined) setViewGen((g) => g + 1);
  }
  refreshViewRef.current = () => setView(sheetViewOptions(currentSheet(ref.current)));

  // ---- M12 keyboard shortcuts and M5 analysis tools ----------------------

  function activeCell(): { sheetId: string; r: number; c: number } | null {
    const wb = ref.current;
    try {
      const s = wb?.getSelection?.();
      const sel = Array.isArray(s) ? s[s.length - 1] : s;
      const sheetId = String(wb?.getSheet?.()?.id ?? "");
      // getSelection() has no focus cell; the afterSelectionChange hook does.
      const f = activeCellStore.get();
      if (
        f &&
        f.sheetId === sheetId &&
        sel?.row &&
        f.r >= Math.min(sel.row[0], sel.row[1]) &&
        f.r <= Math.max(sel.row[0], sel.row[1]) &&
        f.c >= Math.min(sel.column[0], sel.column[1]) &&
        f.c <= Math.max(sel.column[0], sel.column[1])
      )
        return f;
      const r = sel?.row_focus ?? sel?.row?.[0];
      const c = sel?.column_focus ?? sel?.column?.[0];
      if (!sheetId || typeof r !== "number" || typeof c !== "number") return null;
      return { sheetId, r, c };
    } catch {
      return null;
    }
  }
  function cellAt(sheetId: string, r: number, c: number): any {
    try {
      const sh = (ref.current?.getAllSheets?.() ?? []).find((x: any) => String(x?.id) === sheetId);
      return sh?.data?.[r]?.[c] ?? null;
    } catch {
      return null;
    }
  }
  function liveJson(): string {
    const all = ref.current?.getAllSheets?.() ?? dataRef.current ?? [];
    return JSON.stringify(withExtras(all));
  }
  // Toggles a 0/1 style attribute over the selection, from the active cell's state.
  function toggleAttr(attr: string, on?: any) {
    const wb = ref.current;
    const a = activeCell();
    if (!wb || !a) return;
    const cur = cellAt(a.sheetId, a.r, a.c)?.[attr];
    const next = on !== undefined ? on : cur ? 0 : 1;
    for (const range of selectionRanges(wb)) wb.setCellFormatByRange(attr, next, range);
  }
  function setScript(which: typeof VA_SUPER | typeof VA_SUB) {
    const a = activeCell();
    if (!a) return;
    toggleAttr("va", toggleScript(cellAt(a.sheetId, a.r, a.c)?.va, which));
  }
  function stepFont(dir: 1 | -1) {
    const wb = ref.current;
    const a = activeCell();
    if (!wb || !a) return;
    const cur = Number(cellAt(a.sheetId, a.r, a.c)?.fs) || 10;
    const next = stepFontSize(cur, dir);
    for (const range of selectionRanges(wb)) wb.setCellFormatByRange("fs", next, range);
  }
  function clearFormatting() {
    const wb = ref.current;
    if (!wb) return;
    for (const range of selectionRanges(wb)) {
      for (const attr of ["bl", "it", "un", "cl", "va", "fc", "bg", "fs", "ff", "ht", "vt"]) wb.setCellFormatByRange(attr, undefined, range);
      wb.setCellFormatByRange("ct", { fa: "General", t: "g" }, range);
    }
  }
  // Ctrl+; / Ctrl+Shift+;: a date or time value in the grid, its text in the editor.
  function insertNow(kind: "date" | "time", editing: boolean) {
    const now = new Date();
    const serial = serialOf(now);
    const fa = kind === "date" ? DATE_SHORTCUT_FORMAT : TIME_SHORTCUT_FORMAT;
    const v = kind === "date" ? Math.floor(serial) : serial;
    const text = formatValue(v, fa);
    if (editing) {
      document.execCommand("insertText", false, text);
      return;
    }
    const a = activeCell();
    if (!a) return;
    ref.current?.setCellValue(a.r, a.c, { v, m: text, ct: { fa, t: "d" } }, { id: a.sheetId });
  }
  // Opens FortuneSheet's editor on the active cell (as F2 does) with `text`.
  function editActiveCell(text: string, selStart: number, selEnd = selStart) {
    const input = document.querySelector<HTMLElement>(".luckysheet-cell-input");
    if (!input) return;
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", code: "F2", bubbles: true, cancelable: true }));
    window.setTimeout(() => {
      input.focus();
      setEditorText(input, text, selStart, selEnd);
    }, 30);
  }
  // Alt+=: one cell opens the editor with the proposed =SUM(…); a selection
  // gets its totals written (autoSum.ts), as one undo step.
  function autoSum() {
    const wb = ref.current;
    const a = activeCell();
    const sheet = currentSheet(wb);
    const sel = selectionRect(wb);
    if (!wb || !a || !sheet || !sel) return;
    const data: any[][] = Array.isArray(sheet.data) ? sheet.data : [];
    const kind = (r: number, c: number): CellKind => {
      const cell = data[r]?.[c];
      if (!cell) return "empty";
      if (typeof cell.f === "string" && /^=\s*SUM\s*\(/i.test(cell.f)) return "sum";
      const v = cell.v;
      if (v === undefined || v === null || v === "") return cell.ct?.s ? "text" : "empty";
      const fa = cell.ct?.fa;
      if (fa === "@" || typeof v === "string" || typeof v === "boolean") return "text";
      const fk = formatKind(fa);
      return fk === "date" || fk === "time" ? "date" : "num";
    };
    if (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) {
      const res = autoSumSelection(kind, sel);
      if (!res) return;
      wb.batchCallApis(res.writes.map((w) => ({ name: "setCellValue", args: [w.r, w.c, w.f, { id: a.sheetId }] })));
      const t = res.selection;
      window.setTimeout(() => wb.setSelection([{ row: [t.r1, t.r2], column: [t.c1, t.c2] }], { id: a.sheetId }), 0);
      return;
    }
    const range = proposeSum(kind, a.r, a.c);
    const text = `=SUM(${range})`;
    editActiveCell(text, 5, 5 + range.length);
  }
  function toggleRefInEditor() {
    const el = document.activeElement as HTMLElement | null;
    if (!el?.isContentEditable) return;
    const text = el.innerText.replace(/\n$/, "");
    if (!text.startsWith("=")) return;
    const [start, end] = textOffsets(el);
    const next = toggleReference(text, start, end);
    if (next.text !== text) setEditorText(el, next.text, next.caret, next.selEnd);
  }
  function switchSheet(dir: 1 | -1) {
    const wb = ref.current;
    if (!wb) return;
    const sheets = (wb.getAllSheets?.() ?? []).filter((x: any) => !x?.hide).sort((x: any, y: any) => (x.order ?? 0) - (y.order ?? 0));
    const cur = String(wb.getSheet?.()?.id ?? "");
    const i = sheets.findIndex((x: any) => String(x.id) === cur);
    const next = sheets[i + dir];
    if (next) wb.activateSheet({ id: next.id });
  }
  // Shift+Enter / Tab / Shift+Tab while editing: commit (FortuneSheet's Enter)
  // and move up / right / left instead of down.
  function commitAndMove(action: string) {
    const a = activeCell();
    const input = document.querySelector<HTMLElement>(".luckysheet-cell-input");
    if (!a || !input) return;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true } as KeyboardEventInit));
    const r = action === "saveUp" ? Math.max(0, a.r - 1) : a.r;
    const c = action === "saveRight" ? a.c + 1 : action === "saveLeft" ? Math.max(0, a.c - 1) : a.c;
    window.setTimeout(() => {
      try {
        ref.current?.setSelection([{ row: [r, r], column: [c, c] }], { id: a.sheetId });
      } catch {
        /* FortuneSheet's own move stays */
      }
    }, 0);
  }
  // Ctrl+Enter: the text being typed goes into every selected cell, formulas
  // with their relative references moved (A1:B1 with =A2:B2 → B1 =B2:C2).
  function fillEntry() {
    const wb = ref.current;
    const a = activeCell();
    const input = document.querySelector<HTMLElement>(".luckysheet-cell-input");
    if (!wb || !a || !input) return;
    const text = input.innerText.replace(/\n$/, "");
    const rects = selectionRanges(wb).map((rg: any) => ({
      r1: Math.min(rg.row[0], rg.row[1]),
      r2: Math.max(rg.row[0], rg.row[1]),
      c1: Math.min(rg.column[0], rg.column[1]),
      c2: Math.max(rg.column[0], rg.column[1]),
    }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true } as KeyboardEventInit));
    window.setTimeout(() => {
      const calls: { name: string; args: any[] }[] = [];
      for (const rc of rects) {
        for (let r = rc.r1; r <= rc.r2; r++) {
          for (let c = rc.c1; c <= rc.c2; c++) {
            if (r === a.r && c === a.c) continue;
            const v = text.startsWith("=") ? translateFormula(text, r - a.r, c - a.c) : text;
            calls.push({ name: "setCellValue", args: [r, c, v, { id: a.sheetId }] });
          }
        }
      }
      try {
        if (calls.length) wb.batchCallApis(calls);
        wb.setSelection(rects.map((rc) => ({ row: [rc.r1, rc.r2], column: [rc.c1, rc.c2] })), { id: a.sheetId });
      } catch {
        /* the active cell keeps its entry */
      }
    }, 0);
  }
  // Ctrl+Shift+Enter: enter the formula as an array formula.
  function arrayEntry() {
    const input = document.querySelector<HTMLElement>(".luckysheet-cell-input");
    if (!input) return;
    const text = input.innerText.replace(/\n$/, "");
    const next = arrayFormulaText(text);
    if (next !== text) setEditorText(input, next, next.length);
    window.setTimeout(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true } as KeyboardEventInit));
    }, 50);
  }
  // Ctrl+A: the data around the active cell (or a table's rows, then the
  // table), then the whole sheet (selectAll.ts).
  function selectAllStep() {
    const wb = ref.current;
    const a = activeCell();
    const sheet = currentSheet(wb);
    const sel = selectionRect(wb);
    if (!wb || !a || !sheet || !sel) return;
    const data: any[][] = Array.isArray(sheet.data) ? sheet.data : [];
    const filled = (r: number, c: number) => {
      const v = data[r]?.[c];
      return !!v && ((v.v != null && v.v !== "") || !!v.f || !!v.ct?.s);
    };
    const tables = Array.isArray(sheet.grownTables) ? sheet.grownTables : [];
    const t = selectAllTarget(filled, sel, a.r, a.c, tables);
    const rows = Math.max(data.length, Number(sheet.row) || 0) - 1;
    const cols = Math.max(data[0]?.length ?? 0, Number(sheet.column) || 0) - 1;
    const range = t ? { row: [t.r1, t.r2], column: [t.c1, t.c2] } : { row: [0, Math.max(0, rows)], column: [0, Math.max(0, cols)] };
    wb.setSelection([range], { id: a.sheetId });
  }
  function recalcNow() {
    const wb = ref.current;
    if (!wb) return;
    try {
      wb.calculateFormula?.();
    } catch {
      /* the server values below still arrive */
    }
    recalcSheet(id, liveJson())
      .then(applyServerValues)
      .catch(() => {});
  }
  function openLink() {
    const a = activeCell();
    if (!a) return;
    let address = "";
    try {
      const sh = (ref.current?.getAllSheets?.() ?? []).find((x: any) => String(x?.id) === a.sheetId);
      address = sh?.hyperlink?.[`${a.r}_${a.c}`]?.linkAddress ?? "";
    } catch {
      /* none */
    }
    const cell = cellAt(a.sheetId, a.r, a.c);
    setLinkFor({ ...a, text: cell?.m != null ? String(cell.m) : cell?.v != null ? String(cell.v) : "", address });
  }
  function applyLink(v: LinkValue) {
    const wb = ref.current;
    const t = linkFor;
    if (!wb || !t) return;
    const sh = (wb.getAllSheets?.() ?? []).find((x: any) => String(x?.id) === t.sheetId);
    const hyperlink = { ...(sh?.hyperlink ?? {}), [`${t.r}_${t.c}`]: { linkType: v.type, linkAddress: v.address } };
    patchSheet(wb, t.sheetId, { hyperlink });
    const old = cellAt(t.sheetId, t.r, t.c) ?? {};
    wb.setCellValue(t.r, t.c, { ...old, v: v.text, m: v.text, f: undefined, fc: "rgb(0, 0, 255)", un: 1, hl: { r: t.r, c: t.c, id: t.sheetId } }, { id: t.sheetId });
  }
  function removeLink() {
    const wb = ref.current;
    const t = linkFor;
    if (!wb || !t) return;
    const sh = (wb.getAllSheets?.() ?? []).find((x: any) => String(x?.id) === t.sheetId);
    const hyperlink = { ...(sh?.hyperlink ?? {}) };
    delete hyperlink[`${t.r}_${t.c}`];
    patchSheet(wb, t.sheetId, { hyperlink });
    const old = cellAt(t.sheetId, t.r, t.c);
    if (old) wb.setCellValue(t.r, t.c, { ...old, fc: undefined, un: undefined, hl: undefined }, { id: t.sheetId });
  }
  function openWizard() {
    const a = activeCell();
    if (!a) return;
    const f = cellAt(a.sheetId, a.r, a.c)?.f;
    setWizardFor({ ...a, formula: typeof f === "string" ? f : "" });
  }
  // The wizard's live result: the formula evaluated by the server engine in
  // the cell it will go into (so relative references mean what they will).
  async function evaluateInCell(formula: string): Promise<string> {
    const t = wizardFor;
    if (!t) return "";
    const all = JSON.parse(liveJson());
    const sh = all.find((x: any) => String(x?.id) === t.sheetId);
    if (!sh) return "";
    sh.celldata = (sh.celldata ?? []).filter((cd: any) => !(cd.r === t.r && cd.c === t.c));
    sh.celldata.push({ r: t.r, c: t.c, v: { f: formula } });
    const cells = await recalcSheet(id, JSON.stringify(all));
    const hit = cells.find((x) => x.sheetId === t.sheetId && x.r === t.r && x.c === t.c);
    if (!hit) return "";
    return String(hit.m ?? hit.v ?? "");
  }
  function insertFormula(formula: string) {
    const t = wizardFor;
    if (!t) return;
    ref.current?.setCellValue(t.r, t.c, formula, { id: t.sheetId });
  }
  async function runTrace(kind: "precedents" | "dependents" | "clear") {
    if (kind === "clear") {
      setTrace(null);
      return;
    }
    const a = activeCell();
    if (!a) return;
    const cur = traceRef.current;
    const same = cur && cur.sheetId === a.sheetId && cur.r === a.r && cur.c === a.c;
    const next: TraceState = {
      sheetId: a.sheetId,
      r: a.r,
      c: a.c,
      precedents: (same ? cur!.precedents : 0) + (kind === "precedents" ? 1 : 0),
      dependents: (same ? cur!.dependents : 0) + (kind === "dependents" ? 1 : 0),
      result: same ? cur!.result : null,
    };
    await refreshTrace(next);
  }
  async function refreshTrace(t: TraceState) {
    try {
      const res = await traceDeps(id, liveJson(), t.sheetId, a1(t.r, t.c), Math.max(1, t.precedents), Math.max(1, t.dependents));
      if (!t.precedents) res.precedents = [];
      if (!t.dependents) res.dependents = [];
      setTrace({ ...t, result: res });
    } catch {
      setTrace(t);
    }
  }
  function openGoalSeek() {
    const a = activeCell();
    setGoalSeekCell(a ? a1(a.r, a.c) : "");
  }
  function applyGoalSeek(res: GoalSeekResult) {
    const rect = parseA1Range(res.changingCell);
    if (!rect) return;
    ref.current?.setCellValue(rect.r1, rect.c1, res.value, { id: res.sheetId });
  }

  function runShortcut(action: string, editing: boolean) {
    const wb = ref.current;
    if (!wb) return;
    const fa = SHORTCUT_NUMBER_FORMATS[action];
    if (fa) {
      applyNumberFormat(wb, fa);
      return;
    }
    switch (action) {
      case "bold":
        return toggleAttr("bl");
      case "italic":
        return toggleAttr("it");
      case "underline":
        return toggleAttr("un");
      case "strikethrough":
        return toggleAttr("cl");
      case "superscript":
        return setScript(VA_SUPER);
      case "subscript":
        return setScript(VA_SUB);
      case "fontBigger":
        return stepFont(1);
      case "fontSmaller":
        return stepFont(-1);
      case "clearFormat":
        return clearFormatting();
      case "insertDate":
        return insertNow("date", editing);
      case "insertTime":
        return insertNow("time", editing);
      case "fillDown":
        return fillSelection(wb, "down");
      case "fillRight":
        return fillSelection(wb, "right");
      case "pasteValues":
        return pasteSpecialHere(wb, { what: "values" });
      case "find":
        return setFindOpen(true);
      case "autoSum":
        return autoSum();
      case "toggleRef":
        return toggleRefInEditor();
      case "showFormulas":
        return applyView({ showFormulas: !sheetViewOptions(currentSheet(wb)).showFormulas });
      case "recalcAll":
      case "recalcSheet":
        return recalcNow();
      case "insertFunction":
        return openWizard();
      case "nextSheet":
        return switchSheet(1);
      case "prevSheet":
        return switchSheet(-1);
      case "link":
        return openLink();
      case "comment":
        return commentsRef.current?.compose();
      case "newSheet":
        return wb.addSheet();
      case "refreshPivot":
        return pivotToolsRef.current?.changed();
      case "dropdown": {
        // A list-validated cell shows FortuneSheet's dropdown button.
        const btn = document.getElementById("luckysheet-dataVerification-dropdown-btn");
        if (btn && btn.style.display !== "none") btn.click();
        return;
      }
      case "clearActive": {
        // Backspace clears only the active cell (Delete clears the selection)
        // and leaves it in edit mode, as in Excel.
        const a = activeCell();
        if (!a) return;
        wb.clearCell(a.r, a.c, { id: a.sheetId });
        editActiveCell("", 0);
        return;
      }
      case "contextMenu": {
        // The grid's context menu at the active cell (Shift+F10 / the menu key).
        const a = activeCell();
        const area = editorEl?.querySelector<HTMLElement>(".fortune-cell-area");
        const sheet = currentSheet(wb);
        if (!a || !area || !sheet) return;
        const g = gridGeometry(sheet);
        const rect = area.getBoundingClientRect();
        const x = rect.left + g.colLeft(a.c) - area.scrollLeft + 10;
        const y = rect.top + g.rowTop(a.r) - area.scrollTop + 8;
        area.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
        return;
      }
      case "fillEntry":
        return fillEntry();
      case "arrayEntry":
        return arrayEntry();
      case "selectAll":
        return selectAllStep();
      case "saveUp":
      case "saveRight":
      case "saveLeft":
        return commitAndMove(action);
      case "print":
        return openPrint();
      case "shortcuts":
        return setShortcutsOpen(true);
    }
  }
  const shortcutActionRef = useRef(runShortcut);
  shortcutActionRef.current = runShortcut;

  function openPrint() {
    const sheet = currentSheet(ref.current);
    if (!sheet) return;
    const sel = selectionRect(ref.current);
    setPrintFor({ sheet: JSON.parse(JSON.stringify(sheet)), selection: sel });
  }

  function savePrint(ps: PrintSettings) {
    const sheet = currentSheet(ref.current);
    if (!sheet?.id) return;
    patchSheet(ref.current, sheet.id, { grownPrint: ps });
    invalidateView();
  }

  function pageBreak(action: "insert" | "remove" | "reset") {
    const wb = ref.current;
    const sheet = currentSheet(wb);
    const sel = selectionRect(wb);
    if (!sheet?.id) return;
    const ps = sheetPrintSettings(sheet);
    const r = sel?.r1 ?? 0;
    const c = sel?.c1 ?? 0;
    const next = action === "insert" ? insertPageBreak(ps, r, c) : action === "remove" ? removePageBreak(ps, r, c) : resetAllPageBreaks(ps);
    patchSheet(wb, sheet.id, { grownPrint: next });
    invalidateView();
    // Show where the pages now break.
    if (!sheetViewOptions(sheet).pageBreakPreview) applyView({ pageBreakPreview: true });
  }

  function saveProtection(model: ProtectionModel) {
    const sheet = currentSheet(ref.current);
    if (!sheet?.id) return;
    patchSheet(ref.current, sheet.id, { grownProtection: model });
  }

  // File ▸ Import: merge the file into this workbook (or a new spreadsheet).
  async function runImport(imp: ImportedWorkbook, mode: ImportMode, fileName: string) {
    if (mode === "newSpreadsheet") {
      const created = await createSheet(fileName.replace(/\.[^.]+$/, "") || "Imported spreadsheet");
      await saveSheet(created.id, JSON.stringify(applyImport([], imp, mode)));
      navigate(`/sheets/d/${created.id}`);
      return;
    }
    const wb = ref.current;
    const current = storableWorkbook(wb?.getAllSheets?.() ?? dataRef.current ?? []);
    const sel = selectionRect(wb);
    const active = currentSheet(wb);
    const next = applyImport(withExtras(current), imp, mode, { sheetId: active?.id, r: sel?.r1 ?? 0, c: sel?.c1 ?? 0 });
    const json = JSON.stringify(next);
    await saveSheet(id, json);
    window.clearTimeout(saveTimer.current);
    loadWorkbook(JSON.parse(json), true);
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
    // Charts ride on sheet 0 in the grid too (structure ops and collaborators
    // update them there); adopt a changed list, and redraw charts on the grid.
    const gridCharts = Array.isArray(d) ? d[0]?.grownCharts : undefined;
    if (Array.isArray(gridCharts) && JSON.stringify(gridCharts) !== JSON.stringify(chartsRef.current)) {
      chartsRef.current = gridCharts;
      setCharts(gridCharts);
    }
    chartsChanged();
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
    pivotToolsRef.current?.changed();
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
      // Trace arrows follow the edit (a removed reference drops its arrow).
      if (traceRef.current) void refreshTrace(traceRef.current);
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
    // Computed values are not user edits: applyOp keeps them out of the undo
    // history (setCellValue would record them, so Ctrl+Z would first undo a
    // spill instead of the user's own change).
    const ops = writes.map((w) => {
      const sheet = (wb.getAllSheets?.() ?? []).find((sh: any) => sh?.id === w.sheetId);
      const old = sheet?.data?.[w.r]?.[w.c] ?? null;
      let value: any = null;
      if (w.value) value = { ...(old ?? {}), ...w.value };
      else if (old) {
        // Keep the cell's formatting, drop the spilled value.
        const { v: _v, m: _m, grownSpill: _g, ...rest } = old;
        void _v;
        void _m;
        void _g;
        value = Object.keys(rest).length ? rest : null;
      }
      return { op: "replace", id: w.sheetId, path: ["data", w.r, w.c], value };
    });
    applyingRemote.current = true;
    try {
      wb.applyOp(ops);
    } catch {
      /* ignore */
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
  // Version history: flush the pending autosave before naming/restoring, and
  // reload after a restore (telling collaborators to do the same).
  async function flushSave() {
    window.clearTimeout(saveTimer.current);
    const d = dataRef.current;
    if (d) await saveSheet(id, JSON.stringify(withExtras(d)));
  }
  function afterVersionRestore() {
    window.clearTimeout(saveTimer.current);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(VERSION_RESTORED_MSG));
    window.location.reload();
  }
  function persistCharts(next: ChartConfig[]) {
    chartsRef.current = next;
    setCharts(next);
    // Kept on sheet 0 in the grid as well, so structure ops shift them and
    // collaborators receive them (patchSheet relays the op).
    try {
      const first = ref.current?.getAllSheets?.()?.[0];
      if (first?.id) patchSheet(ref.current, first.id, { grownCharts: next });
    } catch {
      /* the save below still carries them */
    }
    persistExtras();
  }
  function upsertChart(cfg: ChartConfig) {
    const cur = chartsRef.current;
    persistCharts(cur.some((c) => c.id === cfg.id) ? cur.map((c) => (c.id === cfg.id ? cfg : c)) : [...cur, cfg]);
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
    importFile: () => setImportOpen(true),
    print: () => openPrint(),
    versionHistory: () => setHistoryOpen(true),
    download: async (fmt) => {
      try {
        await downloadSheet(ref.current, title, fmt);
      } catch (e) {
        window.alert(`Download failed: ${(e as Error).message}`);
      }
    },
  };

  const pivotTools = usePivotTools({
    getWb: getWbRef.current,
    pivotsRef,
    pivots,
    setPivots,
    persist: persistExtras,
    dialogOpen: pivotOpen,
    setDialogOpen: setPivotOpen,
    panelOpen: pivotsOpen,
    setPanelOpen: setPivotsOpen,
  });
  pivotToolsRef.current = pivotTools;

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
              onInsertChart={() => {
                setChartEdit(null);
                setChartOpen(true);
              }}
              onInsertSparklines={() => setSparkOpen(true)}
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
              view={view}
              onView={applyView}
              onPageBreak={pageBreak}
              onProtect={() => {
                const sheet = currentSheet(ref.current);
                if (sheet) setProtectFor({ sheet: JSON.parse(JSON.stringify(sheet)), selection: selectionRect(ref.current) });
              }}
              onCustomNumberFormat={() => {
                setNumFmtRanges(selectionRanges(ref.current));
                setNumFmtOpen(true);
              }}
              onInsertFunction={openWizard}
              onInsertLink={openLink}
              onInsertComment={() => commentsRef.current?.compose()}
              onShowComments={() => setCommentsPanel((o) => !o)}
              onGoalSeek={openGoalSeek}
              onTrace={(k) => void runTrace(k)}
              onShortcuts={() => setShortcutsOpen(true)}
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
      <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Box
          sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}
          data-testid="sheet-editor"
          ref={setEditorEl}
        >
          <Box sx={{ minWidth: { xs: 600, md: "100%" }, height: "100%" }}>
            <Workbook
              key={wbKey}
              ref={ref}
              data={data}
              onChange={stableOnChange}
              onOp={stableOnOp}
              hooks={hooks.current}
              generateSheetId={generateSheetId}
            />
          </Box>
        </Box>
        <CellCommentsLayer
          ref={commentsRef}
          getWb={getWbRef.current}
          container={editorEl}
          author={{ id: user.id, name: user.display_name || user.email }}
          panelOpen={commentsPanel}
          onPanelClose={() => setCommentsPanel(false)}
        />
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
      <SheetVersionHistory
        open={historyOpen}
        docId={id}
        onClose={() => setHistoryOpen(false)}
        prepare={flushSave}
        onRestored={afterVersionRestore}
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
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} userId={user.id} onImport={runImport} />
      {printFor && (
        <PrintDialog
          open
          onClose={() => setPrintFor(null)}
          sheet={printFor.sheet}
          selection={printFor.selection}
          title={title}
          showFormulas={view.showFormulas}
          onSave={savePrint}
        />
      )}
      {protectFor && (
        <ProtectDialog
          open
          onClose={() => setProtectFor(null)}
          sheet={protectFor.sheet}
          selection={protectFor.selection}
          ctx={{ user: user.id, owner: ownerId || undefined }}
          onSave={saveProtection}
        />
      )}
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
      <ChartDialog open={chartOpen} onClose={() => setChartOpen(false)} getWb={getWbRef.current} initial={chartEdit} onSave={upsertChart} />
      <ChartsPanel
        open={chartsOpen}
        onClose={() => setChartsOpen(false)}
        getWb={() => ref.current}
        charts={charts}
        onDelete={(cid) => persistCharts(chartsRef.current.filter((c) => c.id !== cid))}
        onNew={() => {
          setChartsOpen(false);
          setChartEdit(null);
          setChartOpen(true);
        }}
        onEdit={(cfg) => {
          setChartsOpen(false);
          setChartEdit(cfg);
          setChartOpen(true);
        }}
        onChange={upsertChart}
      />
      {pivotTools.element}
      <ChartOverlay
        getWb={getWbRef.current}
        charts={charts}
        container={editorEl}
        onChange={upsertChart}
        onEdit={(cfg) => {
          setChartEdit(cfg);
          setChartOpen(true);
        }}
        onDelete={(cid) => persistCharts(chartsRef.current.filter((c) => c.id !== cid))}
      />
      <SparklineDialog open={sparkOpen} onClose={() => setSparkOpen(false)} getWb={getWbRef.current} />
      <TraceOverlay getWb={getWbRef.current} container={editorEl} trace={trace} />
      <SheetShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <FunctionWizard
        open={wizardFor !== null}
        onClose={() => setWizardFor(null)}
        initialFormula={wizardFor?.formula}
        evaluate={evaluateInCell}
        onInsert={insertFormula}
      />
      <GoalSeekDialog
        open={goalSeekCell !== null}
        onClose={() => setGoalSeekCell(null)}
        initialCell={goalSeekCell ?? ""}
        run={(req) => goalSeek(id, { data: liveJson(), sheet: String(ref.current?.getSheet?.()?.id ?? ""), ...req })}
        apply={applyGoalSeek}
      />
      <LinkDialog
        open={linkFor !== null}
        onClose={() => setLinkFor(null)}
        initialText={linkFor?.text ?? ""}
        initialAddress={linkFor?.address ?? ""}
        onApply={applyLink}
        onRemove={removeLink}
      />
    </Box>
  );
}
