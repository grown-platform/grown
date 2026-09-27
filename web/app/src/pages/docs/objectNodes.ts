// Object nodes and views (Docs M7): inline pictures, preset shapes, text
// boxes and charts, plus the shared node view that draws every object —
// including the pre-M7 block `image` — with its wrapping style, crop,
// rotation, flips and selection handles (resize with aspect lock, rotate).
//
// Placement follows Word: an object is an inline node in the paragraph that
// anchors it. "In line" sits in the text; square / tight / through float
// beside the paragraph's text; top-and-bottom takes its own line; behind /
// in front are positioned absolutely against the paragraph and don't move
// text. In the paged view every top-level block is a block formatting
// context (M9), so a float stays inside its anchor paragraph and the
// paginator's DOM measurer sees its real height; absolutely positioned
// objects are left out of line measurement (paginationPlugin lineClusters).
//
// Shapes use the Slides preset geometry (ECMA-376 presets,
// slides/presetGeometry.ts via slides/shapeRender.ts); their text is the
// node's content. Charts keep their own data grid and draw with the Sheets
// chart renderer (chartMarkup.ts).

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import {
  DEFAULT_DIST,
  HANDLES,
  SHAPE_DEFAULTS,
  TEXTBOX_DEFAULTS,
  angleFrom,
  arrange,
  cropImageBox,
  defaultName,
  fitSize,
  isAbsolute,
  isFloat,
  isObjectType,
  objectAttributeSpecs,
  outerStyle,
  resizeBy,
  transformOf,
  validName,
  type ArrangeOp,
  type Handle,
} from "./objects";
import { isDataUrl, migrateDataUrl, naturalSize, storePicture } from "./docAssets";
import { shapeLayersMarkup } from "../slides/shapeRender";
import { evaluatePreset } from "../slides/presetGeometry";
import { isConnectorPreset } from "../slides/presetDefs";
import { chartAttr, chartOfAttr } from "./chartData";
import type { SlideChart, SlideElement } from "../slides/model";

// --- CSS -------------------------------------------------------------------------------

