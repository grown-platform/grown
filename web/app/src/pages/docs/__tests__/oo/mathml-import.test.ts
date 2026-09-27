// Ports of OnlyOffice word/math-ml/math-ml.js (behaviour only): Presentation
// MathML import. OnlyOffice checks the linear text of the imported
// equation; Grown's importer is parseMathML() in math/mathml.ts.
import { describe, expect, it } from "vitest";
import { parseMathML, rgbOf } from "../../math/mathml";
import { type Content, type MObj, type MRun, isRun } from "../../math/model";
import { linearOf, toLinear } from "../../math/linear";

const text = (src: string) => toLinear(parseMathML(src).content);
const firstRun = (c: Content) => c.find((n): n is MRun => isRun(n) && n.text !== "")!;
const rgb = (hex: string | undefined) => (hex ? rgbOf(hex).join(", ") : "");
const obj = (src: string, i = 1) => parseMathML(src).content[i] as MObj;

describe("MathML core attributes", () => {
  it("oo:word/math-ml/math-ml.js#mathcolor in <mi>", () => {
    expect(rgb(firstRun(parseMathML(`<math><mi mathcolor="red">x</mi></math>`).content).color)).toBe("255, 0, 0");
  });
  it("oo:word/math-ml/math-ml.js#mathbackground in <mi>", () => {
    expect(rgb(firstRun(parseMathML(`<math><mi mathbackground="blue">y</mi></math>`).content).bg)).toBe("0, 0, 255");
  });
  it("oo:word/math-ml/math-ml.js#mathcolor & mathbackground in <mi>", () => {
    const r = firstRun(parseMathML(`<math><mi mathcolor="red" mathbackground="blue">z</mi></math>`).content);
    expect(rgb(r.color) + "-" + rgb(r.bg)).toBe("255, 0, 0-0, 0, 255");
  });
  // The three "<sqrt>" cases upstream use the same <mi> markup.
  it("oo:word/math-ml/math-ml.js#mathcolor in <sqrt>", () => {
    expect(rgb(firstRun(parseMathML(`<math><mi mathcolor="red">x</mi></math>`).content).color)).toBe("255, 0, 0");
  });
  it("oo:word/math-ml/math-ml.js#mathbackground in <sqrt>", () => {
    expect(rgb(firstRun(parseMathML(`<math><mi mathbackground="blue">y</mi></math>`).content).bg)).toBe("0, 0, 255");
  });
  it("oo:word/math-ml/math-ml.js#mathcolor & mathbackground in <sqrt>", () => {
    const r = firstRun(parseMathML(`<math><mi mathcolor="red" mathbackground="blue">z</mi></math>`).content);
    expect(rgb(r.color) + "-" + rgb(r.bg)).toBe("255, 0, 0-0, 0, 255");
  });
});

