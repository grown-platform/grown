// Content controls (Docs M10): the pure model. A content control is an
// `sdtInline` (inline, content "inline*") or `sdtBlock` (block, content
// "block+") node whose properties — WordprocessingML's w:sdtPr — live in one
// JSON attribute `pr`; `plc` is w:showingPlcHdr (the content is the
// placeholder text). This file has no editor code: property parsing,
// defaults, date and colour helpers, and the value a control stands for.
import type { Node as PMNode } from "@tiptap/pm/model";
import { formatDate } from "./fields";

export type SdtType =
  | "richText"
  | "text"
  | "checkbox"
  | "comboBox"
  | "dropDownList"
  | "date"
  | "picture"
  | "complex";

/** w:lock: sdtLocked = the control can't be deleted; contentLocked = its
 *  content can't be edited; sdtContentLocked = both. */
export type SdtLock = "unlocked" | "sdtLocked" | "contentLocked" | "sdtContentLocked";

export type SdtAppearance = "boundingBox" | "tags" | "hidden";

export interface ListItem {
  label: string;
  value: string;
}

export interface CheckboxPr {
  checked: boolean;
  checkedSymbol: string;
  uncheckedSymbol: string;
  font?: string;
  /** Radio buttons: the group (OnlyOffice w14:groupKey) and this choice. */
  groupKey?: string;
  choiceName?: string;
}

export interface DatePr {
  /** Display format (Word date picture; OnlyOffice's "mm/dd/yyyy" works). */
  format: string;
  /** The chosen date, ISO (yyyy-mm-dd) or null. */
  full: string | null;
  lang?: string;
}

export interface PicturePr {
  src: string | null;
  width?: number;
  height?: number;
}

export type TextFormatType = "none" | "digit" | "letter" | "mask" | "regexp";

export interface TextFormat {
  type: TextFormatType;
  value?: string;
  /** Allowed characters (OnlyOffice "symbols"); empty = any. */
  symbols?: string;
}

/** OnlyOffice text-form properties (w:textFormPr). */
export interface TextFormPr {
  comb?: boolean;
  /** -1 or absent = unlimited. */
  maxChars?: number;
  format?: TextFormat;
  multiLine?: boolean;
  autoFit?: boolean;
}

/** OnlyOffice form properties (w:formPr): a control with these is a form
 *  field (fill-in form). */
export interface FormPr {
  key: string;
  label?: string;
  helpText?: string;
  required?: boolean;
  /** Who fills it in (a role name from the document's roles). */
  role?: string;
  /** Fixed-size form (a frame) rather than inline. */
  fixed?: boolean;
}

/** w:dataBinding: the control's value is a node of a custom XML part. */
export interface DataBinding {
  prefix: string;
  xpath: string;
  storeItemId: string;
}

export interface SdtPr {
  type: SdtType;
  /** Title (w:alias). */
  alias?: string;
  tag?: string;
  /** Control colour (w15:color), "#rrggbb". */
  color?: string | null;
  appearance?: SdtAppearance;
  lock?: SdtLock;
  /** Placeholder text shown while the control is empty. */
  placeholder?: string;
  /** Remove the control once its content is edited (w:temporary). */
  temporary?: boolean;
  multiLine?: boolean;
  /** API colours: "#rrggbb", "#rrggbbaa" or "theme:<name>". */
  borderColor?: string | null;
  backgroundColor?: string | null;
  checkbox?: CheckboxPr;
  items?: ListItem[];
  date?: DatePr;
  picture?: PicturePr;
  form?: FormPr;
  textForm?: TextFormPr;
  dataBinding?: DataBinding;
  /** Building block gallery (w:docPartObj), e.g. "Table of Contents". */
  docPartGallery?: string;
}

export const SDT_INLINE = "sdtInline";
export const SDT_BLOCK = "sdtBlock";

export const isSdt = (n: PMNode | null | undefined): n is PMNode =>
  !!n && (n.type.name === SDT_INLINE || n.type.name === SDT_BLOCK);

// --- defaults ----------------------------------------------------------------------------

