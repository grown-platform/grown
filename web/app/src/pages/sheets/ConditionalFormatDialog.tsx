import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormLabel,
  IconButton,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Select,
  Stack,
  Typography,
} from "@mui/joy";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import {
  addRule,
  colorScaleRule,
  describeRule,
  deleteRule,
  ICON_COUNTS,
  ICON_SET_LABELS,
  ICON_SETS,
  moveRule,
  newRule,
  rangesText,
  setIconSet,
  sortByPriority,
  type CellIsOp,
  type CfRule,
  type CfType,
  type Cfvo,
  type CfvoType,
  type DataBarOptions,
  type IconSetName,
  type TimePeriod,
} from "./cfOps";
import { currentSheet, drawIcon, setSheetCF, sheetCF } from "./sheetDataTools";
import { parseA1Range } from "./cellValue";
import type { CellRect } from "./cellRange";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Conditional formatting rules manager. Rules are Grown's own model
// (cfOps.ts, stored on the sheet as `grownCF`); the grid paints them through
// sheetDataTools.ts. Rules run in priority order (top of the list first); a
// higher rule's colours win, and "Stop if true" skips the rules below it.

const TYPE_LABELS: [CfType, string][] = [
  ["cellIs", "Cell value"],
  ["containsText", "Text contains"],
  ["notContainsText", "Text does not contain"],
  ["beginsWith", "Text begins with"],
  ["endsWith", "Text ends with"],
  ["timePeriod", "Date occurring"],
  ["containsBlanks", "Cell is empty"],
  ["notContainsBlanks", "Cell is not empty"],
  ["containsErrors", "Cell has an error"],
  ["notContainsErrors", "Cell has no error"],
  ["duplicateValues", "Duplicate values"],
  ["uniqueValues", "Unique values"],
  ["top10", "Top / bottom rank"],
  ["aboveAverage", "Above / below average"],
  ["expression", "Custom formula"],
  ["colorScale", "Colour scale"],
  ["dataBar", "Data bar"],
  ["iconSet", "Icon set"],
];

const CELL_OPS: [CellIsOp, string][] = [
  ["greaterThan", "Greater than"],
  ["greaterThanOrEqual", "Greater than or equal to"],
  ["lessThan", "Less than"],
  ["lessThanOrEqual", "Less than or equal to"],
  ["equal", "Equal to"],
  ["notEqual", "Not equal to"],
  ["between", "Between"],
  ["notBetween", "Not between"],
];

const PERIODS: [TimePeriod, string][] = [
  ["yesterday", "Yesterday"],
  ["today", "Today"],
  ["tomorrow", "Tomorrow"],
  ["last7Days", "In the last 7 days"],
  ["lastWeek", "Last week"],
  ["thisWeek", "This week"],
  ["nextWeek", "Next week"],
  ["lastMonth", "Last month"],
  ["thisMonth", "This month"],
  ["nextMonth", "Next month"],
];

const CFVO_TYPES: [CfvoType, string][] = [
  ["min", "Minimum"],
  ["max", "Maximum"],
  ["autoMin", "Automatic minimum"],
  ["autoMax", "Automatic maximum"],
  ["num", "Number"],
  ["percent", "Percent"],
  ["percentile", "Percentile"],
  ["formula", "Formula"],
];

const FORMATTING_TYPES = new Set<CfType>([
  "cellIs",
  "containsText",
  "notContainsText",
  "beginsWith",
  "endsWith",
  "timePeriod",
  "containsBlanks",
  "notContainsBlanks",
  "containsErrors",
  "notContainsErrors",
  "duplicateValues",
  "uniqueValues",
  "top10",
  "aboveAverage",
  "expression",
]);

interface ConditionalFormatDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
}

