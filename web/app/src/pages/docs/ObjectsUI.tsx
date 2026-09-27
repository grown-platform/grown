// Docs M7 UI: the object settings sidebar (pictures, shapes, text boxes,
// charts: size with aspect lock, actual size, wrapping, position,
// alignment, arrange, rotate / flip, crop, alt text, name, replace / save
// picture, shape fill and outline, chart data) and the insert flows
// (picture from a file or a URL, shape gallery, text box, chart dialog).
// DocEditor mounts <ObjectDialogs> once and shows <ObjectSettings> as a side
// panel; menus open them through the events below.
import { lazy, Suspense, useEffect, useReducer, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  Divider,
  IconButton,
  Input,
  Modal,
  ModalDialog,
  Option,
  Select,
  Sheet,
  Textarea,
  Tooltip,
  Typography,
} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import FlipIcon from "@mui/icons-material/Flip";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import RotateLeftIcon from "@mui/icons-material/RotateLeft";
import {
  DASH_STYLES,
  H_RELS,
  V_RELS,
  WRAP_TYPES,
  actualSize,
  cropOf,
  isAbsolute,
  recrop,
  type ArrangeOp,
} from "./objects";
import {
  arrangeObject,
  chartAttr,
  chartOf,
  insertChart,
  insertPictureFile,
  insertPictureSrc,
  insertShape,
  replacePicture,
  selectedObject,
  setObjectName,
  updateObjectAt,
} from "./objectNodes";
import { downloadPicture, naturalSize } from "./docAssets";
import { defaultChartData } from "../slides/chartElement";
import type { SlideChart } from "../slides/model";

const ChartDialog = lazy(() => import("../slides/ObjectDialogs").then((m) => ({ default: m.ChartDialog })));
const ShapeGallery = lazy(() => import("../slides/ShapeGallery").then((m) => ({ default: m.ShapeGallery })));

// --- events ------------------------------------------------------------------------------------

const SETTINGS_EVENT = "grown-docs-object-settings";
const INSERT_EVENT = "grown-docs-object-insert";
const CHART_EDIT_EVENT = "grown-docs-chart-edit";

type InsertKind = "picture" | "pictureUrl" | "shape" | "textBox" | "chart";

/** Show the object settings panel (for the selected object). */
export function openObjectSettings(): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
}

export function onOpenObjectSettings(fn: () => void): () => void {
  window.addEventListener(SETTINGS_EVENT, fn);
  return () => window.removeEventListener(SETTINGS_EVENT, fn);
}

/** Start an insert flow (file picker, URL prompt, shape gallery, chart). */
export function openInsertObject(kind: InsertKind): void {
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: { kind } }));
}

