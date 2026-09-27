/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet API is loosely typed. */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/joy";
import { parseA1Range, rectToA1 } from "./cellValue";
import { currentSheet } from "./sheetDataTools";
import { selectionRect } from "./editActions";
import { currentRegion } from "./selectAll";
import {
  DEFAULT_TABLE_STYLE,
  TABLE_STYLE_GALLERY,
  TOTALS_FUNCTIONS,
  guessHasHeaders,
  sheetTables,
  stylePreview,
  tableAt,
  tableName,
  type TableModel,
  type TotalsFunction,
} from "./tables";
import {
  convertTableToRange,
  deleteTable,
  findTable,
  insertTable,
  renameTable,
  resizeTableTo,
  setColumnTotal,
  setTableOptions,
  toggleTotalsRow,
} from "./tableTools";

// Insert ▸ Table / Format ▸ Format as table (range, "My table has headers",
// the style gallery) and Data ▸ Table properties (name, range, total row,
// banded rows/columns, first/last column, filter button, style, totals
// functions, convert to range, delete).

/** One gallery swatch: a 5×4 miniature of the style. */
function Swatch({ name, selected, onPick }: { name: string; selected: boolean; onPick: (n: string) => void }) {
  const grid = useMemo(() => stylePreview(name), [name]);
  const label = name.replace(/^TableStyle/, "").replace(/(\d+)$/, " $1");
  return (
    <Tooltip title={label} size="sm" placement="top">
      <Box
        role="option"
        aria-selected={selected}
        aria-label={`Table style ${label}`}
        data-style={name}
        tabIndex={0}
        onClick={() => onPick(name)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPick(name);
          }
        }}
        sx={{
          p: "3px",
          borderRadius: "4px",
          cursor: "pointer",
          outline: selected ? "2px solid var(--joy-palette-primary-500)" : "1px solid var(--joy-palette-neutral-outlinedBorder)",
          "&:hover": { outline: "2px solid var(--joy-palette-primary-300)" },
          bgcolor: "#fff",
        }}
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 10px)", gridTemplateRows: "repeat(5, 6px)" }}>
          {grid.flatMap((row, r) =>
            row.map((look, c) => (
              <Box
                key={`${r}_${c}`}
                sx={{
                  bgcolor: look.fill ?? "#fff",
                  borderBottom: look.bottom ? `1px solid ${look.bottom}` : undefined,
                  borderTop: look.outline && r === 0 ? `1px solid ${look.outline}` : undefined,
                }}
              />
            )),
          )}
        </Box>
      </Box>
    </Tooltip>
  );
}

