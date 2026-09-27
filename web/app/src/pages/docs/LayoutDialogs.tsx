// Layout dialogs (Docs M9): Page setup (margins, paper, layout: section
// start, columns, headers/footers, line numbers, page numbering, borders),
// Columns, Watermark, Hyphenation, Header & footer options and Page
// numbers. Mounted once (<LayoutDialogs editor ydoc/>) and opened with
// openLayoutDialog(kind), like ParagraphDialogs.
import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Typography,
} from "@mui/joy";
import type { Editor } from "@tiptap/react";
import * as Y from "yjs";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import {
  COLUMN_PRESETS,
  MARGIN_PRESETS,
  PAGE_SIZES,
  SECTION_START_LABEL,
  SECTION_STARTS,
  columnWidths,
  contentWidth,
  hfFragment,
  hfKey,
  ownFragment,
  pageSizeId,
  setEqualColumns,
  setOrientation,
  setPageSize,
  type HfKind,
  type HfWhich,
  type LineNumbering,
  type PageBorders,
  type PageNumFmt,
  type SectionProps,
  type SectionStart,
  type Watermark,
  DEFAULT_HYPHENATION,
} from "./sections";
import { currentSection, docSections, getSettings, setBreakKind, setDocSettings, setSectionProps, type SetupScope } from "./pageLayout";
import { marginSchema } from "./margin";

export type LayoutDialogKind = "pagesetup" | "columns" | "watermark" | "hyphenation" | "headerfooter" | "pagenumbers" | "linenumbers";

const EVENT = "grown-docs-layout-dialog";

export function openLayoutDialog(kind: LayoutDialogKind): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: kind }));
}

