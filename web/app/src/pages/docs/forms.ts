// Fillable forms in documents (Docs M10): OnlyOffice-style form fields
// are content controls with form properties (sdtModel.ts FormPr). This
// file is the pure side: text-form formats (the Grown Forms app's CC4
// masks, formats and presets are reused, so a document field and a Forms
// question validate the same way), what "filled" means, the field list and
// its values as JSON (OnlyOffice GetAllFormsData / SetAllFormsData), and
// required-field checks. Editing rules and the fill-in view are in sdt.ts.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { formatMask, maskCorrect, maskLength, TextFormFormat } from "../forms/validate";
import { innerText, isSdt, listValue, parseDisplayedDate, prOf, type SdtPr, type TextFormat } from "./sdtModel";
import { selectListItem, setCheckbox, setSdtDate, setSdtPicture, setSdtText } from "./sdt";

// --- formats -----------------------------------------------------------------------------

/** textFormFormat builds the validator for a text field's format. */
export function textFormFormat(pr: SdtPr): TextFormFormat {
  const f = new TextFormFormat();
  const fmt = pr.textForm?.format;
  if (fmt?.symbols) f.setSymbols(fmt.symbols);
  switch (fmt?.type) {
    case "digit":
      f.setDigit();
      break;
    case "letter":
      f.setLetter();
      break;
    case "mask":
      f.setMask(fmt.value ?? "");
      break;
    case "regexp":
      f.setRegExp(fmt.value ?? "");
      break;
    default:
      f.setNone();
  }
  return f;
}

/** Maximum characters of a text field (-1 = unlimited): a mask's length,
 *  else maxChars. */
export function maxCharacters(pr: SdtPr): number {
  const fmt = pr.textForm?.format;
  if (fmt?.type === "mask" && fmt.value) return maskLength(fmt.value);
  const m = pr.textForm?.maxChars;
  return m != null && m > 0 ? m : -1;
}

export type FormPreset = "none" | "digits" | "letters" | "email" | "phone" | "zip" | "creditCard" | "mask" | "regexp";

export const EMAIL_REGEXP = "[^\\s@]+@[^\\s@]+\\.[^\\s@]+";

/** The format a preset stands for (phone, ZIP and card masks are the Forms
 *  app's; e-mail is a regular expression). */
export function presetFormat(p: FormPreset, value = ""): TextFormat {
  switch (p) {
    case "digits":
      return { type: "digit" };
    case "letters":
      return { type: "letter" };
    case "email":
      return { type: "regexp", value: EMAIL_REGEXP };
    case "phone":
      return { type: "mask", value: formatMask("phone") };
    case "zip":
      return { type: "mask", value: formatMask("zip") };
    case "creditCard":
      return { type: "mask", value: formatMask("credit_card") };
    case "mask":
      return { type: "mask", value };
    case "regexp":
      return { type: "regexp", value };
    default:
      return { type: "none" };
  }
}

/** Which preset a format is (for the settings dialog). */
export function formatPreset(f: TextFormat | undefined): FormPreset {
  if (!f || f.type === "none") return "none";
  if (f.type === "digit") return "digits";
  if (f.type === "letter") return "letters";
  if (f.type === "regexp") return f.value === EMAIL_REGEXP ? "email" : "regexp";
  if (f.value === formatMask("phone")) return "phone";
  if (f.value === formatMask("zip")) return "zip";
  if (f.value === formatMask("credit_card")) return "creditCard";
  return "mask";
}

export type TypeCheck = { ok: true; text: string; caret: number } | { ok: false; full: boolean };

/**
 * checkOnType decides what typing `text` over [a, b) of a text field's
 * current value does: characters the format forbids are dropped, a field at
 * its maximum length is "full", and a mask fills in literals the user
 * skipped ("9991231122" → "(999) 123-1122"). Mask and regexp values are
 * checked completely when the field is left (sdt.ts), as OnlyOffice does.
 */
export function checkOnType(pr: SdtPr, current: string, a: number, b: number, text: string): TypeCheck {
  const f = textFormFormat(pr);
  const next = current.slice(0, a) + text + current.slice(b);
  const max = maxCharacters(pr);
  if (max > 0 && Array.from(next).length > max) return { ok: false, full: true };
  if (!f.checkOnFly(next)) return { ok: false, full: false };
  const fmt = pr.textForm?.format;
  if (fmt?.type === "mask" && fmt.value && b === current.length) {
    const corrected = maskCorrect(fmt.value, next);
    if (Array.from(corrected).length > max && max > 0) return { ok: false, full: true };
    return { ok: true, text: corrected, caret: a + text.length + (corrected.length - next.length) };
  }
  return { ok: true, text: next, caret: a + text.length };
}

