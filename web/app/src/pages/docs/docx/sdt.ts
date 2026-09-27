// Content controls, forms, document protection and custom XML in DOCX
// (Docs M10), both ways.
//   - w:sdt / w:sdtPr: alias, tag, id, lock, temporary, showingPlcHdr,
//     w:dataBinding, w15:color, w15:appearance and the type (w:text,
//     w14:checkbox, w:comboBox, w:dropDownList, w:date, w:picture; rich
//     text has none). Form properties Word has no element for (form key,
//     required, role, text-form format, radio group, placeholder text,
//     colours) go into a Grown extension element <gf:pr> in an ignorable
//     namespace, so Word and LibreOffice skip it. OnlyOffice's own
//     w:formPr / w:textFormPr / w:complexFormPr and w14:groupKey are read.
//   - w:documentProtection in settings.xml (w:edit, w:enforcement and the
//     SHA-512 hash, salt and spin count).
//   - customXml/itemN.xml parts with their itemPropsN.xml (ds:itemID and
//     schema references).
import JSZip from "jszip";
import type { Protection, ProtectionMode } from "../protection";
import type { CustomXmlPart } from "../customXml";
import { DEFAULT_PLACEHOLDER, defaultPr, type CheckboxPr, type SdtPr, type SdtType } from "../sdtModel";
import { attr, descendants, el, kid, kids, nameOf, onOff, parseXml } from "./xml";

// --- reading sdtPr -----------------------------------------------------------------------

const hexChar = (v: string | null, fallback: string) => {
  const n = v ? parseInt(v, 16) : NaN;
  return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : fallback;
};

const color = (v: string | null): string | null => (v && /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null);

export interface ReadSdt {
  pr: SdtPr;
  plc: boolean;
  id: string | null;
  /** Building-block controls (TOC etc.) are unwrapped. */
  unwrap: boolean;
  /** The placeholder text was stored (else a shown placeholder is it). */
  placeholderKnown: boolean;
}

