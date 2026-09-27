import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  Input,
  List,
  ListItem,
  ListItemButton,
  Modal,
  ModalClose,
  ModalDialog,
  Stack,
  Typography,
} from "@mui/joy";
import { formatRuns, formatValue } from "./numberFormat";
import { CUSTOM_FORMAT_SUGGESTIONS, applyNumberFormat, currentFormat } from "./numberFormatActions";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Format ▸ Number ▸ Custom number format: type a format code (or pick one),
// see it applied to the selected cell and a few sample values, then apply it
// to the selection.

const SAMPLES: (number | string)[] = [1234.5678, -1234.5678, 0, 0.25, 45293.75, "text"];

function preview(value: unknown, code: string): { text: string; color?: string } {
  if (value == null || value === "") return { text: "" };
  try {
    const v = typeof value === "number" || typeof value === "string" || typeof value === "boolean" ? value : String(value);
    const r = formatRuns(v, code);
    return { text: formatValue(v, code), color: r.color };
  } catch {
    return { text: "" };
  }
}

const COLOR_CSS: Record<string, string> = {
  red: "#c62828",
  blue: "#1565c0",
  green: "#2e7d32",
  magenta: "#ad1457",
  cyan: "#00838f",
  yellow: "#f9a825",
  black: "inherit",
  white: "#9e9e9e",
};

export function NumberFormatDialog({
  open,
  onClose,
  getWb,
  ranges,
}: {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
  /** The selection when the dialog was opened (the grid may lose it meanwhile). */
  ranges: any[];
}) {
  const [code, setCode] = useState("General");
  const [cellValue, setCellValue] = useState<unknown>(undefined);

  useEffect(() => {
    if (!open) return;
    const { fa, value } = currentFormat(getWb(), ranges.length ? ranges : undefined);
    setCode(fa || "General");
    setCellValue(value);
  }, [open, getWb, ranges]);

  const rows = useMemo(() => {
    const vals: unknown[] = cellValue != null && cellValue !== "" ? [cellValue, ...SAMPLES] : SAMPLES;
    return vals.map((v, i) => ({ key: i, value: v, ...preview(v, code || "General") }));
  }, [code, cellValue]);

  const apply = () => {
    const w = getWb();
    if (w) applyNumberFormat(w, code.trim() || "General", ranges.length ? ranges : undefined);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="numfmt-title" sx={{ width: 560, maxWidth: "95vw" }}>
        <ModalClose />
        <Typography id="numfmt-title" level="title-lg">
          Custom number format
        </Typography>
        <FormControl>
          <FormLabel>Format code</FormLabel>
          <Input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
            slotProps={{ input: { "aria-label": "Format code", spellCheck: false } }}
            sx={{ fontFamily: "monospace" }}
          />
          <FormHelperText>
            Sections: positive;negative;zero;text. 0 # ? digits, , thousands, % percent, E+ scientific, y m d h s
            dates and times, [h] elapsed, [Red] colour, [&gt;100] condition, "text" literal.
          </FormHelperText>
        </FormControl>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ minHeight: 0 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography level="title-sm" sx={{ mb: 0.5 }}>
              Preview
            </Typography>
            <Box
              component="table"
              aria-label="Format preview"
              sx={{ width: "100%", borderCollapse: "collapse", fontSize: "sm", "& td": { py: 0.25, px: 0.5 } }}
            >
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <Box component="td" sx={{ color: "text.tertiary", whiteSpace: "nowrap" }}>
                      {String(r.value)}
                    </Box>
                    <Box
                      component="td"
                      data-testid="numfmt-preview"
                      sx={{
                        textAlign: typeof r.value === "number" ? "right" : "left",
                        fontFamily: "monospace",
                        whiteSpace: "pre",
                        color: r.color ? COLOR_CSS[r.color.toLowerCase()] ?? "inherit" : "inherit",
                      }}
                    >
                      {r.text}
                    </Box>
                  </tr>
                ))}
              </tbody>
            </Box>
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography level="title-sm" sx={{ mb: 0.5 }}>
              Formats
            </Typography>
            <List size="sm" sx={{ maxHeight: 220, overflow: "auto", "--List-padding": "0px" }}>
              {CUSTOM_FORMAT_SUGGESTIONS.map((s) => (
                <ListItem key={s}>
                  <ListItemButton selected={s === code} onClick={() => setCode(s)} sx={{ fontFamily: "monospace", fontSize: "xs" }}>
                    {s}
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply}>Apply</Button>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
