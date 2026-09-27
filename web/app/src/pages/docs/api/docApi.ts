// The Docs scripting API (M13), behind the `docs-api` feature flag.
//
// Design (see docs/plans/onlyoffice-parity/docs.md, M13 status):
// - The API is a fixed table of named methods over the live editor
//   (API_METHODS). Nothing here evaluates code: no eval, no Function,
//   no string-to-code in the app's realm.
// - Macros are data: a JSON list of { method, args } steps run through
//   the same table (runMacro), so a stored macro can't do more than a user
//   clicking menu items.
// - Plugins are pages loaded in a sandboxed iframe (sandbox="allow-scripts",
//   no allow-same-origin: an opaque origin with no access to the app's
//   cookies, storage or DOM). They call methods by postMessage
//   ({ grownApi: 1, id, method, args }); host.ts checks the method name
//   against the table and that args are plain JSON, runs it, and posts
//   the JSON result back.
// Method names follow OnlyOffice's plugin / builder API where one exists
// (GetAllAddinFields, AddAddinField, …), so its tests port directly.
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { parseInstr } from "../fields";
import { getCurrentSentence, getCurrentWord, replaceCurrentSentence, replaceCurrentWord, type UnitPart } from "../textUnits";
import { addText, getSelectedText, getText, setTextColor } from "../textOps";
import { ApiColor, DEFAULT_THEME, type ColorJson } from "./color";

export interface AddinField {
  FieldId: string;
  Value: string;
  Content: string;
}

export interface ApiHost {
  /** The body editor. */
  editor: Editor;
  /** Header / footer editors that are open (their add-in fields count). */
  parts?: () => Editor[];
  /** The editor holding the caret (a header while one is edited). */
  active?: () => Editor | null;
  /** Theme colours (the document's theme, else Word's default). */
  theme?: Record<string, string>;
}

export type EditingRestriction = "none" | "readOnly" | "comments" | "forms" | "trackChanges";

interface FieldRef {
  editor: Editor;
  pos: number;
  node: PMNode;
  /** Runtime id ("" until ensureFieldIds numbers it). */
  id: string;
}

// Field ids are runtime-only, like OnlyOffice's: kept per editor as
// position -> id and mapped through every transaction (no schema
// attribute, nothing written to the document or DOCX).
const trackers = new WeakMap<Editor, Map<number, string>>();

function fieldIds(editor: Editor): Map<number, string> {
  let t = trackers.get(editor);
  if (!t) {
    const map = new Map<number, string>();
    t = map;
    trackers.set(editor, map);
    editor.on("transaction", ({ transaction: tr }) => {
      if (!tr.docChanged || !map.size) return;
      const next: [number, string][] = [];
      for (const [pos, id] of map) {
        const start = tr.mapping.map(pos, -1);
        const end = tr.mapping.map(pos + 1, 1);
        if (end - start === 1 && tr.doc.nodeAt(start)?.type.name === "field") next.push([start, id]);
      }
      map.clear();
      for (const [p, id] of next) map.set(p, id);
    });
  }
  return t;
}

/** Every field node of the body and the open parts, in document order. */
function allFields(host: ApiHost): FieldRef[] {
  const out: FieldRef[] = [];
  const editors = [host.editor, ...(host.parts?.() ?? [])].filter((e, i, a) => e && !e.isDestroyed && a.indexOf(e) === i);
  for (const editor of editors)
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "field") out.push({ editor, pos, node, id: fieldIds(editor).get(pos) ?? "" });
      return true;
    });
  return out;
}

const isAddin = (n: PMNode) => parseInstr(String(n.attrs.instr ?? "")).type === "ADDIN";
const addinValue = (n: PMNode) => String(n.attrs.instr ?? "").replace(/^\s*ADDIN\s?/i, "");

/** Give every field without one a runtime id (numbered in document order
 *  after the highest id in use), as OnlyOffice numbers its fields. */
function ensureFieldIds(host: ApiHost): number {
  const fields = allFields(host);
  let max = 0;
  for (const f of fields) max = Math.max(max, Number(f.id) || 0);
  for (const f of fields)
    if (!f.id) {
      f.id = String(++max);
      fieldIds(f.editor).set(f.pos, f.id);
    }
  return max;
}

