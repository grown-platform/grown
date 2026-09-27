// M11 dialogs: chart editor (type, options and the embedded data sheet),
// diagram outline panel (SmartArt-lite), insert video/audio, and word art.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  IconButton,
  Input,
  Modal,
  ModalDialog,
  Option,
  Select,
  Slider,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Textarea,
  Typography,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import { ChartRenderer } from "../sheets/ChartRenderer";
import {
  addChartCol,
  addChartRow,
  chartConfigOf,
  chartInputOf,
  defaultChartData,
  normalizeGrid,
  parseChartPaste,
  removeChartCol,
  removeChartRow,
  setChartCell,
  SLIDE_CHART_TYPES,
} from "./chartElement";
import { DIAGRAM_LAYOUTS, diagramMembers, type DiagramLayout } from "./diagrams";
import { MAX_MEDIA_BYTES, mediaFileError, parseMediaUrl, type ParsedMediaUrl } from "./media";
import type { SlideChart, SlideElement, SlideMedia, TextWarp, WordArt } from "./model";
import { GroupChildren } from "./SlideView";
import { activeTheme } from "./theme";
import { TEXT_WARPS, WORD_ART_STYLES } from "./wordArt";

// ------------------------------------------------------------ chart

/** Chart editor: type, title and options, the data sheet (a small grid;
 *  paste a block from a spreadsheet into any cell) and a live preview. */
