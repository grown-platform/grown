// The Motion side panel (M8): the slide transition (type, option,
// duration, advance on click / after N s, apply to all, preview) and the
// animation pane (add entrance/emphasis/exit effects to the selection,
// reorder, edit start/duration/delay/direction, preview, remove).

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Dropdown,
  IconButton,
  Input,
  ListDivider,
  Menu,
  MenuButton,
  MenuItem,
  Option,
  Select,
  Tooltip,
  Typography,
} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { CANVAS_H, CANVAS_W, type AnimClass, type AnimEffect, type AnimKind, type AnimStart, type Slide, type SlideElement, type TransitionType } from "./model";
import { SlideView, type SlideFx } from "./SlideView";
import {
  ANIM_CATALOG,
  ANIM_CSS,
  CLASS_LABEL,
  DIR_LABEL,
  START_LABEL,
  addEffect,
  buildTimeline,
  effectDur,
  effectLabel,
  effectsOf,
  framesAt,
  frameStyle,
  groupEnd,
  kindDef,
  moveEffect,
  removeEffects,
  updateEffect,
} from "./animOps";
import { TRANSITION_CSS, TRANSITION_DEFS, slideTransition, transitionFx } from "./transitions";

const PREVIEW_W = 268;

/** A short label for an element in the pane ("Title 1: Hello", "Picture"). */
export function elementLabel(el: SlideElement | undefined): string {
  if (!el) return "(deleted)";
  const text = (el.type === "text" ? el.text : "")?.replace(/\s+/g, " ").trim();
  const kind =
    el.name ||
    (el.placeholder ? el.placeholder.type : el.type === "shape" ? (el.preset ?? "shape") : el.type).replace(/^\w/, (c) => c.toUpperCase());
  return text ? `${kind}: ${text.length > 24 ? `${text.slice(0, 24)}…` : text}` : kind;
}

export interface MotionPanelProps {
  slide: Slide;
  prevSlide?: Slide;
  selIds: string[];
  selEffect: string | null;
  onSelEffect: (id: string | null) => void;
  /** Replace the current slide. */
  onSlide: (s: Slide) => void;
  /** Transition settings onto every slide. */
  onApplyToAll: (patch: Pick<Slide, "transition" | "transitionDir" | "transitionDur" | "advanceOnClick" | "advanceAfter">) => void;
  /** Select an element on the canvas (clicking an effect). */
  onSelectElement: (id: string) => void;
  onClose: () => void;
}

type PreviewRun = { what: "transition" | "all" | "effect"; id?: string; n: number };