describe("MathML token elements", () => {
  it.skip("oo:word/math-ml/math-ml.js#mathvariant", () => {
    // The upstream case asserts an undefined variable (colorText) and has no
    // expected mathvariant behaviour; mathvariant is covered by the mi cases.
  });
  it("oo:word/math-ml/math-ml.js#Check default mathvariant is italic if content length = 1", () => {
    expect(text(`<math><mi>c</mi></math>`)).toBe("𝑐");
  });
  it("oo:word/math-ml/math-ml.js#Check default mathvariant is normal if content length > 1", () => {
    expect(text(`<math><mi>cx</mi></math>`)).toBe("cx");
  });
  it("oo:word/math-ml/math-ml.js#Add <mi> with normal mathvariant = normal", () => {
    expect(text(`<math><mi mathvariant="normal">c</mi></math>`)).toBe("c");
  });
  it("oo:word/math-ml/math-ml.js#Add <mi> with custom mathvariant = fraktur", () => {
    expect(text(`<math><mi mathvariant="fraktur">xy</mi></math>`)).toBe("𝔵𝔶");
  });
  it("oo:word/math-ml/math-ml.js#Add mi as text", () => {
    expect(text(`<math><mi>c</mi></math>`)).toBe("𝑐");
  });
  it("oo:word/math-ml/math-ml.js#Add mn as text", () => {
    expect(text(`<math><mn>2</mn></math>`)).toBe("2");
  });
  it("oo:word/math-ml/math-ml.js#Add mo", () => {
    expect(text(`<math><mo>+</mo></math>`)).toBe("+");
  });
  it("oo:word/math-ml/math-ml.js#movablelimits default attribute", () => {
    const n = obj(`<math displaystyle="inline"><munderover><mo>∑</mo><mi>i</mi><mi>n</mi></munderover></math>`);
    expect(n.t === "nary" && n.limLoc).toBe("undOvr");
  });
  it("oo:word/math-ml/math-ml.js#movablelimits attribute", () => {
    const n = obj(`<math display="inline"><munderover><mo movablelimits="true">∑</mo><mi>i</mi><mi>n</mi></munderover></math>`);
    expect(n.t === "nary" && n.limLoc).toBe("subSup");
  });
  it("oo:word/math-ml/math-ml.js#linebreak attribute", () => {
    const n = obj(`<math displaystyle="inline"><munderover><mo>∑</mo><mi>i</mi><mi>n</mi></munderover></math>`);
    expect(n.t === "nary" && n.limLoc).toBe("undOvr");
  });
  it("oo:word/math-ml/math-ml.js#Add mtext #1", () => {
    expect(text(`<math><mtext> Theorem 1: </mtext></math>`)).toBe("Theorem 1:");
  });
  it("oo:word/math-ml/math-ml.js#Add mtext #2", () => {
    expect(text(`<math><mtext> &#x2009; </mtext></math>`)).toBe(" ");
  });
  it("oo:word/math-ml/math-ml.js#Add mtext #3", () => {
    const src = `<math>
      <mi>y</mi><mo>=</mo>
      <mrow>
        <msup><mi>x</mi><mn>2</mn></msup>
        <mtext>&nbsp;if&nbsp;</mtext>
        <mrow><mi>x</mi><mo>≥</mo><mn>1</mn></mrow>
        <mtext>&nbsp;and&nbsp;</mtext>
        <mn>2</mn>
        <mtext>&nbsp;otherwise.</mtext>
      </mrow>
    </math>`;
    expect(text(src)).toBe("𝑦=𝑥^2 if 𝑥≥1 and 2 otherwise.");
  });
  it("oo:word/math-ml/math-ml.js#Add ms #1", () => {
    expect(text(`<math><ms> n </ms></math>`)).toBe('"n"');
  });
  it("oo:word/math-ml/math-ml.js#Add ms with custom lquote attribute", () => {
    expect(text(`<math><ms lquote="1"> n </ms></math>`)).toBe('1n"');
  });
  it("oo:word/math-ml/math-ml.js#Add ms with custom rquote attribute", () => {
    expect(text(`<math><ms rquote="2"> n </ms></math>`)).toBe('"n2');
  });
});

