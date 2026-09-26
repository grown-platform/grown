// Editor wiring for styles and numbering (Docs M3).
//
// DocModel binds the `styles` and `numbering` Yjs maps (styles.ts,
// numbering.ts) to a TipTap editor:
//   * attributes: styleId, numId, numLvl on paragraphs/headings, and the
//     charStyle mark;
//   * a plugin that draws list labels as node decorations and keeps a
//     generated <style> element (style CSS + label CSS) up to date;
//   * keys: Enter applies a style's "next" style and ends empty list
//     paragraphs; Tab / Shift+Tab change list level; Backspace at the start
//     of a numbered paragraph removes its number; Ctrl+Alt+0-6 apply
//     Normal / Heading 1-6 through the style model;
//   * autocorrect: "1.1. ", "1) ", "1)1) ", "a. ", "a) ", "A. ", "A) ",
//     "i. ", "I. " start lists; "5. " / "e) " continue the list above.
//     "1. ", "- ", "* ", "+ " keep TipTap's list input rules.
//
// Operations are plain functions over an Editor (applyStyle,
// applyListPreset, ...) so menus, the toolbar and tests share them.
import { Extension, InputRule, Mark, type Editor } from "@tiptap/core";
import { DOMSerializer, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import * as Y from "yjs";
import {
  StyleSheet,
  NORMAL,
  compileParaPr,
  compileStyle,
  displayStyle,
  headingLevelOf,
  headingStyleId,
  marksRunPr,
  paragraphStyleId,
  runPrCss,
  paraPrCss,
  styleCss,
  styleDeclarations,
  type CompiledParaPr,
  type ParaPr,
  type RunPr,
  type StyleDef,
  type StyleType,
} from "./styles";
import {
  AUTOCORRECT_PRESETS,
  MAX_LEVELS,
  NumberingStore,
  computeNumbering,
  levelParaPr,
  linkHeadings,
  parseNumber,
  presetById,
  type LvlDef,
  type NumFmt,
  type NumLabel,
} from "./numbering";
import { selectedBlocks } from "./paragraphFormat";
import { directProps, propsToAttrs, type DirectParaProps } from "./paragraphProps";

export interface DocModelStorage {
  sheet: StyleSheet;
  numbering: NumberingStore;
  /** Bumped on every styles/numbering change (UI re-render key). */
  version: number;
}

export const docModelKey = new PluginKey<{ labels: Map<number, NumLabel>; deco: DecorationSet }>("docModel");

/** getDocModel returns the editor's style sheet and numbering store. */
export function getDocModel(editor: Editor): DocModelStorage {
  return (editor.storage as unknown as Record<string, DocModelStorage>).docModel;
}

/** numberingLabels returns the current labels (position -> label). */
export function numberingLabels(state: EditorState): Map<number, NumLabel> {
  return docModelKey.getState(state)?.labels ?? new Map();
}

let scopeSeq = 0;

// Label CSS: the number sits in the hanging indent.
const LABEL_CSS = (scope: string) => `
${scope} .doc-num::before {
  content: attr(data-num);
  display: inline-block;
  box-sizing: border-box;
  min-width: var(--num-w, 0);
  padding-right: 0.35em;
  text-indent: 0;
  white-space: pre;
}
${scope} .doc-num[data-num-suffix="space"]::before { padding-right: 0; }
${scope} [data-page-break-before] { border-top: 1px dotted #c7d2fe; }
@media print { ${scope} [data-page-break-before] { border-top: none; } }`;

// --- the extension ---------------------------------------------------------------------

export const CharStyle = Mark.create({
  name: "charStyle",
  addAttributes() {
    return {
      styleId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-cstyle"),
        renderHTML: (a) => (a.styleId ? { "data-cstyle": String(a.styleId) } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-cstyle]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },
});

export const DocModel = Extension.create<{ ydoc?: Y.Doc }, DocModelStorage>({
  name: "docModel",
  priority: 150,
  addOptions() {
    return { ydoc: undefined };
  },
  addStorage() {
    const ydoc = this.options.ydoc ?? new Y.Doc();
    return {
      sheet: new StyleSheet(ydoc.getMap("styles")),
      numbering: new NumberingStore(ydoc.getMap("numbering")),
      version: 0,
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          styleId: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).getAttribute("data-style") || null,
            renderHTML: (a) => (a.styleId ? { "data-style": String(a.styleId) } : {}),
          },
          numId: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).getAttribute("data-num-id") || null,
            renderHTML: (a) => (a.numId ? { "data-num-id": String(a.numId) } : {}),
          },
          numLvl: {
            default: null,
            parseHTML: (el) => {
              const v = parseInt((el as HTMLElement).getAttribute("data-num-lvl") ?? "", 10);
              return Number.isFinite(v) ? v : null;
            },
            renderHTML: (a) => (a.numLvl != null ? { "data-num-lvl": String(a.numLvl) } : {}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    const scopeId = `dm${++scopeSeq}`;
    const scope = `.ProseMirror[data-docmodel="${scopeId}"]`;
    const build = (doc: PMNode) => {
      const labels = computeNumbering(doc, storage.sheet, storage.numbering);
      const decos: Decoration[] = [];
      const lvlPr = levelParaPr(storage.numbering);
      for (const [pos, l] of labels) {
        const node = doc.nodeAt(pos);
        if (!node) continue;
        const c = compileParaPr(storage.sheet, node, lvlPr);
        const suffix = l.def.suffix ?? "tab";
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "doc-num",
            "data-num": suffix === "space" ? `${l.text} ` : l.text,
            "data-num-suffix": suffix,
            style: `margin-left: ${c.indLeft}pt; text-indent: ${c.indFirstLine}pt; --num-w: ${suffix === "tab" ? Math.max(0, -c.indFirstLine) : 0}pt`,
          }),
        );
      }
      return { labels, deco: DecorationSet.create(doc, decos) };
    };
    return [
      new Plugin({
        key: docModelKey,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, prev, _old, state) =>
            tr.docChanged || tr.getMeta(docModelKey) ? build(state.doc) : prev,
        },
        props: {
          decorations: (state) => docModelKey.getState(state)?.deco,
          attributes: { "data-docmodel": scopeId },
        },
        view: (view) => {
          // Styles or lists changed (locally or from a collaborator):
          // recompute labels and CSS. Observed here rather than in onCreate,
          // which TipTap runs a tick after construction.
          const refresh = () => {
            storage.version++;
            view.dispatch(view.state.tr.setMeta(docModelKey, "refresh"));
          };
          storage.sheet.map.observe(refresh);
          storage.numbering.map.observe(refresh);
          const el = document.createElement("style");
          el.setAttribute("data-docmodel-css", scopeId);
          document.head.appendChild(el);
          let shown = -1;
          const sync = () => {
            if (shown === storage.version) return;
            shown = storage.version;
            el.textContent = `${styleCss(storage.sheet, scope)}\n${LABEL_CSS(scope)}`;
          };
          sync();
          return {
            update: sync,
            destroy: () => {
              storage.sheet.map.unobserve(refresh);
              storage.numbering.map.unobserve(refresh);
              el.remove();
            },
          };
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    const editor = this.editor;
    const keys: Record<string, () => boolean> = {
      Enter: () => enterKey(editor),
      Backspace: () => backspaceKey(editor),
      Tab: () => tabKey(editor, 1),
      "Shift-Tab": () => tabKey(editor, -1),
      "Mod-Alt-0": () => applyStyle(editor, NORMAL),
    };
    for (let l = 1; l <= 6; l++) {
      keys[`Mod-Alt-${l}`] = () => {
        const cur = displayStyle(getDocModel(editor).sheet, editor.state);
        return applyStyle(editor, cur?.id === headingStyleId(l) ? NORMAL : headingStyleId(l));
      };
    }
    return keys;
  },
  addInputRules() {
    const editor = this.editor;
    return [
      new InputRule({
        find: /^((?:1\.){2,9}) $/,
        handler: ({ state, range, match }) =>
          autoList(editor, state.tr, range, { preset: "legalDot", lvl: match[1].length / 2 - 1 }),
      }),
      new InputRule({
        find: /^((?:1\)){2,9}) $/,
        handler: ({ state, range, match }) =>
          autoList(editor, state.tr, range, { preset: "legalParen", lvl: match[1].length / 2 - 1 }),
      }),
      new InputRule({
        find: /^([0-9]+|[a-zA-Z]|[ivx]+|[IVX]+)([.)]) $/,
        handler: ({ state, range, match }) => autoSimple(editor, state.tr, range, match[1], match[2] as "." | ")"),
      }),
    ];
  },
});

