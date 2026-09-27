// CC3 — properties-panel editors for form field actions: display format
// (AFNumber/AFPercent/AFDate), calculation (AFSimple_Calculate, simplified
// field notation, custom scripts shown read-only) + calc order, and push
// button actions. They edit the raw /AA scripts on the field so the export
// writes exactly what the editor evaluates.

import { useState } from "react";
import {
  DATE_PRESETS,
  SIMPLE_OPS,
  buildFormatScripts,
  buildSfnScript,
  buildSimpleCalcScript,
  describeCalc,
  parseFormatScript,
  type FieldActions,
  type FieldFormat,
  type SimpleOp,
} from "@/features/editor/forms/formCalc";
import type { ButtonAction, PdfFieldModel } from "@/features/editor/forms/formPdf";

const inputCls = "w-full border rounded px-2 py-1 mt-0.5 text-sm";
const labelCls = "text-xs text-gray-600";

const DATE_PATTERNS = [...new Set(["mm/dd/yyyy", "dd/mm/yyyy", "yyyy-mm-dd", "dd.mm.yyyy", "mmm d, yyyy", "mmmm d, yyyy", ...DATE_PRESETS])];
const SEP_LABELS = ["1,234.56", "1234.56", "1.234,56", "1234,56", "1'234.56"];
const NEG_LABELS = ["-1,234.56", "1,234.56 (red)", "(1,234.56)", "(1,234.56) red", "-1,234.56 red"];
const OP_LABELS: Record<SimpleOp, string> = { SUM: "Sum (+)", PRD: "Product (×)", AVG: "Average", MIN: "Minimum", MAX: "Maximum" };

const splitNames = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function withActions(field: PdfFieldModel, patch: Partial<FieldActions>): FieldActions | undefined {
  const a: FieldActions = { ...(field.actions ?? {}), ...patch };
  for (const k of Object.keys(a) as (keyof FieldActions)[]) if (!a[k]) delete a[k];
  return Object.keys(a).length ? a : undefined;
}