// --- small pieces ---------------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mt: 1.25 }}>
      <Typography level="title-sm" sx={{ mb: 0.75 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** A number input that commits on blur / Enter. */
function NumField({ label, value, onCommit, unit, step = 1, testId, width = 90 }: { label: string; value: number | null; onCommit: (v: number) => void; unit?: string; step?: number; testId?: string; width?: number }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setText(value == null ? "" : String(value));
  };
  return (
    <Input
      size="sm"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      startDecorator={<Typography level="body-xs">{label}</Typography>}
      endDecorator={unit ? <Typography level="body-xs">{unit}</Typography> : undefined}
      slotProps={{ input: { "aria-label": label, inputMode: "decimal", step, "data-testid": testId } as never }}
      sx={{ width }}
    />
  );
}

const REL_LABEL: Record<string, string> = {
  column: "Column",
  margin: "Margin",
  page: "Page",
  character: "Character",
  leftMargin: "Left margin",
  rightMargin: "Right margin",
  insideMargin: "Inside margin",
  outsideMargin: "Outside margin",
  paragraph: "Paragraph",
  line: "Line",
  topMargin: "Top margin",
  bottomMargin: "Bottom margin",
};

const round = (n: number) => Math.round(n * 100) / 100;

// --- settings sidebar ------------------------------------------------------------------------------

/** ObjectSettings is the right-hand settings panel for the selected
 *  picture, shape, text box or chart. */
export function ObjectSettings({ editor, onClose }: { editor: Editor | null; onClose: () => void }) {
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", refresh);
    return () => {
      editor.off("transaction", refresh);
    };
  }, [editor]);
  const replaceInput = useRef<HTMLInputElement>(null);
  const hit = editor ? selectedObject(editor.state) : null;
  const shell = (children: React.ReactNode) => (
    <Sheet
      variant="outlined"
      data-testid="object-settings"
      sx={{ width: 300, p: 1.5, borderRadius: "sm", height: "100%", overflowY: "auto", maxHeight: "calc(100vh - 140px)" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
        <Typography level="title-md" sx={{ flex: 1 }}>
          {hit ? (hit.node.type.name === "chart" ? "Chart settings" : hit.node.type.name === "shape" ? "Shape settings" : hit.node.type.name === "textBox" ? "Text box settings" : "Image settings") : "Object settings"}
        </Typography>
        <IconButton size="sm" variant="plain" onClick={onClose} aria-label="Close object settings">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      {children}
    </Sheet>
  );
  if (!editor) return null;
  if (!hit)
    return shell(
      <Typography level="body-sm" sx={{ opacity: 0.7 }}>
        Select a picture, shape, text box or chart to change its settings.
      </Typography>,
    );
  const { node, pos } = hit;
  const a = node.attrs as Record<string, unknown>;
  const type = node.type.name;
  const picture = type === "image" || type === "inlineImage";
  const shape = type === "shape" || type === "textBox";
  const set = (patch: Record<string, unknown>) => updateObjectAt(editor.view, pos, patch);
  const w = Number(a.width) || 0;
  const h = Number(a.height) || 0;
  const lock = a.lockAspect !== false;
  const wrap = String(a.wrap ?? "inline");
  const crop = cropOf(a);
  const setW = (v: number) => {
    const nw = Math.max(1, Math.round(v));
    set(lock && w && h ? { width: nw, height: Math.max(1, Math.round((h * nw) / w)) } : { width: nw });
  };
  const setH = (v: number) => {
    const nh = Math.max(1, Math.round(v));
    set(lock && w && h ? { height: nh, width: Math.max(1, Math.round((w * nh) / h)) } : { height: nh });
  };
  const arrange = (op: ArrangeOp) => arrangeObject(editor.view, pos, op);
  const positioned = wrap !== "inline";

  return shell(
    <>
      <Section title="Size">
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", alignItems: "center" }}>
          <NumField label="W" unit="px" value={w ? Math.round(w) : null} onCommit={setW} testId="obj-width" />
          <NumField label="H" unit="px" value={h ? Math.round(h) : null} onCommit={setH} testId="obj-height" />
          <Checkbox size="sm" label="Lock aspect ratio" checked={lock} onChange={(e) => set({ lockAspect: e.target.checked })} />
        </Box>
        {picture && (
          <Button
            size="sm"
            variant="outlined"
            sx={{ mt: 0.75 }}
            data-testid="obj-actual-size"
            onClick={async () => {
              const nat = await naturalSize(String(a.src ?? ""));
              if (nat) set(actualSize(nat, a));
            }}
          >
            Actual size
          </Button>
        )}
      </Section>

      <Divider sx={{ mt: 1.5 }} />
      <Section title="Wrapping style">
        <Select
          size="sm"
          value={wrap}
          onChange={(_, v) => v && set({ wrap: v, ...(isAbsolute(v) && !Number(a.z) ? { z: 1 } : {}) })}
          slotProps={{ button: { "aria-label": "Wrapping style", "data-testid": "obj-wrap" } as never }}
        >
          {WRAP_TYPES.map((t) => (
            <Option key={t.value} value={t.value}>
              {t.label}
            </Option>
          ))}
        </Select>
        <Box sx={{ display: "flex", gap: 0.5, mt: 0.75 }}>
          <ButtonGroup size="sm" aria-label="Alignment">
            {(["left", "center", "right"] as const).map((al) => (
              <Button key={al} variant={a.hAlign === al ? "solid" : "outlined"} onClick={() => set({ hAlign: a.hAlign === al ? null : al })} aria-pressed={a.hAlign === al}>
                {al[0].toUpperCase() + al.slice(1)}
              </Button>
            ))}
          </ButtonGroup>
        </Box>
        {positioned && (
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5, mt: 0.75 }}>
            <Select size="sm" value={String(a.hRel || "column")} onChange={(_, v) => v && set({ hRel: v })} slotProps={{ button: { "aria-label": "Horizontal relative to" } }}>
              {H_RELS.map((r) => (
                <Option key={r} value={r}>
                  {REL_LABEL[r]}
                </Option>
              ))}
            </Select>
            <NumField label="X" unit="px" value={a.hAlign ? null : round(Number(a.hOffset) || 0)} onCommit={(v) => set({ hOffset: v, hAlign: null, hPct: null })} testId="obj-x" />
            <Select size="sm" value={String(a.vRel || "paragraph")} onChange={(_, v) => v && set({ vRel: v })} slotProps={{ button: { "aria-label": "Vertical relative to" } }}>
              {V_RELS.map((r) => (
                <Option key={r} value={r}>
                  {REL_LABEL[r]}
                </Option>
              ))}
            </Select>
            <NumField label="Y" unit="px" value={a.vAlign ? null : round(Number(a.vOffset) || 0)} onCommit={(v) => set({ vOffset: v, vAlign: null, vPct: null })} testId="obj-y" />
          </Box>
        )}
      </Section>

      <Divider sx={{ mt: 1.5 }} />
      <Section title="Arrange">
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5 }}>
          <Button size="sm" variant="outlined" onClick={() => arrange("front")}>
            Bring to front
          </Button>
          <Button size="sm" variant="outlined" onClick={() => arrange("back")}>
            Send to back
          </Button>
          <Button size="sm" variant="outlined" onClick={() => arrange("forward")}>
            Bring forward
          </Button>
          <Button size="sm" variant="outlined" onClick={() => arrange("backward")}>
            Send backward
          </Button>
        </Box>
      </Section>

      <Divider sx={{ mt: 1.5 }} />
      <Section title="Rotate and flip">
        <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", flexWrap: "wrap" }}>
          <NumField label="Angle" unit="°" value={Number(a.rotate) || 0} onCommit={(v) => set({ rotate: ((Math.round(v) % 360) + 360) % 360 })} testId="obj-rotate" width={110} />
          <Tooltip title="Rotate 90° counterclockwise" size="sm">
            <IconButton size="sm" variant="outlined" aria-label="Rotate left" onClick={() => set({ rotate: (((Number(a.rotate) || 0) - 90) % 360 + 360) % 360 })}>
              <RotateLeftIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Rotate 90° clockwise" size="sm">
            <IconButton size="sm" variant="outlined" aria-label="Rotate right" onClick={() => set({ rotate: ((Number(a.rotate) || 0) + 90) % 360 })}>
              <RotateRightIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Flip horizontally" size="sm">
            <IconButton size="sm" variant={a.flipH ? "solid" : "outlined"} aria-label="Flip horizontally" aria-pressed={!!a.flipH} onClick={() => set({ flipH: !a.flipH })}>
              <FlipIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Flip vertically" size="sm">
            <IconButton size="sm" variant={a.flipV ? "solid" : "outlined"} aria-label="Flip vertically" aria-pressed={!!a.flipV} onClick={() => set({ flipV: !a.flipV })}>
              <FlipIcon sx={{ transform: "rotate(90deg)" }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Section>

      {picture && (
        <>
          <Divider sx={{ mt: 1.5 }} />
          <Section title="Crop">
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5 }}>
              {(
                [
                  ["l", "Left"],
                  ["t", "Top"],
                  ["r", "Right"],
                  ["b", "Bottom"],
                ] as const
              ).map(([k, label]) => (
                <NumField key={k} label={label} unit="%" value={round(crop[k] * 100)} onCommit={(v) => set(recrop(a, { [k]: Math.max(0, Math.min(95, v)) / 100 }))} testId={`obj-crop-${k}`} width={130} />
              ))}
            </Box>
            <Button size="sm" variant="plain" sx={{ mt: 0.5 }} onClick={() => set(recrop(a, { l: 0, t: 0, r: 0, b: 0 }))}>
              Reset crop
            </Button>
          </Section>
          <Divider sx={{ mt: 1.5 }} />
          <Section title="Picture">
            <Box sx={{ display: "flex", gap: 0.5 }}>
              <Button size="sm" variant="outlined" onClick={() => replaceInput.current?.click()}>
                Replace…
              </Button>
              <Button size="sm" variant="outlined" onClick={() => void downloadPicture(String(a.src ?? ""), String(a.name || "picture"))}>
                Save picture
              </Button>
            </Box>
            <input
              ref={replaceInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
              hidden
              data-testid="obj-replace-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void replacePicture(editor, pos, f);
              }}
            />
          </Section>
        </>
      )}

      {shape && (
        <>
          <Divider sx={{ mt: 1.5 }} />
          <Section title="Fill and outline">
            <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 0.75, alignItems: "center" }}>
              <Typography level="body-sm">Fill</Typography>
              <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                <input type="color" aria-label="Fill colour" value={/^#[0-9a-f]{6}$/i.test(String(a.fill)) ? String(a.fill) : "#ffffff"} onChange={(e) => set({ fill: e.target.value })} />
                <Checkbox size="sm" label="None" checked={a.fill === "none"} onChange={(e) => set({ fill: e.target.checked ? "none" : "#ffffff" })} />
              </Box>
              <Typography level="body-sm">Line</Typography>
              <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                <input type="color" aria-label="Line colour" value={/^#[0-9a-f]{6}$/i.test(String(a.stroke)) ? String(a.stroke) : "#000000"} onChange={(e) => set({ stroke: e.target.value })} />
                <Checkbox size="sm" label="None" checked={a.stroke === "none"} onChange={(e) => set({ stroke: e.target.checked ? "none" : "#000000" })} />
              </Box>
              <Typography level="body-sm">Width</Typography>
              <NumField label="" unit="px" value={Number(a.strokeWidth) || 0} onCommit={(v) => set({ strokeWidth: Math.max(0, v) })} testId="obj-line-width" />
              <Typography level="body-sm">Dash</Typography>
              <Select size="sm" value={String(a.dash || "solid")} onChange={(_, v) => v && set({ dash: v })} slotProps={{ button: { "aria-label": "Dash" } }}>
                {DASH_STYLES.map((d) => (
                  <Option key={d} value={d}>
                    {d}
                  </Option>
                ))}
              </Select>
              <Typography level="body-sm">Text</Typography>
              <Select size="sm" value={String(a.textAnchor || "ctr")} onChange={(_, v) => v && set({ textAnchor: v })} slotProps={{ button: { "aria-label": "Text position" } }}>
                <Option value="t">Top</Option>
                <Option value="ctr">Middle</Option>
                <Option value="b">Bottom</Option>
              </Select>
            </Box>
            <Button size="sm" variant="outlined" sx={{ mt: 0.75 }} onClick={() => window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: { kind: "shape", changePos: pos } }))}>
              Change shape…
            </Button>
          </Section>
        </>
      )}

      {type === "chart" && (
        <>
          <Divider sx={{ mt: 1.5 }} />
          <Section title="Chart">
            <Button size="sm" variant="outlined" data-testid="obj-chart-edit" onClick={() => window.dispatchEvent(new CustomEvent(CHART_EDIT_EVENT, { detail: { pos } }))}>
              Edit chart and data…
            </Button>
          </Section>
        </>
      )}

      <Divider sx={{ mt: 1.5 }} />
      <Section title="Alt text">
        <AltText key={`${pos}:${String(a.alt ?? "")}`} value={String(a.alt ?? "")} onCommit={(v) => set({ alt: v || null })} />
        <Box sx={{ mt: 0.75 }}>
          <NameField key={`${pos}:${String(a.name ?? "")}`} value={String(a.name ?? "")} onCommit={(v) => setObjectName(editor.view, pos, v)} />
        </Box>
      </Section>
    </>,
  );
}

