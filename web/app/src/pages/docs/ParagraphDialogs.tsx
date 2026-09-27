// Paragraph-level dialogs (M3): Paragraph settings (indents & spacing, line
// and page breaks, borders & shading, tabs), List settings and Set
// numbering value.
//
// They are mounted once (<ParagraphDialogs editor/>) and opened from any
// menu or toolbar with openParagraphDialog(kind), so callers need no dialog
// state of their own.
import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Select,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Typography,
} from "@mui/joy";
import type { Editor } from "@tiptap/react";
import { compiledProps, currentList, setNumberingValue, updateListLevel } from "./docModel";
import { selectedBlocks, spacingOf } from "./paragraphFormat";
import {
  directProps,
  type Align,
  type BorderSide,
  type BorderSpec,
  type Borders,
  type LineRule,
  type TabAlign,
  type TabLeader,
  type TabStop,
} from "./paragraphProps";
import { formatNumber, type LvlDef, type NumFmt } from "./numbering";

export type ParagraphDialogKind = "paragraph" | "listSettings" | "numberingValue";

const EVENT = "grown-docs-paragraph-dialog";

/** openParagraphDialog opens one of the mounted paragraph dialogs. */
export function openParagraphDialog(kind: ParagraphDialogKind): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: kind }));
}

export function ParagraphDialogs({ editor }: { editor: Editor | null }) {
  const [kind, setKind] = useState<ParagraphDialogKind | null>(null);
  useEffect(() => {
    const on = (e: Event) => setKind((e as CustomEvent<ParagraphDialogKind>).detail);
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
        sx={{ width: { xs: "calc(100vw - 32px)", sm: kind === "paragraph" ? 560 : 420 }, maxWidth: "calc(100vw - 32px)" }}
      >
        <ModalClose />
        {kind === "paragraph" && <ParagraphSettings editor={editor} onClose={close} />}
        {kind === "listSettings" && <ListSettings editor={editor} onClose={close} />}
        {kind === "numberingValue" && <NumberingValue editor={editor} onClose={close} />}
      </ModalDialog>
    </Modal>
  );
}

// --- helpers --------------------------------------------------------------------------

const IN = 72;
const num = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number) => String(Math.round(n * 100) / 100);

function Field({
  label,
  value,
  onChange,
  unit,
  width = 110,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  width?: number;
}) {
  return (
    <Box>
      <Typography level="body-xs">{label}</Typography>
      <Input
        size="sm"
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        endDecorator={unit}
        slotProps={{ input: { "aria-label": label, step: "any" } }}
        sx={{ width }}
      />
    </Box>
  );
}

function Actions({ onClose, onApply, ok = true }: { onClose: () => void; onApply: () => void; ok?: boolean }) {
  return (
    <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 2 }}>
      <Button variant="plain" onClick={onClose}>
        Cancel
      </Button>
      <Button onClick={onApply} disabled={!ok} data-testid="dialog-apply">
        Apply
      </Button>
    </Box>
  );
}

// --- paragraph settings ------------------------------------------------------------------

type Special = "none" | "firstLine" | "hanging";
const SIDES: BorderSide[] = ["top", "bottom", "left", "right"];

