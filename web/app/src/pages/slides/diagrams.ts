// SmartArt-lite (M11, the additive alternative to flagged exception F6):
// a handful of common diagram layouts generated from a text outline as a
// group of M3 preset shapes, text boxes and connectors. There is no layout
// engine and no diagram data model beyond the outline: the group remembers
// its layout and outline (`SlideElement.diagram`), and editing the outline
// rebuilds the group's members inside its current box. Everything a diagram
// draws is ordinary shapes, so every renderer and the pptx writer handle it
// (it is written as a p:grpSp, not as a dgm: SmartArt part).
//
// Colours are theme references (accents, lt1 text), so a theme change
// recolours diagrams like any other themed shape.

import { newConnector, uid, type DeckTheme, type DiagramSpec, type SlideElement } from "./model";
import { resolveRef } from "./theme";

export type DiagramLayout = DiagramSpec["layout"];

export const DIAGRAM_LAYOUTS: { value: DiagramLayout; label: string; sample: string }[] = [
  { value: "list", label: "Basic list", sample: "Idea one\nIdea two\nIdea three\nIdea four" },
  { value: "process", label: "Process", sample: "Plan\nBuild\nTest\nShip" },
  { value: "cycle", label: "Cycle", sample: "Plan\nDo\nCheck\nAct" },
  { value: "hierarchy", label: "Hierarchy", sample: "CEO\n\tSales\n\t\tNorth\n\t\tSouth\n\tEngineering\n\tOperations" },
  { value: "pyramid", label: "Pyramid", sample: "Vision\nStrategy\nTactics\nOperations" },
  { value: "venn", label: "Venn", sample: "People\nProcess\nTechnology" },
];

export interface OutlineItem {
  text: string;
  level: number;
}

export interface OutlineNode {
  text: string;
  children: OutlineNode[];
}

/** Items the layouts can draw legibly. */
export const MAX_DIAGRAM_ITEMS = 40;

/**
 * Parse an outline: one item per non-blank line; the level is the number of
 * leading tabs (or pairs of spaces), and a leading "-", "*" or "•" bullet is
 * dropped. Levels are clamped so an item is at most one deeper than the one
 * before it (the first item is level 0).
 */
export function parseOutline(text: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) continue;
    const m = /^([\t ]*)(?:[-*•]\s+)?(.*)$/.exec(raw)!;
    const ws = m[1].replace(/ {2}/g, "\t").replace(/ /g, "");
    const want = ws.length;
    const prev = out.length ? out[out.length - 1].level : -1;
    out.push({ text: m[2].trim(), level: Math.max(0, Math.min(want, prev + 1)) });
    if (out.length >= MAX_DIAGRAM_ITEMS) break;
  }
  return out;
}

/** The outline text for items (tabs for levels). */
export function formatOutline(items: readonly OutlineItem[]): string {
  return items.map((i) => "\t".repeat(i.level) + i.text).join("\n");
}

/** Items as a forest (level-0 roots with their sub-items). */
export function outlineTree(items: readonly OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: { node: OutlineNode; level: number }[] = [];
  for (const it of items) {
    const node: OutlineNode = { text: it.text, children: [] };
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ node, level: it.level });
  }
  return roots;
}

// ------------------------------------------------------------ builders

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

