import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  FormControl,
  FormLabel,
  Input,
  Select,
  Option,
  Button,
  Box,
  Stack,
  Checkbox,
  IconButton,
  Divider,
  Autocomplete,
  Radio,
  RadioGroup,
} from "@mui/joy";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import { PivotTableView } from "./PivotTableView";
import {
  AGG_TITLE,
  AGGS,
  SHOW_AS_NEEDS_FIELD,
  SHOW_AS_NEEDS_ITEM,
  SHOW_AS_TITLE,
  VALUES,
  buildReport,
  canAddCalculatedItemName,
  cellItemKey,
  compareItemKeys,
  dataFieldNames,
  fieldName,
  newPivotId,
  normalizeConfig,
  readSource,
  type Agg,
  type FieldFilter,
  type GroupBy,
  type LabelOp,
  type PivotConfig,
  type PivotDataField,
  type PivotGroup,
  type PivotSource,
  type ShowAs,
} from "./pivotData";
import { getSelectionRange } from "./chartData";
import { colToLetters, parseA1Range } from "./cellValue";
import { isValidCalc } from "./pivotCalc";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

interface PivotDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
  /** The pivot being edited (a new one when absent). */
  editing?: PivotConfig | null;
  onSave: (cfg: PivotConfig, placement: Placement) => void;
}

/** Where a new or moved pivot goes. */
export type Placement = { kind: "newSheet" } | { kind: "existing"; sheetId: string; r: number; c: number } | { kind: "keep" };

const NUM_FORMATS: [string, string][] = [
  ["", "Automatic"],
  ["0", "Number (0)"],
  ["#,##0.00", "Number (#,##0.00)"],
  ["0%", "Percent (0%)"],
  ["0.00%", "Percent (0.00%)"],
  ['"$"#,##0.00', "Currency ($#,##0.00)"],
  ["0.00E+00", "Scientific"],
];

const LABEL_OPS: [LabelOp, string][] = [
  ["equal", "equals"],
  ["notEqual", "does not equal"],
  ["greater", "is greater than"],
  ["greaterOrEqual", "is greater than or equal to"],
  ["less", "is less than"],
  ["lessOrEqual", "is less than or equal to"],
  ["beginsWith", "begins with"],
  ["endsWith", "ends with"],
  ["contains", "contains"],
  ["notContains", "does not contain"],
  ["between", "is between"],
];

const GROUP_BY: [GroupBy, string][] = [
  ["years", "Years"],
  ["quarters", "Quarters"],
  ["months", "Months"],
  ["days", "Days"],
];

function sheetList(wb: any): { id: string; name: string }[] {
  try {
    return (wb?.getAllSheets?.() ?? []).map((s: any) => ({ id: String(s.id), name: String(s.name) }));
  } catch {
    return [];
  }
}

function activeSheetId(wb: any): string {
  try {
    return String(wb?.getSheet?.()?.id ?? "");
  } catch {
    return "";
  }
}

/** "Sheet1!A1:D20" (or "A1:D20" on the active sheet) → sheet id and range. */
function parseRef(text: string, wb: any): { sheetId: string; r0: number; r1: number; c0: number; c1: number } | null {
  const t = text.trim();
  const bang = t.lastIndexOf("!");
  let sheetId = activeSheetId(wb);
  if (bang > 0) {
    const name = t.slice(0, bang).replace(/^'|'$/g, "").replace(/''/g, "'");
    const s = sheetList(wb).find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!s) return null;
    sheetId = s.id;
  }
  const r = parseA1Range(bang > 0 ? t.slice(bang + 1) : t, 100000, 1000);
  if (!r) return null;
  return { sheetId, r0: r.r1, r1: r.r2, c0: r.c1, c1: r.c2 };
}

function refText(wb: any, sheetId: string | undefined, r: { r0: number; r1: number; c0: number; c1: number }): string {
  const s = sheetList(wb).find((x) => x.id === String(sheetId));
  const name = s ? (/^[A-Za-z_][\w]*$/.test(s.name) ? s.name : `'${s.name.replace(/'/g, "''")}'`) + "!" : "";
  const a = `${colToLetters(r.c0)}${r.r0 + 1}`;
  return r.r0 === r.r1 && r.c0 === r.c1 ? name + a : `${name}${a}:${colToLetters(r.c1)}${r.r1 + 1}`;
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: "sm", p: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
        <Typography level="title-sm">{title}</Typography>
        {action}
      </Box>
      <Stack spacing={0.75}>{children}</Stack>
    </Box>
  );
}

