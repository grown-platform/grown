import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  ToggleButtonGroup,
  Typography,
  MenuList,
  MenuItem,
  ListDivider,
  Textarea,
  Dropdown,
  Menu,
  MenuButton,
  Snackbar,
} from "@mui/joy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import ImageIcon from "@mui/icons-material/Image";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import HorizontalRuleIcon from "@mui/icons-material/HorizontalRule";
import InterestsIcon from "@mui/icons-material/Interests";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import SpeakerNotesIcon from "@mui/icons-material/SpeakerNotes";
import SpeakerNotesOffIcon from "@mui/icons-material/SpeakerNotesOff";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  getDeck,
  renameDeck,
  createDeck,
  trashDeck,
  saveDeck,
  collabURL,
  deckImageSrc,
  imageNaturalSize,
  uploadDeckAsset,
} from "./api";
import { externalizeImages } from "./assets";
import { AltTextDialog, ImageControls, type ImageCommands } from "./ImageControls";
import {
  actualSize as imgActualSize,
  cropToFill,
  cropToFit,
  fitToSlide as imgFitToSlide,
  insertBox,
  replaceImage,
  resetCrop as imgResetCrop,
  setAlt,
  setCropShape,
  setOpacity as imgSetOpacity,
} from "./imageOps";
import {
  setCanvasSize,
  parseDeck,
  newElement,
  isShape,
  type DeckDoc,
  type DeckHF,
  type Slide,
  type SlideElement,
  type ElementType,
  type RunStyle,
  type TextAlign,
} from "./model";
import { SlideView } from "./SlideView";
import { SlideShow } from "./SlideShow";
import { MotionPanel } from "./MotionPanel";
import { effectsOf, removeEffects } from "./animOps";
import { applyTheme, reconcileRefs, setActiveTheme, themeOf, withColorRef } from "./theme";
import {
  applyLayout as applyLayoutOp,
  findLayout,
  footerElements,
  hfFlags,
  layoutsOf,
  nextLayoutFor,
  newLayoutDeck,
  nextPlaceholder,
  resetSlide as resetSlideOp,
  slideFromLayout,
  withFooters,
} from "./layouts";
import { backgroundToAll, deckSize, resizeDeck, setSlideBackground, showSlides, toggleHidden, type BackgroundPatch } from "./slideProps";
import { BackgroundDialog, HeaderFooterDialog, LayoutGrid, PageSetupDialog, ThemeDialog, ThemePalette } from "./DesignDialogs";
import { SlideCanvas } from "./SlideCanvas";
import { SlideMenuBar, type SlideActions } from "./SlideMenuBar";
import { downloadDeck } from "./export";
import { ShareDialog } from "./ShareDialog";
import { DeckVersionHistory } from "../../components/versions/DeckVersionPreview";
import { VERSION_RESTORED_MSG, isVersionRestoredMsg } from "../../components/versions/api";
import { PPTX_ACCEPT, readPptxSlides, slidesForDeck } from "./pptx/importDeck";
import {
  addNextSlide,
  insertSlideAfter,
  alignElements,
  applyCollabOp,
  arrangeMany,
  centerOnPage,
  cycleSelection,
  distributeElements,
  duplicateElements,
  moveElementsBy,
  removeElements as removeElementsOp,
  setLocked,
  upsertElements as upsertElementsOp,
  type AlignHow,
  type AlignTo,
  deleteSlideAt,
  duplicateSlideAt,
  mapSlide,
  moveSlide as moveSlideOp,
  patchSlide,
  rotateElement,
  setLink as setLinkOp,
  setList as setListOp,
  upsertElement as upsertElementOp,
  type ArrangeDir,
  type RotateOp,
  type SlidesResult,
  type StyleToggle,
} from "./deckOps";
import {
  emptyHistory,
  recordHistory,
  redoHistory,
  undoHistory,
  type History,
} from "./history";
import {
  editorKeyAction,
  isSaveKey,
  textKeyAction,
  type TextKeyAction,
  type TextToggle,
} from "./keymap";
import { GRID_SIZE, fitCanvasWidth } from "./geometry";
import {
  primaryId,
  selectAll,
  selectedElement,
  selectedElements,
} from "./selection";
import { groupElements, ungroupMany } from "./groupOps";
import {
  CLIP_MIME,
  clipboardText,
  decodeClipboard,
  encodeClipboard,
  pasteElements,
} from "./clipboard";
import { colorFor, prunePeers } from "./presence";
import { ShapeGallery } from "./ShapeGallery";
import { toolFromGalleryId, type DrawTool } from "./drawTool";
import { withGluedConnectors } from "./connectorOps";
import { ShapeFormatControls } from "./ShapeFormatControls";
import { SplitCellDialog, TableControls, TableSizePicker, type TableCommands } from "./TableControls";
import {
  allCells,
  canSplit,
  cellTextEl,
  clearCells,
  deleteCols,
  deleteRows,
  distributeCols,
  distributeRows,
  insertCols,
  insertRows,
  mapCellTexts,
  mergeCells,
  newTableElement,
  parseCellId,
  rangeAnchors,
  selRange,
  setBorders as setCellBorders,
  setCellFill,
  setCellText,
  setLook as setTableLook,
  setTableStyle,
  spanOf,
  splitCell,
  tableKey,
  type CellRange,
  type CellSel,
} from "./tableOps";
import { TextFormatControls, type TextCommands } from "./TextFormatControls";
import {
  FindReplacePanel,
  HyperlinkDialog,
  SpecialCharsDialog,
  TextOptionsDialog,
  type LinkDialogInit,
  type TextOptions,
} from "./TextDialogs";
import type { EditResult, TextEditorHandle } from "./TextEditor";
import {
  applyFormat,
  applyFormatWhole,
  captureFormat,
  changeCaseRange,
  clearFormatRange,
  formatRange,
  formatWhole,
  indentParas,
  insertText,
  linkAt,
  linkRangeAt,
  paraCount,
  paraIndices,
  rangeHas,
  replaceRange,
  setAlignWhole,
  setInsets,
  setLinkRange,
  setListStyle,
  setParaAlign,
  stepFontRange,
  toggleRange,
  wordAt,
} from "./textOps";
import { linkLabel, parseSlideLink, resolveSlideLink } from "./links";
import { replaceAll, replaceMatch, type FindOptions, type Match } from "./findReplace";
import type { CaseMode } from "../../lib/textCase";

interface Peer {
  userId: string;
  username: string;
  color: string;
  slideIdx: number;
  ts: number;
}

