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
  IconButton,
} from "@mui/joy";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// FortuneSheet luckysheet_conditionformat_save rule shape:
// {
//   type: "default",
//   cellrange: Array<{ row: [r0, r1]; column: [c0, c1] }>,
//   format: { textColor: string | null; cellColor: string | null },
//   conditionName: "greaterThan" | "lessThan" | "equal" | "textContains" | "between",
//   conditionRange: [],
//   conditionValue: [value] | [v0, v1]
// }

type ConditionName =
  | "greaterThan"
  | "lessThan"
  | "equal"
  | "textContains"
  | "between";

interface CfRule {
  type: "default";
  cellrange: Array<{ row: [number, number]; column: [number, number] }>;
  format: { textColor: string | null; cellColor: string | null };
  conditionName: ConditionName;
  conditionRange: never[];
  conditionValue: [string] | [string, string];
}

interface ConditionalFormatDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
}

const CONDITION_LABELS: Record<ConditionName, string> = {
  greaterThan: "Greater than",
  lessThan: "Less than",
  equal: "Equal to",
  textContains: "Text contains",
  between: "Between",
};

function ruleLabel(rule: CfRule): string {
  const cond = CONDITION_LABELS[rule.conditionName] ?? rule.conditionName;
  const vals = rule.conditionValue.join(" and ");
  const fmts: string[] = [];
  if (rule.format.cellColor) fmts.push(`bg ${rule.format.cellColor}`);
  if (rule.format.textColor) fmts.push(`text ${rule.format.textColor}`);
  return `${cond} ${vals} → ${fmts.join(", ") || "no style"}`;
}

/** Parse the current selection into a cellrange array, falling back to A1:Z100. */
function selectionToCellrange(
  wb: any,
): Array<{ row: [number, number]; column: [number, number] }> {
  try {
    const selArr = wb?.getSelection?.();
    const sel = Array.isArray(selArr) ? selArr[0] : selArr;
    if (sel)
      return [
        {
          row: [sel.row[0], sel.row[1]],
          column: [sel.column[0], sel.column[1]],
        },
      ];
  } catch {
    /* ignore */
  }
  return [{ row: [0, 99], column: [0, 25] }];
}

const emptyRule = (): Partial<CfRule> => ({
  conditionName: "greaterThan",
  conditionValue: [""],
  format: { textColor: null, cellColor: null },
});

