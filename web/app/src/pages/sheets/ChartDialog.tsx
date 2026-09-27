import { useEffect, useMemo, useState } from "react";
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
  Tabs,
  TabList,
  Tab,
  TabPanel,
  ToggleButtonGroup,
  Divider,
} from "@mui/joy";
import { ChartRenderer, chartTypeLabel } from "./ChartRenderer";
import {
  buildChartInput,
  defaultAnchor,
  getSelectionRange,
  parseRangeText,
  rangeText,
  seriesColor,
  type AxisConfig,
  type ChartConfig,
  type ChartRange,
  type ChartType,
  type LegendPosition,
  type SeriesConfig,
  type Stacking,
} from "./chartData";
import type { TrendType } from "./trendlines";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

const TYPES: ChartType[] = ["column", "bar", "line", "area", "combo", "scatter", "pie", "doughnut", "histogram", "waterfall"];
const STACKABLE = new Set<ChartType>(["column", "bar", "line", "area"]);
const TREND_TYPES: [TrendType | "", string][] = [
  ["", "None"],
  ["linear", "Linear"],
  ["exp", "Exponential"],
  ["log", "Logarithmic"],
  ["poly", "Polynomial"],
  ["power", "Power"],
  ["movingAvg", "Moving average"],
];

interface ChartDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
  /** Chart being edited; null/undefined inserts a new one from the selection. */
  initial?: ChartConfig | null;
  onSave: (cfg: ChartConfig) => void;
}

function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function AxisFields({ label, value, onChange, showLog }: { label: string; value: AxisConfig | undefined; onChange: (a: AxisConfig) => void; showLog?: boolean }) {
  const a = value ?? {};
  const set = (patch: Partial<AxisConfig>) => onChange({ ...a, ...patch });
  return (
    <Stack spacing={1}>
      <Typography level="title-sm">{label}</Typography>
      <Input size="sm" placeholder="Axis title" value={a.title ?? ""} onChange={(e) => set({ title: e.target.value })} slotProps={{ input: { "aria-label": `${label} title` } }} />
      <Box sx={{ display: "flex", gap: 1 }}>
        <Input size="sm" placeholder="Min (auto)" value={a.min ?? ""} onChange={(e) => set({ min: numOrNull(e.target.value) })} slotProps={{ input: { "aria-label": `${label} minimum` } }} />
        <Input size="sm" placeholder="Max (auto)" value={a.max ?? ""} onChange={(e) => set({ max: numOrNull(e.target.value) })} slotProps={{ input: { "aria-label": `${label} maximum` } }} />
        <Input size="sm" placeholder="Unit (auto)" value={a.majorUnit ?? ""} onChange={(e) => set({ majorUnit: numOrNull(e.target.value) })} slotProps={{ input: { "aria-label": `${label} major unit` } }} />
      </Box>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
        <Input size="sm" sx={{ flex: 1 }} placeholder="Number format (e.g. $#,##0 or 0%)" value={a.numFmt ?? ""} onChange={(e) => set({ numFmt: e.target.value })} slotProps={{ input: { "aria-label": `${label} number format` } }} />
        {showLog && <Checkbox size="sm" label="Log scale" checked={!!a.logBase} onChange={(e) => set({ logBase: e.target.checked ? 10 : null })} />}
      </Box>
    </Stack>
  );
}