// --- helpers over blocks ------------------------------------------------------------------

interface Block {
  node: PMNode;
  pos: number;
}

function blocks(state: EditorState): Block[] {
  return selectedBlocks(state);
}

/** textblockList lists paragraphs/headings in document order. */
export function paragraphBlocks(doc: PMNode): Block[] {
  const out: Block[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      out.push({ node, pos });
      return false;
    }
    return true;
  });
  return out;
}

function inListItem(state: EditorState, pos: number): boolean {
  const $p = state.doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--) {
    const n = $p.node(d).type.name;
    if (n === "listItem" || n === "taskItem") return true;
  }
  return false;
}

function setAttrs(tr: Transaction, b: Block, attrs: Record<string, unknown>): void {
  const node = tr.doc.nodeAt(tr.mapping.map(b.pos)) ?? b.node;
  tr.setNodeMarkup(tr.mapping.map(b.pos), undefined, { ...node.attrs, ...attrs });
}

// --- styles: apply / new / update / delete ---------------------------------------------------

/** applyStyle applies a paragraph style to the selected paragraphs (heading
 *  styles turn them into heading nodes of that level) or a character style
 *  to the selected text. */
export function applyStyle(editor: Editor, id: string | null): boolean {
  const { sheet } = getDocModel(editor);
  const style = id ? sheet.get(id) : sheet.get(NORMAL);
  if (!style) return false;
  const { state } = editor;
  const tr = state.tr;
  if (style.type === "character") {
    const type = state.schema.marks.charStyle;
    const { from, to, empty } = state.selection;
    if (empty) tr.addStoredMark(type.create({ styleId: style.id }));
    else {
      tr.removeMark(from, to, type);
      tr.addMark(from, to, type.create({ styleId: style.id }));
    }
    editor.view.dispatch(tr);
    return true;
  }
  const level = headingLevelOf(sheet, style.id);
  const { paragraph, heading } = state.schema.nodes;
  for (const b of blocks(state)) {
    const pos = tr.mapping.map(b.pos);
    const node = tr.doc.nodeAt(pos) ?? b.node;
    const $pos = tr.doc.resolve(pos);
    const idx = $pos.index();
    const canHeading = level != null && $pos.parent.canReplaceWith(idx, idx + 1, heading);
    const styleId =
      style.id === NORMAL || (style.builtin && style.headingLevel && canHeading) ? null : style.id;
    if (canHeading) tr.setNodeMarkup(pos, heading, { ...node.attrs, level, styleId });
    else tr.setNodeMarkup(pos, paragraph, { ...node.attrs, styleId });
  }
  editor.view.dispatch(tr);
  return true;
}