export function ConditionalFormatDialog({
  open,
  onClose,
  getWb,
}: ConditionalFormatDialogProps) {
  const [rules, setRules] = useState<CfRule[]>([]);
  const [editing, setEditing] = useState<Partial<CfRule> | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null); // null = new rule

  // Load existing rules from the current sheet when dialog opens.
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
    const next = rules.filter((_, i) => i !== idx);
    saveRules(next);
  }

  function startEdit(idx: number | null) {
    if (idx === null) {
      setEditing(emptyRule());
    } else {
      setEditing({ ...rules[idx] });
    }
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
    const v0 = (editing.conditionValue?.[0] ?? "").toString();
    const v1 =
      editing.conditionName === "between"
        ? (editing.conditionValue?.[1] ?? "").toString()
        : undefined;
    const rule: CfRule = {
      type: "default",
      cellrange,
      format: {
        textColor: editing.format?.textColor ?? null,
        cellColor: editing.format?.cellColor ?? null,
      },
      conditionName: editing.conditionName ?? "greaterThan",
      conditionRange: [],
      conditionValue: v1 != null ? [v0, v1] : [v0],
    };
    const next =
      editIdx !== null
        ? rules.map((r, i) => (i === editIdx ? rule : r))
        : [...rules, rule];
    saveRules(next as CfRule[]);
    setEditing(null);
    setEditIdx(null);
  }

  const condName = editing?.conditionName ?? "greaterThan";
  const isBetween = condName === "between";

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{ width: 500, maxWidth: "95vw" }}
        aria-labelledby="cf-title"
      >
        <ModalClose />
        <Typography id="cf-title" level="title-lg">
          Conditional formatting
        </Typography>

        {/* Rule list */}
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
                {r.format.cellColor && (
                  <Box
                    sx={{
                      width: 16,
                      height: 16,
                      borderRadius: "2px",
                      bgcolor: r.format.cellColor,
                      border: "1px solid",
                      borderColor: "divider",
                      flexShrink: 0,
                    }}
                  />
                )}
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
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={() => startEdit(i)}
                  aria-label="Edit rule"
                >
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
            <Box
              sx={{
                display: "flex",
                gap: 1,
                justifyContent: "space-between",
                mt: 1,
              }}
            >
              <Button variant="outlined" onClick={() => startEdit(null)}>
                Add rule
              </Button>
              <Button variant="plain" onClick={onClose}>
                Done
              </Button>
            </Box>
          </Stack>
        )}

        {/* Edit / New rule form */}
        {editing && (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <Typography level="title-sm">
              {editIdx === null ? "New rule" : "Edit rule"}
            </Typography>
            <FormControl>
              <FormLabel>Condition</FormLabel>
              <Select
                value={condName}
                onChange={(_, v) =>
                  v &&
                  setEditing((e) => ({
                    ...e,
                    conditionName: v as ConditionName,
                  }))
                }
                aria-label="Condition type"
              >
                {(
                  Object.entries(CONDITION_LABELS) as [ConditionName, string][]
                ).map(([k, label]) => (
                  <Option key={k} value={k}>
                    {label}
                  </Option>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel>{isBetween ? "Minimum value" : "Value"}</FormLabel>
              <Input
                value={editing.conditionValue?.[0] ?? ""}
                onChange={(e) =>
                  setEditing((prev) => {
                    const cv = [...(prev?.conditionValue ?? [""])];
                    cv[0] = e.target.value;
                    return {
                      ...prev,
                      conditionValue: cv as [string] | [string, string],
                    };
                  })
                }
                placeholder={
                  condName === "textContains" ? "Text to match" : "Enter value"
                }
                slotProps={{ input: { "aria-label": "Condition value" } }}
              />
            </FormControl>
            {isBetween && (
              <FormControl>
                <FormLabel>Maximum value</FormLabel>
                <Input
                  value={(editing.conditionValue as any)?.[1] ?? ""}
                  onChange={(e) =>
                    setEditing((prev) => {
                      const cv = [...(prev?.conditionValue ?? ["", ""])];
                      cv[1] = e.target.value;
                      return {
                        ...prev,
                        conditionValue: cv as [string, string],
                      };
                    })
                  }
                  placeholder="Enter value"
                  slotProps={{
                    input: { "aria-label": "Second condition value" },
                  }}
                />
              </FormControl>
            )}
            <Divider />
            <Typography level="title-sm">Formatting</Typography>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
              <FormControl sx={{ flex: 1, minWidth: 140 }}>
                <FormLabel>Background color</FormLabel>
                <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                  <input
                    type="color"
                    value={editing.format?.cellColor ?? "#ffffff"}
                    onChange={(e) =>
                      setEditing((prev) => ({
                        ...prev,
                        format: {
                          ...(prev?.format ?? {
                            textColor: null,
                            cellColor: null,
                          }),
                          cellColor: e.target.value,
                        },
                      }))
                    }
                    style={{
                      width: 40,
                      height: 32,
                      padding: 2,
                      border: "1px solid #ccc",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                    aria-label="Background color"
                  />
                  {editing.format?.cellColor && (
                    <Chip
                      size="sm"
                      variant="soft"
                      endDecorator={
                        <span
                          style={{ cursor: "pointer" }}
                          onClick={() =>
                            setEditing((prev) => ({
                              ...prev,
                              format: {
                                ...(prev?.format ?? {
                                  textColor: null,
                                  cellColor: null,
                                }),
                                cellColor: null,
                              },
                            }))
                          }
                        >
                          ×
                        </span>
                      }
                    >
                      {editing.format.cellColor}
                    </Chip>
                  )}
                  {!editing.format?.cellColor && (
                    <Typography level="body-xs" sx={{ opacity: 0.5 }}>
                      None
                    </Typography>
                  )}
                </Box>
              </FormControl>
              <FormControl sx={{ flex: 1, minWidth: 140 }}>
                <FormLabel>Text color</FormLabel>
                <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                  <input
                    type="color"
                    value={editing.format?.textColor ?? "#000000"}
                    onChange={(e) =>
                      setEditing((prev) => ({
                        ...prev,
                        format: {
                          ...(prev?.format ?? {
                            textColor: null,
                            cellColor: null,
                          }),
                          textColor: e.target.value,
                        },
                      }))
                    }
                    style={{
                      width: 40,
                      height: 32,
                      padding: 2,
                      border: "1px solid #ccc",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                    aria-label="Text color"
                  />
                  {editing.format?.textColor && (
                    <Chip
                      size="sm"
                      variant="soft"
                      endDecorator={
                        <span
                          style={{ cursor: "pointer" }}
                          onClick={() =>
                            setEditing((prev) => ({
                              ...prev,
                              format: {
                                ...(prev?.format ?? {
                                  textColor: null,
                                  cellColor: null,
                                }),
                                textColor: null,
                              },
                            }))
                          }
                        >
                          ×
                        </span>
                      }
                    >
                      {editing.format.textColor}
                    </Chip>
                  )}
                  {!editing.format?.textColor && (
                    <Typography level="body-xs" sx={{ opacity: 0.5 }}>
                      None
                    </Typography>
                  )}
                </Box>
              </FormControl>
            </Box>
            <Box
              sx={{
                display: "flex",
                gap: 1,
                justifyContent: "flex-end",
                mt: 0.5,
              }}
            >
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
