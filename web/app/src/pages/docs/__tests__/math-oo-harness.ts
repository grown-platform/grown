// Shared runner for the OnlyOffice math-autocorrection fixture cases
// (fixtures/math-autocorrection.json): each case types or converts an input
// and compares the top-level elements (OnlyOffice class name + linear text).
import { CLASS_NAMES, type Content } from "../math/model";
import { linearOf, parseLinear } from "../math/linear";
import { MathInput } from "../math/autocorrect";
import { latexOf, parseLatex } from "../math/latex";

export interface MathCase {
  tag: string;
  input: string;
  mode: "unicode" | "latex";
  convert: boolean;
  otherForm?: boolean;
  expected: Array<[string, string]>;
}

export function elements(c: Content, latex: boolean): Array<[string, string]> {
  return c.map((n) => [CLASS_NAMES[n.t], latex ? latexOf(n) : linearOf(n)]);
}

/** buildCase returns the top-level content a case produces. */
export function buildCase(c: MathCase): Content {
  if (c.mode === "latex") return parseLatex(c.input);
  if (c.convert) return parseLinear(c.input);
  const m = new MathInput();
  m.type(c.input);
  return m.root;
}

/** compare checks elements the way the OnlyOffice test does: it stops at the
 *  first expected entry without a counterpart. */
export function runCase(c: MathCase): { ok: boolean; got: string } {
  const content = buildCase(c);
  const latexOut = c.mode === "latex" ? !c.otherForm : !!c.otherForm;
  const got = elements(content, latexOut);
  let ok = true;
  for (let i = 0; i < c.expected.length && i < got.length; i++) {
    if (got[i][0] !== c.expected[i][0] || got[i][1] !== c.expected[i][1]) ok = false;
  }
  return { ok, got: got.map((e) => e[0].replace(/^C|^Para/, "") + ":" + e[1]).join(" | ") };
}