function selectionRanges(wb: any): CellRect[] {
  try {
    const s = wb?.getSelection?.();
    const list = Array.isArray(s) ? s : s ? [s] : [];
    const out = list.map((x: any) => ({
      r1: Math.min(x.row[0], x.row[1]),
      r2: Math.max(x.row[0], x.row[1]),
      c1: Math.min(x.column[0], x.column[1]),
      c2: Math.max(x.column[0], x.column[1]),
    }));
    if (out.length) return out;
  } catch {
    /* ignore */
  }
  return [{ r1: 0, c1: 0, r2: 99, c2: 25 }];
}

/** "A1:B10, D2" → rectangles (null when any part is not a reference). */
export function parseRanges(text: string, maxRow = 1048575, maxCol = 16383): CellRect[] | null {
  const parts = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const out: CellRect[] = [];
  for (const p of parts) {
    const r = parseA1Range(p, maxRow, maxCol);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="color"
      value={value}
      onChange={(ev) => onChange(ev.target.value)}
      style={{ width: 36, height: 30, padding: 2, border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }}
      aria-label={label}
    />
  );
}

function IconPreview({ set }: { set: IconSetName }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ICON_SETS[set].forEach((g, i) => drawIcon(ctx, g, 2 + i * 18, 2, 14));
  }, [set]);
  return <canvas ref={ref} width={ICON_SETS[set].length * 18 + 2} height={18} aria-hidden />;
}

function Swatches({ rule }: { rule: CfRule }) {
  let colors: string[] = [];
  if (rule.type === "colorScale") colors = rule.colors ?? [];
  else if (rule.type === "dataBar") colors = [rule.bar?.color ?? "#638ec6"];
  else colors = [rule.style?.fill, rule.style?.color].filter(Boolean) as string[];
  if (rule.type === "iconSet") return <IconPreview set={rule.iconSet ?? "3TrafficLights1"} />;
  return (
    <Box sx={{ display: "flex", gap: 0.25, flexShrink: 0 }}>
      {colors.map((c, j) => (
        <Box key={j} sx={{ width: 16, height: 16, borderRadius: "2px", bgcolor: c, border: "1px solid", borderColor: "divider" }} />
      ))}
    </Box>
  );
}

function CfvoEditor({
  cfvo,
  onChange,
  label,
  types,
  showGte,
}: {
  cfvo: Cfvo;
  onChange: (c: Cfvo) => void;
  label: string;
  types: CfvoType[];
  showGte?: boolean;
}) {
  const needsValue = !["min", "max", "autoMin", "autoMax"].includes(cfvo.type);
  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
      <Typography level="body-sm" sx={{ minWidth: 70 }}>
        {label}
      </Typography>
      {showGte && (
        <Select
          size="sm"
          value={cfvo.gte === false ? ">" : ">="}
          onChange={(_, v) => onChange({ ...cfvo, gte: v !== ">" })}
          slotProps={{ button: { "aria-label": `${label} comparison` } }}
        >
          <Option value=">=">≥</Option>
          <Option value=">">&gt;</Option>
        </Select>
      )}
      <Select
        size="sm"
        value={cfvo.type}
        onChange={(_, v) => v && onChange({ ...cfvo, type: v as CfvoType })}
        slotProps={{ button: { "aria-label": `${label} type` } }}
      >
        {CFVO_TYPES.filter(([k]) => types.includes(k)).map(([k, l]) => (
          <Option key={k} value={k}>
            {l}
          </Option>
        ))}
      </Select>
      {needsValue && (
        <Input
          size="sm"
          sx={{ width: 110 }}
          value={cfvo.value ?? ""}
          onChange={(e) => onChange({ ...cfvo, value: e.target.value })}
          slotProps={{ input: { "aria-label": `${label} value` } }}
        />
      )}
    </Box>
  );
}