function findField(host: ApiHost, id: string): FieldRef | null {
  return allFields(host).find((f) => f.id !== "" && f.id === String(id)) ?? null;
}

/** createDocApi returns the API object for a document. */
export function createDocApi(host: ApiHost) {
  const active = () => host.active?.() ?? host.editor;
  const theme = host.theme ?? DEFAULT_THEME;
  const api = {
    // --- colours (ApiColor) ---
    RGB: (r: number, g: number, b: number) => ApiColor.rgb(r, g, b),
    RGBA: (r: number, g: number, b: number, a: number) => ApiColor.rgb(r, g, b, a),
    HexColor: (hex: string) => ApiColor.hex(hex),
    ThemeColor: (slot: string) => ApiColor.theme(slot, theme),
    AutoColor: () => ApiColor.auto(),
    FromJSON: (json: string | ColorJson) => ApiColor.fromJSON(json),

    // --- text ---
    GetText: () => getText(host.editor),
    /** The selected text; a selected field reads as its result. */
    GetSelectedText: () => {
      const e = active();
      const { from, to, empty } = e.state.selection;
      if (empty) return "";
      const leaf = (n: PMNode) => (n.type.name === "field" ? String(n.attrs.result ?? "") : n.type.name === "hardBreak" ? "\n" : "");
      return e.state.selection instanceof NodeSelection ? leaf(e.state.selection.node) || getSelectedText(e) : e.state.doc.textBetween(from, to, "\r", leaf);
    },
    AddText: (text: string) => {
      addText(active(), String(text));
      return true;
    },
    SetTextColor: (color: ApiColor | ColorJson | string) => {
      const e = active();
      const c = color instanceof ApiColor ? color : typeof color === "string" && color.startsWith("#") ? ApiColor.hex(color) : ApiColor.fromJSON(color as ColorJson);
      const { from, to } = e.state.selection;
      if (from === to) return false;
      setTextColor(e, from, to, c.toCss());
      return true;
    },
    GetCurrentWord: (part: UnitPart = "entirely") => getCurrentWord(active(), part),
    GetCurrentSentence: (part: UnitPart = "entirely") => getCurrentSentence(active(), part),
    ReplaceCurrentWord: (text: string, part: UnitPart = "entirely") => replaceCurrentWord(active(), String(text), part),
    ReplaceCurrentSentence: (text: string, part: UnitPart = "entirely") => replaceCurrentSentence(active(), String(text), part),

    // --- fields ---
    /** Every field: id, instruction and shown result. */
    GetAllFields: () => {
      ensureFieldIds(host);
      return allFields(host).map((f) => ({ FieldId: f.id, Instr: String(f.node.attrs.instr ?? ""), Result: String(f.node.attrs.result ?? "") }));
    },
    GetAllAddinFields: (): AddinField[] =>
      allFields(host)
        .filter((f) => isAddin(f.node))
        .map((f) => ({ FieldId: f.id, Value: addinValue(f.node), Content: String(f.node.attrs.result ?? "") })),
    /** Insert an ADDIN field (Word's hidden plugin data field) at the caret. */
    AddAddinField: (data: { Value?: unknown; Content?: unknown; FieldId?: unknown }) => {
      const e = active();
      const max = ensureFieldIds(host);
      const id = data.FieldId != null && !findField(host, String(data.FieldId)) ? String(data.FieldId) : String(max + 1);
      const type = e.schema.nodes.field;
      if (!type) return null;
      const node = type.create({ instr: `ADDIN ${String(data.Value ?? "")}`, result: String(data.Content ?? "") });
      const from = e.state.selection.from;
      const tr = e.state.tr.replaceSelectionWith(node, false).scrollIntoView();
      let at = tr.mapping.map(from, -1);
      if (tr.doc.nodeAt(at)?.type.name !== "field") at = tr.selection.from - 1;
      e.view.dispatch(tr);
      if (e.state.doc.nodeAt(at)?.type.name === "field") fieldIds(e).set(at, id);
      return id;
    },
    UpdateAddinFields: (list: Partial<AddinField>[]) => {
      let n = 0;
      for (const item of Array.isArray(list) ? list : []) {
        const f = item.FieldId != null ? findField(host, String(item.FieldId)) : null;
        if (!f || !isAddin(f.node)) continue;
        const attrs = { ...f.node.attrs };
        if (item.Value !== undefined) attrs.instr = `ADDIN ${String(item.Value)}`;
        if (item.Content !== undefined) attrs.result = String(item.Content);
        f.editor.view.dispatch(f.editor.state.tr.setNodeMarkup(f.pos, undefined, attrs));
        n++;
      }
      return n;
    },
    SelectAddinField: (id: string) => {
      const f = findField(host, id);
      if (!f || !isAddin(f.node)) return false;
      f.editor.view.dispatch(f.editor.state.tr.setSelection(NodeSelection.create(f.editor.state.doc, f.pos)).scrollIntoView());
      return true;
    },
    RemoveAddinField: (id: string) => {
      const f = findField(host, id);
      if (!f || !isAddin(f.node)) return false;
      f.editor.view.dispatch(f.editor.state.tr.delete(f.pos, f.pos + f.node.nodeSize));
      return true;
    },
    /** Replace a field by its result text (the text stays, the field goes). */
    RemoveFieldWrapper: (id: string) => {
      const f = findField(host, id);
      if (!f) return false;
      const text = String(f.node.attrs.result ?? "");
      const tr = f.editor.state.tr;
      if (text) tr.replaceWith(f.pos, f.pos + f.node.nodeSize, f.editor.schema.text(text, f.node.marks));
      else tr.delete(f.pos, f.pos + f.node.nodeSize);
      f.editor.view.dispatch(tr);
      return true;
    },

    // --- restrictions ---
    SetEditingRestrictions: (mode: EditingRestriction) => {
      if (mode !== "none" && mode !== "readOnly") return false;
      for (const e of [host.editor, ...(host.parts?.() ?? [])]) if (!e.isDestroyed) e.setEditable(mode === "none");
      return true;
    },
    CanEdit: () => host.editor.isEditable,
  };
  return api;
}

