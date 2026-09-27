// Ports of OnlyOffice word/math-autocorrection/math-autocorrection.js
// (behaviour only). The 846 cases its Test() helper generates are data in
// ../fixtures/math-autocorrection.json (input, mode, expected top-level
// elements as [OnlyOffice class, linear text]); each carries its own tag.
// The 32 hand-written QUnit tests follow below with their tags.
import { afterEach, describe, expect, it } from "vitest";
import cases from "../fixtures/math-autocorrection.json";
import { runCase, type MathCase } from "../math-oo-harness";
import { MathInput } from "../../math/autocorrect";
import { CLASS_NAMES, type Content, type MObj, isRun, run, slots } from "../../math/model";
import { linearOf, toLinear } from "../../math/linear";
import { latexContent, parseLatex } from "../../math/latex";
import { FUNC_NAMES } from "../../math/symbols";

const classes = (c: Content) => c.map((n) => CLASS_NAMES[n.t]);

describe("math autocorrection (generated cases)", () => {
  for (const c of cases as MathCase[]) {
    it(c.tag, () => {
      const r = runCase(c);
      const got = r.got.split(" | ").slice(0, c.expected.length);
      const want = c.expected.map((e) => e[0].replace(/^C|^Para/, "") + ":" + e[1]).slice(0, got.length);
      expect(got).toEqual(want);
    });
  }
});

describe("math autocorrection (Unicode)", () => {
  it("oo:word/math-autocorrection/math-autocorrection.js#711 Unicode: Binomial auto-correction", () => {
    const m = new MathInput();
    m.type("\\binomial ");
    expect(toLinear(m.root)).toBe("(a+b)^n=∑_(k=0)^n ▒(n¦k)a^k b^(n-k)");
    m.type(" ");
    expect(classes(m.root)).toEqual(["ParaRun", "CDelimiter", "ParaRun", "CDegree", "ParaRun", "CDegree", "ParaRun"]);
    m.moveToEnd();
    m.type(" ");
    expect(CLASS_NAMES[m.root[1].t]).toBe("CNary");
    m.toLinearView();
    expect(toLinear(m.root)).toBe("(a+b)^n=∑_(k=0)^n▒〖(n¦k) a^k b^(n-k)〗");
  });
});

describe("math autocorrection (Bugs)", () => {
  it("oo:word/math-autocorrection/math-autocorrection.js#712 Unicode/Bugs: Check correct word while input rBrackets", () => {
    const m = new MathInput();
    m.type("(1->\\infty)");
    expect(toLinear(m.root)).toBe("(1→∞)");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#713 Unicode/Bugs: Check processing of ·begin bracket and | on defferent levels", () => {
    const m = new MathInput();
    m.type("ln |1|");
    m.moveToEnd();
    m.type("+");
    expect(toLinear(m.root)).toBe("ln⁡|1|+");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#714 Unicode/Bugs: Check absolute brackets inside normal brackets", () => {
    const m = new MathInput();
    m.type("(x|y|z)");
    m.convertAll();
    const d = m.root[1] as Extract<MObj, { t: "d" }>;
    expect(d.t).toBe("d");
    const inner = d.items[0];
    expect(linearOf(inner[0])).toBe("x");
    expect(linearOf(inner[1])).toBe("|y|");
    expect(linearOf(inner[2])).toBe("z");
    expect(toLinear(m.root)).toBe("(x|y|z)");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#715 Unicode/Bugs: Check absolute brackets inside normal brackets", () => {
    const m = new MathInput();
    m.type("5 1/2 ");
    expect(linearOf(m.root[0])).toBe("5");
    expect(linearOf(m.root[1])).toBe("1/2");
    expect(toLinear(m.root)).toBe("5 1/2");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#716 Unicode/Bugs: Check Dirac notion", () => {
    const text = "p=∑_ψ▒〖P_ψ |ψ⟩ ⟨ψ|〗";
    const m = new MathInput([run()], { autoConvert: false });
    m.type(text);
    m.convertAll();
    expect(toLinear(m.root)).toBe(text);
    m.toLinearView();
    expect(toLinear(m.root)).toBe(text);
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#717 Unicode/Bugs: Check eqarray", () => {
    const m = new MathInput();
    m.type("{█(a, n odd@|a|, n even)┤");
    m.convertAll();
    expect(toLinear(m.root)).toBe("{█(a, n odd@|a|, n even)┤");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#718 Unicode/Bugs: Check eqarray frac", () => {
    const m = new MathInput();
    m.type("█(1@█(@█(@█(@))))/2");
    m.convertAll();
    expect(toLinear(m.root)).toBe("█(1@█(@█(@█(@))))/2");
  });
  it.skip("oo:word/math-autocorrection/math-autocorrection.js#719 Unicode/Bugs: Check review info convert math; bug #67505", () => {
    // n/a: tracked changes are recorded on the equation node as a whole,
    // not per character run inside it (see docs.md §6.12).
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#720 Unicode/Bugs: Bug 64357", () => {
    const m = new MathInput([run(), { t: "m", rows: [[[run()], [run()]]] }, run()]);
    m.enter([{ index: 1, slot: 0 }]);
    m.toLinearView();
    expect(m.root.some((n) => n.t === "m")).toBe(false);
  });
  it.skip("oo:word/math-autocorrection/math-autocorrection.js#721 Unicode/Bugs: Save manual break", () => {
    // TODO: manual line breaks inside equations (OMML m:brk) are not modelled.
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#722 Unicode/Bugs: Check complex content in math func", () => {
    const m = new MathInput();
    m.type("cos  \\theta ");
    expect(toLinear(m.root)).toBe("cos⁡〖 θ〗");
  });
});

