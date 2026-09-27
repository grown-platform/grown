// Table UI (M5): the insert size picker, the toolbar controls shown while a
// table is selected (rows & columns, merge/split, style gallery + options,
// cell fill, borders) and the split-cells dialog.

import { useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  DialogActions,
  DialogTitle,
  Dropdown,
  Input,
  ListDivider,
  Menu,
  MenuButton,
  MenuItem,
  Modal,
  ModalDialog,
  Stack,
  Typography,
} from "@mui/joy";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import type { CellBorder, SlideElement, TableLook } from "./model";
import { BORDER_PRESETS, cellFormat, type BorderPreset } from "./tableOps";
import { tableTemplates, templateCell, type TableTemplate } from "./tableStyles";

export interface TableCommands {
  insertRow: (where: "above" | "below") => void;
  insertCol: (where: "left" | "right") => void;
  deleteRow: () => void;
  deleteCol: () => void;
  deleteTable: () => void;
  merge: () => void;
  canMerge: boolean;
  /** Open the split dialog for the active cell. */
  split: () => void;
  distributeRows: () => void;
  distributeCols: () => void;
  setFill: (color: string | null) => void;
  setBorders: (preset: BorderPreset, border: CellBorder) => void;
  setStyle: (id: string | undefined) => void;
  setLook: (key: keyof TableLook, on: boolean) => void;
  selectRow: () => void;
  selectCol: () => void;
  selectTable: () => void;
}

const MAX_R = 8;
const MAX_C = 10;

/** Hover grid for Insert ▸ Table (rows × columns). */
export function TableSizePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  return (
    <Box data-testid="table-picker" sx={{ p: 1 }}>
      <Box
        sx={{ display: "grid", gridTemplateColumns: `repeat(${MAX_C}, 18px)`, gap: "2px" }}
        onMouseLeave={() => setHover([0, 0])}
      >
        {Array.from({ length: MAX_R * MAX_C }, (_, i) => {
          const r = Math.floor(i / MAX_C) + 1;
          const c = (i % MAX_C) + 1;
          const on = r <= hover[0] && c <= hover[1];
          return (
            <Box
              key={i}
              component="button"
              type="button"
              aria-label={`${r} × ${c} table`}
              data-size={`${r}x${c}`}
              onMouseEnter={() => setHover([r, c])}
              onFocus={() => setHover([r, c])}
              onClick={() => onPick(r, c)}
              sx={{
                width: 18,
                height: 18,
                p: 0,
                border: "1px solid",
                borderColor: on ? "primary.500" : "neutral.outlinedBorder",
                bgcolor: on ? "primary.softBg" : "background.surface",
                cursor: "pointer",
              }}
            />
          );
        })}
      </Box>
      <Typography level="body-xs" sx={{ mt: 0.5, textAlign: "center" }}>
        {hover[0] ? `${hover[0]} × ${hover[1]}` : "Insert table"}
      </Typography>
    </Box>
  );
}

/** A 5×4 thumbnail of a template with a header row and banded rows. */
function TemplateThumb({ tpl, look }: { tpl: TableTemplate | undefined; look: TableLook }) {
  const rows = 5;
  const cols = 4;
  return (
    <svg width={48} height={34} viewBox="0 0 48 34" aria-hidden>
      {Array.from({ length: rows * cols }, (_, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const f = templateCell(tpl, look, rows, cols, r, c);
        const line = f.borders.b ?? f.borders.t;
        return (
          <rect
            key={i}
            x={c * 12}
            y={r * 6.8}
            width={12}
            height={6.8}
            fill={f.fill ?? "#ffffff"}
            stroke={line ? (line.color === "#ffffff" && !f.fill ? "#dddddd" : line.color) : "#e3e3e3"}
            strokeWidth={0.6}
          />
        );
      })}
    </svg>
  );
}

const LOOK_LABELS: [keyof TableLook, string][] = [
  ["header", "Header row"],
  ["lastRow", "Total row"],
  ["banded", "Banded rows"],
  ["firstCol", "First column"],
  ["lastCol", "Last column"],
  ["bandedCols", "Banded columns"],
];

const selStyle: React.CSSProperties = { marginLeft: 4, maxWidth: 130, fontSize: 12 };
const WIDTHS = [0.5, 1, 1.5, 2, 3, 4.5, 6];

