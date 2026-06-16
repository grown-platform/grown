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
  Modal,
  ModalDialog,
  Select,
  Option,
  Dropdown,
  Menu,
  MenuButton,
} from "@mui/joy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import ImageIcon from "@mui/icons-material/Image";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import HorizontalRuleIcon from "@mui/icons-material/HorizontalRule";
import ChangeHistoryIcon from "@mui/icons-material/ChangeHistory";
import CategoryIcon from "@mui/icons-material/Category";
import ArrowRightAltIcon from "@mui/icons-material/ArrowRightAlt";
import RoundedCornerIcon from "@mui/icons-material/RoundedCorner";
import InterestsIcon from "@mui/icons-material/Interests";
import SpeakerNotesIcon from "@mui/icons-material/SpeakerNotes";
import SpeakerNotesOffIcon from "@mui/icons-material/SpeakerNotesOff";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
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
} from "./api";
import {
  CANVAS_W,
  CANVAS_H,
  parseDeck,
  newElement,
  newSlide,
  uid,
  isShape,
  TRANSITIONS,
  ANIMATION_TYPES,
  type DeckDoc,
  type Slide,
  type SlideElement,
  type ElementType,
  type TransitionType,
  type AnimationType,
} from "./model";
import { SlideView, ELEMENT_ANIM_CSS } from "./SlideView";
import { SlideCanvas } from "./SlideCanvas";
import { SlideMenuBar, type SlideActions } from "./SlideMenuBar";
import { downloadDeck } from "./export";
import { ShareDialog } from "./ShareDialog";

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
  slideIdx: number;
  ts: number;
}

