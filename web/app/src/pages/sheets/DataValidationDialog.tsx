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
  Checkbox,
} from "@mui/joy";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// FortuneSheet stores data validation per cell on the sheet's `dataVerification`
// map, keyed "row_col" (e.g. "0_1"). Each entry is a DataRegulationProps:
//   { type, type2, rangeTxt, value1, value2, validity, remote, prohibitInput,
//     hintShow, hintValue }
// type:  dropdown | checkbox | number_decimal | text_length | text_content | date
// type2: the operator (between, notBetween, equal, notEqualTo, moreThanThe,
//        lessThan, greaterOrEqualTo, lessThanOrEqualTo, earlierThan, laterThan…)

type DvType =
  | "dropdown"
  | "checkbox"
  | "number_decimal"
  | "text_length"
  | "text_content"
  | "date";

const TYPE_LABELS: Record<DvType, string> = {
  dropdown: "Dropdown list",
  checkbox: "Checkbox",
  number_decimal: "Number",
  text_length: "Text length",
  text_content: "Text contains",
  date: "Date",
};

// Operator sets per validation family (type2 values must match FortuneSheet's).
const NUMERIC_OPS = [
  "between",
  "notBetween",
  "equal",
  "notEqualTo",
  "moreThanThe",
  "lessThan",
  "greaterOrEqualTo",
  "lessThanOrEqualTo",
] as const;
const DATE_OPS = [
  "between",
  "notBetween",
  "equal",
  "notEqualTo",
  "earlierThan",
  "noEarlierThan",
  "laterThan",
  "noLaterThan",
] as const;
const TEXT_OPS = ["include", "exclude", "equal", "notEqualTo"] as const;

const OP_LABELS: Record<string, string> = {
  between: "Between",
  notBetween: "Not between",
  equal: "Equal to",
  notEqualTo: "Not equal to",
  moreThanThe: "Greater than",
  lessThan: "Less than",
  greaterOrEqualTo: "Greater than or equal to",
  lessThanOrEqualTo: "Less than or equal to",
  earlierThan: "Before",
  noEarlierThan: "On or after",
  laterThan: "After",
  noLaterThan: "On or before",
  include: "Contains",
  exclude: "Does not contain",
};

function opsFor(type: DvType): readonly string[] {
  if (type === "number_decimal" || type === "text_length") return NUMERIC_OPS;
  if (type === "date") return DATE_OPS;
  if (type === "text_content") return TEXT_OPS;
  return [];
}

function needsValue2(op: string): boolean {
  return op === "between" || op === "notBetween";
}

// colName converts a 0-based column index to A1 letters.
function colName(c: number): string {
  let s = "";
  c += 1;
  while (c > 0) {
    c -= 1;
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26);
  }
  return s;
}

