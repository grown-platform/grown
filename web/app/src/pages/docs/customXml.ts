// Custom XML parts and data binding (Docs M10): Word's customXml/itemN.xml
// parts, kept in the doc's `customXml` Yjs map (item id -> {xml, uris}),
// and w:dataBinding on content controls — the control shows the value of
// an XML node picked by an XPath (with w:prefixMappings), and editing the
// control writes the value back. The XPath subset is what Word's bindings
// use: absolute paths, `//`, `*`, name tests with prefixes, `[n]`
// positions and a final `@attribute`.
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import * as Y from "yjs";
import { getDocModel } from "./docModel";
import { encodePr, innerText, isoDate, parseDisplayedDate, parseIsoDate, prOf, formatSdtDate, type DataBinding, type SdtPr } from "./sdtModel";
import { allSdts, sdtKey, setSdtContentTr, updatePrTr, type SdtHit } from "./sdt";

export interface CustomXmlPart {
  itemId: string;
  uris: string[];
  xml: string;
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

// --- parsing and serialising -------------------------------------------------------------

/** parseCustomXml reads a part (text after the root element, which some
 *  producers leave, is ignored). */
export function parseCustomXml(xml: string): Document | null {
  const end = xml.lastIndexOf(">");
  const text = end >= 0 ? xml.slice(0, end + 1) : xml;
  try {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) return null;
    return doc;
  } catch {
    return null;
  }
}

/** serializeCustomXml: the declaration, a newline and the root element. */
export function serializeCustomXml(doc: Document): string {
  return XML_DECL + new XMLSerializer().serializeToString(doc.documentElement);
}

// --- XPath -------------------------------------------------------------------------------

export interface XNode {
  el: Element;
  /** The attribute selected by a final @step. */
  attr?: string;
}

interface Step {
  descendant: boolean;
  attr: boolean;
  prefix: string | null;
  local: string;
  index: number | null;
}

function parseXPath(xpath: string): Step[] | null {
  const steps: Step[] = [];
  let s = xpath.trim();
  if (!s.startsWith("/")) return null;
  while (s) {
    let descendant = false;
    if (s.startsWith("//")) {
      descendant = true;
      s = s.slice(2);
    } else if (s.startsWith("/")) s = s.slice(1);
    else return null;
    const m = /^(@?)(?:([\w.-]+):)?([\w.-]+|\*)(?:\[(\d+)\])?/.exec(s);
    if (!m) return null;
    steps.push({ descendant, attr: m[1] === "@", prefix: m[2] ?? null, local: m[3], index: m[4] ? +m[4] : null });
    s = s.slice(m[0].length);
  }
  return steps;
}