const OBJ_CSS = `
.ProseMirror .doc-obj { position: relative; box-sizing: border-box; line-height: normal; text-indent: 0; }
.ProseMirror .doc-obj-block { display: block; }
.ProseMirror .doc-obj-frame { position: relative; display: block; width: 100%; height: 100%; }
.ProseMirror .doc-obj-crop { position: absolute; inset: 0; overflow: hidden; display: block; }
.ProseMirror .doc-obj img.doc-obj-img { position: absolute; max-width: none; height: auto; display: block; user-select: none; -webkit-user-drag: none; }
.ProseMirror .doc-obj.doc-obj-natural { width: auto; height: auto; }
.ProseMirror .doc-obj.doc-obj-natural .doc-obj-crop { position: static; }
.ProseMirror .doc-obj.doc-obj-natural img.doc-obj-img { position: static; max-width: 100%; }
.ProseMirror .doc-obj-svg { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.ProseMirror .doc-shape-text { position: absolute; display: flex; flex-direction: column; overflow: hidden; padding: 4px 7px; box-sizing: border-box; white-space: pre-wrap; word-break: break-word; cursor: text; }
.ProseMirror .doc-shape-text[data-anchor="t"] { justify-content: flex-start; }
.ProseMirror .doc-shape-text[data-anchor="ctr"] { justify-content: center; }
.ProseMirror .doc-shape-text[data-anchor="b"] { justify-content: flex-end; }
.ProseMirror .doc-shape-text > .doc-shape-inner { display: block; outline: none; min-height: 1em; }
.ProseMirror .doc-obj[data-kind="shape"][data-connector="1"] .doc-shape-text { display: none; }
.ProseMirror .doc-chart-root { position: absolute; inset: 0; display: block; background: #fff; }
.ProseMirror .doc-chart-root svg { display: block; }
.ProseMirror .doc-obj-handles { position: absolute; inset: 0; display: none; pointer-events: none; outline: 1px solid #1a73e8; }
.ProseMirror .doc-obj.doc-obj-selected .doc-obj-handles, .ProseMirror .doc-obj.ProseMirror-selectednode .doc-obj-handles { display: block; }
.ProseMirror .doc-obj.ProseMirror-selectednode { outline: none; }
.ProseMirror .doc-obj-h { position: absolute; width: 8px; height: 8px; margin: -5px 0 0 -5px; background: #fff; border: 1px solid #1a73e8; border-radius: 50%; pointer-events: auto; box-sizing: content-box; }
.ProseMirror .doc-obj-h[data-h="nw"] { left: 0; top: 0; cursor: nwse-resize; }
.ProseMirror .doc-obj-h[data-h="n"] { left: 50%; top: 0; cursor: ns-resize; }
.ProseMirror .doc-obj-h[data-h="ne"] { left: 100%; top: 0; cursor: nesw-resize; }
.ProseMirror .doc-obj-h[data-h="e"] { left: 100%; top: 50%; cursor: ew-resize; }
.ProseMirror .doc-obj-h[data-h="se"] { left: 100%; top: 100%; cursor: nwse-resize; }
.ProseMirror .doc-obj-h[data-h="s"] { left: 50%; top: 100%; cursor: ns-resize; }
.ProseMirror .doc-obj-h[data-h="sw"] { left: 0; top: 100%; cursor: nesw-resize; }
.ProseMirror .doc-obj-h[data-h="w"] { left: 0; top: 50%; cursor: ew-resize; }
.ProseMirror .doc-obj-h[data-h="rot"] { left: 50%; top: -22px; cursor: grab; background: #1a73e8; }
.ProseMirror .doc-obj-abs { pointer-events: auto; }
.ProseMirror :is(p, h1, h2, h3, h4, h5, h6, li, td, th):has(.doc-obj-abs) { position: relative; }
.ProseMirror .doc-obj[data-wrap="behind"] { opacity: 0.999; }
.ProseMirror .doc-obj[data-alt-missing="1"] { }
`;

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === "undefined") return;
  cssDone = true;
  const s = document.createElement("style");
  s.setAttribute("data-grown", "objects");
  s.textContent = OBJ_CSS;
  document.head.appendChild(s);
}

// --- chart data ------------------------------------------------------------------------

/** A chart node's chart (the JSON attribute), normalised. */
export function chartOf(node: PMNode | { attrs: Record<string, unknown> }): SlideChart {
  return chartOfAttr(node.attrs.chart);
}

export { chartAttr };

// --- shape drawing -----------------------------------------------------------------------

/** The Slides element equivalent of a shape node (for the preset renderer). */
export function shapeElement(attrs: Record<string, unknown>, w: number, h: number): SlideElement {
  const prst = String(attrs.prst || "rect");
  const line = isConnectorPreset(prst);
  let adj: Record<string, number> | undefined;
  try {
    adj = attrs.adj ? (JSON.parse(String(attrs.adj)) as Record<string, number>) : undefined;
  } catch {
    adj = undefined;
  }
  const none = (c: unknown) => (c == null || c === "" || c === "none" ? "none" : String(c));
  return {
    id: "doc-shape",
    type: line ? "connector" : "shape",
    preset: prst,
    x: 0,
    y: 0,
    w,
    h,
    fill: none(attrs.fill),
    stroke: none(attrs.stroke),
    strokeWidth: attrs.strokeWidth != null ? Number(attrs.strokeWidth) : 1,
    ...(attrs.dash && attrs.dash !== "solid" ? { dash: attrs.dash as SlideElement["dash"] } : {}),
    ...(attrs.headEnd ? { headEnd: attrs.headEnd as SlideElement["headEnd"] } : {}),
    ...(attrs.tailEnd ? { tailEnd: attrs.tailEnd as SlideElement["tailEnd"] } : {}),
    ...(adj ? { adj } : {}),
  } as SlideElement;
}

/** The text rectangle of a shape (px inside its box). */
export function shapeTextRect(attrs: Record<string, unknown>, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const g = evaluatePreset(String(attrs.prst || "rect"), w, h);
  return g ? g.textRect : { x: 0, y: 0, w, h };
}