class Builder {
  els: SlideElement[] = [];
  constructor(readonly theme: DeckTheme) {}
  color(ref: string): string {
    return resolveRef(ref, this.theme) ?? "#4472c4";
  }
  shape(preset: string, b: Box, fillRef: string, extra: Partial<SlideElement> = {}): SlideElement {
    const el: SlideElement = {
      id: uid(),
      type: "shape",
      preset,
      x: r1(b.x),
      y: r1(b.y),
      w: r1(Math.max(1, b.w)),
      h: r1(Math.max(1, b.h)),
      fill: this.color(fillRef),
      stroke: this.color("lt1"),
      strokeWidth: 1.5,
      themeRefs: { fill: fillRef, stroke: "lt1" },
      ...extra,
    };
    this.els.push(el);
    return el;
  }
  text(t: string, b: Box, opts: { size?: number; colorRef?: string; align?: "left" | "center"; valign?: "top" | "middle" } = {}): void {
    if (!t) return;
    const colorRef = opts.colorRef ?? "lt1";
    this.els.push({
      id: uid(),
      type: "text",
      x: r1(b.x),
      y: r1(b.y),
      w: r1(Math.max(1, b.w)),
      h: r1(Math.max(1, b.h)),
      text: t,
      fontSize: opts.size ?? fitFont(t, b),
      color: this.color(colorRef),
      fontFamily: this.theme.fonts.minor,
      align: opts.align ?? "center",
      valign: opts.valign ?? "middle",
      themeRefs: { color: colorRef, font: "minor" },
    });
  }
  line(from: [number, number], to: [number, number]): void {
    const ref = "tx1/lumMod:50000/lumOff:50000";
    this.els.push({
      ...newConnector("straightConnector1", { from, to }),
      stroke: this.color(ref),
      strokeWidth: 1.5,
      themeRefs: { stroke: ref },
    });
  }
}

/** A font size (px) that fits `t` into box b: bounded by the height per
 *  line and a rough width per character. */
export function fitFont(t: string, b: Pick<Box, "w" | "h">, max = 28, min = 9): number {
  const lines = t.split("\n");
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const byW = (b.w * 0.9) / (longest * 0.55);
  const byH = (b.h * 0.8) / (lines.length * 1.25);
  return Math.round(Math.max(min, Math.min(max, byW, byH)));
}

const accent = (i: number) => `accent${(i % 6) + 1}`;
const nodeText = (n: OutlineNode) => [n.text, ...n.children.map((c) => `• ${c.text}`)].join("\n");

function buildList(b: Builder, roots: OutlineNode[], box: Box) {
  const n = roots.length;
  const cols = Math.min(n, Math.max(1, Math.round(Math.sqrt((n * box.w) / box.h / 1.6))));
  const rows = Math.ceil(n / cols);
  const gap = Math.min(box.w, box.h) * 0.04;
  const cw = (box.w - gap * (cols - 1)) / cols;
  const ch = (box.h - gap * (rows - 1)) / rows;
  roots.forEach((node, i) => {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const offset = ((cols - inRow) * (cw + gap)) / 2;
    const cell = { x: box.x + offset + (i % cols) * (cw + gap), y: box.y + r * (ch + gap), w: cw, h: ch };
    b.shape("roundRect", cell, "accent1", { adj: { adj: 10000 } });
    b.text(nodeText(node), inset(cell, 6));
  });
}

function buildProcess(b: Builder, roots: OutlineNode[], box: Box) {
  const n = roots.length;
  const gapW = n > 1 ? Math.min(60, (box.w / n) * 0.3) : 0;
  const bw = (box.w - gapW * (n - 1)) / n;
  const bh = Math.min(box.h, bw * 0.7);
  const y = box.y + (box.h - bh) / 2;
  roots.forEach((node, i) => {
    const x = box.x + i * (bw + gapW);
    const cell = { x, y, w: bw, h: bh };
    b.shape("roundRect", cell, "accent1", { adj: { adj: 10000 } });
    b.text(nodeText(node), inset(cell, 6));
    if (i < n - 1) {
      const aw = gapW * 0.7;
      const ah = Math.min(bh * 0.35, aw * 1.2);
      b.shape("rightArrow", { x: x + bw + (gapW - aw) / 2, y: y + (bh - ah) / 2, w: aw, h: ah }, "accent1/lumMod:60000/lumOff:40000", {
        stroke: "none",
        strokeWidth: 0,
        themeRefs: { fill: "accent1/lumMod:60000/lumOff:40000" },
      });
    }
  });
}

