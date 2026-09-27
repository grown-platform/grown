import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Select,
  Stack,
  Textarea,
  Typography,
} from "@mui/joy";
import {
  deleteValidation,
  describeCriteria,
  setValidation,
  validationAt,
  type DvAlertStyle,
  type DvOperator,
  type DvRule,
  type DvType,
} from "./validationOps";
import { currentSheet, setCircleInvalid, setSheetDV, sheetDV } from "./sheetDataTools";
import { rectToA1, serialToParts } from "./cellValue";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Data validation dialog over Grown's rule model (validationOps.ts, stored on
// the sheet as `grownDV`). Applying replaces any validation on the selected
// cells (other rules are trimmed around them); Remove clears the selection.

const TYPE_LABELS: [DvType, string][] = [
  ["list", "List of items / range"],
  ["whole", "Whole number"],
  ["decimal", "Decimal"],
  ["date", "Date"],
  ["time", "Time"],
  ["textLength", "Text length"],
  ["custom", "Custom formula"],
  ["checkbox", "Checkbox"],
  ["any", "Any value (message only)"],
];

const OPS: [DvOperator, string][] = [
  ["between", "Between"],
  ["notBetween", "Not between"],
  ["equal", "Equal to"],
  ["notEqual", "Not equal to"],
  ["greaterThan", "Greater than"],
  ["lessThan", "Less than"],
  ["greaterThanOrEqual", "Greater than or equal to"],
  ["lessThanOrEqual", "Less than or equal to"],
];

const HAS_OPERATOR = new Set<DvType>(["whole", "decimal", "date", "time", "textLength"]);

interface SelRange {
  r1: number;
  r2: number;
  c1: number;
  c2: number;
}