// --- node view -----------------------------------------------------------------------------

type Kind = "picture" | "shape" | "chart";
const kindOf = (name: string): Kind => (name === "chart" ? "chart" : name === "shape" || name === "textBox" ? "shape" : "picture");

let chartMod: Promise<typeof import("./chartMarkup")> | null = null;

class ObjectView implements NodeView {
  dom: HTMLElement;
  contentDOM?: HTMLElement;
  private frame: HTMLElement;
  private crop?: HTMLElement;
  private img?: HTMLImageElement;
  private svg?: SVGSVGElement;
  private textBox?: HTMLElement;
  private chartRoot?: HTMLElement;
  private handles: HTMLElement;
  private kind: Kind;
  private chartKey = "";
  private dragging = false;

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    injectCss();
    this.kind = kindOf(node.type.name);
    const block = node.type.name === "image";
    this.dom = document.createElement(block ? "div" : "span");
    this.dom.className = `doc-obj${block ? " doc-obj-block" : ""}`;
    this.dom.setAttribute("data-kind", this.kind);
    this.dom.setAttribute("data-type", node.type.name);
    this.frame = document.createElement("span");
    this.frame.className = "doc-obj-frame";
    this.dom.appendChild(this.frame);
    if (this.kind === "picture") {
      this.crop = document.createElement("span");
      this.crop.className = "doc-obj-crop";
      this.img = document.createElement("img");
      this.img.className = "doc-obj-img";
      this.img.draggable = false;
      this.img.addEventListener("load", () => {
        if (!this.node.attrs.width) this.layout();
      });
      this.crop.appendChild(this.img);
      this.frame.appendChild(this.crop);
      this.dom.contentEditable = "false";
    } else if (this.kind === "shape") {
      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.svg.setAttribute("class", "doc-obj-svg");
      this.svg.setAttribute("contenteditable", "false");
      this.frame.appendChild(this.svg);
      this.textBox = document.createElement("span");
      this.textBox.className = "doc-shape-text";
      const inner = document.createElement("span");
      inner.className = "doc-shape-inner";
      this.textBox.appendChild(inner);
      this.frame.appendChild(this.textBox);
      this.contentDOM = inner;
      // A press on the outline (not the text) selects the shape itself.
      this.frame.addEventListener("mousedown", (e) => {
        if (this.textBox!.contains(e.target as globalThis.Node)) return;
        if ((e.target as HTMLElement).closest(".doc-obj-h")) return;
        e.preventDefault();
        this.selectSelf();
      });
    } else {
      this.chartRoot = document.createElement("span");
      this.chartRoot.className = "doc-chart-root";
      this.frame.appendChild(this.chartRoot);
      this.dom.contentEditable = "false";
      this.dom.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const pos = this.getPos();
        if (pos != null && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("grown-docs-chart-edit", { detail: { pos } }));
      });
    }
    this.handles = document.createElement("span");
    this.handles.className = "doc-obj-handles";
    this.handles.setAttribute("contenteditable", "false");
    for (const h of [...HANDLES, "rot"] as (Handle | "rot")[]) {
      const el = document.createElement("span");
      el.className = "doc-obj-h";
      el.setAttribute("data-h", h);
      el.addEventListener("pointerdown", (e) => this.startDrag(e, h));
      this.handles.appendChild(el);
    }
    this.frame.appendChild(this.handles);
    if (this.kind === "picture") {
      this.dom.addEventListener("dblclick", () => {
        const pos = this.getPos();
        if (pos != null && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("grown-docs-object-settings", { detail: { pos } }));
      });
    }
    this.layout();
  }

  private selectSelf() {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
    this.view.focus();
  }

  private layout() {
    const a = this.node.attrs as Record<string, unknown>;
    const w = Number(a.width) || 0;
    const h = Number(a.height) || 0;
    const block = this.node.type.name === "image";
    const s = outerStyle(a, block);
    this.dom.style.cssText = Object.entries(s)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    this.dom.setAttribute("data-wrap", String(a.wrap ?? "inline"));
    this.dom.classList.toggle("doc-obj-abs", isAbsolute(String(a.wrap)));
    this.dom.classList.toggle("doc-obj-float", isFloat(String(a.wrap)));
    this.frame.style.transform = transformOf(a);
    if (a.name) this.dom.setAttribute("data-name", String(a.name));
    else this.dom.removeAttribute("data-name");
    if (this.kind === "picture" && this.img) {
      const src = String(a.src ?? "");
      if (this.img.getAttribute("src") !== src) this.img.setAttribute("src", src);
      this.img.alt = String(a.alt ?? "");
      if (a.title) this.img.title = String(a.title);
      const natural = !w || !h;
      this.dom.classList.toggle("doc-obj-natural", natural);
      if (natural) {
        this.img.style.cssText = w ? `width: ${w}px` : "";
      } else {
        const box = cropImageBox(w, h, a);
        this.img.style.cssText = `left: ${box.left}px; top: ${box.top}px; width: ${box.width}px; height: ${box.height}px`;
      }
      // tight / through wrap follow the picture's outline.
      if ((a.wrap === "tight" || a.wrap === "through") && src && !/^javascript:/i.test(src)) {
        this.dom.style.setProperty("shape-outside", `url("${src.replace(/"/g, "%22")}")`);
        this.dom.style.setProperty("shape-image-threshold", "0.3");
        this.dom.style.setProperty("shape-margin", `${a.dist != null ? Number(a.dist) : DEFAULT_DIST}px`);
      }
    } else if (this.kind === "shape" && this.svg && this.textBox) {
      const W = w || 160;
      const H = h || 100;
      if (!w || !h) {
        this.dom.style.width = `${W}px`;
        this.dom.style.height = `${H}px`;
      }
      const el = shapeElement(a, W, H);
      this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      this.svg.setAttribute("width", String(W));
      this.svg.setAttribute("height", String(H));
      this.svg.innerHTML = shapeLayersMarkup(el);
      this.dom.setAttribute("data-connector", el.type === "connector" ? "1" : "0");
      const tr = shapeTextRect(a, W, H);
      this.textBox.style.left = `${tr.x}px`;
      this.textBox.style.top = `${tr.y}px`;
      this.textBox.style.width = `${Math.max(0, tr.w)}px`;
      this.textBox.style.height = `${Math.max(0, tr.h)}px`;
      this.textBox.setAttribute("data-anchor", String(a.textAnchor || "ctr"));
      this.textBox.style.color = String(a.textColor || "");
    } else if (this.kind === "chart" && this.chartRoot) {
      const W = w || 480;
      const H = h || 300;
      if (!w || !h) {
        this.dom.style.width = `${W}px`;
        this.dom.style.height = `${H}px`;
      }
      const key = `${a.chart}|${W}|${H}`;
      if (key !== this.chartKey) {
        this.chartKey = key;
        const chart = chartOf(this.node);
        chartMod ??= import("./chartMarkup");
        chartMod
          .then((m) => {
            if (this.chartKey === key && this.chartRoot) this.chartRoot.innerHTML = m.chartMarkup(chart, W, H);
          })
          .catch(() => {
            /* keep the empty frame */
          });
      }
    }
  }

  private scale(): number {
    const root = this.view.dom as HTMLElement;
    return root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth || 1 : 1;
  }

  private startDrag(e: PointerEvent, handle: Handle | "rot") {
    if (!this.view.editable) return;
    e.preventDefault();
    e.stopPropagation();
    const k = this.scale();
    const rect = this.dom.getBoundingClientRect();
    const start = {
      w: Number(this.node.attrs.width) || rect.width / k,
      h: Number(this.node.attrs.height) || rect.height / k,
    };
    const x0 = e.clientX;
    const y0 = e.clientY;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const lock = this.node.attrs.lockAspect !== false;
    let next: Record<string, unknown> = {};
    this.dragging = true;
    const move = (ev: PointerEvent) => {
      if (handle === "rot") {
        const rot = angleFrom(cx, cy, ev.clientX, ev.clientY, ev.shiftKey);
        next = { rotate: rot };
        this.frame.style.transform = transformOf({ ...this.node.attrs, rotate: rot });
        return;
      }
      const lockNow = ev.shiftKey ? !lock : lock;
      const s = resizeBy(start, handle, (ev.clientX - x0) / k, (ev.clientY - y0) / k, lockNow);
      next = { width: s.w, height: s.h };
      this.dom.style.width = `${s.w}px`;
      this.dom.style.height = `${s.h}px`;
      this.dom.classList.remove("doc-obj-natural");
      if (this.img && this.kind === "picture") {
        const box = cropImageBox(s.w, s.h, this.node.attrs);
        this.img.style.cssText = `left: ${box.left}px; top: ${box.top}px; width: ${box.width}px; height: ${box.height}px`;
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.dragging = false;
      const pos = this.getPos();
      if (pos != null && Object.keys(next).length) updateObjectAt(this.view, pos, next);
      else this.layout();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.dragging) this.layout();
    return true;
  }

  selectNode() {
    this.dom.classList.add("doc-obj-selected", "ProseMirror-selectednode");
  }

  deselectNode() {
    this.dom.classList.remove("doc-obj-selected", "ProseMirror-selectednode");
  }

  stopEvent(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t?.closest?.(".doc-obj-h");
  }

  ignoreMutation(m: MutationRecord | { type: "selection"; target: globalThis.Node }): boolean {
    if (m.type === "selection") return this.kind !== "shape";
    if (this.contentDOM && this.contentDOM.contains(m.target)) return false;
    return true;
  }

  destroy() {
    this.chartRoot?.replaceChildren();
  }
}