describe("MathML layout elements", () => {
  it("oo:word/math-ml/math-ml.js#Add mfrac", () => {
    expect(text(`<math><mfrac><mi> a </mi><mi> b </mi></mfrac></math>`)).toBe("𝑎/𝑏");
  });
  it("oo:word/math-ml/math-ml.js#Add complex mfrac", () => {
    const src = `<math><mfrac>
      <mrow><mo> ( </mo><mfrac><mi> a </mi><mi> b </mi></mfrac><mo> ) </mo><mfrac><mi> a </mi><mi> b </mi></mfrac></mrow>
      <mfrac><mi> c </mi><mi> d </mi></mfrac>
    </mfrac></math>`;
    expect(text(src)).toBe("((𝑎/𝑏) 𝑎/𝑏)/(𝑐/𝑑)");
  });
  it("oo:word/math-ml/math-ml.js#bevelled", () => {
    expect(text(`<math><mfrac bevelled="true"><mi> a </mi><mi> b </mi></mfrac></math>`)).toBe("𝑎⁄𝑏");
  });
  it("oo:word/math-ml/math-ml.js#Add msqrt", () => {
    expect(text(`<math><msqrt><mi>x</mi></msqrt></math>`)).toBe("√(𝑥)");
  });
  it("oo:word/math-ml/math-ml.js#Add mroot", () => {
    expect(text(`<math><mroot><mi>x</mi><mn>5</mn></mroot></math>`)).toBe("√(5&𝑥)");
  });
  it("oo:word/math-ml/math-ml.js#Add merror", () => {
    const src = `<math><merror>
      <mtext> Unrecognized element: mfraction; arguments were:</mtext>
      <mrow> <mn> 1 </mn> <mo> + </mo> <msqrt> <mn> 5 </mn> </msqrt> </mrow>
      <mtext> and </mtext>
      <mn> 2 </mn>
    </merror></math>`;
    const c = parseMathML(src).content;
    expect(c.map(linearOf).join("")).toBe("Unrecognized element: mfraction; arguments were:1+√5and2");
  });
  it("oo:word/math-ml/math-ml.js#Add mpadded", () => {
    const src = `<math><mpadded lspace="2em" voffset="-1em" height="1em" depth="3em" width="7em" style="background: lightblue;">
      <mfrac><mn>23456</mn><mn>78</mn></mfrac></mpadded></math>`;
    expect(text(src)).toBe("23456/78");
  });
  it.skip("oo:word/math-ml/math-ml.js#Add mphantom", () => {
    // grown-variant: the phantom imports as a phantom object (checked in
    // math.test.ts), but its linear form is UnicodeMath's ⟡, not "\mphantom".
  });
  it("oo:word/math-ml/math-ml.js#Add mfenced #1", () => {
    expect(text(`<math><mfenced><mi>x</mi></mfenced></math>`)).toBe("(𝑥)");
  });
  it("oo:word/math-ml/math-ml.js#Add mfenced #2", () => {
    const src = `<math><mfenced><mi>x</mi><mi>y</mi></mfenced></math>`;
    expect(text(src)).toBe("(𝑥∣𝑦)");
    const d = obj(src);
    expect(d.t === "d" && d.sep.codePointAt(0)).toBe(44);
  });
  it("oo:word/math-ml/math-ml.js#Add menclose #1", () => {
    expect(text(`<math><menclose><mi> x </mi><mo> + </mo><mi> y </mi></menclose></math>`)).toBe("▭(𝑥+𝑦)");
  });
  it("oo:word/math-ml/math-ml.js#Add msub", () => {
    expect(text(`<math><msub> <mi> ⅇ </mi><mi> x </mi></msub></math>`)).toBe("ⅇ_𝑥");
  });
  it("oo:word/math-ml/math-ml.js#Add msup", () => {
    expect(text(`<math><msup> <mi> ⅇ </mi><mi> x </mi></msup></math>`)).toBe("ⅇ^𝑥");
  });
  it("oo:word/math-ml/math-ml.js#Add msubsup", () => {
    expect(text(`<math><msubsup><mi> 2 </mi><mi> ⅇ </mi><mi> x </mi></msubsup></math>`)).toBe("2_ⅇ^𝑥");
  });
  const xyz = `<mrow><mi> x </mi><mo> + </mo><mi> y </mi><mo> + </mo><mi> z </mi></mrow>`;
  it("oo:word/math-ml/math-ml.js#Add munder #1", () => {
    expect(text(`<math><munder accentunder="true">${xyz}<mo> ⏟ </mo></munder></math>`)).toBe("⏟(𝑥+𝑦+𝑧)");
  });
  it("oo:word/math-ml/math-ml.js#Add munder #2", () => {
    expect(text(`<math><munder accentunder="false">${xyz}<mo> ⏟ </mo></munder></math>`)).toBe("⏟(𝑥+𝑦+𝑧)");
  });
  it("oo:word/math-ml/math-ml.js#Add mover #1", () => {
    expect(text(`<math><mover accent="true"><mi> x </mi><mo> ^ </mo></mover></math>`)).toBe("𝑥┴^");
  });
  it("oo:word/math-ml/math-ml.js#Add mover #2", () => {
    expect(text(`<math><mover><mn>3</mn><mn>4</mn></mover></math>`)).toBe("3┴4");
  });
  it("oo:word/math-ml/math-ml.js#Add mover #3", () => {
    const src = `<math><mover accent="true">${xyz}<mo> ⏞ </mo></mover><mover accent="false">${xyz}<mo> ⏞ </mo></mover></math>`;
    expect(text(src)).toBe("⏞(𝑥+𝑦+𝑧) ⏞(𝑥+𝑦+𝑧)");
  });
  it("oo:word/math-ml/math-ml.js#Add munderover #1", () => {
    expect(text(`<math><munderover><mn>5</mn><mn>6</mn><mn>7</mn></munderover></math>`)).toBe("(5┴7)┬6");
  });
});

