import { useState, useCallback, useEffect } from "react";
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
  Divider,
  Chip,
  Checkbox,
  IconButton,
} from "@mui/joy";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// FortuneSheet stores conditional-format rules on the sheet as
// luckysheet_conditionformat_save. Three rule families are supported here:
//   - "default":        a condition (greaterThan, between, …) → text/cell color.
//   - "colorGradation": a 2–3 colour scale mapped across the range's values.
//   - "dataBar":        an in-cell bar whose length tracks the value.
// Color-based rules carry `format` as an array of "rgb(r,g,b)" strings (matching
// FortuneSheet's format[0] indexing); default rules carry {textColor,cellColor}.

type ConditionName =
  | "greaterThan"
  | "lessThan"
  | "equal"
  | "textContains"
  | "between";

type CellRange = Array<{ row: [number, number]; column: [number, number] }>;

interface DefaultRule {
  type: "default";
  cellrange: CellRange;
  format: { textColor: string | null; cellColor: string | null };
  conditionName: ConditionName;
  conditionRange: never[];
  conditionValue: [string] | [string, string];
}
interface ColorScaleRule {
  type: "colorGradation";
  cellrange: CellRange;
  format: string[]; // ["rgb(min)", "rgb(mid)?", "rgb(max)"]
  conditionName: null;
  conditionRange: never[];
  conditionValue: never[];
}
interface DataBarRule {
  type: "dataBar";
  cellrange: CellRange;
  format: string[]; // ["rgb(gradientStart)", "rgb(barColor)"]
  conditionName: null;
  conditionRange: never[];
  conditionValue: never[];
}
type CfRule = DefaultRule | ColorScaleRule | DataBarRule;

type Style = "default" | "colorGradation" | "dataBar";

const STYLE_LABELS: Record<Style, string> = {
  default: "Single color (condition)",
  colorGradation: "Color scale",
  dataBar: "Data bar",
};

const CONDITION_LABELS: Record<ConditionName, string> = {
  greaterThan: "Greater than",
  lessThan: "Less than",
  equal: "Equal to",
  textContains: "Text contains",
  between: "Between",
};

interface ConditionalFormatDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
}

// ---- colour helpers ---------------------------------------------------------

function toHex(c: string | null | undefined, fallback: string): string {
  if (!c) return fallback;
  if (c.startsWith("#")) return c;
  const m = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    const h = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
  }
  return fallback;
}
function toRgb(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "rgb(255,255,255)";
  return `rgb(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)})`;
}

function ruleLabel(rule: CfRule): string {
  if (rule.type === "colorGradation") {
    return `Color scale (${rule.format.length} colors)`;
  }
  if (rule.type === "dataBar") {
    return `Data bar`;
  }
  const cond = CONDITION_LABELS[rule.conditionName] ?? rule.conditionName;
  const vals = rule.conditionValue.join(" and ");
  const fmts: string[] = [];
  if (rule.format.cellColor) fmts.push(`bg ${rule.format.cellColor}`);
  if (rule.format.textColor) fmts.push(`text ${rule.format.textColor}`);
  return `${cond} ${vals} → ${fmts.join(", ") || "no style"}`;
}

// swatches renders the colour preview chips for a rule in the list.
function ruleSwatches(rule: CfRule): string[] {
  if (rule.type === "default") return rule.format.cellColor ? [rule.format.cellColor] : [];
  return rule.format.map((c) => toHex(c, "#ffffff"));
}

/** Parse the current selection into a cellrange array, falling back to A1:Z100. */
function selectionToCellrange(wb: any): CellRange {
  try {
    const selArr = wb?.getSelection?.();
    const sel = Array.isArray(selArr) ? selArr[0] : selArr;
    if (sel)
      return [{ row: [sel.row[0], sel.row[1]], column: [sel.column[0], sel.column[1]] }];
  } catch {
    /* ignore */
  }
  return [{ row: [0, 99], column: [0, 25] }];
}