function ParagraphSettings({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const first = selectedBlocks(editor.state)[0];
  const c = first ? compiledProps(editor, first.node) : null;
  const d = first ? directProps(first.node) : {};
  const sp = first ? spacingOf(first.node) : { before: 0, after: 0 };

  const [left, setLeft] = useState(r2((c?.indLeft ?? 0) / IN));
  const [right, setRight] = useState(r2((c?.indRight ?? 0) / IN));
  const fl = c?.indFirstLine ?? 0;
  const [special, setSpecial] = useState<Special>(fl > 0 ? "firstLine" : fl < 0 ? "hanging" : "none");
  const [by, setBy] = useState(r2(Math.abs(fl) / IN || 0.5));
  const [align, setAlign] = useState<Align>(c?.align ?? "left");
  const [before, setBefore] = useState(r2(d.spaceBefore ?? sp.before));
  const [after, setAfter] = useState(r2(d.spaceAfter ?? sp.after));
  const [rule, setRule] = useState<LineRule>(d.lineRule ?? "auto");
  const [line, setLine] = useState(r2(d.lineValue ?? (d.lineRule && d.lineRule !== "auto" ? 12 : 1.15)));
  const [outline, setOutline] = useState<string>(d.outlineLevel && d.outlineLevel <= 9 ? String(d.outlineLevel) : "body");
  const [keepNext, setKeepNext] = useState(!!d.keepNext);
  const [keepLines, setKeepLines] = useState(!!d.keepLines);
  const [widow, setWidow] = useState(d.widowControl !== false);
  const [pbb, setPbb] = useState(!!d.pageBreakBefore);
  const b0 = d.borders ?? {};
  const firstBorder = SIDES.map((s) => b0[s]).find(Boolean);
  const [sides, setSides] = useState<Record<BorderSide, boolean>>({
    top: !!b0.top,
    bottom: !!b0.bottom,
    left: !!b0.left,
    right: !!b0.right,
    between: false,
  });
  const [bWidth, setBWidth] = useState(r2(firstBorder?.width ?? 1));
  const [bStyle, setBStyle] = useState<BorderSpec["style"]>(firstBorder?.style ?? "solid");
  const [bColor, setBColor] = useState(firstBorder?.color ?? "#000000");
  const [shading, setShading] = useState(d.shading ?? "");
  const [tabs, setTabs] = useState<TabStop[]>(d.tabs ?? []);
  const [tabPos, setTabPos] = useState("1");
  const [tabAlign, setTabAlign] = useState<TabAlign>("left");
  const [tabLeader, setTabLeader] = useState<TabLeader>("none");

  const apply = () => {
    const byPt = (num(by) ?? 0) * IN;
    const borders: Borders = {};
    for (const s of SIDES) if (sides[s]) borders[s] = { width: num(bWidth) ?? 1, style: bStyle, color: bColor };
    const lineValue = num(line);
    editor
      .chain()
      .focus()
      .setParagraphProps({
        indLeft: (num(left) ?? 0) * IN,
        indRight: (num(right) ?? 0) * IN,
        indFirstLine: special === "none" ? null : special === "firstLine" ? byPt : -byPt,
        align,
        spaceBefore: num(before),
        spaceAfter: num(after),
        lineRule: rule,
        lineValue: lineValue && lineValue > 0 ? lineValue : null,
        outlineLevel: outline === "body" ? null : parseInt(outline, 10),
        keepNext,
        keepLines,
        widowControl: widow,
        pageBreakBefore: pbb,
        borders,
        shading: shading || null,
        tabs,
      })
      .run();
    onClose();
  };

  return (
    <>
      <Typography level="h4">Paragraph settings</Typography>
      <Tabs defaultValue={0} sx={{ bgcolor: "transparent" }}>
        <TabList size="sm">
          <Tab>Indents & spacing</Tab>
          <Tab>Line & page breaks</Tab>
          <Tab>Borders & shading</Tab>
          <Tab>Tabs</Tab>
        </TabList>
        <TabPanel value={0}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Box>
                <Typography level="body-xs">Alignment</Typography>
                <Select size="sm" value={align} onChange={(_, v) => v && setAlign(v)} sx={{ width: 120 }} aria-label="Alignment">
                  <Option value="left">Left</Option>
                  <Option value="center">Center</Option>
                  <Option value="right">Right</Option>
                  <Option value="justify">Justified</Option>
                </Select>
              </Box>
              <Box>
                <Typography level="body-xs">Outline level</Typography>
                <Select size="sm" value={outline} onChange={(_, v) => v && setOutline(v)} sx={{ width: 120 }} aria-label="Outline level">
                  <Option value="body">Body text</Option>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => (
                    <Option key={l} value={String(l)}>
                      Level {l}
                    </Option>
                  ))}
                </Select>
              </Box>
            </Stack>
            <Typography level="title-sm">Indentation</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Field label="Left" value={left} onChange={setLeft} unit="in" />
              <Field label="Right" value={right} onChange={setRight} unit="in" />
              <Box>
                <Typography level="body-xs">Special</Typography>
                <Select size="sm" value={special} onChange={(_, v) => v && setSpecial(v)} sx={{ width: 120 }} aria-label="Special indent">
                  <Option value="none">(none)</Option>
                  <Option value="firstLine">First line</Option>
                  <Option value="hanging">Hanging</Option>
                </Select>
              </Box>
              {special !== "none" && <Field label="By" value={by} onChange={setBy} unit="in" />}
            </Stack>
            <Typography level="title-sm">Spacing</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Field label="Before" value={before} onChange={setBefore} unit="pt" />
              <Field label="After" value={after} onChange={setAfter} unit="pt" />
              <Box>
                <Typography level="body-xs">Line spacing</Typography>
                <Select size="sm" value={rule} onChange={(_, v) => v && setRule(v)} sx={{ width: 120 }} aria-label="Line spacing rule">
                  <Option value="auto">Multiple</Option>
                  <Option value="atLeast">At least</Option>
                  <Option value="exact">Exactly</Option>
                </Select>
              </Box>
              <Field label="At" value={line} onChange={setLine} unit={rule === "auto" ? "×" : "pt"} />
            </Stack>
          </Stack>
        </TabPanel>
        <TabPanel value={1}>
          <Stack spacing={1}>
            <Checkbox label="Widow/orphan control" checked={widow} onChange={(e) => setWidow(e.target.checked)} />
            <Checkbox label="Keep with next" checked={keepNext} onChange={(e) => setKeepNext(e.target.checked)} />
            <Checkbox label="Keep lines together" checked={keepLines} onChange={(e) => setKeepLines(e.target.checked)} />
            <Checkbox label="Page break before" checked={pbb} onChange={(e) => setPbb(e.target.checked)} />
          </Stack>
        </TabPanel>
        <TabPanel value={2}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={2}>
              {SIDES.map((s) => (
                <Checkbox
                  key={s}
                  label={s[0].toUpperCase() + s.slice(1)}
                  checked={sides[s]}
                  onChange={(e) => setSides({ ...sides, [s]: e.target.checked })}
                />
              ))}
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="flex-end">
              <Field label="Width" value={bWidth} onChange={setBWidth} unit="pt" />
              <Box>
                <Typography level="body-xs">Style</Typography>
                <Select size="sm" value={bStyle} onChange={(_, v) => v && setBStyle(v)} sx={{ width: 110 }} aria-label="Border style">
                  <Option value="solid">Solid</Option>
                  <Option value="dashed">Dashed</Option>
                  <Option value="dotted">Dotted</Option>
                  <Option value="double">Double</Option>
                </Select>
              </Box>
              <Box>
                <Typography level="body-xs">Colour</Typography>
                <Input size="sm" type="color" value={bColor} onChange={(e) => setBColor(e.target.value)} sx={{ width: 70 }} slotProps={{ input: { "aria-label": "Border colour" } }} />
              </Box>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="flex-end">
              <Box>
                <Typography level="body-xs">Shading</Typography>
                <Input size="sm" type="color" value={shading || "#ffffff"} onChange={(e) => setShading(e.target.value)} sx={{ width: 70 }} slotProps={{ input: { "aria-label": "Shading colour" } }} />
              </Box>
              <Button size="sm" variant="plain" onClick={() => setShading("")}>
                No shading
              </Button>
            </Stack>
          </Stack>
        </TabPanel>
        <TabPanel value={3}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="flex-end" flexWrap="wrap" useFlexGap>
              <Field label="Tab stop position" value={tabPos} onChange={setTabPos} unit="in" width={130} />
              <Select size="sm" value={tabAlign} onChange={(_, v) => v && setTabAlign(v)} sx={{ width: 100 }} aria-label="Tab alignment">
                <Option value="left">Left</Option>
                <Option value="center">Center</Option>
                <Option value="right">Right</Option>
                <Option value="decimal">Decimal</Option>
              </Select>
              <Select size="sm" value={tabLeader} onChange={(_, v) => v && setTabLeader(v)} sx={{ width: 110 }} aria-label="Tab leader">
                <Option value="none">No leader</Option>
                <Option value="dot">.......</Option>
                <Option value="hyphen">-------</Option>
                <Option value="underscore">_______</Option>
              </Select>
              <Button
                size="sm"
                onClick={() => {
                  const p = num(tabPos);
                  if (p == null || p <= 0) return;
                  const pos = Math.round(p * IN * 100) / 100;
                  setTabs([...tabs.filter((t) => t.pos !== pos), { pos, align: tabAlign, leader: tabLeader }].sort((a, b) => a.pos - b.pos));
                }}
              >
                Set
              </Button>
            </Stack>
            {tabs.length === 0 && <Typography level="body-sm">No custom tab stops (default every 0.5 in).</Typography>}
            {tabs.map((t) => (
              <Stack key={t.pos} direction="row" spacing={1} alignItems="center">
                <Typography level="body-sm" sx={{ flex: 1 }}>
                  {r2(t.pos / IN)} in · {t.align}
                  {t.leader !== "none" ? ` · ${t.leader} leader` : ""}
                </Typography>
                <Button size="sm" variant="plain" color="danger" onClick={() => setTabs(tabs.filter((x) => x !== t))}>
                  Clear
                </Button>
              </Stack>
            ))}
          </Stack>
        </TabPanel>
      </Tabs>
      <Actions onClose={onClose} onApply={apply} />
    </>
  );
}