export function DeckEditor({ user }: { user: User }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState("Untitled presentation");
  const [doc, setDoc] = useState<DeckDoc | null>(null);
  const [cur, setCur] = useState(0);
  // Selected top-level element ids on the current slide (last = primary).
  const [sel, setSel] = useState<string[]>([]);
  const setSelId = (id: string | null) => setSel(id ? [id] : []);
  // Arrange → Align relative to the slide (else to the selection).
  const [alignTo, setAlignTo] = useState<AlignTo>("selection");
  // View → Snap to: smart guides (default on) and the grid.
  const [snapGuides, setSnapGuides] = useState(true);
  const [snapGrid, setSnapGrid] = useState(false);
  const [present, setPresent] = useState(false);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [canvasW, setCanvasW] = useState(720);
  const [editingText, setEditingText] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    elId: string | null;
  } | null>(null);
  const [showNotes, setShowNotes] = useState(true);
  const [mobileSlidesOpen, setMobileSlidesOpen] = useState(false);
  const [motionOpen, setMotionOpen] = useState(false);
  const [selEffect, setSelEffect] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [presenterWin, setPresenterWin] = useState(false); // open the presenter window with the show
  const clip = useRef<SlideElement[] | null>(null);
  // Set by Ctrl+C / Ctrl+V keydowns so the copy/paste events that follow
  // know the keyboard asked for the in-app element clipboard.
  const copyPending = useRef(false);
  const pastePending = useRef(false);

  const wsRef = useRef<WebSocket | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const docRef = useRef<DeckDoc | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hist = useRef<History>(emptyHistory());
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pptxInput = useRef<HTMLInputElement | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  // Shape gallery (toolbar dropdown) and the armed draw-to-insert tool.
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawTool | null>(null);
  // ---- text (M4) ----
  // The live text editor while a box is being edited.
  const textEditor = useRef<TextEditorHandle | null>(null);
  // The text selection a box had when editing ended (a menu, dialog or
  // colour picker took focus): formatting then applies to it.
  const savedTextSel = useRef<{ id: string; from: number; to: number } | null>(null);
  const [editRequest, setEditRequestState] = useState<{ id: string; sel: [number, number]; nonce: number } | null>(null);
  // Resume editing a text box (after a dialog/menu): it is also selected.
  const setEditRequest = (r: { id: string; sel: [number, number]; nonce: number }) => {
    const cell = parseCellId(r.id);
    setSel([cell && docRef.current?.slides.some((s) => s.elements.some((e) => e.id === cell.tableId)) ? cell.tableId : r.id]);
    setEditRequestState(r);
  };
  const [painter, setPainter] = useState<RunStyle | null>(null);
  const [painterArmed, setPainterArmed] = useState(false);
  type LinkTarget = { kind: "range"; id: string; from: number; to: number } | { kind: "elements"; ids: string[] };
  const [linkDlg, setLinkDlg] = useState<{ init: LinkDialogInit; target: LinkTarget } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findHit, setFindHit] = useState<Match | null>(null);
  const [charsOpen, setCharsOpen] = useState(false);
  const charsTarget = useRef<{ id: string; from: number; to: number } | null>(null);
  const [textOptsOpen, setTextOptsOpen] = useState(false);
  // ---- tables (M5) ----
  // Cell selection inside the selected table (anchor + focus cell).
  const [tableSel, setTableSel] = useState<{ id: string; sel: CellSel } | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  // ---- pictures (M6) ----
  // The picture in crop mode (its handles crop; a drag pans it).
  const [cropId, setCropId] = useState<string | null>(null);
  const [altFor, setAltFor] = useState<string[] | null>(null);
  // ---- design (M7) ----
  const [themeDlg, setThemeDlg] = useState<"gallery" | "edit" | null>(null);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [hfOpen, setHfOpen] = useState(false);
  const [layoutMenu, setLayoutMenu] = useState<"new" | "apply" | null>(null);
  const [fillMenuOpen, setFillMenuOpen] = useState(false);
  // Slideshow position in the list of visible (not skipped) slides.
  const [showIdx, setShowIdx] = useState(0);
  const bgImageInput = useRef<HTMLInputElement | null>(null);
  const bgImageResolve = useRef<((src: string | null) => void) | null>(null);
  const replaceInput = useRef<HTMLInputElement | null>(null);

  const me = {
    userId: user.id,
    username: user.display_name || user.email,
    color: colorFor(user.id),
  };

  docRef.current = doc;
  // The open deck's slide size and theme drive the canvas height and the
  // table style colours (live module state, see model.setCanvasSize).
  setCanvasSize(doc?.size);
  setActiveTheme(doc?.theme);
  useEffect(
    () => () => {
      setCanvasSize(undefined);
      setActiveTheme(undefined);
    },
    [],
  );
  const slides = doc?.slides ?? [];
  const slide: Slide | undefined = slides[cur];
  // Stale ids (an element removed by undo or a peer) are kept in `sel` so the
  // selection comes back on redo, but every operation uses the live ones.
  const selectedEls: SlideElement[] = selectedElements(slide, sel);
  const live = new Set(selectedEls.map((e) => e.id));
  const selIds = sel.filter((i) => live.has(i)); // click order, last = primary
  const selId = primaryId(selIds);
  const selected: SlideElement | undefined = selectedElement(slide, selId);

  // The cell selection belongs to the selected table.
  const selTable = selected?.type === "table" && selected.table && selIds.length === 1 ? selected : undefined;
  const activeSel = selTable && tableSel?.id === selTable.id ? tableSel.sel : null;
  useEffect(() => {
    if (tableSel && tableSel.id !== selId) setTableSel(null);
    if (cropId && cropId !== selId) setCropId(null);
  }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The cell range table commands act on (the whole table when none). */
  function tableRange(el: SlideElement): CellRange {
    const s = tableSel?.id === el.id ? tableSel.sel : null;
    return s ? selRange(el.table!, s) : allCells(el.table!);
  }

  // A saved text selection belongs to the slide it was made on.
  useEffect(() => {
    savedTextSel.current = null;
  }, [cur]);

  // Load deck.
  useEffect(() => {
    let cancelled = false;
    getDeck(id)
      .then((d) => {
        if (cancelled) return;
        setTitle(d.title);
        // A deck that was never saved starts from the title layout (M7).
        setDoc(d.data ? parseDeck(d.data) : newLayoutDeck());
      })
      .catch(() => !cancelled && setDoc(parseDeck()));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Measure the stage so the canvas scales to fit.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCanvasW(fitCanvasWidth(el.clientWidth, el.clientHeight));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  const broadcast = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (docRef.current)
        saveDeck(id, JSON.stringify(docRef.current)).catch(() => {});
    }, 1200);
  }, [id]);

  // saveNow flushes the pending autosave immediately (Ctrl/Cmd+S).
  const saveNow = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    if (docRef.current)
      saveDeck(id, JSON.stringify(docRef.current)).catch(() => {});
  }, [id]);

  const pushHistory = useCallback(() => {
    hist.current = recordHistory(hist.current, docRef.current, Date.now());
  }, []);

  // ---- local mutations (update state + broadcast op + autosave) ----
  const applyToSlide = useCallback(
    (slideId: string, fn: (s: Slide) => Slide) => {
      setDoc((d) => (d ? mapSlide(d, slideId, fn) : d));
    },
    [],
  );

  const upsertElement = useCallback(
    (el: SlideElement, opts?: { history?: boolean }) => {
      if (!slide) return;
      if (opts?.history !== false) pushHistory();
      // Connectors glued to this element move with it.
      el = reconcileRefs(slide.elements.find((e) => e.id === el.id), el);
      const all = withGluedConnectors(slide.elements, [el]);
      if (all.length > 1) {
        applyToSlide(slide.id, (s) => upsertElementsOp(s, all));
        broadcast({ t: "upsertMany", si: slide.id, els: all });
      } else {
        applyToSlide(slide.id, (s) => upsertElementOp(s, all[0]));
        broadcast({ t: "upsert", si: slide.id, el: all[0] });
      }
      scheduleSave();
    },
    [slide, applyToSlide, broadcast, scheduleSave, pushHistory],
  );

  // Selection-wide edits: one history entry and one collab op per operation.
  const upsertMany = useCallback(
    (els: SlideElement[], opts?: { history?: boolean }) => {
      if (!slide || !els.length) return;
      if (opts?.history !== false) pushHistory();
      els = els.map((e) => reconcileRefs(slide.elements.find((x) => x.id === e.id), e));
      const all = withGluedConnectors(slide.elements, els);
      applyToSlide(slide.id, (s) => upsertElementsOp(s, all));
      broadcast({ t: "upsertMany", si: slide.id, els: all });
      scheduleSave();
    },
    [slide, applyToSlide, broadcast, scheduleSave, pushHistory],
  );

  const removeMany = useCallback(
    (ids: string[]) => {
      if (!slide || !ids.length) return;
      pushHistory();
      applyToSlide(slide.id, (s) => removeElementsOp(s, ids));
      broadcast({ t: "removeMany", si: slide.id, ids });
      scheduleSave();
      setSel((c) => c.filter((x) => !ids.includes(x)));
    },
    [slide, applyToSlide, broadcast, scheduleSave, pushHistory],
  );

  // Replace the current slide's element list (group/ungroup).
  const setElements = useCallback(
    (elements: SlideElement[]) => {
      if (!slide) return;
      pushHistory();
      applyToSlide(slide.id, (s) => ({ ...s, elements }));
      broadcast({ t: "setElements", si: slide.id, elements });
      scheduleSave();
    },
    [slide, applyToSlide, broadcast, scheduleSave, pushHistory],
  );

  const setSlides = useCallback(
    (next: Slide[], opts?: { history?: boolean }) => {
      if (opts?.history !== false) pushHistory();
      setDoc((d) => ({ ...(d ?? {}), slides: next }));
      broadcast({ t: "slides", slides: next });
      scheduleSave();
    },
    [broadcast, scheduleSave, pushHistory],
  );

  // Replace the whole deck (theme, layouts, size, header & footer): M7.
  const setDeck = useCallback(
    (next: DeckDoc) => {
      pushHistory();
      setDoc(next);
      broadcast({ t: "deck", deck: next });
      scheduleSave();
    },
    [broadcast, scheduleSave, pushHistory],
  );

  // ---- WebSocket: ops + presence ----
  useEffect(() => {
    const ws = new WebSocket(collabURL(id));
    wsRef.current = ws;
    ws.onopen = () => setStatus("live");
    ws.onclose = () => setStatus("offline");
    ws.onerror = () => setStatus("offline");
    ws.onmessage = (ev) => {
      let m: {
        t: string;
        si?: string;
        el?: SlideElement;
        elId?: string;
        els?: SlideElement[];
        ids?: string[];
        elements?: SlideElement[];
        slides?: Slide[];
        deck?: DeckDoc;
        p?: Peer;
      };
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (isVersionRestoredMsg(m)) {
        // A collaborator restored a version: reload so this tab's stale deck
        // can't autosave over it.
        window.clearTimeout(saveTimer.current);
        window.location.reload();
        return;
      }
      if (m.t === "slides" && m.slides) {
        const next = m.slides;
        setDoc((d) => ({ ...(d ?? {}), slides: next }));
      } else if (m.t !== "presence" && m.t !== "slides") {
        setDoc((d) => (d ? applyCollabOp(d, m) : d));
      } else if (m.t === "presence" && m.p) {
        const p = m.p;
        setPeers((cur) => ({ ...cur, [p.userId]: { ...p, ts: Date.now() } }));
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [id]);

  // Presence heartbeat + prune.
  useEffect(() => {
    const send = () =>
      broadcast({ t: "presence", p: { ...me, slideIdx: cur } });
    send();
    const hb = window.setInterval(send, 4000);
    const prune = window.setInterval(() => {
      setPeers((cur) => prunePeers(cur, Date.now()));
    }, 2000);
    return () => {
      window.clearInterval(hb);
      window.clearInterval(prune);
    };
  }, [broadcast, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The slideshow handles its own keys (SlideShow).
      if (present) return;
      // F5 / Ctrl+Shift+F5: slideshow from the beginning; Shift+F5 /
      // Ctrl+F5: from the current slide (PowerPoint / Google Slides).
      if (e.key === "F5" && !e.altKey) {
        e.preventDefault();
        const mod = e.ctrlKey || e.metaKey;
        startPresent(mod ? (e.shiftKey ? "start" : "current") : e.shiftKey ? "current" : "start");
        return;
      }
      // Ctrl/Cmd+S saves now, even while a text box is being edited, and
      // never opens the browser's "Save page" dialog.
      if (isSaveKey(e)) {
        e.preventDefault();
        saveNow();
        return;
      }
      // Ctrl/Cmd+H opens find and replace (also from inside a text box).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (painterArmed && e.key === "Escape") {
        setPainterArmed(false);
        return;
      }
      if (drawTool && e.key === "Escape") {
        // Esc cancels an armed draw-to-insert tool (before anything else).
        const a = editorKeyAction(e, { hasSelection: selIds.length > 0, drawing: true });
        if (a?.type === "cancelDraw") {
          e.preventDefault();
          setDrawTool(null);
          return;
        }
      }
      if (cropId && (e.key === "Escape" || e.key === "Enter") && !editingText) {
        e.preventDefault();
        setCropId(null);
        return;
      }
      // Ctrl/Cmd+Enter: next placeholder (also from inside a text box).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === "Enter" && !cropId) {
        const t = e.target as HTMLElement | null;
        if (editingText || !(t?.tagName === "INPUT" || t?.tagName === "TEXTAREA")) {
          e.preventDefault();
          gotoNextPlaceholder();
          return;
        }
      }
      if (editingText) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return;
      // A selected table: arrows/Tab/Enter/Delete act on its cells.
      if (handleTableKey(e)) {
        e.preventDefault();
        return;
      }
      // Text formatting shortcuts on the selected text boxes.
      const ta = textKeyAction(e, { editing: false, hasFormat: !!painter });
      if (ta && handleTextKey(ta)) {
        e.preventDefault();
        return;
      }
      const act = editorKeyAction(e, { hasSelection: selIds.length > 0 });
      if (!act) return;
      if (act.type === "deleteSelected" && motionOpen && selEffect && slide && effectsOf(slide).some((x) => x.id === selEffect)) {
        // With an effect selected in the animation pane, Delete removes the
        // effect, not the shape (OnlyOffice shortcut #10).
        e.preventDefault();
        setSlides(slides.map((x) => (x.id === slide.id ? removeEffects(x, [selEffect]) : x)));
        setSelEffect(null);
      } else if (act.type === "deleteSelected" && selIds.length) {
        e.preventDefault();
        removeMany(selIds);
      } else if (act.type === "newSlide") {
        e.preventDefault();
        doNewSlide();
      } else if (act.type === "nudge" && slide && selIds.length) {
        e.preventDefault();
        upsertMany(moveElementsBy(slide.elements, selIds, act.dx, act.dy));
      } else if (act.type === "undo") {
        e.preventDefault();
        undo();
      } else if (act.type === "redo") {
        e.preventDefault();
        redo();
      } else if (act.type === "duplicateElement" && selectedEls.length) {
        e.preventDefault();
        duplicateEls(selectedEls);
      } else if (act.type === "duplicateSlide") {
        e.preventDefault();
        duplicateSlide();
      } else if ((act.type === "copy" || act.type === "cut") && selectedEls.length) {
        // Leave the default alone: the copy event below puts the elements
        // on the OS clipboard (text + internal JSON), replacing anything
        // stale (e.g. an old image) that would otherwise win the next paste.
        clip.current = selectedEls.map((x) => ({ ...x }));
        copyPending.current = true;
        // Cut: the cut event that follows writes the clipboard from clip.
        if (act.type === "cut") removeMany(selIds);
      } else if (act.type === "paste" && clip.current) {
        // The paste event decides: an image on the OS clipboard is pasted
        // as a picture, otherwise the in-app elements. Browsers that fire no
        // paste event on a non-editable target fall back to the elements.
        pastePending.current = true;
        window.setTimeout(() => {
          if (!pastePending.current) return;
          pastePending.current = false;
          pasteEl();
        }, 0);
      } else if (act.type === "selectAll") {
        e.preventDefault();
        setSel(selectAll(slide));
      } else if (act.type === "cycle") {
        // Only when nothing focusable has focus, so Tab still moves between
        // toolbar controls.
        if (e.target !== document.body || !slide?.elements.length) return;
        e.preventDefault();
        const next = cycleSelection(slide.elements, selIds, act.dir);
        if (next) setSel([next]);
      } else if (act.type === "deselect") {
        setSel([]);
      } else if (act.type === "group") {
        e.preventDefault();
        doGroup();
      } else if (act.type === "ungroup") {
        e.preventDefault();
        doUngroup();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // re-bind each render to capture latest closures

  // Paste an image from the clipboard as a real image element (Google Slides
  // behaviour). Without this, pasting into a text box only kept innerText and
  // the picture was dropped on save.
  useEffect(() => {
    if (present) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      for (const it of items ?? []) {
        if (it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) {
            pastePending.current = false;
            e.preventDefault();
            void insertPicture(file);
          }
          return;
        }
      }
      const t = e.target as HTMLElement | null;
      const inField =
        editingText ||
        t?.tagName === "INPUT" ||
        t?.tagName === "TEXTAREA" ||
        !!t?.isContentEditable;
      if (inField) return;
      const data = e.clipboardData;
      const internal = data?.getData(CLIP_MIME);
      const text = data?.getData("text/plain") ?? "";
      // Elements copied in Grown (this tab or another).
      if (decodeClipboard(internal)) {
        pastePending.current = false;
        e.preventDefault();
        insertEls(pasteElements({ internal }));
        return;
      }
      // The in-app clipboard, if the OS clipboard still holds what we copied.
      if (
        pastePending.current &&
        clip.current &&
        (!text || text === clipboardText(clip.current))
      ) {
        pastePending.current = false;
        e.preventDefault();
        pasteEl();
        return;
      }
      // Text or HTML from elsewhere becomes a new text box.
      const els = pasteElements({ html: data?.getData("text/html"), text });
      if (els.length) {
        pastePending.current = false;
        e.preventDefault();
        insertEls(els);
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      if (!copyPending.current) return;
      copyPending.current = false;
      if (!e.clipboardData || !clip.current) return;
      e.clipboardData.setData("text/plain", clipboardText(clip.current));
      e.clipboardData.setData(CLIP_MIME, encodeClipboard(clip.current));
      e.preventDefault();
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCopy);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCopy);
    };
  }); // re-bind each render so upsertElement closes over the current slide

  // ---- slide ops ----
  function applySlidesResult(r: SlidesResult | null, clearSel = true) {
    if (!r) return;
    setSlides(r.slides);
    setCur(r.cur);
    if (clearSel) setSelId(null);
  }
  // New slide (Ctrl+M): the current slide's layout (title → title and
  // content), or a picked one.
  function doNewSlide(layoutId?: string) {
    if (!doc) return;
    const layout = layoutId ? findLayout(doc, layoutId) : nextLayoutFor(doc, cur);
    if (!layout) {
      applySlidesResult(addNextSlide(slides, cur));
      return;
    }
    applySlidesResult(insertSlideAfter(slides, cur, slideFromLayout(layout)));
  }
  // Ctrl+Enter: select the next placeholder; after the last one, add a
  // slide and select its first placeholder (OnlyOffice/PowerPoint).
  function gotoNextPlaceholder() {
    if (!slide || !doc) return;
    const h = textEditor.current;
    const curId = h && editingText ? h.current().id : (selIds[selIds.length - 1] ?? null);
    if (editingText) (document.activeElement as HTMLElement | null)?.blur();
    const next = nextPlaceholder(slide, curId);
    if (next) {
      setSel([next]);
      return;
    }
    const layout = nextLayoutFor(doc, cur);
    if (!layout) return;
    const ns = slideFromLayout(layout);
    const r = insertSlideAfter(slides, cur, ns);
    setSlides(r.slides);
    setCur(r.cur);
    const first = nextPlaceholder(ns, null);
    setSel(first ? [first] : []);
  }
  function applyLayoutToSlide(id: string) {
    const l = findLayout(doc, id);
    if (!slide || !l) return;
    setSlides(slides.map((x) => (x.id === slide.id ? applyLayoutOp(x, l) : x)));
  }
  function resetCurrentSlide() {
    if (!slide) return;
    const l = findLayout(doc, slide.layout);
    if (!l) return;
    setSlides(slides.map((x) => (x.id === slide.id ? resetSlideOp(x, l) : x)));
  }
  function startPresent(from: "start" | "current" = "current", presenterWindow = false) {
    if (doc) setShowIdx(from === "start" ? 0 : showSlides(doc, cur).start);
    setPresenterWin(presenterWindow);
    setPresent(true);
  }
  function toggleLoop() {
    if (doc) setDeck({ ...doc, show: { ...doc.show, loop: !doc.show?.loop } });
  }
  function toggleSkip() {
    if (!slide) return;
    setSlides(toggleHidden(slides, [slide.id]));
  }
  function applyBackground(p: BackgroundPatch, all: boolean) {
    if (!slide) return;
    const one = setSlideBackground(slide, p);
    setSlides(all ? backgroundToAll(slides, one) : slides.map((x) => (x.id === slide.id ? one : x)));
    setBgOpen(false);
  }
  function pickBackgroundImage(): Promise<string | null> {
    return new Promise((resolve) => {
      bgImageResolve.current = resolve;
      bgImageInput.current?.click();
    });
  }
  async function onBgImagePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    const done = bgImageResolve.current;
    bgImageResolve.current = null;
    if (!f) return done?.(null);
    try {
      done?.(await deckImageSrc(id, f));
    } catch {
      done?.(null);
    }
  }
  function applyHeaderFooter(next: DeckHF, all: boolean) {
    if (!doc || !slide) return;
    const flags = { dt: !!next.dt, ftr: !!next.ftr, sldNum: !!next.sldNum };
    if (all) {
      const hf: DeckHF = { ...next, ...flags };
      setDeck({
        ...doc,
        hf,
        slides: doc.slides.map((x) => {
          if (!x.hf) return x;
          const o = { ...x };
          delete o.hf;
          return o;
        }),
      });
    } else {
      const hf: DeckHF = { ...next, dt: doc.hf?.dt, ftr: doc.hf?.ftr, sldNum: doc.hf?.sldNum };
      setDeck({ ...doc, hf, slides: doc.slides.map((x) => (x.id === slide.id ? { ...x, hf: flags } : x)) });
    }
    setHfOpen(false);
  }
  function duplicateSlide() {
    applySlidesResult(duplicateSlideAt(slides, cur));
  }
  function deleteSlide() {
    // Deleting the last remaining slide keeps the selection (legacy behaviour).
    applySlidesResult(deleteSlideAt(slides, cur), slides.length > 1);
  }
  function moveSlide(from: number, to: number) {
    applySlidesResult(moveSlideOp(slides, from, to), false);
  }

  // ---- insert / format / arrange ----
  function insert(type: ElementType) {
    const el = newElement(type);
    upsertElement(el);
    setSelId(el.id);
  }
  // Shape gallery pick: arm the draw tool; the next click/drag on the slide
  // inserts the shape (Esc cancels).
  function pickShape(id: string) {
    setGalleryOpen(false);
    setDrawTool(toolFromGalleryId(id));
  }
  function onDrawn(el: SlideElement) {
    setDrawTool(null);
    upsertMany([el]);
    setSel([el.id]);
  }
  function insertImageFile() {
    fileInput.current?.click();
  }
  function onImagePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void insertPicture(f);
  }
  /** Insert a picture: uploaded to the deck's asset store (data: URL when
   *  that isn't available), sized to its own proportions. */
  async function insertPicture(file: Blob) {
    const src = await deckImageSrc(id, file);
    const nat = await imageNaturalSize(src);
    const el: SlideElement = { ...newElement("image", src), ...insertBox(nat) };
    upsertElement(el);
    setSelId(el.id);
  }
  async function onReplacePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    const target = selected;
    if (!f || !target || target.type !== "image") return;
    const src = await deckImageSrc(id, f);
    const nat = await imageNaturalSize(src);
    upsertElement(replaceImage(target, src, nat));
  }
  /** Apply an op needing the picture's natural size to the selected picture. */
  async function withNatural(fn: (el: SlideElement, nat: { w: number; h: number }) => SlideElement) {
    const el = selected;
    if (!el || el.type !== "image" || !el.src) return;
    const nat = await imageNaturalSize(el.src);
    if (!nat) return;
    const latest = docRef.current?.slides.find((sl) => sl.id === slide?.id)?.elements.find((x) => x.id === el.id) ?? el;
    upsertElement(fn(latest, nat));
  }
  const imageCmd: ImageCommands | null =
    selected?.type === "image" && selIds.length === 1
      ? {
          cropping: cropId === selected.id,
          toggleCrop: () => {
            if (cropId === selected.id) return setCropId(null);
            // A letterboxed (legacy) picture first takes its own proportions.
            if (!selected.crop && !selected.cropShape) void withNatural((el, nat) => cropToFit(el, nat));
            setCropId(selected.id);
          },
          cropToShape: (p) => {
            if (!selected.crop && p) void withNatural((el, nat) => setCropShape(cropToFill(el, nat), p));
            else upsertElement(setCropShape(selected, p));
          },
          cropFill: () => void withNatural(cropToFill),
          cropFit: () => void withNatural(cropToFit),
          resetCrop: () => upsertElement(imgResetCrop(selected)),
          actualSize: () => void withNatural(imgActualSize),
          fitToSlide: () => void withNatural(imgFitToSlide),
          replace: () => replaceInput.current?.click(),
          setOpacity: (v) => upsertElement(imgSetOpacity(selected, v)),
          toggleShadow: () => {
            const n = { ...selected };
            if (n.shadow) delete n.shadow;
            else n.shadow = true;
            upsertElement(n);
          },
          altText: () => setAltFor([selected.id]),
        }
      : null;
  // File → Import slides: append every slide of a .pptx after the deck's
  // last slide and jump to the first imported one.
  async function onPptxPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setImportMsg(`Importing ${f.name}…`);
    try {
      const r = await readPptxSlides(f);
      // Pictures go to the deck's asset store, keeping the deck (and its
      // collab broadcast) small; they stay inline if uploading fails.
      const fitted = docRef.current ? slidesForDeck(r.deck, docRef.current) : r.slides;
      const imported = await externalizeImages(fitted, (b) => uploadDeckAsset(id, b));
      const base = docRef.current?.slides ?? slides;
      setSlides([...base, ...imported]);
      setCur(base.length);
      setSelId(null);
      const n = r.slides.length;
      setImportMsg(
        `Imported ${n} slide${n === 1 ? "" : "s"} from ${f.name}` +
          (r.warnings.length ? `. ${r.warnings.join(". ")}.` : ""),
      );
    } catch (err) {
      setImportMsg(`Couldn't import ${f.name}: ${(err as Error).message}`);
    }
  }
  // Formatting applies to every selected element; toggles take their new
  // value from the primary selection so a mixed selection ends up uniform.
  function updateSelected(fn: (el: SlideElement) => SlideElement) {
    if (selectedEls.length) upsertMany(selectedEls.map(fn));
  }
  function toggle(attr: StyleToggle) {
    if (toggleText(attr)) return;
    if (!selected) return;
    const v = !selected[attr];
    updateSelected((e) => ({ ...e, [attr]: v }));
  }

  // ---- text formatting (M4) ----
  // editText applies `fn` to: the live selection while a box is edited; else
  // the selection saved when editing ended (then editing resumes with it);
  // else every selected text box, whole (`whole` = true). A collapsed
  // selection means the word at the caret ("word") or the caret's
  // paragraph ("para"). Returns false when there was no text to act on.
  function editText(
    fn: (el: SlideElement, from: number, to: number, whole: boolean) => EditResult | null,
    collapsed: "word" | "para" = "word",
  ): boolean {
    const widen = (el: SlideElement, a: number, b: number): [number, number] => {
      if (a !== b || collapsed === "para") return [a, b];
      return wordAt(el.text || "", a) ?? [a, b];
    };
    const unwrap = (r: EditResult) => ("type" in r ? { el: r, sel: undefined } : r);
    const h = textEditor.current;
    if (h && editingText) {
      h.apply((el, a, b) => {
        const [x, y] = widen(el, a, b);
        if (x === y && collapsed === "word" && (el.text || "").length) return null;
        const r = fn(el, x, y, false);
        return r && ("type" in r ? { el: r, sel: [a, b] as [number, number] } : r);
      });
      return true;
    }
    const saved = savedTextSel.current;
    if (saved && selected && selected.id === saved.id && selected.type === "text") {
      const [x, y] = widen(selected, saved.from, saved.to);
      if (x !== y || collapsed === "para") {
        const r = fn(selected, x, y, false);
        if (!r) return true;
        const { el, sel: s } = unwrap(r);
        upsertElement(el);
        savedTextSel.current = null;
        setEditRequest({ id: el.id, sel: s ?? [saved.from, saved.to], nonce: Date.now() });
        return true;
      }
    }
    // A cell whose editing ended (a menu or dialog took focus).
    const sc = saved ? parseCellId(saved.id) : null;
    if (saved && sc && selected?.type === "table" && selected.id === sc.tableId && selected.table) {
      const te = cellTextEl(selected, sc.r, sc.c);
      const [x, y] = widen(te, saved.from, saved.to);
      if (x !== y || collapsed === "para") {
        const r = fn(te, x, y, false);
        if (!r) return true;
        const { el, sel: s } = unwrap(r);
        upsertElement(setCellText(selected, sc.r, sc.c, el));
        savedTextSel.current = null;
        setEditRequest({ id: saved.id, sel: s ?? [saved.from, saved.to], nonce: Date.now() });
        return true;
      }
    }
    const texts = selectedEls.filter((e) => e.type === "text" || (e.type === "table" && e.table));
    if (!texts.length) return false;
    upsertMany(
      texts.map((e) => {
        if (e.type === "table")
          return mapCellTexts(e, tableRange(e), (te) => {
            const r = fn(te, 0, (te.text || "").length, true);
            return r ? unwrap(r).el : null;
          });
        const r = fn(e, 0, (e.text || "").length, true);
        return r ? unwrap(r).el : e;
      }),
    );
    return true;
  }
  /** The text element + range formatting would act on (for captures). */
  function textFocus(): { el: SlideElement; from: number; to: number } | null {
    const h = textEditor.current;
    if (h && editingText) {
      const [from, to] = h.selection();
      return { el: h.current(), from, to };
    }
    const saved = savedTextSel.current;
    if (saved && selected?.id === saved.id && selected.type === "text")
      return { el: selected, from: saved.from, to: saved.to };
    const sc = saved ? parseCellId(saved.id) : null;
    if (saved && sc && selected?.type === "table" && selected.id === sc.tableId && selected.table)
      return { el: cellTextEl(selected, sc.r, sc.c), from: saved.from, to: saved.to };
    if (selected?.type === "text") return { el: selected, from: 0, to: (selected.text || "").length };
    return null;
  }
  function toggleText(k: TextToggle): boolean {
    const prim = selected;
    // Several boxes (or cells): the primary decides on or off, so all end up alike.
    const primOn =
      k === "super" || k === "sub"
        ? undefined
        : prim?.type === "text"
          ? rangeHas(prim, 0, (prim.text || "").length, k, true)
          : prim?.type === "table" && prim.table
            ? rangeAnchors(prim.table, tableRange(prim)).every(([r, c]) => {
                const te = cellTextEl(prim, r, c);
                return rangeHas(te, 0, (te.text || "").length, k, true);
              })
            : undefined;
    return editText((el, a, b, whole) => {
      if (!whole || k === "super" || k === "sub" || primOn === undefined) return toggleRange(el, a, b, k);
      return formatRange(el, 0, (el.text || "").length, { [k]: !primOn });
    });
  }
  function styleText(patch: RunStyle): boolean {
    return editText((el, a, b, whole) => (whole ? formatWhole(el, patch) : formatRange(el, a, b, patch)));
  }
  function alignText(a: TextAlign): boolean {
    return editText(
      (el, x, y, whole) => (whole ? setAlignWhole(el, a) : setParaAlign(el, paraIndices(el.text || "", x, y), a)),
      "para",
    );
  }
  function indentText(d: 1 | -1) {
    editText((el, x, y, whole) => {
      const idxs = whole ? [...Array(paraCount(el.text || "")).keys()] : paraIndices(el.text || "", x, y);
      return indentParas(el, idxs, d);
    }, "para");
  }
  function listText(kind: "bullet" | "number" | null, style?: string) {
    editText((el) => setListStyle(el, kind, style), "para");
  }
  function copyFormat(): boolean {
    const f = textFocus();
    if (!f) return false;
    setPainter(captureFormat(f.el, f.from, f.to));
    return true;
  }
  function pasteFormat(style = painter): boolean {
    if (!style) return false;
    return editText((el, a, b, whole) => (whole ? applyFormatWhole(el, style) : applyFormat(el, a, b, style)));
  }
  function togglePainter() {
    if (painterArmed) return setPainterArmed(false);
    if (copyFormat()) setPainterArmed(true);
  }
  function openLink() {
    const f = textFocus();
    const h = textEditor.current;
    const ranged = f && ((h && editingText) || savedTextSel.current);
    if (f && ranged) {
      let { from, to } = f;
      // A caret inside a link edits that link.
      if (from === to) [from, to] = linkRangeAt(f.el, from) ?? [from, to];
      setLinkDlg({
        init: { url: linkAt(f.el, from) ?? "", text: (f.el.text || "").slice(from, to) },
        target: { kind: "range", id: f.el.id, from, to },
      });
      return;
    }
    if (!selectedEls.length) return;
    setLinkDlg({
      init: { url: selected?.url ?? "" },
      target: { kind: "elements", ids: selectedEls.map((e) => e.id) },
    });
  }
  function applyLink(url: string, text?: string) {
    const d = linkDlg;
    setLinkDlg(null);
    if (!d || !slide) return;
    if (d.target.kind === "elements") {
      const ids = d.target.ids;
      upsertMany(slide.elements.filter((e) => ids.includes(e.id)).map((e) => setLinkOp(e, url)));
      return;
    }
    const { id: elId, from } = d.target;
    let { to } = d.target;
    const el = slide.elements.find((e) => e.id === elId);
    if (!el) return;
    let next = el;
    if (from === to) {
      const t = text || linkLabel(url, slides);
      next = insertText(next, from, t);
      to = from + t.length;
    } else if (text && text !== (el.text || "").slice(from, to)) {
      next = replaceRange(next, from, to, text);
      to = from + text.length;
    }
    next = setLinkRange(next, from, to, url);
    upsertElement(next);
    savedTextSel.current = null;
    setEditRequest({ id: elId, sel: [to, to], nonce: Date.now() });
  }
  function removeLink() {
    const d = linkDlg;
    setLinkDlg(null);
    if (!d || !slide) return;
    if (d.target.kind === "elements") {
      const ids = d.target.ids;
      upsertMany(slide.elements.filter((e) => ids.includes(e.id)).map((e) => setLinkOp(e, "")));
      return;
    }
    const { id: elId, from, to } = d.target;
    const el = slide.elements.find((e) => e.id === elId);
    if (!el) return;
    upsertElement(from === to ? setLinkOp(el, "") : setLinkRange(el, from, to, ""));
    setEditRequest({ id: elId, sel: [from, to], nonce: Date.now() });
  }
  function followLink(url: string) {
    const i = resolveSlideLink(url, slides, cur);
    if (i !== null) {
      setCur(i);
      setSel([]);
    } else if (!parseSlideLink(url)) window.open(url, "_blank", "noopener,noreferrer");
  }
  function openChars() {
    const f = textFocus();
    const ranged = f && ((textEditor.current && editingText) || savedTextSel.current);
    charsTarget.current = f
      ? ranged
        ? { id: f.el.id, from: f.from, to: f.to }
        : { id: f.el.id, from: (f.el.text || "").length, to: (f.el.text || "").length }
      : null;
    setCharsOpen(true);
  }
  function pickChar(ch: string) {
    const t = charsTarget.current;
    const el = t && slide?.elements.find((e) => e.id === t.id);
    if (!t || !el) {
      // Nothing to type into: a new text box holding the character.
      const box = { ...newElement("text"), text: ch };
      upsertElement(box);
      setSelId(box.id);
      charsTarget.current = { id: box.id, from: ch.length, to: ch.length };
      return;
    }
    upsertElement(replaceRange(el, t.from, t.to, ch));
    const at = t.from + ch.length;
    charsTarget.current = { id: t.id, from: at, to: at };
  }
  function closeChars() {
    setCharsOpen(false);
    const t = charsTarget.current;
    if (t && slide?.elements.some((e) => e.id === t.id))
      setEditRequest({ id: t.id, sel: [t.from, t.to], nonce: Date.now() });
  }
  function applyTextOptions(o: TextOptions) {
    setTextOptsOpen(false);
    updateSelected((e) => {
      if (e.type !== "text") return e;
      let n: SlideElement = setInsets(e, o.insets.l, o.insets.t, o.insets.r, o.insets.b) ?? e;
      n = { ...n };
      if (o.spaceBefore) n.spaceBefore = o.spaceBefore;
      else delete n.spaceBefore;
      if (o.spaceAfter) n.spaceAfter = o.spaceAfter;
      else delete n.spaceAfter;
      if (o.autofit) n.autofit = "shrink";
      else delete n.autofit;
      return withDirection(n, o.direction);
    });
  }
  function withDirection(e: SlideElement, d: TextOptions["direction"]): SlideElement {
    const n = { ...e };
    delete n.rtl;
    delete n.vert;
    if (d === "rtl") n.rtl = true;
    if (d === "vert" || d === "vert270") n.vert = d;
    return n;
  }
  function gotoMatch(m: Match) {
    setCur(m.slideIdx);
    setFindHit(m);
    if (m.where === "notes") setShowNotes(true);
    else if (m.topId) setSel([m.topId]);
  }
  function replaceOneMatch(m: Match, repl: string) {
    if (!docRef.current) return;
    setSlides(replaceMatch(docRef.current, m, repl).slides);
  }
  function replaceAllMatches(q: string, repl: string, opts: FindOptions): number {
    if (!docRef.current) return 0;
    const r = replaceAll(docRef.current, q, repl, opts);
    if (r.count) setSlides(r.doc.slides);
    setFindHit(null);
    return r.count;
  }
  /** Formatting shortcuts (inside a text box, or on selected boxes). */
  function handleTextKey(a: TextKeyAction): boolean {
    const hasText = editingText || selectedEls.some((e) => e.type === "text" || e.type === "table");
    if (a.type === "link") {
      if (!editingText && !selectedEls.length) return false;
      openLink();
      return true;
    }
    if (!hasText) return false;
    switch (a.type) {
      case "toggle":
        return toggleText(a.key);
      case "fontStep":
        return editText((el, x, y) => stepFontRange(el, x, y, a.dir));
      case "align":
        return alignText(a.align);
      case "list": {
        const cur = (textEditor.current && editingText ? textEditor.current.current() : selected) ?? null;
        listText(cur?.list === a.list ? null : a.list);
        return true;
      }
      case "copyFormat":
        return copyFormat();
      case "pasteFormat":
        return pasteFormat();
      case "clearFormat":
        return editText((el, x, y) => clearFormatRange(el, x, y));
    }
    return false;
  }
  const textCmd: TextCommands = {
    toggle: (k) => void toggleText(k),
    fontStep: (d) => void editText((el, x, y) => stepFontRange(el, x, y, d)),
    setFontSize: (px) => void styleText({ fontSize: px }),
    setFontFamily: (f) => void styleText({ fontFamily: f }),
    setColor: (c) => void styleText({ color: c }),
    align: (a) => void alignText(a),
    valign: (v) => void editText((el) => ({ ...el, valign: v }), "para"),
    indent: indentText,
    list: listText,
    changeCase: (m: CaseMode) => void editText((el, x, y) => changeCaseRange(el, x, y, m)),
    clearFormat: () => void editText((el, x, y) => clearFormatRange(el, x, y)),
    paintFormat: togglePainter,
    painting: painterArmed,
    link: openLink,
    findReplace: () => setFindOpen(true),
    specialChars: openChars,
    textOptions: () => setTextOptsOpen(true),
    setAutofit: (on) =>
      void editText((el) => {
        const n = { ...el };
        if (on) n.autofit = "shrink";
        else delete n.autofit;
        return n;
      }, "para"),
    setDirection: (d) => void editText((el) => withDirection(el, d), "para"),
  };
  // ---- tables (M5) ----
  function insertTable(rows: number, cols: number) {
    setTablePickerOpen(false);
    const el = newTableElement(rows, cols);
    upsertElement(el);
    setSelId(el.id);
  }
  /** Apply a table op to the selected table; null deletes it. */
  function tableOp(fn: (el: SlideElement, g: CellRange) => SlideElement | null, nextSel?: (el: SlideElement) => CellSel | null) {
    const el = selTable;
    if (!el) return;
    const next = fn(el, tableRange(el));
    if (next === null) {
      removeMany([el.id]);
      return;
    }
    upsertElement(next);
    if (nextSel) {
      const s = nextSel(next);
      setTableSel(s ? { id: el.id, sel: s } : null);
    }
  }
  const one = (r: number, c: number): CellSel => ({ r, c, r2: r, c2: c });
  const tableCmd: TableCommands | null = selTable
    ? {
        insertRow: (where) =>
          tableOp(
            (el, g) => insertRows(el, where === "above" ? g.r0 : g.r1 + 1),
            () => {
              const g = tableRange(selTable);
              return one(where === "above" ? g.r0 : g.r1 + 1, g.c0);
            },
          ),
        insertCol: (where) =>
          tableOp(
            (el, g) => insertCols(el, where === "left" ? g.c0 : g.c1 + 1),
            () => {
              const g = tableRange(selTable);
              return one(g.r0, where === "left" ? g.c0 : g.c1 + 1);
            },
          ),
        deleteRow: () => tableOp((el, g) => deleteRows(el, g.r0, g.r1), () => null),
        deleteCol: () => tableOp((el, g) => deleteCols(el, g.c0, g.c1), () => null),
        deleteTable: () => removeMany([selTable.id]),
        merge: () => tableOp((el, g) => mergeCells(el, g), (el) => one(tableRange(el).r0, tableRange(el).c0)),
        canMerge: !!activeSel && (activeSel.r !== activeSel.r2 || activeSel.c !== activeSel.c2),
        split: () => setSplitOpen(true),
        distributeRows: () => tableOp((el, g) => (activeSel ? distributeRows(el, g.r0, g.r1) : distributeRows(el))),
        distributeCols: () => tableOp((el, g) => (activeSel ? distributeCols(el, g.c0, g.c1) : distributeCols(el))),
        setFill: (color) => tableOp((el, g) => setCellFill(el, g, color)),
        setBorders: (preset, border) => tableOp((el, g) => setCellBorders(el, g, preset, border)),
        setStyle: (id) => tableOp((el) => setTableStyle(el, id)),
        setLook: (k, on) => tableOp((el) => setTableLook(el, k, on)),
        selectRow: () => {
          const g = tableRange(selTable);
          setTableSel({ id: selTable.id, sel: { r: g.r0, c: 0, r2: g.r1, c2: selTable.table!.cols - 1 } });
        },
        selectCol: () => {
          const g = tableRange(selTable);
          setTableSel({ id: selTable.id, sel: { r: 0, c: g.c0, r2: selTable.table!.rows - 1, c2: g.c1 } });
        },
        selectTable: () => {
          const t = selTable.table!;
          setTableSel({ id: selTable.id, sel: { r: 0, c: 0, r2: t.rows - 1, c2: t.cols - 1 } });
        },
      }
    : null;
  /** Keys on a selected table (not while editing a cell): see tableKey. */
  function handleTableKey(e: KeyboardEvent): boolean {
    const el = selTable;
    if (!el || e.ctrlKey || e.metaKey || e.altKey) return false;
    const sel = activeSel;
    // Esc first drops the cell selection (the table stays selected).
    if (sel && e.key === "Escape") {
      setTableSel(null);
      return true;
    }
    // Without an active cell, arrows keep nudging and Delete deletes the table.
    if (!sel && e.key !== "Enter") return false;
    const res = tableKey(el.table!, sel, e.key, e.shiftKey);
    if (!res) return false;
    if (res.type === "select") setTableSel({ id: el.id, sel: res.sel });
    else if (res.type === "clear") upsertElement(clearCells(el, res.range));
    else if (res.type === "addRow") {
      upsertElement(insertRows(el, el.table!.rows));
      setTableSel({ id: el.id, sel: res.sel });
    } else if (res.type === "edit") {
      let next = el;
      if (res.clear) {
        next = clearCells(el, res.clear);
        upsertElement(next);
      }
      const len = (next.table!.cells[res.r]?.[res.c] ?? "").length;
      const s: [number, number] = res.sel === "all" ? [0, len] : res.sel === "start" ? [0, 0] : [len, len];
      setTableSel({ id: el.id, sel: one(res.r, res.c) });
      setEditRequest({ id: `${el.id}:${res.r}:${res.c}`, sel: s, nonce: Date.now() });
    }
    return true;
  }

  function setList(v: "bullet" | "number" | null) {
    if (editText((el) => setListStyle(el, v), "para")) return;
    updateSelected((e) => setListOp(e, v));
  }
  function setLineSpacing(v: number) {
    updateSelected((e) => ({ ...e, lineSpacing: v }));
  }
  function setAlign(a: TextAlign) {
    if (alignText(a)) return;
    updateSelected((e) => ({ ...e, align: a }));
  }
  function setField<K extends keyof SlideElement>(k: K, v: SlideElement[K]) {
    updateSelected((e) => ({ ...e, [k]: v }));
  }
  function arrange(dir: ArrangeDir) {
    if (!slide || !selIds.length) return;
    const els = arrangeMany(slide.elements, selIds, dir);
    pushHistory();
    applyToSlide(slide.id, (s) => ({ ...s, elements: els }));
    broadcast({ t: "reorder", si: slide.id, ids: els.map((e) => e.id) });
    scheduleSave();
  }
  function rotate(op: RotateOp) {
    updateSelected((e) => rotateElement(e, op));
  }
  function align(how: AlignHow) {
    upsertMany(alignElements(selectedEls, how, alignTo));
  }
  function distribute(axis: "horizontal" | "vertical") {
    upsertMany(distributeElements(selectedEls, axis, alignTo));
  }
  function centerPage(axis: "horizontal" | "vertical") {
    upsertMany(centerOnPage(selectedEls, axis));
  }
  function doGroup() {
    if (!slide) return;
    const r = groupElements(slide.elements, selIds);
    if (!r) return;
    setElements(r.elements);
    setSel([r.groupId]);
  }
  function doUngroup() {
    if (!slide) return;
    const r = ungroupMany(slide.elements, selIds);
    if (!r) return;
    setElements(r.elements);
    setSel(r.ids);
  }
  function toggleLock() {
    const lock = !selectedEls.every((e) => e.locked);
    upsertMany(setLocked(selectedEls, lock));
  }
  function setLink() {
    openLink();
  }
  function setBackground() {
    if (slide) setBgOpen(true);
  }

  // Speaker notes for the current slide. Debounced through the normal save path;
  // history is skipped so each keystroke doesn't flood the undo stack.
  function setNotes(text: string) {
    if (!slide) return;
    setSlides(patchSlide(slides, slide.id, { notes: text }), {
      history: false,
    });
  }

  // Insert new elements on top and select them (paste, duplicate).
  function insertEls(els: SlideElement[]) {
    if (!els.length) return;
    upsertMany(els);
    setSel(els.map((e) => e.id));
  }
  // Element clipboard (in-app) for the right-click menu.
  function duplicateEls(els: SlideElement[]) {
    insertEls(duplicateElements(els));
  }
  function pasteEl() {
    if (!clip.current) return;
    insertEls(duplicateElements(clip.current));
  }

  function undo() {
    const r = undoHistory(hist.current, docRef.current);
    if (!r) return;
    hist.current = r.history;
    const d = r.doc;
    setDoc(d);
    broadcast({ t: "deck", deck: d });
    scheduleSave();
    setCur((c) => Math.min(c, d.slides.length - 1));
  }
  function redo() {
    const r = redoHistory(hist.current, docRef.current);
    if (!r) return;
    hist.current = r.history;
    const d = r.doc;
    setDoc(d);
    broadcast({ t: "deck", deck: d });
    scheduleSave();
  }

  async function commitTitle() {
    const t = title.trim() || "Untitled presentation";
    setTitle(t);
    try {
      await renameDeck(id, t);
    } catch {
      /* keep local */
    }
  }

  const actions: SlideActions = {
    newDeck: async () => {
      const d = await createDeck();
      navigate(`/slides/d/${d.id}`);
    },
    open: () => navigate("/slides"),
    importSlides: () => pptxInput.current?.click(),
    makeCopy: async () => {
      const d = await createDeck(`Copy of ${title}`);
      if (docRef.current)
        await saveDeck(d.id, JSON.stringify(docRef.current)).catch(() => {});
      navigate(`/slides/d/${d.id}`);
    },
    rename: () =>
      (
        document.querySelector(
          '[aria-label="Presentation title"]',
        ) as HTMLInputElement | null
      )?.focus(),
    trash: async () => {
      await trashDeck(id);
      navigate("/slides");
    },
    share: () => setShareOpen(true),
    versionHistory: () => setHistoryOpen(true),
    download: async (fmt) => {
      try {
        if (docRef.current) await downloadDeck(docRef.current, title, fmt, cur);
      } catch (e) {
        window.alert(`Download failed: ${(e as Error).message}`);
      }
    },
    print: () => actions.download("pdf"),
    undo,
    redo,
    insert,
    insertImageFile,
    newSlide: () => doNewSlide(),
    openShapes: () => setGalleryOpen(true),
    drawShape: pickShape,
    duplicateSlide,
    deleteSlide,
    present: () => startPresent("current"),
    presentFromStart: () => startPresent("start"),
    presenterView: () => startPresent("current", true),
    showLoop: !!doc?.show?.loop,
    toggleLoop,
    openMotion: () => setMotionOpen(true),
    toggle,
    setList,
    setLineSpacing,
    setAlign,
    text: textCmd,
    arrange,
    rotate,
    setLink,
    deleteSelected: () => removeMany(selIds),
    selectAll: () => setSel(selectAll(slide)),
    align,
    distribute,
    centerOnPage: centerPage,
    group: doGroup,
    ungroup: doUngroup,
    toggleLock,
    alignTo,
    setAlignTo,
    snapGuides,
    toggleSnapGuides: () => setSnapGuides((v) => !v),
    snapGrid,
    toggleSnapGrid: () => setSnapGrid((v) => !v),
    selection: {
      count: selectedEls.length,
      canGroup: selectedEls.length > 1,
      canUngroup: selectedEls.some((e) => e.type === "group"),
      locked: selectedEls.length > 0 && selectedEls.every((e) => e.locked),
    },
    setBackground,
    changeTheme: () => setThemeDlg("gallery"),
    editTheme: () => setThemeDlg("edit"),
    layouts: layoutsOf(doc).map((l) => ({ id: l.id, name: l.name })),
    currentLayout: slide?.layout,
    applyLayout: applyLayoutToSlide,
    newSlideWithLayout: (lid: string) => doNewSlide(lid),
    resetSlide: resetCurrentSlide,
    slideHidden: !!slide?.hidden,
    toggleSkip,
    pageSetup: () => setPageSetupOpen(true),
    headerFooter: () => setHfOpen(true),
    paste: pasteEl,
    duplicateSelected: () => {
      duplicateEls(selectedEls);
    },
    openTransition: () => setMotionOpen(true),
    openAnimations: () => setMotionOpen(true),
    toggleNotes: () => setShowNotes((v) => !v),
    insertTable: () => setTablePickerOpen(true),
    table: tableCmd,
    image: imageCmd,
    altText: () => selIds.length && setAltFor(selIds),
  };

  if (doc === null) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const peerList = Object.values(peers);

  if (present && slide) {
    // Skipped (hidden) slides are left out; header/footer boxes drawn in.
    const show = showSlides(doc);
    if (show.slides.length) {
      return (
        <SlideShow
          deckId={id}
          slides={show.slides}
          start={Math.min(showIdx, show.slides.length - 1)}
          loop={!!doc.show?.loop}
          presenterWindow={presenterWin}
          onExit={(at) => {
            setCur(show.indexOf[at] ?? cur);
            setPresent(false);
          }}
        />
      );
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header user={user} />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={onImagePicked}
      />
      <input
        ref={bgImageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={onBgImagePicked}
      />
      <input
        ref={replaceInput}
        type="file"
        accept="image/*"
        hidden
        onChange={onReplacePicked}
      />
      <input
        ref={pptxInput}
        type="file"
        accept={PPTX_ACCEPT}
        hidden
        data-testid="pptx-import-input"
        onChange={onPptxPicked}
      />
      <JoySheet
        variant="plain"
        sx={{ px: 2, pt: 1, bgcolor: "background.body" }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconButton
            variant="plain"
            aria-label="Back to Slides"
            onClick={() => navigate("/slides")}
          >
            <ArrowBackIcon />
          </IconButton>
          <SlideshowIcon sx={{ color: "#D9A441", fontSize: 26 }} />
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
              slotProps={{ input: { "aria-label": "Presentation title" } }}
            />
            <SlideMenuBar actions={actions} />
          </Box>
          <Box sx={{ flex: 1 }} />
          <AvatarGroup size="sm">
            {peerList.map((p) => (
              <Tooltip
                key={p.userId}
                title={`${p.username} — slide ${p.slideIdx + 1}`}
              >
                <Avatar sx={{ bgcolor: p.color, color: "#fff" }}>
                  {p.username.charAt(0).toUpperCase()}
                </Avatar>
              </Tooltip>
            ))}
          </AvatarGroup>
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
          <IconButton
            size="sm"
            variant="outlined"
            aria-label="Slides panel"
            onClick={() => setMobileSlidesOpen((v) => !v)}
            sx={{ display: { xs: "flex", md: "none" } }}
          >
            <SlideshowIcon />
          </IconButton>
          <Button
            size="sm"
            startDecorator={<SlideshowIcon />}
            onClick={() => startPresent("current")}
            aria-label="Present"
          >
            Present
          </Button>
          <Dropdown>
            <MenuButton size="sm" variant="solid" color="primary" aria-label="Slideshow options" sx={{ px: 0.5, minWidth: 0 }}>
              ▾
            </MenuButton>
            <Menu size="sm" placement="bottom-end" sx={{ zIndex: 1300 }}>
              <MenuItem onClick={() => startPresent("start")}>Present from beginning</MenuItem>
              <MenuItem onClick={() => startPresent("current")}>Present from current slide</MenuItem>
              <MenuItem onClick={() => startPresent("current", true)}>Presenter view</MenuItem>
              <MenuItem onClick={toggleLoop}>
                {doc.show?.loop ? "✓ " : ""}Loop until Esc
              </MenuItem>
            </Menu>
          </Dropdown>
        </Box>
        {/* toolbar: buttons keep the text editor's focus (and selection);
            inputs and selects take focus, and then apply to the saved
            text selection */}
        <Box
          data-testid="slides-toolbar"
          onMouseDown={(e) => {
            const t = e.target as HTMLElement;
            if (!t.closest("input, select, textarea")) e.preventDefault();
          }}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            py: 0.5,
            flexWrap: { xs: "nowrap", md: "wrap" },
            overflowX: { xs: "auto", md: "visible" },
            WebkitOverflowScrolling: "touch",
          }}
        >
          <Tooltip title="Text box">
            <IconButton
              size="sm"
              variant="plain"
              onClick={() => insert("text")}
            >
              <TextFieldsIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Image">
            <IconButton size="sm" variant="plain" onClick={insertImageFile}>
              <ImageIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Rectangle">
            <IconButton
              size="sm"
              variant="plain"
              onClick={() => insert("rect")}
            >
              <CropSquareIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Ellipse">
            <IconButton
              size="sm"
              variant="plain"
              onClick={() => insert("ellipse")}
            >
              <CircleOutlinedIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Line">
            <IconButton
              size="sm"
              variant="plain"
              onClick={() => insert("line")}
            >
              <HorizontalRuleIcon />
            </IconButton>
          </Tooltip>
          {/* Shape gallery: pick a preset, then click/drag on the slide */}
          <Dropdown open={galleryOpen} onOpenChange={(_, o) => setGalleryOpen(o)}>
            <Tooltip title="Shapes">
              <MenuButton
                slots={{ root: IconButton }}
                slotProps={{
                  root: {
                    size: "sm",
                    variant: drawTool ? "soft" : "plain",
                    "aria-label": "Shapes",
                  },
                }}
              >
                <InterestsIcon />
              </MenuButton>
            </Tooltip>
            <Menu size="sm" placement="bottom-start" sx={{ p: 0 }}>
              <ShapeGallery onPick={pickShape} />
            </Menu>
          </Dropdown>
          <Dropdown open={tablePickerOpen} onOpenChange={(_, o) => setTablePickerOpen(o)}>
            <Tooltip title="Table">
              <MenuButton
                slots={{ root: IconButton }}
                slotProps={{ root: { size: "sm", variant: "plain", "aria-label": "Table" } }}
              >
                <TableChartOutlinedIcon />
              </MenuButton>
            </Tooltip>
            <Menu size="sm" placement="bottom-start" sx={{ p: 0 }}>
              <TableSizePicker onPick={insertTable} />
            </Menu>
          </Dropdown>
          {!selected && (
            <>
              <Divider orientation="vertical" sx={{ mx: 0.5 }} />
              <Button size="sm" variant="plain" color="neutral" onClick={setBackground}>
                Background
              </Button>
              <Dropdown open={layoutMenu === "apply"} onOpenChange={(_, o) => setLayoutMenu(o ? "apply" : null)}>
                <MenuButton size="sm" variant="plain" color="neutral" aria-label="Layout">
                  Layout
                </MenuButton>
                <Menu size="sm" placement="bottom-start" sx={{ p: 0 }}>
                  <LayoutGrid
                    layouts={layoutsOf(doc)}
                    current={slide?.layout}
                    onPick={(lid) => {
                      setLayoutMenu(null);
                      applyLayoutToSlide(lid);
                    }}
                  />
                </Menu>
              </Dropdown>
              <Button size="sm" variant="plain" color="neutral" onClick={() => setThemeDlg("gallery")}>
                Theme
              </Button>
            </>
          )}
          {drawTool && (
            <Typography
              level="body-xs"
              data-testid="draw-hint"
              sx={{ mx: 0.5, color: "text.tertiary", whiteSpace: "nowrap" }}
            >
              Click or drag on the slide to draw · Esc cancels
            </Typography>
          )}
          <Divider orientation="vertical" sx={{ mx: 0.5 }} />
          <IconButton
            size="sm"
            variant={selected?.bold ? "soft" : "plain"}
            disabled={!selected}
            onClick={() => toggle("bold")}
          >
            <FormatBoldIcon />
          </IconButton>
          <IconButton
            size="sm"
            variant={selected?.italic ? "soft" : "plain"}
            disabled={!selected}
            onClick={() => toggle("italic")}
          >
            <FormatItalicIcon />
          </IconButton>
          <IconButton
            size="sm"
            variant={selected?.underline ? "soft" : "plain"}
            disabled={!selected}
            onClick={() => toggle("underline")}
          >
            <FormatUnderlinedIcon />
          </IconButton>
          <ToggleButtonGroup
            size="sm"
            variant="plain"
            value={selected?.align || null}
            sx={{ ml: 0.5 }}
            onChange={(_, v) => v && setAlign(v as "left" | "center" | "right")}
          >
            <IconButton value="left" disabled={!selected}>
              <FormatAlignLeftIcon />
            </IconButton>
            <IconButton value="center" disabled={!selected}>
              <FormatAlignCenterIcon />
            </IconButton>
            <IconButton value="right" disabled={!selected}>
              <FormatAlignRightIcon />
            </IconButton>
          </ToggleButtonGroup>
          <TextFormatControls el={selected} cmd={textCmd} />
          {selected && isShape(selected.type) && (
            <input
              type="color"
              value={
                selected.fill && /^#[0-9a-f]{6}/i.test(selected.fill)
                  ? selected.fill.slice(0, 7)
                  : "#4285f4"
              }
              onChange={(e) => setField("fill", e.target.value)}
              title="Fill color"
              aria-label="Fill color"
              style={{ marginLeft: 4 }}
            />
          )}
          {selected && isShape(selected.type) && (
            <Dropdown open={fillMenuOpen} onOpenChange={(_, o) => setFillMenuOpen(o)}>
              <MenuButton size="sm" variant="plain" aria-label="Theme fill colour" sx={{ px: 0.5, minWidth: 0 }}>
                ▾
              </MenuButton>
              <Menu size="sm" placement="bottom-start" sx={{ p: 0 }}>
                <ThemePalette
                  theme={themeOf(doc)}
                  onPick={(ref) => {
                    setFillMenuOpen(false);
                    const t = themeOf(doc);
                    upsertMany(selectedEls.filter((e) => isShape(e.type)).map((e) => withColorRef(e, "fill", ref, t)));
                  }}
                />
              </Menu>
            </Dropdown>
          )}
          <ImageControls el={selected} cmd={imageCmd} />
          <TableControls el={selTable} cmd={tableCmd} activeCell={activeSel ? [activeSel.r, activeSel.c] : null} />
          <ShapeFormatControls
            el={selected}
            onChange={(patch) =>
              updateSelected((e) => {
                const next = { ...e, ...patch };
                for (const k of Object.keys(patch) as (keyof SlideElement)[])
                  if (patch[k] === undefined) delete next[k];
                return next;
              })
            }
          />
        </Box>
      </JoySheet>
      <Divider />

      <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* Thumbnail rail — desktop: fixed left column; mobile: slide-in overlay toggled by mobileSlidesOpen */}
        {mobileSlidesOpen && (
          <Box
            onClick={() => setMobileSlidesOpen(false)}
            sx={{
              display: { xs: "block", md: "none" },
              position: "fixed",
              inset: 0,
              bgcolor: "rgba(0,0,0,0.4)",
              zIndex: 1200,
            }}
          />
        )}
        <Box
          sx={{
            width: 180,
            flexShrink: 0,
            borderRight: "1px solid",
            borderColor: "divider",
            overflowY: "auto",
            p: 1,
            bgcolor: "background.level1",
            display: { xs: mobileSlidesOpen ? "flex" : "none", md: "flex" },
            flexDirection: "column",
            position: { xs: "fixed", md: "relative" },
            top: { xs: 0, md: "auto" },
            bottom: { xs: 0, md: "auto" },
            left: { xs: 0, md: "auto" },
            zIndex: { xs: 1201, md: "auto" },
            height: { xs: "100vh", md: "auto" },
          }}
        >
          {slides.map((s, i) => {
            const here = peerList.filter((p) => p.slideIdx === i);
            return (
              <Box
                key={s.id}
                data-testid="slide-thumb"
                onClick={() => {
                  setCur(i);
                  setSelId(null);
                }}
                sx={{
                  display: "flex",
                  gap: 0.5,
                  mb: 1,
                  cursor: "pointer",
                  alignItems: "flex-start",
                }}
              >
                <Typography
                  level="body-xs"
                  sx={{ width: 16, textAlign: "right", opacity: 0.6, pt: 0.5 }}
                >
                  {i + 1}
                </Typography>
                <Box
                  sx={{
                    position: "relative",
                    border: "2px solid",
                    borderColor: i === cur ? "primary.500" : "transparent",
                    borderRadius: 4,
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  <Box sx={{ opacity: s.hidden ? 0.45 : 1, lineHeight: 0 }}>
                    <SlideView slide={withFooters(doc, i)} width={140} />
                  </Box>
                  {s.hidden && (
                    <Box
                      data-testid="slide-hidden"
                      title="Skipped in the slideshow"
                      sx={{
                        position: "absolute",
                        left: 2,
                        bottom: 2,
                        px: 0.5,
                        fontSize: 10,
                        lineHeight: "14px",
                        borderRadius: 3,
                        bgcolor: "rgba(32,33,36,0.8)",
                        color: "#fff",
                      }}
                    >
                      Skipped
                    </Box>
                  )}
                  {here.length > 0 && (
                    <Box
                      sx={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        display: "flex",
                        gap: 0.25,
                      }}
                    >
                      {here.map((p) => (
                        <Box
                          key={p.userId}
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            bgcolor: p.color,
                            border: "1px solid #fff",
                          }}
                        />
                      ))}
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
          <Box sx={{ display: "flex", gap: 0.25, mt: 0.5 }}>
            <Button
              size="sm"
              variant="soft"
              startDecorator={<AddIcon />}
              onClick={() => doNewSlide()}
              sx={{ flex: 1 }}
            >
              New slide
            </Button>
            <Dropdown open={layoutMenu === "new"} onOpenChange={(_, o) => setLayoutMenu(o ? "new" : null)}>
              <MenuButton size="sm" variant="soft" aria-label="New slide with layout" sx={{ px: 0.5, minWidth: 0 }}>
                ▾
              </MenuButton>
              <Menu size="sm" placement="right-start" sx={{ p: 0, zIndex: 1300 }}>
                <LayoutGrid
                  layouts={layoutsOf(doc)}
                  onPick={(lid) => {
                    setLayoutMenu(null);
                    doNewSlide(lid);
                  }}
                />
              </Menu>
            </Dropdown>
          </Box>
          <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
            <Button
              size="sm"
              variant="plain"
              startDecorator={<ContentCopyIcon />}
              onClick={duplicateSlide}
              sx={{ flex: 1 }}
            >
              Copy
            </Button>
            <Button
              size="sm"
              variant="plain"
              color="danger"
              startDecorator={<DeleteOutlineIcon />}
              onClick={deleteSlide}
              sx={{ flex: 1 }}
            >
              Del
            </Button>
          </Box>
          <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
            <Button
              size="sm"
              variant="plain"
              onClick={() => moveSlide(cur, cur - 1)}
              sx={{ flex: 1 }}
            >
              ↑ Up
            </Button>
            <Button
              size="sm"
              variant="plain"
              onClick={() => moveSlide(cur, cur + 1)}
              sx={{ flex: 1 }}
            >
              ↓ Down
            </Button>
          </Box>
        </Box>

        {/* Stage + notes (vertical stack) */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Box
            ref={stageRef}
            sx={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "#e9eaed",
              p: 3,
              overflow: "auto",
            }}
          >
            {slide && (
              <SlideCanvas
                slide={slide}
                width={canvasW}
                selectedIds={selIds}
                onSelect={(ids) => {
                  savedTextSel.current = null;
                  setFindHit(null);
                  setSel(ids);
                }}
                onChange={(el) => upsertElement(el)}
                decorations={footerElements(doc, cur)}
                onChangeMany={(els, o) => upsertMany(els, o)}
                snap={{ guides: snapGuides, grid: snapGrid ? GRID_SIZE : 0 }}
                showGrid={snapGrid}
                onEditingText={setEditingText}
                onContext={(x, y, elId) => setCtxMenu({ x, y, elId })}
                drawTool={drawTool}
                onDrawn={onDrawn}
                textEditorRef={textEditor}
                onTextKey={(a) => handleTextKey(a)}
                onEditExit={(elId, [from, to]) => {
                  savedTextSel.current = { id: elId, from, to };
                }}
                onEditorMouseUp={(h) => {
                  if (!painterArmed || !painter) return;
                  const [a, b] = h.selection();
                  if (a === b) return;
                  const style = painter;
                  h.apply((el) => applyFormat(el, a, b, style));
                  setPainterArmed(false);
                }}
                editRequest={editRequest}
                painting={painterArmed}
                onPaint={(el) => {
                  if (!painter) return;
                  upsertElement(applyFormatWhole(el, painter));
                  setPainterArmed(false);
                }}
                onFollowLink={followLink}
                tableSel={tableSel}
                onTableSel={setTableSel}
                cropId={cropId}
                findHighlight={
                  findOpen && findHit && findHit.where === "text" && findHit.slideIdx === cur && findHit.topId === findHit.elId
                    ? { elId: findHit.elId!, start: findHit.start, end: findHit.end }
                    : null
                }
              />
            )}
          </Box>

          {/* Speaker notes panel */}
          {showNotes && slide && (
            <Box
              sx={{
                borderTop: "1px solid",
                borderColor: "divider",
                bgcolor: "background.body",
                px: 2,
                py: 1,
                flexShrink: 0,
              }}
            >
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}
              >
                <SpeakerNotesIcon sx={{ fontSize: 18, opacity: 0.6 }} />
                <Typography
                  level="body-xs"
                  sx={{ fontWeight: 600, opacity: 0.7 }}
                >
                  Speaker notes
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Hide speaker notes">
                  <IconButton
                    size="sm"
                    variant="plain"
                    aria-label="Hide speaker notes"
                    onClick={() => setShowNotes(false)}
                  >
                    <SpeakerNotesOffIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              </Box>
              <Textarea
                minRows={2}
                maxRows={5}
                placeholder="Add speaker notes…"
                value={slide.notes || ""}
                onFocus={() => setEditingText(true)}
                onBlur={() => setEditingText(false)}
                onChange={(e) => setNotes(e.target.value)}
                slotProps={{
                  textarea: { "aria-label": "Speaker notes for this slide" },
                }}
                sx={{ fontSize: "0.875rem" }}
              />
            </Box>
          )}
          {!showNotes && (
            <Box
              sx={{
                borderTop: "1px solid",
                borderColor: "divider",
                bgcolor: "background.body",
                px: 2,
                py: 0.5,
                flexShrink: 0,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <Button
                size="sm"
                variant="plain"
                startDecorator={<SpeakerNotesIcon sx={{ fontSize: 18 }} />}
                onClick={() => setShowNotes(true)}
              >
                Show speaker notes
              </Button>
            </Box>
          )}
        </Box>
        {motionOpen && slide && (
          <MotionPanel
            slide={slide}
            prevSlide={cur > 0 ? slides[cur - 1] : undefined}
            selIds={selIds}
            selEffect={selEffect}
            onSelEffect={setSelEffect}
            onSlide={(s) => setSlides(slides.map((x) => (x.id === s.id ? s : x)))}
            onApplyToAll={(patch) =>
              setSlides(
                slides.map((x) => {
                  const n: Slide = { ...x, ...patch };
                  for (const k of Object.keys(patch) as (keyof typeof patch)[]) if (n[k] === undefined) delete n[k];
                  return n;
                }),
              )
            }
            onSelectElement={(elId) => setSel([elId])}
            onClose={() => {
              setMotionOpen(false);
              setSelEffect(null);
            }}
          />
        )}
      </Box>

      {/* Right-click context menu (Google Slides parity). */}
      {ctxMenu && (
        <>
          <Box
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
            sx={{ position: "fixed", inset: 0, zIndex: 1200 }}
          />
          <JoySheet
            variant="outlined"
            sx={{
              position: "fixed",
              left: ctxMenu.x,
              top: ctxMenu.y,
              zIndex: 1201,
              borderRadius: "sm",
              boxShadow: "md",
              py: 0.5,
              minWidth: 200,
            }}
          >
            <MenuList size="sm">
              {(() => {
                const close = (fn: () => void) => () => {
                  fn();
                  setCtxMenu(null);
                };
                if (ctxMenu.elId) {
                  const el = slide?.elements.find((e) => e.id === ctxMenu.elId);
                  const targets = selectedEls.length
                    ? selectedEls
                    : el
                      ? [el]
                      : [];
                  const targetIds = targets.map((e) => e.id);
                  return (
                    <>
                      <MenuItem
                        onClick={close(() => {
                          clip.current = targets.map((e) => ({ ...e }));
                          removeMany(targetIds);
                        })}
                      >
                        Cut
                      </MenuItem>
                      <MenuItem
                        onClick={close(() => {
                          clip.current = targets.map((e) => ({ ...e }));
                        })}
                      >
                        Copy
                      </MenuItem>
                      <MenuItem
                        disabled={!clip.current}
                        onClick={close(pasteEl)}
                      >
                        Paste
                      </MenuItem>
                      <MenuItem onClick={close(() => duplicateEls(targets))}>
                        Duplicate
                      </MenuItem>
                      <ListDivider />
                      <MenuItem onClick={close(() => arrange("front"))}>
                        Bring to front
                      </MenuItem>
                      <MenuItem onClick={close(() => arrange("forward"))}>
                        Bring forward
                      </MenuItem>
                      <MenuItem onClick={close(() => arrange("backward"))}>
                        Send backward
                      </MenuItem>
                      <MenuItem onClick={close(() => arrange("back"))}>
                        Send to back
                      </MenuItem>
                      <ListDivider />
                      <MenuItem
                        disabled={targets.length < 2}
                        onClick={close(doGroup)}
                      >
                        Group
                      </MenuItem>
                      <MenuItem
                        disabled={!targets.some((e) => e.type === "group")}
                        onClick={close(doUngroup)}
                      >
                        Ungroup
                      </MenuItem>
                      <MenuItem onClick={close(toggleLock)}>
                        {targets.every((e) => e.locked)
                          ? "Unlock position"
                          : "Lock position"}
                      </MenuItem>
                      <MenuItem onClick={close(() => setAltFor(targetIds))}>Alt text…</MenuItem>
                      {imageCmd && targets.length === 1 && targets[0].id === selected?.id && (
                        <>
                          <MenuItem onClick={close(imageCmd.toggleCrop)}>Crop image</MenuItem>
                          <MenuItem onClick={close(imageCmd.resetCrop)}>Reset crop</MenuItem>
                          <MenuItem onClick={close(imageCmd.replace)}>Replace image…</MenuItem>
                        </>
                      )}
                      {tableCmd && targets.length === 1 && targets[0].id === selTable?.id && (
                        <>
                          <ListDivider />
                          <MenuItem onClick={close(() => tableCmd.insertRow("above"))}>Insert row above</MenuItem>
                          <MenuItem onClick={close(() => tableCmd.insertRow("below"))}>Insert row below</MenuItem>
                          <MenuItem onClick={close(() => tableCmd.insertCol("left"))}>Insert column left</MenuItem>
                          <MenuItem onClick={close(() => tableCmd.insertCol("right"))}>Insert column right</MenuItem>
                          <MenuItem onClick={close(tableCmd.deleteRow)}>Delete row</MenuItem>
                          <MenuItem onClick={close(tableCmd.deleteCol)}>Delete column</MenuItem>
                          <MenuItem disabled={!tableCmd.canMerge} onClick={close(tableCmd.merge)}>
                            Merge cells
                          </MenuItem>
                          <MenuItem onClick={close(tableCmd.split)}>Split cell…</MenuItem>
                        </>
                      )}
                      <ListDivider />
                      <MenuItem
                        color="danger"
                        onClick={close(() => removeMany(targetIds))}
                      >
                        Delete
                      </MenuItem>
                    </>
                  );
                }
                return (
                  <>
                    <MenuItem disabled={!clip.current} onClick={close(pasteEl)}>
                      Paste
                    </MenuItem>
                    <MenuItem onClick={close(() => insert("text"))}>
                      New text box
                    </MenuItem>
                    <MenuItem onClick={close(insertImageFile)}>
                      Insert image
                    </MenuItem>
                    <ListDivider />
                    <MenuItem onClick={close(doNewSlide)}>New slide</MenuItem>
                    <MenuItem onClick={close(setBackground)}>
                      Change background…
                    </MenuItem>
                  </>
                );
              })()}
            </MenuList>
          </JoySheet>
        </>
      )}

      <ThemeDialog
        open={!!themeDlg}
        tab={themeDlg ?? "gallery"}
        current={themeOf(doc)}
        onApply={(t) => {
          setThemeDlg(null);
          setDeck(applyTheme(doc, t));
        }}
        onClose={() => setThemeDlg(null)}
      />
      <PageSetupDialog
        open={pageSetupOpen}
        size={deckSize(doc)}
        onApply={(size, mode) => {
          setPageSetupOpen(false);
          setDeck(resizeDeck(doc, size, mode));
        }}
        onClose={() => setPageSetupOpen(false)}
      />
      <BackgroundDialog
        open={bgOpen}
        slide={slide}
        theme={themeOf(doc)}
        onApply={applyBackground}
        onPickImage={pickBackgroundImage}
        onClose={() => setBgOpen(false)}
      />
      <HeaderFooterDialog
        open={hfOpen}
        hf={doc.hf}
        slideHf={hfFlags(doc, cur)}
        onApply={applyHeaderFooter}
        onClose={() => setHfOpen(false)}
      />
      <HyperlinkDialog
        open={!!linkDlg}
        init={linkDlg?.init ?? null}
        slides={slides}
        onApply={applyLink}
        onRemove={removeLink}
        onClose={() => {
          const d = linkDlg;
          setLinkDlg(null);
          if (d?.target.kind === "range")
            setEditRequest({ id: d.target.id, sel: [d.target.from, d.target.to], nonce: Date.now() });
        }}
      />
      <FindReplacePanel
        open={findOpen}
        doc={doc}
        onClose={() => {
          setFindOpen(false);
          setFindHit(null);
        }}
        onGoto={gotoMatch}
        onReplace={replaceOneMatch}
        onReplaceAll={replaceAllMatches}
      />
      <SpecialCharsDialog open={charsOpen} onPick={pickChar} onClose={closeChars} />
      <TextOptionsDialog
        open={textOptsOpen}
        el={selectedEls.find((e) => e.type === "text")}
        onApply={applyTextOptions}
        onClose={() => setTextOptsOpen(false)}
      />
      {altFor && (
        <AltTextDialog
          initial={slide?.elements.find((e) => e.id === altFor[0])?.alt ?? ""}
          onClose={() => setAltFor(null)}
          onSave={(v) => {
            const ids = altFor;
            setAltFor(null);
            if (slide) upsertMany(slide.elements.filter((e) => ids.includes(e.id)).map((e) => setAlt(e, v)));
          }}
        />
      )}
      {splitOpen && selTable && (
        <SplitCellDialog
          open
          initial={(() => {
            const s0 = activeSel ?? one(0, 0);
            const sp = spanOf(selTable.table!, s0.r, s0.c);
            return sp.rs > 1 || sp.cs > 1 ? { rows: sp.rs, cols: sp.cs } : { rows: 1, cols: 2 };
          })()}
          onClose={() => setSplitOpen(false)}
          onSplit={(nr, nc) => {
            setSplitOpen(false);
            const s0 = activeSel ?? one(0, 0);
            if (!canSplit(selTable.table!, s0.r, s0.c, nr, nc)) {
              setImportMsg("That cell can't be split into that many rows and columns.");
              return;
            }
            tableOp((el) => splitCell(el, s0.r, s0.c, nr, nc), () => one(s0.r, s0.c));
          }}
        />
      )}
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        deckId={id}
      />
      <DeckVersionHistory
        open={historyOpen}
        docId={id}
        onClose={() => setHistoryOpen(false)}
        prepare={async () => {
          window.clearTimeout(saveTimer.current);
          if (docRef.current) await saveDeck(id, JSON.stringify(docRef.current));
        }}
        onRestored={() => {
          window.clearTimeout(saveTimer.current);
          broadcast(VERSION_RESTORED_MSG);
          window.location.reload();
        }}
      />
      <Snackbar
        open={importMsg !== null}
        onClose={() => setImportMsg(null)}
        autoHideDuration={importMsg?.startsWith("Importing") ? null : 8000}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        data-testid="pptx-import-status"
      >
        {importMsg}
      </Snackbar>
    </Box>
  );
}