// Editing form state covers every style; only the relevant fields are read.
interface EditState {
  style: Style;
  conditionName: ConditionName;
  conditionValue: [string] | [string, string];
  textColor: string | null;
  cellColor: string | null;
  scaleMin: string;
  scaleMid: string;
  scaleMax: string;
  useMid: boolean;
  barColor: string;
}

const emptyEdit = (): EditState => ({
  style: "default",
  conditionName: "greaterThan",
  conditionValue: [""],
  textColor: null,
  cellColor: null,
  scaleMin: "#f8696b",
  scaleMid: "#ffeb84",
  scaleMax: "#63be7b",
  useMid: true,
  barColor: "#638ec6",
});

function editFromRule(r: CfRule): EditState {
  const e = emptyEdit();
  e.style = r.type;
  if (r.type === "default") {
    e.conditionName = r.conditionName;
    e.conditionValue = r.conditionValue;
    e.textColor = r.format.textColor;
    e.cellColor = r.format.cellColor;
  } else if (r.type === "colorGradation") {
    e.scaleMin = toHex(r.format[0], "#f8696b");
    if (r.format.length >= 3) {
      e.useMid = true;
      e.scaleMid = toHex(r.format[1], "#ffeb84");
      e.scaleMax = toHex(r.format[2], "#63be7b");
    } else {
      e.useMid = false;
      e.scaleMax = toHex(r.format[1], "#63be7b");
    }
  } else if (r.type === "dataBar") {
    e.barColor = toHex(r.format[r.format.length - 1], "#638ec6");
  }
  return e;
}