// --- filled / required -------------------------------------------------------------------

/** Sub-forms of a complex form (direct form descendants). */
export function subForms(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.descendants((n) => {
    if (isSdt(n)) {
      if (prOf(n).form || prOf(n).type !== "complex") out.push(n);
      return false;
    }
    return true;
  });
  return out;
}

/** formFilled: the field has a value (a text value that fits its format
 *  completely; a checked box; a chosen item or date; a picture; every
 *  sub-field of a complex form). */
export function formFilled(node: PMNode): boolean {
  const pr = prOf(node);
  switch (pr.type) {
    case "checkbox":
      return !!pr.checkbox?.checked;
    case "picture":
      return !!pr.picture?.src;
    case "complex": {
      const subs = subForms(node);
      return subs.length > 0 && subs.every(formFilled);
    }
    case "text": {
      if (node.attrs.plc) return false;
      const v = innerText(node);
      return !!v && textFormFormat(pr).check(v, true);
    }
    default:
      return !node.attrs.plc && !!innerText(node);
  }
}

export interface FormHit {
  node: PMNode;
  pos: number;
}

/** allForms: the document's form fields that are not inside another form
 *  (a complex form counts once), in document order. */
export function allForms(doc: PMNode): FormHit[] {
  const out: FormHit[] = [];
  doc.descendants((n, pos) => {
    if (isSdt(n) && prOf(n).form) {
      out.push({ node: n, pos });
      return false;
    }
    return true;
  });
  return out;
}

/** Every form field including sub-fields of complex forms. */
export function allFields(doc: PMNode): FormHit[] {
  const out: FormHit[] = [];
  doc.descendants((n, pos) => {
    if (isSdt(n) && prOf(n).form) out.push({ node: n, pos });
    return true;
  });
  return out;
}

/** Why a field isn't acceptable ("required" / "format"), or null. */
export function fieldProblem(node: PMNode, doc?: PMNode): "required" | "format" | null {
  const pr = prOf(node);
  if (pr.type === "text" && !node.attrs.plc) {
    const v = innerText(node);
    if (v && !textFormFormat(pr).check(v, true)) return "format";
  }
  if (pr.type === "complex") for (const s of subForms(node)) if (fieldProblem(s) === "format") return "format";
  if (!pr.form?.required) return null;
  if (pr.type === "checkbox" && pr.checkbox?.groupKey && doc) {
    const key = pr.checkbox.groupKey;
    return allForms(doc).some((h) => prOf(h.node).checkbox?.groupKey === key && prOf(h.node).checkbox?.checked) ? null : "required";
  }
  return formFilled(node) ? null : "required";
}

/** isAllRequiredFormsFilled: every required field filled, and every text
 *  value fits its format (OnlyOffice counts a wrongly formatted value as
 *  not filled even when the field isn't required). */
export function isAllRequiredFormsFilled(doc: PMNode): boolean {
  return allForms(doc).every((h) => fieldProblem(h.node, doc) === null);
}

// --- values as JSON ----------------------------------------------------------------------

export type FormType = "text" | "radio" | "checkBox" | "dropDownList" | "comboBox" | "dateTime" | "picture" | "complex";

export interface FormData {
  key: string;
  value: string | boolean;
  tag: string;
  type: FormType;
  role: string;
  required?: boolean;
  options?: ({ value: string; label: string } | boolean)[];
  label?: string;
  format?: string;
  lang?: string;
}

export function formType(pr: SdtPr): FormType {
  switch (pr.type) {
    case "checkbox":
      return pr.checkbox?.groupKey ? "radio" : "checkBox";
    case "dropDownList":
      return "dropDownList";
    case "comboBox":
      return "comboBox";
    case "date":
      return "dateTime";
    case "picture":
      return "picture";
    case "complex":
      return "complex";
    default:
      return "text";
  }
}

