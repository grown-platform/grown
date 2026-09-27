// CC3 — AcroForm field actions <-> pdf-lib.
//
// Export side: write a field's `/AA` (C/F/K/V JavaScript actions), the
// document calculation order `/AcroForm /CO`, and push-button actions
// (native `/ResetForm` and `/Hide`, JavaScript only for toggle).
// Import side: turn an existing PDF's AcroForm into editor field models
// (text/checkbox/radio/dropdown/listbox/push button, with their actions and
// `/CO` order) and remove those fields from the base bytes so the editor owns
// them. JavaScript is only ever stored and pattern-parsed (formCalc.ts), never run.

import {
  PDFArray,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRawStream,
  PDFRef,
  PDFString,
  PDFTextField,
  decodePDFRawStream,
  type PDFContext,
  type PDFField,
  type PDFForm,
  type PDFObject,
} from "pdf-lib";
import type { CalcField, FieldActions } from "./formCalc";

export type ButtonAction =
  | { kind: "none" }
  | { kind: "reset" }
  | { kind: "submit" }
  | { kind: "hide" | "show" | "toggle"; targets: string[] };

/** Everything the editor's FieldAnnotation carries, minus its id. */
export interface PdfFieldModel extends CalcField {
  page: number; // 1-based
  x: number; // normalized, top-left origin
  y: number;
  width: number;
  height: number;
  options?: string[];
  multiSelect?: boolean;
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  fontSize?: number;
  label?: string;
  buttonAction?: ButtonAction;
}

const ANNOT_HIDDEN = 1 << 1;
const AA_KEYS: (keyof FieldActions)[] = ["C", "F", "K", "V"];

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function jsAction(ctx: PDFContext, js: string): PDFDict {
  const d = ctx.obj({});
  d.set(PDFName.of("S"), PDFName.of("JavaScript"));
  d.set(PDFName.of("JS"), PDFHexString.fromText(js));
  return d;
}

/** Set `/AA` on a field dictionary from the non-empty scripts in `actions`. */
export function writeFieldActions(field: PDFField, actions: FieldActions | undefined): void {
  if (!actions) return;
  const ctx = field.acroField.dict.context;
  const aa = ctx.obj({});
  let any = false;
  for (const k of AA_KEYS) {
    const js = actions[k];
    if (js && js.trim()) {
      aa.set(PDFName.of(k), jsAction(ctx, js));
      any = true;
    }
  }
  if (any) field.acroField.dict.set(PDFName.of("AA"), aa);
}

/** Write `/AcroForm /CO` (calculation order) as refs to the given fields. */
export function writeCalcOrder(form: PDFForm, fields: PDFField[]): void {
  if (!fields.length) return;
  const ctx = form.acroForm.dict.context;
  form.acroForm.dict.set(PDFName.of("CO"), ctx.obj(fields.map((f) => f.ref)));
}

