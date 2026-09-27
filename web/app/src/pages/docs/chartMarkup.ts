// Static SVG markup for a document chart (Docs M7): the Sheets chart
// renderer (pages/sheets/ChartRenderer.tsx) drawn to a string, so the chart
// node view, HTML export and print share one drawing. Loaded lazily — it
// pulls in react-dom/server and the chart code.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartRenderer } from "../sheets/ChartRenderer";
import { chartConfigOf, chartInputOf } from "../slides/chartElement";
import type { SlideChart } from "../slides/model";

export function chartMarkup(chart: SlideChart, width: number, height: number): string {
  return renderToStaticMarkup(
    createElement(ChartRenderer, { config: chartConfigOf(chart, undefined, "doc-chart"), input: chartInputOf(chart), width: Math.max(40, width), height: Math.max(30, height) }),
  );
}
