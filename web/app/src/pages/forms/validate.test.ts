import { describe, expect, it } from "vitest";
import {
  TextFormFormat,
  TextFormInput,
  applyTextFormat,
  getAllFormsData,
  isAllRequiredFilled,
  maskCheck,
  maskCorrect,
  maskLength,
  pagePath,
  pruneSkipped,
  questionError,
  setAllFormsData,
  validateAnswer,
  visitedQuestionIds,
} from "./validate";
import { blankQuestion, blankSection } from "./helpers";
import type { AnswerMap, Form, FormQuestion, FormValidation } from "./types";
import { SUBMIT_TARGET } from "./types";

// Expected values in the oo: cases come from OnlyOffice's sdkjs tests
// (tests/word/forms); the implementation is our own.

describe("OnlyOffice text-form formats", () => {
  it("oo:word/forms/forms.js#Check text form formats", () => {
    const f = new TextFormFormat();
    expect(f.check("qwe123")).toBe(true);

    f.setSymbols("1234567890");
    expect(f.check("qwe123")).toBe(false);
    expect(f.check("555123")).toBe(true);
    expect(f.check([..."qwe123"].map((c) => c.codePointAt(0)!))).toBe(false);
    expect(f.check([..."555123"].map((c) => c.codePointAt(0)!))).toBe(true);

    f.setSymbols();
    f.setDigit();
    expect(f.check("qwe123")).toBe(false);
    expect(f.check("555123")).toBe(true);

    f.setSymbols("153");
    f.setDigit();
    expect(f.check("qwe123")).toBe(false);
    expect(f.check("555123")).toBe(false);
    expect(f.check("513513")).toBe(true);

    f.setSymbols();
    f.setLetter();
    expect(f.check("qwe123")).toBe(false);
    expect(f.check("555123")).toBe(false);
    expect(f.check("АБВГДЕabcdef")).toBe(true);

    f.setSymbols("абвгдеёжзийклмнопрстуфхцчшщъыьэюя");
    expect(f.getSymbols()).toBe("абвгдеёжзийклмнопрстуфхцчшщъыьэюя");
    f.setLetter();
    expect(f.check("АБВГДЕabcdef")).toBe(false);
    expect(f.check("привет")).toBe(true);
    expect(f.check("hello")).toBe(false);

    f.setMask("(999)-99-9999");
    f.setSymbols();
    expect(f.check("123-12-1234")).toBe(false);
    expect(f.check("(123)")).toBe(true);
    expect(f.check("(123)abc")).toBe(false);
    expect(f.check("(123)-12-abc5")).toBe(false);
    expect(f.check("(123)-12-5555")).toBe(true);

    f.setMask("(9\\99)-99-9999");
    expect(f.check("(1")).toBe(true);
    expect(f.check("(123)-12-5555")).toBe(false);
    expect(f.check("(193)-12-5555")).toBe(true);

    f.setMask("\\aabcX");
    expect(f.check("aabcd")).toBe(true);
    expect(f.check("qqbcd")).toBe(false);
    expect(f.check("aqbc1")).toBe(true);
    expect(f.check("aqbc123")).toBe(false);

    f.setRegExp("^[A-Fa-f0-9]+$");
    expect(f.check("12FF")).toBe(true);
    expect(f.check("Test")).toBe(false);
    expect(f.check("FE19FF")).toBe(true);
  });

  it("oo:word/forms/forms.js#Check format in text form", () => {
    const f = new TextFormFormat();
    f.setDigit();
    const input = new TextFormInput(f);
    input.type("AB12C3");
    expect(input.value).toBe("123");

    f.setLetter();
    input.type("A1");
    expect(input.value).toBe("123");
    input.backspace(3);
    expect(input.value).toBe("");
    input.type("AB12C3");
    expect(input.value).toBe("ABC");

    const f2 = new TextFormFormat();
    expect(f2.maxCharacters()).toBe(-1);
    f2.setMask("999-aaa");
    expect(f2.maxCharacters()).toBe(7);
    const input2 = new TextFormInput(f2);
    input2.type("112-A");
    input2.blur();
    expect(input2.value).toBe("112-A");
    expect(f2.check("112-A")).toBe(true);
    input2.type("B1");
    expect(input2.value).toBe("112-AB1");
    input2.blur(); // doesn't fit the mask: back to the last value that did
    expect(input2.value).toBe("112-A");
    input2.type("BB");
    input2.blur();
    input2.type("C"); // the mask is full
    input2.blur();
    expect(input2.value).toBe("112-ABB");
  });

  it("oo:word/forms/forms.js#Check correction of text mask", () => {
    const cases: [string, string, string][] = [
      ["", "1234", "1234"],
      ["X", "1234", "1"],
      ["a", "1234", "1234"],
      ["a", "1bcd", "1bcd"],
      ["a9", "bc", "bc"],
      ["a\\9", "bc", "b9"],
      ["\\a9", "u", "u"],
      ["\\a9", "9", "a9"],
      ["\\a9", "a", "a"],

      ["999-999", "123", "123-"],
      ["999-999", "123-", "123-"],
      ["999-999", "123456", "123-456"],

      ["(999) 999-9999", "", ""],
      ["(999) 999-9999", "9", "(9"],
      ["(999) 999-9999", "9(99", "9(99"],
      ["(999) 999-9999", "999", "(999) "],
      ["(999) 999-9999", "(999", "(999) "],
      ["(999) 999-9999", "(999)", "(999) "],
      ["(999) 999-9999", "(999)123", "(999) 123-"],
      ["(999) 999-9999", "999123", "(999) 123-"],
      ["(999) 999-9999", "9991231122", "(999) 123-1122"],
      ["(999) 999-9999", "(999)1231122", "(999) 123-1122"],
      ["(999) 999-9999", "(999)123-1122", "(999) 123-1122"],
      ["(999) 999-9999", "333)123-1122", "(333) 123-1122"],
      ["(999) 999-9999", "9)-", "9)-"],
      ["(999) 999-9999", "9)bcs", "9)bcs"],

      ["+7 (999)-999-99-99", "9991112211", "+7 (999)-111-22-11"],
      ["+7 (999)-999-99-99", "999", "+7 (999)-"],
      ["+7 (999)-999-99-99", "999a", "999a"],
      ["+7 (999)-999-99-99", "(999a", "(999a"],
      ["+7 (999)-999-99-99", "+(999a1", "+(999a1"],

      ["XXXXX@aaaa", "index", "index@"],
      ["XXXXX@aaaa", "index1234", "index1234"],
      ["XXXXX@aaaa", "indexmail", "index@mail"],
      ["XXXXX@aaaa.ru", "indexmail", "index@mail.ru"],

      ["99.99.99.9.9", "12345678", "12.34.56.7.8"],
      ["99.99.99.9.9", "12", "12."],
      ["99.99.99.9.9", "1232b", "1232b"],
      ["99.99.99.9.9", "b", "b"],
      ["99.99.99.9.9", "1234567812345678", "12.34.56.7.8"],

      ["OO-\\x", "", ""],
      ["OO-\\x", "1", "1"],
      ["OO-\\x", "12", "12-x"],
      ["OO-\\x", "12-", "12-x"],
      ["OO-\\x", "12-x", "12-x"],

      ["OOO-O9O\\Oxxx:uuu-y", "", ""],
      ["OOO-O9O\\Oxxx:uuu-y", "a", "a"],
      ["OOO-O9O\\Oxxx:uuu-y", "ad", "ad"],
      ["OOO-O9O\\Oxxx:uuu-y", "ad9", "ad9-"],
      ["OOO-O9O\\Oxxx:uuu-y", "ad94", "ad9-4"],
      ["OOO-O9O\\Oxxx:uuu-y", "ad949", "ad9-49"],
      ["OOO-O9O\\Oxxx:uuu-y", "ad949f", "ad9-49fOxxx:uuu-y"],
      ["OOO-O9O\\Oxxx:uuu-y", "ad949fO", "ad9-49fOxxx:uuu-y"],
      ["OOO-O9O\\Oxxx:uuu-y", "ad949fOxxx:uuu-y", "ad9-49fOxxx:uuu-y"],
      ["OOO-O9O\\Oxxx:uuu-y", "ad949fOxxx:uuu-fke3", "ad9-49fOxxx:uuu-y"],

      ["OOO-O9O\\Obbb:uuu-y-999", "", ""],
      ["OOO-O9O\\Obbb:uuu-y-999", "a", "a"],
      ["OOO-O9O\\Obbb:uuu-y-999", "ad", "ad"],
      ["OOO-O9O\\Obbb:uuu-y-999", "ad9", "ad9-"],
      ["OOO-O9O\\Obbb:uuu-y-999", "ad94", "ad9-4"],
      ["OOO-O9O\\Obbb:uuu-y-999", "ad94b", "ad94b"],
      ["OOO-O9O\\Obbb:uuu-y-999", "ad949", "ad9-49"],
      ["OOO-O9O\\Obbb:uuu-y-999", "ad949b", "ad9-49bObbb:uuu-y-"],
      ["OOO-O9O\\Obbb:uuu-y-999", "ad949b1", "ad9-49bObbb:uuu-y-1"],
      ["OOO-O9O\\Obbb:uuu-y-999", "ad949b1O", "ad949b1O"],
      ["OOO-O9O\\Obbb:uuu-y-999", "ad949b123", "ad9-49bObbb:uuu-y-123"],
      ["OOO-O9O\\Obbb:uuu-y-999", "ad949fO678", "ad9-49fObbb:uuu-y-678"],

      ["9-\\a-9-b-9-c-9-d", "", ""],
      ["9-\\a-9-b-9-c-9-d", "1", "1-a-"],
      ["9-\\a-9-b-9-c-9-d", "12", "1-a-2-b-"],
      ["9-\\a-9-b-9-c-9-d", "12bsx", "12bsx"],
      ["9-\\a-9-b-9-c-9-d", "123", "1-a-2-b-3-c-"],
      ["9-\\a-9-b-9-c-9-d", "1234", "1-a-2-b-3-c-4-d"],
      ["9-\\a-9-b-9-c-9-d", "1234bc", "1-a-2-b-3-c-4-d"],

      ["order №OOOOO-99.99.99-aa-9999", "", ""],
      ["order №OOOOO-99.99.99-aa-9999", "a", "order №a"],
      ["order №OOOOO-99.99.99-aa-9999", "ab", "order №ab"],
      ["order №OOOOO-99.99.99-aa-9999", "ab54d", "order №ab54d-"],
      ["order №OOOOO-99.99.99-aa-9999", "ab54dab", "ab54dab"],
      ["order №OOOOO-99.99.99-aa-9999", "ab54d310822", "order №ab54d-31.08.22-"],
      ["order №OOOOO-99.99.99-aa-9999", "ab54d31.08.22", "order №ab54d-31.08.22-"],
      ["order №OOOOO-99.99.99-aa-9999", "ab54d-31.08.22", "order №ab54d-31.08.22-"],
      ["order №OOOOO-99.99.99-aa-9999", "ab54d-31.08.22uk", "order №ab54d-31.08.22-uk-"],
      ["order №OOOOO-99.99.99-aa-9999", "ab54d-31.08.22ukbcsd", "ab54d-31.08.22ukbcsd"],
      ["order №OOOOO-99.99.99-aa-9999", "ab54d310822uk1234", "order №ab54d-31.08.22-uk-1234"],
      ["order №OOOOO-99.99.99-aa-9999", "orderab54d310822-uk-1234", "order №ab54d-31.08.22-uk-1234"],
      ["order №OOOOO-99.99.99-aa-9999", "order №ab54d310822-uk-1234", "order №ab54d-31.08.22-uk-1234"],
      ["order №OOOOO-99.99.99-aa-9999", "order №ab54d-31.08.22-uk-1234", "order №ab54d-31.08.22-uk-1234"],
      ["order №OOOOO-99.99.99-aa-9999", "or", "order №"],

      ["OOOO:OOOO:OOOO:OOOO:OOOO:OOOO:OOOO:OOOO", "2001", "2001:"],
      ["OOOO:OOOO:OOOO:OOOO:OOOO:OOOO:OOOO:OOOO", "2001:", "2001:"],
      ["OOOO:OOOO:OOOO:OOOO:OOOO:OOOO:OOOO:OOOO", "20010db8", "2001:0db8:"],
      [
        "OOOO:OOOO:OOOO:OOOO:OOOO:OOOO:OOOO:OOOO",
        "20010db885a3000000008a2e03707334",
        "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
      ],
    ];
    for (const [mask, input, want] of cases) {
      expect(maskCorrect(mask, input), `mask '${mask}' with '${input}'`).toBe(want);
    }
  });

  it("oo:word/forms/forms.js#Check filling out the required forms", () => {
    const cb: FormQuestion = { ...blankQuestion("checkboxes"), id: "cb", options: ["Yes"] };
    const t1: FormQuestion = { ...blankQuestion("short_answer"), id: "t1" };
    const t2: FormQuestion = { ...blankQuestion("short_answer"), id: "t2" };
    const form = { settings: undefined as unknown as Form["settings"], questions: [cb, t1, t2] };
    expect(isAllRequiredFilled(form, {})).toBe(true);

    cb.required = true;
    expect(isAllRequiredFilled(form, {})).toBe(false);
    const ans: Record<string, string | string[]> = { cb: ["Yes"] };
    expect(isAllRequiredFilled(form, ans)).toBe(true);

    t1.required = true;
    expect(isAllRequiredFilled(form, ans)).toBe(false);
    ans.t1 = "AB";
    expect(isAllRequiredFilled(form, ans)).toBe(true);

    // A masked field that isn't required still has to be complete once filled.
    t2.text_format = "mask";
    t2.mask = "999-aaa";
    expect(isAllRequiredFilled(form, ans)).toBe(true);
    ans.t2 = "123";
    expect(isAllRequiredFilled(form, ans)).toBe(false);
    ans.t2 = "123-ABC";
    expect(isAllRequiredFilled(form, ans)).toBe(true);
    ans.t2 = "123-A12";
    expect(isAllRequiredFilled(form, ans)).toBe(false);

    t2.text_format = "";
    t2.validation = {
      kind: "regex",
      op: "matches",
      value:
        "https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)",
    };
    ans.t2 = "123-AAB";
    expect(isAllRequiredFilled(form, ans)).toBe(false);
    ans.t2 = "";
    expect(isAllRequiredFilled(form, ans)).toBe(true);
    ans.t2 = "https://www.onlyoffice.com/";
    expect(isAllRequiredFilled(form, ans)).toBe(true);
  });

  it("oo:word/forms/forms.js#Check GetAllForms function", () => {
    const form = {
      questions: [
        { ...blankQuestion("short_answer"), id: "a" },
        { ...blankSection(), id: "s" },
        { ...blankQuestion("checkbox_grid"), id: "g", rows: ["r"], options: ["c"] },
      ],
    };
    expect(getAllFormsData(form, {}).map((d) => d.key)).toEqual(["a", "g"]);
  });

  it("oo:word/forms/forms.js#Check GetAllFormsData/SetAllFormsData", () => {
    const form = {
      questions: [
        { ...blankQuestion("short_answer"), id: "t1", title: "TextForm1" },
        { ...blankQuestion("short_answer"), id: "t2", title: "TextForm2" },
        { ...blankQuestion("short_answer"), id: "t3", title: "TextForm3" },
        { ...blankQuestion("multiple_choice"), id: "g1", title: "Group1", options: ["Choice1", "123", "Last"] },
        { ...blankQuestion("multiple_choice"), id: "g2", title: "Group2", options: ["Choice1", "Choice2"] },
        { ...blankQuestion("checkboxes"), id: "cb", title: "CheckBox1", options: ["On"] },
        { ...blankQuestion("dropdown"), id: "dd", title: "DropDown1", options: ["Item1", "Item2"] },
        { ...blankQuestion("date"), id: "dt", title: "DatePicker1" },
      ],
    };
    let answers: AnswerMap = { t1: "123", t2: "222", t3: "333", dt: "2024-07-24" };
    expect(getAllFormsData(form, answers)).toEqual([
      { key: "t1", title: "TextForm1", type: "short_answer", value: "123" },
      { key: "t2", title: "TextForm2", type: "short_answer", value: "222" },
      { key: "t3", title: "TextForm3", type: "short_answer", value: "333" },
      { key: "g1", title: "Group1", type: "multiple_choice", value: "", options: ["Choice1", "123", "Last"] },
      { key: "g2", title: "Group2", type: "multiple_choice", value: "", options: ["Choice1", "Choice2"] },
      { key: "cb", title: "CheckBox1", type: "checkboxes", value: [], options: ["On"] },
      { key: "dd", title: "DropDown1", type: "dropdown", value: "", options: ["Item1", "Item2"] },
      { key: "dt", title: "DatePicker1", type: "date", value: "2024-07-24" },
    ]);
    answers = setAllFormsData(form, answers, [
      { key: "TextForm1", value: "text1" },
      { key: "t2", value: "another text" },
      { key: "Group1", value: "Last" },
      { key: "Group2", value: "Choice2" },
      { key: "DropDown1", value: "Nope" }, // not an option: ignored
      { key: "Missing", value: "x" },
    ]);
    expect(answers).toEqual({
      t1: "text1",
      t2: "another text",
      t3: "333",
      dt: "2024-07-24",
      g1: "Last",
      g2: "Choice2",
    });
  });
});

