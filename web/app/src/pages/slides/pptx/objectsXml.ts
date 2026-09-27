// pptx parts for the M11 objects, written from ECMA-376 (Part 1 §21.2
// DrawingML charts, §19.3.1.37 p:pic + §20.1.3.6 a:videoFile/a:audioFile,
// §21.1.2.3.9 a:rPr effects, §20.1.9.19 a:prstTxWarp) and the SmartArt
// drawing fallback (the `dsp:drawing` part PowerPoint caches beside a
// diagram's data).
//
// Charts: each chart element becomes a p:graphicFrame pointing at
// ppt/charts/chartN.xml, written by the Sheets chart writer
// (sheets/xlsx/xlsxCharts.chartSpaceXml) with every value cached in the
// part and an embedded workbook (ppt/embeddings/…xlsx, written by the Sheets
// xlsx writer) holding the data sheet, so PowerPoint can edit the data. The
// Grown chart (type, options and data) rides in the part's c:extLst entry,
// so Grown reads back exactly what it wrote; foreign charts are rebuilt from
// the chart XML and their cached values.
//
// Media: pptxgenjs writes the p:pic (embedded file, or a linked URL for
// online/linked clips) with its poster; the patch adds a:audioFile for
// audio and Grown's playback options in a p:nvPr extension.
//
// Word art: run outline/gradient/effects and the body's warp preset.

import { chartConfigOf, chartDataFromCache, chartInputOf, normalizeGrid } from "../chartElement";
import { isTextWarp } from "../wordArt";
import type { DeckTheme, SlideChart, SlideElement, SlideMedia, WordArt } from "../model";
import { EMU_PER_PX, esc } from "./textXml";
import { chartSpaceXml, readChartCache, readChartSpace, GROWN_CHART_URI } from "../../sheets/xlsx/xlsxCharts";

export const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
export const REL_CHART = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
export const REL_PACKAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package";
export const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
export const CT_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const REL_AUDIO = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio";
/** Grown's playback options on a media p:pic (`p:nvPr/p:extLst`). */
export const GROWN_MEDIA_URI = "{8A3C2F1E-47B5-4E0B-9D6A-6772726F776D}";
export const GROWN_NS = "https://grown.pick.haus/pptx/2026/media";

// ------------------------------------------------------------ word art (write)

/** `a:srgbClr` for a CSS hex colour; an 8-digit hex carries its alpha. */
export function srgbXml(css: string): string {
  const h = css.replace("#", "");
  const rgb = (h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6)).padEnd(6, "0").toUpperCase();
  const a = h.length === 8 ? Math.round((parseInt(h.slice(6, 8), 16) / 255) * 100000) : null;
  return a !== null && a < 100000 ? `<a:srgbClr val="${rgb}"><a:alpha val="${a}"/></a:srgbClr>` : `<a:srgbClr val="${rgb}"/>`;
}

const emu = (px: number) => Math.round(px * EMU_PER_PX);

/** Run-property children for word art: `ln` (first), the fill (a gradient
 *  replaces the solid fill) and `effectLst`, in CT_TextCharacterProperties
 *  order. */
export function wordArtRunXml(art: WordArt | undefined): { ln: string; fill: string | null; effects: string } {
  if (!art) return { ln: "", fill: null, effects: "" };
  const ln = art.outline && art.outline.width > 0 ? `<a:ln w="${emu(art.outline.width)}"><a:solidFill>${srgbXml(art.outline.color)}</a:solidFill></a:ln>` : "";
  const g = art.gradient;
  const fill = g
    ? `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0">${srgbXml(g.from)}</a:gs><a:gs pos="100000">${srgbXml(g.to)}</a:gs></a:gsLst><a:lin ang="${Math.round((((g.angle % 360) + 360) % 360) * 60000)}" scaled="0"/></a:gradFill>`
    : null;
  let eff = "";
  if (art.glow && art.glow.radius > 0) eff += `<a:glow rad="${emu(art.glow.radius)}">${srgbXml(art.glow.color)}</a:glow>`;
  if (art.shadow)
    eff += `<a:outerShdw blurRad="${emu(art.shadow.blur)}" dist="${emu(art.shadow.dist)}" dir="${Math.round((((art.shadow.dir % 360) + 360) % 360) * 60000)}" algn="tl" rotWithShape="0">${srgbXml(art.shadow.color)}</a:outerShdw>`;
  return { ln, fill, effects: eff ? `<a:effectLst>${eff}</a:effectLst>` : "" };
}

/** `a:prstTxWarp` for the body (first child of a:bodyPr), or "". */
export function warpXml(art: WordArt | undefined): string {
  return art?.warp ? `<a:prstTxWarp prst="${art.warp}"><a:avLst/></a:prstTxWarp>` : "";
}

