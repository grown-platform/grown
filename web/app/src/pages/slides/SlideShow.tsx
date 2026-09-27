// The slideshow (M8/M9): transitions between slides, element animations,
// keyboard/click navigation, auto-advance, loop, black/white screen, laser
// pointer and pen ink, and the presenter view — in a separate window synced
// over a BroadcastChannel, or in this window when pop-ups are blocked.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Button, Chip, IconButton, Tooltip, Typography } from "@mui/joy";
import { CANVAS_H, CANVAS_W, setCanvasSize, type Slide } from "./model";
import { SlideView, type SlideFx } from "./SlideView";
import { ANIM_CSS, buildTimeline, framesAt, frameStyle, type Timeline } from "./animOps";
import { TRANSITION_CSS, morphPairs, morphStyle, slideTransition, transitionFx } from "./transitions";
import {
  autoAdvanceDelay,
  clickAdvances,
  formatElapsed,
  initialPresent,
  isShowMessage,
  presentReduce,
  showChannel,
  stepsOf,
  type PresentAction,
  type PresentState,
  type ShowMessage,
} from "./presentOps";
import { presentKeyAction, presentKeyPreventsDefault } from "./keymap";
import { resolveSlideLink } from "./links";
import { fitPresentWidth } from "./geometry";

const SHOW_CSS = TRANSITION_CSS + ANIM_CSS;

/** fxFor builds the SlideView styling for a slide at a step. */
function fxFor(
  slide: Slide | undefined,
  t: Timeline,
  step: number,
  animate: boolean,
  pending = false,
): Map<string, SlideFx> {
  const out = new Map<string, SlideFx>();
  if (!slide) return out;
  const frames = framesAt(slide, t, step, animate, { w: CANVAS_W, h: CANVAS_H }, pending);
  for (const [k, f] of frames) {
    const style = frameStyle(f);
    if (style && Object.keys(style).length)
      out.set(k, { style: style as React.CSSProperties, ...(f.animation ? { key: `:${f.nonce ?? 0}` } : {}) });
  }
  return out;
}

interface Transit {
  from: Slide;
  fromFx: Map<string, SlideFx>;
  n: number;
}

export interface SlideShowProps {
  deckId: string;
  /** The slides to show (hidden ones already removed, footers drawn in). */
  slides: Slide[];
  start: number;
  loop?: boolean;
  /** Open the presenter window as the show starts. */
  presenterWindow?: boolean;
  /** Leave the show; `at` is the shown-slide index it ended on. */
  onExit: (at: number) => void;
}