export function LayoutDialogs({ editor, ydoc }: { editor: Editor | null; ydoc: Y.Doc | null }) {
  const [kind, setKind] = useState<LayoutDialogKind | null>(null);
  useEffect(() => {
    const on = (e: Event) => setKind((e as CustomEvent<LayoutDialogKind>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const close = () => {
    setKind(null);
    editor?.commands.focus();
  };
  if (!editor || !kind) return null;
  return (
    <Modal open onClose={close}>
      <ModalDialog
        data-testid={`layout-dialog-${kind}`}
        sx={{ width: { xs: "calc(100vw - 32px)", sm: kind === "pagesetup" ? 600 : 460 }, maxWidth: "calc(100vw - 32px)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <ModalClose />
        {(kind === "pagesetup" || kind === "columns" || kind === "linenumbers") && (
          <PageSetup editor={editor} onClose={close} initialTab={kind === "columns" ? 2 : kind === "linenumbers" ? 2 : 0} />
        )}
        {kind === "watermark" && <WatermarkDialog editor={editor} onClose={close} />}
        {kind === "hyphenation" && <HyphenationDialog editor={editor} onClose={close} />}
        {kind === "headerfooter" && <HeaderFooterDialog editor={editor} ydoc={ydoc} onClose={close} />}
        {kind === "pagenumbers" && <PageNumbersDialog editor={editor} ydoc={ydoc} onClose={close} />}
      </ModalDialog>
    </Modal>
  );
}

// --- helpers ---------------------------------------------------------------------------------

const IN = 72;
const toIn = (pt: number) => Math.round((pt / IN) * 100) / 100;
const fromIn = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n * IN : null;
};

function NumIn({ label, value, onChange, testid, unit = "in", step = 0.1 }: { label: string; value: number; onChange: (pt: number) => void; testid?: string; unit?: string; step?: number }) {
  const [text, setText] = useState(String(unit === "in" ? toIn(value) : value));
  useEffect(() => setText(String(unit === "in" ? toIn(value) : value)), [value, unit]);
  return (
    <Box sx={{ flex: 1, minWidth: 100 }}>
      <Typography level="body-xs" sx={{ mb: 0.25 }}>
        {label}
      </Typography>
      <Input
        size="sm"
        type="number"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = unit === "in" ? fromIn(e.target.value) : parseFloat(e.target.value);
          if (v != null && Number.isFinite(v)) onChange(v);
        }}
        endDecorator={unit}
        slotProps={{ input: { step, min: 0, "aria-label": label, "data-testid": testid } }}
      />
    </Box>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box sx={{ mt: 1.5 }}>
    <Typography level="title-sm" sx={{ mb: 0.5 }}>
      {title}
    </Typography>
    {children}
  </Box>
);

function ApplyTo({ value, onChange, multi }: { value: SetupScope; onChange: (s: SetupScope) => void; multi: boolean }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2 }}>
      <Typography level="body-sm">Apply to</Typography>
      <Select size="sm" value={value} onChange={(_, v) => v && onChange(v)} slotProps={{ button: { "aria-label": "Apply to" } }}>
        {multi && <Option value="section">This section</Option>}
        <Option value="document">Whole document</Option>
        <Option value="forward">This point forward</Option>
      </Select>
    </Box>
  );
}

// --- page setup -------------------------------------------------------------------------------

type Key = keyof SectionProps;

function PageSetup({ editor, onClose, initialTab }: { editor: Editor; onClose: () => void; initialTab: number }) {
  const sec = useMemo(() => currentSection(editor), [editor]);
  const multi = useMemo(() => docSections(editor).length > 1, [editor]);
  const settings = useMemo(() => getSettings(editor), [editor]);
  const [p, setP] = useState<SectionProps>(sec.props);
  const [changed, setChanged] = useState<Set<Key>>(new Set());
  const [mirror, setMirror] = useState(settings.mirror);
  const [evenOdd, setEvenOdd] = useState(settings.evenOdd);
  const [start, setStart] = useState<SectionStart>(sec.start);
  const [scope, setScope] = useState<SetupScope>(multi ? "section" : "document");
  const set = (patch: Partial<SectionProps>) => {
    setP((cur) => ({ ...cur, ...patch }));
    setChanged((c) => new Set([...c, ...(Object.keys(patch) as Key[])]));
  };
  const m = p.margins;
  const setM = (patch: Partial<SectionProps["margins"]>) => set({ margins: { ...m, ...patch } });
  const sizeId = pageSizeId(p);
  const ln = p.lnNum;
  const setLn = (patch: Partial<LineNumbering> | null) =>
    set({ lnNum: patch === null ? null : { countBy: 1, start: 1, distance: 0, restart: "newPage", ...(ln ?? {}), ...patch } });
  const b = p.borders;
  const setB = (patch: Partial<PageBorders> | null) =>
    set({ borders: patch === null ? null : { style: "single", color: "#000000", width: 0.75, space: 24, offsetFrom: "text", display: "all", ...(b ?? {}), ...patch } });
  const cw = columnWidths(p);

  const ok = () => {
    const keys = [...changed];
    if (keys.length)
      setSectionProps(
        editor,
        (cur) => {
          const out = { ...cur };
          for (const k of keys) (out as unknown as Record<string, unknown>)[k] = (p as unknown as Record<string, unknown>)[k];
          return out;
        },
        scope,
      );
    if (mirror !== settings.mirror || evenOdd !== settings.evenOdd) setDocSettings(editor, { mirror, evenOdd });
    if (start !== sec.start && sec.index > 0) {
      const prev = docSections(editor)[sec.index - 1];
      if (prev?.breakPos != null) setBreakKind(editor, prev.breakPos, start);
    }
    onClose();
  };

  return (
    <>
      <Typography level="h4">Page setup</Typography>
      <Tabs defaultValue={initialTab} sx={{ bgcolor: "transparent" }}>
        <TabList size="sm">
          <Tab>Margins</Tab>
          <Tab>Paper</Tab>
          <Tab>Layout</Tab>
        </TabList>
        <TabPanel value={0} sx={{ px: 0 }}>
          <Section title="Orientation">
            <Box sx={{ display: "flex", gap: 1 }}>
              {(["portrait", "landscape"] as const).map((o) => (
                <Button
                  key={o}
                  size="sm"
                  data-testid={`orient-${o}`}
                  variant={p.orient === o ? "solid" : "outlined"}
                  color={p.orient === o ? "primary" : "neutral"}
                  onClick={() => {
                    const next = setOrientation(p, o);
                    set({ orient: next.orient, pageW: next.pageW, pageH: next.pageH, margins: next.margins });
                  }}
                  sx={{ flex: 1, textTransform: "capitalize" }}
                >
                  {o}
                </Button>
              ))}
            </Box>
          </Section>
          <Section title="Margins">
            <Select
              size="sm"
              placeholder="Preset…"
              value={null}
              onChange={(_, id) => {
                const pr = MARGIN_PRESETS.find((x) => x.id === id);
                if (!pr) return;
                setM(pr.margins);
                setMirror(!!pr.mirror);
              }}
              slotProps={{ button: { "aria-label": "Margin preset" } }}
              sx={{ mb: 1 }}
            >
              {MARGIN_PRESETS.map((pr) => (
                <Option key={pr.id} value={pr.id}>
                  {pr.name} — {toIn(pr.margins.top)}" / {toIn(pr.margins.left)}"
                </Option>
              ))}
            </Select>
            <Stack spacing={1}>
              <Box sx={{ display: "flex", gap: 1 }}>
                <NumIn label="Top" value={m.top} onChange={(v) => setM({ top: v })} testid="margin-top" />
                <NumIn label="Bottom" value={m.bottom} onChange={(v) => setM({ bottom: v })} testid="margin-bottom" />
              </Box>
              <Box sx={{ display: "flex", gap: 1 }}>
                <NumIn label={mirror ? "Inside" : "Left"} value={m.left} onChange={(v) => setM({ left: v })} testid="margin-left" />
                <NumIn label={mirror ? "Outside" : "Right"} value={m.right} onChange={(v) => setM({ right: v })} testid="margin-right" />
              </Box>
              <Box sx={{ display: "flex", gap: 1 }}>
                <NumIn label="Gutter" value={m.gutter} onChange={(v) => setM({ gutter: v })} testid="margin-gutter" />
                <Box sx={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
                  <Checkbox size="sm" label="Mirror margins" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
                </Box>
              </Box>
              <Box sx={{ display: "flex", gap: 1 }}>
                <NumIn label="Header from top" value={m.header} onChange={(v) => setM({ header: v })} />
                <NumIn label="Footer from bottom" value={m.footer} onChange={(v) => setM({ footer: v })} />
              </Box>
            </Stack>
          </Section>
        </TabPanel>
        <TabPanel value={1} sx={{ px: 0 }}>
          <Section title="Paper size">
            <Select
              size="sm"
              value={sizeId}
              onChange={(_, id) => {
                const s = PAGE_SIZES.find((x) => x.id === id);
                if (s) {
                  const n = setPageSize(p, s.w, s.h);
                  set({ pageW: n.pageW, pageH: n.pageH });
                }
              }}
              slotProps={{ button: { "aria-label": "Paper size", "data-testid": "paper-size" } }}
            >
              {PAGE_SIZES.map((s) => (
                <Option key={s.id} value={s.id}>
                  {s.name} ({toIn(s.w)}" × {toIn(s.h)}")
                </Option>
              ))}
              <Option value="custom">Custom</Option>
            </Select>
            <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
              <NumIn label="Width" value={p.pageW} onChange={(v) => set({ pageW: Math.max(72, v), orient: v > p.pageH ? "landscape" : "portrait" })} testid="page-width" />
              <NumIn label="Height" value={p.pageH} onChange={(v) => set({ pageH: Math.max(72, v), orient: p.pageW > v ? "landscape" : "portrait" })} testid="page-height" />
            </Box>
          </Section>
        </TabPanel>
        <TabPanel value={2} sx={{ px: 0 }}>
          {sec.index > 0 && (
            <Section title="Section start">
              <Select size="sm" value={start} onChange={(_, v) => v && setStart(v)} slotProps={{ button: { "aria-label": "Section start" } }}>
                {SECTION_STARTS.map((k) => (
                  <Option key={k} value={k}>
                    {SECTION_START_LABEL[k]}
                  </Option>
                ))}
              </Select>
            </Section>
          )}
          <Section title="Columns">
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: 1 }}>
              {COLUMN_PRESETS.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant="outlined"
                  color="neutral"
                  data-testid={`columns-${c.id}`}
                  onClick={() => set({ cols: c.apply(p).cols })}
                >
                  {c.name}
                </Button>
              ))}
            </Box>
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
              <NumIn label="Number of columns" unit="" step={1} value={p.cols.num} onChange={(v) => set({ cols: setEqualColumns(p, Math.max(1, Math.min(12, Math.round(v))), p.cols.space).cols })} testid="columns-num" />
              <NumIn label="Spacing" value={p.cols.space} onChange={(v) => set({ cols: { ...p.cols, space: v, spaces: p.cols.spaces?.map(() => v) } })} testid="columns-space" />
              <Checkbox size="sm" label="Line between" checked={p.cols.sep} onChange={(e) => set({ cols: { ...p.cols, sep: e.target.checked } })} sx={{ mb: 0.5 }} />
            </Box>
            <Typography level="body-xs" sx={{ mt: 0.5, opacity: 0.7 }}>
              Widths: {cw.widths.map((w) => `${toIn(w)}"`).join(", ")} of {toIn(contentWidth(p))}"
            </Typography>
          </Section>
          <Section title="Headers and footers">
            <Stack spacing={0.5}>
              <Checkbox size="sm" label="Different first page" checked={p.titlePg} onChange={(e) => set({ titlePg: e.target.checked })} />
              <Checkbox size="sm" label="Different odd and even pages" checked={evenOdd} onChange={(e) => setEvenOdd(e.target.checked)} />
            </Stack>
          </Section>
          <Section title="Line numbers">
            <Checkbox size="sm" label="Add line numbering" checked={!!ln} onChange={(e) => setLn(e.target.checked ? {} : null)} data-testid="line-numbers-on" />
            {ln && (
              <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
                <NumIn label="Start at" unit="" step={1} value={ln.start} onChange={(v) => setLn({ start: Math.max(1, Math.round(v)) })} />
                <NumIn label="Count by" unit="" step={1} value={ln.countBy} onChange={(v) => setLn({ countBy: Math.max(1, Math.round(v)) })} />
                <NumIn label="From text" value={ln.distance} onChange={(v) => setLn({ distance: v })} />
                <Box sx={{ flexBasis: "100%" }}>
                  <RadioGroup orientation="horizontal" value={ln.restart} onChange={(e) => setLn({ restart: e.target.value as LineNumbering["restart"] })} sx={{ gap: 2 }}>
                    <Radio size="sm" value="newPage" label="Restart each page" />
                    <Radio size="sm" value="newSection" label="Restart each section" />
                    <Radio size="sm" value="continuous" label="Continuous" />
                  </RadioGroup>
                </Box>
              </Box>
            )}
          </Section>
          <Section title="Page numbering">
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
              <Select
                size="sm"
                value={p.pgNum.fmt ?? "decimal"}
                onChange={(_, v) => v && set({ pgNum: { ...p.pgNum, fmt: v } })}
                slotProps={{ button: { "aria-label": "Number format" } }}
                sx={{ flex: 1 }}
              >
                <Option value="decimal">1, 2, 3</Option>
                <Option value="lowerRoman">i, ii, iii</Option>
                <Option value="upperRoman">I, II, III</Option>
                <Option value="lowerLetter">a, b, c</Option>
                <Option value="upperLetter">A, B, C</Option>
              </Select>
              <Checkbox size="sm" label="Start at" checked={p.pgNum.start != null} onChange={(e) => set({ pgNum: { ...p.pgNum, start: e.target.checked ? 1 : null } })} sx={{ mb: 0.5 }} />
              {p.pgNum.start != null && (
                <NumIn label="" unit="" step={1} value={p.pgNum.start} onChange={(v) => set({ pgNum: { ...p.pgNum, start: Math.max(0, Math.round(v)) } })} />
              )}
            </Box>
          </Section>
          <Section title="Page borders">
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Select
                size="sm"
                value={b ? b.style : "none"}
                onChange={(_, v) => setB(v === "none" || !v ? null : { style: v as PageBorders["style"] })}
                slotProps={{ button: { "aria-label": "Page border" } }}
              >
                <Option value="none">None</Option>
                <Option value="single">Box</Option>
                <Option value="double">Double</Option>
                <Option value="dashed">Dashed</Option>
                <Option value="dotted">Dotted</Option>
                <Option value="thick">Thick</Option>
              </Select>
              {b && (
                <>
                  <Input size="sm" type="color" value={b.color} onChange={(e) => setB({ color: e.target.value })} sx={{ width: 64 }} slotProps={{ input: { "aria-label": "Border color" } }} />
                  <NumIn label="Width" unit="pt" step={0.25} value={b.width} onChange={(v) => setB({ width: v })} />
                  <Select size="sm" value={b.display} onChange={(_, v) => v && setB({ display: v })} slotProps={{ button: { "aria-label": "Border pages" } }}>
                    <Option value="all">All pages</Option>
                    <Option value="first">First page only</Option>
                    <Option value="notFirst">All but first</Option>
                  </Select>
                </>
              )}
            </Box>
          </Section>
        </TabPanel>
      </Tabs>
      <ApplyTo value={scope} onChange={setScope} multi={multi} />
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}>
        <Button variant="plain" color="neutral" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={ok} data-testid="page-setup-ok">
          OK
        </Button>
      </Box>
    </>
  );
}