/** clearCharStyle removes character styles from the selection. */
export function clearCharStyle(editor: Editor): boolean {
  const { state } = editor;
  const { from, to } = state.selection;
  editor.view.dispatch(state.tr.removeMark(from, to, state.schema.marks.charStyle));
  return true;
}

/** Run properties of the first selected character (what "new style from
 *  selection" captures). */
function selectionRunPr(state: EditorState): RunPr {
  const { from, $from, empty } = state.selection;
  if (empty) return marksRunPr($from.nodeBefore ?? $from.nodeAfter);
  let first: PMNode | null = null;
  state.doc.nodesBetween(from, state.selection.to, (n) => {
    if (!first && n.isText) first = n;
    return !first;
  });
  return marksRunPr(first);
}

const PARA_KEYS: (keyof DirectParaProps)[] = [
  "indLeft", "indRight", "indFirstLine", "align", "spaceBefore", "spaceAfter", "lineRule", "lineValue",
  "tabs", "keepNext", "keepLines", "widowControl", "pageBreakBefore", "borders", "shading", "outlineLevel",
];

/** clearDirect removes the given direct paragraph props (and numbering). */
function clearDirectAttrs(keys: (keyof DirectParaProps)[], numbering: boolean): Record<string, unknown> {
  const p: Partial<Record<keyof DirectParaProps, unknown>> = {};
  for (const k of keys) p[k] = undefined;
  const attrs = propsToAttrs(p);
  if (keys.includes("spaceBefore") || keys.includes("spaceAfter")) attrs.paragraphSpacing = null;
  if (numbering) Object.assign(attrs, { numId: null, numLvl: null });
  return attrs;
}

/** createStyleFromSelection makes a new style from the selection's
 *  formatting (based on the paragraph's current style, next = itself),
 *  applies it and moves the captured direct formatting into it. */
export function createStyleFromSelection(editor: Editor, name: string, type: StyleType = "paragraph"): StyleDef | null {
  const { sheet } = getDocModel(editor);
  const trimmed = name.trim();
  if (!trimmed || sheet.byName(trimmed)) return null;
  const { state } = editor;
  const first = blocks(state)[0];
  const id = sheet.uniqueId(trimmed);
  const rPr = selectionRunPr(state);
  if (type === "character") {
    sheet.put({ id, name: trimmed, type, rPr, order: 200 });
    applyStyle(editor, id);
    return sheet.get(id)!;
  }
  if (!first) return null;
  const basedOn = paragraphStyleId(sheet, first.node);
  const direct = directProps(first.node);
  const baseRun = compileStyle(sheet, basedOn).rPr;
  const runDiff: RunPr = {};
  for (const [k, v] of Object.entries(rPr)) if ((baseRun as Record<string, unknown>)[k] !== v) (runDiff as Record<string, unknown>)[k] = v;
  const def: StyleDef = { id, name: trimmed, type: "paragraph", basedOn, next: id, pPr: direct, rPr: runDiff, order: 100 };
  sheet.put(def);
  applyStyle(editor, id);
  // The captured direct paragraph props now come from the style.
  const tr = editor.state.tr;
  for (const b of blocks(editor.state)) setAttrs(tr, b, clearDirectAttrs(Object.keys(direct) as (keyof DirectParaProps)[], false));
  editor.view.dispatch(tr);
  return sheet.get(id)!;
}