export function ChartDialog({
  open,
  initial,
  inserting,
  onApply,
  onClose,
}: {
  open: boolean;
  initial: SlideChart | null;
  inserting: boolean;
  onApply: (c: SlideChart) => void;
  onClose: () => void;
}) {
  const [chart, setChart] = useState<SlideChart | null>(initial);
  useEffect(() => {
    if (open) setChart(initial ? { ...initial, data: normalizeGrid(initial.data) } : null);
  }, [open, initial]);
  const theme = activeTheme();
  const preview = useMemo(() => (chart ? { cfg: chartConfigOf(chart, theme), input: chartInputOf(chart) } : null), [chart, theme]);
  if (!chart) return null;
  const set = (p: Partial<SlideChart>) => setChart((c) => (c ? { ...c, ...p } : c));
  const grid = chart.data;
  const pie = chart.type === "pie" || chart.type === "doughnut";
  const stackable = ["column", "bar", "line", "area"].includes(chart.type);
  const onPaste = (e: React.ClipboardEvent, r: number, c: number) => {
    const t = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(t)) return;
    e.preventDefault();
    const block = parseChartPaste(t);
    let g = grid;
    block.forEach((row, i) => row.forEach((v, j) => (g = setChartCell(g, r + i, c + j, v))));
    set({ data: g });
  };
  return (
    <Modal open={open} onClose={onClose} disableRestoreFocus>
      <ModalDialog aria-label="Chart" sx={{ width: "min(960px, 96vw)", maxHeight: "92vh", overflow: "auto" }}>
        <Typography level="title-md">{inserting ? "Insert chart" : "Edit chart"}</Typography>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <Box sx={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Select
                size="sm"
                value={chart.type}
                onChange={(_, v) => {
                  if (!v) return;
                  // Switching between single-series and multi-series families
                  // on the untouched sample swaps in that family's sample.
                  const sample = JSON.stringify(grid) === JSON.stringify(defaultChartData(chart.type));
                  set({ type: v, ...(sample ? { data: defaultChartData(v), totals: v === "waterfall" ? [0, 5] : undefined } : {}) });
                }}
                slotProps={{ button: { "aria-label": "Chart type" } }}
                sx={{ minWidth: 140 }}
              >
                {SLIDE_CHART_TYPES.map((t) => (
                  <Option key={t.type} value={t.type}>
                    {t.label}
                  </Option>
                ))}
              </Select>
              <Input
                size="sm"
                placeholder="Chart title"
                value={chart.title}
                onChange={(e) => set({ title: e.target.value })}
                slotProps={{ input: { "aria-label": "Chart title" } }}
                sx={{ flex: 1, minWidth: 160 }}
              />
            </Box>
            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
              <Select
                size="sm"
                value={chart.legend ?? "auto"}
                onChange={(_, v) => v && set({ legend: v === "auto" ? undefined : (v as SlideChart["legend"]) })}
                slotProps={{ button: { "aria-label": "Legend" } }}
                startDecorator="Legend"
              >
                <Option value="auto">Auto</Option>
                <Option value="bottom">Bottom</Option>
                <Option value="top">Top</Option>
                <Option value="right">Right</Option>
                <Option value="left">Left</Option>
                <Option value="none">None</Option>
              </Select>
              {stackable && (
                <Select
                  size="sm"
                  value={chart.stacking ?? "none"}
                  onChange={(_, v) => v && set({ stacking: v === "none" ? undefined : (v as SlideChart["stacking"]) })}
                  slotProps={{ button: { "aria-label": "Stacking" } }}
                  startDecorator="Stack"
                >
                  <Option value="none">None</Option>
                  <Option value="stacked">Stacked</Option>
                  <Option value="percent">100 %</Option>
                </Select>
              )}
              <Checkbox size="sm" label="Data labels" checked={!!chart.dataLabels} onChange={(e) => set({ dataLabels: e.target.checked || undefined })} />
              {!pie && (
                <Checkbox
                  size="sm"
                  label="Series in rows"
                  checked={!!chart.seriesInRows}
                  onChange={(e) => set({ seriesInRows: e.target.checked || undefined })}
                />
              )}
            </Box>
            <Typography level="body-xs" sx={{ opacity: 0.7 }}>
              Data — first row: series names; first column: categories. Paste a block from a spreadsheet into any cell.
            </Typography>
            <Box sx={{ overflow: "auto", maxHeight: 320, border: "1px solid", borderColor: "divider", borderRadius: "sm" }}>
              <table data-testid="chart-grid" style={{ borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  <tr>
                    <td />
                    {grid[0].map((_, c) => (
                      <td key={c} style={{ textAlign: "center" }}>
                        {c > 0 && (
                          <IconButton size="sm" variant="plain" aria-label={`Remove column ${c + 1}`} disabled={grid[0].length <= 2} onClick={() => set({ data: removeChartCol(grid, c) })}>
                            <CloseIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        )}
                      </td>
                    ))}
                  </tr>
                  {grid.map((row, r) => (
                    <tr key={r}>
                      <td>
                        {r > 0 && (
                          <IconButton size="sm" variant="plain" aria-label={`Remove row ${r + 1}`} disabled={grid.length <= 2} onClick={() => set({ data: removeChartRow(grid, r) })}>
                            <CloseIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        )}
                      </td>
                      {row.map((v, c) => (
                        <td key={c} style={{ border: "1px solid rgba(128,128,128,0.35)", padding: 0 }}>
                          <input
                            aria-label={`Cell ${r + 1},${c + 1}`}
                            data-cell={`${r},${c}`}
                            value={v}
                            onChange={(e) => set({ data: setChartCell(grid, r, c, e.target.value) })}
                            onPaste={(e) => onPaste(e, r, c)}
                            style={{
                              width: c === 0 ? 110 : 80,
                              border: 0,
                              padding: "4px 6px",
                              font: "inherit",
                              background: r === 0 || c === 0 ? "rgba(128,128,128,0.12)" : "transparent",
                              fontWeight: r === 0 || c === 0 ? 600 : 400,
                              color: "inherit",
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button size="sm" variant="outlined" startDecorator={<AddIcon />} onClick={() => set({ data: addChartRow(grid) })}>
                Row
              </Button>
              <Button size="sm" variant="outlined" startDecorator={<AddIcon />} onClick={() => set({ data: addChartCol(grid) })}>
                Series
              </Button>
            </Box>
          </Box>
          <Box sx={{ flex: "0 0 auto", border: "1px solid", borderColor: "divider", borderRadius: "sm", overflow: "hidden", alignSelf: "flex-start" }}>
            {preview && <ChartRenderer config={preview.cfg} input={preview.input} width={420} height={270} />}
          </Box>
        </Box>
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(chart)}>{inserting ? "Insert" : "Apply"}</Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// ------------------------------------------------------------ diagram

/** The outline panel: pick a layout, type the items (Tab indents a line
 *  one level), and see the diagram as it will be drawn. */
export function DiagramDialog({
  open,
  initial,
  inserting,
  onApply,
  onClose,
}: {
  open: boolean;
  initial: { layout: DiagramLayout; outline: string };
  inserting: boolean;
  onApply: (layout: DiagramLayout, outline: string) => void;
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<DiagramLayout>(initial.layout);
  const [outline, setOutline] = useState(initial.outline);
  const [touched, setTouched] = useState(false);
  // Caret to restore after a Tab re-indent re-renders the textarea.
  const caretRef = useRef<{ ta: HTMLTextAreaElement; a: number; b: number } | null>(null);
  useLayoutEffect(() => {
    const c = caretRef.current;
    if (!c) return;
    caretRef.current = null;
    c.ta.setSelectionRange(c.a, c.b);
  }, [outline]);
  useEffect(() => {
    if (!open) return;
    setLayout(initial.layout);
    setOutline(initial.outline);
    setTouched(!inserting);
  }, [open, initial, inserting]);
  const theme = activeTheme();
  const PW = 400;
  const PH = 225;
  const members = useMemo(() => diagramMembers(layout, outline, { x: 12, y: 12, w: PW - 24, h: PH - 24 }, theme), [layout, outline, theme]);
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const ta = e.currentTarget;
    const { selectionStart: a, selectionEnd: b, value } = ta;
    const lineStart = value.lastIndexOf("\n", a - 1) + 1;
    let next: string;
    let caret: number;
    if (e.shiftKey) {
      if (value[lineStart] !== "\t") return;
      next = value.slice(0, lineStart) + value.slice(lineStart + 1);
      caret = Math.max(lineStart, a - 1);
    } else {
      next = value.slice(0, lineStart) + "\t" + value.slice(lineStart);
      caret = a + 1;
    }
    caretRef.current = { ta, a: caret, b: caret + (b - a) };
    setOutline(next);
    setTouched(true);
  };
  return (
    <Modal open={open} onClose={onClose} disableRestoreFocus>
      <ModalDialog aria-label="Diagram" sx={{ width: "min(860px, 96vw)" }}>
        <Typography level="title-md">{inserting ? "Insert diagram" : "Edit diagram"}</Typography>
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }} role="radiogroup" aria-label="Layout">
          {DIAGRAM_LAYOUTS.map((l) => (
            <Button
              key={l.value}
              size="sm"
              role="radio"
              aria-checked={layout === l.value}
              variant={layout === l.value ? "solid" : "outlined"}
              onClick={() => {
                setLayout(l.value);
                // A new diagram's untouched sample follows the layout.
                if (!touched) setOutline(l.sample);
              }}
            >
              {l.label}
            </Button>
          ))}
        </Box>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <Box sx={{ flex: "1 1 260px" }}>
            <Typography level="body-xs" sx={{ mb: 0.5, opacity: 0.7 }}>
              One item per line. Tab / Shift+Tab changes the level.
            </Typography>
            <Textarea
              minRows={8}
              maxRows={14}
              value={outline}
              onChange={(e) => {
                setOutline(e.target.value);
                setTouched(true);
              }}
              onKeyDown={onKey}
              slotProps={{ textarea: { "aria-label": "Outline", spellCheck: false, style: { tabSize: 3 } } }}
            />
          </Box>
          <Box
            data-testid="diagram-preview"
            sx={{ position: "relative", width: PW, height: PH, flex: "0 0 auto", bgcolor: "#fff", border: "1px solid", borderColor: "divider", borderRadius: "sm", overflow: "hidden" }}
          >
            <GroupChildren el={{ id: "preview", type: "group", x: 0, y: 0, w: PW, h: PH, children: members } as SlideElement} />
          </Box>
        </Box>
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!outline.trim()} onClick={() => onApply(layout, outline)}>
            {inserting ? "Insert" : "Apply"}
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// ------------------------------------------------------------ media

export interface MediaPick {
  file?: File;
  url?: ParsedMediaUrl;
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
}

/** Insert video / audio: upload a file or paste a link; playback options.
 *  With `editing` only the playback options are shown. */
export function MediaDialog({
  open,
  kind,
  editing,
  busy,
  error,
  onPick,
  onClose,
}: {
  open: boolean;
  kind: SlideMedia["kind"];
  editing: SlideMedia | null;
  busy: boolean;
  error: string | null;
  onPick: (p: MediaPick) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"upload" | "url">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [autoplay, setAutoplay] = useState(false);
  const [loop, setLoop] = useState(false);
  const [muted, setMuted] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setUrl("");
    setAutoplay(!!editing?.autoplay);
    setLoop(!!editing?.loop);
    setMuted(!!editing?.muted);
  }, [open, editing]);
  const fileErr = file ? mediaFileError(file) : null;
  const parsed = url.trim() ? parseMediaUrl(url) : null;
  const urlErr = url.trim() && !parsed ? "Paste a YouTube or Vimeo link, or a direct link to an MP4, WebM, MP3… file." : null;
  const ready = editing ? true : tab === "upload" ? !!file && !fileErr : !!parsed;
  const accept = kind === "audio" ? "audio/*,.mp3,.m4a,.wav,.ogg,.oga,.aac,.opus" : "video/*,.mp4,.webm,.ogv,.mov,.m4v";
  const opts = { autoplay, loop, muted };
  return (
    <Modal open={open} onClose={onClose} disableRestoreFocus>
      <ModalDialog aria-label={kind === "audio" ? "Audio" : "Video"} sx={{ width: "min(520px, 96vw)" }}>
        <Typography level="title-md">{editing ? "Playback" : kind === "audio" ? "Insert audio" : "Insert video"}</Typography>
        {!editing && (
          <Tabs value={tab} onChange={(_, v) => v && setTab(v as "upload" | "url")}>
            <TabList>
              <Tab value="upload">Upload</Tab>
              <Tab value="url">By URL</Tab>
            </TabList>
            <TabPanel value="upload" sx={{ px: 0 }}>
              <input
                ref={fileRef}
                type="file"
                accept={accept}
                hidden
                data-testid="media-file"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <Button size="sm" variant="outlined" onClick={() => fileRef.current?.click()}>
                  Choose file…
                </Button>
                <Typography level="body-sm" noWrap sx={{ minWidth: 0 }}>
                  {file ? `${file.name} (${(file.size / 1048576).toFixed(1)} MB)` : `Up to ${MAX_MEDIA_BYTES >> 20} MB`}
                </Typography>
              </Box>
              {fileErr && (
                <Typography level="body-sm" color="danger" sx={{ mt: 1 }}>
                  {fileErr}
                </Typography>
              )}
            </TabPanel>
            <TabPanel value="url" sx={{ px: 0 }}>
              <Input
                size="sm"
                placeholder={kind === "audio" ? "https://…/sound.mp3" : "https://www.youtube.com/watch?v=…"}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                slotProps={{ input: { "aria-label": "Media URL" } }}
              />
              {urlErr ? (
                <Typography level="body-sm" color="danger" sx={{ mt: 1 }}>
                  {urlErr}
                </Typography>
              ) : parsed ? (
                <Typography level="body-sm" sx={{ mt: 1, opacity: 0.7 }}>
                  {parsed.embed ? `${parsed.embed.provider === "youtube" ? "YouTube" : "Vimeo"} video` : `${parsed.kind === "audio" ? "Audio" : "Video"} file`}
                </Typography>
              ) : null}
            </TabPanel>
          </Tabs>
        )}
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <Checkbox size="sm" label="Play automatically" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} />
          <Checkbox size="sm" label="Loop" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          {kind === "video" && <Checkbox size="sm" label="Mute" checked={muted} onChange={(e) => setMuted(e.target.checked)} />}
        </Box>
        {error && <Alert color="danger" size="sm">{error}</Alert>}
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!ready}
            onClick={() => onPick(editing ? opts : tab === "upload" ? { file: file!, ...opts } : { url: parsed!, ...opts })}
          >
            {editing ? "Apply" : "Insert"}
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// ------------------------------------------------------------ word art

/** Word art: a style gallery plus outline, gradient fill, shadow, glow and
 *  warp, applied to the selected text boxes. */
export function WordArtDialog({
  open,
  initial,
  color,
  onApply,
  onClose,
}: {
  open: boolean;
  initial: WordArt | undefined;
  color: string;
  onApply: (art: WordArt | undefined, color?: string) => void;
  onClose: () => void;
}) {
  const [art, setArt] = useState<WordArt>({});
  const [fill, setFill] = useState(color);
  useEffect(() => {
    if (!open) return;
    setArt(initial ? JSON.parse(JSON.stringify(initial)) : {});
    setFill(color);
  }, [open, initial, color]);
  const set = <K extends keyof WordArt>(k: K, v: WordArt[K] | undefined) =>
    setArt((a) => {
      const n = { ...a };
      if (v === undefined) delete n[k];
      else n[k] = v;
      return n;
    });
  const colorInput = (label: string, value: string, onChange: (v: string) => void) => (
    <input type="color" aria-label={label} value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} style={{ width: 36, height: 28, border: 0, padding: 0, background: "none" }} />
  );
  return (
    <Modal open={open} onClose={onClose} disableRestoreFocus>
      <ModalDialog aria-label="Word art" sx={{ width: "min(560px, 96vw)" }}>
        <Typography level="title-md">Word art</Typography>
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
          {WORD_ART_STYLES.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant="outlined"
              onClick={() => {
                setArt(JSON.parse(JSON.stringify(s.art)));
                setFill(s.color);
              }}
            >
              {s.label}
            </Button>
          ))}
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 1, alignItems: "center" }}>
          <Typography level="body-sm">Fill</Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
            {colorInput("Text colour", fill, setFill)}
            <Checkbox size="sm" label="Gradient" checked={!!art.gradient} onChange={(e) => set("gradient", e.target.checked ? { from: fill, to: "#8e24aa", angle: 0 } : undefined)} />
            {art.gradient && (
              <>
                {colorInput("Gradient start", art.gradient.from, (v) => set("gradient", { ...art.gradient!, from: v }))}
                {colorInput("Gradient end", art.gradient.to, (v) => set("gradient", { ...art.gradient!, to: v }))}
                <Select size="sm" value={art.gradient.angle} onChange={(_, v) => v !== null && set("gradient", { ...art.gradient!, angle: v })} slotProps={{ button: { "aria-label": "Gradient direction" } }}>
                  <Option value={0}>Left to right</Option>
                  <Option value={90}>Top to bottom</Option>
                  <Option value={45}>Diagonal</Option>
                  <Option value={180}>Right to left</Option>
                </Select>
              </>
            )}
          </Box>
          <Typography level="body-sm">Outline</Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Checkbox size="sm" slotProps={{ input: { "aria-label": "Outline" } }} checked={!!art.outline} onChange={(e) => set("outline", e.target.checked ? { color: "#202124", width: 1.5 } : undefined)} />
            {art.outline && (
              <>
                {colorInput("Outline colour", art.outline.color, (v) => set("outline", { ...art.outline!, color: v }))}
                <Slider size="sm" min={0.5} max={6} step={0.5} value={art.outline.width} onChange={(_, v) => set("outline", { ...art.outline!, width: v as number })} sx={{ maxWidth: 160 }} aria-label="Outline width" />
              </>
            )}
          </Box>
          <Typography level="body-sm">Shadow</Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Checkbox size="sm" slotProps={{ input: { "aria-label": "Shadow" } }} checked={!!art.shadow} onChange={(e) => set("shadow", e.target.checked ? { color: "#00000080", blur: 4, dist: 4, dir: 45 } : undefined)} />
            {art.shadow && (
              <Slider size="sm" min={0} max={20} value={art.shadow.dist} onChange={(_, v) => set("shadow", { ...art.shadow!, dist: v as number })} sx={{ maxWidth: 160 }} aria-label="Shadow distance" />
            )}
          </Box>
          <Typography level="body-sm">Glow</Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Checkbox size="sm" slotProps={{ input: { "aria-label": "Glow" } }} checked={!!art.glow} onChange={(e) => set("glow", e.target.checked ? { color: "#fbbc04", radius: 8 } : undefined)} />
            {art.glow && (
              <>
                {colorInput("Glow colour", art.glow.color, (v) => set("glow", { ...art.glow!, color: v }))}
                <Slider size="sm" min={2} max={24} value={art.glow.radius} onChange={(_, v) => set("glow", { ...art.glow!, radius: v as number })} sx={{ maxWidth: 160 }} aria-label="Glow size" />
              </>
            )}
          </Box>
          <Typography level="body-sm">Warp</Typography>
          <Select
            size="sm"
            value={art.warp ?? "none"}
            onChange={(_, v) => set("warp", !v || v === "none" ? undefined : (v as TextWarp))}
            slotProps={{ button: { "aria-label": "Warp" } }}
          >
            <Option value="none">None</Option>
            {TEXT_WARPS.map((w) => (
              <Option key={w.value} value={w.value}>
                {w.label}
              </Option>
            ))}
          </Select>
        </Box>
        <Box sx={{ display: "flex", gap: 1, justifyContent: "space-between" }}>
          <Button variant="plain" color="danger" onClick={() => onApply(undefined)}>
            Remove effects
          </Button>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button variant="plain" color="neutral" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => onApply(Object.keys(art).length ? art : undefined, fill)}>Apply</Button>
          </Box>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