/** The node view factory every object node uses. */
export function objectNodeView(_editor?: Editor) {
  return ({ node, view, getPos }: { node: PMNode; view: EditorView; getPos: () => number | undefined }) =>
    new ObjectView(node, view, getPos as () => number | undefined);
}

// --- nodes --------------------------------------------------------------------------------

const sizeAttrs = {
  width: {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const v = parseFloat(el.getAttribute("width") ?? el.getAttribute("data-width") ?? "");
      return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
    },
    renderHTML: (a: Record<string, unknown>) => (a.width ? { "data-width": String(a.width) } : {}),
  },
  height: {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const v = parseFloat(el.getAttribute("data-height") ?? el.getAttribute("height") ?? "");
      return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
    },
    renderHTML: (a: Record<string, unknown>) => (a.height ? { "data-height": String(a.height) } : {}),
  },
};

/** A picture inside a paragraph (Word's inline or anchored picture). */
export const InlineImage = Node.create({
  name: "inlineImage",
  inline: true,
  group: "inline",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: null, parseHTML: (el) => el.getAttribute("src"), renderHTML: (a) => (a.src ? { src: a.src } : {}) },
      alt: { default: null, parseHTML: (el) => el.getAttribute("alt"), renderHTML: (a) => (a.alt ? { alt: a.alt } : {}) },
      title: { default: null, parseHTML: (el) => el.getAttribute("title"), renderHTML: (a) => (a.title ? { title: a.title } : {}) },
      width: {
        default: null,
        parseHTML: (el) => {
          const v = parseFloat(el.getAttribute("width") ?? "");
          return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
        },
        renderHTML: (a) => (a.width ? { width: String(a.width) } : {}),
      },
      height: sizeAttrs.height,
      ...objectAttributeSpecs(),
    };
  },
  parseHTML() {
    return [{ tag: "img[data-o-inline]", priority: 60 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes, { "data-o-inline": "1" })];
  },
  addNodeView() {
    return objectNodeView(this.editor) as never;
  },
});