export function ConditionalFormatDialog({ open, onClose, getWb }: ConditionalFormatDialogProps) {
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [rules, setRules] = useState<CfRule[]>([]);
  const [editing, setEditing] = useState<CfRule | null>(null);
  const [rangeText, setRangeText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    const sheet = currentSheet(getWb());
    setSheetId(sheet?.id ?? null);
    setRules(sortByPriority(sheetCF(sheet)));
    setEditing(null);
    setErr(null);
  }, [getWb]);

  useEffect(() => {
    if (open) load();
  // Load once per opening: getWb is a new function on every editor render.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function save(next: CfRule[]) {
    const wb = getWb();
    if (!wb || !sheetId) return;
    setSheetCF(wb, sheetId, next);
    setRules(sortByPriority(next));
  }

  function startNew() {
    const ranges = selectionRanges(getWb());
    setEditing(newRule("cellIs", ranges));
    setRangeText(rangesText(ranges));
    setErr(null);
  }

  function startEdit(r: CfRule) {
    setEditing({ ...r });
    setRangeText(rangesText(r.ranges));
    setErr(null);
  }

  function changeType(t: CfType) {
    if (!editing) return;
    const base =
      t === "colorScale"
        ? colorScaleRule(editing.ranges, 3)
        : newRule(t, editing.ranges, FORMATTING_TYPES.has(t) && editing.style ? { style: editing.style } : {});
    setEditing({ ...base, id: editing.id, priority: editing.priority, stopIfTrue: editing.stopIfTrue });
  }

  function commit() {
    if (!editing) return;
    const ranges = parseRanges(rangeText);
    if (!ranges) {
      setErr("Enter the cells to format, e.g. A1:B10 or A1:A10, C1:C10.");
      return;
    }
    const e = { ...editing, ranges };
    if ((e.type === "cellIs" && !(e.formula1 ?? "").trim()) || (e.type === "expression" && !(e.formula1 ?? "").trim())) {
      setErr("Enter a value or formula.");
      return;
    }
    if (e.type === "expression" && !e.formula1!.trim().startsWith("=")) e.formula1 = "=" + e.formula1!.trim();
    const exists = rules.some((r) => r.id === e.id);
    save(exists ? rules.map((r) => (r.id === e.id ? e : r)) : addRule(rules, e));
    setEditing(null);
  }

  const e = editing;
  const set = (patch: Partial<CfRule>) => e && setEditing({ ...e, ...patch });
  const setBar = (patch: Partial<DataBarOptions>) => e && setEditing({ ...e, bar: { ...e.bar!, ...patch } });

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 560, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }} aria-labelledby="cf-title">
        <ModalClose />
        <Typography id="cf-title" level="title-lg">
          Conditional formatting
        </Typography>

        {!e && (
          <Stack spacing={1} sx={{ mt: 1 }}>
            {rules.length === 0 && (
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                No rules on this sheet.
              </Typography>
            )}
            {rules.map((r, i) => (
              <Box
                key={r.id}
                sx={{ display: "flex", alignItems: "center", gap: 1, p: 1, borderRadius: "sm", bgcolor: "background.level1" }}
                data-testid="cf-rule"
              >
                <Swatches rule={r} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography level="body-sm" noWrap>
                    {describeRule(r)}
                  </Typography>
                  <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
                    {rangesText(r.ranges)}
                  </Typography>
                </Box>
                <Checkbox
                  size="sm"
                  label="Stop if true"
                  checked={!!r.stopIfTrue}
                  onChange={(ev) => save(rules.map((x) => (x.id === r.id ? { ...x, stopIfTrue: ev.target.checked } : x)))}
                />
                <IconButton size="sm" variant="plain" disabled={i === 0} onClick={() => save(moveRule(rules, r.id, -1))} aria-label="Move rule up">
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="plain"
                  disabled={i === rules.length - 1}
                  onClick={() => save(moveRule(rules, r.id, 1))}
                  aria-label="Move rule down"
                >
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
                <IconButton size="sm" variant="plain" onClick={() => startEdit(r)} aria-label="Edit rule">
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="sm" variant="plain" color="danger" onClick={() => save(deleteRule(rules, r.id))} aria-label="Delete rule">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Box sx={{ display: "flex", gap: 1, justifyContent: "space-between", mt: 1 }}>
              <Button variant="outlined" onClick={startNew}>
                Add rule
              </Button>
              <Button variant="plain" onClick={onClose}>
                Done
              </Button>
            </Box>
          </Stack>
        )}

        {e && (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <FormControl>
              <FormLabel>Apply to range</FormLabel>
              <Input
                value={rangeText}
                onChange={(ev) => setRangeText(ev.target.value)}
                slotProps={{ input: { "aria-label": "Apply to range" } }}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Format cells if…</FormLabel>
              <Select value={e.type} onChange={(_, v) => v && changeType(v as CfType)} slotProps={{ button: { "aria-label": "Rule type" } }}>
                {TYPE_LABELS.map(([k, l]) => (
                  <Option key={k} value={k}>
                    {l}
                  </Option>
                ))}
              </Select>
            </FormControl>

            {e.type === "cellIs" && (
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <Select
                  value={e.operator ?? "greaterThan"}
                  onChange={(_, v) => v && set({ operator: v as CellIsOp })}
                  slotProps={{ button: { "aria-label": "Condition type" } }}
                  sx={{ minWidth: 200 }}
                >
                  {CELL_OPS.map(([k, l]) => (
                    <Option key={k} value={k}>
                      {l}
                    </Option>
                  ))}
                </Select>
                <Input
                  value={e.formula1 ?? ""}
                  onChange={(ev) => set({ formula1: ev.target.value })}
                  placeholder="Value or =formula"
                  slotProps={{ input: { "aria-label": "Condition value" } }}
                />
                {(e.operator === "between" || e.operator === "notBetween") && (
                  <Input
                    value={e.formula2 ?? ""}
                    onChange={(ev) => set({ formula2: ev.target.value })}
                    placeholder="and"
                    slotProps={{ input: { "aria-label": "Second condition value" } }}
                  />
                )}
              </Box>
            )}

            {(e.type === "containsText" || e.type === "notContainsText" || e.type === "beginsWith" || e.type === "endsWith") && (
              <Input
                value={e.text ?? ""}
                onChange={(ev) => set({ text: ev.target.value })}
                placeholder="Text, or =formula"
                slotProps={{ input: { "aria-label": "Condition value" } }}
              />
            )}

            {e.type === "timePeriod" && (
              <Select value={e.period ?? "today"} onChange={(_, v) => v && set({ period: v as TimePeriod })} slotProps={{ button: { "aria-label": "Date period" } }}>
                {PERIODS.map(([k, l]) => (
                  <Option key={k} value={k}>
                    {l}
                  </Option>
                ))}
              </Select>
            )}

            {e.type === "top10" && (
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <Select value={e.bottom ? "bottom" : "top"} onChange={(_, v) => set({ bottom: v === "bottom" })}>
                  <Option value="top">Top</Option>
                  <Option value="bottom">Bottom</Option>
                </Select>
                <Input
                  type="number"
                  value={String(e.rank ?? 10)}
                  onChange={(ev) => set({ rank: Number(ev.target.value) || 1 })}
                  sx={{ width: 90 }}
                  slotProps={{ input: { "aria-label": "Rank" } }}
                />
                <Checkbox label="% of range" checked={!!e.percent} onChange={(ev) => set({ percent: ev.target.checked })} />
              </Box>
            )}

            {e.type === "aboveAverage" && (
              <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                <Select value={e.above === false ? "below" : "above"} onChange={(_, v) => set({ above: v !== "below" })}>
                  <Option value="above">Above</Option>
                  <Option value="below">Below</Option>
                </Select>
                <Checkbox label="or equal to" checked={!!e.equalAverage} onChange={(ev) => set({ equalAverage: ev.target.checked })} />
                <Typography level="body-sm">Std. deviations</Typography>
                <Input
                  type="number"
                  value={String(e.stdDev ?? 0)}
                  onChange={(ev) => set({ stdDev: Math.max(0, Number(ev.target.value) || 0) })}
                  sx={{ width: 80 }}
                  slotProps={{ input: { "aria-label": "Standard deviations" } }}
                />
              </Box>
            )}

            {e.type === "expression" && (
              <Input
                value={e.formula1 ?? ""}
                onChange={(ev) => set({ formula1: ev.target.value })}
                placeholder="=$A1>10"
                slotProps={{ input: { "aria-label": "Custom formula" } }}
              />
            )}

            {FORMATTING_TYPES.has(e.type) && (
              <>
                <Divider />
                <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center" }}>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <Typography level="body-sm">Fill</Typography>
                    <ColorInput
                      value={e.style?.fill ?? "#ffffff"}
                      onChange={(v) => set({ style: { ...e.style, fill: v } })}
                      label="Background color"
                    />
                    {e.style?.fill ? (
                      <Chip size="sm" onClick={() => set({ style: { ...e.style, fill: null } })}>
                        clear
                      </Chip>
                    ) : (
                      <Typography level="body-xs">none</Typography>
                    )}
                  </Box>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <Typography level="body-sm">Text</Typography>
                    <ColorInput
                      value={e.style?.color ?? "#000000"}
                      onChange={(v) => set({ style: { ...e.style, color: v } })}
                      label="Text color"
                    />
                    {e.style?.color ? (
                      <Chip size="sm" onClick={() => set({ style: { ...e.style, color: null } })}>
                        clear
                      </Chip>
                    ) : (
                      <Typography level="body-xs">none</Typography>
                    )}
                  </Box>
                </Box>
              </>
            )}

            {e.type === "colorScale" && (
              <Stack spacing={1}>
                <Select
                  size="sm"
                  value={String(e.cfvos?.length ?? 2)}
                  onChange={(_, v) => {
                    const rr = colorScaleRule(e.ranges, v === "3" ? 3 : 2);
                    set({ cfvos: rr.cfvos, colors: rr.colors });
                  }}
                  slotProps={{ button: { "aria-label": "Colour scale stops" } }}
                >
                  <Option value="2">2-colour scale</Option>
                  <Option value="3">3-colour scale</Option>
                </Select>
                {(e.cfvos ?? []).map((cv, i) => (
                  <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <ColorInput
                      value={e.colors?.[i] ?? "#ffffff"}
                      onChange={(v) => set({ colors: (e.colors ?? []).map((c, j) => (j === i ? v : c)) })}
                      label={`Stop ${i + 1} colour`}
                    />
                    <CfvoEditor
                      cfvo={cv}
                      label={i === 0 ? "Minpoint" : i === (e.cfvos?.length ?? 0) - 1 ? "Maxpoint" : "Midpoint"}
                      types={i === 0 ? ["min", "num", "percent", "percentile", "formula"] : i === (e.cfvos?.length ?? 0) - 1 ? ["max", "num", "percent", "percentile", "formula"] : ["num", "percent", "percentile", "formula"]}
                      onChange={(c) => set({ cfvos: (e.cfvos ?? []).map((x, j) => (j === i ? c : x)) })}
                    />
                  </Box>
                ))}
              </Stack>
            )}

            {e.type === "dataBar" && e.bar && (
              <Stack spacing={1}>
                <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
                  <Typography level="body-sm">Bar</Typography>
                  <ColorInput value={e.bar.color} onChange={(v) => setBar({ color: v })} label="Bar color" />
                  <Typography level="body-sm">Negative</Typography>
                  <ColorInput value={e.bar.negativeColor} onChange={(v) => setBar({ negativeColor: v })} label="Negative bar color" />
                  <Checkbox
                    size="sm"
                    label="Border"
                    checked={!!e.bar.borderColor}
                    onChange={(ev) => setBar({ borderColor: ev.target.checked ? e.bar!.color : null })}
                  />
                  <Checkbox size="sm" label="Gradient" checked={e.bar.gradient} onChange={(ev) => setBar({ gradient: ev.target.checked })} />
                  <Checkbox size="sm" label="Show bar only" checked={!e.bar.showValue} onChange={(ev) => setBar({ showValue: !ev.target.checked })} />
                </Box>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <Select size="sm" value={e.bar.axisPosition} onChange={(_, v) => v && setBar({ axisPosition: v })} slotProps={{ button: { "aria-label": "Axis position" } }}>
                    <Option value="automatic">Axis: automatic</Option>
                    <Option value="middle">Axis: cell midpoint</Option>
                    <Option value="none">No axis</Option>
                  </Select>
                  <Select size="sm" value={e.bar.direction} onChange={(_, v) => v && setBar({ direction: v })} slotProps={{ button: { "aria-label": "Bar direction" } }}>
                    <Option value="context">Direction: context</Option>
                    <Option value="leftToRight">Left to right</Option>
                    <Option value="rightToLeft">Right to left</Option>
                  </Select>
                </Box>
                <CfvoEditor cfvo={e.bar.min} label="Minimum" types={["autoMin", "min", "num", "percent", "percentile", "formula"]} onChange={(c) => setBar({ min: c })} />
                <CfvoEditor cfvo={e.bar.max} label="Maximum" types={["autoMax", "max", "num", "percent", "percentile", "formula"]} onChange={(c) => setBar({ max: c })} />
                <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                  <Typography level="body-sm">Bar length %</Typography>
                  <Input size="sm" type="number" value={String(e.bar.minLength)} onChange={(ev) => setBar({ minLength: Number(ev.target.value) || 0 })} sx={{ width: 80 }} slotProps={{ input: { "aria-label": "Shortest bar" } }} />
                  <Typography level="body-sm">to</Typography>
                  <Input size="sm" type="number" value={String(e.bar.maxLength)} onChange={(ev) => setBar({ maxLength: Number(ev.target.value) || 100 })} sx={{ width: 80 }} slotProps={{ input: { "aria-label": "Longest bar" } }} />
                </Box>
              </Stack>
            )}

            {e.type === "iconSet" && (
              <Stack spacing={1}>
                <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                  <Select
                    size="sm"
                    value={e.iconSet ?? "3TrafficLights1"}
                    onChange={(_, v) => v && setEditing(setIconSet(e, v as IconSetName))}
                    slotProps={{ button: { "aria-label": "Icon style" } }}
                    sx={{ minWidth: 220 }}
                  >
                    {(Object.keys(ICON_COUNTS) as IconSetName[]).map((k) => (
                      <Option key={k} value={k}>
                        {ICON_SET_LABELS[k]}
                      </Option>
                    ))}
                  </Select>
                  <IconPreview set={e.iconSet ?? "3TrafficLights1"} />
                </Box>
                <Box sx={{ display: "flex", gap: 2 }}>
                  <Checkbox size="sm" label="Reverse icon order" checked={!!e.reverse} onChange={(ev) => set({ reverse: ev.target.checked })} />
                  <Checkbox size="sm" label="Show icon only" checked={e.showValue === false} onChange={(ev) => set({ showValue: !ev.target.checked })} />
                </Box>
                {(e.cfvos ?? []).slice(1).map((cv, k) => {
                  const i = k + 1;
                  return (
                    <CfvoEditor
                      key={i}
                      cfvo={cv}
                      showGte
                      label={`Icon ${i + 1} when`}
                      types={["num", "percent", "percentile", "formula"]}
                      onChange={(c) => set({ cfvos: (e.cfvos ?? []).map((x, j) => (j === i ? c : x)) })}
                    />
                  );
                })}
              </Stack>
            )}

            {err && (
              <Typography level="body-sm" color="danger">
                {err}
              </Typography>
            )}
            <Box sx={{ display: "flex", gap: 1, justifyContent: "space-between", mt: 0.5 }}>
              <Checkbox size="sm" label="Stop if true" checked={!!e.stopIfTrue} onChange={(ev) => set({ stopIfTrue: ev.target.checked })} />
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button variant="plain" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button onClick={commit}>Save rule</Button>
              </Box>
            </Box>
          </Stack>
        )}
      </ModalDialog>
    </Modal>
  );
}