function AltText({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <Textarea
      size="sm"
      minRows={2}
      placeholder="Describe the object for people who can't see it"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      slotProps={{ textarea: { "aria-label": "Alt text", "data-testid": "obj-alt" } as never }}
    />
  );
}

function NameField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <Input
      size="sm"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() && text !== value && onCommit(text.trim())}
      startDecorator={<Typography level="body-xs">Name</Typography>}
      slotProps={{ input: { "aria-label": "Object name" } }}
    />
  );
}

// --- insert flows ----------------------------------------------------------------------------------

/** ObjectDialogs hosts the picture file input, the shape gallery and the
 *  chart dialog, driven by openInsertObject and chart double-clicks. */
export function ObjectDialogs({ editor }: { editor: Editor | null }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [gallery, setGallery] = useState<{ textBox: boolean; changePos?: number } | null>(null);
  const [chart, setChart] = useState<{ pos: number | null; initial: SlideChart } | null>(null);
  useEffect(() => {
    const onInsert = (e: Event) => {
      const d = (e as CustomEvent<{ kind: InsertKind; changePos?: number }>).detail;
      if (!editor) return;
      if (d.kind === "picture") fileInput.current?.click();
      else if (d.kind === "pictureUrl") {
        const u = window.prompt("Image URL");
        if (u && /^(https?:|data:image\/|\/)/i.test(u.trim())) void insertPictureSrc(editor, u.trim());
      } else if (d.kind === "shape") setGallery({ textBox: false, changePos: d.changePos });
      else if (d.kind === "textBox") insertShape(editor, "rect", { textBox: true, text: "" });
      else if (d.kind === "chart") setChart({ pos: null, initial: { type: "column", title: "", data: defaultChartData("column") } });
    };
    const onChartEdit = (e: Event) => {
      const pos = (e as CustomEvent<{ pos: number }>).detail.pos;
      const node = editor?.state.doc.nodeAt(pos);
      if (node?.type.name === "chart") setChart({ pos, initial: chartOf(node) });
    };
    window.addEventListener(INSERT_EVENT, onInsert);
    window.addEventListener(CHART_EDIT_EVENT, onChartEdit);
    return () => {
      window.removeEventListener(INSERT_EVENT, onInsert);
      window.removeEventListener(CHART_EDIT_EVENT, onChartEdit);
    };
  }, [editor]);
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        hidden
        data-testid="docs-image-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && editor) void insertPictureFile(editor, f);
        }}
      />
      {gallery && (
        <Modal open onClose={() => setGallery(null)}>
          <ModalDialog aria-label="Shapes" sx={{ p: 1 }}>
            <Typography level="title-sm" sx={{ px: 1 }}>
              {gallery.changePos != null ? "Change shape" : "Insert shape"}
            </Typography>
            <Suspense fallback={null}>
              <ShapeGallery
                onPick={(id) => {
                  if (!editor) return;
                  const [prst, variant] = id.split(":");
                  const ends = variant === "arrow" ? { tailEnd: "triangle" } : variant === "double" ? { headEnd: "triangle", tailEnd: "triangle" } : {};
                  if (gallery.changePos != null) updateObjectAt(editor.view, gallery.changePos, { prst, ...ends });
                  else insertShape(editor, prst, { attrs: ends });
                  setGallery(null);
                  editor.view.focus();
                }}
              />
            </Suspense>
          </ModalDialog>
        </Modal>
      )}
      {chart && (
        <Suspense fallback={null}>
          <ChartDialog
            open
            initial={chart.initial}
            inserting={chart.pos == null}
            onClose={() => setChart(null)}
            onApply={(c) => {
              if (editor) {
                if (chart.pos == null) insertChart(editor, c);
                else updateObjectAt(editor.view, chart.pos, { chart: chartAttr(c) });
              }
              setChart(null);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
