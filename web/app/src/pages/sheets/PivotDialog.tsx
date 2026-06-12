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
} from "@mui/joy";
import { PivotTableView } from "./PivotTableView";
import { buildPivot, readHeaders, AGG_LABEL, type Agg, type PivotConfig } from "./pivotData";
import { getSelectionRange, rangeText, type ChartRange } from "./chartData";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

interface PivotDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
  onAdd: (cfg: PivotConfig) => void;
}

export function PivotDialog({ open, onClose, getWb, onAdd }: PivotDialogProps) {
  const [range, setRange] = useState<ChartRange | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowField, setRowField] = useState(0);
  const [colField, setColField] = useState<number | null>(null);
  const [valueField, setValueField] = useState(0);
  const [agg, setAgg] = useState<Agg>("sum");
  const [title, setTitle] = useState("");

  const load = useCallback(() => {
    const wb = getWb();
    if (!wb) return;
    const r = getSelectionRange(wb);
    setRange(r);
    const h = r ? readHeaders(wb, r) : [];
    setHeaders(h);
    setRowField(0);
    setColField(null);
    setValueField(h.length > 1 ? 1 : 0);
    setAgg("sum");
  }, [getWb]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const wb = getWb();
  const cfg: PivotConfig | null = range
    ? { id: "preview", title, range, rowField, colField, valueField, agg }
    : null;
  const result = cfg && wb && headers.length > 0 ? buildPivot(wb, cfg) : null;

  function add() {
    if (!range) return;
    onAdd({
      id: `pivot_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      title: title.trim(),
      range,
      rowField,
      colField,
      valueField,
      agg,
    });
    onClose();
  }

  const fieldOptions = headers.map((h, i) => (
    <Option key={i} value={i}>
      {h}
    </Option>
  ));

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 760, maxWidth: "97vw" }} aria-labelledby="pivot-title">
        <ModalClose />
        <Typography id="pivot-title" level="title-lg">
          Pivot table
        </Typography>

        <Box sx={{ display: "flex", gap: 2, mt: 1, flexWrap: "wrap" }}>
          <Stack spacing={1.25} sx={{ width: 240 }}>
            <Typography level="body-sm" sx={{ opacity: 0.75 }}>
              Source: <strong>{range ? rangeText(range) : "no selection"}</strong>
            </Typography>
            {headers.length === 0 ? (
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                Select a range whose first row has column headers, then reopen.
              </Typography>
            ) : (
              <>
                <FormControl>
                  <FormLabel>Rows (group by)</FormLabel>
                  <Select
                    value={rowField}
                    onChange={(_, v) => v != null && setRowField(v as number)}
                    aria-label="Row field"
                  >
                    {fieldOptions}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Columns (optional)</FormLabel>
                  <Select
                    value={colField ?? -1}
                    onChange={(_, v) => setColField(v === -1 || v == null ? null : (v as number))}
                    aria-label="Column field"
                  >
                    <Option value={-1}>None</Option>
                    {fieldOptions}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Values</FormLabel>
                  <Select
                    value={valueField}
                    onChange={(_, v) => v != null && setValueField(v as number)}
                    aria-label="Value field"
                  >
                    {fieldOptions}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Summarize by</FormLabel>
                  <Select value={agg} onChange={(_, v) => v && setAgg(v as Agg)} aria-label="Aggregation">
                    {(Object.entries(AGG_LABEL) as [Agg, string][]).map(([k, label]) => (
                      <Option key={k} value={k}>
                        {label}
                      </Option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Title</FormLabel>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Optional"
                    slotProps={{ input: { "aria-label": "Pivot title" } }}
                  />
                </FormControl>
              </>
            )}
          </Stack>

          <Box sx={{ flex: 1, minWidth: 320, maxHeight: 420, overflow: "auto" }}>
            {result ? (
              <PivotTableView result={result} />
            ) : (
              <Typography level="body-sm" sx={{ opacity: 0.6, p: 2 }}>
                Configure fields to preview the pivot.
              </Typography>
            )}
          </Box>
        </Box>

        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1.5 }}>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add} disabled={!result}>
            Add pivot table
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