export function DeckEditor({ user }: { user: User }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState("Untitled presentation");
  const [doc, setDoc] = useState<DeckDoc | null>(null);
  const [cur, setCur] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);
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
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [animationsOpen, setAnimationsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [presenter, setPresenter] = useState(false); // presenter view (notes) during Present mode
  const clip = useRef<SlideElement | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const docRef = useRef<DeckDoc | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hist = useRef<{ past: string[]; future: string[]; t: number }>({
    past: [],
    future: [],
    t: 0,
  });
  const fileInput = useRef<HTMLInputElement | null>(null);

  const me = {
    userId: user.id,
    username: user.display_name || user.email,
    color: colorFor(user.id),
  };

  docRef.current = doc;
  const slides = doc?.slides ?? [];
  const slide: Slide | undefined = slides[cur];
  const selected: SlideElement | undefined = slide?.elements.find(
    (e) => e.id === selId,
  );

  // Load deck.
  useEffect(() => {
    let cancelled = false;
    getDeck(id)
      .then((d) => {
        if (cancelled) return;
        setTitle(d.title);
        setDoc(parseDeck(d.data));
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
      const w = el.clientWidth - 48;
      const h = el.clientHeight - 48;
      setCanvasW(Math.max(320, Math.min(w, h * (CANVAS_W / CANVAS_H))));
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

  const pushHistory = useCallback(() => {
    const now = Date.now();
    const h = hist.current;
    if (now - h.t > 400) {
      if (docRef.current) h.past.push(JSON.stringify(docRef.current));
      if (h.past.length > 50) h.past.shift();
      h.future = [];
      h.t = now;
    }
  }, []);

  // ---- local mutations (update state + broadcast op + autosave) ----
  const applyToSlide = useCallback(
    (slideId: string, fn: (s: Slide) => Slide) => {
      setDoc((d) =>
        d ? { slides: d.slides.map((s) => (s.id === slideId ? fn(s) : s)) } : d,
      );
    },
    [],
  );

  const upsertElement = useCallback(
    (el: SlideElement, opts?: { history?: boolean }) => {
      if (!slide) return;
      if (opts?.history !== false) pushHistory();
      applyToSlide(slide.id, (s) => {
        const exists = s.elements.some((e) => e.id === el.id);
        return {
          ...s,
          elements: exists
            ? s.elements.map((e) => (e.id === el.id ? el : e))
            : [...s.elements, el],
        };
      });
      broadcast({ t: "upsert", si: slide.id, el });
      scheduleSave();
    },
    [slide, applyToSlide, broadcast, scheduleSave, pushHistory],
  );

  const removeElement = useCallback(
    (elId: string) => {
      if (!slide) return;
      pushHistory();
      applyToSlide(slide.id, (s) => ({
        ...s,
        elements: s.elements.filter((e) => e.id !== elId),
      }));
      broadcast({ t: "remove", si: slide.id, elId });
      scheduleSave();
      setSelId((c) => (c === elId ? null : c));
    },
    [slide, applyToSlide, broadcast, scheduleSave, pushHistory],
  );

  const setSlides = useCallback(
    (next: Slide[], opts?: { history?: boolean }) => {
      if (opts?.history !== false) pushHistory();
      setDoc({ slides: next });
      broadcast({ t: "slides", slides: next });
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
        slides?: Slide[];
        p?: Peer;
      };
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === "upsert" && m.si && m.el) {
        setDoc((d) =>
          d
            ? {
                slides: d.slides.map((s) =>
                  s.id === m.si
                    ? {
                        ...s,
                        elements: s.elements.some((e) => e.id === m.el!.id)
                          ? s.elements.map((e) =>
                              e.id === m.el!.id ? m.el! : e,
                            )
                          : [...s.elements, m.el!],
                      }
                    : s,
                ),
              }
            : d,
        );
      } else if (m.t === "remove" && m.si && m.elId) {
        setDoc((d) =>
          d
            ? {
                slides: d.slides.map((s) =>
                  s.id === m.si
                    ? {
                        ...s,
                        elements: s.elements.filter((e) => e.id !== m.elId),
                      }
                    : s,
                ),
              }
            : d,
        );
      } else if (m.t === "slides" && m.slides) {
        setDoc({ slides: m.slides });
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
      setPeers((cur) => {
        const now = Date.now();
        const next: Record<string, Peer> = {};
        for (const [k, p] of Object.entries(cur))
          if (now - p.ts < 12000) next[k] = p;
        return next;
      });
    }, 2000);
    return () => {
      window.clearInterval(hb);
      window.clearInterval(prune);
    };
  }, [broadcast, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (present) {
        // Present-mode navigation is handled inside PresentView itself (to respect
        // the animation step state). Only Escape is handled here so we can exit.
        if (e.key === "Escape") setPresent(false);
        return;
      }
      if (editingText) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return;
      if ((e.key === "Delete" || e.key === "Backspace") && selId) {
        e.preventDefault();
        removeElement(selId);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
        e.preventDefault();
        doNewSlide();
      }
      if (
        selected &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 2;
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
        upsertElement({ ...selected, x: selected.x + dx, y: selected.y + dy });
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
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) {
            e.preventDefault();
            const r = new FileReader();
            r.onload = () => {
              const el = newElement("image", String(r.result));
              upsertElement(el);
              setSelId(el.id);
            };
            r.readAsDataURL(file);
          }
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }); // re-bind each render so upsertElement closes over the current slide

  // ---- slide ops ----
  function doNewSlide() {
    const s = newSlide(slide?.background || "#ffffff");
    const next = [...slides.slice(0, cur + 1), s, ...slides.slice(cur + 1)];
    setSlides(next);
    setCur(cur + 1);
    setSelId(null);
  }
  function duplicateSlide() {
    if (!slide) return;
    const copy: Slide = {
      id: uid(),
      background: slide.background,
      elements: slide.elements.map((e) => ({ ...e, id: uid() })),
    };
    const next = [...slides.slice(0, cur + 1), copy, ...slides.slice(cur + 1)];
    setSlides(next);
    setCur(cur + 1);
    setSelId(null);
  }
  function deleteSlide() {
    if (slides.length <= 1) {
      setSlides([newSlide()]);
      setCur(0);
      return;
    }
    const next = slides.filter((_, i) => i !== cur);
    setSlides(next);
    setCur(Math.max(0, cur - 1));
    setSelId(null);
  }
  function moveSlide(from: number, to: number) {
    if (to < 0 || to >= slides.length) return;
    const next = [...slides];
    const [s] = next.splice(from, 1);
    next.splice(to, 0, s);
    setSlides(next);
    setCur(to);
  }

  // ---- insert / format / arrange ----
  function insert(type: ElementType) {
    const el = newElement(type);
    upsertElement(el);
    setSelId(el.id);
  }
  function insertImageFile() {
    fileInput.current?.click();
  }
  function onImagePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const el = newElement("image", String(r.result));
      upsertElement(el);
      setSelId(el.id);
    };
    r.readAsDataURL(f);
  }
  function toggle(attr: "bold" | "italic" | "underline") {
    if (selected) upsertElement({ ...selected, [attr]: !selected[attr] });
  }
  function setAlign(a: "left" | "center" | "right") {
    if (selected) upsertElement({ ...selected, align: a });
  }
  function setField<K extends keyof SlideElement>(k: K, v: SlideElement[K]) {
    if (selected) upsertElement({ ...selected, [k]: v });
  }
  function arrange(dir: "front" | "back" | "forward" | "backward") {
    if (!slide || !selected) return;
    const els = [...slide.elements];
    const i = els.findIndex((e) => e.id === selected.id);
    if (i < 0) return;
    const [e] = els.splice(i, 1);
    if (dir === "front") els.push(e);
    else if (dir === "back") els.unshift(e);
    else if (dir === "forward") els.splice(Math.min(els.length, i + 1), 0, e);
    else els.splice(Math.max(0, i - 1), 0, e);
    pushHistory();
    applyToSlide(slide.id, (s) => ({ ...s, elements: els }));
    broadcast({
      t: "slides",
      slides: slides.map((s) =>
        s.id === slide.id ? { ...s, elements: els } : s,
      ),
    });
    scheduleSave();
  }
  function rotate(op: "cw" | "ccw" | "flipH" | "flipV") {
    if (!selected) return;
    if (op === "flipH") {
      upsertElement({ ...selected, flipH: !selected.flipH });
      return;
    }
    if (op === "flipV") {
      upsertElement({ ...selected, flipV: !selected.flipV });
      return;
    }
    const delta = op === "cw" ? 90 : -90;
    const rot = (((selected.rotation || 0) + delta) % 360 + 360) % 360;
    upsertElement({ ...selected, rotation: rot });
  }
  function setLink() {
    if (!selected) return;
    const url = window.prompt("Link URL (blank to remove)", selected.url || "");
    if (url === null) return;
    const v = url.trim();
    upsertElement({ ...selected, url: v || undefined });
  }
  function setBackground() {
    if (!slide) return;
    const c =
      window.prompt("Slide background color (hex)", slide.background) ||
      slide.background;
    setSlides(
      slides.map((s) => (s.id === slide.id ? { ...s, background: c } : s)),
    );
  }

  // Speaker notes for the current slide. Debounced through the normal save path;
  // history is skipped so each keystroke doesn't flood the undo stack.
  function setNotes(text: string) {
    if (!slide) return;
    setSlides(
      slides.map((s) => (s.id === slide.id ? { ...s, notes: text } : s)),
      { history: false },
    );
  }
  function setTransition(t: TransitionType) {
    if (!slide) return;
    setSlides(
      slides.map((s) => (s.id === slide.id ? { ...s, transition: t } : s)),
    );
  }

  // Element clipboard (in-app) for the right-click menu.
  function duplicateEl(el: SlideElement) {
    const copy: SlideElement = { ...el, id: uid(), x: el.x + 16, y: el.y + 16 };
    upsertElement(copy);
    setSelId(copy.id);
  }
  function pasteEl() {
    if (!clip.current) return;
    const copy: SlideElement = {
      ...clip.current,
      id: uid(),
      x: clip.current.x + 16,
      y: clip.current.y + 16,
    };
    upsertElement(copy);
    setSelId(copy.id);
  }

  function undo() {
    const h = hist.current;
    if (!h.past.length || !docRef.current) return;
    h.future.push(JSON.stringify(docRef.current));
    const prev = h.past.pop()!;
    const d = JSON.parse(prev) as DeckDoc;
    setDoc(d);
    broadcast({ t: "slides", slides: d.slides });
    scheduleSave();
    setCur((c) => Math.min(c, d.slides.length - 1));
  }
  function redo() {
    const h = hist.current;
    if (!h.future.length || !docRef.current) return;
    h.past.push(JSON.stringify(docRef.current));
    const nx = h.future.pop()!;
    const d = JSON.parse(nx) as DeckDoc;
    setDoc(d);
    broadcast({ t: "slides", slides: d.slides });
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
    newSlide: doNewSlide,
    duplicateSlide,
    deleteSlide,
    present: () => {
      setPresenter(false);
      setPresent(true);
    },
    toggle,
    setAlign,
    arrange,
    rotate,
    setLink,
    deleteSelected: () => selId && removeElement(selId),
    setBackground,
    paste: pasteEl,
    duplicateSelected: () => {
      if (selected) duplicateEl(selected);
    },
    openTransition: () => setTransitionOpen(true),
    openAnimations: () => setAnimationsOpen(true),
    toggleNotes: () => setShowNotes((v) => !v),
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
    return (
      <PresentView
        slides={slides}
        cur={cur}
        presenter={presenter}
        onAdvance={() => setCur((c) => Math.min(slides.length - 1, c + 1))}
        onPrev={() => setCur((c) => Math.max(0, c - 1))}
        onTogglePresenter={() => setPresenter((v) => !v)}
        onExit={() => setPresent(false)}
      />
    );
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
            onClick={() => {
              setPresenter(false);
              setPresent(true);
            }}
          >
            Present
          </Button>
        </Box>
        {/* toolbar */}
        <Box
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
          {/* More shapes */}
          <Dropdown>
            <Tooltip title="More shapes">
              <MenuButton
                slots={{ root: IconButton }}
                slotProps={{
                  root: {
                    size: "sm",
                    variant: "plain",
                    "aria-label": "More shapes",
                  },
                }}
              >
                <InterestsIcon />
              </MenuButton>
            </Tooltip>
            <Menu size="sm" placement="bottom-start">
              <MenuItem onClick={() => insert("roundRect")}>
                <RoundedCornerIcon sx={{ mr: 1 }} />
                Rounded rectangle
              </MenuItem>
              <MenuItem onClick={() => insert("triangle")}>
                <ChangeHistoryIcon sx={{ mr: 1 }} />
                Triangle
              </MenuItem>
              <MenuItem onClick={() => insert("diamond")}>
                <CategoryIcon sx={{ mr: 1 }} />
                Diamond
              </MenuItem>
              <MenuItem onClick={() => insert("rightArrow")}>
                <ArrowRightAltIcon sx={{ mr: 1 }} />
                Right arrow
              </MenuItem>
            </Menu>
          </Dropdown>
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
          {selected?.type === "text" && (
            <input
              type="number"
              min={6}
              max={200}
              value={selected.fontSize || 18}
              onChange={(e) => setField("fontSize", Number(e.target.value))}
              style={{ width: 56, marginLeft: 6 }}
              title="Font size"
            />
          )}
          {selected && selected.type === "text" && (
            <input
              type="color"
              value={selected.color || "#202124"}
              onChange={(e) => setField("color", e.target.value)}
              title="Text color"
              style={{ marginLeft: 4 }}
            />
          )}
          {selected && isShape(selected.type) && (
            <input
              type="color"
              value={selected.fill || "#4285f4"}
              onChange={(e) => setField("fill", e.target.value)}
              title="Fill color"
              style={{ marginLeft: 4 }}
            />
          )}
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
                  <SlideView slide={s} width={140} />
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
          <Button
            size="sm"
            variant="soft"
            startDecorator={<AddIcon />}
            onClick={doNewSlide}
            sx={{ width: "100%", mt: 0.5 }}
          >
            New slide
          </Button>
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
                selectedId={selId}
                onSelect={setSelId}
                onChange={(el) => upsertElement(el)}
                onEditingText={setEditingText}
                onContext={(x, y, elId) => setCtxMenu({ x, y, elId })}
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
                  return (
                    <>
                      <MenuItem
                        onClick={close(() => {
                          if (el) {
                            clip.current = { ...el };
                            removeElement(el.id);
                          }
                        })}
                      >
                        Cut
                      </MenuItem>
                      <MenuItem
                        onClick={close(() => {
                          if (el) clip.current = { ...el };
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
                      <MenuItem
                        onClick={close(() => {
                          if (el) duplicateEl(el);
                        })}
                      >
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
                        color="danger"
                        onClick={close(() => {
                          if (el) removeElement(el.id);
                        })}
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

      {/* Slide transition picker */}
      <Modal open={transitionOpen} onClose={() => setTransitionOpen(false)}>
        <ModalDialog sx={{ minWidth: 320 }}>
          <Typography level="title-md">Transition</Typography>
          <Typography level="body-sm" sx={{ mb: 1, opacity: 0.7 }}>
            Played when this slide appears during a slideshow.
          </Typography>
          <Select
            value={slide?.transition || "none"}
            onChange={(_, v) => v && setTransition(v as TransitionType)}
            slotProps={{ button: { "aria-label": "Slide transition" } }}
          >
            {TRANSITIONS.map((t) => (
              <Option key={t.type} value={t.type}>
                {t.label}
              </Option>
            ))}
          </Select>
          <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2 }}>
            <Button size="sm" onClick={() => setTransitionOpen(false)}>
              Done
            </Button>
          </Box>
        </ModalDialog>
      </Modal>
      {/* Animations pane */}
      <Modal open={animationsOpen} onClose={() => setAnimationsOpen(false)}>
        <ModalDialog
          sx={{ minWidth: 360, maxHeight: "80vh", overflow: "auto" }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <AutoAwesomeIcon sx={{ fontSize: 20, opacity: 0.7 }} />
            <Typography level="title-md">Animations</Typography>
          </Box>
          <Typography level="body-sm" sx={{ mb: 1.5, opacity: 0.7 }}>
            Assign entrance animations to elements on slide {cur + 1}. In
            present mode, click to play each animation step before advancing to
            the next slide.
          </Typography>
          {slide && slide.elements.length === 0 && (
            <Typography level="body-sm" sx={{ opacity: 0.5 }}>
              No elements on this slide yet.
            </Typography>
          )}
          {slide &&
            slide.elements.map((el, idx) => {
              const anim = el.animation;
              const label =
                el.type === "text" ? el.text?.slice(0, 24) || "Text" : el.type;
              return (
                <Box
                  key={el.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 0.75,
                    flexWrap: "wrap",
                  }}
                >
                  <Typography
                    level="body-sm"
                    sx={{ minWidth: 90, fontFamily: "monospace" }}
                  >
                    {String(idx + 1).padStart(2, "0")} {label}
                  </Typography>
                  <Select
                    size="sm"
                    placeholder="No animation"
                    value={anim?.type ?? ""}
                    onChange={(_, v) => {
                      if (!v) {
                        // remove animation
                        const { animation: _removed, ...rest } = el;
                        void _removed;
                        upsertElement(rest as SlideElement);
                      } else {
                        upsertElement({
                          ...el,
                          animation: {
                            type: v as AnimationType,
                            order: anim?.order ?? idx + 1,
                          },
                        });
                      }
                    }}
                    sx={{ minWidth: 160 }}
                    slotProps={{
                      button: {
                        "aria-label": `Animation for element ${idx + 1}`,
                      },
                    }}
                  >
                    <Option value="">No animation</Option>
                    {ANIMATION_TYPES.map((a) => (
                      <Option key={a.type} value={a.type}>
                        {a.label}
                      </Option>
                    ))}
                  </Select>
                  {anim && (
                    <>
                      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                        Order
                      </Typography>
                      <input
                        type="number"
                        min={1}
                        max={slide.elements.length}
                        value={anim.order}
                        onChange={(e) =>
                          upsertElement({
                            ...el,
                            animation: {
                              ...anim,
                              order: Number(e.target.value),
                            },
                          })
                        }
                        style={{ width: 48 }}
                        aria-label={`Animation order for element ${idx + 1}`}
                      />
                    </>
                  )}
                </Box>
              );
            })}
          <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2 }}>
            <Button size="sm" onClick={() => setAnimationsOpen(false)}>
              Done
            </Button>
          </Box>
        </ModalDialog>
      </Modal>
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        deckId={id}
      />
    </Box>
  );
}

