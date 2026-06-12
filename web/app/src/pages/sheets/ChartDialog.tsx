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
import { ChartRenderer, type ChartType } from "./ChartRenderer";
import {
  buildChartInput,
  getSelectionRange,
  rangeText,
  type ChartConfig,
  type ChartRange,
} from "./chartData";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

const TYPE_LABELS: Record<ChartType, string> = {
  column: "Column",
  bar: "Bar",
  line: "Line",
  area: "Area",
  pie: "Pie",
};

interface ChartDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
  onAdd: (cfg: ChartConfig) => void;
}

export function ChartDialog({ open, onClose, getWb, onAdd }: ChartDialogProps) {
  const [range, setRange] = useState<ChartRange | null>(null);
  const [type, setType] = useState<ChartType>("column");
  const [title, setTitle] = useState("");
  const [headerRow, setHeaderRow] = useState(true);
  const [labelCol, setLabelCol] = useState(true);

  const load = useCallback(() => {
    const wb = getWb();
    if (!wb) return;
    setRange(getSelectionRange(wb));
  }, [getWb]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const wb = getWb();
  const cfg: ChartConfig | null = range
    ? { id: "preview", type, title, range, headerRow, labelCol }
    : null;
  const input = cfg && wb ? buildChartInput(wb, cfg) : null;
  const hasData =
    !!input && input.series.length > 0 && input.series.some((s) => s.values.some((v) => isFinite(v)));

  function add() {
    if (!range) return;
    onAdd({
      id: `chart_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      type,
      title: title.trim(),
      range,
      headerRow,
      labelCol,
    });
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 640, maxWidth: "96vw" }} aria-labelledby="chart-title">
        <ModalClose />
        <Typography id="chart-title" level="title-lg">
          Insert chart
        </Typography>

        <Box sx={{ display: "flex", gap: 2, mt: 1, flexWrap: "wrap" }}>
          <Stack spacing={1.5} sx={{ width: 220 }}>
            <Typography level="body-sm" sx={{ opacity: 0.75 }}>
              Data range: <strong>{range ? rangeText(range) : "no selection"}</strong>
            </Typography>
            <FormControl>
              <FormLabel>Chart type</FormLabel>
              <Select value={type} onChange={(_, v) => v && setType(v as ChartType)} aria-label="Chart type">
                {(Object.entries(TYPE_LABELS) as [ChartType, string][]).map(([k, label]) => (
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
                placeholder="Chart title (optional)"
                slotProps={{ input: { "aria-label": "Chart title" } }}
              />
            </FormControl>
            <Checkbox
              size="sm"
              label="First row is headers"
              checked={headerRow}
              onChange={(e) => setHeaderRow(e.target.checked)}
            />
            <Checkbox
              size="sm"
              label="First column is labels"
              checked={labelCol}
              onChange={(e) => setLabelCol(e.target.checked)}
            />
          </Stack>

          <Box
            sx={{
              flex: 1,
              minWidth: 300,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: "sm",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "#fff",
              minHeight: 300,
            }}
          >
            {hasData && input ? (
              <ChartRenderer
                type={type}
                title={title || undefined}
                categories={input.categories}
                series={input.series}
              />
            ) : (
              <Typography level="body-sm" sx={{ opacity: 0.6, p: 2, textAlign: "center" }}>
                Select a range of cells with numbers, then reopen this dialog.
              </Typography>
            )}
          </Box>
        </Box>

        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1.5 }}>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add} disabled={!hasData}>
            Add chart
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