function shapeNode(name: "shape" | "textBox") {
  const d = name === "textBox" ? TEXTBOX_DEFAULTS : SHAPE_DEFAULTS;
  return Node.create({
    name,
    inline: true,
    group: "inline",
    content: "(text | hardBreak)*",
    draggable: true,
    selectable: true,
    isolating: true,
    addAttributes() {
      const str = (k: string, def: unknown) => ({
        default: def,
        parseHTML: (el: HTMLElement) => el.getAttribute(`data-${k.toLowerCase()}`) ?? def,
        renderHTML: (a: Record<string, unknown>) => (a[k] != null && a[k] !== def ? { [`data-${k.toLowerCase()}`]: String(a[k]) } : {}),
      });
      return {
        prst: str("prst", "rect"),
        adj: str("adj", null),
        fill: str("fill", d.fill),
        stroke: str("stroke", d.stroke),
        strokeWidth: {
          default: d.strokeWidth,
          parseHTML: (el: HTMLElement) => {
            const v = parseFloat(el.getAttribute("data-strokewidth") ?? "");
            return Number.isFinite(v) ? v : d.strokeWidth;
          },
          renderHTML: (a: Record<string, unknown>) => (a.strokeWidth !== d.strokeWidth ? { "data-strokewidth": String(a.strokeWidth) } : {}),
        },
        dash: str("dash", "solid"),
        headEnd: str("headEnd", null),
        tailEnd: str("tailEnd", null),
        textAnchor: str("textAnchor", name === "textBox" ? "t" : "ctr"),
        textColor: str("textColor", d.textColor || null),
      alt: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-alt"), renderHTML: (a: Record<string, unknown>) => (a.alt ? { "data-alt": String(a.alt) } : {}) },
        ...sizeAttrs,
        ...objectAttributeSpecs(),
        wrap: { ...objectAttributeSpecs().wrap, default: "square" },
        lockAspect: { ...objectAttributeSpecs().lockAspect, default: false },
      };
    },
    parseHTML() {
      return [{ tag: `span.doc-shape[data-type="${name}"]`, contentElement: ".doc-shape-content" }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes, { class: "doc-shape", "data-type": name }), ["span", { class: "doc-shape-content" }, 0]];
    },
    addNodeView() {
      return objectNodeView(this.editor) as never;
    },
  });
}