export function PivotDialog({ open, onClose, getWb, editing, onSave }: PivotDialogProps) {
  const [cfg, setCfg] = useState<PivotConfig | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [placeKind, setPlaceKind] = useState<"newSheet" | "existing" | "keep">("newSheet");
  const [targetText, setTargetText] = useState("");
  const [error, setError] = useState("");

  // Start from the pivot being edited, or from the selection.
  useEffect(() => {
    if (!open) return;
    const wb = getWb();
    setError("");
    if (editing) {
      const c = normalizeConfig(editing);
      setCfg(c);
      setSourceText(refText(wb, c.sourceSheetId, c.range));
      setPlaceKind(c.anchor ? "keep" : "newSheet");
      setTargetText(c.anchor ? refText(wb, c.anchor.sheetId, { r0: c.anchor.r, r1: c.anchor.r, c0: c.anchor.c, c1: c.anchor.c }) : "");
      return;
    }
    const sel = wb ? getSelectionRange(wb) : null;
    const sid = activeSheetId(wb);
    const range = sel ?? { r0: 0, r1: 0, c0: 0, c1: 0 };
    const base: PivotConfig = {
      id: newPivotId(),
      title: "",
      range,
      sourceSheetId: sid,
      rows: [],
      cols: [],
      values: [],
      pages: [],
    };
    setCfg(base);
    setSourceText(refText(wb, sid, range));
    setPlaceKind("newSheet");
    setTargetText(refText(wb, sid, { r0: range.r0, r1: range.r0, c0: range.c1 + 2, c1: range.c1 + 2 }));
    // Sensible first layout: first text column as rows, first number column summed.
    try {
      const src = readSource(wb, base);
      const textCol = src.names.findIndex((_, i) => src.records.some((r) => typeof r[i]?.s === "string"));
      const numCol = src.names.findIndex((_, i) => i !== textCol && src.records.some((r) => typeof r[i]?.s === "number"));
      setCfg({
        ...base,
        rows: textCol >= 0 ? [textCol] : [],
        values: numCol >= 0 ? [{ field: numCol, agg: "sum" }] : [],
      });
    } catch {
      /* empty pivot */
    }
  }, [open, editing, getWb]);

  const wb = getWb();
  const source: PivotSource | null = useMemo(() => {
    if (!cfg || !wb) return null;
    try {
      return readSource(wb, cfg);
    } catch {
      return null;
    }
  }, [cfg, wb]);
  const report = useMemo(() => {
    if (!cfg || !wb || !source?.names.length) return null;
    try {
      return buildReport(wb, cfg);
    } catch {
      return null;
    }
  }, [cfg, wb, source]);

  if (!cfg) return null;
  const c = cfg;
  const names = source?.names ?? [];
  const groups = c.groups ?? [];
  const calcs = c.calculated ?? [];
  const cItems = c.calculatedItems ?? [];
  const nSrc = names.length;
  const fieldIds = [...names.map((_, i) => i), ...groups.map((_, i) => nSrc + i)];
  const valueIds = [...fieldIds, ...calcs.map((_, i) => nSrc + groups.length + i)];
  const fname = (f: number) => (source ? fieldName(c, source, f) : String(f));
  const set = (patch: Partial<PivotConfig>) => setCfg({ ...c, ...patch });
  const setField = (f: number, patch: Record<string, unknown>) =>
    set({ fields: { ...(c.fields ?? {}), [f]: { ...(c.fields?.[f] ?? {}), ...patch } } });
  const itemsOf = (f: number): { key: string; label: string }[] => {
    if (!source || f < 0 || f >= nSrc) return [];
    const m = new Map<string, string>();
    for (const r of source.records) {
      const k = cellItemKey(r[f] ?? { s: null, text: "" });
      if (!m.has(k)) m.set(k, k === "z" ? "(blank)" : r[f]?.text || "(blank)");
    }
    return [...m.entries()].sort((a, b) => compareItemKeys(a[0], b[0])).map(([key, label]) => ({ key, label }));
  };
  const dataNames = source ? dataFieldNames(c, source) : [];

  function applySource(text: string) {
    setSourceText(text);
    const p = parseRef(text, wb);
    if (!p) return;
    const { sheetId, ...range } = p;
    setCfg({ ...c, range, sourceSheetId: sheetId });
  }

  // ---- axis fields (rows / columns) ----------------------------------------------
  function axisList(axis: "rows" | "cols") {
    const list = c[axis] ?? [];
    const update = (next: number[]) => set({ [axis]: next } as Partial<PivotConfig>);
    return (
      <Section
        title={axis === "rows" ? "Rows" : "Columns"}
        action={
          <Select
            size="sm"
            placeholder="Add"
            value={null}
            onChange={(_, v) => v != null && update([...list, v as number])}
            slotProps={{ button: { "aria-label": axis === "rows" ? "Add row field" : "Add column field" } }}
          >
            {fieldIds.map((f) => (
              <Option key={f} value={f}>
                {fname(f)}
              </Option>
            ))}
          </Select>
        }
      >
        {list.map((f, i) => axisField(axis, i, f, list, update))}
      </Section>
    );
  }

  function axisField(axis: string, index: number, field: number, list: number[], update: (n: number[]) => void) {
    const fs = c.fields?.[field] ?? {};
    const filter = (c.fieldFilters ?? []).find((x) => x.field === field);
    const setFilter = (next: FieldFilter | null) => {
      const rest = (c.fieldFilters ?? []).filter((x) => x.field !== field);
      set({ fieldFilters: next ? [...rest, next] : rest });
    };
    const isGroup = field >= nSrc;
    const baseField = isGroup ? groups[field - nSrc]?.source : field;
    const numeric = !!source?.records.some((r) => typeof r[baseField]?.s === "number");
    const groupWith = (g: PivotGroup | null) => {
      if (!g) {
        update(list.map((x, i) => (i === index ? baseField : x)));
        return;
      }
      const at = groups.length;
      set({ groups: [...groups, g], [axis]: list.map((x, i) => (i === index ? nSrc + at : x)) } as Partial<PivotConfig>);
    };
    return (
      <Box key={`${field}-${index}`} sx={{ borderTop: index ? "1px dashed" : "none", borderColor: "divider", pt: index ? 0.75 : 0 }} data-testid={`pivot-${axis}-${index}`}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Typography level="body-sm" sx={{ fontWeight: 600, flex: 1 }}>
            {fname(field)}
          </Typography>
          <IconButton size="sm" variant="plain" aria-label={`Remove ${fname(field)}`} onClick={() => update(list.filter((_, i) => i !== index))}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          <Select size="sm" value={fs.sort?.order ?? "asc"} onChange={(_, v) => v && setField(field, { sort: { ...(fs.sort ?? {}), order: v } })} aria-label="Order">
            <Option value="asc">Ascending</Option>
            <Option value="desc">Descending</Option>
          </Select>
          <Select
            size="sm"
            value={fs.sort?.dataField ?? -1}
            onChange={(_, v) => setField(field, { sort: { order: fs.sort?.order ?? "asc", dataField: v === -1 || v == null ? undefined : (v as number) } })}
            aria-label="Sort by"
          >
            <Option value={-1}>by {fname(field)}</Option>
            {dataNames.map((n, i) => (
              <Option key={i} value={i}>
                by {n}
              </Option>
            ))}
          </Select>
          <Checkbox
            size="sm"
            label="Totals"
            checked={fs.subtotals !== "none" && c.defaultSubtotal !== false}
            onChange={(e) => setField(field, { subtotals: e.target.checked ? undefined : "none" })}
          />
          {numeric && !isGroup && (
            <Select
              size="sm"
              value="none"
              onChange={(_, v) => {
                if (!v || v === "none") return;
                if (v === "range") {
                  const nums = (source?.records ?? []).map((r) => r[field]?.s).filter((x): x is number => typeof x === "number");
                  const lo = Math.floor(Math.min(...nums));
                  const hi = Math.ceil(Math.max(...nums));
                  groupWith({ source: field, name: `${fname(field)} (ranges)`, type: "number", start: lo, end: hi, interval: Math.max(1, Math.ceil((hi - lo + 1) / 5)) });
                } else groupWith({ source: field, name: `${fname(field)} (${v})`, type: "date", by: v as GroupBy });
              }}
              aria-label="Group"
            >
              <Option value="none">Group…</Option>
              {GROUP_BY.map(([k, l]) => (
                <Option key={k} value={k}>
                  Dates by {l.toLowerCase()}
                </Option>
              ))}
              <Option value="range">Number ranges</Option>
            </Select>
          )}
          {isGroup && (
            <Button size="sm" variant="plain" onClick={() => groupWith(null)}>
              Ungroup
            </Button>
          )}
        </Box>
        {isGroup && groups[field - nSrc]?.type === "number" && (
          <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
            {(["start", "end", "interval"] as const).map((k) => (
              <Input
                key={k}
                size="sm"
                type="number"
                sx={{ width: 90 }}
                startDecorator={<Typography level="body-xs">{k}</Typography>}
                value={String((groups[field - nSrc] as any)[k])}
                onChange={(e) => {
                  const g = { ...(groups[field - nSrc] as any), [k]: Number(e.target.value) };
                  set({ groups: groups.map((x, i) => (i === field - nSrc ? g : x)) });
                }}
              />
            ))}
          </Box>
        )}
        {fieldFilterEditor(field, filter ?? null, setFilter)}
      </Box>
    );
  }

  function fieldFilterEditor(field: number, filter: FieldFilter | null, onChange: (f: FieldFilter | null) => void) {
    const type = filter?.type ?? "none";
    const items = itemsOf(field);
    return (
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5, alignItems: "center" }}>
        <Select
          size="sm"
          value={type}
          aria-label="Filter"
          onChange={(_, v) => {
            if (v === "none" || !v) onChange(null);
            else if (v === "items") onChange({ field, type: "items", hidden: [] });
            else if (v === "label") onChange({ field, type: "label", op: "contains", value: "" });
            else if (v === "value") onChange({ field, type: "value", dataField: 0, op: "greater", value: 0 });
            else onChange({ field, type: "top10", dataField: 0, top: true, count: 10, by: "items" });
          }}
        >
          <Option value="none">No filter</Option>
          <Option value="items">Filter by values</Option>
          <Option value="label">Filter by label</Option>
          <Option value="value">Filter by value</Option>
          <Option value="top10">Top 10</Option>
        </Select>
        {filter?.type === "items" && (
          <Autocomplete
            size="sm"
            multiple
            placeholder="Hidden items"
            options={items}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(a, b) => a.key === b.key}
            value={items.filter((i) => filter.hidden.includes(i.key))}
            onChange={(_, v) => onChange({ ...filter, hidden: v.map((x) => x.key) })}
            sx={{ minWidth: 200 }}
          />
        )}
        {filter?.type === "label" && (
          <>
            <Select size="sm" value={filter.op} onChange={(_, v) => v && onChange({ ...filter, op: v as LabelOp })} aria-label="Condition">
              {LABEL_OPS.map(([k, l]) => (
                <Option key={k} value={k}>
                  {l}
                </Option>
              ))}
            </Select>
            <Input size="sm" value={filter.value} onChange={(e) => onChange({ ...filter, value: e.target.value })} sx={{ width: 100 }} slotProps={{ input: { "aria-label": "Filter value" } }} />
            {filter.op === "between" && <Input size="sm" value={filter.value2 ?? ""} onChange={(e) => onChange({ ...filter, value2: e.target.value })} sx={{ width: 100 }} />}
          </>
        )}
        {filter?.type === "value" && (
          <>
            <Select size="sm" value={filter.dataField} onChange={(_, v) => v != null && onChange({ ...filter, dataField: v as number })} aria-label="Of">
              {dataNames.map((n, i) => (
                <Option key={i} value={i}>
                  {n}
                </Option>
              ))}
            </Select>
            <Select size="sm" value={filter.op} onChange={(_, v) => v && onChange({ ...filter, op: v as LabelOp })} aria-label="Condition">
              {LABEL_OPS.filter(([k]) => !/begins|ends|contains/i.test(k)).map(([k, l]) => (
                <Option key={k} value={k}>
                  {l}
                </Option>
              ))}
            </Select>
            <Input size="sm" type="number" value={String(filter.value)} onChange={(e) => onChange({ ...filter, value: Number(e.target.value) })} sx={{ width: 90 }} slotProps={{ input: { "aria-label": "Filter value" } }} />
            {filter.op === "between" && <Input size="sm" type="number" value={String(filter.value2 ?? "")} onChange={(e) => onChange({ ...filter, value2: Number(e.target.value) })} sx={{ width: 90 }} />}
          </>
        )}
        {filter?.type === "top10" && (
          <>
            <Select size="sm" value={filter.top ? "top" : "bottom"} onChange={(_, v) => onChange({ ...filter, top: v === "top" })} aria-label="Top or bottom">
              <Option value="top">Top</Option>
              <Option value="bottom">Bottom</Option>
            </Select>
            <Input size="sm" type="number" value={String(filter.count)} onChange={(e) => onChange({ ...filter, count: Number(e.target.value) })} sx={{ width: 70 }} slotProps={{ input: { "aria-label": "Count" } }} />
            <Select size="sm" value={filter.by} onChange={(_, v) => v && onChange({ ...filter, by: v as "items" | "percent" | "sum" })} aria-label="Unit">
              <Option value="items">items</Option>
              <Option value="percent">percent</Option>
              <Option value="sum">sum</Option>
            </Select>
            <Select size="sm" value={filter.dataField} onChange={(_, v) => v != null && onChange({ ...filter, dataField: v as number })} aria-label="By">
              {dataNames.map((n, i) => (
                <Option key={i} value={i}>
                  {n}
                </Option>
              ))}
            </Select>
          </>
        )}
      </Box>
    );
  }

  // ---- values -------------------------------------------------------------------------
  const values = c.values ?? [];
  const setValue = (i: number, patch: Partial<PivotDataField>) => set({ values: values.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const axisFields = [...(c.rows ?? []), ...(c.cols ?? [])].filter((f) => f !== VALUES);

  function valueField(d: PivotDataField, i: number) {
    const showAs = d.showAs ?? "normal";
    const baseItems = d.baseField !== undefined ? itemsOf(d.baseField) : [];
    return (
      <Box key={i} sx={{ borderTop: i ? "1px dashed" : "none", borderColor: "divider", pt: i ? 0.75 : 0 }} data-testid={`pivot-value-${i}`}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Input
            size="sm"
            value={d.name ?? ""}
            placeholder={dataNames[i]}
            onChange={(e) => setValue(i, { name: e.target.value || undefined })}
            sx={{ flex: 1 }}
            slotProps={{ input: { "aria-label": "Value name" } }}
          />
          <IconButton size="sm" variant="plain" aria-label={`Remove ${dataNames[i]}`} onClick={() => set({ values: values.filter((_, j) => j !== i) })}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
          <Select size="sm" value={d.field} onChange={(_, v) => v != null && setValue(i, { field: v as number })} aria-label="Value field">
            {valueIds.map((f) => (
              <Option key={f} value={f}>
                {fname(f)}
              </Option>
            ))}
          </Select>
          <Select size="sm" value={d.agg} onChange={(_, v) => v && setValue(i, { agg: v as Agg })} aria-label="Summarize by">
            {AGGS.map((a) => (
              <Option key={a} value={a}>
                {AGG_TITLE[a]}
              </Option>
            ))}
          </Select>
          <Select
            size="sm"
            value={showAs}
            onChange={(_, v) => v && setValue(i, { showAs: v as ShowAs, baseField: d.baseField ?? axisFields[0], baseItem: d.baseItem ?? "prev" })}
            aria-label="Show as"
          >
            {(Object.keys(SHOW_AS_TITLE) as ShowAs[]).map((k) => (
              <Option key={k} value={k}>
                {SHOW_AS_TITLE[k]}
              </Option>
            ))}
          </Select>
          {SHOW_AS_NEEDS_FIELD.includes(showAs) && (
            <Select size="sm" value={d.baseField ?? -1} onChange={(_, v) => v != null && setValue(i, { baseField: v as number })} aria-label="Base field">
              {axisFields.map((f) => (
                <Option key={f} value={f}>
                  {fname(f)}
                </Option>
              ))}
            </Select>
          )}
          {SHOW_AS_NEEDS_ITEM.includes(showAs) && (
            <Select size="sm" value={String(d.baseItem ?? "prev")} onChange={(_, v) => v != null && setValue(i, { baseItem: v === "prev" || v === "next" ? v : Number(v) })} aria-label="Base item">
              <Option value="prev">(previous)</Option>
              <Option value="next">(next)</Option>
              {baseItems.map((it, j) => (
                <Option key={it.key} value={String(j)}>
                  {it.label}
                </Option>
              ))}
            </Select>
          )}
          <Select size="sm" value={NUM_FORMATS.some(([k]) => k === (d.numFmt ?? "")) ? (d.numFmt ?? "") : "custom"} onChange={(_, v) => v !== "custom" && setValue(i, { numFmt: (v as string) || undefined })} aria-label="Number format">
            {NUM_FORMATS.map(([k, l]) => (
              <Option key={k} value={k}>
                {l}
              </Option>
            ))}
            <Option value="custom">Custom…</Option>
          </Select>
          <Input size="sm" value={d.numFmt ?? ""} placeholder="Format code" onChange={(e) => setValue(i, { numFmt: e.target.value || undefined })} sx={{ width: 120 }} slotProps={{ input: { "aria-label": "Format code" } }} />
        </Box>
      </Box>
    );
  }

  // ---- save ------------------------------------------------------------------------------
  function save() {
    const p = parseRef(sourceText, wb);
    if (!p || p.r1 <= p.r0) {
      setError("Enter a source range with a header row and at least one record, e.g. Sheet1!A1:D20.");
      return;
    }
    let placement: Placement = { kind: "newSheet" };
    if (placeKind === "keep" && c.anchor) placement = { kind: "keep" };
    else if (placeKind === "existing") {
      const t = parseRef(targetText, wb);
      if (!t) {
        setError("Enter the cell for the pivot table, e.g. Sheet1!F1.");
        return;
      }
      placement = { kind: "existing", sheetId: t.sheetId, r: t.r0, c: t.c0 };
    }
    for (const k of calcs) {
      if (!k.name.trim() || !isValidCalc(k.formula)) {
        setError(`Check the calculated field "${k.name || "(no name)"}".`);
        return;
      }
    }
    for (const k of cItems) {
      if (!k.name.trim() || !isValidCalc(k.formula)) {
        setError(`Check the calculated item "${k.name || "(no name)"}".`);
        return;
      }
    }
    onSave({ ...c, title: c.title.trim() }, placement);
    onClose();
  }

  const colsHaveValues = (c.values ?? []).length >= 2;

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 1180, maxWidth: "98vw", maxHeight: "94vh", overflow: "auto" }} aria-labelledby="pivot-title">
        <ModalClose />
        <Typography id="pivot-title" level="title-lg">
          {editing ? "Edit pivot table" : "Create pivot table"}
        </Typography>
        <Box sx={{ display: "flex", gap: 2, mt: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Stack spacing={1} sx={{ width: 460, maxWidth: "100%" }}>
            <Box sx={{ display: "flex", gap: 1 }}>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Data range</FormLabel>
                <Input value={sourceText} onChange={(e) => applySource(e.target.value)} slotProps={{ input: { "aria-label": "Data range" } }} />
              </FormControl>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Title</FormLabel>
                <Input value={c.title} onChange={(e) => set({ title: e.target.value })} placeholder="Optional" slotProps={{ input: { "aria-label": "Pivot title" } }} />
              </FormControl>
            </Box>
            <FormControl>
              <FormLabel>Insert to</FormLabel>
              <RadioGroup orientation="horizontal" value={placeKind} onChange={(e) => setPlaceKind(e.target.value as typeof placeKind)}>
                {editing?.anchor && <Radio value="keep" label="Where it is" size="sm" />}
                <Radio value="newSheet" label="New sheet" size="sm" />
                <Radio value="existing" label="Existing sheet" size="sm" />
              </RadioGroup>
              {placeKind === "existing" && (
                <Input size="sm" value={targetText} onChange={(e) => setTargetText(e.target.value)} sx={{ mt: 0.5 }} slotProps={{ input: { "aria-label": "Pivot location" } }} />
              )}
            </FormControl>
            {names.length === 0 ? (
              <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                Select a range whose first row has column headers.
              </Typography>
            ) : (
              <>
                {axisList("rows")}
                {axisList("cols")}
                <Section
                  title="Values"
                  action={
                    <Select size="sm" placeholder="Add" value={null} onChange={(_, v) => v != null && set({ values: [...values, { field: v as number, agg: typeof source?.records.find((r) => r[v as number]?.s !== null)?.[v as number]?.s === "number" || (v as number) >= nSrc + groups.length ? "sum" : "count" }] })} slotProps={{ button: { "aria-label": "Add value field" } }}>
                      {valueIds.map((f) => (
                        <Option key={f} value={f}>
                          {fname(f)}
                        </Option>
                      ))}
                    </Select>
                  }
                >
                  {values.map((d, i) => valueField(d, i))}
                  {colsHaveValues && (
                    <Select size="sm" value={c.valuesAxis ?? "cols"} onChange={(_, v) => v && set({ valuesAxis: v as "rows" | "cols" })} aria-label="Values as">
                      <Option value="cols">Values as columns</Option>
                      <Option value="rows">Values as rows</Option>
                    </Select>
                  )}
                </Section>
                <Section
                  title="Filters"
                  action={
                    <Select size="sm" placeholder="Add" value={null} onChange={(_, v) => v != null && set({ pages: [...(c.pages ?? []), { field: v as number }] })} slotProps={{ button: { "aria-label": "Add filter field" } }}>
                      {fieldIds.map((f) => (
                        <Option key={f} value={f}>
                          {fname(f)}
                        </Option>
                      ))}
                    </Select>
                  }
                >
                  {(c.pages ?? []).map((p, i) => {
                    const items = itemsOf(p.field);
                    return (
                      <Box key={i} sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                        <Typography level="body-sm" sx={{ fontWeight: 600, minWidth: 80 }}>
                          {fname(p.field)}
                        </Typography>
                        <Autocomplete
                          size="sm"
                          multiple
                          placeholder="(All)"
                          options={items}
                          getOptionLabel={(o) => o.label}
                          isOptionEqualToValue={(a, b) => a.key === b.key}
                          value={items.filter((it) => p.selected?.includes(it.key))}
                          onChange={(_, v) => set({ pages: (c.pages ?? []).map((x, j) => (j === i ? { ...x, selected: v.length ? v.map((o) => o.key) : undefined } : x)) })}
                          sx={{ flex: 1 }}
                        />
                        <IconButton size="sm" variant="plain" aria-label={`Remove filter ${fname(p.field)}`} onClick={() => set({ pages: (c.pages ?? []).filter((_, j) => j !== i) })}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    );
                  })}
                </Section>
                <Section
                  title="Calculated fields"
                  action={
                    <Button size="sm" variant="plain" onClick={() => set({ calculated: [...calcs, { name: `Field${calcs.length + 1}`, formula: "" }] })}>
                      Add
                    </Button>
                  }
                >
                  {calcs.map((k, i) => (
                    <Box key={i} sx={{ display: "flex", gap: 0.5 }}>
                      <Input size="sm" value={k.name} onChange={(e) => set({ calculated: calcs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} sx={{ width: 110 }} slotProps={{ input: { "aria-label": "Calculated field name" } }} />
                      <Input
                        size="sm"
                        value={k.formula}
                        placeholder="=Price*Units"
                        color={k.formula && !isValidCalc(k.formula) ? "danger" : "neutral"}
                        onChange={(e) => set({ calculated: calcs.map((x, j) => (j === i ? { ...x, formula: e.target.value } : x)) })}
                        sx={{ flex: 1 }}
                        slotProps={{ input: { "aria-label": "Calculated field formula" } }}
                      />
                      <IconButton size="sm" variant="plain" aria-label="Remove calculated field" onClick={() => set({ calculated: calcs.filter((_, j) => j !== i), values: values.filter((v) => v.field !== nSrc + groups.length + i) })}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Section>
                <Section
                  title="Calculated items"
                  action={
                    <Select
                      size="sm"
                      placeholder="Add to"
                      value={null}
                      onChange={(_, v) => {
                        if (v == null || !source) return;
                        const f = v as number;
                        let n = 1;
                        while (!canAddCalculatedItemName(c, source, f, `Formula${n}`)) n++;
                        set({ calculatedItems: [...cItems, { field: f, name: `Formula${n}`, formula: "" }] });
                      }}
                      slotProps={{ button: { "aria-label": "Add calculated item" } }}
                    >
                      {axisFields.map((f) => (
                        <Option key={f} value={f}>
                          {fname(f)}
                        </Option>
                      ))}
                    </Select>
                  }
                >
                  {cItems.map((k, i) => (
                    <Box key={i} sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <Typography level="body-xs" sx={{ minWidth: 60 }}>
                        {fname(k.field)}
                      </Typography>
                      <Input size="sm" value={k.name} onChange={(e) => set({ calculatedItems: cItems.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} sx={{ width: 100 }} slotProps={{ input: { "aria-label": "Calculated item name" } }} />
                      <Input
                        size="sm"
                        value={k.formula}
                        placeholder="=East-West"
                        color={k.formula && !isValidCalc(k.formula) ? "danger" : "neutral"}
                        onChange={(e) => set({ calculatedItems: cItems.map((x, j) => (j === i ? { ...x, formula: e.target.value } : x)) })}
                        sx={{ flex: 1 }}
                        slotProps={{ input: { "aria-label": "Calculated item formula" } }}
                      />
                      <IconButton size="sm" variant="plain" aria-label="Remove calculated item" onClick={() => set({ calculatedItems: cItems.filter((_, j) => j !== i) })}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Section>
                <Section title="Layout">
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                    <Select size="sm" value={c.layout ?? "compact"} onChange={(_, v) => v && set({ layout: v as PivotConfig["layout"] })} aria-label="Report layout">
                      <Option value="compact">Compact form</Option>
                      <Option value="outline">Outline form</Option>
                      <Option value="tabular">Tabular form</Option>
                    </Select>
                    <Select
                      size="sm"
                      value={c.defaultSubtotal === false ? "none" : c.subtotalTop === false ? "bottom" : "top"}
                      onChange={(_, v) => set(v === "none" ? { defaultSubtotal: false } : { defaultSubtotal: true, subtotalTop: v === "top" })}
                      aria-label="Subtotals"
                    >
                      <Option value="top">Subtotals at top</Option>
                      <Option value="bottom">Subtotals at bottom</Option>
                      <Option value="none">No subtotals</Option>
                    </Select>
                    <Checkbox size="sm" label="Grand total row" checked={c.grandTotalRow !== false} onChange={(e) => set({ grandTotalRow: e.target.checked })} />
                    <Checkbox size="sm" label="Grand total column" checked={c.grandTotalCol !== false} onChange={(e) => set({ grandTotalCol: e.target.checked })} />
                    <Checkbox size="sm" label="Blank row after items" checked={!!c.insertBlankRow} onChange={(e) => set({ insertBlankRow: e.target.checked })} />
                    <Checkbox size="sm" label="Field headers" checked={c.showHeaders !== false} onChange={(e) => set({ showHeaders: e.target.checked })} />
                  </Box>
                </Section>
              </>
            )}
          </Stack>
          <Divider orientation="vertical" />
          <Box sx={{ flex: 1, minWidth: 320, maxHeight: "72vh", overflow: "auto" }}>
            <Typography level="body-xs" sx={{ opacity: 0.7, mb: 0.5 }}>
              Preview
            </Typography>
            {report && !report.empty ? (
              <PivotTableView report={report} maxRows={200} />
            ) : (
              <Typography level="body-sm" sx={{ opacity: 0.6, p: 2 }}>
                Add rows, columns or values to build the pivot table.
              </Typography>
            )}
          </Box>
        </Box>
        {error && (
          <Typography level="body-sm" color="danger" sx={{ mt: 1 }}>
            {error}
          </Typography>
        )}
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1.5 }}>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!names.length}>
            {editing ? "Save pivot table" : "Create"}
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