// ------------------------------------------------------------ word art (read)

/** Word art from a text body: the first run's `a:ln` / `a:gradFill` /
 *  `a:effectLst` and the body's `a:prstTxWarp` (a supported preset only).
 *  `color` resolves a colour-bearing element to CSS hex. */
export function readWordArt(txBody: Element | null, color: (fillLike: Element | null) => string | undefined): WordArt | undefined {
  if (!txBody) return undefined;
  const kid = (e: Element | null | undefined, n: string) => (e ? Array.from(e.children).find((c) => c.localName === n) ?? null : null);
  const art: WordArt = {};
  const warp = kid(kid(txBody, "bodyPr"), "prstTxWarp")?.getAttribute("prst");
  if (isTextWarp(warp)) art.warp = warp;
  const rPr = Array.from(txBody.getElementsByTagNameNS("*", "rPr"))[0] ?? null;
  const ln = kid(rPr, "ln");
  if (ln && !kid(ln, "noFill")) {
    const c = color(kid(ln, "solidFill"));
    const w = Number(ln.getAttribute("w") ?? "12700");
    if (c) art.outline = { color: c, width: Math.round((w / EMU_PER_PX) * 100) / 100 };
  }
  const grad = kid(rPr, "gradFill");
  if (grad) {
    const stops = Array.from(kid(grad, "gsLst")?.children ?? [])
      .map((gs) => ({ pos: Number(gs.getAttribute("pos") ?? 0), c: color(gs) }))
      .filter((s) => s.c)
      .sort((a, b) => a.pos - b.pos);
    if (stops.length >= 2)
      art.gradient = { from: stops[0].c!, to: stops[stops.length - 1].c!, angle: Math.round(Number(kid(grad, "lin")?.getAttribute("ang") ?? 0) / 60000) };
  }
  const eff = kid(rPr, "effectLst");
  const glow = kid(eff, "glow");
  if (glow) {
    const c = color(glow);
    if (c) art.glow = { color: c, radius: Math.round(Number(glow.getAttribute("rad") ?? 0) / EMU_PER_PX) };
  }
  const sh = kid(eff, "outerShdw");
  if (sh) {
    const c = color(sh);
    if (c)
      art.shadow = {
        color: c,
        blur: Math.round(Number(sh.getAttribute("blurRad") ?? 0) / EMU_PER_PX),
        dist: Math.round(Number(sh.getAttribute("dist") ?? 0) / EMU_PER_PX),
        dir: Math.round(Number(sh.getAttribute("dir") ?? 0) / 60000),
      };
  }
  return Object.keys(art).length ? art : undefined;
}

// ------------------------------------------------------------ charts (write)

/** The chart part for a slide chart: Sheets chart XML over "Sheet1" of the
 *  embedded workbook (`workbookRid`), every value cached, and the Grown
 *  chart (not the resolved Sheets config) in the extension entry. */
export function slideChartXml(chart: SlideChart, theme: DeckTheme, workbookRid?: string): string {
  const input = chartInputOf(chart);
  const xml = chartSpaceXml(chartConfigOf(chart, theme), "Sheet1", {
    cache: { categories: input.categories, series: input.series, xValues: chart.type === "scatter" ? input.xValues : undefined },
    externalData: workbookRid,
  });
  const own = esc(JSON.stringify({ ...chart, data: normalizeGrid(chart.data) }));
  return xml.replace(/<g:chart>[\s\S]*?<\/g:chart>/, () => `<g:chart>${own}</g:chart>`);
}

/** The embedded workbook of a chart: its data sheet as Sheet1 (numbers as
 *  numbers). */
export async function chartWorkbook(chart: SlideChart): Promise<Uint8Array> {
  const { workbookToXlsx } = await import("../../sheets/xlsx/xlsxWrite");
  const celldata: { r: number; c: number; v: { v: string | number; m: string } }[] = [];
  normalizeGrid(chart.data).forEach((row, r) =>
    row.forEach((v, c) => {
      if (v === "") return;
      const n = Number(v.replace(/,/g, ""));
      const num = r > 0 && (c > 0 || chart.type === "scatter") && v.trim() !== "" && Number.isFinite(n);
      celldata.push({ r, c, v: { v: num ? n : v, m: v } });
    }),
  );
  return workbookToXlsx([{ name: "Sheet1", celldata }], { title: chart.title || "Chart data" });
}