// --- watermark ---------------------------------------------------------------------------------

function WatermarkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const cur = getSettings(editor).watermark;
  const [w, setW] = useState<Watermark>(cur ?? { type: "text", text: "CONFIDENTIAL", font: "Calibri", size: "auto", color: "#c0c0c0", semitransparent: true, layout: "diagonal" });
  const set = (patch: Partial<Watermark>) => setW((x) => ({ ...x, ...patch }));
  return (
    <>
      <Typography level="h4">Watermark</Typography>
      <RadioGroup orientation="horizontal" value={w.type} onChange={(e) => set({ type: e.target.value as Watermark["type"] })} sx={{ gap: 2, mt: 1 }}>
        <Radio size="sm" value="none" label="None" />
        <Radio size="sm" value="text" label="Text" />
        <Radio size="sm" value="image" label="Image" />
      </RadioGroup>
      {w.type === "text" && (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          <Input size="sm" value={w.text ?? ""} onChange={(e) => set({ text: e.target.value })} slotProps={{ input: { "aria-label": "Watermark text", "data-testid": "watermark-text" } }} />
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Select size="sm" value={w.font ?? "Calibri"} onChange={(_, v) => v && set({ font: v })} slotProps={{ button: { "aria-label": "Font" } }}>
              {["Calibri", "Arial", "Georgia", "Times New Roman", "Verdana"].map((f) => (
                <Option key={f} value={f}>
                  {f}
                </Option>
              ))}
            </Select>
            <Select size="sm" value={String(w.size ?? "auto")} onChange={(_, v) => v && set({ size: v === "auto" ? "auto" : Number(v) })} slotProps={{ button: { "aria-label": "Size" } }}>
              {["auto", "36", "48", "72", "96", "144"].map((s) => (
                <Option key={s} value={s}>
                  {s === "auto" ? "Auto" : `${s} pt`}
                </Option>
              ))}
            </Select>
            <Input size="sm" type="color" value={w.color ?? "#c0c0c0"} onChange={(e) => set({ color: e.target.value })} sx={{ width: 64 }} slotProps={{ input: { "aria-label": "Color" } }} />
          </Box>
          <Checkbox size="sm" label="Semitransparent" checked={w.semitransparent !== false} onChange={(e) => set({ semitransparent: e.target.checked })} />
          <RadioGroup orientation="horizontal" value={w.layout ?? "diagonal"} onChange={(e) => set({ layout: e.target.value as Watermark["layout"] })} sx={{ gap: 2 }}>
            <Radio size="sm" value="diagonal" label="Diagonal" />
            <Radio size="sm" value="horizontal" label="Horizontal" />
          </RadioGroup>
        </Stack>
      )}
      {w.type === "image" && (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          <Input size="sm" placeholder="Image URL" value={w.image?.startsWith("data:") ? "(uploaded image)" : w.image ?? ""} onChange={(e) => set({ image: e.target.value })} slotProps={{ input: { "aria-label": "Image URL" } }} />
          <Button size="sm" variant="outlined" component="label">
            Upload image…
            <input
              hidden
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => set({ image: String(r.result) });
                r.readAsDataURL(f);
              }}
            />
          </Button>
          <Checkbox size="sm" label="Washout" checked={w.washout !== false} onChange={(e) => set({ washout: e.target.checked })} />
        </Stack>
      )}
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}>
        <Button variant="plain" color="neutral" onClick={onClose}>
          Cancel
        </Button>
        <Button
          data-testid="watermark-ok"
          onClick={() => {
            setDocSettings(editor, { watermark: w.type === "none" ? null : w });
            onClose();
          }}
        >
          OK
        </Button>
      </Box>
    </>
  );
}

