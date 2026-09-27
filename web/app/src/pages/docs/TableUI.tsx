// Table UI (Docs M4): the insert-table size picker, the Table settings
// sidebar (style gallery, look switches, borders, cell properties, size,
// layout) and the Convert text to table dialog.
//
// The sidebar applies every change at once to the table (or selected
// cells) under the editor's selection, like OnlyOffice's right-hand table
// panel. It opens with openTableSettings(); DocEditor shows it as a side
// panel. The convert dialog opens with openConvertTextDialog().
import { useEffect, useReducer, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Divider,
  IconButton,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Radio,
  RadioGroup,
  Select,
  Sheet,
  Tooltip,
  Typography,
} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import type { Editor } from "@tiptap/react";
import {
  LOOK_KEYS,
  TABLE_TEMPLATES,
  encodeMargins,
  parseLook,
  parseMargins,
  type Margins,
  type TBorder,
  type TBorderStyle,
  type TableLook,
  type TableTemplate,
} from "./tableModel";
import {
  BORDER_PRESETS,
  applyCellBorders,
  applyTableStyle,
  autofitTable,
  clearCellBorders,
  currentCellAttrs,
  currentRowAttrs,
  currentTableAttrs,
  distributeColumns,
  distributeRows,
  insertTableSized,
  setCellProps,
  setColumnWidth,
  setLookOption,
  setRowHeight,
  setTableBorders,
  setTableProps,
  splitTable,
  tableToText,
  textToTable,
  toggleRepeatHeader,
  type BorderPreset,
  type TextSeparator,
} from "./tables";

// --- size picker ---------------------------------------------------------------------------

/** TableSizePicker is a hover grid: hovering (r, c) highlights an r x c
 *  block, clicking inserts it. */