export function MotionPanel({
  slide,
  prevSlide,
  selIds,
  selEffect,
  onSelEffect,
  onSlide,
  onApplyToAll,
  onSelectElement,
  onClose,
}: MotionPanelProps) {
  const [run, setRun] = useState<PreviewRun | null>(null);
  const tr = slideTransition(slide);
  const def = TRANSITION_DEFS.find((d) => d.type === tr.type)!;
  const effects = effectsOf(slide);
  const sel = effects.find((e) => e.id === selEffect);
  const elOf = (id: string) => slide.elements.find((e) => e.id === id);
  const targets = selIds.filter((id) => slide.elements.some((e) => e.id === id));

  const setTrans = (patch: Partial<Slide>) => {
    const next: Slide = { ...slide, ...patch };
    for (const k of ["transitionDir", "transitionDur", "advanceAfter", "advanceOnClick"] as const)
      if (next[k] === undefined) delete next[k];
    onSlide(next);
  };

  const add = (cls: AnimClass, kind: AnimKind) => {
    const r = addEffect(slide, targets, cls, kind);
    onSlide(r.slide);
    onSelEffect(r.ids[0] ?? null);
    setRun((p) => ({ what: "effect", id: r.ids[0], n: (p?.n ?? 0) + 1 }));
  };

  let click = 0;
  return (
    <Box
      data-testid="motion-panel"
      sx={{
        width: 300,
        flexShrink: 0,
        borderLeft: "1px solid",
        borderColor: "divider",
        bgcolor: "background.body",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <style>{TRANSITION_CSS + ANIM_CSS}</style>
      <Box sx={{ display: "flex", alignItems: "center", px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography level="title-sm">Motion</Typography>
        <Box sx={{ flex: 1 }} />
        <IconButton size="sm" variant="plain" aria-label="Close motion panel" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>

      <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
        <MotionPreview slide={slide} prevSlide={prevSlide} run={run} />

        <Typography level="title-sm" sx={{ mt: 0.5 }}>
          Slide transition
        </Typography>
        <Select
          size="sm"
          value={tr.type}
          onChange={(_, v) => v && setTrans({ transition: v as TransitionType, transitionDir: undefined, transitionDur: undefined })}
          slotProps={{ button: { "aria-label": "Slide transition" } }}
        >
          {TRANSITION_DEFS.map((d) => (
            <Option key={d.type} value={d.type}>
              {d.label}
            </Option>
          ))}
        </Select>
        {def.options.length > 0 && (
          <Select
            size="sm"
            value={tr.dir}
            onChange={(_, v) => v && setTrans({ transition: tr.type, transitionDir: v })}
            slotProps={{ button: { "aria-label": "Transition option" } }}
          >
            {def.options.map((o) => (
              <Option key={o.value} value={o.value}>
                {o.label}
              </Option>
            ))}
          </Select>
        )}
        {tr.type !== "none" && tr.type !== "cut" && (
          <SecondsInput
            label="Duration (s)"
            aria="Transition duration"
            ms={tr.dur}
            onMs={(ms) => setTrans({ transition: tr.type, transitionDur: ms })}
          />
        )}
        <Typography level="body-xs" sx={{ fontWeight: 600, mt: 0.5 }}>
          Advance slide
        </Typography>
        <Checkbox
          size="sm"
          label="On mouse click"
          checked={slide.advanceOnClick !== false}
          onChange={(e) => setTrans({ advanceOnClick: e.target.checked ? undefined : false })}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Checkbox
            size="sm"
            label="After"
            checked={slide.advanceAfter !== undefined}
            onChange={(e) => setTrans({ advanceAfter: e.target.checked ? 5000 : undefined })}
            slotProps={{ input: { "aria-label": "Advance automatically" } }}
          />
          {slide.advanceAfter !== undefined && (
            <SecondsInput aria="Advance after seconds" ms={slide.advanceAfter} onMs={(ms) => setTrans({ advanceAfter: ms })} />
          )}
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            size="sm"
            variant="outlined"
            color="neutral"
            onClick={() =>
              onApplyToAll({
                transition: slide.transition,
                transitionDir: slide.transitionDir,
                transitionDur: slide.transitionDur,
                advanceOnClick: slide.advanceOnClick,
                advanceAfter: slide.advanceAfter,
              })
            }
          >
            Apply to all slides
          </Button>
          <Button
            size="sm"
            variant="soft"
            startDecorator={<PlayArrowIcon />}
            disabled={tr.type === "none" || tr.type === "cut"}
            onClick={() => setRun((p) => ({ what: "transition", n: (p?.n ?? 0) + 1 }))}
          >
            Preview
          </Button>
        </Box>

        <ListDivider sx={{ my: 1 }} />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography level="title-sm">Animations</Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            size="sm"
            variant="plain"
            startDecorator={<PlayArrowIcon />}
            disabled={!effects.length}
            onClick={() => setRun((p) => ({ what: "all", n: (p?.n ?? 0) + 1 }))}
          >
            Play
          </Button>
        </Box>
        <Dropdown>
          <MenuButton size="sm" variant="solid" color="primary" disabled={!targets.length}>
            {targets.length ? "Add animation" : "Select an object to animate"}
          </MenuButton>
          <Menu size="sm" placement="bottom-start" sx={{ maxHeight: 420, overflow: "auto", zIndex: 1400 }}>
            {(["entr", "emph", "exit"] as const).map((cls) => (
              <Box key={cls}>
                <Typography level="body-xs" sx={{ px: 1.5, pt: 0.75, opacity: 0.6, fontWeight: 600 }}>
                  {CLASS_LABEL[cls]}
                </Typography>
                {ANIM_CATALOG[cls].map((d) => (
                  <MenuItem key={d.kind} onClick={() => add(cls, d.kind)}>
                    {d.label}
                  </MenuItem>
                ))}
              </Box>
            ))}
          </Menu>
        </Dropdown>

        <Box role="listbox" aria-label="Animation pane" data-testid="anim-pane" sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {!effects.length && (
            <Typography level="body-xs" sx={{ opacity: 0.6 }}>
              No animations on this slide.
            </Typography>
          )}
          {effects.map((e, i) => {
            if (e.start === "click") click++;
            const on = e.id === selEffect;
            return (
              <Box
                key={e.id}
                role="option"
                aria-selected={on}
                data-testid="anim-effect"
                data-effect={e.id}
                onClick={() => {
                  onSelEffect(e.id);
                  onSelectElement(e.el);
                }}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  px: 0.75,
                  py: 0.5,
                  borderRadius: "sm",
                  cursor: "pointer",
                  border: "1px solid",
                  borderColor: on ? "primary.outlinedBorder" : "divider",
                  bgcolor: on ? "primary.softBg" : undefined,
                }}
              >
                <Typography level="body-xs" sx={{ width: 16, textAlign: "right", opacity: 0.7 }}>
                  {e.start === "click" ? click : ""}
                </Typography>
                <Box
                  sx={{
                    width: 6,
                    height: 20,
                    borderRadius: 2,
                    bgcolor: e.cls === "entr" ? "#43a047" : e.cls === "exit" ? "#e53935" : "#fbc02d",
                  }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography level="body-sm" noWrap>
                    {e.start === "after" ? "⏱ " : e.start === "with" ? "↳ " : ""}
                    {effectLabel(e)}
                  </Typography>
                  <Typography level="body-xs" noWrap sx={{ opacity: 0.6 }}>
                    {elementLabel(elOf(e.el))}
                  </Typography>
                </Box>
                <Tooltip title="Move earlier">
                  <span>
                    <IconButton
                      size="sm"
                      variant="plain"
                      aria-label="Move earlier"
                      disabled={i === 0}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onSlide(moveEffect(slide, e.id, -1));
                      }}
                    >
                      <ArrowUpwardIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Move later">
                  <span>
                    <IconButton
                      size="sm"
                      variant="plain"
                      aria-label="Move later"
                      disabled={i === effects.length - 1}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onSlide(moveEffect(slide, e.id, 1));
                      }}
                    >
                      <ArrowDownwardIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Remove">
                  <IconButton
                    size="sm"
                    variant="plain"
                    aria-label="Remove animation"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSlide(removeEffects(slide, [e.id]));
                      if (on) onSelEffect(null);
                    }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            );
          })}
        </Box>

        {sel && (
          <EffectEditor
            effect={sel}
            el={elOf(sel.el)}
            onChange={(patch) => onSlide(updateEffect(slide, sel.id, patch))}
            onPreview={() => setRun((p) => ({ what: "effect", id: sel.id, n: (p?.n ?? 0) + 1 }))}
          />
        )}
      </Box>
    </Box>
  );
}

