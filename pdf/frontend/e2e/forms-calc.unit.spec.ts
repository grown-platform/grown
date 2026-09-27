import { expect, test } from "@playwright/test";
import {
  AFMakeNumber,
  buildFormatScripts,
  buildSfnScript,
  buildSimpleCalcScript,
  describeCalc,
  formatDate,
  formatValue,
  isSupportedCalc,
  keystrokeAccepts,
  normalizeInput,
  parseCalcScript,
  parseDate,
  parseFormatScript,
  runCalculations,
  type CalcField,
  type FieldFormat,
} from "../src/features/editor/forms/formCalc";

/**
 * CC3 — unit tests for the safe PDF form-action evaluator and the AF* format
 * helpers (no browser; `npx playwright test --project=unit`).
 */

const text = (name: string, value = "", C?: string, calcOrder?: number): CalcField => ({
  fieldType: "text",
  name,
  value,
  actions: C ? { C } : undefined,
  calcOrder,
});
const byName = (fs: CalcField[]) => Object.fromEntries(fs.map((f) => [f.name, f.value]));

test.describe("formCalc — calculate actions", () => {
  // Port of OnlyOffice tests/pdf/forms/actions.js "Test calculate action":
  // three text fields whose calculate scripts increment each other; committing
  // a value in one field runs every calculation once in document order, and a
  // calculation never overwrites the field the user just committed.
  test("oo:pdf/forms/actions.js#Test calculate action", () => {
    let fields = [
      text("TextForm1", "1", "this.getField('TextForm2').value += 1"),
      text("TextForm2", "2", "this.getField('TextForm3').value += 1"),
      text("TextForm3", "3", "this.getField('TextForm1').value += 1"),
    ];
    expect(byName(fields)).toEqual({ TextForm1: "1", TextForm2: "2", TextForm3: "3" });

    // Type "2" after the existing "2" in TextForm2 and commit.
    fields = fields.map((f) => (f.name === "TextForm2" ? { ...f, value: "22" } : f));
    fields = runCalculations(fields, "TextForm2");
    expect(byName(fields)).toEqual({ TextForm1: "2", TextForm2: "22", TextForm3: "4" });

    // Type "3" after the "4" in TextForm3 and commit.
    fields = fields.map((f) => (f.name === "TextForm3" ? { ...f, value: "43" } : f));
    fields = runCalculations(fields, "TextForm3");
    expect(byName(fields)).toEqual({ TextForm1: "3", TextForm2: "23", TextForm3: "43" });
  });

  test("AFSimple_Calculate SUM/PRD/AVG/MIN/MAX over named fields", () => {
    const base = [text("a", "2"), text("b", "3"), text("c", "")];
    const run = (op: string) =>
      byName(runCalculations([...base, text("t", "", `AFSimple_Calculate("${op}", new Array("a", "b", "c"));`)], "a")).t;
    expect(run("SUM")).toBe("5");
    expect(run("PRD")).toBe("0"); // empty field counts as 0
    expect(Number(run("AVG"))).toBeCloseTo(5 / 3, 10);
    expect(run("MIN")).toBe("0");
    expect(run("MAX")).toBe("3");
  });

  test("AFSimple_Calculate accepts a comma list string and hierarchical names", () => {
    const fields = [
      text("item.1", "10"),
      text("item.2", "5.5"),
      text("tax", "1"),
      text("total", "", 'AFSimple_Calculate("SUM", "item, tax");'),
    ];
    expect(byName(runCalculations(fields, null)).total).toBe("16.5");
  });

  test("float noise is trimmed (0.1 + 0.2)", () => {
    const fields = [text("a", "0.1"), text("b", "0.2"), text("t", "", buildSimpleCalcScript("SUM", ["a", "b"]))];
    expect(byName(runCalculations(fields, null)).t).toBe("0.3");
  });

  test("simplified field notation (BVCALC … EVCALC) with escaped names", () => {
    const js = "/** BVCALC (qty * price) - discount\\ amt EVCALC **/ event.value = 0;";
    const fields = [text("qty", "3"), text("price", "2.5"), text("discount amt", "1"), text("t", "", js)];
    expect(byName(runCalculations(fields, null)).t).toBe("6.5");
  });

  test("buildSfnScript round-trips through the evaluator", () => {
    const js = buildSfnScript("a * 2 + b")!;
    expect(js).toContain("BVCALC a * 2 + b EVCALC");
    expect(js).toContain('AFMakeNumber(getField("a").value)');
    const fields = [text("a", "4"), text("b", "1"), text("t", "", js)];
    expect(byName(runCalculations(fields, null)).t).toBe("9");
    expect(buildSfnScript("a + (")).toBeNull();
  });

  test("custom arithmetic with locals and event.value", () => {
    const js = `var q = this.getField("qty").value;
      var p = getField("price").value;
      event.value = Math.round(q * p * 100) / 100;`;
    const fields = [text("qty", "3"), text("price", "1.333"), text("t", "", js)];
    expect(byName(runCalculations(fields, null)).t).toBe("4");
  });

  test("+ concatenates strings like JavaScript", () => {
    const js = 'event.value = getField("first").value + " " + getField("last").value;';
    const fields = [text("first", "Ada"), text("last", "Lovelace"), text("full", "", js)];
    expect(byName(runCalculations(fields, null)).full).toBe("Ada Lovelace");
  });

  test("arbitrary JavaScript is never executed — unsupported statements are ignored", () => {
    (globalThis as { __pwned?: boolean }).__pwned = false;
    const js = `globalThis.__pwned = true; app.alert("hi"); for (var i=0;i<9;i++) { x(); }
      eval("globalThis.__pwned = true"); event.value = 7;`;
    const fields = [text("t", "", js)];
    expect(byName(runCalculations(fields, null)).t).toBe("7");
    expect((globalThis as { __pwned?: boolean }).__pwned).toBe(false);
    expect(isSupportedCalc('app.alert("x")')).toBe(false);
    expect(parseCalcScript("function f() { return 1 }")).toEqual([]);
  });

  test("a missing field aborts the rest of that script only", () => {
    const fields = [
      text("a", "1"),
      text("t1", "", 'event.value = getField("nope").value; event.value = 5;'),
      text("t2", "", 'event.value = getField("a").value + 1;'),
    ];
    const out = byName(runCalculations(fields, null));
    expect(out.t1).toBe("");
    expect(out.t2).toBe("2");
  });

  test("calculation order (/CO) is honoured over document order", () => {
    // b = a + 1, c = b * 10. With CO [b, c] c sees the new b; with [c, b] it
    // sees the stale one (single pass, like Acrobat).
    const mk = (cOrder: number, bOrder: number) => [
      text("a", "1"),
      text("c", "0", 'event.value = getField("b").value * 10;', cOrder),
      text("b", "0", 'event.value = getField("a").value + 1;', bOrder),
    ];
    expect(byName(runCalculations(mk(1, 0), "a")).c).toBe("20");
    expect(byName(runCalculations(mk(0, 1), "a")).c).toBe("0");
  });

  test("checkbox, radio group and listbox values feed calculations", () => {
    const fields: CalcField[] = [
      { fieldType: "checkbox", name: "cb", value: true, exportValue: "5" },
      { fieldType: "radio", name: "r1", groupName: "size", value: "" },
      { fieldType: "radio", name: "r2", groupName: "size", value: "3" },
      { fieldType: "listbox", name: "lb", value: "", selected: ["2"] },
      text("t", "", buildSimpleCalcScript("SUM", ["cb", "size", "lb"])),
    ];
    expect(byName(runCalculations(fields, null)).t).toBe("10");
  });

  test("describeCalc classifies scripts for the properties panel", () => {
    expect(describeCalc("")).toEqual({ mode: "none" });
    expect(describeCalc(buildSimpleCalcScript("AVG", ["x", "y"]))).toEqual({ mode: "simple", op: "AVG", fields: ["x", "y"] });
    expect(describeCalc(buildSfnScript("x+y")!)).toEqual({ mode: "sfn", expr: "x+y" });
    expect(describeCalc("this.getField('a').value += 1")).toEqual({ mode: "custom", supported: true });
    expect(describeCalc("app.alert(1)")).toEqual({ mode: "custom", supported: false });
  });

  test("AFMakeNumber", () => {
    expect(AFMakeNumber("12.5")).toBe(12.5);
    expect(AFMakeNumber(" 3 ")).toBe(3);
    expect(AFMakeNumber("1,5")).toBe(1.5);
    expect(AFMakeNumber("")).toBeNull();
    expect(AFMakeNumber("abc")).toBeNull();
  });
});