/** Toolbar controls for the selected table. */
export function TableControls({
  el,
  cmd,
  activeCell,
}: {
  el: SlideElement | null | undefined;
  cmd: TableCommands | null;
  activeCell: [number, number] | null;
}) {
  const [borderColor, setBorderColor] = useState("#000000");
  const [borderWidth, setBorderWidth] = useState(1);
  if (!el || el.type !== "table" || !el.table || !cmd) return null;
  const t = el.table;
  const look = t.look ?? {};
  const [ar, ac] = activeCell ?? [0, 0];
  const fill = cellFormat(el, ar, ac).fill;
  return (
    <Box data-testid="table-controls" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Dropdown>
        <MenuButton size="sm" variant="plain" startDecorator={<TableChartOutlinedIcon />} data-testid="table-rows-cols">
          Rows &amp; columns
        </MenuButton>
        <Menu size="sm">
          <MenuItem onClick={() => cmd.insertRow("above")}>Insert row above</MenuItem>
          <MenuItem onClick={() => cmd.insertRow("below")}>Insert row below</MenuItem>
          <MenuItem onClick={() => cmd.insertCol("left")}>Insert column left</MenuItem>
          <MenuItem onClick={() => cmd.insertCol("right")}>Insert column right</MenuItem>
          <ListDivider />
          <MenuItem onClick={cmd.deleteRow}>Delete row</MenuItem>
          <MenuItem onClick={cmd.deleteCol}>Delete column</MenuItem>
          <MenuItem onClick={cmd.deleteTable}>Delete table</MenuItem>
          <ListDivider />
          <MenuItem onClick={cmd.selectRow}>Select row</MenuItem>
          <MenuItem onClick={cmd.selectCol}>Select column</MenuItem>
          <MenuItem onClick={cmd.selectTable}>Select table</MenuItem>
          <ListDivider />
          <MenuItem onClick={cmd.distributeRows}>Distribute rows</MenuItem>
          <MenuItem onClick={cmd.distributeCols}>Distribute columns</MenuItem>
        </Menu>
      </Dropdown>
      <Button size="sm" variant="plain" disabled={!cmd.canMerge} onClick={cmd.merge} data-testid="table-merge">
        Merge
      </Button>
      <Button size="sm" variant="plain" onClick={cmd.split} data-testid="table-split">
        Split…
      </Button>
      <Dropdown>
        <MenuButton size="sm" variant="plain" data-testid="table-style">
          Style
        </MenuButton>
        <Menu size="sm" sx={{ p: 1, maxWidth: 300 }}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            <Box
              component="button"
              type="button"
              title="No style"
              onClick={() => cmd.setStyle(undefined)}
              sx={{ p: 0.25, border: "2px solid", borderColor: !t.style ? "primary.500" : "transparent", bgcolor: "transparent", cursor: "pointer" }}
            >
              <TemplateThumb tpl={undefined} look={look} />
            </Box>
            {tableTemplates().map((tpl) => (
              <Box
                key={tpl.id}
                component="button"
                type="button"
                title={tpl.name}
                data-style={tpl.name}
                onClick={() => cmd.setStyle(tpl.id)}
                sx={{
                  p: 0.25,
                  border: "2px solid",
                  borderColor: t.style?.toUpperCase() === tpl.id.toUpperCase() ? "primary.500" : "transparent",
                  bgcolor: "transparent",
                  cursor: "pointer",
                }}
              >
                <TemplateThumb tpl={tpl} look={t.look ?? { header: true, banded: true }} />
              </Box>
            ))}
          </Box>
          <ListDivider />
          {LOOK_LABELS.map(([k, label]) => (
            <MenuItem key={k} onClick={() => cmd.setLook(k, !look[k])}>
              <Checkbox size="sm" checked={!!look[k]} label={label} slotProps={{ input: { "aria-label": label } }} readOnly />
            </MenuItem>
          ))}
        </Menu>
      </Dropdown>
      <input
        type="color"
        value={fill && /^#[0-9a-f]{6}/i.test(fill) ? fill.slice(0, 7) : "#ffffff"}
        onChange={(e) => cmd.setFill(e.target.value)}
        title="Cell fill"
        aria-label="Cell fill"
        style={{ marginLeft: 4 }}
      />
      <Dropdown>
        <MenuButton size="sm" variant="plain" data-testid="table-borders">
          Borders
        </MenuButton>
        <Menu size="sm">
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.5 }} onClick={(e) => e.stopPropagation()}>
            <input
              type="color"
              value={borderColor}
              onChange={(e) => setBorderColor(e.target.value)}
              title="Border color"
              aria-label="Border color"
            />
            <select
              aria-label="Border width"
              value={String(borderWidth)}
              onChange={(e) => setBorderWidth(Number(e.target.value))}
              style={selStyle}
            >
              {WIDTHS.map((w) => (
                <option key={w} value={String(w)}>
                  {w} pt
                </option>
              ))}
            </select>
          </Box>
          {BORDER_PRESETS.map((p) => (
            <MenuItem key={p.id} onClick={() => cmd.setBorders(p.id, { color: borderColor, width: borderWidth })}>
              {p.label}
            </MenuItem>
          ))}
          <ListDivider />
          <MenuItem onClick={() => cmd.setFill(null)}>Reset cell fill</MenuItem>
        </Menu>
      </Dropdown>
    </Box>
  );
}

/** Split cells: rows × columns for the active cell. */
export function SplitCellDialog({
  open,
  initial,
  onClose,
  onSplit,
}: {
  open: boolean;
  initial: { rows: number; cols: number };
  onClose: () => void;
  onSplit: (rows: number, cols: number) => void;
}) {
  const [rows, setRows] = useState(String(initial.rows));
  const [cols, setCols] = useState(String(initial.cols));
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog size="sm" data-testid="split-dialog">
        <DialogTitle>Split cell</DialogTitle>
        <Stack direction="row" spacing={1}>
          <Input
            type="number"
            value={cols}
            onChange={(e) => setCols(e.target.value)}
            slotProps={{ input: { min: 1, max: 20, "aria-label": "Number of columns" } }}
            startDecorator="Columns"
          />
          <Input
            type="number"
            value={rows}
            onChange={(e) => setRows(e.target.value)}
            slotProps={{ input: { min: 1, max: 20, "aria-label": "Number of rows" } }}
            startDecorator="Rows"
          />
        </Stack>
        <DialogActions>
          <Button onClick={() => onSplit(Math.max(1, Number(rows) || 1), Math.max(1, Number(cols) || 1))}>Split</Button>
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