/** updateStyleFromSelection redefines a style from the first selected
 *  paragraph: its direct paragraph props and numbering, and the run
 *  formatting at the selection, are merged into the style and removed
 *  from that paragraph as direct formatting. */
export function updateStyleFromSelection(editor: Editor, id: string): boolean {
  const { sheet } = getDocModel(editor);
  const style = sheet.get(id);
  if (!style) return false;
  const { state } = editor;
  const rPr = selectionRunPr(state);
  if (style.type === "character") {
    sheet.put({ ...style, rPr: { ...style.rPr, ...rPr } });
    return true;
  }
  const first = blocks(state)[0];
  if (!first) return false;
  const direct = directProps(first.node);
  const pPr: ParaPr = { ...style.pPr, ...direct };
  const numId = first.node.attrs.numId as string | null;
  if (numId) {
    pPr.numId = numId;
    pPr.numLvl = (first.node.attrs.numLvl as number | null) ?? 0;
  }
  const base = compileStyle(sheet, style.basedOn).rPr;
  const runDiff: RunPr = { ...style.rPr };
  for (const [k, v] of Object.entries(rPr)) if ((base as Record<string, unknown>)[k] !== v) (runDiff as Record<string, unknown>)[k] = v;
  sheet.put({ ...style, pPr, rPr: runDiff });
  const tr = editor.state.tr;
  const pos = first.pos;
  const node = tr.doc.nodeAt(pos)!;
  tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    ...clearDirectAttrs(Object.keys(direct) as (keyof DirectParaProps)[], !!numId),
  });
  editor.view.dispatch(tr);
  return true;
}

/** deleteStyle removes a custom style (built-ins are restored to their
 *  defaults instead). Paragraphs using a deleted style fall back to the
 *  style it was based on (Normal for top-level styles); character-style
 *  marks are removed. */
export function deleteStyle(editor: Editor, id: string): boolean {
  const { sheet } = getDocModel(editor);
  const style = sheet.get(id);
  if (!style) return false;
  if (style.builtin) {
    sheet.remove(id);
    return true;
  }
  const fallback = style.basedOn && sheet.get(style.basedOn) ? style.basedOn : NORMAL;
  const tr = editor.state.tr;
  const markType = editor.schema.marks.charStyle;
  editor.state.doc.descendants((node, pos) => {
    if (style.type === "paragraph" && node.isTextblock && node.attrs.styleId === id) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, styleId: fallback === NORMAL || /^Heading[1-6]$/.test(fallback) ? null : fallback });
    }
    if (style.type === "character" && node.isText && node.marks.some((m) => m.type === markType && m.attrs.styleId === id)) {
      tr.removeMark(pos, pos + node.nodeSize, markType);
    }
    return true;
  });
  // Styles based on the deleted one inherit its parent.
  for (const s of sheet.all()) if (s.basedOn === id) sheet.put({ ...s, basedOn: style.basedOn ?? null });
  sheet.remove(id);
  if (tr.docChanged) editor.view.dispatch(tr);
  return true;
}

/** renameStyle / setStyleProps edit a style definition in place. */
export function modifyStyle(editor: Editor, id: string, patch: Partial<Omit<StyleDef, "id">>): boolean {
  const { sheet } = getDocModel(editor);
  const style = sheet.get(id);
  if (!style) return false;
  if (patch.basedOn && sheet.chain(patch.basedOn).some((s) => s.id === id)) return false; // no cycles
  sheet.put({ ...style, ...patch, id });
  return true;
}

/** currentStyle is the style the toolbar shows (null for mixed). */
export function currentStyle(editor: Editor): StyleDef | null {
  return displayStyle(getDocModel(editor).sheet, editor.state);
}

/** selectedParagraphIndents: the first selected paragraph's compiled
 *  indents and tab stops in points, for the ruler. */
export function selectedParagraphIndents(editor: Editor): {
  left: number;
  right: number;
  firstLine: number;
  tabs: number[];
} | null {
  const b = blocks(editor.state)[0];
  if (!b) return null;
  const c = compiledProps(editor, b.node);
  return { left: c.indLeft, right: c.indRight, firstLine: c.indFirstLine, tabs: (c.tabs ?? []).map((t) => t.pos) };
}

/** compiledProps compiles a paragraph's effective properties. */
export function compiledProps(editor: Editor, node: PMNode): CompiledParaPr {
  const { sheet, numbering } = getDocModel(editor);
  return compileParaPr(sheet, node, levelParaPr(numbering));
}

// --- numbering: apply / remove / restart / continue / value ----------------------------------------