/** A preset shape with text (wps:wsp). */
export const ShapeNode = shapeNode("shape");
/** A text box (wps:wsp with txbx). */
export const TextBoxNode = shapeNode("textBox");

/** A chart with its own data grid (c:chart). */
export const ChartNode = Node.create({
  name: "chart",
  inline: true,
  group: "inline",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      chart: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-chart") ?? "",
        renderHTML: (a) => (a.chart ? { "data-chart": String(a.chart) } : {}),
      },
      alt: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-alt"), renderHTML: (a: Record<string, unknown>) => (a.alt ? { "data-alt": String(a.alt) } : {}) },
      ...sizeAttrs,
      ...objectAttributeSpecs(),
    };
  },
  parseHTML() {
    return [{ tag: "span.doc-chart[data-chart]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "doc-chart" })];
  },
  addNodeView() {
    return objectNodeView(this.editor) as never;
  },
});

export const OBJECT_NODES = [InlineImage, ShapeNode, TextBoxNode, ChartNode];

// --- operations ------------------------------------------------------------------------------

export interface ObjectHit {
  node: PMNode;
  pos: number;
}

/** The selected object: a node selection on one, or the shape / text box
 *  whose text holds the caret. */
export function selectedObject(state: EditorState): ObjectHit | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && isObjectType(sel.node.type.name)) return { node: sel.node, pos: sel.from };
  const $f = sel.$from;
  for (let d = $f.depth; d > 0; d--) {
    const n = $f.node(d);
    if (n.type.name === "shape" || n.type.name === "textBox") return { node: n, pos: $f.before(d) };
  }
  return null;
}

/** Every object in the document, in order. */
export function allObjects(doc: PMNode): ObjectHit[] {
  const out: ObjectHit[] = [];
  doc.descendants((n, pos) => {
    if (isObjectType(n.type.name)) out.push({ node: n, pos });
    return true;
  });
  return out;
}

function takenNames(doc: PMNode, except?: number): string[] {
  return allObjects(doc)
    .filter((o) => o.pos !== except && o.node.attrs.name)
    .map((o) => String(o.node.attrs.name));
}

/** Merge `patch` into the object at `pos`. A pre-M7 block picture given a
 *  floating or positioned wrap moves into the next paragraph as an inline
 *  picture (Word anchors every float in a paragraph). A data: URL picture
 *  that is edited is migrated to the asset store. */