test.describe("formCalc — AF* formats", () => {
  const num = (p: Partial<Extract<FieldFormat, { kind: "number" }>> = {}): FieldFormat => ({
    kind: "number",
    decimals: 2,
    sepStyle: 0,
    negStyle: 0,
    currency: "",
    currencyPrepend: true,
    ...p,
  });

  test("parseFormatScript recognises AFNumber/AFPercent/AFDate calls", () => {
    expect(parseFormatScript('AFNumber_Format(2, 0, 0, 0, "$", true);')).toEqual(num({ currency: "$" }));
    expect(parseFormatScript('AFNumber_Keystroke(0, 2, 2, 0, "€", false);')).toEqual(
      num({ decimals: 0, sepStyle: 2, negStyle: 2, currency: "€", currencyPrepend: false }),
    );
    expect(parseFormatScript("AFPercent_Format(1, 0);")).toEqual({ kind: "percent", decimals: 1, sepStyle: 0, percentPrepend: false });
    expect(parseFormatScript('AFDate_FormatEx("dd.mm.yyyy");')).toEqual({ kind: "date", pattern: "dd.mm.yyyy" });
    expect(parseFormatScript("AFDate_Format(2);")).toEqual({ kind: "date", pattern: "mm/dd/yy" });
    expect(parseFormatScript("event.value = 1;")).toBeNull();
    expect(parseFormatScript(undefined)).toBeNull();
  });

  test("buildFormatScripts round-trips through parseFormatScript", () => {
    const fmts: FieldFormat[] = [
      num({ currency: "$" }),
      num({ decimals: 0, sepStyle: 2, negStyle: 3, currency: " €", currencyPrepend: false }),
      { kind: "percent", decimals: 1, sepStyle: 0, percentPrepend: false },
      { kind: "date", pattern: "mmm d, yyyy" },
    ];
    for (const f of fmts) {
      const { F, K } = buildFormatScripts(f);
      expect(parseFormatScript(F)).toEqual(f);
      expect(parseFormatScript(K)).toEqual(f);
    }
  });

  test("AFNumber_Format separator styles, currency and negatives", () => {
    expect(formatValue(num(), "1234567.891")).toEqual({ text: "1,234,567.89" });
    expect(formatValue(num({ sepStyle: 1 }), "1234.5")).toEqual({ text: "1234.50" });
    expect(formatValue(num({ sepStyle: 2 }), "1234.5")).toEqual({ text: "1.234,50" });
    expect(formatValue(num({ sepStyle: 3 }), "1234.5")).toEqual({ text: "1234,50" });
    expect(formatValue(num({ sepStyle: 4 }), "1234.5")).toEqual({ text: "1'234.50" });
    expect(formatValue(num({ currency: "$" }), "1234.5")).toEqual({ text: "$1,234.50" });
    expect(formatValue(num({ currency: " EUR", currencyPrepend: false }), "3")).toEqual({ text: "3.00 EUR" });
    expect(formatValue(num({ decimals: 0 }), "2.5")).toEqual({ text: "3" });
    expect(formatValue(num({ decimals: 2 }), "1.005")).toEqual({ text: "1.01" });
    expect(formatValue(num({ currency: "$" }), "-5")).toEqual({ text: "-$5.00" });
    expect(formatValue(num({ negStyle: 1 }), "-5")).toEqual({ text: "5.00", red: true });
    expect(formatValue(num({ negStyle: 2 }), "-5")).toEqual({ text: "(5.00)" });
    expect(formatValue(num({ negStyle: 3 }), "-5")).toEqual({ text: "(5.00)", red: true });
    expect(formatValue(num(), "-0.001")).toEqual({ text: "0.00" });
    expect(formatValue(num(), "")).toEqual({ text: "" });
    expect(formatValue(num(), "abc")).toBeNull();
  });

  test("AFPercent_Format", () => {
    const p: FieldFormat = { kind: "percent", decimals: 1, sepStyle: 0 };
    expect(formatValue(p, "0.125")).toEqual({ text: "12.5%" });
    expect(formatValue(p, "12.5")).toEqual({ text: "1,250.0%" });
    expect(formatValue({ ...p, percentPrepend: true }, "0.5")).toEqual({ text: "%50.0" });
    expect(formatValue(p, "-0.5")).toEqual({ text: "-50.0%" });
  });

  test("AFNumber_Keystroke filters input and normalises on commit", () => {
    const f = num({ currency: "$" });
    expect(keystrokeAccepts(f, "1,234.5")).toBe(true);
    expect(keystrokeAccepts(f, "-$12")).toBe(true);
    expect(keystrokeAccepts(f, "12a")).toBe(false);
    expect(normalizeInput(f, "$1,234.50")).toEqual({ value: "1234.5", valid: true });
    expect(normalizeInput(f, "(12)")).toEqual({ value: "-12", valid: true });
    expect(normalizeInput(num({ sepStyle: 2 }), "1.234,5")).toEqual({ value: "1234.5", valid: true });
    expect(normalizeInput(f, "1.2.3")).toEqual({ value: "1.2.3", valid: false });
    expect(normalizeInput(f, "")).toEqual({ value: "", valid: true });
    const pct: FieldFormat = { kind: "percent", decimals: 0, sepStyle: 0 };
    expect(normalizeInput(pct, "15%")).toEqual({ value: "0.15", valid: true });
    expect(keystrokeAccepts(pct, "15%")).toBe(true);
  });

  test("AFDate_FormatEx formatting tokens", () => {
    const d = new Date(2026, 2, 7, 14, 5, 9); // Sat 7 Mar 2026 14:05:09
    expect(formatDate(d, "mm/dd/yyyy")).toBe("03/07/2026");
    expect(formatDate(d, "m/d/yy")).toBe("3/7/26");
    expect(formatDate(d, "dddd, mmmm d, yyyy")).toBe("Saturday, March 7, 2026");
    expect(formatDate(d, "d-mmm-yy")).toBe("7-Mar-26");
    expect(formatDate(d, "yyyy-mm-dd HH:MM:ss")).toBe("2026-03-07 14:05:09");
    expect(formatDate(d, "h:MM tt")).toBe("2:05 pm");
  });

  test("AFDate parsing follows the pattern's field order", () => {
    const now = new Date(2026, 0, 1);
    const ymd = (d: Date | null) => (d ? [d.getFullYear(), d.getMonth() + 1, d.getDate()] : null);
    expect(ymd(parseDate("3/7/2026", "mm/dd/yyyy"))).toEqual([2026, 3, 7]);
    expect(ymd(parseDate("7.3.26", "dd.mm.yyyy"))).toEqual([2026, 3, 7]);
    expect(ymd(parseDate("2026-03-07", "dd.mm.yyyy"))).toEqual([2026, 3, 7]);
    expect(ymd(parseDate("March 7, 2026", "mm/dd/yyyy"))).toEqual([2026, 3, 7]);
    expect(ymd(parseDate("7 mar", "d-mmm", now))).toEqual([2026, 3, 7]);
    expect(ymd(parseDate("2/30/2026", "mm/dd/yyyy"))).toBeNull();
    expect(ymd(parseDate("hello", "mm/dd/yyyy"))).toBeNull();
    const t = parseDate("3/7/26 2:05 pm", "m/d/yy h:MM tt")!;
    expect([t.getHours(), t.getMinutes()]).toEqual([14, 5]);
  });

  test("AFDate commit normalises to the pattern; invalid dates are flagged", () => {
    const f: FieldFormat = { kind: "date", pattern: "mmm d, yyyy" };
    expect(normalizeInput(f, "3/7/2026")).toEqual({ value: "Mar 7, 2026", valid: true });
    expect(normalizeInput(f, "31/31/2026")).toEqual({ value: "31/31/2026", valid: false });
    expect(formatValue(f, "Mar 7, 2026")).toEqual({ text: "Mar 7, 2026" });
  });
});