export function StyleGallery({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <Stack spacing={1} role="listbox" aria-label="Table styles" sx={{ maxHeight: 260, overflow: "auto", pr: 0.5 }}>
      {TABLE_STYLE_GALLERY.map((g) => (
        <Box key={g.group}>
          <Typography level="body-xs" sx={{ mb: 0.5, opacity: 0.7 }}>
            {g.group}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {g.names.map((n) => (
              <Swatch key={n} name={n} selected={n === value} onPick={onChange} />
            ))}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

/** Insert ▸ Table / Format as table. */
export function CreateTableDialog({ open, onClose, getWb, initialStyle }: { open: boolean; onClose: () => void; getWb: () => any; initialStyle?: string }) {
  const [range, setRange] = useState("");
  const [headers, setHeaders] = useState(true);
  const [style, setStyle] = useState(DEFAULT_TABLE_STYLE);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const wb = getWb();
    const sheet = currentSheet(wb);
    const data: any[][] = Array.isArray(sheet?.data) ? sheet.data : [];
    const filled = (r: number, c: number) => {
      const v = data[r]?.[c];
      return !!v && ((v.v != null && v.v !== "") || !!v.f);
    };
    let sel = selectionRect(wb);
    // One cell selected: the data around it (Excel's current region).
    if (sel && sel.r1 === sel.r2 && sel.c1 === sel.c2 && filled(sel.r1, sel.c1)) sel = currentRegion(filled, sel.r1, sel.c1);
    setRange(sel ? rectToA1(sel) : "");
    setHeaders(sel ? guessHasHeaders(sel, (r, c) => data[r]?.[c] ?? null) : true);
    setStyle(initialStyle ?? DEFAULT_TABLE_STYLE);
    setError("");
    // Take the selection when the dialog opens only.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit() {
    const a = parseA1Range(range);
    if (!a) {
      setError("Enter a range such as A1:D10.");
      return;
    }
    const err = insertTable(getWb(), a, headers, style);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="table-create-title" sx={{ width: 460, maxWidth: "95vw" }}>
        <ModalClose />
        <Typography id="table-create-title" level="title-lg">
          Create table
        </Typography>
        <Stack
          component="form"
          spacing={1.5}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FormControl>
            <FormLabel>Where is the data for your table?</FormLabel>
            <Input value={range} onChange={(e) => setRange(e.target.value)} slotProps={{ input: { "aria-label": "Table range" } }} />
          </FormControl>
          <Checkbox label="My table has headers" checked={headers} onChange={(e) => setHeaders(e.target.checked)} />
          <FormControl>
            <FormLabel>Style</FormLabel>
            <StyleGallery value={style} onChange={setStyle} />
          </FormControl>
          {error && (
            <Alert color="danger" variant="soft" role="alert">
              {error}
            </Alert>
          )}
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button variant="plain" color="neutral" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">OK</Button>
          </Stack>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}

/** Data ▸ Table properties for the table at the active cell (or `name`). */
export function TablePropertiesDialog({ open, onClose, getWb, name }: { open: boolean; onClose: () => void; getWb: () => any; name: string | null }) {
  const [current, setCurrent] = useState<string | null>(null);
  const [table, setTable] = useState<TableModel | null>(null);
  const [nameText, setNameText] = useState("");
  const [rangeText, setRangeText] = useState("");
  const [error, setError] = useState("");

  const reload = (n: string | null) => {
    const hit = n ? findTable(getWb(), n) : null;
    setTable(hit?.table ?? null);
    setCurrent(hit ? tableName(hit.table) : null);
    if (hit) {
      setNameText(tableName(hit.table));
      setRangeText(rectToA1(hit.table.ref));
    }
  };

  useEffect(() => {
    if (!open) return;
    setError("");
    reload(name);
  }, [open, name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const st = table?.style;
  const run = (fn: () => string | null | void, next?: string) => {
    const err = fn();
    if (err) {
      setError(err);
      return;
    }
    setError("");
    reload(next ?? current);
  };
  const flag = (label: string, checked: boolean, patch: any) => (
    <Checkbox size="sm" label={label} checked={checked} onChange={(e) => run(() => setTableOptions(getWb(), current!, { [patch]: e.target.checked }))} />
  );

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="table-props-title" sx={{ width: 520, maxWidth: "95vw", overflow: "auto" }}>
        <ModalClose />
        <Typography id="table-props-title" level="title-lg">
          Table properties
        </Typography>
        {!table || !current ? (
          <Typography level="body-sm">Select a cell inside a table first.</Typography>
        ) : (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="flex-end">
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Table name</FormLabel>
                <Input
                  value={nameText}
                  onChange={(e) => setNameText(e.target.value)}
                  onBlur={() => nameText !== current && run(() => renameTable(getWb(), current, nameText.trim()), nameText.trim())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") run(() => renameTable(getWb(), current, nameText.trim()), nameText.trim());
                  }}
                  slotProps={{ input: { "aria-label": "Table name" } }}
                />
              </FormControl>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Range</FormLabel>
                <Input
                  value={rangeText}
                  onChange={(e) => setRangeText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const a = parseA1Range(rangeText);
                    if (!a) return setError("Enter a range such as A1:D10.");
                    run(() => resizeTableTo(getWb(), current, a));
                  }}
                  slotProps={{ input: { "aria-label": "Table range" } }}
                />
              </FormControl>
              <Button
                variant="outlined"
                onClick={() => {
                  const a = parseA1Range(rangeText);
                  if (!a) return setError("Enter a range such as A1:D10.");
                  run(() => resizeTableTo(getWb(), current, a));
                }}
              >
                Resize
              </Button>
            </Stack>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
              <Checkbox size="sm" label="Total row" checked={!!table.totalsRowCount} onChange={(e) => run(() => toggleTotalsRow(getWb(), current, e.target.checked))} />
              {flag("Banded rows", !!st?.showRowStripes, "showRowStripes")}
              {flag("Banded columns", !!st?.showColumnStripes, "showColumnStripes")}
              {flag("First column", !!st?.showFirstColumn, "showFirstColumn")}
              {flag("Last column", !!st?.showLastColumn, "showLastColumn")}
              {flag("Filter button", !!table.autoFilter, "autoFilter")}
            </Box>
            {!!table.totalsRowCount && (
              <>
                <Divider />
                <Typography level="title-sm">Total row</Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
                  {table.columns.map((c, i) => (
                    <FormControl key={c.id ?? i} size="sm">
                      <FormLabel>{c.name}</FormLabel>
                      <Select
                        size="sm"
                        value={(c.totalsRowFunction as TotalsFunction) ?? "none"}
                        onChange={(_, v) => v && run(() => setColumnTotal(getWb(), current, i, v as TotalsFunction))}
                        slotProps={{ button: { "aria-label": `Total for ${c.name}` } }}
                      >
                        {TOTALS_FUNCTIONS.map((f) => (
                          <Option key={f.id} value={f.id}>
                            {f.label}
                          </Option>
                        ))}
                        {c.totalsRowFunction === "custom" && <Option value="custom">Custom formula</Option>}
                      </Select>
                    </FormControl>
                  ))}
                </Box>
              </>
            )}
            <Divider />
            <FormControl>
              <FormLabel>Style</FormLabel>
              <StyleGallery value={st?.name ?? ""} onChange={(n) => run(() => setTableOptions(getWb(), current, { name: n }))} />
            </FormControl>
            {error && (
              <Alert color="danger" variant="soft" role="alert">
                {error}
              </Alert>
            )}
            <Stack direction="row" spacing={1} justifyContent="space-between">
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  color="neutral"
                  onClick={() => {
                    convertTableToRange(getWb(), current);
                    onClose();
                  }}
                >
                  Convert to range
                </Button>
                <Button
                  variant="outlined"
                  color="danger"
                  onClick={() => {
                    deleteTable(getWb(), current);
                    onClose();
                  }}
                >
                  Delete table
                </Button>
              </Stack>
              <Button onClick={onClose}>Done</Button>
            </Stack>
          </Stack>
        )}
      </ModalDialog>
    </Modal>
  );
}

/** The name of the table at the active cell of the current sheet, or null. */
export function tableAtSelection(wb: any): string | null {
  const sheet = currentSheet(wb);
  const sel = selectionRect(wb);
  if (!sheet || !sel) return null;
  const t = tableAt(sheetTables(sheet), sel.r1, sel.c1);
  return t ? tableName(t) : null;
}