export function updateObjectAt(view: EditorView, pos: number, patch: Record<string, unknown>): boolean {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node || !isObjectType(node.type.name)) return false;
  const attrs = { ...node.attrs, ...patch };
  const tr = state.tr;
  const inlineType = state.schema.nodes.inlineImage;
  if (node.type.name === "image" && inlineType && attrs.wrap !== "inline" && attrs.wrap !== "topBottom") {
    const inl = inlineType.create(pickAttrs(inlineType, attrs));
    const $p = state.doc.resolve(pos);
    const after = pos + node.nodeSize;
    const next = $p.depth === 0 || $p.parent.canReplaceWith($p.index(), $p.index() + 1, state.schema.nodes.paragraph) ? state.doc.nodeAt(after) : null;
    if (next && next.isTextblock && next.type.name === "paragraph") {
      tr.insert(after + 1, inl);
      tr.delete(pos, after);
      tr.setSelection(NodeSelection.create(tr.doc, pos + 1));
    } else {
      tr.replaceWith(pos, after, state.schema.nodes.paragraph.create(null, inl));
      tr.setSelection(NodeSelection.create(tr.doc, pos + 1));
    }
  } else {
    tr.setNodeMarkup(pos, undefined, attrs);
    if (state.selection instanceof NodeSelection && state.selection.from === pos) tr.setSelection(NodeSelection.create(tr.doc, pos));
  }
  view.dispatch(tr);
  const src = String(attrs.src ?? "");
  if (isDataUrl(src)) void migrateDataUrl(view, src);
  return true;
}

function pickAttrs(type: { spec: { attrs?: Record<string, unknown> } }, attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(type.spec.attrs ?? {})) if (k in attrs) out[k] = attrs[k];
  return out;
}

/** Insert an object node at the selection: inline in a paragraph (a new
 *  paragraph when the selection isn't in one). The object is selected and
 *  gets a unique default name. */
export function insertObject(editor: Editor, type: string, attrs: Record<string, unknown>, content?: PMNode[]): number | null {
  const { state, view } = editor;
  const nt = state.schema.nodes[type];
  if (!nt) return null;
  const name = validName(attrs.name) ? attrs.name : defaultName(type, takenNames(state.doc));
  const node = nt.create({ ...attrs, name }, content ?? null);
  let tr = state.tr;
  // A selected object isn't replaced: the new one goes right after it.
  if (state.selection instanceof NodeSelection && isObjectType(state.selection.node.type.name))
    tr.setSelection(TextSelection.create(state.doc, state.selection.to));
  const sel = tr.selection;
  let pos: number;
  if (sel.$from.parent.inlineContent && sel.$from.parent.type.contentMatch.matchType(nt) !== null && sel.$from.parent.canReplaceWith(sel.$from.index(), sel.$to.index(), nt)) {
    tr = tr.replaceSelectionWith(node, false);
    pos = tr.mapping.map(sel.from, -1);
    const found = tr.doc.nodeAt(pos);
    if (!found || found.type !== nt) pos = tr.selection.from - node.nodeSize;
  } else {
    const at = sel.$to.depth ? sel.$to.after(1) : sel.to;
    tr = tr.insert(at, state.schema.nodes.paragraph.create(null, node));
    pos = at + 1;
  }
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr.scrollIntoView());
  return pos;
}

/** Content width available to a picture (px). */
function columnWidth(editor: Editor): number {
  const el = editor.view.dom as HTMLElement;
  return el.clientWidth || 624;
}

/** Insert a picture from a src (asset URL, data: URL or http URL), sized to
 *  its natural size but at most the column width. */
export async function insertPictureSrc(editor: Editor, src: string, extra: Record<string, unknown> = {}): Promise<number | null> {
  const nat = await naturalSize(src);
  const size = nat ? fitSize(nat, columnWidth(editor)) : {};
  return insertObject(editor, "inlineImage", { src, ...size, ...extra });
}

/** Insert a picture file: uploaded to the document's asset store (a data:
 *  URL when that fails). */