interface SelRange {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

function getSelection(wb: any): SelRange | null {
  try {
    const selArr = wb?.getSelection?.();
    const sel = Array.isArray(selArr) ? selArr[0] : selArr;
    if (sel && sel.row && sel.column) {
      return {
        r0: Math.min(sel.row[0], sel.row[1]),
        r1: Math.max(sel.row[0], sel.row[1]),
        c0: Math.min(sel.column[0], sel.column[1]),
        c1: Math.max(sel.column[0], sel.column[1]),
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function rangeTxt(s: SelRange): string {
  return `${colName(s.c0)}${s.r0 + 1}:${colName(s.c1)}${s.r1 + 1}`;
}

interface DataValidationDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
}

export function DataValidationDialog({
  open,
  onClose,
  getWb,
}: DataValidationDialogProps) {
  const [sel, setSel] = useState<SelRange | null>(null);
  const [type, setType] = useState<DvType>("dropdown");
  const [op, setOp] = useState<string>("between");
  const [value1, setValue1] = useState("");
  const [value2, setValue2] = useState("");
  const [reject, setReject] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    const wb = getWb();
    if (!wb) return;
    const s = getSelection(wb);
    setSel(s);
    setErr(null);
    // Pre-fill from the top-left cell's existing rule, if any.
    try {
      const curId = wb.getSheet?.()?.id;
      const all: any[] = wb.getAllSheets?.() ?? [];
      const sheet = all.find((x: any) => x.id === curId);
      const dv = sheet?.dataVerification;
      if (s && dv) {
        const rule = dv[`${s.r0}_${s.c0}`];
        if (rule) {
          setType((rule.type as DvType) ?? "dropdown");
          setOp(rule.type2 || "between");
          setValue1(rule.value1 ?? "");
          setValue2(rule.value2 ?? "");
          setReject(rule.prohibitInput !== false);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    setType("dropdown");
    setOp("between");
    setValue1("");
    setValue2("");
    setReject(true);
  }, [getWb]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Rewrite the current sheet's dataVerification map via the FortuneSheet API.
  function mutateDV(fn: (dv: Record<string, any>) => void) {
    const wb = getWb();
    if (!wb) return;
    try {
      const all: any[] = wb.getAllSheets?.() ?? [];
      const curId = wb.getSheet?.()?.id;
      const updated = all.map((s: any) => {
        if (s.id !== curId) return s;
        const dv: Record<string, any> = { ...(s.dataVerification ?? {}) };
        fn(dv);
        return { ...s, dataVerification: dv };
      });
      wb.updateSheet?.(updated);
    } catch {
      /* ignore */
    }
  }

  function apply() {
    if (!sel) {
      setErr("Select a range of cells first.");
      return;
    }
    const ops = opsFor(type);
    if (type === "dropdown" && !value1.trim()) {
      setErr("Enter at least one dropdown option.");
      return;
    }
    if (ops.length > 0 && !value1.trim()) {
      setErr("Enter a value for the condition.");
      return;
    }
    if (ops.length > 0 && needsValue2(op) && !value2.trim()) {
      setErr("Enter both values for a 'between' condition.");
      return;
    }
    const rule = {
      type,
      type2: ops.length > 0 ? op : "",
      rangeTxt: rangeTxt(sel),
      value1:
        type === "checkbox" ? value1.trim() || "true" : value1.trim(),
      value2:
        type === "checkbox"
          ? value2.trim() || "false"
          : needsValue2(op)
            ? value2.trim()
            : "",
      validity: "",
      remote: false,
      prohibitInput: reject,
      hintShow: false,
      hintValue: "",
    };
    mutateDV((dv) => {
      for (let r = sel.r0; r <= sel.r1; r++) {
        for (let c = sel.c0; c <= sel.c1; c++) {
          dv[`${r}_${c}`] = { ...rule };
        }
      }
    });
    onClose();
  }

  function remove() {
    if (!sel) {
      onClose();
      return;
    }
    mutateDV((dv) => {
      for (let r = sel.r0; r <= sel.r1; r++) {
        for (let c = sel.c0; c <= sel.c1; c++) {
          delete dv[`${r}_${c}`];
        }
      }
    });
    onClose();
  }

  const ops = opsFor(type);

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 460, maxWidth: "95vw" }} aria-labelledby="dv-title">
        <ModalClose />
        <Typography id="dv-title" level="title-lg">
          Data validation
        </Typography>

        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <Typography level="body-sm" sx={{ opacity: 0.75 }}>
            Applies to:{" "}
            <strong>{sel ? rangeTxt(sel) : "no selection"}</strong>
          </Typography>

          <FormControl>
            <FormLabel>Criteria</FormLabel>
            <Select
              value={type}
              onChange={(_, v) => {
                if (!v) return;
                setType(v as DvType);
                const next = opsFor(v as DvType);
                if (next.length > 0) setOp(next[0]);
                setErr(null);
              }}
              aria-label="Validation type"
            >
              {(Object.entries(TYPE_LABELS) as [DvType, string][]).map(
                ([k, label]) => (
                  <Option key={k} value={k}>
                    {label}
                  </Option>
                ),
              )}
            </Select>
          </FormControl>

          {ops.length > 0 && (
            <FormControl>
              <FormLabel>Condition</FormLabel>
              <Select
                value={op}
                onChange={(_, v) => v && setOp(v)}
                aria-label="Condition operator"
              >
                {ops.map((o) => (
                  <Option key={o} value={o}>
                    {OP_LABELS[o] ?? o}
                  </Option>
                ))}
              </Select>
            </FormControl>
          )}

          {type === "dropdown" && (
            <FormControl>
              <FormLabel>Options</FormLabel>
              <Input
                value={value1}
                onChange={(e) => setValue1(e.target.value)}
                placeholder="Comma-separated, e.g. Low,Medium,High"
                slotProps={{ input: { "aria-label": "Dropdown options" } }}
              />
            </FormControl>
          )}

          {type === "checkbox" && (
            <Box sx={{ display: "flex", gap: 1.5 }}>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Checked value</FormLabel>
                <Input
                  value={value1}
                  onChange={(e) => setValue1(e.target.value)}
                  placeholder="true"
                  slotProps={{ input: { "aria-label": "Checked value" } }}
                />
              </FormControl>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Unchecked value</FormLabel>
                <Input
                  value={value2}
                  onChange={(e) => setValue2(e.target.value)}
                  placeholder="false"
                  slotProps={{ input: { "aria-label": "Unchecked value" } }}
                />
              </FormControl>
            </Box>
          )}

          {ops.length > 0 && (
            <Box sx={{ display: "flex", gap: 1.5 }}>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>{needsValue2(op) ? "Value 1" : "Value"}</FormLabel>
                <Input
                  value={value1}
                  onChange={(e) => setValue1(e.target.value)}
                  placeholder={type === "date" ? "YYYY-MM-DD" : "e.g. 10"}
                  slotProps={{ input: { "aria-label": "Condition value" } }}
                />
              </FormControl>
              {needsValue2(op) && (
                <FormControl sx={{ flex: 1 }}>
                  <FormLabel>Value 2</FormLabel>
                  <Input
                    value={value2}
                    onChange={(e) => setValue2(e.target.value)}
                    placeholder={type === "date" ? "YYYY-MM-DD" : "e.g. 100"}
                    slotProps={{ input: { "aria-label": "Second value" } }}
                  />
                </FormControl>
              )}
            </Box>
          )}

          {type !== "checkbox" && (
            <Checkbox
              size="sm"
              label="Reject invalid input"
              checked={reject}
              onChange={(e) => setReject(e.target.checked)}
            />
          )}

          {err && (
            <Typography level="body-sm" color="danger">
              {err}
            </Typography>
          )}

          <Box
            sx={{
              display: "flex",
              gap: 1,
              justifyContent: "space-between",
              mt: 0.5,
            }}
          >
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
