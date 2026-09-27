// Conditional formatting (§18.3.1.18), data validation (§18.3.1.32) and
// autofilter (§18.3.1.2) between the Grown rule models (cfOps.ts,
// validationOps.ts, filterOps.ts) and worksheet XML.
//
// Conventions of the models: CF cellIs operands are bare Excel operands
// ("5", "A1", "\"text\"") or "=formula"; CF expressions and DV formulas keep a
// leading "="; DV lists are "a,b,c" or "=range". In XML every formula is
// written without "=" and literal lists are quoted.

import type { CellRect } from "../cellRange";
import { newRuleId, textRuleFormula, type CfRule, type CfStyle, type Cfvo, type CfvoType, type IconSetName } from "../cfOps";
import type { ColumnFilter, CustomOp, DynamicType, FilterState } from "../filterOps";
import type { DvRule, DvType } from "../validationOps";
import { all, attr, attrs, boolAttr, esc, kid, kids, numAttr, parseRef, parseSqref, readColor, rectRef, sqref, text, toArgb } from "./ooxml";

// ---- conditional formatting ----------------------------------------------------------

const TEXT_TYPES = new Set(["containsText", "notContainsText", "beginsWith", "endsWith"]);
const TEXT_OPERATOR: Record<string, string> = {
  containsText: "containsText",
  notContainsText: "notContains",
  beginsWith: "beginsWith",
  endsWith: "endsWith",
};

function topLeft(rule: CfRule): { r: number; c: number } {
  const f = rule.ranges[0] ?? { r1: 0, c1: 0, r2: 0, c2: 0 };
  return rule.base ?? { r: Math.min(f.r1, f.r2), c: Math.min(f.c1, f.c2) };
}

function refOf(rule: CfRule): string {
  const tl = topLeft(rule);
  return rectRef({ r1: tl.r, c1: tl.c, r2: tl.r, c2: tl.c });
}