export async function insertPictureFile(editor: Editor, file: Blob): Promise<number | null> {
  const src = await storePicture(editor.view, file);
  return insertPictureSrc(editor, src);
}

/** Replace a picture's image, keeping its width (height follows the new
 *  picture's proportions) and every other setting. */
export async function replacePicture(editor: Editor, pos: number, file: Blob): Promise<boolean> {
  const src = await storePicture(editor.view, file);
  const node = editor.state.doc.nodeAt(pos);
  if (!node || (node.type.name !== "image" && node.type.name !== "inlineImage")) return false;
  const nat = await naturalSize(src);
  const w = Number(node.attrs.width) || 0;
  const patch: Record<string, unknown> = { src, cropL: 0, cropT: 0, cropR: 0, cropB: 0 };
  if (nat && w) patch.height = Math.max(1, Math.round((w * nat.height) / nat.width));
  return updateObjectAt(editor.view, pos, patch);
}

/** Set an object's name. Empty / non-string names are refused; a name
 *  another object has passes to this one and the other gets a new default
 *  name (OnlyOffice's SetName). */
export function setObjectName(view: EditorView, pos: number, name: unknown): boolean {
  if (!validName(name)) return false;
  const node = view.state.doc.nodeAt(pos);
  if (!node || !isObjectType(node.type.name)) return false;
  const tr = view.state.tr;
  const others = allObjects(view.state.doc).filter((o) => o.pos !== pos);
  const taken = new Set(others.map((o) => String(o.node.attrs.name ?? "")));
  taken.add(name);
  for (const o of others)
    if (o.node.attrs.name === name) {
      const fresh = defaultName(o.node.type.name, taken);
      taken.add(fresh);
      tr.setNodeMarkup(o.pos, undefined, { ...o.node.attrs, name: fresh });
    }
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, name });
  view.dispatch(tr);
  return true;
}

/** Bring an object forward / to front, or send it backward / to back. */
export function arrangeObject(view: EditorView, pos: number, op: ArrangeOp): boolean {
  const objs = allObjects(view.state.doc);
  const i = objs.findIndex((o) => o.pos === pos);
  if (i < 0) return false;
  const z = arrange(
    objs.map((o, k) => ({ id: k, z: Number(o.node.attrs.z) || 0 })),
    i,
    op,
  );
  const tr = view.state.tr;
  objs.forEach((o, k) => {
    const nz = z.get(k);
    if (nz != null && nz !== o.node.attrs.z) tr.setNodeMarkup(o.pos, undefined, { ...o.node.attrs, z: nz });
  });
  if (view.state.selection instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, view.state.selection.from));
  view.dispatch(tr);
  return true;
}

/** Select an object (OnlyOffice's Select). */
export function selectObject(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || !isObjectType(node.type.name)) return false;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  return true;
}

/** Unselect the selected object: the caret goes just after it. */
export function unselectObject(view: EditorView): boolean {
  const hit = selectedObject(view.state);
  if (!hit) return false;
  const after = Math.min(view.state.doc.content.size, hit.pos + hit.node.nodeSize);
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(after))));
  return true;
}

/** Insert a shape (or a text box) of preset `prst`. */
export function insertShape(editor: Editor, prst: string, opts: { textBox?: boolean; width?: number; height?: number; text?: string; attrs?: Record<string, unknown> } = {}): number | null {
  const type = opts.textBox ? "textBox" : "shape";
  const line = isConnectorPreset(prst);
  const content = opts.text ? [editor.schema.text(opts.text)] : undefined;
  return insertObject(
    editor,
    type,
    { prst, width: opts.width ?? (opts.textBox ? 240 : line ? 200 : 180), height: opts.height ?? (opts.textBox ? 90 : line ? 0.01 : 120), ...(line ? { fill: "none" } : {}), ...(opts.attrs ?? {}) },
    content as never,
  );
}

/** Insert a chart. */
export function insertChart(editor: Editor, chart: SlideChart, size = { width: 480, height: 300 }): number | null {
  return insertObject(editor, "chart", { chart: chartAttr(chart), ...size, wrap: "inline" });
}