function buildCycle(b: Builder, roots: OutlineNode[], box: Box) {
  const n = roots.length;
  const side = Math.min(box.w, box.h);
  const d = n === 1 ? side * 0.6 : Math.min(side * 0.34, (Math.PI * side) / (n * 1.6));
  const R = (side - d) / 2;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const at = (k: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)] as const;
  };
  roots.forEach((node, i) => {
    const [px, py] = at(i);
    const cell = { x: px - d / 2, y: py - d / 2, w: d, h: d };
    b.shape("ellipse", cell, accent(i));
    b.text(nodeText(node), inset(cell, d * 0.15));
  });
  if (n < 2) return;
  for (let i = 0; i < n; i++) {
    const mid = -90 + (360 * (i + 0.5)) / n;
    const a = (mid * Math.PI) / 180;
    const aw = d * 0.3;
    const ah = d * 0.22;
    const mx = cx + R * Math.cos(a);
    const my = cy + R * Math.sin(a);
    b.shape("rightArrow", { x: mx - aw / 2, y: my - ah / 2, w: aw, h: ah }, "accent1/lumMod:60000/lumOff:40000", {
      rotation: Math.round((mid + 90) * 10) / 10,
      stroke: "none",
      strokeWidth: 0,
      themeRefs: { fill: "accent1/lumMod:60000/lumOff:40000" },
    });
  }
}

interface Laid {
  node: OutlineNode;
  depth: number;
  x: number; // centre, in leaf units
}

function layoutTree(roots: OutlineNode[]): { laid: Laid[]; leaves: number; depth: number; edges: [number, number[]][] } {
  const laid: Laid[] = [];
  const edges: [number, number[]][] = [];
  let leaf = 0;
  let depth = 0;
  const walk = (node: OutlineNode, d: number): number => {
    depth = Math.max(depth, d + 1);
    const idx = laid.length;
    laid.push({ node, depth: d, x: 0 });
    if (!node.children.length) {
      laid[idx].x = leaf++ + 0.5;
      return idx;
    }
    const kids = node.children.map((c) => walk(c, d + 1));
    laid[idx].x = (laid[kids[0]].x + laid[kids[kids.length - 1]].x) / 2;
    edges.push([idx, kids]);
    return idx;
  };
  roots.forEach((r) => walk(r, 0));
  return { laid, leaves: Math.max(1, leaf), depth: Math.max(1, depth), edges };
}

function buildHierarchy(b: Builder, roots: OutlineNode[], box: Box) {
  const { laid, leaves, depth, edges } = layoutTree(roots);
  const colW = box.w / leaves;
  const rowH = box.h / depth;
  const nw = Math.min(colW * 0.86, 220);
  const nh = Math.min(rowH * 0.6, nw * 0.6);
  const center = (l: Laid) => [box.x + l.x * colW, box.y + l.depth * rowH + (rowH - nh) / 2] as const;
  // Connectors first, so the boxes sit on top of them.
  for (const [p, kids] of edges) {
    const [px, py] = center(laid[p]);
    const [, cy] = center(laid[kids[0]]);
    const midY = (py + nh + cy) / 2;
    b.line([px, py + nh], [px, midY]);
    const xs = kids.map((k) => center(laid[k])[0]);
    if (kids.length > 1) b.line([Math.min(...xs), midY], [Math.max(...xs), midY]);
    for (const x of xs) b.line([x, midY], [x, cy]);
  }
  laid.forEach((l) => {
    const [x, y] = center(l);
    const cell = { x: x - nw / 2, y, w: nw, h: nh };
    b.shape("roundRect", cell, l.depth === 0 ? "accent1" : `accent1/lumMod:${l.depth === 1 ? 75000 : 60000}/lumOff:${l.depth === 1 ? 25000 : 40000}`, {
      adj: { adj: 10000 },
    });
    b.text(l.node.text, inset(cell, 4));
  });
}

function buildPyramid(b: Builder, roots: OutlineNode[], box: Box) {
  const n = roots.length;
  const th = box.h / n;
  roots.forEach((node, i) => {
    const topW = (box.w * i) / n;
    const botW = (box.w * (i + 1)) / n;
    const y = box.y + i * th;
    const cell = { x: box.x + (box.w - botW) / 2, y, w: botW, h: th };
    if (i === 0) b.shape("triangle", cell, accent(i));
    else {
      const ss = Math.min(botW, th);
      const inset = (botW - topW) / 2;
      const maxAdj = (50000 * botW) / ss;
      b.shape("trapezoid", cell, accent(i), { adj: { adj: Math.round(Math.min(maxAdj, (inset * 100000) / ss)) } });
    }
    const textW = i === 0 ? botW * 0.5 : (topW + botW) / 2 * 0.8;
    const tb = { x: box.x + (box.w - textW) / 2, y: y + (i === 0 ? th * 0.35 : th * 0.1), w: textW, h: i === 0 ? th * 0.6 : th * 0.8 };
    b.text(nodeText(node), tb);
  });
}