// --- hyphenation ---------------------------------------------------------------------------------

function HyphenationDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [h, setH] = useState(getSettings(editor).hyphenation ?? DEFAULT_HYPHENATION);
  return (
    <>
      <Typography level="h4">Hyphenation</Typography>
      <Stack spacing={1} sx={{ mt: 1 }}>
        <Checkbox size="sm" label="Automatically hyphenate document" checked={h.auto} onChange={(e) => setH({ ...h, auto: e.target.checked })} />
        <Checkbox size="sm" label="Hyphenate words in CAPS" checked={h.caps} onChange={(e) => setH({ ...h, caps: e.target.checked })} />
        <Box sx={{ display: "flex", gap: 1 }}>
          <NumIn label="Hyphenation zone" value={h.zone} onChange={(v) => setH({ ...h, zone: v })} />
          <NumIn label="Limit consecutive hyphens (0 = none)" unit="" step={1} value={h.limit} onChange={(v) => setH({ ...h, limit: Math.max(0, Math.round(v)) })} />
        </Box>
        <Typography level="body-xs" sx={{ opacity: 0.7 }}>
          Hyphenation uses the browser's dictionaries (CSS hyphens); the zone and the limit apply where the browser supports them.
        </Typography>
      </Stack>
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}>
        <Button variant="plain" color="neutral" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            setDocSettings(editor, { hyphenation: h });
            onClose();
          }}
        >
          OK
        </Button>
      </Box>
    </>
  );
}