export function FieldFormatProps({ field, onChange }: { field: PdfFieldModel; onChange: (actions: FieldActions | undefined) => void }) {
  const fmt = parseFormatScript(field.actions?.F) ?? parseFormatScript(field.actions?.K);
  const custom = !fmt && !!(field.actions?.F || field.actions?.K);
  const set = (f: FieldFormat | null) => onChange(withActions(field, f ? buildFormatScripts(f) : { F: undefined, K: undefined }));
  const kind = fmt?.kind ?? (custom ? "custom" : "none");
  return (
    <div className="space-y-1" data-testid="field-format-panel">
      <label className="block">
        <span className={labelCls}>Format</span>
        <select
          data-testid="field-format"
          value={kind}
          onChange={(e) => {
            const k = e.target.value;
            if (k === "none") set(null);
            else if (k === "number") set({ kind: "number", decimals: 2, sepStyle: 0, negStyle: 0, currency: "", currencyPrepend: true });
            else if (k === "percent") set({ kind: "percent", decimals: 0, sepStyle: 0 });
            else if (k === "date") set({ kind: "date", pattern: "mm/dd/yyyy" });
          }}
          className={inputCls}
        >
          <option value="none">None</option>
          <option value="number">Number</option>
          <option value="percent">Percentage</option>
          <option value="date">Date</option>
          {custom && <option value="custom">Custom script</option>}
        </select>
      </label>
      {(fmt?.kind === "number" || fmt?.kind === "percent") && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={labelCls}>Decimals</span>
            <input
              data-testid="field-format-decimals"
              type="number"
              min={0}
              max={10}
              value={fmt.decimals}
              onChange={(e) => set({ ...fmt, decimals: Math.max(0, Math.min(10, parseInt(e.target.value) || 0)) })}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Separator</span>
            <select data-testid="field-format-sep" value={fmt.sepStyle} onChange={(e) => set({ ...fmt, sepStyle: parseInt(e.target.value) })} className={inputCls}>
              {SEP_LABELS.map((l, i) => (
                <option key={i} value={i}>{l}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {fmt?.kind === "number" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={labelCls}>Currency</span>
            <input
              data-testid="field-format-currency"
              value={fmt.currency}
              placeholder="$, € …"
              onChange={(e) => set({ ...fmt, currency: e.target.value })}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Negative</span>
            <select data-testid="field-format-neg" value={fmt.negStyle} onChange={(e) => set({ ...fmt, negStyle: parseInt(e.target.value) })} className={inputCls}>
              {NEG_LABELS.map((l, i) => (
                <option key={i} value={i}>{l}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex items-center gap-2 text-xs text-gray-600">
            <input
              data-testid="field-format-currency-after"
              type="checkbox"
              checked={!fmt.currencyPrepend}
              onChange={(e) => set({ ...fmt, currencyPrepend: !e.target.checked })}
            />
            Symbol after the number
          </label>
        </div>
      )}
      {fmt?.kind === "date" && (
        <label className="block">
          <span className={labelCls}>Date pattern</span>
          <select data-testid="field-format-date" value={fmt.pattern} onChange={(e) => set({ kind: "date", pattern: e.target.value })} className={inputCls}>
            {(DATE_PATTERNS.includes(fmt.pattern) ? DATE_PATTERNS : [fmt.pattern, ...DATE_PATTERNS]).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

type CalcMode = "none" | SimpleOp | "sfn" | "custom";

export function FieldCalcProps({
  field,
  fieldNames,
  onChange,
}: {
  field: PdfFieldModel;
  fieldNames: string[];
  onChange: (patch: Partial<PdfFieldModel>) => void;
}) {
  const desc = describeCalc(field.actions?.C);
  const [mode, setMode] = useState<CalcMode>(desc.mode === "simple" ? desc.op : desc.mode);
  const [names, setNames] = useState(desc.mode === "simple" ? desc.fields.join(", ") : "");
  const [expr, setExpr] = useState(desc.mode === "sfn" ? desc.expr : "");
  const sfnValid = mode !== "sfn" || !!buildSfnScript(expr);

  const setC = (js: string | undefined) => onChange({ actions: withActions(field, { C: js }) });
  const apply = (m: CalcMode, n: string, x: string) => {
    if (m === "none") setC(undefined);
    else if (m === "sfn") {
      const js = buildSfnScript(x);
      if (js) setC(js);
    } else if (m !== "custom") setC(buildSimpleCalcScript(m, splitNames(n)));
  };
  const addName = (nm: string) => {
    if (mode === "sfn") {
      const esc = nm.replace(/([\s+\-*/()\\])/g, "\\$1");
      const x = expr.trim() ? `${expr.trim()} + ${esc}` : esc;
      setExpr(x);
      apply(mode, names, x);
    } else if (mode !== "none" && mode !== "custom") {
      const list = splitNames(names);
      if (list.includes(nm)) return;
      const n = [...list, nm].join(", ");
      setNames(n);
      apply(mode, n, expr);
    }
  };

  return (
    <div className="space-y-1 border-t pt-2" data-testid="field-calc-panel">
      <label className="block">
        <span className={labelCls}>Calculate</span>
        <select
          data-testid="field-calc"
          value={mode}
          onChange={(e) => {
            const m = e.target.value as CalcMode;
            setMode(m);
            apply(m, names, expr);
          }}
          className={inputCls}
        >
          <option value="none">Not calculated</option>
          {SIMPLE_OPS.map((op) => (
            <option key={op} value={op}>{OP_LABELS[op]} of fields</option>
          ))}
          <option value="sfn">Expression (field notation)</option>
          {mode === "custom" && <option value="custom">Custom script</option>}
        </select>
      </label>
      {mode !== "none" && mode !== "custom" && mode !== "sfn" && (
        <label className="block">
          <span className={labelCls}>Fields (comma-separated)</span>
          <input
            data-testid="field-calc-fields"
            value={names}
            onChange={(e) => {
              setNames(e.target.value);
              apply(mode, e.target.value, expr);
            }}
            className={inputCls}
          />
        </label>
      )}
      {mode === "sfn" && (
        <label className="block">
          <span className={labelCls}>Expression, e.g. qty * price - discount</span>
          <input
            data-testid="field-calc-expr"
            value={expr}
            aria-invalid={!sfnValid}
            onChange={(e) => {
              setExpr(e.target.value);
              apply(mode, names, e.target.value);
            }}
            className={`${inputCls} ${sfnValid ? "" : "border-red-500"}`}
          />
        </label>
      )}
      {mode !== "none" && mode !== "custom" && fieldNames.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Insert field">
          {[...new Set(fieldNames)].map((nm) => (
            <button
              key={nm}
              type="button"
              data-testid="field-calc-add"
              data-name={nm}
              onClick={() => addName(nm)}
              className="text-[11px] px-1.5 py-0.5 rounded border bg-gray-50 hover:bg-gray-100 text-gray-700"
            >
              + {nm}
            </button>
          ))}
        </div>
      )}
      {mode === "custom" && (
        <>
          <textarea data-testid="field-calc-script" readOnly rows={3} value={field.actions?.C ?? ""} className={`${inputCls} font-mono text-[11px] bg-gray-50`} />
          <p className="text-[11px] text-gray-500">
            {desc.mode === "custom" && desc.supported
              ? "Custom script: simple arithmetic and field assignments are evaluated; anything else is ignored (never executed)."
              : "Custom script: not evaluated in Grown (kept on export)."}
          </p>
        </>
      )}
      {mode !== "none" && (
        <label className="block">
          <span className={labelCls}>Calculation order</span>
          <input
            data-testid="field-calc-order"
            type="number"
            min={1}
            value={field.calcOrder === undefined ? "" : field.calcOrder + 1}
            placeholder="document order"
            onChange={(e) => {
              const n = parseInt(e.target.value);
              onChange({ calcOrder: Number.isFinite(n) && n > 0 ? n - 1 : undefined });
            }}
            className={inputCls}
          />
        </label>
      )}
    </div>
  );
}

export function FieldButtonProps({
  field,
  fieldNames,
  onChange,
  fillSign,
}: {
  field: PdfFieldModel;
  fieldNames: string[];
  onChange: (patch: Partial<PdfFieldModel>) => void;
  fillSign: boolean;
}) {
  const act: ButtonAction = field.buttonAction ?? { kind: "none" };
  const [targets, setTargets] = useState("targets" in act ? act.targets.join(", ") : "");
  const setAct = (kind: ButtonAction["kind"], t: string) => {
    if (kind === "hide" || kind === "show" || kind === "toggle") onChange({ buttonAction: { kind, targets: splitNames(t) } });
    else onChange({ buttonAction: { kind } });
  };
  return (
    <div className="space-y-1" data-testid="field-button-panel">
      <label className="block">
        <span className={labelCls}>Label</span>
        <input data-testid="field-label" value={field.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>When clicked</span>
        <select data-testid="field-button-action" value={act.kind} onChange={(e) => setAct(e.target.value as ButtonAction["kind"], targets)} className={inputCls}>
          <option value="none">Do nothing</option>
          <option value="reset">Reset form</option>
          <option value="submit">Submit form (disabled)</option>
          <option value="hide">Hide fields</option>
          <option value="show">Show fields</option>
          <option value="toggle">Show/hide fields (toggle)</option>
        </select>
      </label>
      {(act.kind === "hide" || act.kind === "show" || act.kind === "toggle") && (
        <label className="block">
          <span className={labelCls}>Target fields (comma-separated)</span>
          <input
            data-testid="field-button-targets"
            value={targets}
            list="field-button-target-names"
            onChange={(e) => {
              setTargets(e.target.value);
              setAct(act.kind, e.target.value);
            }}
            className={inputCls}
          />
          <datalist id="field-button-target-names">
            {[...new Set(fieldNames)].map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
      )}
      {act.kind === "submit" && <p className="text-[11px] text-gray-500">Submitting isn&apos;t supported; clicking shows a message and the export carries no submit action.</p>}
      {!fillSign && act.kind !== "none" && <p className="text-[11px] text-gray-500">Turn on Fill &amp; Sign to click the button.</p>}
    </div>
  );
}
