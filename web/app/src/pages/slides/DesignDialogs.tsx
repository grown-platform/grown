// M7 dialogs and pickers: theme gallery / theme editor, layout picker,
// page setup, background, header & footer, and a theme colour palette.

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Divider,
  Input,
  Modal,
  ModalDialog,
  Option,
  Radio,
  RadioGroup,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/joy";
import {
  CANVAS_W,
  FONT_FAMILIES,
  type DeckHF,
  type DeckTheme,
  type Slide,
  type SlideFill,
  type SlideHF,
  type SlideLayout,
  type ThemeColors,
} from "./model";
import {
  BUILTIN_THEMES,
  PALETTE_SHADES,
  PALETTE_SLOTS,
  resolveRef,
  SCHEME_SLOTS,
  shadeRef,
  SLOT_LABELS,
} from "./theme";
import { isEmptyPlaceholder, isHF, placeholderPrompt } from "./layouts";
import { SlideView } from "./SlideView";
import { SIZE_PRESETS, twoStop, type BackgroundPatch } from "./slideProps";

// ------------------------------------------------------------ theme colours

/** A palette of theme colours (base row + tints/shades), like PowerPoint's. */
export function ThemePalette({
  theme,
  onPick,
}: {
  theme: DeckTheme;
  onPick: (ref: string, hex: string) => void;
}) {
  return (
    <Box data-testid="theme-palette" sx={{ p: 1 }}>
      <Typography level="body-xs" sx={{ mb: 0.5, opacity: 0.7 }}>
        Theme colours
      </Typography>
      {PALETTE_SHADES.map((k) => (
        <Box key={k} sx={{ display: "flex", gap: 0.5, mb: k === 0 ? 1 : 0.25 }}>
          {PALETTE_SLOTS.map((slot) => {
            const ref = shadeRef(slot, k);
            const hex = resolveRef(ref, theme) ?? "#000000";
            return (
              <Tooltip key={slot} title={`${slot}${k ? ` ${k > 0 ? "lighter" : "darker"} ${Math.round(Math.abs(k) * 100)}%` : ""}`}>
                <Box
                  component="button"
                  type="button"
                  aria-label={`Theme colour ${ref}`}
                  data-ref={ref}
                  onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
                  onClick={() => onPick(ref, hex)}
                  sx={{
                    width: 18,
                    height: 18,
                    p: 0,
                    border: "1px solid rgba(0,0,0,0.2)",
                    bgcolor: hex,
                    cursor: "pointer",
                  }}
                />
              </Tooltip>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

// ------------------------------------------------------------ themes

function ThemeCard({ theme, active, onClick }: { theme: DeckTheme; active: boolean; onClick: () => void }) {
  const bg = resolveRef("bg1", theme)!;
  const tx = resolveRef("tx1", theme)!;
  return (
    <Box
      component="button"
      type="button"
      data-theme-id={theme.id}
      aria-label={`Theme ${theme.name}`}
      aria-pressed={active}
      onClick={onClick}
      sx={{
        p: 0,
        border: "2px solid",
        borderColor: active ? "primary.500" : "divider",
        borderRadius: 6,
        overflow: "hidden",
        cursor: "pointer",
        textAlign: "left",
        bgcolor: "transparent",
      }}
    >
      <Box sx={{ bgcolor: bg, color: tx, height: 84, px: 1.25, py: 1, display: "flex", flexDirection: "column" }}>
        <Box sx={{ fontFamily: theme.fonts.major, fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>Aa</Box>
        <Box sx={{ fontFamily: theme.fonts.minor, fontSize: 11, opacity: 0.8 }}>{theme.name}</Box>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ display: "flex", gap: 0.25 }}>
          {(["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const).map((a) => (
            <Box key={a} sx={{ flex: 1, height: 8, bgcolor: theme.colors[a] }} />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

/** Slide ▸ Change theme / Edit theme. */
export function ThemeDialog({
  open,
  tab,
  current,
  onApply,
  onClose,
}: {
  open: boolean;
  tab: "gallery" | "edit";
  current: DeckTheme;
  onApply: (t: DeckTheme) => void;
  onClose: () => void;
}) {
  const [which, setWhich] = useState<"gallery" | "edit">(tab);
  const [draft, setDraft] = useState<DeckTheme>(current);
  useEffect(() => {
    if (open) {
      setWhich(tab);
      setDraft(current);
    }
  }, [open, tab, current]);
  const gallery = useMemo(() => {
    const list = [...BUILTIN_THEMES];
    if (!list.some((t) => t.id === current.id)) list.unshift(current);
    return list;
  }, [current]);
  const fonts = useMemo(
    () => [...new Set([...FONT_FAMILIES, current.fonts.major, current.fonts.minor, draft.fonts.major, draft.fonts.minor])],
    [current, draft],
  );
  const setColor = (k: keyof ThemeColors, v: string) =>
    setDraft((d) => ({ ...d, id: d.id === "custom" || d.id === "imported" ? d.id : "custom", colors: { ...d.colors, [k]: v } }));
  return (
    <Modal open={open} onClose={onClose} disableRestoreFocus>
      <ModalDialog sx={{ width: 620, maxWidth: "95vw" }} aria-label="Themes">
        <Tabs value={which} onChange={(_, v) => setWhich(v as "gallery" | "edit")}>
          <TabList>
            <Tab value="gallery">Themes</Tab>
            <Tab value="edit">Edit theme</Tab>
          </TabList>
          <TabPanel value="gallery" sx={{ px: 0 }}>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 1 }}>
              {gallery.map((t) => (
                <ThemeCard key={t.id} theme={t} active={t.id === current.id} onClick={() => onApply(t)} />
              ))}
            </Box>
            <Typography level="body-xs" sx={{ mt: 1, opacity: 0.7 }}>
              Placeholders, layouts and anything coloured with a theme colour follow the theme; colours you picked
              yourself are kept.
            </Typography>
          </TabPanel>
          <TabPanel value="edit" sx={{ px: 0 }}>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1 }}>
              <Input
                size="sm"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                slotProps={{ input: { "aria-label": "Theme name" } }}
                sx={{ flex: 1 }}
              />
              <Checkbox
                size="sm"
                label="Dark"
                checked={!!draft.dark}
                onChange={(e) => setDraft({ ...draft, dark: e.target.checked || undefined })}
              />
            </Box>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0.75 }}>
              {SCHEME_SLOTS.map((k) => (
                <Box key={k} component="label" sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: 13 }}>
                  <input
                    type="color"
                    aria-label={SLOT_LABELS[k]}
                    value={draft.colors[k]}
                    onChange={(e) => setColor(k, e.target.value)}
                  />
                  {SLOT_LABELS[k]}
                </Box>
              ))}
            </Box>
            <Box sx={{ display: "flex", gap: 1, mt: 1.5 }}>
              {(["major", "minor"] as const).map((role) => (
                <Box key={role} sx={{ flex: 1 }}>
                  <Typography level="body-xs">{role === "major" ? "Headings font" : "Body font"}</Typography>
                  <Select
                    size="sm"
                    value={draft.fonts[role]}
                    onChange={(_, v) => v && setDraft({ ...draft, fonts: { ...draft.fonts, [role]: v } })}
                    slotProps={{ button: { "aria-label": role === "major" ? "Headings font" : "Body font" } }}
                  >
                    {fonts.map((f) => (
                      <Option key={f} value={f} sx={{ fontFamily: f }}>
                        {f}
                      </Option>
                    ))}
                  </Select>
                </Box>
              ))}
            </Box>
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 2 }}>
              <Button variant="plain" color="neutral" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => onApply(draft)}>Apply theme</Button>
            </Box>
          </TabPanel>
        </Tabs>
      </ModalDialog>
    </Modal>
  );
}

// ------------------------------------------------------------ layouts

/** A layout drawn as a thumbnail, with prompts in its empty placeholders. */
export function LayoutThumb({ layout, width = 120 }: { layout: SlideLayout; width?: number }) {
  const slide: Slide = {
    id: layout.id,
    background: layout.background ?? "#ffffff",
    bgFill: layout.bgFill,
    elements: layout.elements
      .filter((e) => !isHF(e))
      .map((e) =>
        isEmptyPlaceholder(e)
          ? { ...e, text: placeholderPrompt(e), color: e.color, runs: undefined }
          : e,
      )
      .map((e) => (e.placeholder ? { ...e, stroke: "#9aa0a6" } : e)),
  };
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", lineHeight: 0 }}>
      <SlideView slide={slide} width={width} />
    </Box>
  );
}

/** A grid of layouts; used by New slide ▾ and Layout ▾. */
export function LayoutGrid({
  layouts,
  current,
  onPick,
}: {
  layouts: SlideLayout[];
  current?: string;
  onPick: (id: string) => void;
}) {
  return (
    <Box
      data-testid="layout-grid"
      sx={{ display: "grid", gridTemplateColumns: "repeat(3, 128px)", gap: 1, p: 1, maxHeight: "70vh", overflowY: "auto" }}
    >
      {layouts.map((l) => (
        <Box
          key={l.id}
          component="button"
          type="button"
          aria-label={`Layout ${l.name}`}
          data-layout-id={l.id}
          onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
          onClick={() => onPick(l.id)}
          sx={{
            p: 0.25,
            border: "2px solid",
            borderColor: l.id === current ? "primary.500" : "transparent",
            borderRadius: 4,
            bgcolor: "transparent",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          <LayoutThumb layout={l} />
          <Typography level="body-xs" sx={{ mt: 0.25 }}>
            {l.name}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

// ------------------------------------------------------------ page setup

export function PageSetupDialog({
  open,
  size,
  onApply,
  onClose,
}: {
  open: boolean;
  size: { w: number; h: number };
  onApply: (size: { w: number; h: number }, mode: "fit" | "max") => void;
  onClose: () => void;
}) {
  const presetId = (h: number) =>
    SIZE_PRESETS.find((p) => Math.round((CANVAS_W * p.hIn) / p.wIn) === h)?.id ?? "custom";
  const [choice, setChoice] = useState("16:9");
  const [wIn, setWIn] = useState("10");
  const [hIn, setHIn] = useState("5.625");
  const [mode, setMode] = useState<"fit" | "max">("fit");
  useEffect(() => {
    if (!open) return;
    setChoice(presetId(size.h));
    setWIn("10");
    setHIn(String(Math.round(((10 * size.h) / size.w) * 1000) / 1000));
  }, [open, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = Number(wIn);
  const h = Number(hIn);
  const valid = choice !== "custom" || (w >= 1 && h >= 1 && w <= 56 && h <= 56 && w / h <= 4 && h / w <= 4);
  const apply = () => {
    const p = SIZE_PRESETS.find((x) => x.id === choice);
    onApply(p ? { w: p.wIn, h: p.hIn } : { w, h }, mode);
  };
  return (
    <Modal open={open} onClose={onClose} disableRestoreFocus>
      <ModalDialog sx={{ minWidth: 360 }} aria-label="Page setup">
        <Typography level="title-md">Page setup</Typography>
        <Select
          value={choice}
          onChange={(_, v) => v && setChoice(v)}
          slotProps={{ button: { "aria-label": "Slide size" } }}
        >
          {SIZE_PRESETS.map((p) => (
            <Option key={p.id} value={p.id}>
              {p.label}
            </Option>
          ))}
          <Option value="custom">Custom</Option>
        </Select>
        {choice === "custom" && (
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Input
              size="sm"
              type="number"
              value={wIn}
              onChange={(e) => setWIn(e.target.value)}
              endDecorator="in"
              slotProps={{ input: { "aria-label": "Width (inches)", step: 0.1, min: 1 } }}
            />
            ×
            <Input
              size="sm"
              type="number"
              value={hIn}
              onChange={(e) => setHIn(e.target.value)}
              endDecorator="in"
              slotProps={{ input: { "aria-label": "Height (inches)", step: 0.1, min: 1 } }}
            />
          </Box>
        )}
        <Typography level="body-sm" sx={{ mt: 1 }}>
          Scale content
        </Typography>
        <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as "fit" | "max")}>
          <Radio value="fit" label="Ensure fit (everything stays on the slide)" />
          <Radio value="max" label="Maximize (fill the slide; content may be cut off)" />
        </RadioGroup>
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1 }}>
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={apply}>
            Apply
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// ------------------------------------------------------------ background

export function BackgroundDialog({
  open,
  slide,
  theme,
  onApply,
  onPickImage,
  onClose,
}: {
  open: boolean;
  slide: Slide | undefined;
  theme: DeckTheme;
  /** `all`: apply to every slide. */
  onApply: (p: BackgroundPatch, all: boolean) => void;
  /** Ask for a picture; resolves to its src (or null when cancelled). */
  onPickImage: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"color" | "gradient" | "image">("color");
  const [color, setColor] = useState("#ffffff");
  const [ref, setRef] = useState<string | undefined>();
  const [to, setTo] = useState("#4285f4");
  const [angle, setAngle] = useState(90);
  const [radial, setRadial] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !slide) return;
    const f = slide.bgFill;
    setKind(f?.kind === "gradient" ? "gradient" : f?.kind === "image" ? "image" : "color");
    setColor(/^#[0-9a-f]{6}/i.test(slide.background) ? slide.background.slice(0, 7) : "#ffffff");
    setRef(slide.bgRef);
    if (f?.kind === "gradient") {
      setColor(f.stops[0]?.color.slice(0, 7) ?? "#ffffff");
      setTo(f.stops[f.stops.length - 1]?.color.slice(0, 7) ?? "#000000");
      setAngle(f.angle ?? 90);
      setRadial(!!f.radial);
    }
    setSrc(f?.kind === "image" ? f.src : null);
  }, [open, slide]);
  const patch = (): BackgroundPatch => {
    if (kind === "gradient") {
      const g = twoStop(color, to, angle);
      return { background: color, bgFill: radial ? { ...(g as Extract<SlideFill, { kind: "gradient" }>), radial: true } : g };
    }
    if (kind === "image" && src) return { background: "#ffffff", bgFill: { kind: "image", src } };
    return { background: color, ...(ref ? { bgRef: ref } : {}) };
  };
  return (
    <Modal open={open} onClose={onClose} disableRestoreFocus>
      <ModalDialog sx={{ width: 440, maxWidth: "95vw" }} aria-label="Background">
        <Typography level="title-md">Background</Typography>
        <RadioGroup orientation="horizontal" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} sx={{ gap: 2 }}>
          <Radio value="color" label="Colour" />
          <Radio value="gradient" label="Gradient" />
          <Radio value="image" label="Image" />
        </RadioGroup>
        {kind !== "image" && (
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <input
              type="color"
              aria-label={kind === "gradient" ? "Gradient start" : "Background colour"}
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setRef(undefined);
              }}
            />
            {kind === "gradient" && (
              <>
                →
                <input type="color" aria-label="Gradient end" value={to} onChange={(e) => setTo(e.target.value)} />
                <Select
                  size="sm"
                  value={radial ? -1 : angle}
                  onChange={(_, v) => {
                    if (v === null) return;
                    if (v === -1) setRadial(true);
                    else {
                      setRadial(false);
                      setAngle(v);
                    }
                  }}
                  slotProps={{ button: { "aria-label": "Gradient direction" } }}
                >
                  <Option value={0}>Left to right</Option>
                  <Option value={90}>Top to bottom</Option>
                  <Option value={45}>Diagonal ↘</Option>
                  <Option value={135}>Diagonal ↙</Option>
                  <Option value={-1}>Radial</Option>
                </Select>
              </>
            )}
            {kind === "color" && ref && (
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                theme: {ref}
              </Typography>
            )}
          </Box>
        )}
        {kind === "color" && (
          <ThemePalette
            theme={theme}
            onPick={(r, hex) => {
              setRef(r);
              setColor(hex);
            }}
          />
        )}
        {kind === "image" && (
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Button
              size="sm"
              variant="outlined"
              onClick={async () => {
                const s = await onPickImage();
                if (s) setSrc(s);
              }}
            >
              Choose image…
            </Button>
            {src && <Box component="img" src={src} alt="" sx={{ height: 48, border: "1px solid", borderColor: "divider" }} />}
          </Box>
        )}
        <Divider />
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            onClick={() => onApply({ background: resolveRef("bg1", theme) ?? "#ffffff", bgRef: "bg1" }, false)}
          >
            Reset to theme
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button size="sm" variant="outlined" disabled={kind === "image" && !src} onClick={() => onApply(patch(), true)}>
            Apply to all
          </Button>
          <Button size="sm" disabled={kind === "image" && !src} onClick={() => onApply(patch(), false)}>
            Done
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// ------------------------------------------------------------ header & footer

export function HeaderFooterDialog({
  open,
  hf,
  slideHf,
  onApply,
  onClose,
}: {
  open: boolean;
  hf: DeckHF | undefined;
  /** The current slide's effective switches. */
  slideHf: SlideHF;
  /** `all`: the deck setting (per-slide overrides cleared); otherwise the
   *  current slide only. */
  onApply: (next: DeckHF, all: boolean) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<DeckHF>({});
  useEffect(() => {
    if (open) setD({ ...hf, dt: slideHf.dt, ftr: slideHf.ftr, sldNum: slideHf.sldNum });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const auto = d.dateText === undefined;
  return (
    <Modal open={open} onClose={onClose} disableRestoreFocus>
      <ModalDialog sx={{ minWidth: 380 }} aria-label="Header and footer">
        <Typography level="title-md">Header &amp; footer</Typography>
        <Checkbox label="Date and time" checked={!!d.dt} onChange={(e) => setD({ ...d, dt: e.target.checked })} />
        {d.dt && (
          <Box sx={{ pl: 3.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
            <RadioGroup
              orientation="horizontal"
              value={auto ? "auto" : "fixed"}
              onChange={(e) => setD({ ...d, dateText: e.target.value === "auto" ? undefined : (d.dateText ?? "") })}
              sx={{ gap: 2 }}
            >
              <Radio value="auto" label="Update automatically" />
              <Radio value="fixed" label="Fixed" />
            </RadioGroup>
            {!auto && (
              <Input
                size="sm"
                value={d.dateText}
                onChange={(e) => setD({ ...d, dateText: e.target.value })}
                slotProps={{ input: { "aria-label": "Fixed date" } }}
              />
            )}
          </Box>
        )}
        <Checkbox label="Slide number" checked={!!d.sldNum} onChange={(e) => setD({ ...d, sldNum: e.target.checked })} />
        {d.sldNum && (
          <Input
            size="sm"
            type="number"
            startDecorator="Start at"
            value={d.startAt ?? 1}
            onChange={(e) => setD({ ...d, startAt: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}
            slotProps={{ input: { "aria-label": "Number slides from", min: 0 } }}
            sx={{ ml: 3.5, width: 160 }}
          />
        )}
        <Checkbox label="Footer" checked={!!d.ftr} onChange={(e) => setD({ ...d, ftr: e.target.checked })} />
        {d.ftr && (
          <Input
            size="sm"
            value={d.footerText ?? ""}
            onChange={(e) => setD({ ...d, footerText: e.target.value })}
            slotProps={{ input: { "aria-label": "Footer text" } }}
            sx={{ ml: 3.5 }}
          />
        )}
        <Checkbox
          label="Don't show on title slide"
          checked={!!d.notOnTitle}
          onChange={(e) => setD({ ...d, notOnTitle: e.target.checked || undefined })}
        />
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1 }}>
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outlined" onClick={() => onApply(d, false)}>
            Apply
          </Button>
          <Button onClick={() => onApply(d, true)}>Apply to all</Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