describe("complex forms (grids)", () => {
  const grid = (over: Partial<FormQuestion> = {}): FormQuestion => ({
    ...blankQuestion("multiple_choice_grid"),
    id: "g",
    rows: ["Mon", "Tue"],
    options: ["AM", "PM"],
    ...over,
  });

  it("oo:word/forms/complexForm.js#Check is all required form filled", () => {
    const form = { settings: undefined as unknown as Form["settings"], questions: [grid({ required: true })] };
    expect(isAllRequiredFilled(form, {})).toBe(false);
    expect(isAllRequiredFilled(form, { g: { Mon: "AM" } })).toBe(false);
    expect(isAllRequiredFilled(form, { g: { Mon: "AM", Tue: "PM" } })).toBe(true);
    form.questions[0].required = false;
    expect(isAllRequiredFilled(form, { g: { Mon: "AM" } })).toBe(true);
  });

  it("oo:word/forms/complexForm.js#Check form to json conversion", () => {
    const q = grid({
      type: "checkbox_grid",
      limit_one_per_column: true,
      validation: { kind: "number", op: "gt", value: "1", error_text: "x" },
      text_format: "phone",
      rating_icon: "heart",
      after_section: SUBMIT_TARGET,
    });
    const back = JSON.parse(JSON.stringify(q)) as FormQuestion;
    expect(back).toEqual(q);
    const answers = { g: { Mon: ["AM"], Tue: ["PM"] } };
    expect(JSON.parse(JSON.stringify(answers))).toEqual(answers);
  });

  it("validates grid rows and columns", () => {
    expect(validateAnswer(grid(), { Mon: "AM", Tue: "AM" })).toBeNull();
    expect(validateAnswer(grid({ limit_one_per_column: true }), { Mon: "AM", Tue: "AM" })).toMatch(
      /per column/,
    );
    expect(validateAnswer(grid(), { Wed: "AM" })).toMatch(/Unknown row/);
    expect(validateAnswer(grid(), { Mon: "Night" })).toMatch(/Unknown column/);
    expect(validateAnswer(grid(), { Mon: ["AM", "PM"] })).toMatch(/one response per row/);
    expect(validateAnswer(grid({ type: "checkbox_grid" }), { Mon: ["AM", "PM"] })).toBeNull();
    expect(questionError(grid({ required: true }), undefined)).toMatch(/one response per row/);
  });
});