/** The key a field reports under: its form key, a radio button's group. */
export function formKey(pr: SdtPr): string {
  if (pr.type === "checkbox" && pr.checkbox?.groupKey) return pr.checkbox.groupKey;
  return pr.form?.key ?? "";
}

function fieldValue(node: PMNode): string | boolean {
  const pr = prOf(node);
  if (pr.type === "checkbox") return !!pr.checkbox?.checked;
  if (pr.type === "picture") return pr.picture?.src ?? "";
  if (node.attrs.plc) return "";
  const text = innerText(node);
  if (pr.type === "dropDownList" || pr.type === "comboBox") return listValue(pr, text);
  return text;
}

/**
 * getAllFormsData lists the document's fields with their values, one entry
 * per key (fields sharing a key share a value; a radio group is one entry
 * whose options are its choices). Shapes follow OnlyOffice's
 * GetAllFormsData.
 */
export function getAllFormsData(doc: PMNode): FormData[] {
  const out: FormData[] = [];
  const byKey = new Map<string, FormData>();
  for (const { node } of allForms(doc)) {
    const pr = prOf(node);
    const type = formType(pr);
    const key = formKey(pr);
    const prev = byKey.get(`${type}\u0000${key}`);
    if (type === "radio") {
      const choice = pr.checkbox?.choiceName ?? "";
      if (prev) {
        prev.options!.push({ value: choice, label: "" });
        if (pr.checkbox?.checked) prev.value = choice;
        if (pr.form?.required) prev.required = true;
        continue;
      }
      const d: FormData = { key, value: pr.checkbox?.checked ? choice : "", tag: pr.tag ?? "", type, role: pr.form?.role ?? "", options: [{ value: choice, label: "" }] };
      if (pr.form?.required) d.required = true;
      byKey.set(`${type}\u0000${key}`, d);
      out.push(d);
      continue;
    }
    if (prev && key) continue;
    const d: FormData = { key, value: fieldValue(node), tag: pr.tag ?? "", type, role: pr.form?.role ?? "" };
    if (pr.form?.required) d.required = true;
    if (type === "checkBox") {
      d.options = [true, false];
      d.label = pr.form?.label ?? "";
    }
    if (type === "dropDownList" || type === "comboBox") d.options = (pr.items ?? []).map((i) => ({ value: i.value, label: i.label }));
    if (type === "dateTime") {
      d.format = pr.date?.format ?? "";
      d.lang = pr.date?.lang ?? "en-US";
    }
    if (key) byKey.set(`${type}\u0000${key}`, d);
    out.push(d);
  }
  return out;
}

/** formsDataJson: the values as a JSON object keyed by field key (what a
 *  submitted form sends). */
export function formsValues(doc: PMNode): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const d of getAllFormsData(doc)) if (d.key) out[d.key] = d.value;
  return out;
}

export interface FormDataIn {
  key: string;
  value: string | boolean;
  type?: string;
}

/**
 * setAllFormsData fills fields by key: every text field with the key, the
 * radio button whose choice name is the value (the rest of its group
 * unchecked), check boxes, lists (by value or label) and dates (ISO or in
 * the field's format). Unknown keys are ignored.
 */
export function setAllFormsData(editor: Editor, data: FormDataIn[]): void {
  for (const item of data) {
    const hits = allForms(editor.state.doc).filter((h) => formKey(prOf(h.node)) === item.key && (!item.type || formType(prOf(h.node)) === item.type));
    // Positions shift as fields change: apply from the end.
    for (const h of [...hits].reverse()) {
      const node = editor.state.doc.nodeAt(h.pos);
      if (!isSdt(node)) continue;
      const pr = prOf(node);
      if (pr.type === "checkbox") {
        if (pr.checkbox?.groupKey) {
          if (pr.checkbox.choiceName === item.value) setCheckbox(editor, h.pos, true);
        } else setCheckbox(editor, h.pos, item.value === true || item.value === "true");
      } else if (pr.type === "dropDownList" || pr.type === "comboBox") selectListItem(editor, h.pos, String(item.value));
      else if (pr.type === "date") {
        const iso = parseDisplayedDate(String(item.value), pr.date?.format ?? "");
        if (iso) setSdtDate(editor, h.pos, iso);
      } else if (pr.type === "picture") setSdtPicture(editor, h.pos, String(item.value) || null);
      else setSdtText(editor, h.pos, String(item.value));
    }
  }
}