export function ChartDialog({ open, onClose, getWb, initial, onSave }: ChartDialogProps) {
  const [cfg, setCfg] = useState<ChartConfig | null>(null);
  const [rangeInput, setRangeInput] = useState("");
  const [seriesIdx, setSeriesIdx] = useState(0);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (!open) return;
    const wb = getWb();
    setSeriesIdx(0);
    setTab(0);
    if (initial) {
      setCfg(JSON.parse(JSON.stringify(initial)));
      setRangeInput(rangeText(initial.range));
      return;
    }
    const range = wb ? getSelectionRange(wb) : null;
    let sheetId: string | undefined;
    try {
      sheetId = wb?.getSheet?.()?.id;
    } catch {
      /* ignore */
    }
    const r: ChartRange = range ?? { r0: 0, r1: 0, c0: 0, c1: 0 };
    setRangeInput(range ? rangeText(range) : "");
    setCfg({
      id: `chart_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      type: "column",
      title: "",
      range: r,
      headerRow: true,
      labelCol: true,
      sheetId: sheetId ? String(sheetId) : undefined,
      anchor: defaultAnchor(r),
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const wb = getWb();
  const input = useMemo(() => (cfg && wb ? buildChartInput(wb, cfg) : null), [cfg, wb]);
  if (!cfg) return null;
  const set = (patch: Partial<ChartConfig>) => setCfg((c) => (c ? { ...c, ...patch } : c));
  const setSeries = (k: number, patch: Partial<SeriesConfig>) =>
    setCfg((c) => {
      if (!c) return c;
      const list = [...(c.series ?? [])];
      while (list.length <= k) list.push({});
      list[k] = { ...list[k], ...patch };
      return { ...c, series: list };
    });
  const hasData = !!input && input.series.some((s) => s.values.some((v) => Number.isFinite(v)));
  const rangeOk = !!parseRangeText(rangeInput);
  const seriesNames = input?.series.map((s) => s.name) ?? [];
  const sIdx = Math.min(seriesIdx, Math.max(0, seriesNames.length - 1));
  const sCfg = cfg.series?.[sIdx] ?? {};
  const trend = sCfg.trendline ?? null;
  const cartesian = !["pie", "doughnut"].includes(cfg.type);

  function applyRange(text: string) {
    setRangeInput(text);
    const r = parseRangeText(text);
    if (r) set({ range: r });
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 900, maxWidth: "97vw", maxHeight: "94vh", overflow: "auto" }} aria-labelledby="chart-title">
        <ModalClose />
        <Typography id="chart-title" level="title-lg">
          {initial ? "Edit chart" : "Insert chart"}
        </Typography>

        <Box sx={{ display: "flex", gap: 2, mt: 1, flexWrap: "wrap" }}>
          <Box sx={{ width: 330, minWidth: 280 }}>
            <Tabs value={tab} onChange={(_, v) => setTab(Number(v))} size="sm">
              <TabList>
                <Tab>Setup</Tab>
                <Tab>Customize</Tab>
                <Tab>Series</Tab>
              </TabList>

              <TabPanel value={0} sx={{ px: 0 }}>
                <Stack spacing={1.5}>
                  <FormControl>
                    <FormLabel>Chart type</FormLabel>
                    <Select value={cfg.type} onChange={(_, v) => v && set({ type: v as ChartType })} slotProps={{ button: { "aria-label": "Chart type" } }}>
                      {TYPES.map((t) => (
                        <Option key={t} value={t}>
                          {chartTypeLabel(t)}
                        </Option>
                      ))}
                    </Select>
                  </FormControl>
                  {STACKABLE.has(cfg.type) && (
                    <FormControl>
                      <FormLabel>Stacking</FormLabel>
                      <ToggleButtonGroup size="sm" value={cfg.stacking ?? "none"} onChange={(_, v) => v && set({ stacking: v as Stacking })}>
                        <Button value="none">None</Button>
                        <Button value="stacked">Stacked</Button>
                        <Button value="percent">100 %</Button>
                      </ToggleButtonGroup>
                    </FormControl>
                  )}
                  <FormControl error={!rangeOk}>
                    <FormLabel>Data range</FormLabel>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Input
                        size="sm"
                        sx={{ flex: 1 }}
                        value={rangeInput}
                        onChange={(e) => applyRange(e.target.value)}
                        placeholder="A1:D10"
                        slotProps={{ input: { "aria-label": "Data range" } }}
                      />
                      <Button
                        size="sm"
                        variant="outlined"
                        onClick={() => {
                          const r = getSelectionRange(getWb());
                          if (r) applyRange(rangeText(r));
                        }}
                      >
                        Use selection
                      </Button>
                    </Box>
                  </FormControl>
                  <Checkbox size="sm" label="First row is headers" checked={cfg.headerRow} onChange={(e) => set({ headerRow: e.target.checked })} />
                  <Checkbox size="sm" label="First column is labels" checked={cfg.labelCol} onChange={(e) => set({ labelCol: e.target.checked })} />
                  <Checkbox size="sm" label="Series in rows" checked={!!cfg.seriesInRows} onChange={(e) => set({ seriesInRows: e.target.checked })} />
                  {cfg.type === "scatter" && <Checkbox size="sm" label="Connect points with lines" checked={!!cfg.scatterLines} onChange={(e) => set({ scatterLines: e.target.checked })} />}
                  {cfg.type === "histogram" && (
                    <Stack spacing={1}>
                      <Checkbox
                        size="sm"
                        label="Sum by category (labels column)"
                        checked={!!cfg.histogram?.byCategory}
                        onChange={(e) => set({ histogram: { ...cfg.histogram, byCategory: e.target.checked } })}
                      />
                      {!cfg.histogram?.byCategory && (
                        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                          <Input size="sm" placeholder="Bin width (auto)" value={cfg.histogram?.binSize ?? ""} onChange={(e) => set({ histogram: { ...cfg.histogram, binSize: numOrNull(e.target.value) } })} slotProps={{ input: { "aria-label": "Bin width" } }} />
                          <Input size="sm" placeholder="Bins (auto)" value={cfg.histogram?.binCount ?? ""} onChange={(e) => set({ histogram: { ...cfg.histogram, binCount: numOrNull(e.target.value) } })} slotProps={{ input: { "aria-label": "Number of bins" } }} />
                          <Input size="sm" placeholder="Underflow ≤" value={cfg.histogram?.underflow ?? ""} onChange={(e) => set({ histogram: { ...cfg.histogram, underflow: numOrNull(e.target.value) } })} slotProps={{ input: { "aria-label": "Underflow bin" } }} />
                          <Input size="sm" placeholder="Overflow >" value={cfg.histogram?.overflow ?? ""} onChange={(e) => set({ histogram: { ...cfg.histogram, overflow: numOrNull(e.target.value) } })} slotProps={{ input: { "aria-label": "Overflow bin" } }} />
                        </Box>
                      )}
                    </Stack>
                  )}
                  {cfg.type === "waterfall" && (
                    <FormControl>
                      <FormLabel>Totals (category numbers, e.g. 1, 6)</FormLabel>
                      <Input
                        size="sm"
                        value={(cfg.totals ?? []).map((i) => i + 1).join(", ")}
                        onChange={(e) =>
                          set({
                            totals: e.target.value
                              .split(/[,\s]+/)
                              .map((x) => Number(x) - 1)
                              .filter((x) => Number.isInteger(x) && x >= 0),
                          })
                        }
                        slotProps={{ input: { "aria-label": "Waterfall totals" } }}
                      />
                    </FormControl>
                  )}
                </Stack>
              </TabPanel>

              <TabPanel value={1} sx={{ px: 0 }}>
                <Stack spacing={1.5}>
                  <FormControl>
                    <FormLabel>Title</FormLabel>
                    <Input size="sm" value={cfg.title} onChange={(e) => set({ title: e.target.value })} placeholder="Chart title (optional)" slotProps={{ input: { "aria-label": "Chart title" } }} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Legend</FormLabel>
                    <Select size="sm" value={cfg.legend ?? "auto"} onChange={(_, v) => set({ legend: v === "auto" ? undefined : (v as LegendPosition) })} slotProps={{ button: { "aria-label": "Legend position" } }}>
                      <Option value="auto">Auto</Option>
                      <Option value="bottom">Bottom</Option>
                      <Option value="top">Top</Option>
                      <Option value="right">Right</Option>
                      <Option value="left">Left</Option>
                      <Option value="none">None</Option>
                    </Select>
                  </FormControl>
                  <Checkbox size="sm" label="Data labels" checked={!!cfg.dataLabels} onChange={(e) => set({ dataLabels: e.target.checked })} />
                  {cfg.type === "doughnut" && (
                    <FormControl>
                      <FormLabel>Hole size (%)</FormLabel>
                      <Input size="sm" type="number" value={Math.round((cfg.holeSize ?? 0.5) * 100)} onChange={(e) => set({ holeSize: Math.max(10, Math.min(90, Number(e.target.value) || 50)) / 100 })} />
                    </FormControl>
                  )}
                  {cartesian && (
                    <>
                      <Divider />
                      <AxisFields label={cfg.type === "bar" ? "Horizontal axis (values)" : "Vertical axis"} value={cfg.yAxis} onChange={(yAxis) => set({ yAxis })} showLog={cfg.type !== "histogram" && cfg.type !== "waterfall"} />
                      <AxisFields label={cfg.type === "scatter" ? "Horizontal axis" : "Category axis"} value={cfg.xAxis} onChange={(xAxis) => set({ xAxis })} />
                      {cfg.type === "combo" && <AxisFields label="Secondary axis" value={cfg.y2Axis} onChange={(y2Axis) => set({ y2Axis })} />}
                    </>
                  )}
                </Stack>
              </TabPanel>

              <TabPanel value={2} sx={{ px: 0 }}>
                {seriesNames.length === 0 ? (
                  <Typography level="body-sm">No series in the range.</Typography>
                ) : (
                  <Stack spacing={1.5}>
                    <FormControl>
                      <FormLabel>Series</FormLabel>
                      <Select size="sm" value={sIdx} onChange={(_, v) => setSeriesIdx(Number(v))} slotProps={{ button: { "aria-label": "Series" } }}>
                        {seriesNames.map((n, i) => (
                          <Option key={i} value={i}>
                            {n}
                          </Option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl orientation="horizontal" sx={{ gap: 1, alignItems: "center" }}>
                      <FormLabel sx={{ m: 0 }}>Colour</FormLabel>
                      <input
                        type="color"
                        aria-label="Series colour"
                        value={seriesColor(cfg, sIdx)}
                        onChange={(e) => setSeries(sIdx, { color: e.target.value })}
                        style={{ width: 36, height: 24, border: "none", background: "none" }}
                      />
                      {sCfg.color && (
                        <Button size="sm" variant="plain" onClick={() => setSeries(sIdx, { color: undefined })}>
                          Theme colour
                        </Button>
                      )}
                    </FormControl>
                    {cfg.type === "combo" && (
                      <>
                        <FormControl>
                          <FormLabel>Draw as</FormLabel>
                          <ToggleButtonGroup size="sm" value={sCfg.type ?? (sIdx === 0 ? "column" : "line")} onChange={(_, v) => v && setSeries(sIdx, { type: v as SeriesConfig["type"] })}>
                            <Button value="column">Column</Button>
                            <Button value="line">Line</Button>
                            <Button value="area">Area</Button>
                          </ToggleButtonGroup>
                        </FormControl>
                        <Checkbox size="sm" label="Plot on secondary axis" checked={!!sCfg.secondary} onChange={(e) => setSeries(sIdx, { secondary: e.target.checked })} />
                      </>
                    )}
                    <Checkbox size="sm" label="Data labels for this series" checked={!!sCfg.dataLabels} onChange={(e) => setSeries(sIdx, { dataLabels: e.target.checked })} />
                    {cartesian && cfg.type !== "histogram" && cfg.type !== "waterfall" && cfg.type !== "bar" && (
                      <>
                        <Divider />
                        <FormControl>
                          <FormLabel>Trendline</FormLabel>
                          <Select
                            size="sm"
                            value={trend?.type ?? ""}
                            onChange={(_, v) => setSeries(sIdx, { trendline: v ? { ...(trend ?? {}), type: v as TrendType } : null })}
                            slotProps={{ button: { "aria-label": "Trendline" } }}
                          >
                            {TREND_TYPES.map(([v, l]) => (
                              <Option key={v} value={v}>
                                {l}
                              </Option>
                            ))}
                          </Select>
                        </FormControl>
                        {trend?.type === "poly" && (
                          <Input size="sm" type="number" startDecorator="Order" value={trend.order ?? 2} onChange={(e) => setSeries(sIdx, { trendline: { ...trend, order: Math.max(2, Math.min(6, Number(e.target.value) || 2)) } })} />
                        )}
                        {trend?.type === "movingAvg" && (
                          <Input size="sm" type="number" startDecorator="Period" value={trend.period ?? 2} onChange={(e) => setSeries(sIdx, { trendline: { ...trend, period: Math.max(2, Number(e.target.value) || 2) } })} />
                        )}
                        {trend && trend.type !== "movingAvg" && (
                          <>
                            <Checkbox size="sm" label="Show equation" checked={!!trend.showEquation} onChange={(e) => setSeries(sIdx, { trendline: { ...trend, showEquation: e.target.checked } })} />
                            <Checkbox size="sm" label="Show R²" checked={!!trend.showR2} onChange={(e) => setSeries(sIdx, { trendline: { ...trend, showR2: e.target.checked } })} />
                            {(trend.type === "linear" || trend.type === "exp" || trend.type === "poly") && (
                              <Input
                                size="sm"
                                placeholder="Set intercept (optional)"
                                value={trend.intercept ?? ""}
                                onChange={(e) => setSeries(sIdx, { trendline: { ...trend, intercept: numOrNull(e.target.value) } })}
                                slotProps={{ input: { "aria-label": "Trendline intercept" } }}
                              />
                            )}
                            <Box sx={{ display: "flex", gap: 1 }}>
                              <Input size="sm" placeholder="Forecast forward" value={trend.forward ?? ""} onChange={(e) => setSeries(sIdx, { trendline: { ...trend, forward: numOrNull(e.target.value) ?? undefined } })} />
                              <Input size="sm" placeholder="Backward" value={trend.backward ?? ""} onChange={(e) => setSeries(sIdx, { trendline: { ...trend, backward: numOrNull(e.target.value) ?? undefined } })} />
                            </Box>
                          </>
                        )}
                      </>
                    )}
                  </Stack>
                )}
              </TabPanel>
            </Tabs>
          </Box>

          <Box
            sx={{
              flex: 1,
              minWidth: 320,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: "sm",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "#fff",
              minHeight: 340,
              alignSelf: "flex-start",
            }}
          >
            {hasData && input ? (
              <ChartRenderer config={cfg} input={input} width={500} height={330} />
            ) : (
              <Typography level="body-sm" sx={{ opacity: 0.6, p: 2, textAlign: "center" }}>
                Enter or select a range of cells with numbers.
              </Typography>
            )}
          </Box>
        </Box>

        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1.5 }}>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave({ ...cfg, title: cfg.title.trim() });
              onClose();
            }}
            disabled={!hasData || !rangeOk}
          >
            {initial ? "Save chart" : "Insert chart"}
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