/** Attach a push button's action to its widget(s) (`/A`). */
export function writeButtonAction(btn: PDFButton, action: ButtonAction | undefined): void {
  if (!action || action.kind === "none" || action.kind === "submit") return; // submit is disabled
  const ctx = btn.acroField.dict.context;
  let a: PDFDict;
  if (action.kind === "reset") {
    a = ctx.obj({});
    a.set(PDFName.of("S"), PDFName.of("ResetForm"));
  } else if (action.kind === "hide" || action.kind === "show") {
    if (!action.targets.length) return;
    a = ctx.obj({});
    a.set(PDFName.of("S"), PDFName.of("Hide"));
    a.set(PDFName.of("T"), ctx.obj(action.targets.map((t) => PDFHexString.fromText(t))));
    a.set(PDFName.of("H"), ctx.obj(action.kind === "hide"));
  } else {
    if (!action.targets.length) return;
    const js = action.targets
      .map(
        (t) =>
          `var f = this.getField(${JSON.stringify(t)}); if (f) f.display = (f.display == display.hidden) ? display.visible : display.hidden;`,
      )
      .join("\n");
    a = jsAction(ctx, js);
  }
  for (const w of btn.acroField.getWidgets()) w.dict.set(PDFName.of("A"), a);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function decodeJs(obj: PDFObject | undefined): string | undefined {
  if (!obj) return undefined;
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  if (obj instanceof PDFRawStream) {
    try {
      const bytes = decodePDFRawStream(obj).decode();
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.slice(2));
      return new TextDecoder("latin1").decode(bytes);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function readJsAction(dict: PDFDict | undefined): string | undefined {
  if (!dict) return undefined;
  const s = dict.lookup(PDFName.of("S"));
  if (!(s instanceof PDFName) || s.asString() !== "/JavaScript") return undefined;
  return decodeJs(dict.lookup(PDFName.of("JS")));
}

function readFieldActions(dict: PDFDict): FieldActions | undefined {
  const aa = dict.lookup(PDFName.of("AA"));
  if (!(aa instanceof PDFDict)) return undefined;
  const out: FieldActions = {};
  for (const k of AA_KEYS) {
    const a = aa.lookup(PDFName.of(k));
    const js = readJsAction(a instanceof PDFDict ? a : undefined);
    if (js) out[k] = js;
  }
  return Object.keys(out).length ? out : undefined;
}

function textOf(o: PDFObject | undefined): string | null {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  if (o instanceof PDFName) return o.decodeText();
  return null;
}

function readButtonAction(widgetDict: PDFDict, fieldDict: PDFDict): ButtonAction {
  let a = widgetDict.lookup(PDFName.of("A"));
  if (!(a instanceof PDFDict)) {
    // Mouse-up additional action on the widget or field.
    for (const d of [widgetDict, fieldDict]) {
      const aa = d.lookup(PDFName.of("AA"));
      const u = aa instanceof PDFDict ? aa.lookup(PDFName.of("U")) : undefined;
      if (u instanceof PDFDict) {
        a = u;
        break;
      }
    }
  }
  if (!(a instanceof PDFDict)) return { kind: "none" };
  const s = a.lookup(PDFName.of("S"));
  const kind = s instanceof PDFName ? s.asString() : "";
  if (kind === "/ResetForm") return { kind: "reset" };
  if (kind === "/SubmitForm") return { kind: "submit" };
  if (kind === "/Hide") {
    const t = a.lookup(PDFName.of("T"));
    const targets: string[] = [];
    if (t instanceof PDFArray) {
      for (let i = 0; i < t.size(); i++) {
        const v = textOf(t.lookup(i));
        if (v) targets.push(v);
      }
    } else {
      const v = textOf(t);
      if (v) targets.push(v);
    }
    const h = a.lookup(PDFName.of("H"));
    const hide = h === undefined || h.toString() !== "false";
    return { kind: hide ? "hide" : "show", targets };
  }
  if (kind === "/JavaScript") return parseButtonScript(decodeJs(a.lookup(PDFName.of("JS"))) ?? "");
  return { kind: "none" };
}

/** Recognise the few button scripts we support: resetForm, submitForm, show/hide/toggle. */
export function parseButtonScript(js: string): ButtonAction {
  if (/\bresetForm\s*\(/.test(js)) return { kind: "reset" };
  if (/\bsubmitForm\s*\(/.test(js)) return { kind: "submit" };
  const names = [...js.matchAll(/getField\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*\)/g)].map((m) => m[2]);
  const uniq = [...new Set(names)];
  if (!uniq.length) return { kind: "none" };
  if (/display\.hidden[\s\S]*display\.visible|display\.visible[\s\S]*display\.hidden/.test(js)) return { kind: "toggle", targets: uniq };
  if (/display\s*=\s*display\.hidden/.test(js)) return { kind: "hide", targets: uniq };
  if (/display\s*=\s*display\.visible/.test(js)) return { kind: "show", targets: uniq };
  return { kind: "none" };
}

function fontSizeFromDA(field: PDFField): number | undefined {
  try {
    const da = field.acroField.getDefaultAppearance() ?? "";
    const m = /(\d+(?:\.\d+)?)\s+Tf/.exec(da);
    const n = m ? parseFloat(m[1]) : NaN;
    return n > 0 ? Math.round(n) : undefined; // 0 = auto size → editor default
  } catch {
    return undefined;
  }
}

export interface ImportedForm {
  bytes: Uint8Array; // base PDF with the imported fields removed
  fields: PdfFieldModel[];
  skipped: number; // fields left in the base PDF (signature, multi-widget, …)
}

/**
 * Import an existing PDF's AcroForm into editor field models. Returns null
 * when the PDF has no importable fields. Fields we can't model faithfully
 * (signatures, non-radio fields with several widgets, widgets on unknown
 * pages) stay in the base PDF untouched.
 */
export async function importAcroForm(bytes: Uint8Array): Promise<ImportedForm | null> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const catalogForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (!(catalogForm instanceof PDFDict)) return null;
  const form = doc.getForm();
  const all = form.getFields();
  if (!all.length) return null;

  // Widget dict → (page index, page size).
  const pages = doc.getPages();
  const widgetPage = new Map<PDFDict, number>();
  pages.forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const d = annots.lookup(k);
      if (d instanceof PDFDict) widgetPage.set(d, i);
    }
  });

  // Calculation order: field ref → position in /CO.
  const coPos = new Map<string, number>();
  const co = form.acroForm.dict.lookup(PDFName.of("CO"));
  if (co instanceof PDFArray) {
    for (let i = 0; i < co.size(); i++) {
      const r = co.get(i);
      if (r instanceof PDFRef) coPos.set(r.toString(), i);
    }
  }

  const out: PdfFieldModel[] = [];
  const imported: PDFField[] = [];
  let skipped = 0;

  for (const field of all) {
    const widgets = field.acroField.getWidgets();
    const isRadio = field instanceof PDFRadioGroup;
    const supported =
      field instanceof PDFTextField ||
      field instanceof PDFCheckBox ||
      field instanceof PDFDropdown ||
      field instanceof PDFOptionList ||
      field instanceof PDFButton ||
      isRadio;
    if (!supported || !widgets.length || (!isRadio && widgets.length > 1) || widgets.some((w) => !widgetPage.has(w.dict))) {
      skipped++;
      continue;
    }
    const name = field.getName();
    const actions = readFieldActions(field.acroField.dict);
    const calcOrder = coPos.get(field.ref.toString());
    const common = {
      name,
      actions,
      calcOrder,
      required: field.isRequired() || undefined,
      readOnly: field.isReadOnly() || undefined,
      fontSize: fontSizeFromDA(field) ?? 12,
    };
    const geom = (w: (typeof widgets)[number]) => {
      const pi = widgetPage.get(w.dict)!;
      const page = pages[pi];
      const mb = page.getMediaBox();
      const r = w.getRectangle();
      return {
        page: pi + 1,
        x: (r.x - mb.x) / mb.width,
        y: 1 - (r.y - mb.y + r.height) / mb.height,
        width: r.width / mb.width,
        height: r.height / mb.height,
        hidden: w.hasFlag(ANNOT_HIDDEN) || undefined,
      };
    };

    try {
      if (field instanceof PDFRadioGroup) {
        const opts = field.getOptions();
        const sel = field.getSelected() ?? "";
        widgets.forEach((w, i) => {
          const opt = opts[i] ?? w.getOnValue()?.decodeText() ?? `Option ${i + 1}`;
          out.push({
            ...common,
            ...geom(w),
            fieldType: "radio",
            name: widgets.length > 1 ? `${name}_${i + 1}` : name,
            groupName: name,
            options: [opt],
            value: sel === opt ? opt : "",
          });
        });
      } else {
        const w = widgets[0];
        const g = geom(w);
        if (field instanceof PDFTextField) {
          out.push({ ...common, ...g, fieldType: "text", value: field.getText() ?? "" });
        } else if (field instanceof PDFCheckBox) {
          out.push({ ...common, ...g, fieldType: "checkbox", value: field.isChecked(), exportValue: w.getOnValue()?.decodeText() || undefined });
        } else if (field instanceof PDFDropdown) {
          out.push({ ...common, ...g, fieldType: "dropdown", options: field.getOptions(), value: field.getSelected()[0] ?? "" });
        } else if (field instanceof PDFOptionList) {
          out.push({
            ...common,
            ...g,
            fieldType: "listbox",
            options: field.getOptions(),
            value: "",
            selected: field.getSelected(),
            multiSelect: field.isMultiselect() || undefined,
          });
        } else if (field instanceof PDFButton) {
          out.push({
            ...common,
            ...g,
            fieldType: "button",
            value: "",
            label: w.getAppearanceCharacteristics()?.getCaptions()?.normal ?? name,
            buttonAction: readButtonAction(w.dict, field.acroField.dict),
          });
        }
      }
      imported.push(field);
    } catch {
      skipped++;
    }
  }

  if (!imported.length) return null;
  for (const f of imported) {
    try {
      form.removeField(f);
    } catch {
      /* leave it — the editor copy still wins on export */
    }
  }
  // The imported order now lives on the field models; stale refs must go.
  form.acroForm.dict.delete(PDFName.of("CO"));
  const saved = await doc.save({ updateFieldAppearances: false });
  return { bytes: saved, fields: out, skipped };
}
