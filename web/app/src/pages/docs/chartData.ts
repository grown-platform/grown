// Chart attribute helpers for document charts (Docs M7), shared by the
// chart node and the DOCX writer without pulling in the node views.
import { defaultChartData, normalizeGrid } from "../slides/chartElement";
import type { SlideChart } from "../slides/model";

/** A chart node's `chart` attribute (JSON) as a chart, normalised. */
export function chartOfAttr(v: unknown): SlideChart {
  try {
    const c = JSON.parse(String(v ?? "")) as SlideChart;
    if (c && c.type && Array.isArray(c.data)) return { ...c, data: normalizeGrid(c.data) };
  } catch {
    /* default below */
  }
  return { type: "column", title: "", data: defaultChartData("column") };
}

export function chartAttr(chart: SlideChart): string {
  return JSON.stringify({ ...chart, data: normalizeGrid(chart.data) });
}