// --- headers and footers ------------------------------------------------------------------------

/** Copies a fragment's content into an empty one (unlinking keeps what
 *  the section showed, as Word does). */
function copyFragment(ydoc: Y.Doc, from: string, to: string) {
  const src = ydoc.getXmlFragment(from);
  const dst = ydoc.getXmlFragment(to);
  if (!src.length || dst.length) return;
  const node = yXmlFragmentToProseMirrorRootNode(src, marginSchema());
  prosemirrorJSONToYXmlFragment(marginSchema(), node.toJSON(), dst);
}

/** setLinked links or unlinks a section's header/footer part. */
export function setLinked(editor: Editor, ydoc: Y.Doc | null, which: HfWhich, kind: HfKind, linked: boolean) {
  const secs = docSections(editor);
  const sec = currentSection(editor);
  if (sec.index === 0) return;
  const key = hfKey(which, kind);
  if (!linked && ydoc) copyFragment(ydoc, hfFragment(secs, sec.index - 1, which, kind), ownFragment(secs, sec.index, which, kind));
  setSectionProps(editor, (p) => ({ ...p, own: linked ? p.own.filter((x) => x !== key) : [...new Set([...p.own, key])] }));
}

function HeaderFooterDialog({ editor, ydoc, onClose }: { editor: Editor; ydoc: Y.Doc | null; onClose: () => void }) {
  const [version, setVersion] = useState(0);
  const sec = useMemo(() => currentSection(editor), [editor, version]);
  const settings = useMemo(() => getSettings(editor), [editor, version]);
  const bump = () => setVersion((v) => v + 1);
  const kinds: HfKind[] = ["default", ...(sec.props.titlePg ? (["first"] as const) : []), ...(settings.evenOdd ? (["even"] as const) : [])];
  return (
    <>
      <Typography level="h4">Header &amp; footer options</Typography>
      <Typography level="body-sm" sx={{ opacity: 0.7 }}>
        Section {sec.index + 1}
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 1 }}>
        <Checkbox
          size="sm"
          label="Different first page"
          checked={sec.props.titlePg}
          data-testid="hf-first"
          onChange={(e) => {
            setSectionProps(editor, { titlePg: e.target.checked });
            bump();
          }}
        />
        <Checkbox
          size="sm"
          label="Different odd and even pages"
          checked={settings.evenOdd}
          data-testid="hf-evenodd"
          onChange={(e) => {
            setDocSettings(editor, { evenOdd: e.target.checked });
            bump();
          }}
        />
      </Stack>
      {sec.index > 0 && (
        <Section title="Link to previous section">
          <Stack spacing={0.5}>
            {kinds.flatMap((k) =>
              (["header", "footer"] as const).map((w) => (
                <Checkbox
                  key={`${w}${k}`}
                  size="sm"
                  label={`${w === "header" ? "Header" : "Footer"}${k === "default" ? "" : k === "first" ? " (first page)" : " (even pages)"}`}
                  checked={!sec.props.own.includes(hfKey(w, k))}
                  data-testid={`hf-link-${w}-${k}`}
                  onChange={(e) => {
                    setLinked(editor, ydoc, w, k, e.target.checked);
                    bump();
                  }}
                />
              )),
            )}
          </Stack>
        </Section>
      )}
      <Typography level="body-xs" sx={{ mt: 1.5, opacity: 0.7 }}>
        Double-click a page's header or footer to edit it. Alt+Shift+P inserts the page number there.
      </Typography>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2 }}>
        <Button onClick={onClose}>Done</Button>
      </Box>
    </>
  );
}