function EffectEditor({
  effect,
  el,
  onChange,
  onPreview,
}: {
  effect: AnimEffect;
  el?: SlideElement;
  onChange: (p: Partial<Omit<AnimEffect, "id">>) => void;
  onPreview: () => void;
}) {
  const def = kindDef(effect.cls, effect.kind);
  return (
    <Box data-testid="anim-editor" sx={{ display: "flex", flexDirection: "column", gap: 0.75, mt: 1, p: 1, borderRadius: "sm", bgcolor: "background.level1" }}>
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Select
          size="sm"
          value={effect.cls}
          onChange={(_, v) => v && onChange({ cls: v as AnimClass, kind: ANIM_CATALOG[v as AnimClass][1]?.kind ?? "appear" })}
          slotProps={{ button: { "aria-label": "Effect type" } }}
          sx={{ flex: 1 }}
        >
          {(["entr", "emph", "exit"] as const).map((c) => (
            <Option key={c} value={c}>
              {CLASS_LABEL[c]}
            </Option>
          ))}
        </Select>
        <Select
          size="sm"
          value={effect.kind}
          onChange={(_, v) => v && onChange({ kind: v as AnimKind })}
          slotProps={{ button: { "aria-label": "Effect" } }}
          sx={{ flex: 1.3 }}
        >
          {ANIM_CATALOG[effect.cls].map((d) => (
            <Option key={d.kind} value={d.kind}>
              {d.label}
            </Option>
          ))}
        </Select>
      </Box>
      {def?.dirs && (
        <Select
          size="sm"
          value={effect.dir ?? "b"}
          onChange={(_, v) => v && onChange({ dir: v as AnimEffect["dir"] })}
          slotProps={{ button: { "aria-label": "Direction" } }}
        >
          {(["b", "l", "r", "t"] as const).map((d) => (
            <Option key={d} value={d}>
              {effect.cls === "exit" ? "To" : "From"} {DIR_LABEL[d].toLowerCase()}
            </Option>
          ))}
        </Select>
      )}
      <Select
        size="sm"
        value={effect.start}
        onChange={(_, v) => v && onChange({ start: v as AnimStart })}
        slotProps={{ button: { "aria-label": "Start" } }}
      >
        {(["click", "with", "after"] as const).map((s) => (
          <Option key={s} value={s}>
            {START_LABEL[s]}
          </Option>
        ))}
      </Select>
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <SecondsInput label="Duration (s)" aria="Animation duration" ms={effectDur(effect)} onMs={(ms) => onChange({ dur: ms })} />
        <SecondsInput label="Delay (s)" aria="Animation delay" ms={effect.delay ?? 0} onMs={(ms) => onChange({ delay: ms || undefined })} />
      </Box>
      {effect.kind === "grow" && (
        <Select
          size="sm"
          value={String(effect.scale ?? 1.5)}
          onChange={(_, v) => v && onChange({ scale: Number(v) })}
          slotProps={{ button: { "aria-label": "Size" } }}
        >
          {["0.25", "0.5", "1.1", "1.5", "2"].map((v) => (
            <Option key={v} value={v}>
              {Math.round(Number(v) * 100)} %
            </Option>
          ))}
        </Select>
      )}
      {effect.kind === "colorPulse" && (
        <Input
          size="sm"
          type="color"
          value={effect.color ?? "#ffb300"}
          onChange={(e) => onChange({ color: e.target.value })}
          slotProps={{ input: { "aria-label": "Pulse colour" } }}
        />
      )}
      {el?.type === "text" && (
        <Checkbox size="sm" label="By paragraph" checked={!!effect.byPara} onChange={(e) => onChange({ byPara: e.target.checked || undefined })} />
      )}
      <Button size="sm" variant="soft" startDecorator={<PlayArrowIcon />} onClick={onPreview}>
        Preview effect
      </Button>
    </Box>
  );
}