describe("MathML tables", () => {
  const cell = (m: MObj, r: number, c: number) => (m.t === "m" ? toLinear(m.rows[r][c]) : "");
  it("oo:word/math-ml/math-ml.js#Normalize nested mtr in mtable", () => {
    const m = obj(`<math display="block"><semantics><mtable><mtr>
      <mtr><mtd><mi>a</mi></mtd><mtd><mo>=</mo></mtd><mtd><mn>0</mn></mtd></mtr>
      <mtr><mtd><mi>b</mi></mtd><mtd><mo>=</mo></mtd><mtd><mn>1</mn></mtd></mtr>
      <mtr><mtd><mi>c</mi></mtd><mtd><mo>=</mo></mtd><mtd><mn>2</mn></mtd></mtr>
    </mtr></mtable></semantics></math>`);
    expect(m.t).toBe("m");
    expect(m.t === "m" && m.rows.length).toBe(3);
    expect([cell(m, 0, 0), cell(m, 1, 0), cell(m, 2, 0)]).toEqual(["𝑎", "𝑏", "𝑐"]);
  });
  it("oo:word/math-ml/math-ml.js#Normalize nested mtd in mtable", () => {
    const m = obj(`<math display="block"><mtable><mtd>
      <mtd><mi>x</mi></mtd><mtd><mo>=</mo></mtd><mtd><mn>1</mn></mtd>
    </mtd></mtable></math>`);
    expect(m.t).toBe("m");
    expect(m.t === "m" && [m.rows.length, m.rows[0].length]).toEqual([1, 3]);
    expect([cell(m, 0, 0), cell(m, 0, 1), cell(m, 0, 2)]).toEqual(["𝑥", "=", "1"]);
  });
  it("oo:word/math-ml/math-ml.js#Normalize mixed nested mtr and mtd in mtable", () => {
    const m = obj(`<math display="block"><semantics><mtable>
      <mtr><mtr><mtd><mi>a</mi></mtd><mtd><mo>=</mo></mtd><mtd><mn>0</mn></mtd></mtr></mtr>
      <mtd><mtd><mi>b</mi></mtd><mtd><mo>=</mo></mtd><mtd><mn>1</mn></mtd></mtd>
      <mtr><mtd><mi>c</mi></mtd><mtd><mo>=</mo></mtd><mtd><mn>2</mn></mtd></mtr>
    </mtable></semantics></math>`);
    expect(m.t).toBe("m");
    expect(m.t === "m" && m.rows.length).toBe(3);
    expect([cell(m, 0, 0), cell(m, 1, 0), cell(m, 2, 0)]).toEqual(["𝑎", "𝑏", "𝑐"]);
  });
});