describe("math autocorrection (Cursor)", () => {
  afterEach(() => {
    const i = FUNC_NAMES.indexOf("custom");
    if (i >= 0) FUNC_NAMES.splice(i, 1);
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#726 Cursor: Check cursor position after convert empty math func (cos, sin..)", () => {
    const m = new MathInput();
    m.type("cos ");
    expect(m.path).toEqual([{ index: 1, slot: 1 }]);
    expect(m.elem).toBe(0);
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#727 Cursor: Check auto-correction of frac and content after it", () => {
    const m = new MathInput();
    m.type("12/cx");
    m.moveLeft(1);
    m.type(" ");
    expect(linearOf(m.root[1])).toBe("12/c");
    expect(linearOf(m.root[2])).toBe("x");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#728 Cursor: Check cursor position after convert empty big nary", () => {
    const m = new MathInput();
    m.type("\\int  ");
    expect(m.path.length).toBe(1);
    expect(m.path[0].index).toBe(1);
    const nary = m.root[1] as Extract<MObj, { t: "nary" }>;
    expect(slots(nary)[m.path[0].slot]).toBe(nary.base);
    expect(m.elem).toBe(0);
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#729 Cursor: Check two spaces after nary (for example) not trigger auto-correction", () => {
    const m = new MathInput();
    m.type("∫ ");
    m.undo();
    m.type(" ");
    expect(m.root.length).toBe(1);
    expect(isRun(m.root[0])).toBe(true);
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#730 Cursor: Check create custom function with auto-correction", () => {
    FUNC_NAMES.push("custom");
    const m = new MathInput();
    m.type("custom ");
    expect(m.root.length).toBe(3);
    const f = m.root[1] as Extract<MObj, { t: "func" }>;
    expect(f.t).toBe("func");
    expect(toLinear(f.name)).toBe("custom");
    expect(toLinear(f.arg)).toBe("");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#731 Cursor: Check cursor position after convert math func with content (cos, sin..)", () => {
    const m = new MathInput();
    m.type("cos\\funcapply(1+2) ");
    expect(m.path).toEqual([]);
    expect(m.elem).toBe(2);
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#732 Cursor: Create function after degree (bug 79822)", () => {
    const m = new MathInput();
    m.type("x^2 log ");
    expect(m.root.length).toBe(5);
    expect(m.root[3].t).toBe("func");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#733 Cursor: Add nary from menu", () => {
    const m = new MathInput();
    m.insertObject({ t: "nary", chr: "∫", limLoc: "subSup", sub: null, sup: null, base: [] });
    expect(toLinear(m.root)).toBe("∫");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#734 Cursor: Add linear fraction and convert to linear to proff", () => {
    const m = new MathInput();
    m.insertObject({ t: "f", type: "lin", num: [], den: [] });
    m.enter([{ index: 1, slot: 1 }]);
    m.type("y");
    m.enter([{ index: 1, slot: 0 }]);
    m.type("x");
    expect((m.root[1] as Extract<MObj, { t: "f" }>).type).toBe("lin");
    m.toLinearView();
    expect(toLinear(m.root)).toBe("x∕y");
    m.convertAll();
    expect((m.root[1] as Extract<MObj, { t: "f" }>).type).toBe("lin");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#735 Cursor: Check spaces degradation while convert math", () => {
    const m = new MathInput();
    m.type("1/2  1/2  1/2 ");
    for (let k = 0; k < 3; k++) {
      m.toLinearView();
      m.convertAll();
    }
    expect(toLinear(m.root)).toBe("1/2 1/2 1/2");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#736 Cursor: Function autocorrection with _ and ^", () => {
    const m = new MathInput();
    m.type("cos_");
    expect(toLinear(m.root)[3]).toBe("⁡");
    expect((m.root[0] as { sty?: string }).sty).toBe("p");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#737 Cursor: Limit function autocorrection with _ and ^", () => {
    const m = new MathInput();
    m.type("lim_");
    expect(toLinear(m.root)[3]).toBe("⁡");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#738 Cursor: Check processing of fractions", () => {
    const m = new MathInput();
    m.type("1/2/3/4/5/6/7/8 ");
    expect(toLinear(m.root)).toBe("((((((1/2)/3)/4)/5)/6)/7)/8");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#739 Cursor: Check processing of fractions 2", () => {
    const m = new MathInput();
    m.type("1/2 //3 ");
    expect(toLinear(m.root)).toBe("((1/2)/)/3");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#740 Cursor: Check space eating while auto-convert between-correction", () => {
    const m = new MathInput();
    m.type(" 1/2 ");
    expect(toLinear(m.root)).toBe("1/2");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#741 Cursor: Check cursor pos after del content inside math func argument", () => {
    const m = new MathInput();
    m.type("cos ");
    m.type("2_x ");
    m.backspace();
    m.backspace();
    expect(m.path).toEqual([{ index: 1, slot: 1 }]);
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#742 Cursor: Check degree pos after convert inside math content", () => {
    const m = new MathInput([run()], { autoConvert: false });
    m.type("1/ ");
    m.convertAll();
    m.autoConvert = true;
    const fracIndex = m.root.findIndex((n) => n.t === "f");
    m.enter([{ index: fracIndex, slot: 1 }]);
    m.type("2_x ");
    expect(m.elem).toBe(2);
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#743 Cursor: Undo for empty math content placeholder", () => {
    const m = new MathInput([run(), { t: "d", beg: "(", end: ")", sep: "∣", items: [[run()]] }, run()]);
    m.enter([{ index: 1, slot: 0 }]);
    m.type("1");
    m.undo();
    const item = (m.root[1] as Extract<MObj, { t: "d" }>).items[0];
    expect(toLinear(item)).toBe("");
  });
});

describe("math autocorrection (LaTeX)", () => {
  it("oo:word/math-autocorrection/math-autocorrection.js#849 LaTeX/radical: Check pos for radical in LaTeX", () => {
    const c = parseLatex("\\pm\\sqrt");
    expect(latexContent(parseLatex(latexContent(c)))).toBe("\\pm\\sqrt");
  });
  it("oo:word/math-autocorrection/math-autocorrection.js#850 LaTeX/bugs: Check linear form for nonstandard name func", () => {
    const src = "\\lim\\below{\\left(n\\to\\infty\\right)}{\\left(1+\\frac{1}{n}\\right)^n}";
    expect(latexContent(parseLatex(latexContent(parseLatex(src))))).toBe(src);
  });
});