export const DEFAULT_PLACEHOLDER: Record<SdtType, string> = {
  richText: "Your text here",
  text: "Your text here",
  checkbox: "",
  comboBox: "Choose an item",
  dropDownList: "Choose an item",
  date: "Enter a date",
  picture: "",
  complex: "Your text here",
};

export const CHECKBOX_SYMBOLS = { checked: "☒", unchecked: "☐" };
export const RADIO_SYMBOLS = { checked: "◉", unchecked: "○" };

export const DEFAULT_DATE_FORMAT = "M/d/yyyy";

export const TYPE_LABEL: Record<SdtType, string> = {
  richText: "Rich text",
  text: "Plain text",
  checkbox: "Check box",
  comboBox: "Combo box",
  dropDownList: "Drop-down list",
  date: "Date picker",
  picture: "Picture",
  complex: "Complex field",
};

/** defaultPr builds the properties of a new control of `type`. */
export function defaultPr(type: SdtType, extra: Partial<SdtPr> = {}): SdtPr {
  const pr: SdtPr = { type };
  if (DEFAULT_PLACEHOLDER[type]) pr.placeholder = DEFAULT_PLACEHOLDER[type];
  if (type === "checkbox")
    pr.checkbox = { checked: false, checkedSymbol: CHECKBOX_SYMBOLS.checked, uncheckedSymbol: CHECKBOX_SYMBOLS.unchecked };
  if (type === "comboBox" || type === "dropDownList") pr.items = [];
  if (type === "date") pr.date = { format: DEFAULT_DATE_FORMAT, full: null, lang: "en-US" };
  if (type === "picture") pr.picture = { src: null };
  return { ...pr, ...extra };
}

// --- attribute codec ---------------------------------------------------------------------

const cache = new Map<string, SdtPr>();

/** parsePr reads a node's `pr` attribute (cached by string). */
export function parsePr(raw: unknown): SdtPr {
  if (raw && typeof raw === "object") return raw as SdtPr;
  const s = typeof raw === "string" ? raw : "";
  const hit = cache.get(s);
  if (hit) return hit;
  let pr: SdtPr;
  try {
    pr = s ? (JSON.parse(s) as SdtPr) : { type: "richText" };
  } catch {
    pr = { type: "richText" };
  }
  if (!pr.type) pr.type = "richText";
  if (cache.size > 2000) cache.clear();
  cache.set(s, pr);
  return pr;
}

/** encodePr writes properties for the `pr` attribute (undefined keys and
 *  empty objects dropped, so equal properties give equal strings). */
export function encodePr(pr: SdtPr): string {
  return JSON.stringify(pr, (_k, v) => (v === undefined ? undefined : v));
}

export const prOf = (node: PMNode): SdtPr => parsePr(node.attrs.pr);

let idSeq = 0;
/** newSdtId: a w:id (a positive 31-bit integer, as a string). */
export function newSdtId(): string {
  idSeq = (idSeq + 1) % 1000;
  return String(((Date.now() % 1_000_000) * 1000 + idSeq + Math.floor(Math.random() * 1000)) % 2_147_483_000 + 1);
}

// --- locks -------------------------------------------------------------------------------

export const cannotDelete = (pr: SdtPr) => pr.lock === "sdtLocked" || pr.lock === "sdtContentLocked";
export const cannotEdit = (pr: SdtPr) => pr.lock === "contentLocked" || pr.lock === "sdtContentLocked";

/** Types whose content is not typed into (it is chosen or toggled). */
export function isChoiceOnly(pr: SdtPr): boolean {
  return pr.type === "checkbox" || pr.type === "picture" || pr.type === "dropDownList";
}

export const isForm = (pr: SdtPr) => !!pr.form;
export const isRadio = (pr: SdtPr) => pr.type === "checkbox" && !!pr.checkbox?.groupKey;

// --- dates -------------------------------------------------------------------------------

/**
 * formatSdtDate renders a date with a content-control date format. Word's
 * pictures are case-sensitive (MM month, mm minutes); OnlyOffice's date
 * picker uses "mm/dd/yyyy" and "DD-MM-YYYY", so without an hour token
 * `m` means month and `D` / `Y` read as `d` / `y`.
 */