export type DocApi = ReturnType<typeof createDocApi>;

/** Methods scripts, macros and plugins may call (everything on the API). */
export const API_METHODS = [
  "RGB",
  "RGBA",
  "HexColor",
  "ThemeColor",
  "AutoColor",
  "FromJSON",
  "GetText",
  "GetSelectedText",
  "AddText",
  "SetTextColor",
  "GetCurrentWord",
  "GetCurrentSentence",
  "ReplaceCurrentWord",
  "ReplaceCurrentSentence",
  "GetAllFields",
  "GetAllAddinFields",
  "AddAddinField",
  "UpdateAddinFields",
  "SelectAddinField",
  "RemoveAddinField",
  "RemoveFieldWrapper",
  "SetEditingRestrictions",
  "CanEdit",
] as const satisfies readonly (keyof DocApi)[];

export type ApiMethod = (typeof API_METHODS)[number];

/** isPlainJson: only data crosses into the API (no functions, symbols,
 *  class instances or cycles). */
export function isPlainJson(v: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isPlainJson(x, depth + 1));
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(v as object).every((x) => isPlainJson(x, depth + 1));
  }
  return false;
}

/** toJsonResult turns a method's return value into plain JSON (ApiColor
 *  -> its JSON form). */
function toJsonResult(v: unknown): unknown {
  if (v instanceof ApiColor) return JSON.parse(v.ToJSON());
  if (Array.isArray(v)) return v.map(toJsonResult);
  return v === undefined ? null : v;
}

/** callApi runs one whitelisted method with JSON arguments. */
export function callApi(api: DocApi, method: string, args: unknown[] = []): unknown {
  if (!(API_METHODS as readonly string[]).includes(method)) throw new Error(`Unknown API method: ${method}`);
  if (!Array.isArray(args) || !isPlainJson(args)) throw new Error("API arguments must be plain JSON");
  const fn = api[method as ApiMethod] as (...a: unknown[]) => unknown;
  return toJsonResult(fn(...args));
}

export interface MacroStep {
  method: string;
  args?: unknown[];
}

/** runMacro runs a macro (a JSON list of steps) and returns each result. */
export function runMacro(api: DocApi, macro: MacroStep[] | string): unknown[] {
  const steps = (typeof macro === "string" ? JSON.parse(macro) : macro) as MacroStep[];
  if (!Array.isArray(steps)) throw new Error("A macro is a JSON array of { method, args } steps");
  return steps.map((s) => callApi(api, s.method, s.args ?? []));
}