// --- page numbers ------------------------------------------------------------------------------

/** insertPageNumber appends "PAGE" (or "Page X of Y") to the section's
 *  header or footer fragment, aligned. */
export function insertPageNumber(
  editor: Editor,
  ydoc: Y.Doc,
  where: HfWhich,
  align: "left" | "center" | "right",
  opts: { ofTotal?: boolean; kind?: HfKind } = {},
) {
  const secs = docSections(editor);
  const sec = currentSection(editor);
  const frag = ydoc.getXmlFragment(hfFragment(secs, sec.index, where, opts.kind ?? "default"));
  ydoc.transact(() => {
    // Replace a lone empty paragraph.
    if (frag.length === 1) {
      const only = frag.get(0) as Y.XmlElement;
      if (only instanceof Y.XmlElement && only.nodeName === "paragraph" && only.length === 0) frag.delete(0, 1);
    }
    const para = new Y.XmlElement("paragraph");
    if (align !== "left") para.setAttribute("textAlign", align);
    const field = (instr: string) => {
      const f = new Y.XmlElement("field");
      f.setAttribute("instr", instr);
      return f;
    };
    frag.insert(frag.length, [para]);
    if (opts.ofTotal) {
      const t1 = new Y.XmlText();
      const t2 = new Y.XmlText();
      para.insert(0, [t1, field("PAGE"), t2, field("NUMPAGES")]);
      t1.insert(0, "Page ");
      t2.insert(0, " of ");
    } else para.insert(0, [field("PAGE")]);
  });
}