function SecondsInput({ label, aria, ms, onMs }: { label?: string; aria: string; ms: number; onMs: (ms: number) => void }) {
  const [text, setText] = useState(String(Math.round(ms / 10) / 100));
  useEffect(() => setText(String(Math.round(ms / 10) / 100)), [ms]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v >= 0 && v <= 600) onMs(Math.round(v * 1000));
    else setText(String(Math.round(ms / 10) / 100));
  };
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      {label && (
        <Typography level="body-xs" sx={{ opacity: 0.7 }}>
          {label}
        </Typography>
      )}
      <Input
        size="sm"
        type="number"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        slotProps={{ input: { "aria-label": aria, step: 0.25, min: 0 } }}
        sx={{ minWidth: 0 }}
      />
    </Box>
  );
}

/** MotionPreview plays a transition, one effect, or the slide's whole
 *  animation sequence (click steps back to back) in a small stage. */
export function MotionPreview({ slide, prevSlide, run }: { slide: Slide; prevSlide?: Slide; run: PreviewRun | null }) {
  const [step, setStep] = useState<{ step: number; animate: boolean; transit: boolean }>({ step: 99, animate: false, transit: false });
  const target: Slide = useMemo(() => {
    if (run?.what !== "effect") return slide;
    const e = effectsOf(slide).find((x) => x.id === run.id);
    return e ? { ...slide, anims: [{ ...e, start: "click", delay: 0 }] } : slide;
  }, [slide, run]);
  const t = useMemo(() => buildTimeline(target), [target]);
  useEffect(() => {
    if (!run) return;
    const timers: number[] = [];
    if (run.what === "transition") {
      setStep({ step: 99, animate: false, transit: true });
      timers.push(window.setTimeout(() => setStep({ step: 99, animate: false, transit: false }), transitionFx(slide).total + 200));
    } else {
      let at = 0;
      setStep({ step: 0, animate: true, transit: false });
      at += groupEnd(t.groups[0]) + 250;
      for (let g = 1; g < t.groups.length; g++) {
        const s = g;
        timers.push(window.setTimeout(() => setStep({ step: s, animate: true, transit: false }), at));
        at += groupEnd(t.groups[g]) + 250;
      }
      timers.push(window.setTimeout(() => setStep({ step: 99, animate: false, transit: false }), at + 400));
    }
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [run?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = step.step === 99 ? slide : target;
  const fx = new Map<string, SlideFx>();
  if (step.step !== 99) {
    for (const [k, f] of framesAt(target, t, step.step, step.animate, { w: CANVAS_W, h: CANVAS_H })) {
      const style = frameStyle(f);
      if (style && Object.keys(style).length) fx.set(k, { style: style as React.CSSProperties, ...(f.animation ? { key: `:${f.nonce}:${run?.n}` } : {}) });
    }
  }
  const f = step.transit ? transitionFx(slide) : null;
  const h = PREVIEW_W * (CANVAS_H / CANVAS_W);
  const blank: Slide = { id: "blank", background: "#ffffff", elements: [] };
  return (
    <Box data-testid="motion-preview" sx={{ position: "relative", width: PREVIEW_W, height: h, overflow: "hidden", boxShadow: "sm", bgcolor: "#000" }}>
      {f?.outgoing && (
        <Box key={`o${run?.n}`} sx={{ position: "absolute", inset: 0, lineHeight: 0, zIndex: f.outgoingOnTop ? 2 : 1, animation: f.outgoing }}>
          <SlideView slide={prevSlide ?? blank} width={PREVIEW_W} />
        </Box>
      )}
      <Box key={`i${step.transit ? run?.n : "x"}`} sx={{ position: "absolute", inset: 0, lineHeight: 0, zIndex: 1, animation: f?.incoming }}>
        <SlideView slide={shown} width={PREVIEW_W} fx={fx} />
      </Box>
    </Box>
  );
}
