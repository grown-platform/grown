import { useState, useCallback, useEffect } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  FormControl,
  FormLabel,
  Input,
  Button,
  Box,
  Stack,
  IconButton,
} from "@mui/joy";
import DeleteIcon from "@mui/icons-material/Delete";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Named ranges are stored in a custom field `named_ranges` on the *workbook* level
// (the first sheet's config serves as the workbook-level store, following the pattern
// for workbook-wide config). The field lives on the sheet data array under index 0.
// Format: { [name: string]: { range: string; sheetId: string } }
//
// We store them in a top-level property `namedRanges` (an array) on each individual
// sheet where they are defined. To keep it simple and avoid cross-sheet complexity
// we store all named ranges in a workbook-level `_namedRanges` array in the FIRST
// sheet of getAllSheets(). This survives save/reload because onChange saves the full
// workbook JSON and the field passes through as-is.

export interface NamedRange {
  name: string;
  range: string; // "A1:B3" notation
  sheetId: string;
  sheetName: string;
}

/** Read named ranges from the workbook's metadata sheet (index 0). */
function loadNamedRanges(wb: any): NamedRange[] {
  try {
    const all: any[] = wb?.getAllSheets?.() ?? [];
    if (all.length === 0) return [];
    const meta = all[0];
    return Array.isArray(meta?._namedRanges) ? meta._namedRanges : [];
  } catch {
    return [];
  }
}

/** Persist named ranges back to the workbook via updateSheet. */
function saveNamedRanges(wb: any, namedRanges: NamedRange[]) {
  const all: any[] = wb?.getAllSheets?.() ?? [];
  if (all.length === 0) return;
  const updated = all.map((s: any, i: number) =>
    i === 0 ? { ...s, _namedRanges: namedRanges } : s,
  );
  wb?.updateSheet?.(updated);
}

/** Convert a selection object to a range string like "A1:C5". */
function selToRangeStr(sel: any, sheetName: string): string {
  if (!sel) return "A1";
  const r0 = sel.row?.[0] ?? 0;
  const r1 = sel.row?.[1] ?? r0;
  const c0 = sel.column?.[0] ?? 0;
  const c1 = sel.column?.[1] ?? c0;
  return `${sheetName}!${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`;
}

function colName(c: number): string {
  let s = "";
  let n = c;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Very lightweight named-range validation: non-empty, alphanumeric+underscore, starts with letter. */
function validateName(name: string): string | null {
  if (!name.trim()) return "Name is required.";
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name.trim()))
    return "Name must start with a letter and contain only letters, digits, or underscores.";
  return null;
}

interface NamedRangesDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
}

export function NamedRangesDialog({
  open,
  onClose,
  getWb,
}: NamedRangesDialogProps) {
  const [ranges, setRanges] = useState<NamedRange[]>([]);
  const [newName, setNewName] = useState("");
  const [newRange, setNewRange] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const wb = getWb();
    if (!wb) return;
    setRanges(loadNamedRanges(wb));
    // Pre-fill range from current selection.
    try {
      const selArr = wb?.getSelection?.();
      const sel = Array.isArray(selArr) ? selArr[0] : selArr;
      const sheet = wb?.getSheet?.();
      const sheetName = sheet?.name ?? "Sheet1";
      setNewRange(selToRangeStr(sel, sheetName));
    } catch {
      setNewRange("");
    }
    setNewName("");
    setError(null);
  }, [getWb]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  function addRange() {
    const wb = getWb();
    if (!wb) return;
    const nameErr = validateName(newName);
    if (nameErr) {
      setError(nameErr);
      return;
    }
    if (!newRange.trim()) {
      setError("Range is required.");
      return;
    }
    const trimmed = newName.trim();
    if (ranges.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(`Name "${trimmed}" already exists.`);
      return;
    }
    const sheet = wb?.getSheet?.();
    const nr: NamedRange = {
      name: trimmed,
      range: newRange.trim(),
      sheetId: sheet?.id ?? "",
      sheetName: sheet?.name ?? "",
    };
    const next = [...ranges, nr];
    saveNamedRanges(wb, next);
    setRanges(next);
    setNewName("");
    setError(null);
    // Keep range box pre-filled for convenience (matches Google Sheets UX).
  }

  function deleteRange(idx: number) {
    const wb = getWb();
    if (!wb) return;
    const next = ranges.filter((_, i) => i !== idx);
    saveNamedRanges(wb, next);
    setRanges(next);
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{ width: 480, maxWidth: "95vw" }}
        aria-labelledby="nr-title"
      >
        <ModalClose />
        <Typography id="nr-title" level="title-lg">
          Named ranges
        </Typography>

        <Stack spacing={1} sx={{ mt: 1 }}>
          {/* Existing named ranges */}
          {ranges.length === 0 && (
            <Typography level="body-sm" sx={{ opacity: 0.6 }}>
              No named ranges defined.
            </Typography>
          )}
          {ranges.map((r, i) => (
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
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography level="body-sm" fontWeight="md">
                  {r.name}
                </Typography>
                <Typography level="body-xs" sx={{ opacity: 0.65 }}>
                  {r.range}
                </Typography>
              </Box>
              <IconButton
                size="sm"
                variant="plain"
                color="danger"
                onClick={() => deleteRange(i)}
                aria-label="Delete named range"
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}

          {/* Add new range */}
          <Box sx={{ pt: 1 }}>
            <Typography level="title-sm" sx={{ mb: 1 }}>
              Add named range
            </Typography>
            <Stack spacing={1}>
              <FormControl error={!!error}>
                <FormLabel>Name</FormLabel>
                <Input
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. TaxRate"
                  slotProps={{ input: { "aria-label": "Named range name" } }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addRange();
                  }}
                />
              </FormControl>
              <FormControl>
                <FormLabel>Range</FormLabel>
                <Input
                  value={newRange}
                  onChange={(e) => setNewRange(e.target.value)}
                  placeholder="e.g. Sheet1!A1:B3"
                  slotProps={{ input: { "aria-label": "Named range value" } }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addRange();
                  }}
                />
              </FormControl>
              {error && (
                <Typography level="body-sm" color="danger">
                  {error}
                </Typography>
              )}
              <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
                <Button variant="plain" onClick={onClose}>
                  Done
                </Button>
                <Button
                  onClick={addRange}
                  disabled={!newName.trim() || !newRange.trim()}
                >
                  Add
                </Button>
              </Box>
            </Stack>
          </Box>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