function labelAtBlock(state: EditorState, b: Block): NumLabel | undefined {
  return numberingLabels(state).get(b.pos);
}

function sameFormat(a: LvlDef, b: LvlDef): boolean {
  return a.fmt === b.fmt && a.text === b.text;
}

/**
 * applyListPreset applies a library list (numbering.ts LIST_LIBRARY):
 *   * heading-linked multilevel lists attach to the Heading styles, so every
 *     heading in the document is numbered (and selected headings drop any
 *     direct numbering that would override the style);
 *   * with a caret in a paragraph that is already numbered, the list itself
 *     is redefined (a single-level preset changes that level, a multilevel
 *     preset all levels), so the whole list changes format;
 *   * otherwise the selected paragraphs start a new list (continuing the
 *     list just above when it has the same format), each keeping the level
 *     it had or level 0.
 */
export function applyListPreset(editor: Editor, presetId: string): boolean {
  const preset = presetById(presetId);
  if (!preset) return false;
  return applyLevels(editor, preset.lvls(), { headings: !!preset.headings, multilevel: preset.kind === "multilevel", name: preset.label });
}

export function applyLevels(
  editor: Editor,
  lvls: LvlDef[],
  opts: { headings?: boolean; multilevel?: boolean; name?: string } = {},
): boolean {
  const { sheet, numbering } = getDocModel(editor);
  const state = editor.state;
  const sel = blocks(state);
  if (!sel.length) return false;

  if (opts.headings) {
    const numId = numbering.createList(linkHeadings(lvls), opts.name);
    for (let l = 1; l <= 6; l++) {
      const s = sheet.get(headingStyleId(l))!;
      sheet.put({ ...s, pPr: { ...s.pPr, numId, numLvl: l - 1 } });
    }
    const tr = editor.state.tr;
    for (const b of sel) if (b.node.type.name === "heading" && b.node.attrs.numId != null) setAttrs(tr, b, { numId: null, numLvl: null });
    if (tr.docChanged) editor.view.dispatch(tr);
    return true;
  }

  const first = sel[0];
  const label = labelAtBlock(state, first);
  if (state.selection.empty && label) {
    const cur = numbering.levels(label.numId)!;
    if (opts.multilevel) {
      numbering.setLevels(numbering.num(label.numId)!.abstractId, lvls.map((l, i) => ({ ...l, pStyle: cur[i]?.pStyle ?? null })));
    } else {
      const old = cur[label.lvl];
      numbering.setLevel(label.numId, label.lvl, { ...lvls[0], indLeft: old.indLeft, hanging: old.hanging, pStyle: old.pStyle ?? null, start: lvls[0].start });
    }
    return true;
  }

  // Continue the list right above when it has the same format.
  let numId: string | null = null;
  const $first = state.doc.resolve(first.pos);
  const idx = $first.index();
  if (idx > 0) {
    const prevNode = $first.parent.child(idx - 1);
    const prevPos = first.pos - prevNode.nodeSize;
    const prevLabel = numberingLabels(state).get(prevPos);
    const prevLvls = prevLabel && numbering.levels(prevLabel.numId);
    if (prevLabel && prevLvls && sameFormat(prevLvls[0], lvls[0])) numId = prevLabel.numId;
  }
  numId ??= numbering.createList(lvls, opts.name);
  const tr = editor.state.tr;
  const labels = numberingLabels(editor.state);
  for (const b of sel) {
    const l = labels.get(b.pos);
    setAttrs(tr, b, { numId, numLvl: l ? l.lvl : 0, indent: null, indentFirstLine: null });
  }
  editor.view.dispatch(tr);
  return true;
}

/** removeNumbering takes the selected paragraphs out of their lists. A
 *  paragraph numbered through its style gets numId "0" (the style keeps
 *  its numbering). */
export function removeNumbering(editor: Editor): boolean {
  const { sheet } = getDocModel(editor);
  const tr = editor.state.tr;
  for (const b of blocks(editor.state)) {
    const styleNum = compileStyle(sheet, paragraphStyleId(sheet, b.node)).pPr.numId;
    setAttrs(tr, b, styleNum && styleNum !== "0" ? { numId: "0", numLvl: null } : { numId: null, numLvl: null });
  }
  editor.view.dispatch(tr);
  return true;
}

/** Reassigns the paragraph at `from` and every later paragraph of list
 *  `oldNumId` to `newNumId`. */
function reassign(editor: Editor, fromPos: number, oldNumId: string, newNumId: string): void {
  const tr = editor.state.tr;
  for (const [pos, l] of numberingLabels(editor.state)) {
    if (pos < fromPos || l.numId !== oldNumId) continue;
    const node = tr.doc.nodeAt(pos)!;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, numId: newNumId, numLvl: l.lvl });
  }
  editor.view.dispatch(tr);
}