function buildVenn(b: Builder, roots: OutlineNode[], box: Box) {
  const n = roots.length;
  const side = Math.min(box.w, box.h);
  const d = n === 1 ? side : n === 2 ? Math.min(side, box.w / 1.6) : side * 0.58;
  const R = n === 1 ? 0 : n === 2 ? d * 0.3 : d * 0.36;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const centres = roots.map((_, i) => {
    const a = n === 2 ? Math.PI * i : -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a), a] as const;
  });
  roots.forEach((_, i) => {
    const [x, y] = centres[i];
    const ref = `${accent(i)}/alpha:50000`;
    b.shape("ellipse", { x: x - d / 2, y: y - d / 2, w: d, h: d }, ref, { themeRefs: { fill: ref, stroke: "lt1" } });
  });
  roots.forEach((node, i) => {
    const [x, y, a] = centres[i];
    const off = n === 1 ? 0 : d * 0.2;
    const tw = d * 0.5;
    const tcx = x + off * Math.cos(a);
    const tcy = y + off * Math.sin(a);
    b.text(nodeText(node), { x: tcx - tw / 2, y: tcy - d * 0.18, w: tw, h: d * 0.36 }, { colorRef: "tx1" });
  });
}

function inset(b: Box, k: number): Box {
  return { x: b.x + k, y: b.y + k, w: Math.max(1, b.w - 2 * k), h: Math.max(1, b.h - 2 * k) };
}

/** The members a layout draws for an outline in `box` (absolute slide
 *  coordinates, as group members are stored). */
export function diagramMembers(layout: DiagramLayout, outline: string, box: Box, theme: DeckTheme): SlideElement[] {
  const items = parseOutline(outline);
  const b = new Builder(theme);
  // Layouts other than the hierarchy draw the top level and list the
  // sub-items inside their node.
  const roots = outlineTree(items.length ? items : [{ text: " ", level: 0 }]);
  switch (layout) {
    case "list":
      buildList(b, roots, box);
      break;
    case "process":
      buildProcess(b, roots, box);
      break;
    case "cycle":
      buildCycle(b, roots, box);
      break;
    case "hierarchy":
      buildHierarchy(b, roots, box);
      break;
    case "pyramid":
      buildPyramid(b, roots, box);
      break;
    case "venn":
      buildVenn(b, roots, box);
      break;
  }
  return b.els;
}

/** The default box of a new diagram (most of the content area). */
export function defaultDiagramBox(slide: { w: number; h: number }): Box {
  return { x: Math.round(slide.w * 0.1), y: Math.round(slide.h * 0.2), w: Math.round(slide.w * 0.8), h: Math.round(slide.h * 0.68) };
}

/** A new diagram group. */
export function newDiagram(layout: DiagramLayout, outline: string, box: Box, theme: DeckTheme): SlideElement {
  return {
    id: uid(),
    type: "group",
    ...box,
    name: `Diagram (${DIAGRAM_LAYOUTS.find((l) => l.value === layout)?.label ?? layout})`,
    diagram: { layout, outline },
    children: diagramMembers(layout, outline, box, theme),
  };
}

/** Rebuild a diagram group from a new outline and/or layout, inside its
 *  current box (it keeps its id, rotation, flips and name). */
export function rebuildDiagram(el: SlideElement, spec: Partial<DiagramSpec>, theme: DeckTheme): SlideElement {
  const prev = el.diagram ?? { layout: "list", outline: "" };
  const next: DiagramSpec = { layout: spec.layout ?? prev.layout, outline: spec.outline ?? prev.outline };
  const box = { x: el.x, y: el.y, w: el.w, h: el.h };
  return { ...el, diagram: next, children: diagramMembers(next.layout, next.outline, box, theme) };
}