export function ConditionalFormatDialog({
  open,
  onClose,
  getWb,
}: ConditionalFormatDialogProps) {
  const [rules, setRules] = useState<CfRule[]>([]);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null); // null = new rule

  const load = useCallback(() => {
    const wb = getWb();
    if (!wb) return;
    try {
      const sheet = wb.getSheet?.();
      const allSheets: any[] = wb.getAllSheets?.() ?? [];
      const s = allSheets.find((x: any) => x.id === sheet?.id) ?? sheet;
      setRules(
        Array.isArray(s?.luckysheet_conditionformat_save)
          ? s.luckysheet_conditionformat_save
          : [],
      );
    } catch {
      setRules([]);
    }
    setEditing(null);
    setEditIdx(null);
  }, [getWb]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  function saveRules(newRules: CfRule[]) {
    const wb = getWb();
    if (!wb) return;
    try {
      const all: any[] = wb.getAllSheets?.() ?? [];
      const curId = wb.getSheet?.()?.id;
      const updated = all.map((s: any) =>
        s.id === curId
          ? { ...s, luckysheet_conditionformat_save: newRules }
          : s,
      );
      wb.updateSheet?.(updated);
    } catch {
      /* ignore */
    }
    setRules(newRules);
  }

  function deleteRule(idx: number) {
    saveRules(rules.filter((_, i) => i !== idx));
  }

  function startEdit(idx: number | null) {
    setEditing(idx === null ? emptyEdit() : editFromRule(rules[idx]));
    setEditIdx(idx);
  }

  function commitEdit() {
    if (!editing) return;
    const wb = getWb();
    if (!wb) return;
    const cellrange =
      editIdx !== null && editIdx < rules.length
        ? rules[editIdx].cellrange
        : selectionToCellrange(wb);

    let rule: CfRule;
    if (editing.style === "colorGradation") {
      const fmt = editing.useMid
        ? [toRgb(editing.scaleMin), toRgb(editing.scaleMid), toRgb(editing.scaleMax)]
        : [toRgb(editing.scaleMin), toRgb(editing.scaleMax)];
      rule = {
        type: "colorGradation",
        cellrange,
        format: fmt,
        conditionName: null,
        conditionRange: [],
        conditionValue: [],
      };
    } else if (editing.style === "dataBar") {
      rule = {
        type: "dataBar",
        cellrange,
        format: ["rgb(255,255,255)", toRgb(editing.barColor)],
        conditionName: null,
        conditionRange: [],
        conditionValue: [],
      };
    } else {
      const v0 = (editing.conditionValue?.[0] ?? "").toString();
      const v1 =
        editing.conditionName === "between"
          ? (editing.conditionValue?.[1] ?? "").toString()
          : undefined;
      rule = {
        type: "default",
        cellrange,
        format: { textColor: editing.textColor, cellColor: editing.cellColor },
        conditionName: editing.conditionName,
        conditionRange: [],
        conditionValue: v1 != null ? [v0, v1] : [v0],
      };
    }
    const next =
      editIdx !== null ? rules.map((r, i) => (i === editIdx ? rule : r)) : [...rules, rule];
    saveRules(next);
    setEditing(null);
    setEditIdx(null);
  }

  const e = editing;
  const isBetween = e?.conditionName === "between";

  // small reusable colour input
  const colorInput = (val: string, onChange: (v: string) => void, label: string) => (
    <input
      type="color"
      value={val}
      onChange={(ev) => onChange(ev.target.value)}
      style={{
        width: 40,
        height: 32,
        padding: 2,
        border: "1px solid #ccc",
        borderRadius: 4,
        cursor: "pointer",
      }}
      aria-label={label}
    />
  );

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 500, maxWidth: "95vw" }} aria-labelledby="cf-title">
        <ModalClose />
        <Typography id="cf-title" level="title-lg">
          Conditional formatting
        </Typography>

        {!editing && (
          <Stack spacing={1} sx={{ mt: 1 }}>
            {rules.length === 0 && (
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                No rules on this sheet.
              </Typography>
            )}
            {rules.map((r, i) => (
              <Box
                key={i}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  p: 1,
                  borderRadius: "sm",
                  bgcolor: "background.level1",
                }}
              >
                <Box sx={{ display: "flex", gap: 0.25, flexShrink: 0 }}>
                  {ruleSwatches(r).map((c, j) => (
                    <Box
                      key={j}
                      sx={{
                        width: 16,
                        height: 16,
                        borderRadius: "2px",
                        bgcolor: c,
                        border: "1px solid",
                        borderColor: "divider",
                      }}
                    />
                  ))}
                </Box>
                <Typography
                  level="body-sm"
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ruleLabel(r)}
                </Typography>
                <IconButton size="sm" variant="plain" onClick={() => startEdit(i)} aria-label="Edit rule">
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="plain"
                  color="danger"
                  onClick={() => deleteRule(i)}
                  aria-label="Delete rule"
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Box sx={{ display: "flex", gap: 1, justifyContent: "space-between", mt: 1 }}>
              <Button variant="outlined" onClick={() => startEdit(null)}>
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
            <Typography level="title-sm">
              {editIdx === null ? "New rule" : "Edit rule"}
            </Typography>

            <FormControl>
              <FormLabel>Format style</FormLabel>
              <Select
                value={e.style}
                onChange={(_, v) => v && setEditing({ ...e, style: v as Style })}
                aria-label="Format style"
              >
                {(Object.entries(STYLE_LABELS) as [Style, string][]).map(([k, label]) => (
                  <Option key={k} value={k}>
                    {label}
                  </Option>
                ))}
              </Select>
            </FormControl>

            {/* ---- Single-color (condition) rule ---- */}
            {e.style === "default" && (
              <>
                <FormControl>
                  <FormLabel>Condition</FormLabel>
                  <Select
                    value={e.conditionName}
                    onChange={(_, v) => v && setEditing({ ...e, conditionName: v as ConditionName })}
                    aria-label="Condition type"
                  >
                    {(Object.entries(CONDITION_LABELS) as [ConditionName, string][]).map(([k, label]) => (
                      <Option key={k} value={k}>
                        {label}
                      </Option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>{isBetween ? "Minimum value" : "Value"}</FormLabel>
                  <Input
                    value={e.conditionValue?.[0] ?? ""}
                    onChange={(ev) =>
                      setEditing({
                        ...e,
                        conditionValue: [ev.target.value, (e.conditionValue as any)?.[1] ?? ""] as any,
                      })
                    }
                    placeholder={e.conditionName === "textContains" ? "Text to match" : "Enter value"}
                    slotProps={{ input: { "aria-label": "Condition value" } }}
                  />
                </FormControl>
                {isBetween && (
                  <FormControl>
                    <FormLabel>Maximum value</FormLabel>
                    <Input
                      value={(e.conditionValue as any)?.[1] ?? ""}
                      onChange={(ev) =>
                        setEditing({
                          ...e,
                          conditionValue: [e.conditionValue?.[0] ?? "", ev.target.value] as [string, string],
                        })
                      }
                      placeholder="Enter value"
                      slotProps={{ input: { "aria-label": "Second condition value" } }}
                    />
                  </FormControl>
                )}
                <Divider />
                <Typography level="title-sm">Formatting</Typography>
                <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                  <FormControl sx={{ flex: 1, minWidth: 140 }}>
                    <FormLabel>Background color</FormLabel>
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                      {colorInput(e.cellColor ?? "#ffffff", (v) => setEditing({ ...e, cellColor: v }), "Background color")}
                      {e.cellColor ? (
                        <Chip
                          size="sm"
                          variant="soft"
                          endDecorator={
                            <span style={{ cursor: "pointer" }} onClick={() => setEditing({ ...e, cellColor: null })}>
                              ×
                            </span>
                          }
                        >
                          {e.cellColor}
                        </Chip>
                      ) : (
                        <Typography level="body-xs" sx={{ opacity: 0.5 }}>
                          None
                        </Typography>
                      )}
                    </Box>
                  </FormControl>
                  <FormControl sx={{ flex: 1, minWidth: 140 }}>
                    <FormLabel>Text color</FormLabel>
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                      {colorInput(e.textColor ?? "#000000", (v) => setEditing({ ...e, textColor: v }), "Text color")}
                      {e.textColor ? (
                        <Chip
                          size="sm"
                          variant="soft"
                          endDecorator={
                            <span style={{ cursor: "pointer" }} onClick={() => setEditing({ ...e, textColor: null })}>
                              ×
                            </span>
                          }
                        >
                          {e.textColor}
                        </Chip>
                      ) : (
                        <Typography level="body-xs" sx={{ opacity: 0.5 }}>
                          None
                        </Typography>
                      )}
                    </Box>
                  </FormControl>
                </Box>
              </>
            )}

            {/* ---- Color scale ---- */}
            {e.style === "colorGradation" && (
              <>
                <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                  Colors map from the lowest to highest value in the selection.
                </Typography>
                <Box sx={{ display: "flex", gap: 2, alignItems: "flex-end" }}>
                  <FormControl>
                    <FormLabel>Min</FormLabel>
                    {colorInput(e.scaleMin, (v) => setEditing({ ...e, scaleMin: v }), "Minimum color")}
                  </FormControl>
                  <FormControl>
                    <FormLabel>Mid</FormLabel>
                    {colorInput(e.scaleMid, (v) => setEditing({ ...e, scaleMid: v }), "Midpoint color")}
                  </FormControl>
                  <FormControl>
                    <FormLabel>Max</FormLabel>
                    {colorInput(e.scaleMax, (v) => setEditing({ ...e, scaleMax: v }), "Maximum color")}
                  </FormControl>
                </Box>
                <Checkbox
                  size="sm"
                  label="Use a midpoint color (3-color scale)"
                  checked={e.useMid}
                  onChange={(ev) => setEditing({ ...e, useMid: ev.target.checked })}
                />
              </>
            )}

            {/* ---- Data bar ---- */}
            {e.style === "dataBar" && (
              <>
                <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                  Each cell shows a bar proportional to its value.
                </Typography>
                <FormControl>
                  <FormLabel>Bar color</FormLabel>
                  {colorInput(e.barColor, (v) => setEditing({ ...e, barColor: v }), "Bar color")}
                </FormControl>
              </>
            )}

            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 0.5 }}>
              <Button
                variant="plain"
                onClick={() => {
                  setEditing(null);
                  setEditIdx(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={commitEdit}>Save rule</Button>
            </Box>
          </Stack>
        )}
      </ModalDialog>
    </Modal>
  );
}