/** setNumberingValue restarts the caret paragraph's list at `value` from
 *  this paragraph on ("Set numbering value"). */
export function setNumberingValue(editor: Editor, value: number): boolean {
  const { numbering } = getDocModel(editor);
  const b = blocks(editor.state)[0];
  const label = b && labelAtBlock(editor.state, b);
  if (!label) return false;
  const inst = numbering.num(label.numId)!;
  const newId = numbering.createInstance(inst.abstractId, { [label.lvl]: Math.max(0, Math.floor(value)) });
  reassign(editor, b.pos, label.numId, newId);
  return true;
}

/** restartNumbering starts the list over at this paragraph. */
export function restartNumbering(editor: Editor): boolean {
  const b = blocks(editor.state)[0];
  const label = b && labelAtBlock(editor.state, b);
  if (!label) return false;
  return setNumberingValue(editor, label.def.start);
}

/** continueNumbering joins this paragraph's list (from here on) to the
 *  nearest list above it. */
export function continueNumbering(editor: Editor): boolean {
  const b = blocks(editor.state)[0];
  const label = b && labelAtBlock(editor.state, b);
  if (!label) return false;
  let prev: NumLabel | null = null;
  for (const [pos, l] of numberingLabels(editor.state)) if (pos < b.pos && l.numId !== label.numId) prev = l;
  if (!prev) return false;
  reassign(editor, b.pos, label.numId, prev.numId);
  return true;
}

/** setListLevel moves the selected numbered paragraphs `delta` levels. */
export function setListLevel(editor: Editor, delta: number): boolean {
  const labels = numberingLabels(editor.state);
  const tr = editor.state.tr;
  let any = false;
  for (const b of blocks(editor.state)) {
    const l = labels.get(b.pos);
    if (!l) continue;
    const lvl = Math.max(0, Math.min(MAX_LEVELS - 1, l.lvl + delta));
    if (lvl === l.lvl) continue;
    setAttrs(tr, b, { numId: l.numId, numLvl: lvl });
    any = true;
  }
  if (any) editor.view.dispatch(tr);
  return any;
}

/** updateListLevel changes one level of the caret paragraph's list (the
 *  List settings dialog). */
export function updateListLevel(editor: Editor, lvl: number, patch: Partial<LvlDef>): boolean {
  const { numbering } = getDocModel(editor);
  const b = blocks(editor.state)[0];
  const label = b && labelAtBlock(editor.state, b);
  if (!label) return false;
  const cur = numbering.level(label.numId, lvl);
  if (!cur) return false;
  numbering.setLevel(label.numId, lvl, { ...cur, ...patch });
  return true;
}

/** currentList describes the caret paragraph's list, for the UI. */
export function currentList(editor: Editor): (NumLabel & { lvls: LvlDef[] }) | null {
  const b = blocks(editor.state)[0];
  const label = b && labelAtBlock(editor.state, b);
  if (!label) return null;
  return { ...label, lvls: getDocModel(editor).numbering.levels(label.numId)! };
}

/** numberingText returns the list label of textblock `index` — Word-model
 *  numbering, or TipTap bullet / ordered lists ("•", "3.") — or "". */
export function numberingText(editor: Editor, index: number): string {
  const bs = paragraphBlocks(editor.state.doc);
  const b = bs[index];
  if (!b) throw new Error(`no textblock ${index}`);
  const l = numberingLabels(editor.state).get(b.pos);
  if (l) return l.text;
  const $p = editor.state.doc.resolve(b.pos);
  if ($p.depth < 2) return "";
  const item = $p.node($p.depth);
  if (item.type.name !== "listItem" || $p.index($p.depth) !== 0) return "";
  const list = $p.node($p.depth - 1);
  if (list.type.name === "bulletList") {
    let depth = 0;
    for (let d = $p.depth - 1; d > 0; d--) if ($p.node(d).type.name === "bulletList") depth++;
    return ["•", "◦", "▪"][(depth - 1) % 3];
  }
  if (list.type.name === "orderedList") return `${((list.attrs.start as number) ?? 1) + $p.index($p.depth - 1)}.`;
  return "";
}

/** paragraphsInList lists textblock indices numbered with `numId` (and
 *  `lvl` when given). */
export function paragraphsInList(editor: Editor, numId: string, lvl?: number): number[] {
  const labels = numberingLabels(editor.state);
  const out: number[] = [];
  paragraphBlocks(editor.state.doc).forEach((b, i) => {
    const l = labels.get(b.pos);
    if (l && l.numId === numId && (lvl === undefined || l.lvl === lvl)) out.push(i);
  });
  return out;
}

// --- keys ------------------------------------------------------------------------------------

function caretBlock(state: EditorState): Block | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const t = $from.parent.type.name;
  if (t !== "paragraph" && t !== "heading") return null;
  return { node: $from.parent, pos: $from.before() };
}