/** Namespace map from w:prefixMappings ("xmlns:ns0='uri' xmlns:b='uri'"). */
export function parsePrefixMappings(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/xmlns:([\w.-]+)\s*=\s*(['"])(.*?)\2/g)) out[m[1]] = m[3];
  return out;
}

function nameMatches(el: Element, step: Step, ns: Record<string, string>): boolean {
  if (step.local !== "*" && (el.localName || el.nodeName) !== step.local) return false;
  if (step.prefix && ns[step.prefix] != null) return el.namespaceURI === ns[step.prefix];
  return true;
}

function childElements(n: Node): Element[] {
  const out: Element[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
}

function descendantElements(n: Node): Element[] {
  const out: Element[] = [];
  const walk = (x: Node) => {
    for (const c of childElements(x)) {
      out.push(c);
      walk(c);
    }
  };
  walk(n);
  return out;
}

/** findByXPath evaluates the XPath subset on a part. For a final @step the
 *  results are the elements carrying the attribute. */
export function findByXPath(doc: Document, xpath: string, prefixMappings = ""): XNode[] {
  const steps = parseXPath(xpath);
  if (!steps) return [];
  const ns = parsePrefixMappings(prefixMappings);
  let ctx: XNode[] = [{ el: doc as unknown as Element }];
  for (const step of steps) {
    const next: XNode[] = [];
    const seen = new Set<Element>();
    for (const c of ctx) {
      if (step.attr) {
        const cands = step.descendant ? [c.el, ...descendantElements(c.el)] : [c.el];
        for (const el of cands) {
          if (el.nodeType !== 1) continue;
          const name = step.prefix ? `${step.prefix}:${step.local}` : step.local;
          const has = step.local === "*" ? el.attributes.length > 0 : el.hasAttribute(name) || el.hasAttribute(step.local);
          if (has && !seen.has(el)) {
            seen.add(el);
            next.push({ el, attr: step.local === "*" ? el.attributes[0].name : el.hasAttribute(name) ? name : step.local });
          }
        }
        continue;
      }
      let matches = (step.descendant ? descendantElements(c.el) : childElements(c.el)).filter((el) => nameMatches(el, step, ns));
      if (step.index != null) matches = matches[step.index - 1] ? [matches[step.index - 1]] : [];
      for (const el of matches)
        if (!seen.has(el)) {
          seen.add(el);
          next.push({ el });
        }
    }
    ctx = next;
  }
  return ctx.filter((x) => x.el.nodeType === 1);
}

/** xpathOf: an element's absolute path, with [n] where siblings share its
 *  name (OnlyOffice getXPath). */
export function xpathOf(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1) {
    const parent: Node | null = cur.parentNode;
    const name = cur.nodeName;
    const same = parent ? childElements(parent).filter((s) => s.nodeName === name) : [cur];
    parts.unshift(same.length > 1 ? `${name}[${same.indexOf(cur) + 1}]` : name);
    cur = parent && parent.nodeType === 1 ? (parent as Element) : null;
  }
  return "/" + parts.join("/");
}

export const nodeText = (x: XNode): string => (x.attr ? x.el.getAttribute(x.attr) ?? "" : x.el.textContent ?? "");

// --- the store ---------------------------------------------------------------------------

const stores = new WeakMap<Editor, Y.Map<unknown>>();

export function customXmlMap(editor: Editor): Y.Map<unknown> {
  let m = stores.get(editor);
  if (!m) {
    const ydoc = (getDocModel(editor)?.sheet.map.doc as Y.Doc | null) ?? new Y.Doc();
    m = ydoc.getMap("customXml");
    stores.set(editor, m);
  }
  return m;
}

export function customXmlParts(editor: Editor): CustomXmlPart[] {
  const out: CustomXmlPart[] = [];
  customXmlMap(editor).forEach((v, itemId) => {
    try {
      const p = JSON.parse(String(v)) as { xml: string; uris?: string[] };
      out.push({ itemId, xml: p.xml, uris: p.uris ?? [] });
    } catch {
      /* skip */
    }
  });
  return out;
}

export function getCustomXml(editor: Editor, itemId: string): CustomXmlPart | null {
  return customXmlParts(editor).find((p) => sameId(p.itemId, itemId)) ?? null;
}

/** putCustomXml adds or replaces a part (the xml is normalised). */
export function putCustomXml(editor: Editor, part: CustomXmlPart): void {
  const doc = parseCustomXml(part.xml);
  const xml = doc ? serializeCustomXml(doc) : part.xml;
  const existing = customXmlParts(editor).find((p) => sameId(p.itemId, part.itemId));
  customXmlMap(editor).set(existing?.itemId ?? part.itemId, JSON.stringify({ xml, uris: part.uris }));
  refreshBindings(editor);
}

export function removeCustomXml(editor: Editor, itemId: string): void {
  const p = getCustomXml(editor, itemId);
  if (p) customXmlMap(editor).delete(p.itemId);
}

const sameId = (a: string, b: string) => a.replace(/[{}]/g, "").toLowerCase() === b.replace(/[{}]/g, "").toLowerCase();

/** The part a binding points at: by store item id, else (Word) the first
 *  part whose root the path can reach. */
function partFor(editor: Editor, db: DataBinding): CustomXmlPart | null {
  const parts = customXmlParts(editor);
  if (db.storeItemId) {
    const p = parts.find((x) => sameId(x.itemId, db.storeItemId));
    if (p) return p;
  }
  return parts.find((p) => {
    const d = parseCustomXml(p.xml);
    return !!d && findByXPath(d, db.xpath, db.prefix).length > 0;
  }) ?? null;
}

/** readBinding: the bound node's text, or null when it doesn't resolve. */
export function readBinding(editor: Editor, db: DataBinding): string | null {
  const p = partFor(editor, db);
  const doc = p && parseCustomXml(p.xml);
  const hit = doc ? findByXPath(doc, db.xpath, db.prefix)[0] : undefined;
  return hit ? nodeText(hit) : null;
}

/** writeBinding stores a value in the bound node (OnlyOffice
 *  setContentByDataBinding). */
export function writeBinding(editor: Editor, db: DataBinding, value: string): boolean {
  const p = partFor(editor, db);
  const doc = p && parseCustomXml(p.xml);
  const hit = doc ? findByXPath(doc, db.xpath, db.prefix)[0] : undefined;
  if (!p || !doc || !hit) return false;
  if (hit.attr) hit.el.setAttribute(hit.attr, value);
  else hit.el.textContent = value;
  const xml = serializeCustomXml(doc);
  if (xml === p.xml) return true;
  customXmlMap(editor).set(p.itemId, JSON.stringify({ xml, uris: p.uris }));
  return true;
}

// --- controls <-> values -----------------------------------------------------------------

const TRUE = /^(true|1)$/i;

/** controlBindingValue: what a bound control writes to its node. */
export function controlBindingValue(node: import("@tiptap/pm/model").Node): string {
  const pr = prOf(node);
  switch (pr.type) {
    case "checkbox":
      return pr.checkbox?.checked ? "true" : "false";
    case "picture": {
      const src = pr.picture?.src ?? "";
      const m = /^data:[^;,]+;base64,(.*)$/.exec(src);
      return m ? m[1] : src;
    }
    default:
      return node.attrs.plc ? "" : innerText(node);
  }
}

function pictureSrc(b64: string): string | null {
  const s = b64.trim();
  if (!s) return null;
  if (/^(data:|https?:)/.test(s)) return s;
  const mime = s.startsWith("/9j/") ? "image/jpeg" : s.startsWith("iVBOR") ? "image/png" : s.startsWith("R0lGOD") ? "image/gif" : "image/png";
  return `data:${mime};base64,${s}`;
}

/** Load a value into the control at `pos` (in `tr`). */
function applyValue(editor: Editor, hit: SdtHit, value: string, tr = editor.state.tr) {
  const pr = prOf(hit.node);
  let next: SdtPr | null = null;
  let text: string | null = null;
  switch (pr.type) {
    case "checkbox": {
      const checked = TRUE.test(value.trim());
      if (!!pr.checkbox?.checked !== checked) {
        next = { ...pr, checkbox: { ...pr.checkbox!, checked } };
        text = checked ? pr.checkbox!.checkedSymbol : pr.checkbox!.uncheckedSymbol;
      }
      break;
    }
    case "picture":
      if ((pr.picture?.src ?? null) !== pictureSrc(value)) next = { ...pr, picture: { ...pr.picture, src: pictureSrc(value) } };
      break;
    case "date": {
      const iso = parseIsoDate(value) ? isoDate(parseIsoDate(value)!) : parseDisplayedDate(value, pr.date?.format ?? "");
      const date = { format: "M/d/yyyy", ...pr.date, full: iso };
      next = { ...pr, date };
      text = iso ? formatSdtDate(iso, date.format) : value;
      break;
    }
    default:
      text = value;
  }
  if (next) updatePrTr(tr, hit.pos, next);
  if (text != null && (text !== innerText(tr.doc.nodeAt(hit.pos)!) || hit.node.attrs.plc)) setSdtContentTr(tr, hit.pos, text, false);
  return tr;
}

/** checkDataBinding loads the bound value into a control. */
export function checkDataBinding(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const db = prOf(node).dataBinding;
  if (!db) return false;
  const v = readBinding(editor, db);
  if (v == null) return false;
  const tr = applyValue(editor, { node, pos }, v);
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("sdtBinding", true).setMeta(sdtKey, { force: true }));
  return true;
}

/** updateDataBinding writes a control's value to its bound node. */
export function updateDataBinding(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  const db = node && prOf(node).dataBinding;
  return !!db && writeBinding(editor, db, controlBindingValue(node));
}

/** setDataBinding binds a control and loads its value. */
export function setDataBinding(editor: Editor, pos: number, db: DataBinding | null): boolean {
  const tr = editor.state.tr;
  const node = tr.doc.nodeAt(pos);
  if (!node) return false;
  tr.setNodeAttribute(pos, "pr", encodePr({ ...prOf(node), dataBinding: db ?? undefined }));
  const v = db ? readBinding(editor, db) : null;
  if (v != null) applyValue(editor, { node: tr.doc.nodeAt(pos)!, pos }, v, tr);
  editor.view.dispatch(tr.setMeta(sdtKey, { force: true }).setMeta("sdtBinding", true));
  return true;
}

/** refreshBindings reloads every bound control from the parts. */
export function refreshBindings(editor: Editor): void {
  if (editor.isDestroyed) return;
  const tr = editor.state.tr;
  for (const h of allSdts(editor.state.doc).reverse()) {
    const db = prOf(h.node).dataBinding;
    if (!db) continue;
    const v = readBinding(editor, db);
    if (v == null || v === controlBindingValue(h.node)) continue;
    applyValue(editor, { node: tr.doc.nodeAt(h.pos)!, pos: h.pos }, v, tr);
  }
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("sdtBinding", true).setMeta(sdtKey, { force: true }).setMeta("addToHistory", false));
}