describe("response validation", () => {
  const short = (validation: FormValidation, extra: Partial<FormQuestion> = {}): FormQuestion => ({
    ...blankQuestion("short_answer"),
    validation,
    ...extra,
  });
  const cases: [string, FormQuestion, string | string[], string | null][] = [
    ["empty passes", short({ kind: "number", op: "gt", value: "5" }), "", null],
    ["gt ok", short({ kind: "number", op: "gt", value: "5" }), "6", null],
    ["gt fail", short({ kind: "number", op: "gt", value: "5" }), "5", "Must be a number greater than 5"],
    ["gte", short({ kind: "number", op: "gte", value: "5" }), "5", null],
    ["lt", short({ kind: "number", op: "lt", value: "5" }), "7", "Must be a number less than 5"],
    ["lte", short({ kind: "number", op: "lte", value: "5" }), "5", null],
    ["eq", short({ kind: "number", op: "eq", value: "2.5" }), "2.50", null],
    ["neq", short({ kind: "number", op: "neq", value: "3" }), "3", "Must be a number not equal to 3"],
    ["between ok", short({ kind: "number", op: "between", value: "1", value2: "10" }), "10", null],
    ["between fail", short({ kind: "number", op: "between", value: "1", value2: "10" }), "11", "Must be a number between 1 and 10"],
    ["not between", short({ kind: "number", op: "not_between", value: "1", value2: "10" }), "5", "Must be a number not between 1 and 10"],
    ["is number", short({ kind: "number", op: "is_number" }), "12abc", "Must be a number"],
    ["negative decimal", short({ kind: "number", op: "is_number" }), "-3.5", null],
    ["Infinity is not a number", short({ kind: "number", op: "is_number" }), "Infinity", "Must be a number"],
    ["whole ok", short({ kind: "number", op: "whole_number" }), "42", null],
    ["whole fail", short({ kind: "number", op: "whole_number" }), "4.2", "Must be a whole number"],
    ["contains", short({ kind: "text", op: "contains", value: "@acme" }), "bob@acme.org", null],
    ["contains fail", short({ kind: "text", op: "contains", value: "@acme" }), "bob@x.org", 'Must contain "@acme"'],
    ["not contains", short({ kind: "text", op: "not_contains", value: "spam" }), "no spam", 'Must not contain "spam"'],
    ["email ok", short({ kind: "text", op: "email" }), "a@b.co", null],
    ["email fail", short({ kind: "text", op: "email" }), "a@b", "Must be an email address"],
    ["url ok", short({ kind: "text", op: "url" }), "https://grown.haus/forms?x=1", null],
    ["url bare host", short({ kind: "text", op: "url" }), "www.example.com", null],
    ["url fail", short({ kind: "text", op: "url" }), "not a url", "Must be a URL"],
    ["max chars", short({ kind: "length", op: "max_chars", value: "3" }), "abcd", "Must be at most 3 characters"],
    ["max chars counts code points", short({ kind: "length", op: "max_chars", value: "3" }), "äöü", null],
    ["min chars", short({ kind: "length", op: "min_chars", value: "3" }), "ab", "Must be at least 3 characters"],
    ["regex matches", short({ kind: "regex", op: "matches", value: "[A-Fa-f0-9]+" }), "12FF", null],
    ["regex matches fail", short({ kind: "regex", op: "matches", value: "[A-Fa-f0-9]+" }), "Test", "Must match the pattern [A-Fa-f0-9]+"],
    ["regex contains", short({ kind: "regex", op: "contains", value: "\\d" }), "abc1", null],
    ["regex not contains", short({ kind: "regex", op: "not_contains", value: "\\d" }), "abc1", "Must not contain a match for \\d"],
    ["regex not matches", short({ kind: "regex", op: "not_matches", value: "a+" }), "aaa", "Must not match the pattern a+"],
    ["bad regex is ignored", short({ kind: "regex", op: "matches", value: "(" }), "x", null],
    ["custom error", short({ kind: "number", op: "gt", value: "0", error_text: "Positive please" }), "-1", "Positive please"],
    [
      "paragraph length",
      { ...blankQuestion("paragraph"), validation: { kind: "length", op: "max_chars", value: "5" } },
      "too long text",
      "Must be at most 5 characters",
    ],
    [
      "checkbox at least",
      { ...blankQuestion("checkboxes"), validation: { kind: "checkbox", op: "at_least", value: "2" } },
      ["a"],
      "Must select at least 2 options",
    ],
    [
      "checkbox at most",
      { ...blankQuestion("checkboxes"), validation: { kind: "checkbox", op: "at_most", value: "1" } },
      ["a", "b"],
      "Must select at most 1 options",
    ],
    [
      "checkbox exactly",
      { ...blankQuestion("checkboxes"), validation: { kind: "checkbox", op: "exactly", value: "2" } },
      ["a", "b"],
      null,
    ],
  ];
  it.each(cases)("%s", (_name, q, v, want) => {
    expect(validateAnswer(q, v)).toBe(want);
  });

  it("text formats", () => {
    const f = (text_format: FormQuestion["text_format"], mask?: string): FormQuestion => ({
      ...blankQuestion("short_answer"),
      text_format,
      mask,
    });
    expect(validateAnswer(f("digits"), "12a")).toBe("Must contain only digits");
    expect(validateAnswer(f("letters"), "привет")).toBeNull();
    expect(validateAnswer(f("phone"), "(555) 123-4567")).toBeNull();
    expect(validateAnswer(f("phone"), "(555) 123")).toBe("Must match the format (999) 999-9999");
    expect(validateAnswer(f("zip"), "1234a")).toBe("Must match the format 99999");
    expect(validateAnswer(f("credit_card"), "4111 1111 1111 1111")).toBeNull();
    expect(validateAnswer(f("mask", "\\A\\B-999"), "AB-123")).toBeNull();
    expect(validateAnswer(f("mask", "\\A\\B-999"), "XY-123")).toBe("Must match the format AB-999");
    expect(maskLength("9999 9999 9999 9999")).toBe(19);
    expect(maskCheck("(999) 999-9999", "(555) 1")).toBe(true);
  });

  it("typing into a formatted input", () => {
    const phone = { text_format: "phone" as const };
    expect(applyTextFormat(phone, "", "5")).toBe("(5");
    expect(applyTextFormat(phone, "(55", "(555")).toBe("(555) ");
    expect(applyTextFormat(phone, "(555) ", "(555) x")).toBe("(555) "); // rejected
    expect(applyTextFormat(phone, "(555) ", "(555)")).toBe("(555)"); // deleting
    expect(applyTextFormat(phone, "", "5551234567")).toBe("(555) 123-4567"); // paste
    expect(applyTextFormat(phone, "(555) 123-4567", "(555) 123-45678")).toBe("(555) 123-4567");
    expect(applyTextFormat({ text_format: "digits" }, "12", "12a")).toBe("12");
    expect(applyTextFormat({ text_format: "letters" }, "ab", "abc")).toBe("abc");
    expect(applyTextFormat({ text_format: "" }, "", "anything")).toBe("anything");
  });

  it("rating range", () => {
    const r = { ...blankQuestion("rating"), scale_max: 3 };
    expect(validateAnswer(r, "3")).toBeNull();
    expect(validateAnswer(r, "4")).toBe("Must be a rating from 1 to 3");
    expect(validateAnswer({ ...r, scale_max: 0 }, "5")).toBeNull();
  });
});

