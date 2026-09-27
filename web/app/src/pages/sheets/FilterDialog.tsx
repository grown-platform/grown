import { useCallback, useEffect, useMemo, useState } from "react";
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
  Radio,
  RadioGroup,
  Select,
  Stack,
  Tab,
  TabList,
  Tabs,
  Typography,
} from "@mui/joy";
import {
  columnValues,
  createFilter,
  setColumnFilter,
  valuesFilterFromItems,
  type ColumnFilter,
  type CustomOp,
  type DynamicType,
  type FilterState,
  type ValueItem,
} from "./filterOps";
import { applyFilter, currentSheet, sheetFilter, sortFilter } from "./sheetDataTools";
import { cellDisplay, colToLetters, normColor, type Grid } from "./cellValue";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

type Mode = "values" | "condition" | "top10" | "dynamic" | "color";

const OPS: [CustomOp, string][] = [
  ["equals", "Is equal to"],
  ["doesNotEqual", "Is not equal to"],
  ["isGreaterThan", "Is greater than"],
  ["isGreaterThanOrEqualTo", "Is greater than or equal to"],
  ["isLessThan", "Is less than"],
  ["isLessThanOrEqualTo", "Is less than or equal to"],
  ["beginsWith", "Begins with"],
  ["doesNotBeginWith", "Does not begin with"],
  ["endsWith", "Ends with"],
  ["doesNotEndWith", "Does not end with"],
  ["contains", "Contains"],
  ["doesNotContain", "Does not contain"],
];

const DYNAMIC: [DynamicType, string][] = [
  ["aboveAverage", "Above average"],
  ["belowAverage", "Below average"],
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["tomorrow", "Tomorrow"],
  ["thisWeek", "This week"],
  ["lastWeek", "Last week"],
  ["nextWeek", "Next week"],
  ["thisMonth", "This month"],
  ["lastMonth", "Last month"],
  ["nextMonth", "Next month"],
  ["thisQuarter", "This quarter"],
  ["lastQuarter", "Last quarter"],
  ["nextQuarter", "Next quarter"],
  ["thisYear", "This year"],
  ["lastYear", "Last year"],
  ["nextYear", "Next year"],
  ["yearToDate", "Year to date"],
  ["q1", "Quarter 1"],
  ["q2", "Quarter 2"],
  ["q3", "Quarter 3"],
  ["q4", "Quarter 4"],
  ...Array.from({ length: 12 }, (_, i) => [
    `m${i + 1}` as DynamicType,
    new Date(2000, i, 1).toLocaleString("en-US", { month: "long" }),
  ] as [DynamicType, string]),
];

interface FilterDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
}

function selectionRect(wb: any) {
  const s = wb?.getSelection?.();
  const sel = Array.isArray(s) ? s[0] : s;
  if (!sel) return null;
  return {
    r1: Math.min(sel.row[0], sel.row[1]),
    r2: Math.max(sel.row[0], sel.row[1]),
    c1: Math.min(sel.column[0], sel.column[1]),
    c2: Math.max(sel.column[0], sel.column[1]),
  };
}