function enterKey(editor: Editor): boolean {
  const state = editor.state;
  const b = caretBlock(state);
  if (!b) return false;
  const label = labelAtBlock(state, b);
  if (label && b.node.content.size === 0) {
    if (label.lvl > 0) return setListLevel(editor, -1);
    return removeNumbering(editor);
  }
  if (inListItem(state, b.pos)) return false;
  const { $from } = state.selection;
  // A page break before belongs to the first half of a split paragraph.
  if (b.node.attrs.pageBreakBefore && $from.parentOffset > 0 && $from.parentOffset < b.node.content.size) {
    if (!editor.commands.splitBlock()) return false;
    const nb = caretBlock(editor.state);
    if (nb) {
      const tr = editor.state.tr;
      setAttrs(tr, nb, { pageBreakBefore: null });
      editor.view.dispatch(tr);
    }
    return true;
  }
  // A style's "next" style for the new paragraph (at the end of a block).
  if ($from.parentOffset !== b.node.content.size || b.node.content.size === 0) return false;
  const { sheet } = getDocModel(editor);
  const sid = paragraphStyleId(sheet, b.node);
  const next = sheet.get(sid)?.next;
  if (!next || next === sid || !sheet.get(next)) return false;
  if (!editor.commands.splitBlock()) return false;
  applyStyle(editor, next);
  // The new paragraph does not inherit direct numbering from a heading.
  const nb = caretBlock(editor.state);
  if (nb && (nb.node.attrs.numId || nb.node.attrs.pageBreakBefore)) {
    const tr = editor.state.tr;
    setAttrs(tr, nb, { numId: null, numLvl: null });
    editor.view.dispatch(tr);
  }
  return true;
}

function backspaceKey(editor: Editor): boolean {
  const state = editor.state;
  const b = caretBlock(state);
  if (!b || state.selection.$from.parentOffset !== 0) return false;
  if (!labelAtBlock(state, b)) return false;
  return removeNumbering(editor);
}

function tabKey(editor: Editor, dir: 1 | -1): boolean {
  const state = editor.state;
  const sel = blocks(state);
  const labels = numberingLabels(state);
  if (!sel.length || !sel.every((b) => labels.has(b.pos))) return false;
  const { $from, empty } = state.selection;
  if (empty && $from.parentOffset !== 0 && dir > 0) return false;
  setListLevel(editor, dir);
  return true;
}

// --- autocorrect ----------------------------------------------------------------------------

function blockForRange(state: EditorState, from: number): Block | null {
  const $p = state.doc.resolve(from);
  const n = $p.parent;
  if (n.type.name !== "paragraph" && n.type.name !== "heading") return null;
  if (inListItem(state, from)) return null;
  return { node: n, pos: $p.before() };
}

function prevLabel(editor: Editor, b: Block): NumLabel | undefined {
  const $p = editor.state.doc.resolve(b.pos);
  const idx = $p.index();
  if (idx === 0) return undefined;
  const prev = $p.parent.child(idx - 1);
  return numberingLabels(editor.state).get(b.pos - prev.nodeSize);
}

function commitAutoList(
  editor: Editor,
  tr: Transaction,
  range: { from: number; to: number },
  b: Block,
  numId: string,
  lvl: number,
): void {
  tr.delete(range.from, range.to);
  const pos = tr.mapping.map(b.pos);
  const node = tr.doc.nodeAt(pos)!;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, numId, numLvl: lvl });
  void editor;
}

function autoList(
  editor: Editor,
  tr: Transaction,
  range: { from: number; to: number },
  o: { preset: keyof typeof AUTOCORRECT_PRESETS; lvl: number },
): null | void {
  const b = blockForRange(editor.state, range.from);
  if (!b || numberingLabels(editor.state).has(b.pos)) return null;
  const numId = getDocModel(editor).numbering.createList(AUTOCORRECT_PRESETS[o.preset]());
  commitAutoList(editor, tr, range, b, numId, o.lvl);
}

/** Candidate formats for a typed token, most likely first. */
function formatsFor(token: string): NumFmt[] {
  if (/^\d+$/.test(token)) return ["decimal"];
  const out: NumFmt[] = [];
  if (/^[ivx]+$/.test(token)) out.push("lowerRoman");
  if (/^[IVX]+$/.test(token)) out.push("upperRoman");
  if (/^[a-z]$/.test(token)) out.push("lowerLetter");
  if (/^[A-Z]$/.test(token)) out.push("upperLetter");
  return out;
}