describe("section branching", () => {
  function branchingForm(): Pick<Form, "settings" | "questions"> {
    const q = (over: Partial<FormQuestion>): FormQuestion => ({ ...blankQuestion("short_answer"), ...over });
    return {
      settings: {
        collect_email: false,
        limit_one_response: false,
        show_progress_bar: false,
        shuffle_questions: false,
        confirmation_message: "",
        is_quiz: false,
      },
      questions: [
        q({ id: "name", required: true }),
        q({
          id: "pet",
          type: "multiple_choice",
          options: ["Cat", "Dog", "None"],
          go_to_section: { Cat: "s-cats", Dog: "s-dogs", None: SUBMIT_TARGET },
        }),
        { ...blankSection(), id: "s-cats", after_section: SUBMIT_TARGET },
        q({ id: "cat", required: true }),
        { ...blankSection(), id: "s-dogs" },
        q({ id: "dog", required: true }),
        { ...blankSection(), id: "s-end" },
        q({ id: "extra", type: "paragraph" }),
      ],
    };
  }

  it("follows go-to-section and after-section", () => {
    const f = branchingForm();
    expect(pagePath(f, { pet: "Cat" })).toEqual([0, 1]);
    expect(pagePath(f, { pet: "Dog" })).toEqual([0, 2, 3]);
    expect(pagePath(f, { pet: "None" })).toEqual([0]);
    expect([...visitedQuestionIds(f, { pet: "Dog" })]).toEqual(["name", "pet", "dog", "extra"]);
  });

  it("after first section and loops", () => {
    const f = branchingForm();
    f.questions[1].go_to_section = {};
    f.settings.after_first_section = "s-end";
    expect(pagePath(f, {})).toEqual([0, 3]);
    const g = branchingForm();
    g.questions[2].after_section = "s-cats";
    expect(pagePath(g, { pet: "Cat" })).toEqual([0, 1]);
  });

  it("skipped sections: required ignored, answers pruned", () => {
    const f = branchingForm();
    const answers = { name: "Ann", pet: "Cat", cat: "Tom", dog: "Rex" };
    expect(isAllRequiredFilled(f, answers)).toBe(true);
    expect(pruneSkipped(f, answers)).toEqual({ name: "Ann", pet: "Cat", cat: "Tom" });
    expect(isAllRequiredFilled(f, { name: "Ann", pet: "Dog" })).toBe(false);
  });
});