// ---- Present mode ----

// Keyframes for slide transitions, injected once. Each plays as the incoming
// slide mounts (we re-key the slide wrapper on slide change so it remounts).
const TRANSITION_CSS = `
@keyframes slidesFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes slidesFromRight { from { transform: translateX(6%); opacity: 0.4; } to { transform: translateX(0); opacity: 1; } }
@keyframes slidesFromLeft { from { transform: translateX(-6%); opacity: 0.4; } to { transform: translateX(0); opacity: 1; } }
@keyframes slidesFromBottom { from { transform: translateY(6%); opacity: 0.4; } to { transform: translateY(0); opacity: 1; } }
`;

function transitionAnimation(t?: TransitionType): string | undefined {
  switch (t) {
    case "fade":
      return "slidesFade 350ms ease";
    case "slide-left":
      return "slidesFromRight 350ms ease";
    case "slide-right":
      return "slidesFromLeft 350ms ease";
    case "slide-up":
      return "slidesFromBottom 350ms ease";
    default:
      return undefined;
  }
}

interface PresentViewProps {
  slides: Slide[];
  cur: number;
  presenter: boolean;
  onAdvance: () => void;
  onPrev: () => void;
  onTogglePresenter: () => void;
  onExit: () => void;
}

function PresentView({
  slides,
  cur,
  presenter,
  onAdvance,
  onPrev,
  onTogglePresenter,
  onExit,
}: PresentViewProps) {
  const slide = slides[cur];
  const next = slides[cur + 1];
  const [now, setNow] = useState(Date.now());
  const startRef = useRef(Date.now());

  // --- Element animation step state ---
  // animatedSteps: sorted unique "order" values for elements that have animations on
  // the current slide. animStep tracks how many steps have been revealed (0 = none).
  const animatedSteps: number[] = [];
  if (slide) {
    const orders = new Set<number>();
    for (const el of slide.elements) {
      if (el.animation) orders.add(el.animation.order);
    }
    animatedSteps.push(...Array.from(orders).sort((a, b) => a - b));
  }

  // Reset step count whenever the slide changes.
  const [animStep, setAnimStep] = useState(0);
  useEffect(() => {
    setAnimStep(0);
  }, [cur]);

  // revealedIds: all element IDs whose animation order <= animatedSteps[animStep-1]
  const revealedIds = new Set<string>();
  if (slide) {
    const maxOrder = animStep > 0 ? animatedSteps[animStep - 1] : -Infinity;
    for (const el of slide.elements) {
      if (!el.animation || el.animation.order <= maxOrder) {
        revealedIds.add(el.id);
      }
    }
  }

  // handleAdvance: play next animation step if any remain, otherwise advance slide.
  function handleAdvance() {
    if (animStep < animatedSteps.length) {
      setAnimStep((s) => s + 1);
    } else {
      onAdvance();
    }
  }

  // Keyboard navigation in present mode (arrow keys, space, S, Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        handleAdvance();
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        onPrev();
      }
      if (e.key.toLowerCase() === "s") onTogglePresenter();
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // re-bind each render to capture latest closures (same pattern as DeckEditor)

  // Elapsed timer for the presenter view.
  useEffect(() => {
    if (!presenter) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [presenter]);

  const elapsed = Math.floor((now - startRef.current) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  // The transition belongs to the incoming slide; keying on cur remounts it.
  const anim = transitionAnimation(slide?.transition);

  // Whether there are more animation steps to play before advancing.
  const hasMoreSteps = animStep < animatedSteps.length;

  if (!slide) return null;

  if (presenter) {
    const mainW = Math.min(
      window.innerWidth * 0.6,
      window.innerHeight * 0.7 * (CANVAS_W / CANVAS_H),
    );
    const nextW = Math.min(window.innerWidth * 0.3, 360);
    return (
      <Box
        sx={{
          position: "fixed",
          inset: 0,
          bgcolor: "#202124",
          color: "#fff",
          zIndex: 1300,
          display: "flex",
          flexDirection: "column",
          p: 3,
          gap: 2,
        }}
      >
        <style>{TRANSITION_CSS + ELEMENT_ANIM_CSS}</style>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Typography level="title-lg" sx={{ color: "#fff" }}>
            Presenter view
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Chip variant="soft" color="neutral">
            {mm}:{ss}
          </Chip>
          <Chip variant="soft" color="neutral">
            Slide {cur + 1} / {slides.length}
          </Chip>
          {hasMoreSteps && (
            <Chip variant="soft" color="warning">
              Step {animStep + 1} / {animatedSteps.length}
            </Chip>
          )}
          <Button
            size="sm"
            variant="outlined"
            color="neutral"
            onClick={onTogglePresenter}
          >
            Hide notes (S)
          </Button>
          <Button size="sm" variant="outlined" color="danger" onClick={onExit}>
            End (Esc)
          </Button>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 3 }}>
          {/* Current slide */}
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              alignItems: "center",
            }}
          >
            <Box sx={{ boxShadow: "lg" }}>
              <Box key={slide.id} sx={{ animation: anim, lineHeight: 0 }}>
                <SlideView
                  slide={slide}
                  width={mainW}
                  linkable
                  revealedIds={
                    animatedSteps.length > 0 ? revealedIds : undefined
                  }
                />
              </Box>
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                size="sm"
                variant="soft"
                color="neutral"
                onClick={onPrev}
                disabled={cur === 0}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="solid"
                onClick={handleAdvance}
                disabled={!hasMoreSteps && cur >= slides.length - 1}
              >
                {hasMoreSteps ? "Next step" : "Next"}
              </Button>
            </Box>
          </Box>
          {/* Notes + next-slide preview */}
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <Box>
              <Typography level="body-xs" sx={{ color: "#9aa0a6", mb: 0.5 }}>
                Up next
              </Typography>
              {next ? (
                <Box
                  sx={{
                    boxShadow: "md",
                    display: "inline-block",
                    lineHeight: 0,
                  }}
                >
                  <SlideView slide={next} width={nextW} />
                </Box>
              ) : (
                <Typography level="body-sm" sx={{ color: "#9aa0a6" }}>
                  End of presentation
                </Typography>
              )}
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <Typography level="body-xs" sx={{ color: "#9aa0a6", mb: 0.5 }}>
                Speaker notes
              </Typography>
              <Typography
                level="body-lg"
                sx={{ color: "#e8eaed", whiteSpace: "pre-wrap" }}
              >
                {slide.notes?.trim() || "No notes for this slide."}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  const pw = Math.min(
    window.innerWidth,
    window.innerHeight * (CANVAS_W / CANVAS_H),
  );
  return (
    <Box
      onClick={handleAdvance}
      sx={{
        position: "fixed",
        inset: 0,
        bgcolor: "#000",
        zIndex: 1300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      <style>{TRANSITION_CSS + ELEMENT_ANIM_CSS}</style>
      <Box key={slide.id} sx={{ animation: anim, lineHeight: 0 }}>
        <SlideView
          slide={slide}
          width={pw}
          revealedIds={animatedSteps.length > 0 ? revealedIds : undefined}
        />
      </Box>
      {hasMoreSteps && (
        <Chip
          size="sm"
          variant="soft"
          color="warning"
          sx={{
            position: "fixed",
            bottom: 48,
            right: 16,
            pointerEvents: "none",
          }}
        >
          Animation {animStep + 1} / {animatedSteps.length}
        </Chip>
      )}
      <Chip
        size="sm"
        variant="soft"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePresenter();
        }}
        sx={{ position: "fixed", bottom: 16, left: 16, cursor: "pointer" }}
      >
        Presenter view (S)
      </Chip>
      <Chip
        size="sm"
        variant="soft"
        sx={{ position: "fixed", bottom: 16, right: 16 }}
      >
        {cur + 1} / {slides.length} · Esc to exit
      </Chip>
    </Box>
  );
}