export function formatSdtDate(iso: string, format: string): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  let f = format || DEFAULT_DATE_FORMAT;
  if (!/[hH]/.test(f)) f = f.replace(/m/g, "M");
  f = f.replace(/D/g, "d").replace(/Y/g, "y");
  return formatDate(d, f);
}

/** parseIsoDate reads yyyy-mm-dd (with an optional time) as a local date. */
export function parseIsoDate(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s ?? "").trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) || d.getMonth() !== +m[2] - 1 ? null : d;
}

export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** parseDisplayedDate reads a date shown with `format` back (numbers in
 *  the format's day / month / year order). Null when it doesn't parse. */
export function parseDisplayedDate(text: string, format: string): string | null {
  const iso = parseIsoDate(text);
  if (iso) return isoDate(iso);
  const nums = text.match(/\d+/g);
  if (!nums || nums.length < 3) return null;
  let f = format || DEFAULT_DATE_FORMAT;
  if (!/[hH]/.test(f)) f = f.replace(/m/g, "M");
  f = f.replace(/D/g, "d").replace(/Y/g, "y");
  const order = (f.match(/d+|M+|y+/g) ?? []).map((t) => t[0]);
  if (order.length < 3) return null;
  const at = (c: string) => nums[order.indexOf(c)];
  let y = +at("y");
  if (y < 100) y += 2000;
  const d = new Date(y, +at("M") - 1, +at("d"));
  return Number.isNaN(d.getTime()) || d.getMonth() !== +at("M") - 1 ? null : isoDate(d);
}

// --- colours -----------------------------------------------------------------------------

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Word's default theme accents (Grown has no document theme; theme
 *  colours resolve to these for display). */
export const THEME_COLORS: Record<string, string> = {
  accent1: "#4472c4",
  accent2: "#ed7d31",
  accent3: "#a5a5a5",
  accent4: "#ffc000",
  accent5: "#5b9bd5",
  accent6: "#70ad47",
  text1: "#000000",
  text2: "#44546a",
  background1: "#ffffff",
  background2: "#e7e6e6",
};

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

export function rgbaToHex({ r, g, b, a }: Rgba): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a >= 255 ? "" : hex2(a)}`;
}

/** colorRgba reads "#rgb", "#rrggbb" or "#rrggbbaa"; null otherwise. */
export function colorRgba(c: string | null | undefined): Rgba | null {
  if (!c) return null;
  if (c.startsWith("theme:")) return colorRgba(THEME_COLORS[c.slice(6)] ?? null);
  let h = c.replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, "$&$&");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 255 };
}

/** cssColor: a stored colour for CSS (theme colours resolved). */
export function cssColor(c: string | null | undefined): string | null {
  const v = colorRgba(c);
  if (!v) return null;
  return v.a >= 255 ? `#${hex2(v.r)}${hex2(v.g)}${hex2(v.b)}` : `rgba(${v.r}, ${v.g}, ${v.b}, ${(v.a / 255).toFixed(3)})`;
}

// --- the value a control stands for ------------------------------------------------------

/** innerText: the text of a control's content (placeholder included). */
export function innerText(node: PMNode): string {
  if (node.type.name === SDT_BLOCK) {
    const out: string[] = [];
    node.descendants((n) => {
      if (n.isTextblock) {
        out.push(n.textContent);
        return false;
      }
      return true;
    });
    return out.join("\n");
  }
  return node.textContent;
}

/** sdtValue: what a control's value is (placeholder = ""). Checkboxes are
 *  booleans; lists give the chosen text; dates the displayed date. */
export function sdtValue(node: PMNode): string | boolean {
  const pr = prOf(node);
  if (pr.type === "checkbox") return !!pr.checkbox?.checked;
  if (pr.type === "picture") return pr.picture?.src ?? "";
  if (node.attrs.plc) return "";
  return innerText(node);
}

/** Value of a list item for the displayed text (OnlyOffice: the value of
 *  the item whose label matches, else the text itself). */
export function listValue(pr: SdtPr, text: string): string {
  return pr.items?.find((i) => i.label === text)?.value ?? text;
}