/** A model operand → the formula text of <formula>. */
export function operandToXml(s: string | undefined): string {
  const t = (s ?? "").trim();
  if (t === "") return '""';
  if (t.startsWith("=")) return t.slice(1);
  if (Number.isFinite(Number(t))) return t;
  if (/^".*"$/s.test(t)) return t;
  if (/^(TRUE|FALSE)$/i.test(t)) return t.toUpperCase();
  // Bare references/expressions are formulas already ("A1", "$B$2*2").
  if (/^[$A-Za-z(]/.test(t) && (/[A-Za-z]+\$?\d/.test(t) || /\(/.test(t))) return t;
  return `"${t.replace(/"/g, '""')}"`;
}

/** <formula> text → a model operand. */
export function operandFromXml(f: string): string {
  const t = f.trim();
  if (Number.isFinite(Number(t)) && t !== "") return t;
  if (/^".*"$/s.test(t)) return t;
  return "=" + t;
}

function timePeriodFormula(period: string, ref: string): string {
  switch (period) {
    case "today":
      return `FLOOR(${ref},1)=TODAY()`;
    case "yesterday":
      return `FLOOR(${ref},1)=TODAY()-1`;
    case "tomorrow":
      return `FLOOR(${ref},1)=TODAY()+1`;
    case "last7Days":
      return `AND(TODAY()-FLOOR(${ref},1)<=6,FLOOR(${ref},1)<=TODAY())`;
    case "thisWeek":
      return `AND(TODAY()-ROUNDDOWN(${ref},0)<=WEEKDAY(TODAY())-1,ROUNDDOWN(${ref},0)-TODAY()<=7-WEEKDAY(TODAY()))`;
    case "lastWeek":
      return `AND(TODAY()-ROUNDDOWN(${ref},0)>=(WEEKDAY(TODAY())),TODAY()-ROUNDDOWN(${ref},0)<(WEEKDAY(TODAY())+7))`;
    case "nextWeek":
      return `AND(ROUNDDOWN(${ref},0)-TODAY()>(7-WEEKDAY(TODAY())),ROUNDDOWN(${ref},0)-TODAY()<(15-WEEKDAY(TODAY())))`;
    case "thisMonth":
      return `AND(MONTH(${ref})=MONTH(TODAY()),YEAR(${ref})=YEAR(TODAY()))`;
    case "lastMonth":
      return `AND(MONTH(${ref})=MONTH(EDATE(TODAY(),0-1)),YEAR(${ref})=YEAR(EDATE(TODAY(),0-1)))`;
    case "nextMonth":
      return `AND(MONTH(${ref})=MONTH(EDATE(TODAY(),0+1)),YEAR(${ref})=YEAR(EDATE(TODAY(),0+1)))`;
    default:
      return `FLOOR(${ref},1)=TODAY()`;
  }
}

function cfvoXml(v: Cfvo, iconSet = false): string {
  let type: string = v.type;
  if (type === "autoMin") type = "min";
  if (type === "autoMax") type = "max";
  const val = type === "min" || type === "max" ? undefined : v.type === "formula" ? (v.value ?? "").replace(/^=/, "") : (v.value ?? "0");
  return `<cfvo${attrs({ type, val, gte: iconSet && v.gte === false ? 0 : undefined })}/>`;
}

function colorXml(c: string | null | undefined): string {
  return `<color rgb="${toArgb(c) ?? "FF000000"}"/>`;
}

/**
 * <conditionalFormatting> elements for a sheet's rules. `dxf` interns a
 * differential style and returns its index (StyleBuilder.dxf).
 */
export function writeConditionalFormatting(rules: CfRule[], dxf: (s: CfStyle | undefined) => number | null): string {
  const out: string[] = [];
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);
  // Excel requires unique priorities; renumber in order.
  sortedRules.forEach((rule, i) => {
    if (!rule.ranges.length) return;
    const priority = i + 1;
    const ref = refOf(rule);
    const base: Record<string, string | number | boolean | undefined> = { priority, stopIfTrue: rule.stopIfTrue ? 1 : undefined };
    let body = "";
    let a: Record<string, string | number | boolean | undefined> = {};
    const withDxf = () => {
      const id = dxf(rule.style);
      return id === null ? {} : { dxfId: id };
    };
    switch (rule.type) {
      case "cellIs": {
        a = { type: "cellIs", ...withDxf(), ...base, operator: rule.operator ?? "equal" };
        body = `<formula>${esc(operandToXml(rule.formula1))}</formula>`;
        if (rule.operator === "between" || rule.operator === "notBetween") body += `<formula>${esc(operandToXml(rule.formula2))}</formula>`;
        break;
      }
      case "expression":
        a = { type: "expression", ...withDxf(), ...base };
        body = `<formula>${esc((rule.formula1 ?? "").replace(/^=/, ""))}</formula>`;
        break;
      case "containsText":
      case "notContainsText":
      case "beginsWith":
      case "endsWith": {
        const t = rule.text ?? "";
        a = { type: rule.type, ...withDxf(), ...base, operator: TEXT_OPERATOR[rule.type], text: t.startsWith("=") ? undefined : t };
        body = `<formula>${esc(textRuleFormula(rule))}</formula>`;
        break;
      }
      case "timePeriod":
        a = { type: "timePeriod", ...withDxf(), ...base, timePeriod: rule.period ?? "today" };
        body = `<formula>${esc(timePeriodFormula(rule.period ?? "today", ref))}</formula>`;
        break;
      case "containsBlanks":
        a = { type: "containsBlanks", ...withDxf(), ...base };
        body = `<formula>LEN(TRIM(${ref}))=0</formula>`;
        break;
      case "notContainsBlanks":
        a = { type: "notContainsBlanks", ...withDxf(), ...base };
        body = `<formula>LEN(TRIM(${ref}))&gt;0</formula>`;
        break;
      case "containsErrors":
        a = { type: "containsErrors", ...withDxf(), ...base };
        body = `<formula>ISERROR(${ref})</formula>`;
        break;
      case "notContainsErrors":
        a = { type: "notContainsErrors", ...withDxf(), ...base };
        body = `<formula>NOT(ISERROR(${ref}))</formula>`;
        break;
      case "duplicateValues":
      case "uniqueValues":
        a = { type: rule.type, ...withDxf(), ...base };
        break;
      case "top10":
        a = { type: "top10", ...withDxf(), ...base, percent: rule.percent ? 1 : undefined, bottom: rule.bottom ? 1 : undefined, rank: rule.rank ?? 10 };
        break;
      case "aboveAverage":
        a = {
          type: "aboveAverage",
          ...withDxf(),
          ...base,
          aboveAverage: rule.above === false ? 0 : undefined,
          equalAverage: rule.equalAverage ? 1 : undefined,
          stdDev: rule.stdDev ? rule.stdDev : undefined,
        };
        break;
      case "colorScale": {
        a = { type: "colorScale", ...base };
        const cfvos = rule.cfvos ?? [];
        body = `<colorScale>${cfvos.map((v) => cfvoXml(v)).join("")}${(rule.colors ?? []).map(colorXml).join("")}</colorScale>`;
        break;
      }
      case "dataBar": {
        a = { type: "dataBar", ...base };
        const bar = rule.bar;
        if (!bar) return;
        body =
          `<dataBar${attrs({
            minLength: bar.minLength !== 10 ? bar.minLength : undefined,
            maxLength: bar.maxLength !== 90 ? bar.maxLength : undefined,
            showValue: bar.showValue ? undefined : 0,
          })}>` +
          cfvoXml(bar.min) +
          cfvoXml(bar.max) +
          colorXml(bar.color) +
          "</dataBar>";
        break;
      }
      case "iconSet": {
        a = { type: "iconSet", ...base };
        const cfvos = rule.cfvos ?? [];
        body =
          `<iconSet${attrs({
            iconSet: rule.iconSet && rule.iconSet !== "3TrafficLights1" ? rule.iconSet : undefined,
            reverse: rule.reverse ? 1 : undefined,
            showValue: rule.showValue === false ? 0 : undefined,
          })}>` +
          cfvos.map((v) => cfvoXml(v, true)).join("") +
          "</iconSet>";
        break;
      }
      default:
        return;
    }
    out.push(`<conditionalFormatting sqref="${sqref(rule.ranges)}"><cfRule${attrs(a)}>${body}</cfRule></conditionalFormatting>`);
  });
  return out.join("");
}

function readCfvo(el: Element): Cfvo {
  const type = (attr(el, "type") ?? "min") as CfvoType;
  const v: Cfvo = { type };
  const val = attr(el, "val");
  if (val !== null && type !== "min" && type !== "max") v.value = type === "formula" && !Number.isFinite(Number(val)) ? "=" + val : val;
  if (attr(el, "gte") !== null) v.gte = boolAttr(el, "gte", true);
  return v;
}

const CF_TYPES = new Set([
  "cellIs",
  "containsText",
  "notContainsText",
  "beginsWith",
  "endsWith",
  "timePeriod",
  "containsBlanks",
  "notContainsBlanks",
  "containsErrors",
  "notContainsErrors",
  "duplicateValues",
  "uniqueValues",
  "top10",
  "aboveAverage",
  "expression",
  "colorScale",
  "dataBar",
  "iconSet",
]);

/** Reads every <conditionalFormatting> of a worksheet into CF rules. */
export function readConditionalFormatting(ws: Element, dxfs: CfStyle[], theme: string[]): CfRule[] {
  const rules: CfRule[] = [];
  for (const cf of kids(ws, "conditionalFormatting")) {
    const ranges = parseSqref(attr(cf, "sqref") ?? all(cf, "sqref")[0]?.textContent ?? "");
    if (!ranges.length) continue;
    for (const el of kids(cf, "cfRule")) {
      const type = attr(el, "type") ?? "";
      let t = type;
      if (type === "notContainsText" || attr(el, "operator") === "notContains") t = TEXT_TYPES.has(type) ? type : "notContainsText";
      if (!CF_TYPES.has(t)) continue;
      const formulas = kids(el, "formula").map((f) => text(f));
      const dxfId = numAttr(el, "dxfId");
      const rule: CfRule = {
        id: newRuleId(),
        type: t as CfRule["type"],
        ranges,
        priority: numAttr(el, "priority") ?? rules.length + 1,
      };
      if (boolAttr(el, "stopIfTrue")) rule.stopIfTrue = true;
      if (dxfId !== null && dxfs[dxfId]) rule.style = { ...dxfs[dxfId] };
      switch (t) {
        case "cellIs":
          rule.operator = (attr(el, "operator") ?? "equal") as CfRule["operator"];
          rule.formula1 = operandFromXml(formulas[0] ?? "");
          if (formulas[1] !== undefined) rule.formula2 = operandFromXml(formulas[1]);
          break;
        case "expression":
          rule.formula1 = "=" + (formulas[0] ?? "");
          break;
        case "containsText":
        case "notContainsText":
        case "beginsWith":
        case "endsWith": {
          const txt = attr(el, "text");
          if (txt !== null) rule.text = txt;
          else {
            // No literal: keep the rule's formula as an expression rule.
            rule.type = "expression";
            rule.formula1 = "=" + (formulas[0] ?? "FALSE");
          }
          break;
        }
        case "timePeriod":
          rule.period = (attr(el, "timePeriod") ?? "today") as CfRule["period"];
          break;
        case "top10":
          rule.rank = numAttr(el, "rank") ?? 10;
          rule.percent = boolAttr(el, "percent");
          rule.bottom = boolAttr(el, "bottom");
          break;
        case "aboveAverage":
          rule.above = boolAttr(el, "aboveAverage", true);
          rule.equalAverage = boolAttr(el, "equalAverage");
          rule.stdDev = numAttr(el, "stdDev") ?? 0;
          break;
        case "colorScale": {
          const cs = kid(el, "colorScale");
          rule.cfvos = kids(cs, "cfvo").map(readCfvo);
          rule.colors = kids(cs, "color").map((c) => readColor(c, theme) ?? "#000000");
          break;
        }
        case "dataBar": {
          const db = kid(el, "dataBar");
          const cfvos = kids(db, "cfvo").map(readCfvo);
          rule.bar = {
            min: cfvos[0] ?? { type: "autoMin" },
            max: cfvos[1] ?? { type: "autoMax" },
            color: readColor(kid(db, "color"), theme) ?? "#638ec6",
            borderColor: null,
            negativeColor: "#ff0000",
            negativeBorderColor: null,
            axisPosition: "automatic",
            axisColor: "#000000",
            direction: "context",
            showValue: boolAttr(db, "showValue", true),
            gradient: true,
            minLength: numAttr(db, "minLength") ?? 10,
            maxLength: numAttr(db, "maxLength") ?? 90,
          };
          break;
        }
        case "iconSet": {
          const is = kid(el, "iconSet");
          rule.iconSet = (attr(is, "iconSet") ?? "3TrafficLights1") as IconSetName;
          rule.cfvos = kids(is, "cfvo").map(readCfvo);
          rule.reverse = boolAttr(is, "reverse");
          rule.showValue = boolAttr(is, "showValue", true);
          break;
        }
      }
      rules.push(rule);
    }
  }
  // Keep Excel's order; renumber so priorities are 1…n.
  rules.sort((a, b) => a.priority - b.priority);
  rules.forEach((r, i) => (r.priority = i + 1));
  return rules;
}

// ---- data validation -----------------------------------------------------------------

function dvFormulaToXml(type: DvType, f: string): string {
  if (!f) return "";
  if (f.startsWith("=")) return f.slice(1);
  if (type === "list") return `"${f.replace(/"/g, '""')}"`;
  return f;
}

function dvFormulaFromXml(type: DvType, f: string): string {
  const t = f.trim();
  if (t === "") return "";
  if (type === "list") {
    if (/^".*"$/s.test(t)) return t.slice(1, -1).replace(/""/g, '"');
    return "=" + t;
  }
  if (Number.isFinite(Number(t))) return t;
  return "=" + t;
}

export function writeDataValidations(rules: DvRule[]): string {
  const items = rules
    .filter((r) => r.ranges.length)
    .map((r) => {
      // Checkboxes have no Excel equivalent; they export as a TRUE/FALSE list.
      const type: DvType = r.type === "checkbox" ? "list" : r.type;
      const f1 = r.type === "checkbox" ? `${r.checked ?? "TRUE"},${r.unchecked ?? "FALSE"}` : r.formula1;
      const two = r.operator === "between" || r.operator === "notBetween";
      const hasOp = type !== "list" && type !== "custom" && type !== "any";
      const a = attrs({
        type: type === "any" ? undefined : type,
        errorStyle: r.errorStyle !== "stop" ? r.errorStyle : undefined,
        operator: hasOp && r.operator !== "between" ? r.operator : undefined,
        allowBlank: r.allowBlank ? 1 : undefined,
        // showDropDown="1" *hides* the in-cell dropdown.
        showDropDown: type === "list" && !r.showDropdown ? 1 : undefined,
        showInputMessage: r.showInput ? 1 : undefined,
        showErrorMessage: r.showError ? 1 : undefined,
        errorTitle: r.errorTitle || undefined,
        error: r.error || undefined,
        promptTitle: r.promptTitle || undefined,
        prompt: r.prompt || undefined,
        sqref: sqref(r.ranges),
      });
      let body = "";
      if (type !== "any" && f1) body += `<formula1>${esc(dvFormulaToXml(type, f1))}</formula1>`;
      if (hasOp && two && r.formula2) body += `<formula2>${esc(dvFormulaToXml(type, r.formula2))}</formula2>`;
      return body ? `<dataValidation${a}>${body}</dataValidation>` : `<dataValidation${a}/>`;
    });
  return items.length ? `<dataValidations count="${items.length}">${items.join("")}</dataValidations>` : "";
}

let dvSeq = 0;
export function readDataValidations(ws: Element): DvRule[] {
  const out: DvRule[] = [];
  for (const el of all(kid(ws, "dataValidations"), "dataValidation")) {
    const ranges = parseSqref(attr(el, "sqref") ?? "");
    if (!ranges.length) continue;
    const xmlType = attr(el, "type") ?? "none";
    const type: DvType = xmlType === "none" ? "any" : (["whole", "decimal", "list", "date", "time", "textLength", "custom"].includes(xmlType) ? xmlType : "any") as DvType;
    dvSeq += 1;
    out.push({
      id: `dv-x${Date.now().toString(36)}-${dvSeq}`,
      type,
      operator: (attr(el, "operator") ?? "between") as DvRule["operator"],
      formula1: dvFormulaFromXml(type, text(kid(el, "formula1"))),
      formula2: dvFormulaFromXml(type, text(kid(el, "formula2"))),
      allowBlank: boolAttr(el, "allowBlank"),
      showDropdown: !boolAttr(el, "showDropDown"),
      showInput: boolAttr(el, "showInputMessage"),
      promptTitle: attr(el, "promptTitle") ?? "",
      prompt: attr(el, "prompt") ?? "",
      showError: boolAttr(el, "showErrorMessage"),
      errorStyle: (attr(el, "errorStyle") ?? "stop") as DvRule["errorStyle"],
      errorTitle: attr(el, "errorTitle") ?? "",
      error: attr(el, "error") ?? "",
      ranges,
    });
  }
  return out;
}

// ---- autofilter ----------------------------------------------------------------------

const CUSTOM_TO_XML: Record<CustomOp, { op: string; val: (v: string) => string }> = {
  equals: { op: "equal", val: (v) => v },
  doesNotEqual: { op: "notEqual", val: (v) => v },
  isGreaterThan: { op: "greaterThan", val: (v) => v },
  isGreaterThanOrEqualTo: { op: "greaterThanOrEqual", val: (v) => v },
  isLessThan: { op: "lessThan", val: (v) => v },
  isLessThanOrEqualTo: { op: "lessThanOrEqual", val: (v) => v },
  beginsWith: { op: "equal", val: (v) => `${v}*` },
  doesNotBeginWith: { op: "notEqual", val: (v) => `${v}*` },
  endsWith: { op: "equal", val: (v) => `*${v}` },
  doesNotEndWith: { op: "notEqual", val: (v) => `*${v}` },
  contains: { op: "equal", val: (v) => `*${v}*` },
  doesNotContain: { op: "notEqual", val: (v) => `*${v}*` },
};

function filterColumnXml(colId: number, f: ColumnFilter): string {
  switch (f.type) {
    case "values": {
      const vals = f.values.map((v) => `<filter val="${esc(v)}"/>`).join("");
      const dates = (f.dates ?? [])
        .map(
          (d) =>
            `<dateGroupItem${attrs({ year: d.y, month: d.m, day: d.d, hour: d.hh, minute: d.mm, second: d.ss, dateTimeGrouping: d.grouping })}/>`,
        )
        .join("");
      return `<filterColumn colId="${colId}"><filters${f.blank ? ' blank="1"' : ""}>${vals}${dates}</filters></filterColumn>`;
    }
    case "custom": {
      const conds = f.conditions
        .map((c) => {
          const m = CUSTOM_TO_XML[c.op];
          return `<customFilter${attrs({ operator: m.op === "equal" ? undefined : m.op, val: m.val(c.val) })}/>`;
        })
        .join("");
      return `<filterColumn colId="${colId}"><customFilters${f.and ? ' and="1"' : ""}>${conds}</customFilters></filterColumn>`;
    }
    case "top10":
      return `<filterColumn colId="${colId}"><top10${attrs({ top: f.top ? undefined : 0, percent: f.percent ? 1 : undefined, val: f.val })}/></filterColumn>`;
    case "dynamic":
      return `<filterColumn colId="${colId}"><dynamicFilter type="${f.dynamic}"/></filterColumn>`;
    default:
      return "";
  }
}

export function writeAutoFilter(state: FilterState | null | undefined): string {
  if (!state?.range) return "";
  const cols = Object.entries(state.columns ?? {})
    .map(([k, f]) => filterColumnXml(Number(k), f))
    .join("");
  let sort = "";
  if (state.sort) {
    const col = state.range.c1 + state.sort.colId;
    const ref = rectRef({ r1: state.range.r1 + 1, r2: state.range.r2, c1: col, c2: col });
    sort = `<sortState ref="${rectRef({ ...state.range, r1: state.range.r1 + 1 })}"><sortCondition${state.sort.desc ? ' descending="1"' : ""} ref="${ref}"/></sortState>`;
  }
  const ref = rectRef(state.range);
  return cols || sort ? `<autoFilter ref="${ref}">${cols}${sort}</autoFilter>` : `<autoFilter ref="${ref}"/>`;
}

function customFromXml(op: string | null, val: string): { op: CustomOp; val: string } {
  const eq = !op || op === "equal";
  const ne = op === "notEqual";
  if ((eq || ne) && val.length > 1 && val.startsWith("*") && val.endsWith("*"))
    return { op: eq ? "contains" : "doesNotContain", val: val.slice(1, -1) };
  if ((eq || ne) && val.endsWith("*") && !val.startsWith("*")) return { op: eq ? "beginsWith" : "doesNotBeginWith", val: val.slice(0, -1) };
  if ((eq || ne) && val.startsWith("*") && !val.endsWith("*")) return { op: eq ? "endsWith" : "doesNotEndWith", val: val.slice(1) };
  const map: Record<string, CustomOp> = {
    equal: "equals",
    notEqual: "doesNotEqual",
    greaterThan: "isGreaterThan",
    greaterThanOrEqual: "isGreaterThanOrEqualTo",
    lessThan: "isLessThan",
    lessThanOrEqual: "isLessThanOrEqualTo",
  };
  return { op: map[op ?? "equal"] ?? "equals", val };
}

export function readAutoFilter(el: Element | null): FilterState | null {
  if (!el) return null;
  const range = parseRef(attr(el, "ref") ?? "");
  if (!range) return null;
  const columns: Record<string, ColumnFilter> = {};
  for (const fc of kids(el, "filterColumn")) {
    const id = numAttr(fc, "colId");
    if (id === null) continue;
    const filters = kid(fc, "filters");
    const custom = kid(fc, "customFilters");
    const top = kid(fc, "top10");
    const dyn = kid(fc, "dynamicFilter");
    if (filters) {
      columns[String(id)] = {
        type: "values",
        values: kids(filters, "filter").map((f) => attr(f, "val") ?? ""),
        blank: boolAttr(filters, "blank") || undefined,
        dates: kids(filters, "dateGroupItem").map((d) => ({
          y: numAttr(d, "year") ?? 1900,
          m: numAttr(d, "month") ?? undefined,
          d: numAttr(d, "day") ?? undefined,
          hh: numAttr(d, "hour") ?? undefined,
          mm: numAttr(d, "minute") ?? undefined,
          ss: numAttr(d, "second") ?? undefined,
          grouping: (attr(d, "dateTimeGrouping") ?? "year") as "year",
        })),
      };
      const v = columns[String(id)] as { dates?: unknown[] };
      if (v.dates && !v.dates.length) delete v.dates;
    } else if (custom) {
      columns[String(id)] = {
        type: "custom",
        and: boolAttr(custom, "and"),
        conditions: kids(custom, "customFilter").map((c) => customFromXml(attr(c, "operator"), attr(c, "val") ?? "")),
      };
    } else if (top) {
      columns[String(id)] = { type: "top10", top: boolAttr(top, "top", true), percent: boolAttr(top, "percent"), val: numAttr(top, "val") ?? 10 };
    } else if (dyn) {
      columns[String(id)] = { type: "dynamic", dynamic: (attr(dyn, "type") ?? "aboveAverage") as DynamicType };
    }
  }
  const state: FilterState = { range, columns };
  const sc = all(el, "sortCondition")[0];
  if (sc) {
    const r = parseRef(attr(sc, "ref") ?? "");
    if (r) state.sort = { colId: r.c1 - range.c1, desc: boolAttr(sc, "descending") };
  }
  return state;
}

/** Rectangles of a sqref (exported for callers that build their own parts). */
export function sqrefRects(s: string): CellRect[] {
  return parseSqref(s);
}