function getSelection(wb: any): SelRange | null {
  try {
    const selArr = wb?.getSelection?.();
    const sel = Array.isArray(selArr) ? selArr[0] : selArr;
    if (sel && sel.row && sel.column) {
      return {
        r1: Math.min(sel.row[0], sel.row[1]),
        r2: Math.max(sel.row[0], sel.row[1]),
        c1: Math.min(sel.column[0], sel.column[1]),
        c2: Math.max(sel.column[0], sel.column[1]),
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Shows a stored operand the way it was typed (serials back to dates/times). */
function shownValue(type: DvType, f: string): string {
  if (!f || f.startsWith("=")) return f;
  const n = Number(f);
  if (!Number.isFinite(n)) return f;
  if (type === "date") {
    const p = serialToParts(n);
    return `${p.m}/${p.d}/${p.y}`;
  }
  if (type === "time") {
    const p = serialToParts(n);
    return `${p.hh}:${String(p.mm).padStart(2, "0")}`;
  }
  return f;
}

interface DataValidationDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
}

export function DataValidationDialog({ open, onClose, getWb }: DataValidationDialogProps) {
  const [sel, setSel] = useState<SelRange | null>(null);
  const [type, setType] = useState<DvType>("list");
  const [op, setOp] = useState<DvOperator>("between");
  const [value1, setValue1] = useState("");
  const [value2, setValue2] = useState("");
  const [checked, setChecked] = useState("TRUE");
  const [unchecked, setUnchecked] = useState("FALSE");
  const [allowBlank, setAllowBlank] = useState(true);
  const [dropdown, setDropdown] = useState(true);
  const [showInput, setShowInput] = useState(true);
  const [promptTitle, setPromptTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [showError, setShowError] = useState(true);
  const [errorStyle, setErrorStyle] = useState<DvAlertStyle>("stop");
  const [errorTitle, setErrorTitle] = useState("");
  const [error, setError] = useState("");
  const [circle, setCircle] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    const wb = getWb();
    if (!wb) return;
    const s = getSelection(wb);
    setSel(s);
    setErr(null);
    const sheet = currentSheet(wb);
    setCircle(!!sheet?.grownCircleInvalid);
    const rule: DvRule | null = s ? validationAt(sheetDV(sheet), s.r1, s.c1) : null;
    setType(rule?.type ?? "list");
    setOp(rule?.operator ?? "between");
    setValue1(rule ? shownValue(rule.type, rule.formula1) : "");
    setValue2(rule ? shownValue(rule.type, rule.formula2) : "");
    setChecked(rule?.checked ?? "TRUE");
    setUnchecked(rule?.unchecked ?? "FALSE");
    setAllowBlank(rule?.allowBlank ?? true);
    setDropdown(rule?.showDropdown ?? true);
    setShowInput(rule?.showInput ?? true);
    setPromptTitle(rule?.promptTitle ?? "");
    setPrompt(rule?.prompt ?? "");
    setShowError(rule?.showError ?? true);
    setErrorStyle(rule?.errorStyle ?? "stop");
    setErrorTitle(rule?.errorTitle ?? "");
    setError(rule?.error ?? "");
  }, [getWb]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  function apply() {
    const wb = getWb();
    const sheet = currentSheet(wb);
    if (!sel || !sheet?.id) {
      setErr("Select a range of cells first.");
      return;
    }
    const needs1 = type === "list" || type === "custom" || HAS_OPERATOR.has(type);
    if (needs1 && !value1.trim()) {
      setErr(type === "list" ? "Enter the list items or a range such as =$D$1:$D$9." : "Enter a value.");
      return;
    }
    if (HAS_OPERATOR.has(type) && (op === "between" || op === "notBetween") && !value2.trim()) {
      setErr("Enter both values.");
      return;
    }
    const f1 = type === "custom" && !value1.trim().startsWith("=") ? "=" + value1.trim() : value1.trim();
    const { rules } = setValidation(sheetDV(sheet), sel, {
      type,
      operator: HAS_OPERATOR.has(type) ? op : "between",
      formula1: f1,
      formula2: HAS_OPERATOR.has(type) && (op === "between" || op === "notBetween") ? value2.trim() : "",
      allowBlank,
      showDropdown: dropdown,
      showInput,
      promptTitle,
      prompt,
      showError,
      errorStyle,
      errorTitle,
      error,
      checked,
      unchecked,
    });
    setSheetDV(wb, sheet.id, rules);
    onClose();
  }

  function remove() {
    const wb = getWb();
    const sheet = currentSheet(wb);
    if (sel && sheet?.id) setSheetDV(wb, sheet.id, deleteValidation(sheetDV(sheet), sel));
    onClose();
  }

  function toggleCircle(on: boolean) {
    const wb = getWb();
    const sheet = currentSheet(wb);
    if (!sheet?.id) return;
    setCircleInvalid(wb, sheet.id, on);
    setCircle(on);
  }

  const two = op === "between" || op === "notBetween";
  const hint = (() => {
    try {
      return describeCriteria({
        id: "",
        type,
        operator: op,
        formula1: value1,
        formula2: value2,
        allowBlank,
        showDropdown: dropdown,
        showInput,
        promptTitle,
        prompt,
        showError,
        errorStyle,
        errorTitle,
        error,
        ranges: [],
      });
    } catch {
      return "";
    }
  })();

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 520, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }} aria-labelledby="dv-title">
        <ModalClose />
        <Typography id="dv-title" level="title-lg">
          Data validation
        </Typography>
        <Stack spacing={1.25} sx={{ mt: 1 }}>
          <Typography level="body-sm" sx={{ opacity: 0.75 }}>
            Applies to: <strong>{sel ? rectToA1(sel) : "no selection"}</strong>
          </Typography>
          <FormControl>
            <FormLabel>Criteria</FormLabel>
            <Select
              value={type}
              onChange={(_, v) => {
                if (!v) return;
                setType(v as DvType);
                setErr(null);
              }}
              slotProps={{ button: { "aria-label": "Validation type" } }}
            >
              {TYPE_LABELS.map(([k, l]) => (
                <Option key={k} value={k}>
                  {l}
                </Option>
              ))}
            </Select>
          </FormControl>

          {HAS_OPERATOR.has(type) && (
            <>
              <Select value={op} onChange={(_, v) => v && setOp(v as DvOperator)} slotProps={{ button: { "aria-label": "Condition operator" } }}>
                {OPS.map(([k, l]) => (
                  <Option key={k} value={k}>
                    {l}
                  </Option>
                ))}
              </Select>
              <Box sx={{ display: "flex", gap: 1.5 }}>
                <Input
                  sx={{ flex: 1 }}
                  value={value1}
                  onChange={(e) => setValue1(e.target.value)}
                  placeholder={type === "date" ? "M/D/YYYY or =formula" : type === "time" ? "H:MM" : "Value or =formula"}
                  slotProps={{ input: { "aria-label": "Condition value" } }}
                />
                {two && (
                  <Input
                    sx={{ flex: 1 }}
                    value={value2}
                    onChange={(e) => setValue2(e.target.value)}
                    placeholder="and"
                    slotProps={{ input: { "aria-label": "Second value" } }}
                  />
                )}
              </Box>
            </>
          )}

          {type === "list" && (
            <>
              <Input
                value={value1}
                onChange={(e) => setValue1(e.target.value)}
                placeholder="Low,Medium,High  or  =$D$1:$D$9"
                slotProps={{ input: { "aria-label": "Dropdown options" } }}
              />
              <Checkbox size="sm" label="Show dropdown in cell" checked={dropdown} onChange={(e) => setDropdown(e.target.checked)} />
            </>
          )}

          {type === "custom" && (
            <Input
              value={value1}
              onChange={(e) => setValue1(e.target.value)}
              placeholder="=COUNTIF($A:$A,A1)=1"
              slotProps={{ input: { "aria-label": "Custom formula" } }}
            />
          )}

          {type === "checkbox" && (
            <Box sx={{ display: "flex", gap: 1.5 }}>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Checked value</FormLabel>
                <Input value={checked} onChange={(e) => setChecked(e.target.value)} slotProps={{ input: { "aria-label": "Checked value" } }} />
              </FormControl>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Unchecked value</FormLabel>
                <Input value={unchecked} onChange={(e) => setUnchecked(e.target.value)} slotProps={{ input: { "aria-label": "Unchecked value" } }} />
              </FormControl>
            </Box>
          )}

          {hint && type !== "any" && (
            <Typography level="body-xs" sx={{ opacity: 0.6 }}>
              {hint}
            </Typography>
          )}
          <Checkbox size="sm" label="Ignore blank cells" checked={allowBlank} onChange={(e) => setAllowBlank(e.target.checked)} />

          <Typography level="title-sm">Input message</Typography>
          <Checkbox size="sm" label="Show a message when the cell is selected" checked={showInput} onChange={(e) => setShowInput(e.target.checked)} />
          {showInput && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <Input size="sm" value={promptTitle} onChange={(e) => setPromptTitle(e.target.value)} placeholder="Title" slotProps={{ input: { "aria-label": "Input title" } }} />
              <Textarea size="sm" minRows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Message" slotProps={{ textarea: { "aria-label": "Input message" } }} />
            </Box>
          )}

          <Typography level="title-sm">Error alert</Typography>
          <Checkbox size="sm" label="Show an alert for invalid data" checked={showError} onChange={(e) => setShowError(e.target.checked)} />
          {showError && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <Select size="sm" value={errorStyle} onChange={(_, v) => v && setErrorStyle(v as DvAlertStyle)} slotProps={{ button: { "aria-label": "Alert style" } }}>
                <Option value="stop">Stop — reject the input</Option>
                <Option value="warning">Warning — ask before accepting</Option>
                <Option value="information">Information — accept and tell</Option>
              </Select>
              <Input size="sm" value={errorTitle} onChange={(e) => setErrorTitle(e.target.value)} placeholder="Title" slotProps={{ input: { "aria-label": "Error title" } }} />
              <Textarea size="sm" minRows={2} value={error} onChange={(e) => setError(e.target.value)} placeholder="Message" slotProps={{ textarea: { "aria-label": "Error message" } }} />
            </Box>
          )}

          <Checkbox size="sm" label="Circle invalid data on this sheet" checked={circle} onChange={(e) => toggleCircle(e.target.checked)} />

          {err && (
            <Typography level="body-sm" color="danger">
              {err}
            </Typography>
          )}
          <Box sx={{ display: "flex", gap: 1, justifyContent: "space-between", mt: 0.5 }}>
            <Button variant="plain" color="danger" onClick={remove}>
              Remove validation
            </Button>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button variant="plain" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={apply}>Apply</Button>
            </Box>
          </Box>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