export function TableSizePicker({
  onPick,
  rows = 8,
  cols = 10,
}: {
  onPick: (rows: number, cols: number) => void;
  rows?: number;
  cols?: number;
}) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  return (
    <Box sx={{ p: 1 }} onMouseLeave={() => setHover([0, 0])} data-testid="table-size-picker">
      <Box
        sx={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 16px)`, gap: "3px" }}
        role="grid"
        aria-label="Table size"
      >
        {Array.from({ length: rows * cols }, (_, i) => {
          const r = Math.floor(i / cols) + 1;
          const c = (i % cols) + 1;
          const on = r <= hover[0] && c <= hover[1];
          return (
            <Box
              key={i}
              role="gridcell"
              aria-label={`${r} x ${c}`}
              data-testid={`table-size-${r}x${c}`}
              onMouseEnter={() => setHover([r, c])}
              onFocus={() => setHover([r, c])}
              tabIndex={0}
              onClick={() => onPick(r, c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(r, c);
                }
              }}
              sx={{
                width: 16,
                height: 16,
                border: "1px solid",
                borderColor: on ? "#1a73e8" : "#c4c7c5",
                bgcolor: on ? "rgba(26,115,232,.18)" : "background.surface",
                borderRadius: "2px",
                cursor: "pointer",
              }}
            />
          );
        })}
      </Box>
      <Typography level="body-xs" sx={{ mt: 0.75, textAlign: "center" }} data-testid="table-size-label">
        {hover[0] ? `${hover[1]} × ${hover[0]}` : "Insert table"}
      </Typography>
    </Box>
  );
}

export function insertPickedTable(editor: Editor, rows: number, cols: number) {
  insertTableSized(editor, rows, cols, true);
}

// --- events -----------------------------------------------------------------------------------

const SETTINGS_EVENT = "grown-docs-table-settings";
const CONVERT_EVENT = "grown-docs-table-convert";

/** openTableSettings asks DocEditor to show the Table settings panel. */
export function openTableSettings(): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
}

export function onOpenTableSettings(fn: () => void): () => void {
  window.addEventListener(SETTINGS_EVENT, fn);
  return () => window.removeEventListener(SETTINGS_EVENT, fn);
}

/** openConvertTextDialog opens the Convert text to table dialog. */
export function openConvertTextDialog(): void {
  window.dispatchEvent(new CustomEvent(CONVERT_EVENT));
}

// --- style previews ----------------------------------------------------------------------------

function border(b: TBorder | undefined): string {
  if (!b || b.style === "none") return "1px solid transparent";
  return `1px ${b.style === "double" ? "double" : "solid"} ${b.color}`;
}

/** A 5 x 4 thumbnail of a template with the given look. */
function StylePreview({ t, look }: { t: TableTemplate | null; look: TableLook }) {
  const rows = 4;
  const cols = 5;
  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let bg = "transparent";
      let strong = false;
      if (t) {
        const bandRow = look.header ? r % 2 === 1 : r % 2 === 0;
        if (look.banded && t.band && bandRow && !(look.header && r === 0)) bg = t.band;
        if (look.firstCol && c === 0 && t.firstCol?.fill) bg = t.firstCol.fill;
        if (look.firstCol && c === 0 && t.firstCol?.bold) strong = true;
        if (look.header && r === 0 && t.header) {
          if (t.header.fill) bg = t.header.fill;
          if (t.header.bold) strong = true;
        }
      } else {
        if (r === 0) bg = "#f1f3f4";
      }
      const inner = t ? t.borders.insideH : { width: 1, style: "solid" as const, color: "#ccced1" };
      const innerV = t ? t.borders.insideV : inner;
      const outer = t ? t.borders : { top: inner, left: inner, right: inner, bottom: inner };
      cells.push(
        <Box
          key={`${r}-${c}`}
          sx={{
            height: 7,
            bgcolor: bg,
            borderTop: border(r === 0 ? outer.top : inner),
            borderBottom: border(r === rows - 1 ? outer.bottom : r === 0 && look.header ? t?.header?.edge ?? inner : inner),
            borderLeft: border(c === 0 ? outer.left : innerV),
            borderRight: border(c === cols - 1 ? outer.right : innerV),
            position: "relative",
            "&::after": strong
              ? { content: '""', position: "absolute", left: 2, right: 2, top: 3, height: 1, bgcolor: t?.header?.color === "#ffffff" && r === 0 ? "#fff" : "#444" }
              : undefined,
          }}
        />,
      );
    }
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, width: 64, borderCollapse: "collapse" }}>
      {cells}
    </Box>
  );
}

// --- settings panel -------------------------------------------------------------------------------

const BORDER_WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];
const BORDER_STYLES: TBorderStyle[] = ["solid", "dashed", "dotted", "double"];
const LOOK_LABEL: Record<keyof TableLook, string> = {
  header: "Header row",
  banded: "Banded rows",
  firstCol: "First column",
  lastRow: "Total row",
  lastCol: "Last column",
  bandedCols: "Banded columns",
};

const num = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number) => String(Math.round(n * 100) / 100);
const PX_PER_PT = 4 / 3;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography level="title-sm" sx={{ mb: 0.75 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function MarginFields({
  value,
  onChange,
  label,
}: {
  value: Margins | null;
  onChange: (m: Margins | null) => void;
  label: string;
}) {
  const [m, setM] = useState<Record<keyof Margins, string>>({ top: "", right: "", bottom: "", left: "" });
  useEffect(() => {
    setM({
      top: value ? r2(value.top) : "",
      right: value ? r2(value.right) : "",
      bottom: value ? r2(value.bottom) : "",
      left: value ? r2(value.left) : "",
    });
  }, [value?.top, value?.right, value?.bottom, value?.left]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (next: Record<keyof Margins, string>) => {
    const vals = (["top", "right", "bottom", "left"] as const).map((k) => num(next[k]));
    if (vals.every((v) => v == null)) onChange(null);
    else onChange({ top: vals[0] ?? 0, right: vals[1] ?? 0, bottom: vals[2] ?? 0, left: vals[3] ?? 0 });
  };
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
      {(["top", "bottom", "left", "right"] as const).map((k) => (
        <Input
          key={k}
          size="sm"
          type="number"
          value={m[k]}
          placeholder="auto"
          startDecorator={<Typography level="body-xs">{k[0].toUpperCase() + k.slice(1)}</Typography>}
          endDecorator="pt"
          slotProps={{ input: { "aria-label": `${label} ${k}`, step: "any", min: 0 } }}
          onChange={(e) => setM({ ...m, [k]: e.target.value })}
          onBlur={() => commit(m)}
          onKeyDown={(e) => e.key === "Enter" && commit(m)}
        />
      ))}
    </Box>
  );
}

/** TableSettings is the right-hand Table settings panel. */
export function TableSettings({ editor, onClose }: { editor: Editor | null; onClose: () => void }) {
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", refresh);
    return () => {
      editor.off("transaction", refresh);
    };
  }, [editor]);
  const [bStyle, setBStyle] = useState<TBorderStyle>("solid");
  const [bWidth, setBWidth] = useState(1);
  const [bColor, setBColor] = useState("#000000");
  const [scope, setScope] = useState<"cells" | "table">("cells");
  const [colW, setColW] = useState("");
  const [rowH, setRowH] = useState("");
  const [loaded, setLoaded] = useState({ colW: "", rowH: "" });

  const t = editor ? currentTableAttrs(editor) : null;
  const cell = editor ? currentCellAttrs(editor) : null;
  const rowA = editor ? currentRowAttrs(editor) : null;
  useEffect(() => {
    const cw = (cell?.colwidth as number[] | null)?.[0];
    const next = { colW: cw ? r2(cw / PX_PER_PT) : "", rowH: rowA?.height ? r2(rowA.height as number) : "" };
    setColW(next.colW);
    setRowH(next.rowH);
    setLoaded(next);
  }, [cell?.colwidth, rowA?.height]);
  const commitColW = () => {
    if (colW !== loaded.colW && num(colW)) setColumnWidth(editor!, num(colW)! * PX_PER_PT);
  };
  const commitRowH = () => {
    if (rowH !== loaded.rowH) setRowHeight(editor!, num(rowH));
  };

  const header = (
    <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
      <Typography level="title-md" sx={{ flex: 1 }}>
        Table settings
      </Typography>
      <IconButton size="sm" variant="plain" onClick={onClose} aria-label="Close table settings">
        <CloseIcon fontSize="small" />
      </IconButton>
    </Box>
  );
  const shell = (children: React.ReactNode) => (
    <Sheet
      variant="outlined"
      data-testid="table-settings"
      sx={{ width: 300, p: 1.5, borderRadius: "sm", height: "100%", overflowY: "auto", maxHeight: "calc(100vh - 140px)" }}
    >
      {header}
      {children}
    </Sheet>
  );
  if (!editor) return null;
  if (!t)
    return shell(
      <Typography level="body-sm" sx={{ opacity: 0.7 }}>
        Put the cursor in a table to change its settings.
      </Typography>,
    );

  const look = parseLook(t.look);
  const styleId = (t.tableStyle as string | null) ?? null;
  const spec: TBorder = { width: bWidth, style: bStyle, color: bColor };
  const applyPreset = (p: BorderPreset) =>
    scope === "table" ? setTableBorders(editor, p, spec) : applyCellBorders(editor, p, spec);

  return shell(
    <>
      <Section title="Table style">
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0.75 }}>
          {[null, ...TABLE_TEMPLATES].map((tpl) => {
            const id = tpl?.id ?? null;
            const selected = id === styleId;
            return (
              <Tooltip key={id ?? "none"} title={tpl?.name ?? "Default"} size="sm">
                <Box
                  component="button"
                  type="button"
                  aria-label={tpl?.name ?? "Default"}
                  aria-pressed={selected}
                  data-testid={`table-style-${id ?? "default"}`}
                  onClick={() => applyTableStyle(editor, id)}
                  sx={{
                    p: 0.75,
                    border: "2px solid",
                    borderColor: selected ? "#1a73e8" : "transparent",
                    borderRadius: "6px",
                    bgcolor: "background.surface",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "center",
                    "&:hover": { borderColor: selected ? "#1a73e8" : "neutral.outlinedBorder" },
                  }}
                >
                  <StylePreview t={tpl} look={look} />
                </Box>
              </Tooltip>
            );
          })}
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5, mt: 1 }}>
          {LOOK_KEYS.map((k) => (
            <Checkbox
              key={k}
              size="sm"
              label={LOOK_LABEL[k]}
              checked={look[k]}
              disabled={!styleId}
              onChange={(e) => setLookOption(editor, k, e.target.checked)}
            />
          ))}
        </Box>
      </Section>

      <Divider sx={{ mt: 1.5 }} />
      <Section title="Borders">
        <RadioGroup
          orientation="horizontal"
          size="sm"
          value={scope}
          onChange={(e) => setScope(e.target.value as "cells" | "table")}
          sx={{ gap: 2, mb: 1 }}
        >
          <Radio value="cells" label="Selected cells" />
          <Radio value="table" label="Whole table" />
        </RadioGroup>
        <Box sx={{ display: "flex", gap: 0.75, mb: 1 }}>
          <Select
            size="sm"
            value={bStyle}
            onChange={(_, v) => v && setBStyle(v)}
            slotProps={{ button: { "aria-label": "Border style" } }}
            sx={{ flex: 1 }}
          >
            {BORDER_STYLES.map((s) => (
              <Option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </Option>
            ))}
          </Select>
          <Select
            size="sm"
            value={bWidth}
            onChange={(_, v) => v != null && setBWidth(v)}
            slotProps={{ button: { "aria-label": "Border width" } }}
            sx={{ width: 90 }}
          >
            {BORDER_WIDTHS.map((w) => (
              <Option key={w} value={w}>
                {w} pt
              </Option>
            ))}
          </Select>
          <Input
            size="sm"
            type="color"
            value={bColor}
            onChange={(e) => setBColor(e.target.value)}
            slotProps={{ input: { "aria-label": "Border color" } }}
            sx={{ width: 52, p: 0.25, "& input": { p: 0, height: 24, cursor: "pointer" } }}
          />
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5 }}>
          {BORDER_PRESETS.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant="outlined"
              color="neutral"
              data-testid={`border-preset-${p.id}`}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </Box>
        {scope === "cells" && (
          <Button size="sm" variant="plain" sx={{ mt: 0.5 }} onClick={() => clearCellBorders(editor)}>
            Reset cell borders to the table's
          </Button>
        )}
      </Section>

      <Divider sx={{ mt: 1.5 }} />
      <Section title="Cell">
        <Typography level="body-xs">Vertical alignment</Typography>
        <Box sx={{ display: "flex", gap: 0.5, mb: 1 }}>
          {(["top", "middle", "bottom"] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={(cell?.verticalAlign ?? "top") === v ? "solid" : "outlined"}
              color="neutral"
              data-testid={`valign-${v}`}
              onClick={() => setCellProps(editor, { verticalAlign: v === "top" ? null : v })}
              sx={{ flex: 1 }}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </Button>
          ))}
        </Box>
        <Box sx={{ display: "flex", gap: 0.75, alignItems: "center", mb: 1 }}>
          <Typography level="body-xs" sx={{ flex: 1 }}>
            Cell background
          </Typography>
          <Input
            size="sm"
            type="color"
            value={(cell?.backgroundColor as string) || "#ffffff"}
            onChange={(e) => setCellProps(editor, { backgroundColor: e.target.value })}
            slotProps={{ input: { "aria-label": "Cell background" } }}
            sx={{ width: 52, p: 0.25, "& input": { p: 0, height: 24, cursor: "pointer" } }}
          />
          <Button size="sm" variant="plain" onClick={() => setCellProps(editor, { backgroundColor: null })}>
            None
          </Button>
        </Box>
        <Typography level="body-xs" sx={{ mb: 0.5 }}>
          Cell margins (blank = table default)
        </Typography>
        <MarginFields
          label="Cell margin"
          value={parseMargins(cell?.margins)}
          onChange={(m) => setCellProps(editor, { margins: encodeMargins(m) })}
        />
      </Section>

      <Divider sx={{ mt: 1.5 }} />
      <Section title="Rows & columns">
        <Box sx={{ display: "flex", gap: 0.75, mb: 0.75 }}>
          <Input
            size="sm"
            type="number"
            value={colW}
            placeholder="auto"
            startDecorator={<Typography level="body-xs">Width</Typography>}
            endDecorator="pt"
            slotProps={{ input: { "aria-label": "Column width", step: "any", min: 1 } }}
            onChange={(e) => setColW(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitColW()}
            onBlur={commitColW}
            sx={{ flex: 1 }}
          />
          <Input
            size="sm"
            type="number"
            value={rowH}
            placeholder="auto"
            startDecorator={<Typography level="body-xs">Height</Typography>}
            endDecorator="pt"
            slotProps={{ input: { "aria-label": "Row height", step: "any", min: 0 } }}
            onChange={(e) => setRowH(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitRowH()}
            onBlur={commitRowH}
            sx={{ flex: 1 }}
          />
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5 }}>
          <Button size="sm" variant="outlined" color="neutral" onClick={() => distributeRows(editor)}>
            Distribute rows
          </Button>
          <Button size="sm" variant="outlined" color="neutral" onClick={() => distributeColumns(editor)}>
            Distribute columns
          </Button>
        </Box>
        <Checkbox
          size="sm"
          sx={{ mt: 1 }}
          label="Repeat as header row at the top of each page"
          checked={!!rowA?.repeatHeader}
          onChange={() => toggleRepeatHeader(editor)}
        />
      </Section>

      <Divider sx={{ mt: 1.5 }} />
      <Section title="Size & layout">
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0.5, mb: 1 }}>
          <Button size="sm" variant="outlined" color="neutral" onClick={() => autofitTable(editor, "contents")}>
            Fit contents
          </Button>
          <Button size="sm" variant={t.width === "100%" ? "solid" : "outlined"} color="neutral" onClick={() => autofitTable(editor, "window")}>
            Fit window
          </Button>
          <Button size="sm" variant={t.layout === "fixed" ? "solid" : "outlined"} color="neutral" onClick={() => autofitTable(editor, "fixed")}>
            Fixed
          </Button>
        </Box>
        <Typography level="body-xs">Alignment</Typography>
        <Box sx={{ display: "flex", gap: 0.5, mb: 1 }}>
          {(["left", "center", "right"] as const).map((a) => (
            <Button
              key={a}
              size="sm"
              variant={((t.align as string) ?? "left") === a ? "solid" : "outlined"}
              color="neutral"
              onClick={() => setTableProps(editor, { align: a === "left" ? null : a })}
              sx={{ flex: 1 }}
            >
              {a[0].toUpperCase() + a.slice(1)}
            </Button>
          ))}
        </Box>
        <Typography level="body-xs" sx={{ mb: 0.5 }}>
          Default cell margins
        </Typography>
        <MarginFields
          label="Table cell margin"
          value={parseMargins(t.cellMargins)}
          onChange={(m) => setTableProps(editor, { cellMargins: encodeMargins(m) })}
        />
      </Section>

      <Divider sx={{ mt: 1.5 }} />
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5, mt: 1.5 }}>
        <Button size="sm" variant="outlined" color="neutral" onClick={() => splitTable(editor)}>
          Split table
        </Button>
        <Button size="sm" variant="outlined" color="neutral" onClick={() => tableToText(editor)}>
          Convert to text
        </Button>
      </Box>
    </>,
  );
}

// --- convert text to table ---------------------------------------------------------------------------

/** TableDialogs mounts the Convert text to table dialog. */
export function TableDialogs({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [sep, setSep] = useState<"tab" | "comma" | "semicolon" | "paragraph" | "custom">("tab");
  const [custom, setCustom] = useState("|");
  const [cols, setCols] = useState("2");
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(CONVERT_EVENT, on);
    return () => window.removeEventListener(CONVERT_EVENT, on);
  }, []);
  if (!editor || !open) return null;
  const close = () => {
    setOpen(false);
    editor.commands.focus();
  };
  const apply = () => {
    const s: TextSeparator = sep === "custom" ? { custom } : sep;
    textToTable(editor, s, Math.max(1, parseInt(cols, 10) || 1));
    close();
  };
  return (
    <Modal open onClose={close}>
      <ModalDialog sx={{ width: { xs: "calc(100vw - 32px)", sm: 380 } }}>
        <ModalClose />
        <Typography level="title-lg">Convert text to table</Typography>
        <Typography level="body-sm">Separate text at</Typography>
        <RadioGroup value={sep} onChange={(e) => setSep(e.target.value as typeof sep)} size="sm" sx={{ gap: 0.75 }}>
          <Radio value="tab" label="Tabs" />
          <Radio value="comma" label="Commas" />
          <Radio value="semicolon" label="Semicolons" />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Radio value="paragraph" label="Paragraphs, columns:" />
            <Input
              size="sm"
              type="number"
              value={cols}
              onChange={(e) => setCols(e.target.value)}
              slotProps={{ input: { "aria-label": "Number of columns", min: 1 } }}
              sx={{ width: 70 }}
            />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Radio value="custom" label="Other:" />
            <Input
              size="sm"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              slotProps={{ input: { "aria-label": "Separator", maxLength: 4 } }}
              sx={{ width: 70 }}
            />
          </Box>
        </RadioGroup>
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1 }}>
          <Button variant="plain" onClick={close}>
            Cancel
          </Button>
          <Button onClick={apply}>Convert</Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
