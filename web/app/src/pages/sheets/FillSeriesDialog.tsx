import { useEffect, useState } from "react";
import {
  Button,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Radio,
  RadioGroup,
  Checkbox,
  Stack,
  Typography,
} from "@mui/joy";
import type { DateUnit, SeriesSettings, SeriesType } from "./autofill";
import type { CellRect } from "./cellRange";
import { applySeries, seriesDefaults } from "./editActions";
import { parseA1Range, rectToA1 } from "./cellValue";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Edit ▸ Fill ▸ Series…: Excel's series dialog (rows/columns, linear, growth,
// date with a unit, autofill, step, stop value, trend) over the selection
// taken when the dialog opened.

const TYPES: [SeriesType, string][] = [
  ["linear", "Linear"],
  ["growth", "Growth"],
  ["date", "Date"],
  ["autofill", "AutoFill"],
];
const UNITS: [DateUnit, string][] = [
  ["day", "Day"],
  ["weekday", "Weekday"],
  ["month", "Month"],
  ["year", "Year"],
];

export function FillSeriesDialog({
  open,
  onClose,
  getWb,
  range,
}: {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
  range: CellRect | null;
}) {
  const [s, setS] = useState<SeriesSettings | null>(null);
  const [step, setStep] = useState("1");
  const [stop, setStop] = useState("");
  const [rangeText, setRangeText] = useState("");

  const loadDefaults = (r: CellRect) => {
    const d = seriesDefaults(getWb(), r);
    setS(d);
    setStep(String(d.step));
    setStop(d.stop == null ? "" : String(d.stop));
  };

  useEffect(() => {
    if (!open || !range) return;
    setRangeText(rectToA1(range));
    loadDefaults(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the dialog opens.
  }, [open, range]);

  const apply = () => {
    const w = getWb();
    const target = (parseA1Range(rangeText) as CellRect | null) ?? range;
    if (!w || !target || !s) return onClose();
    const stepNum = Number(step);
    const stopNum = stop.trim() === "" ? null : Number(stop);
    applySeries(w, target, {
      ...s,
      step: Number.isFinite(stepNum) ? stepNum : 1,
      stop: stopNum != null && Number.isFinite(stopNum) ? stopNum : null,
    });
    onClose();
  };

  const set = (patch: Partial<SeriesSettings>) => setS((cur) => (cur ? { ...cur, ...patch } : cur));

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="series-title" sx={{ width: 460, maxWidth: "95vw" }}>
        <ModalClose />
        <Typography id="series-title" level="title-lg">
          Series
        </Typography>
        <FormControl>
          <FormLabel>Range</FormLabel>
          <Input
            value={rangeText}
            onChange={(e) => setRangeText(e.target.value)}
            onBlur={() => {
              const r = parseA1Range(rangeText) as CellRect | null;
              if (r) loadDefaults(r);
            }}
            slotProps={{ input: { "aria-label": "Series range" } }}
          />
        </FormControl>
        {s && (
          <>
            <Stack direction="row" spacing={3}>
              <FormControl>
                <FormLabel>Series in</FormLabel>
                <RadioGroup
                  value={s.seriesIn}
                  onChange={(e) => set({ seriesIn: e.target.value as SeriesSettings["seriesIn"] })}
                >
                  <Radio value="rows" label="Rows" />
                  <Radio value="columns" label="Columns" />
                </RadioGroup>
              </FormControl>
              <FormControl>
                <FormLabel>Type</FormLabel>
                <RadioGroup value={s.type} onChange={(e) => set({ type: e.target.value as SeriesType })}>
                  {TYPES.map(([v, l]) => (
                    <Radio key={v} value={v} label={l} />
                  ))}
                </RadioGroup>
              </FormControl>
              <FormControl disabled={s.type !== "date"}>
                <FormLabel>Date unit</FormLabel>
                <RadioGroup value={s.dateUnit} onChange={(e) => set({ dateUnit: e.target.value as DateUnit })}>
                  {UNITS.map(([v, l]) => (
                    <Radio key={v} value={v} label={l} disabled={s.type !== "date"} />
                  ))}
                </RadioGroup>
              </FormControl>
            </Stack>
            <Checkbox
              label="Trend"
              checked={s.trend}
              disabled={s.type !== "linear" && s.type !== "growth"}
              onChange={(e) => set({ trend: e.target.checked })}
            />
            <Stack direction="row" spacing={2}>
              <FormControl sx={{ flex: 1 }} disabled={s.trend}>
                <FormLabel>Step value</FormLabel>
                <Input value={step} onChange={(e) => setStep(e.target.value)} slotProps={{ input: { "aria-label": "Step value" } }} />
              </FormControl>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Stop value</FormLabel>
                <Input value={stop} onChange={(e) => setStop(e.target.value)} slotProps={{ input: { "aria-label": "Stop value" } }} />
              </FormControl>
            </Stack>
          </>
        )}
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply}>OK</Button>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