function autoSimple(
  editor: Editor,
  tr: Transaction,
  range: { from: number; to: number },
  token: string,
  delim: "." | ")",
): null | void {
  const b = blockForRange(editor.state, range.from);
  if (!b || numberingLabels(editor.state).has(b.pos)) return null;
  const fmts = formatsFor(token);
  if (!fmts.length) return null;
  const { numbering } = getDocModel(editor);

  // Continue the list above: same format and delimiter, next value.
  const prev = prevLabel(editor, b);
  if (prev) {
    const want = `%${prev.lvl + 1}${delim}`;
    const v = parseNumber(token, prev.def.fmt);
    if (prev.def.text === want && fmts.includes(prev.def.fmt) && v === prev.value + 1) {
      commitAutoList(editor, tr, range, b, prev.numId, prev.lvl);
      return;
    }
  }
  // A fresh list. Single letters other than i/I are letters; i / I (and
  // longer roman numerals) are roman. "N. " is TipTap's ordered list.
  const fmt: NumFmt = /^[a-hj-zA-HJ-Z]$/.test(token)
    ? /[a-z]/.test(token) ? "lowerLetter" : "upperLetter"
    : fmts[0];
  if (fmt === "decimal" && delim === ".") return null;
  const start = parseNumber(token, fmt);
  if (start == null) return null;
  const presetId =
    fmt === "decimal" ? "num-decimal-paren"
    : fmt === "lowerLetter" ? (delim === ")" ? "num-lower-letter-paren" : "num-lower-letter-dot")
    : fmt === "upperLetter" ? "num-upper-letter"
    : fmt === "lowerRoman" ? "num-lower-roman"
    : "num-upper-roman";
  const lvls = presetById(presetId)!.lvls();
  lvls[0] = { ...lvls[0], fmt, text: `%1${delim}`, start };
  const numId = numbering.createList(lvls);
  commitAutoList(editor, tr, range, b, numId, 0);
}

// --- export ----------------------------------------------------------------------------------

/**
 * exportBodyHtml serialises the document for download/convert with styles
 * and numbering made explicit, so they degrade to plain HTML:
 *   * each styled paragraph gets its compiled style as inline CSS (direct
 *     formatting still wins, it comes after) and is wrapped in
 *     <div data-custom-style="Name">, which pandoc maps to a DOCX style;
 *   * list labels are written as text at the start of the paragraph;
 *   * character styles become <span data-custom-style> with inline CSS.
 */
export function exportBodyHtml(editor: Editor): string {
  const { sheet } = getDocModel(editor);
  const schema: Schema = editor.schema;
  const labels = numberingLabels(editor.state);
  const order: (NumLabel | undefined)[] = [];
  const styles: (string | null)[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") {
      order.push(labels.get(pos));
      const sid = paragraphStyleId(sheet, node);
      const custom = node.type.name === "heading" ? sid !== headingStyleId(node.attrs.level as number) : sid !== NORMAL;
      styles.push(custom || sheet.isCustomized(sid) ? sid : null);
    }
    return !node.isTextblock;
  });
  let i = 0;
  const base = DOMSerializer.fromSchema(schema);
  const nodes = { ...base.nodes };
  const wrap = (name: string) => {
    const orig = base.nodes[name];
    if (!orig) return;
    nodes[name] = (node: PMNode) => {
      const label = order[i];
      const sid = styles[i];
      i++;
      const { dom, contentDOM } = DOMSerializer.renderSpec(document, orig(node));
      const el = dom as HTMLElement;
      if (sid) {
        const decl = styleDeclarations(sheet, sid);
        const own = el.getAttribute("style");
        if (decl) el.setAttribute("style", own ? `${decl}; ${own}` : decl);
      }
      if (label) {
        const span = document.createElement("span");
        span.className = "list-label";
        span.textContent = `${label.text}${label.def.suffix === "nothing" ? "" : " "}`;
        (contentDOM ?? el).appendChild(span);
      }
      if (sid && node.type.name === "paragraph") {
        const div = document.createElement("div");
        div.setAttribute("data-custom-style", sheet.get(sid)?.name ?? sid);
        div.appendChild(el);
        return { dom: div, contentDOM: contentDOM ?? el };
      }
      return { dom: el, contentDOM: contentDOM ?? undefined };
    };
  };
  wrap("paragraph");
  wrap("heading");
  const marks = { ...base.marks };
  marks.charStyle = (mark) => {
    const span = document.createElement("span");
    const sid = mark.attrs.styleId as string;
    const s = sheet.get(sid);
    if (s) {
      span.setAttribute("data-custom-style", s.name);
      const decl = runPrCss(compileStyle(sheet, sid).rPr).join("; ");
      if (decl) span.setAttribute("style", decl);
    }
    return { dom: span };
  };
  const serializer = new DOMSerializer(nodes, marks);
  const holder = document.createElement("div");
  holder.appendChild(serializer.serializeFragment(editor.state.doc.content));
  return holder.innerHTML;
}

// Re-exported for UI modules.
export { paraPrCss, PARA_KEYS };