export function FilterDialog({ open, onClose, getWb }: FilterDialogProps) {
  const [state, setState] = useState<FilterState | null>(null);
  const [grid, setGrid] = useState<Grid>([]);
  const [colId, setColId] = useState(0);
  const [mode, setMode] = useState<Mode>("values");
  const [items, setItems] = useState<ValueItem[]>([]);
  const [search, setSearch] = useState("");
  const [c1, setC1] = useState<{ op: CustomOp; val: string }>({ op: "equals", val: "" });
  const [c2, setC2] = useState<{ op: CustomOp; val: string }>({ op: "equals", val: "" });
  const [and, setAnd] = useState(true);
  const [topN, setTopN] = useState({ top: true, percent: false, val: "10" });
  const [dyn, setDyn] = useState<DynamicType>("aboveAverage");
  const [color, setColor] = useState<{ kind: "cell" | "font"; value: string | null }>({ kind: "cell", value: null });
  const [err, setErr] = useState<string | null>(null);

  const loadColumn = useCallback((st: FilterState, g: Grid, id: number) => {
    setColId(id);
    setItems(columnValues(g, st, id));
    setSearch("");
    const f = st.columns[String(id)];
    setMode(!f ? "values" : f.type === "custom" ? "condition" : f.type === "values" ? "values" : f.type);
    if (f?.type === "custom") {
      setC1(f.conditions[0] ?? { op: "equals", val: "" });
      setC2(f.conditions[1] ?? { op: "equals", val: "" });
      setAnd(f.and);
    } else {
      setC1({ op: "equals", val: "" });
      setC2({ op: "equals", val: "" });
      setAnd(true);
    }
    if (f?.type === "top10") setTopN({ top: f.top, percent: f.percent, val: String(f.val) });
    if (f?.type === "dynamic") setDyn(f.dynamic);
    if (f?.type === "color")
      setColor(f.fontColor !== undefined ? { kind: "font", value: f.fontColor ?? null } : { kind: "cell", value: f.cellColor ?? null });
  }, []);

  useEffect(() => {
    if (!open) return;
    const wb = getWb();
    const sheet = currentSheet(wb);
    const g: Grid = Array.isArray(sheet?.data) ? sheet.data : [];
    setGrid(g);
    setErr(null);
    let st = sheetFilter(sheet);
    const sel = selectionRect(wb);
    const fs = sheet?.filter_select;
    if (!st && fs?.row && fs?.column) {
      // A filter made with Data ▸ Create a filter (FortuneSheet's own).
      st = { range: { r1: fs.row[0], r2: fs.row[1], c1: fs.column[0], c2: fs.column[1] }, columns: {} };
    }
    if (!st && sel) st = createFilter(g, sel);
    setState(st);
    if (!st) {
      setErr("Select a cell inside your data first.");
      return;
    }
    const col = sel && sel.c1 >= st.range.c1 && sel.c1 <= st.range.c2 ? sel.c1 - st.range.c1 : 0;
    loadColumn(st, g, col);
  }, [open, getWb, loadColumn]);

  const headers = useMemo(() => {
    if (!state) return [];
    const out: string[] = [];
    for (let c = state.range.c1; c <= state.range.c2; c++) {
      const h = cellDisplay(grid[state.range.r1]?.[c]);
      out.push(`${colToLetters(c)}${h ? ` — ${h}` : ""}`);
    }
    return out;
  }, [state, grid]);

  const colors = useMemo(() => {
    if (!state) return { cell: [] as (string | null)[], font: [] as (string | null)[] };
    const col = state.range.c1 + colId;
    const cell = new Set<string | null>();
    const font = new Set<string | null>();
    for (let r = state.range.r1 + 1; r <= state.range.r2; r++) {
      const x: any = grid[r]?.[col];
      cell.add(normColor(x?.bg));
      font.add(normColor(x?.fc) ?? "#000000");
    }
    return { cell: [...cell], font: [...font] };
  }, [state, grid, colId]);

  function criterion(): ColumnFilter | null | "invalid" {
    switch (mode) {
      case "values":
        return valuesFilterFromItems(items);
      case "condition": {
        const list = [c1, c2].filter((c) => c.val.trim() !== "");
        return list.length ? { type: "custom", and, conditions: list } : null;
      }
      case "top10": {
        const n = Number(topN.val);
        if (!Number.isFinite(n) || n <= 0 || (topN.percent && n > 100)) return "invalid";
        return { type: "top10", top: topN.top, percent: topN.percent, val: n };
      }
      case "dynamic":
        return { type: "dynamic", dynamic: dyn };
      case "color":
        return color.kind === "cell" ? { type: "color", cellColor: color.value } : { type: "color", fontColor: color.value };
    }
  }

  function apply() {
    if (!state) return;
    const c = criterion();
    if (c === "invalid") {
      setErr("Enter a positive number (at most 100 for a percentage).");
      return;
    }
    applyFilter(getWb(), setColumnFilter(state, colId, c));
    onClose();
  }

  function clearColumn() {
    if (!state) return;
    applyFilter(getWb(), setColumnFilter(state, colId, null));
    onClose();
  }

  function removeFilter() {
    applyFilter(getWb(), null);
    onClose();
  }

  function sort(desc: boolean) {
    const wb = getWb();
    if (!state) return;
    // Make sure the filter exists on the sheet before sorting by it.
    if (!sheetFilter(currentSheet(wb))) applyFilter(wb, state);
    sortFilter(wb, colId, desc);
    onClose();
  }

  const shown = items.filter((i) => i.text.toLowerCase().includes(search.toLowerCase()));
  const swatch = (c: string | null) => (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        width: 14,
        height: 14,
        mr: 1,
        verticalAlign: "middle",
        border: "1px solid",
        borderColor: "neutral.outlinedBorder",
        bgcolor: c ?? "transparent",
        backgroundImage: c ? undefined : "linear-gradient(135deg, transparent 45%, #d33 45%, #d33 55%, transparent 55%)",
      }}
    />
  );

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 480, maxWidth: "95vw" }} aria-labelledby="filter-title">
        <ModalClose />
        <Typography id="filter-title" level="title-lg">
          Filter
        </Typography>
        {state && (
          <Stack spacing={1.25} sx={{ mt: 1 }}>
            <Typography level="body-sm" sx={{ opacity: 0.75 }}>
              Range {colToLetters(state.range.c1)}
              {state.range.r1 + 1}:{colToLetters(state.range.c2)}
              {state.range.r2 + 1} (first row is the header)
            </Typography>
            <FormControl>
              <FormLabel>Column</FormLabel>
              <Select
                value={colId}
                onChange={(_, v) => v !== null && loadColumn(state, grid, Number(v))}
                slotProps={{ button: { "aria-label": "Filter column" } }}
              >
                {headers.map((h, i) => (
                  <Option key={i} value={i}>
                    {h}
                  </Option>
                ))}
              </Select>
            </FormControl>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button size="sm" variant="outlined" onClick={() => sort(false)}>
                Sort A → Z
              </Button>
              <Button size="sm" variant="outlined" onClick={() => sort(true)}>
                Sort Z → A
              </Button>
            </Box>
            <Tabs value={mode} onChange={(_, v) => v && setMode(v as Mode)} size="sm">
              <TabList>
                <Tab value="values">Values</Tab>
                <Tab value="condition">Condition</Tab>
                <Tab value="top10">Top 10</Tab>
                <Tab value="dynamic">Average / dates</Tab>
                <Tab value="color">Colour</Tab>
              </TabList>
            </Tabs>

            {mode === "values" && (
              <Stack spacing={0.75}>
                <Input
                  size="sm"
                  placeholder="Search values"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  slotProps={{ input: { "aria-label": "Search values" } }}
                />
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button size="sm" variant="plain" onClick={() => setItems(items.map((i) => ({ ...i, visible: true })))}>
                    Select all
                  </Button>
                  <Button size="sm" variant="plain" onClick={() => setItems(items.map((i) => ({ ...i, visible: false })))}>
                    Clear
                  </Button>
                </Box>
                <Box sx={{ maxHeight: 200, overflowY: "auto", border: "1px solid", borderColor: "divider", borderRadius: "sm", p: 1 }}>
                  {shown.map((it) => (
                    <Checkbox
                      key={(it.isDate ? "d" : "t") + it.text}
                      size="sm"
                      sx={{ display: "flex", py: 0.25 }}
                      label={it.text === "" ? "(Blanks)" : it.text}
                      checked={it.visible}
                      onChange={(e) =>
                        setItems(items.map((x) => (x === it ? { ...x, visible: e.target.checked } : x)))
                      }
                    />
                  ))}
                  {!shown.length && (
                    <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                      No values
                    </Typography>
                  )}
                </Box>
              </Stack>
            )}

            {mode === "condition" && (
              <Stack spacing={1}>
                {[
                  [c1, setC1, "First condition"] as const,
                  [c2, setC2, "Second condition"] as const,
                ].map(([c, set, label], i) => (
                  <Box key={i} sx={{ display: "flex", gap: 1 }}>
                    <Select
                      size="sm"
                      value={c.op}
                      onChange={(_, v) => v && set({ ...c, op: v as CustomOp })}
                      sx={{ minWidth: 200 }}
                      slotProps={{ button: { "aria-label": `${label} operator` } }}
                    >
                      {OPS.map(([k, l]) => (
                        <Option key={k} value={k}>
                          {l}
                        </Option>
                      ))}
                    </Select>
                    <Input
                      size="sm"
                      sx={{ flex: 1 }}
                      value={c.val}
                      placeholder="Value (use ? and * as wildcards)"
                      onChange={(e) => set({ ...c, val: e.target.value })}
                      slotProps={{ input: { "aria-label": `${label} value` } }}
                    />
                  </Box>
                ))}
                <RadioGroup orientation="horizontal" value={and ? "and" : "or"} onChange={(e) => setAnd(e.target.value === "and")}>
                  <Radio size="sm" value="and" label="And" />
                  <Radio size="sm" value="or" label="Or" />
                </RadioGroup>
              </Stack>
            )}

            {mode === "top10" && (
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <Select size="sm" value={topN.top ? "top" : "bottom"} onChange={(_, v) => setTopN({ ...topN, top: v === "top" })}>
                  <Option value="top">Top</Option>
                  <Option value="bottom">Bottom</Option>
                </Select>
                <Input
                  size="sm"
                  type="number"
                  value={topN.val}
                  onChange={(e) => setTopN({ ...topN, val: e.target.value })}
                  sx={{ width: 90 }}
                  slotProps={{ input: { "aria-label": "Top 10 value" } }}
                />
                <Select
                  size="sm"
                  value={topN.percent ? "percent" : "items"}
                  onChange={(_, v) => setTopN({ ...topN, percent: v === "percent" })}
                >
                  <Option value="items">Items</Option>
                  <Option value="percent">Percent</Option>
                </Select>
              </Box>
            )}

            {mode === "dynamic" && (
              <Select
                size="sm"
                value={dyn}
                onChange={(_, v) => v && setDyn(v as DynamicType)}
                slotProps={{ button: { "aria-label": "Dynamic filter" } }}
              >
                {DYNAMIC.map(([k, l]) => (
                  <Option key={k} value={k}>
                    {l}
                  </Option>
                ))}
              </Select>
            )}

            {mode === "color" && (
              <Stack spacing={0.75}>
                <RadioGroup
                  orientation="horizontal"
                  value={color.kind}
                  onChange={(e) => setColor({ kind: e.target.value as "cell" | "font", value: null })}
                >
                  <Radio size="sm" value="cell" label="Fill colour" />
                  <Radio size="sm" value="font" label="Text colour" />
                </RadioGroup>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {(color.kind === "cell" ? colors.cell : colors.font).map((c) => (
                    <Button
                      key={String(c)}
                      size="sm"
                      variant={color.value === c ? "solid" : "outlined"}
                      onClick={() => setColor({ ...color, value: c })}
                    >
                      {swatch(c)}
                      {c ?? "No fill"}
                    </Button>
                  ))}
                </Box>
              </Stack>
            )}
          </Stack>
        )}
        {err && (
          <Typography level="body-sm" color="danger" sx={{ mt: 1 }}>
            {err}
          </Typography>
        )}
        <Box sx={{ display: "flex", gap: 1, justifyContent: "space-between", mt: 2 }}>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button variant="plain" color="neutral" onClick={clearColumn} disabled={!state}>
              Clear column
            </Button>
            <Button variant="plain" color="danger" onClick={removeFilter} disabled={!state}>
              Remove filter
            </Button>
          </Box>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button variant="plain" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={!state}>
              Apply
            </Button>
          </Box>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