/** SlideShow is the audience view and owns the show state. */
export function SlideShow({ deckId, slides, start, loop, presenterWindow, onExit }: SlideShowProps) {
  const steps = useMemo(() => stepsOf(slides), [slides]);
  const [state, dispatch] = useReducer(
    (s: PresentState, a: PresentAction) => presentReduce(s, a, steps, { loop }),
    start,
    initialPresent,
  );
  const [inPagePresenter, setInPagePresenter] = useState(false);
  const [tool, setTool] = useState<"none" | "laser" | "pen">("none");
  const [ink, setInk] = useState<Record<string, [number, number][][]>>({});
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const [startedAt] = useState(() => Date.now());
  const [transit, setTransit] = useState<Transit | null>(null);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const chan = useRef<BroadcastChannel | null>(null);
  const popup = useRef<Window | null>(null);
  const slideStart = useRef(Date.now());
  const stepStart = useRef(Date.now());
  const prevState = useRef<PresentState>(state);

  const slide = slides[state.cur];
  const timeline = useMemo(() => buildTimeline(slide), [slide]);

  useEffect(() => {
    const r = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  // Slide changes: start a transition when moving forward by "next".
  useEffect(() => {
    const p = prevState.current;
    prevState.current = state;
    if (p.cur !== state.cur) {
      slideStart.current = Date.now();
      const forward = state.animate && (state.cur === p.cur + 1 || (state.cur === 0 && p.cur === slides.length - 1));
      const from = slides[p.cur];
      if (forward && transitionFx(slide).total > 0 && from)
        setTransit((t) => ({ from, fromFx: fxFor(from, buildTimeline(from), p.step, false), n: (t?.n ?? 0) + 1 }));
      else setTransit(null);
    }
    if (p.step !== state.step || p.cur !== state.cur) stepStart.current = Date.now();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop the old slide's layer when the transition is over.
  const transitN = transit?.n;
  useEffect(() => {
    if (transitN === undefined) return;
    const t = window.setTimeout(() => {
      setTransit(null);
      stepStart.current = Date.now();
    }, transitionFx(slide).total);
    return () => window.clearTimeout(t);
  }, [transitN]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance ("after N seconds"), never before the playing step ends.
  useEffect(() => {
    if (state.ended || state.blank || transit || !state.animate) return;
    const d = autoAdvanceDelay(slide, timeline, state.step, Date.now() - slideStart.current, Date.now() - stepStart.current);
    if (d === null) return;
    const t = window.setTimeout(() => dispatch("next"), d);
    return () => window.clearTimeout(t);
  }, [state, transit, slide, timeline]);

  useEffect(() => {
    if (state.exited) finish();
  }, [state.exited]); // eslint-disable-line react-hooks/exhaustive-deps

  // Presenter window sync.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(showChannel(deckId));
    chan.current = c;
    c.onmessage = (ev: MessageEvent) => {
      const m: unknown = ev.data;
      if (!isShowMessage(m)) return;
      if (m.t === "hello") {
        post({ t: "slides", slides, h: CANVAS_H });
        post({ t: "state", state: prevState.current, startedAt });
      } else if (m.t === "cmd") dispatch(m.action);
      else if (m.t === "exit") finish();
    };
    return () => {
      c.close();
      chan.current = null;
    };
  }, [deckId, slides]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    post({ t: "state", state, startedAt });
  }, [state, startedAt]);

  function post(m: ShowMessage) {
    try {
      chan.current?.postMessage(m);
    } catch {
      /* channel closed */
    }
  }

  function finish() {
    post({ t: "end" });
    try {
      popup.current?.close();
    } catch {
      /* already closed */
    }
    onExit(state.cur);
  }

  function openPresenter() {
    const w = window.open(
      `/slides/d/${deckId}/presenter`,
      `grown-presenter-${deckId}`,
      "popup,width=1200,height=760",
    );
    if (!w) {
      setInPagePresenter(true); // pop-up blocked: single-window presenter view
      return;
    }
    popup.current = w;
  }

  useEffect(() => {
    if (presenterWindow) openPresenter();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = presentKeyAction(e);
      if (presentKeyPreventsDefault(a)) e.preventDefault();
      if (a === null) return;
      if (a === "exit") {
        if (tool !== "none") setTool("none");
        else finish();
      } else if (a === "togglePresenter") setInPagePresenter((v) => !v);
      else if (a === "laser") setTool((t) => (t === "laser" ? "none" : "laser"));
      else if (a === "pen") setTool((t) => (t === "pen" ? "none" : "pen"));
      else if (a === "erase") {
        if (slide) setInk((k) => ({ ...k, [slide.id]: [] }));
      } else dispatch(a);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onSlideLink = (url: string) => {
    const i = resolveSlideLink(url, slides, state.cur);
    if (i !== null) dispatch({ goto: i });
  };

  if (!slide) return null;

  const pending = !!transit;
  const fx = fxFor(slide, timeline, state.step, state.animate, pending);
  const tr = slideTransition(slide);
  let fromFx = transit?.fromFx;
  if (transit && tr.type === "morph") {
    fromFx = new Map(fromFx);
    for (const p of morphPairs(transit.from, slide)) {
      const e = slide.elements.find((x) => x.id === p.id)!;
      fx.set(p.id, { style: { ...(fx.get(p.id)?.style ?? {}), ...(morphStyle(e, p.from, tr.dur) as React.CSSProperties) }, key: `:m${transit.n}` });
      fromFx.set(p.fromId, { style: { opacity: 0 } });
    }
  }

  if (inPagePresenter) {
    return (
      <PresenterView
        slides={slides}
        state={state}
        startedAt={startedAt}
        onAction={dispatch}
        onExit={finish}
        onClose={() => setInPagePresenter(false)}
        onSlideLink={onSlideLink}
      />
    );
  }

  const pw = fitPresentWidth(view.w, view.h);
  const ph = pw * (CANVAS_H / CANVAS_W);
  const f = transit ? transitionFx(slide) : null;
  const strokes = ink[slide.id] ?? [];

  const toCanvas = (e: React.PointerEvent): [number, number] => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * CANVAS_W, ((e.clientY - r.top) / r.height) * CANVAS_H];
  };

  return (
    <Box
      data-testid="slideshow"
      data-slide={state.cur}
      data-step={state.step}
      onClick={() => {
        if (tool === "pen") return;
        if (state.ended || clickAdvances(slide)) dispatch("next");
      }}
      sx={{
        position: "fixed",
        inset: 0,
        bgcolor: "#000",
        zIndex: 1300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: tool === "laser" ? "none" : tool === "pen" ? "crosshair" : "pointer",
        overflow: "hidden",
        "&:hover .show-tools": { opacity: 1 },
      }}
    >
      <style>{SHOW_CSS}</style>
      <Box
        sx={{ position: "relative", width: pw, height: ph, overflow: "hidden" }}
        onPointerMove={(e) => {
          if (tool === "laser") {
            const [x, y] = toCanvas(e);
            setLaser({ x, y });
          }
          if (tool === "pen" && e.buttons === 1) {
            const pt = toCanvas(e);
            setInk((k) => {
              const cur = (k[slide.id] ?? []).slice();
              if (!cur.length) cur.push([]);
              cur[cur.length - 1] = [...cur[cur.length - 1], pt];
              return { ...k, [slide.id]: cur };
            });
          }
        }}
        onPointerDown={(e) => {
          if (tool !== "pen") return;
          e.stopPropagation();
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          const pt = toCanvas(e);
          setInk((k) => ({ ...k, [slide.id]: [...(k[slide.id] ?? []), [pt]] }));
        }}
        onPointerLeave={() => setLaser(null)}
      >
        {transit && f?.outgoing && (
          <Box
            key={`out${transit.n}`}
            sx={{ position: "absolute", inset: 0, lineHeight: 0, zIndex: f.outgoingOnTop ? 2 : 1, animation: f.outgoing }}
          >
            <SlideView slide={transit.from} width={pw} fx={fromFx} />
          </Box>
        )}
        <Box
          key={`in${transit?.n ?? 0}:${slide.id}`}
          data-testid="show-slide"
          sx={{ position: "absolute", inset: 0, lineHeight: 0, zIndex: 1, animation: f?.incoming }}
        >
          <SlideView slide={slide} width={pw} linkable fx={fx} onSlideLink={onSlideLink} />
        </Box>
        {strokes.length > 0 && (
          <svg
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 5, pointerEvents: "none" }}
          >
            {strokes.map((s, i) => (
              <polyline
                key={i}
                points={s.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke="#e53935"
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
        )}
        {tool === "laser" && laser && (
          <Box
            data-testid="laser"
            sx={{
              position: "absolute",
              left: `${(laser.x / CANVAS_W) * 100}%`,
              top: `${(laser.y / CANVAS_H) * 100}%`,
              width: 14,
              height: 14,
              ml: "-7px",
              mt: "-7px",
              borderRadius: "50%",
              bgcolor: "#ff1744",
              boxShadow: "0 0 10px 4px rgba(255,23,68,0.6)",
              zIndex: 6,
              pointerEvents: "none",
            }}
          />
        )}
      </Box>
      {state.blank && (
        <Box
          data-testid="show-blank"
          data-blank={state.blank}
          sx={{ position: "fixed", inset: 0, bgcolor: state.blank === "black" ? "#000" : "#fff", zIndex: 1310 }}
        />
      )}
      {state.ended && (
        <Box
          data-testid="show-ended"
          sx={{
            position: "fixed",
            inset: 0,
            bgcolor: "#000",
            zIndex: 1310,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            pt: 4,
          }}
        >
          <Typography sx={{ color: "#bdbdbd" }}>End of slide show, click to exit.</Typography>
        </Box>
      )}
      {state.digits && (
        <Chip size="lg" variant="solid" sx={{ position: "fixed", top: 16, right: 16, zIndex: 1320 }}>
          Go to slide {state.digits}
        </Chip>
      )}
      <Box
        className="show-tools"
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: "fixed",
          bottom: 12,
          left: 12,
          zIndex: 1320,
          display: "flex",
          gap: 0.5,
          opacity: 0.25,
          transition: "opacity 150ms",
          bgcolor: "rgba(32,33,36,0.85)",
          borderRadius: "md",
          p: 0.5,
        }}
      >
        <Tooltip title="Previous (P)">
          <IconButton size="sm" variant="plain" sx={{ color: "#fff" }} aria-label="Previous slide" onClick={() => dispatch("prev")}>
            ‹
          </IconButton>
        </Tooltip>
        <Tooltip title="Next (N)">
          <IconButton size="sm" variant="plain" sx={{ color: "#fff" }} aria-label="Next slide" onClick={() => dispatch("next")}>
            ›
          </IconButton>
        </Tooltip>
        <Tooltip title="Laser pointer (Ctrl+L)">
          <IconButton
            size="sm"
            variant={tool === "laser" ? "solid" : "plain"}
            sx={{ color: "#fff" }}
            aria-label="Laser pointer"
            aria-pressed={tool === "laser"}
            onClick={() => setTool((t) => (t === "laser" ? "none" : "laser"))}
          >
            ●
          </IconButton>
        </Tooltip>
        <Tooltip title="Pen (Ctrl+P); E erases">
          <IconButton
            size="sm"
            variant={tool === "pen" ? "solid" : "plain"}
            sx={{ color: "#fff" }}
            aria-label="Pen"
            aria-pressed={tool === "pen"}
            onClick={() => setTool((t) => (t === "pen" ? "none" : "pen"))}
          >
            ✎
          </IconButton>
        </Tooltip>
        <Button size="sm" variant="plain" sx={{ color: "#fff" }} onClick={openPresenter}>
          Presenter window
        </Button>
        <Button size="sm" variant="plain" sx={{ color: "#fff" }} onClick={() => setInPagePresenter(true)}>
          Presenter view (S)
        </Button>
      </Box>
      <Chip size="sm" variant="soft" sx={{ position: "fixed", bottom: 16, right: 16, zIndex: 1320 }}>
        {state.cur + 1} / {slides.length} · Esc to exit
      </Chip>
    </Box>
  );
}

// ------------------------------------------------------------ presenter view

export interface PresenterViewProps {
  slides: Slide[];
  state: PresentState;
  startedAt: number;
  onAction: (a: PresentAction) => void;
  onExit: () => void;
  /** Back to the audience view (single-window mode only). */
  onClose?: () => void;
  onSlideLink?: (url: string) => void;
}

/** PresenterView shows the current slide (at its current step), the next
 *  slide, the speaker notes, the elapsed timer, the clock and the slide
 *  counter. */
export function PresenterView({ slides, state, startedAt, onAction, onExit, onClose, onSlideLink }: PresenterViewProps) {
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    const r = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", r);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", r);
    };
  }, []);
  const slide = slides[state.cur];
  const next = slides[state.cur + 1];
  const steps = stepsOf(slides);
  const t = useMemo(() => buildTimeline(slide), [slide]);
  if (!slide) return null;
  const fx = fxFor(slide, t, state.step, false);
  const mainW = Math.max(240, Math.min(view.w * 0.58, (view.h - 170) * (CANVAS_W / CANVAS_H)));
  const nextW = Math.max(160, Math.min(view.w * 0.32, 400));
  const moreSteps = state.step < steps[state.cur];
  const clock = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <Box
      data-testid="presenter-view"
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
      <style>{SHOW_CSS}</style>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <Typography level="title-lg" sx={{ color: "#fff" }}>
          Presenter view
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Chip variant="soft" color="neutral" data-testid="presenter-timer">
          {formatElapsed(now - startedAt)}
        </Chip>
        <Chip variant="soft" color="neutral" data-testid="presenter-clock">
          {clock}
        </Chip>
        <Chip variant="soft" color="neutral" data-testid="presenter-counter">
          Slide {state.cur + 1} / {slides.length}
        </Chip>
        {steps[state.cur] > 0 && (
          <Chip variant="soft" color="warning">
            Step {state.step} / {steps[state.cur]}
          </Chip>
        )}
        {state.blank && (
          <Chip variant="soft" color="primary">
            {state.blank === "black" ? "Black screen" : "White screen"}
          </Chip>
        )}
        {onClose && (
          <Button size="sm" variant="outlined" color="neutral" onClick={onClose}>
            Hide notes (S)
          </Button>
        )}
        <Button size="sm" variant="outlined" color="danger" onClick={onExit}>
          End (Esc)
        </Button>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 3 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "center" }}>
          <Box sx={{ boxShadow: "lg", lineHeight: 0 }} data-testid="presenter-current">
            <SlideView slide={slide} width={mainW} linkable fx={fx} onSlideLink={onSlideLink} />
          </Box>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button size="sm" variant="soft" color="neutral" onClick={() => onAction("prev")} disabled={state.cur === 0 && state.step === 0}>
              Previous
            </Button>
            <Button size="sm" variant="solid" onClick={() => onAction("next")}>
              {moreSteps ? "Next step" : state.ended ? "Exit" : "Next"}
            </Button>
            <Button size="sm" variant="soft" color="neutral" onClick={() => onAction("black")}>
              Black (B)
            </Button>
          </Box>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <Box>
            <Typography level="body-xs" sx={{ color: "#9aa0a6", mb: 0.5 }}>
              Up next
            </Typography>
            {next ? (
              <Box sx={{ boxShadow: "md", display: "inline-block", lineHeight: 0 }} data-testid="presenter-next">
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
            <Typography level="body-lg" data-testid="presenter-notes" sx={{ color: "#e8eaed", whiteSpace: "pre-wrap" }}>
              {slide.notes?.trim() || "No notes for this slide."}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/** PresenterWindow is the `/slides/d/:id/presenter` page opened by the
 *  show: it asks the audience window for the slides and follows its state,
 *  sending navigation back over the BroadcastChannel. */
export function PresenterWindow({ deckId }: { deckId: string }) {
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [state, setState] = useState<PresentState>(initialPresent());
  const [startedAt, setStartedAt] = useState(Date.now());
  const [ended, setEnded] = useState(false);
  const chan = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    document.title = "Presenter view";
    if (typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(showChannel(deckId));
    chan.current = c;
    c.onmessage = (ev: MessageEvent) => {
      const m: unknown = ev.data;
      if (!isShowMessage(m)) return;
      if (m.t === "slides") {
        // The audience window sends its slide height (16:9, 4:3, …).
        if (m.h) setCanvasSize({ w: CANVAS_W, h: m.h });
        setSlides(m.slides);
      } else if (m.t === "state") {
        setState(m.state);
        setStartedAt(m.startedAt);
      } else if (m.t === "end") {
        setEnded(true);
        window.close();
      }
    };
    c.postMessage({ t: "hello" } satisfies ShowMessage);
    return () => c.close();
  }, [deckId]);
  const send = (m: ShowMessage) => chan.current?.postMessage(m);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = presentKeyAction(e);
      if (presentKeyPreventsDefault(a)) e.preventDefault();
      if (a === "exit") send({ t: "exit" });
      else if (a && (typeof a === "object" || ["next", "prev", "first", "last", "enter", "black", "white"].includes(a)))
        send({ t: "cmd", action: a as PresentAction });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (ended)
    return (
      <Box sx={{ p: 4 }}>
        <Typography>The slide show has ended.</Typography>
      </Box>
    );
  if (!slides)
    return (
      <Box sx={{ p: 4 }}>
        <Typography>Waiting for the slide show…</Typography>
      </Box>
    );
  return (
    <PresenterView
      slides={slides}
      state={state}
      startedAt={startedAt}
      onAction={(a) => send({ t: "cmd", action: a })}
      onExit={() => send({ t: "exit" })}
    />
  );
}