function PageNumbersDialog({ editor, ydoc, onClose }: { editor: Editor; ydoc: Y.Doc | null; onClose: () => void }) {
  const sec = currentSection(editor);
  const [where, setWhere] = useState<HfWhich>("footer");
  const [align, setAlign] = useState<"left" | "center" | "right">("right");
  const [ofTotal, setOfTotal] = useState(false);
  const [first, setFirst] = useState(!sec.props.titlePg);
  const [start, setStart] = useState<number | null>(sec.props.pgNum.start ?? null);
  const [fmt, setFmt] = useState<PageNumFmt>(sec.props.pgNum.fmt ?? "decimal");
  return (
    <>
      <Typography level="h4">Page numbers</Typography>
      <Section title="Position">
        <RadioGroup orientation="horizontal" value={where} onChange={(e) => setWhere(e.target.value as HfWhich)} sx={{ gap: 2 }}>
          <Radio size="sm" value="header" label="Header" data-testid="pn-header" />
          <Radio size="sm" value="footer" label="Footer" data-testid="pn-footer" />
        </RadioGroup>
        <RadioGroup orientation="horizontal" value={align} onChange={(e) => setAlign(e.target.value as typeof align)} sx={{ gap: 2, mt: 1 }}>
          <Radio size="sm" value="left" label="Left" />
          <Radio size="sm" value="center" label="Center" data-testid="pn-center" />
          <Radio size="sm" value="right" label="Right" />
        </RadioGroup>
      </Section>
      <Stack spacing={0.5} sx={{ mt: 1.5 }}>
        <Checkbox size="sm" label='"Page X of Y"' checked={ofTotal} onChange={(e) => setOfTotal(e.target.checked)} data-testid="pn-of-total" />
        <Checkbox size="sm" label="Show on first page" checked={first} onChange={(e) => setFirst(e.target.checked)} />
      </Stack>
      <Section title="Numbering">
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
          <Select size="sm" value={fmt} onChange={(_, v) => v && setFmt(v)} slotProps={{ button: { "aria-label": "Number format" } }}>
            <Option value="decimal">1, 2, 3</Option>
            <Option value="lowerRoman">i, ii, iii</Option>
            <Option value="upperRoman">I, II, III</Option>
            <Option value="lowerLetter">a, b, c</Option>
            <Option value="upperLetter">A, B, C</Option>
          </Select>
          <Checkbox size="sm" label="Start at" checked={start != null} onChange={(e) => setStart(e.target.checked ? 1 : null)} sx={{ mb: 0.5 }} />
          {start != null && <NumIn label="" unit="" step={1} value={start} onChange={(v) => setStart(Math.max(0, Math.round(v)))} />}
        </Box>
      </Section>
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}>
        <Button variant="plain" color="neutral" onClick={onClose}>
          Cancel
        </Button>
        <Button
          data-testid="pn-ok"
          onClick={() => {
            setSectionProps(editor, (p) => ({ ...p, titlePg: !first ? true : p.titlePg, pgNum: { start, fmt } }));
            if (ydoc) insertPageNumber(editor, ydoc, where, align, { ofTotal });
            window.dispatchEvent(new CustomEvent("grown-docs-show-hf"));
            onClose();
          }}
        >
          Insert
        </Button>
      </Box>
    </>
  );
}