/** readSdtPr maps a w:sdtPr (null when the sdt has none). */
export function readSdtPr(sdtPr: Element | null): ReadSdt {
  const k = (n: string) => kid(sdtPr, n);
  let type: SdtType = "richText";
  const cb = k("checkbox");
  const combo = k("comboBox");
  const drop = k("dropDownList");
  const date = k("date");
  if (cb) type = "checkbox";
  else if (combo) type = "comboBox";
  else if (drop) type = "dropDownList";
  else if (date) type = "date";
  else if (k("picture")) type = "picture";
  else if (k("text")) type = "text";
  if (k("complexFormPr")) type = "complex";
  const pr: SdtPr = defaultPr(type);
  delete pr.placeholder;
  const alias = attr(k("alias"), "w:val");
  if (alias) pr.alias = alias;
  const tag = attr(k("tag"), "w:val");
  if (tag) pr.tag = tag;
  const lock = attr(k("lock"), "w:val");
  if (lock === "sdtLocked" || lock === "contentLocked" || lock === "sdtContentLocked") pr.lock = lock;
  if (onOff(k("temporary"))) pr.temporary = true;
  const c = color(attr(k("color"), "w15:val") ?? attr(k("color"), "w:val"));
  if (c) pr.color = c;
  const app = attr(k("appearance"), "w15:val");
  if (app === "tags" || app === "hidden") pr.appearance = app;
  if (type === "text" && /^(1|true)$/.test(attr(k("text"), "w:multiLine") ?? "")) pr.multiLine = true;
  if (cb) {
    const st = (n: string) => kid(cb, n);
    const box: CheckboxPr = {
      checked: /^(1|true)$/.test(attr(st("checked"), "w14:val") ?? attr(st("checked"), "w:val") ?? "0"),
      checkedSymbol: hexChar(attr(st("checkedState"), "w14:val") ?? attr(st("checkedState"), "w:val"), "☒"),
      uncheckedSymbol: hexChar(attr(st("uncheckedState"), "w14:val") ?? attr(st("uncheckedState"), "w:val"), "☐"),
    };
    const font = attr(st("checkedState"), "w14:font");
    if (font) box.font = font;
    const group = attr(st("groupKey"), "w14:val") ?? attr(st("groupKey"), "w:val");
    if (group) box.groupKey = group;
    pr.checkbox = box;
  }
  const list = combo ?? drop;
  if (list)
    pr.items = kids(list, "listItem").map((li) => ({
      label: attr(li, "w:displayText") ?? attr(li, "w:value") ?? "",
      value: attr(li, "w:value") ?? attr(li, "w:displayText") ?? "",
    }));
  if (date) {
    const full = attr(date, "w:fullDate");
    pr.date = {
      format: attr(kid(date, "dateFormat"), "w:val") ?? "M/d/yyyy",
      full: full ? full.slice(0, 10) : null,
    };
    const lid = attr(kid(date, "lid"), "w:val");
    if (lid) pr.date.lang = lid;
  }
  const db = k("dataBinding");
  if (db)
    pr.dataBinding = {
      prefix: attr(db, "w:prefixMappings") ?? "",
      xpath: attr(db, "w:xpath") ?? "",
      storeItemId: attr(db, "w:storeItemID") ?? "",
    };
  const gallery = attr(kid(k("docPartObj"), "docPartGallery"), "w:val");
  if (gallery) pr.docPartGallery = gallery;
  // OnlyOffice form properties.
  const formPr = k("formPr");
  if (formPr) {
    pr.form = { key: attr(formPr, "w:key") ?? "" };
    const label = attr(formPr, "w:label");
    const help = attr(formPr, "w:helpText");
    if (label) pr.form.label = label;
    if (help) pr.form.helpText = help;
    if (/^(1|true)$/.test(attr(formPr, "w:required") ?? "")) pr.form.required = true;
  }
  const tf = k("textFormPr");
  if (tf) {
    pr.textForm = {};
    if (onOff(kid(tf, "comb"))) pr.textForm.comb = true;
    const max = attr(kid(tf, "maxCharacters"), "w:val");
    if (max && +max > 0) pr.textForm.maxChars = +max;
    const f = kid(tf, "format");
    const ft = attr(f, "w:type");
    if (ft === "digit" || ft === "letter" || ft === "mask" || ft === "regexp")
      pr.textForm.format = { type: ft, ...(attr(f, "w:val") ? { value: attr(f, "w:val")! } : {}), ...(attr(f, "w:symbols") ? { symbols: attr(f, "w:symbols")! } : {}) };
    if (onOff(kid(tf, "multiLine"))) pr.textForm.multiLine = true;
    if (onOff(kid(tf, "autoFit"))) pr.textForm.autoFit = true;
    if (pr.type === "richText") pr.type = "text";
  }
  // Grown's own extension wins (it is what Grown wrote).
  const g = k("pr");
  if (g && nameOf(g) === "pr") {
    try {
      const ext = JSON.parse(attr(g, "gf:json") ?? attr(g, "json") ?? "{}") as Partial<SdtPr>;
      const box = pr.checkbox;
      Object.assign(pr, ext);
      if (ext.checkbox && box) pr.checkbox = { ...box, ...ext.checkbox };
      if (ext.picture) pr.picture = { ...ext.picture, src: null };
    } catch {
      /* ignore */
    }
  }
  const placeholderKnown = !!pr.placeholder;
  if (!pr.placeholder && DEFAULT_PLACEHOLDER[pr.type]) pr.placeholder = DEFAULT_PLACEHOLDER[pr.type];
  return {
    placeholderKnown,
    pr,
    plc: onOff(k("showingPlcHdr")) === true,
    id: attr(k("id"), "w:val"),
    unwrap: !!gallery || !!k("docPartList") || !!k("equation") || !!k("citation") || !!k("bibliography"),
  };
}

// --- writing sdtPr -----------------------------------------------------------------------