/** Writes edited bound controls back to their parts. */
function pushBindings(editor: Editor): void {
  for (const h of allSdts(editor.state.doc)) {
    const db = prOf(h.node).dataBinding;
    if (!db) continue;
    const v = controlBindingValue(h.node);
    if (readBinding(editor, db) !== v) writeBinding(editor, db, v);
  }
}

/** CustomXmlBinding keeps bound controls and parts in step. */
const bindingKey = new PluginKey<boolean>("customXmlBinding");

export const CustomXmlBinding = Extension.create({
  name: "customXmlBinding",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<boolean>({
        key: bindingKey,
        // Whether the last transaction came from the parts (or a peer).
        state: {
          init: () => false,
          apply: (tr, v) => (tr.docChanged ? !!tr.getMeta("sdtBinding") || !!(tr.getMeta("y-sync$") as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin : v),
        },
        // A plugin view, not onCreate (TipTap emits "create" a tick late).
        view() {
          const map = customXmlMap(editor);
          let busy = false;
          const fromParts = () => {
            if (busy) return;
            busy = true;
            queueMicrotask(() => {
              busy = false;
              refreshBindings(editor);
            });
          };
          map.observe(fromParts);
          return {
            update(view, prev) {
              if (!map.size || view.state.doc.eq(prev.doc) || bindingKey.getState(view.state)) return;
              pushBindings(editor);
            },
            destroy: () => map.unobserve(fromParts),
          };
        },
      }),
    ];
  },
});