/** A p:graphicFrame showing chart relationship `rid`. */
export function chartFrameXml(id: string, name: string, el: Pick<SlideElement, "x" | "y" | "w" | "h" | "rotation" | "flipH" | "flipV" | "alt">, rid: string): string {
  const rot = el.rotation ? ` rot="${Math.round(el.rotation * 60000)}"` : "";
  const fl = `${el.flipH ? ' flipH="1"' : ""}${el.flipV ? ' flipV="1"' : ""}`;
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${esc(id)}" name="${esc(name)}"${el.alt ? ` descr="${esc(el.alt)}"` : ""}/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm${rot}${fl}><a:off x="${emu(el.x)}" y="${emu(el.y)}"/><a:ext cx="${emu(el.w)}" cy="${emu(el.h)}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" r:id="${esc(rid)}"/></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

// ------------------------------------------------------------ charts (read)

/**
 * A chart part → a slide chart: Grown's own entry when present, else the
 * chart rebuilt by the Sheets reader (type, stacking, legend, axes,
 * colours…) with its data sheet from the cached values. Null when the part
 * has no series values.
 */
export function readSlideChart(doc: Document): SlideChart | null {
  for (const ext of Array.from(doc.getElementsByTagNameNS("*", "ext"))) {
    if (ext.getAttribute("uri") !== GROWN_CHART_URI) continue;
    try {
      const c = JSON.parse(ext.textContent ?? "") as SlideChart;
      if (c && Array.isArray(c.data) && c.type) return { ...c, data: normalizeGrid(c.data) };
    } catch {
      /* fall through */
    }
  }
  const cache = readChartCache(doc);
  if (!cache) return null;
  const read = readChartSpace(doc);
  const cfg = read?.cfg;
  const chart: SlideChart = { type: cfg?.type ?? "column", title: cfg?.title ?? "", data: chartDataFromCache(cache) };
  if (!cfg) return chart;
  for (const k of ["stacking", "legend", "dataLabels", "scatterLines", "holeSize", "series", "xAxis", "yAxis", "y2Axis"] as const) {
    const v = cfg[k];
    if (v !== undefined) (chart as unknown as Record<string, unknown>)[k] = v;
  }
  // The cached grid always has series down the columns.
  return chart;
}

// ------------------------------------------------------------ media

/** Grown's playback options as a p:nvPr extension (Grown reads it back;
 *  PowerPoint ignores it). */
export function mediaExtXml(m: SlideMedia): string {
  const attrs = [
    m.autoplay ? ' autoplay="1"' : "",
    m.loop ? ' loop="1"' : "",
    m.muted ? ' muted="1"' : "",
    m.embed ? ` embed="${esc(`${m.embed.provider}:${m.embed.id}`)}"` : "",
  ].join("");
  return `<p:ext uri="${GROWN_MEDIA_URI}"><g:media xmlns:g="${GROWN_NS}" kind="${m.kind}"${attrs}/></p:ext>`;
}

/** Playback options from a media p:pic's Grown extension. */
export function readMediaExt(nvPr: Element | null): Partial<SlideMedia> {
  if (!nvPr) return {};
  const ext = Array.from(nvPr.getElementsByTagNameNS("*", "ext")).find((e) => e.getAttribute("uri") === GROWN_MEDIA_URI);
  const g = ext?.firstElementChild;
  if (!g) return {};
  const out: Partial<SlideMedia> = {};
  if (g.getAttribute("autoplay") === "1") out.autoplay = true;
  if (g.getAttribute("loop") === "1") out.loop = true;
  if (g.getAttribute("muted") === "1") out.muted = true;
  const k = g.getAttribute("kind");
  if (k === "audio" || k === "video") out.kind = k;
  const em = /^(youtube|vimeo):([\w-]+)$/.exec(g.getAttribute("embed") ?? "");
  if (em) out.embed = { provider: em[1] as "youtube" | "vimeo", id: em[2] };
  return out;
}

/** File extension pptx media parts get for a MIME type. */
export function mediaExt(mime: string | undefined, kind: SlideMedia["kind"]): string {
  switch ((mime ?? "").toLowerCase()) {
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "video/ogg":
      return "ogv";
    case "video/quicktime":
      return "mov";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/aac":
      return "aac";
    case "audio/ogg":
      return "oga";
    case "audio/wav":
    case "audio/x-wav":
    case "audio/wave":
      return "wav";
    case "audio/webm":
      return "weba";
  }
  return kind === "audio" ? "mp3" : "mp4";
}

/** MIME type of a media part by extension. */
export function mediaMimeOf(ext: string): string | undefined {
  return (
    {
      mp4: "video/mp4",
      m4v: "video/mp4",
      webm: "video/webm",
      ogv: "video/ogg",
      mov: "video/quicktime",
      mp3: "audio/mpeg",
      m4a: "audio/mp4",
      aac: "audio/aac",
      oga: "audio/ogg",
      ogg: "audio/ogg",
      wav: "audio/wav",
      weba: "audio/webm",
      wma: undefined,
      wmv: undefined,
    } as Record<string, string | undefined>
  )[ext.toLowerCase()];
}