const hex = (s: string) => (s.codePointAt(0) ?? 0x2610).toString(16).toUpperCase().padStart(4, "0");
const hex6 = (c: string | null | undefined) => (c && /^#[0-9a-f]{6}/i.test(c) ? c.slice(1, 7).toUpperCase() : null);

/** sdtPrXml writes w:sdtPr for a control. */
export function sdtPrXml(pr: SdtPr, plc: boolean, id: string | number): string {
  let out = "";
  if (pr.alias) out += el("w:alias", { "w:val": pr.alias });
  if (pr.tag) out += el("w:tag", { "w:val": pr.tag });
  out += el("w:id", { "w:val": id });
  if (pr.lock && pr.lock !== "unlocked") out += el("w:lock", { "w:val": pr.lock });
  if (pr.temporary) out += el("w:temporary");
  if (plc) out += el("w:showingPlcHdr");
  if (pr.dataBinding)
    out += el("w:dataBinding", { "w:prefixMappings": pr.dataBinding.prefix || undefined, "w:xpath": pr.dataBinding.xpath, "w:storeItemID": pr.dataBinding.storeItemId });
  const c = hex6(pr.color);
  if (c) out += el("w15:color", { "w15:val": c });
  if (pr.appearance && pr.appearance !== "boundingBox") out += el("w15:appearance", { "w15:val": pr.appearance });
  switch (pr.type) {
    case "text":
      out += el("w:text", pr.multiLine ? { "w:multiLine": 1 } : {});
      break;
    case "comboBox":
    case "dropDownList":
      out += el(pr.type === "comboBox" ? "w:comboBox" : "w:dropDownList", {}, (pr.items ?? []).map((i) => el("w:listItem", { "w:displayText": i.label, "w:value": i.value })).join(""));
      break;
    case "date": {
      const d = pr.date;
      out += el(
        "w:date",
        d?.full ? { "w:fullDate": `${d.full}T00:00:00Z` } : {},
        el("w:dateFormat", { "w:val": d?.format ?? "M/d/yyyy" }) + (d?.lang ? el("w:lid", { "w:val": d.lang }) : "") + el("w:storeMappedDataAs", { "w:val": "dateTime" }) + el("w:calendar", { "w:val": "gregorian" }),
      );
      break;
    }
    case "picture":
      out += el("w:picture");
      break;
    case "checkbox": {
      const b = pr.checkbox!;
      const font = b.font;
      out += el(
        "w14:checkbox",
        {},
        el("w14:checked", { "w14:val": b.checked ? 1 : 0 }) +
          el("w14:checkedState", { "w14:val": hex(b.checkedSymbol), "w14:font": font }) +
          el("w14:uncheckedState", { "w14:val": hex(b.uncheckedSymbol), "w14:font": font }),
      );
      break;
    }
    default:
      break;
  }
  // Grown's extension: what Word has no element for.
  const ext: Partial<SdtPr> = {};
  if (pr.type === "complex") ext.type = "complex";
  if (pr.form) ext.form = pr.form;
  if (pr.textForm) ext.textForm = pr.textForm;
  if (pr.placeholder && pr.placeholder !== DEFAULT_PLACEHOLDER[pr.type]) ext.placeholder = pr.placeholder;
  if (pr.borderColor) ext.borderColor = pr.borderColor;
  if (pr.backgroundColor) ext.backgroundColor = pr.backgroundColor;
  if (pr.color && !hex6(pr.color)) ext.color = pr.color;
  if (pr.checkbox?.groupKey) ext.checkbox = { groupKey: pr.checkbox.groupKey, choiceName: pr.checkbox.choiceName } as CheckboxPr;
  if (pr.picture?.width || pr.picture?.height) ext.picture = { src: null, width: pr.picture.width, height: pr.picture.height };
  if (Object.keys(ext).length) out += el("gf:pr", { "gf:json": JSON.stringify(ext) });
  return `<w:sdtPr>${out}</w:sdtPr>`;
}

// --- document protection -----------------------------------------------------------------

const EDIT: Record<string, ProtectionMode> = { readOnly: "readOnly", comments: "comments", trackedChanges: "trackedChanges", forms: "forms" };

/** readDocProtection reads settings.xml's w:documentProtection. */
export function readDocProtection(settings: Document | null): Protection | null {
  const dp = settings ? kid(settings.documentElement, "documentProtection") : null;
  if (!dp) return null;
  const mode = EDIT[attr(dp, "w:edit") ?? ""];
  if (!mode) return null;
  const enforced = /^(1|true|on)$/i.test(attr(dp, "w:enforcement") ?? "0");
  const p: Protection = { mode, enforced };
  const hash = attr(dp, "w:hashValue");
  if (hash) {
    p.hash = hash;
    p.salt = attr(dp, "w:saltValue") ?? undefined;
    p.spinCount = Number(attr(dp, "w:spinCount") ?? 100000);
    p.algorithm = attr(dp, "w:algorithmName") ?? "SHA-512";
  } else if (attr(dp, "w:hash")) {
    // Word's transitional form hashes a legacy key of the password; Grown
    // keeps it but can't check it (the owner can remove protection).
    p.hash = attr(dp, "w:hash")!;
    p.salt = attr(dp, "w:salt") ?? undefined;
    p.spinCount = Number(attr(dp, "w:cryptSpinCount") ?? 100000);
    p.algorithm = "word-legacy";
  }
  return p;
}

/** documentProtectionXml: the settings.xml element (empty when none). */
export function documentProtectionXml(p: Protection | null | undefined): string {
  if (!p || p.mode === "none") return "";
  const a: Record<string, string | number | undefined> = { "w:edit": p.mode, "w:enforcement": p.enforced ? 1 : 0 };
  if (p.hash && p.algorithm !== "word-legacy") {
    a["w:algorithmName"] = "SHA-512";
    a["w:hashValue"] = p.hash;
    a["w:saltValue"] = p.salt;
    a["w:spinCount"] = p.spinCount ?? 100000;
  }
  return el("w:documentProtection", a);
}

// --- custom XML parts --------------------------------------------------------------------

const DS = "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
export const CUSTOM_XML_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml";
const PROPS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps";

/** readCustomXml loads the parts the main document relates to (and, as
 *  Word does, any customXml/item*.xml in the package). */
export async function readCustomXml(zip: JSZip, targets: string[]): Promise<CustomXmlPart[]> {
  const paths = new Set(targets);
  for (const name of Object.keys(zip.files)) if (/^customXml\/item\d+\.xml$/i.test(name)) paths.add(name);
  const out: CustomXmlPart[] = [];
  for (const p of paths) {
    const f = zip.file(p);
    if (!f) continue;
    const xml = await f.async("string");
    const relsPath = p.replace(/([^/]+)$/, "_rels/$1.rels");
    let itemId = `{${crypto.randomUUID?.() ?? `${Date.now()}`}}`.toUpperCase();
    let uris: string[] = [];
    const rels = zip.file(relsPath);
    if (rels) {
      const r = parseXml(await rels.async("string"));
      const target = descendants(r, "Relationship").find((x) => /customXmlProps$/.test(attr(x, "Type") ?? ""));
      const t = target && attr(target, "Target");
      const propsFile = t && zip.file(p.replace(/[^/]+$/, "") + t);
      if (propsFile) {
        const props = parseXml(await propsFile.async("string"));
        const root = props.documentElement;
        itemId = attr(root, "ds:itemID") ?? itemId;
        uris = descendants(props, "schemaRef").map((s) => attr(s, "ds:uri") ?? "").filter(Boolean);
      }
    }
    out.push({ itemId, uris, xml });
  }
  return out;
}

/** writeCustomXml adds the parts; returns their paths relative to word/. */
export function writeCustomXml(zip: JSZip, parts: CustomXmlPart[], override: (path: string, type: string) => void): string[] {
  const out: string[] = [];
  parts.forEach((p, i) => {
    const n = i + 1;
    zip.file(`customXml/item${n}.xml`, p.xml);
    zip.file(
      `customXml/itemProps${n}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<ds:datastoreItem ds:itemID="${p.itemId}" xmlns:ds="${DS}"><ds:schemaRefs>${p.uris
        .map((u) => `<ds:schemaRef ds:uri="${u.replace(/"/g, "&quot;")}"/>`)
        .join("")}</ds:schemaRefs></ds:datastoreItem>`,
    );
    zip.file(
      `customXml/_rels/item${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${PROPS_REL}" Target="itemProps${n}.xml"/></Relationships>`,
    );
    override(`customXml/itemProps${n}.xml`, "application/vnd.openxmlformats-officedocument.customXmlProperties+xml");
    out.push(`../customXml/item${n}.xml`);
  });
  return out;
}