// --- list settings -------------------------------------------------------------------

const FORMATS: { fmt: NumFmt; label: string }[] = [
  { fmt: "decimal", label: "1, 2, 3" },
  { fmt: "decimalZero", label: "01, 02, 03" },
  { fmt: "lowerLetter", label: "a, b, c" },
  { fmt: "upperLetter", label: "A, B, C" },
  { fmt: "lowerRoman", label: "i, ii, iii" },
  { fmt: "upperRoman", label: "I, II, III" },
  { fmt: "bullet", label: "Bullet" },
  { fmt: "none", label: "None" },
];

function ListSettings({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const list = currentList(editor);
  const [lvl, setLvl] = useState(list?.lvl ?? 0);
  const def: LvlDef | undefined = list?.lvls[lvl];
  const [draft, setDraft] = useState<Record<number, LvlDef>>({});
  if (!list || !def) {
    return (
      <>
        <Typography level="h4">List settings</Typography>
        <Typography level="body-sm">Place the cursor in a numbered or bulleted paragraph first.</Typography>
      </>
    );
  }
  const cur = draft[lvl] ?? def;
  const set = (patch: Partial<LvlDef>) => setDraft({ ...draft, [lvl]: { ...cur, ...patch } });
  const preview =
    cur.fmt === "bullet" ? cur.text : cur.text.replace(/%([1-9])/g, (_, k: string) => {
      const l = +k - 1 === lvl ? cur : list.lvls[+k - 1];
      return l ? formatNumber(l.start, l.fmt) : "";
    });
  const apply = () => {
    for (const [k, v] of Object.entries(draft)) updateListLevel(editor, +k, v);
    onClose();
  };
  return (
    <>
      <Typography level="h4">List settings</Typography>
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        <Stack direction="row" spacing={1} alignItems="flex-end">
          <Box>
            <Typography level="body-xs">Level</Typography>
            <Select size="sm" value={lvl} onChange={(_, v) => v != null && setLvl(v)} sx={{ width: 90 }} aria-label="List level">
              {list.lvls.map((_, i) => (
                <Option key={i} value={i}>
                  {i + 1}
                </Option>
              ))}
            </Select>
          </Box>
          <Box>
            <Typography level="body-xs">Type</Typography>
            <Select
              size="sm"
              value={cur.fmt}
              onChange={(_, v) => v && set({ fmt: v, text: v === "bullet" ? "•" : cur.fmt === "bullet" ? `%${lvl + 1}.` : cur.text })}
              sx={{ width: 140 }}
              aria-label="Number format"
            >
              {FORMATS.map((f) => (
                <Option key={f.fmt} value={f.fmt}>
                  {f.label}
                </Option>
              ))}
            </Select>
          </Box>
          <Box>
            <Typography level="body-xs">{cur.fmt === "bullet" ? "Symbol" : "Number format"}</Typography>
            <Input size="sm" value={cur.text} onChange={(e) => set({ text: e.target.value })} sx={{ width: 110 }} slotProps={{ input: { "aria-label": "Level text" } }} />
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {cur.fmt !== "bullet" && (
            <Field label="Start at" value={String(cur.start)} onChange={(v) => set({ start: Math.max(0, Math.floor(num(v) ?? 1)) })} />
          )}
          <Field label="Indent" value={r2(cur.indLeft / IN)} onChange={(v) => set({ indLeft: (num(v) ?? 0) * IN })} unit="in" />
          <Field label="Hanging" value={r2(cur.hanging / IN)} onChange={(v) => set({ hanging: (num(v) ?? 0) * IN })} unit="in" />
          <Box>
            <Typography level="body-xs">Follow number with</Typography>
            <Select size="sm" value={cur.suffix ?? "tab"} onChange={(_, v) => v && set({ suffix: v })} sx={{ width: 120 }} aria-label="Follow number with">
              <Option value="tab">Tab</Option>
              <Option value="space">Space</Option>
              <Option value="nothing">Nothing</Option>
            </Select>
          </Box>
        </Stack>
        <Typography level="body-sm">
          Preview: <b>{preview}</b>
        </Typography>
        <Typography level="body-xs" sx={{ opacity: 0.7 }}>
          Use %1 … %9 in the number format for the numbers of levels 1 to 9.
        </Typography>
      </Stack>
      <Actions onClose={onClose} onApply={apply} ok={Object.keys(draft).length > 0} />
    </>
  );
}

// --- set numbering value --------------------------------------------------------------------

function NumberingValue({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const list = currentList(editor);
  const [value, setValue] = useState(String(list?.value ?? 1));
  if (!list) {
    return (
      <>
        <Typography level="h4">Set numbering value</Typography>
        <Typography level="body-sm">Place the cursor in a numbered paragraph first.</Typography>
      </>
    );
  }
  const v = num(value);
  return (
    <>
      <Typography level="h4">Set numbering value</Typography>
      <Stack spacing={1} sx={{ mt: 1 }}>
        <Field label="Set value to" value={value} onChange={setValue} />
        <Typography level="body-sm">
          Preview: {v != null && v >= 0 ? formatNumber(Math.floor(v), list.def.fmt) : "—"}
        </Typography>
      </Stack>
      <Actions
        onClose={onClose}
        ok={v != null && v >= 0}
        onApply={() => {
          if (v != null) setNumberingValue(editor, v);
          onClose();
        }}
      />
    </>
  );
}
