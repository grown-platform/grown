// Grown-native tests for equations (Docs M11): the math node, OMML
// (.docx) both ways, MathML/HTML export and import, KaTeX rendering, the
// equation commands and Yjs sync. OnlyOffice ports live in
// oo/math-autocorrect.test.ts and oo/mathml-import.test.ts.
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import katex from "katex";
import type { Editor } from "@tiptap/core";
import { makeEditor, makeSyncedEditors, pressKey } from "./harness";
import { buildDocx } from "./docx-fixture";
import cases from "./fixtures/math-autocorrection.json";
import { readDocx } from "../docx/read";
import { writeDocx } from "../docx/write";
import { applyDocxImport, collectDocxInput } from "../docx/apply";
import { parseXml } from "../docx/xml";
import { type Content, isObj, mapRuns, run } from "../math/model";
import { plainAlpha } from "../math/symbols";
import { parseLinear, toLinear } from "../math/linear";
import { MathInput, correctWords } from "../math/autocorrect";
import { toKatex, parseLatex, latexContent } from "../math/latex";
import { parseMathML, toMathML } from "../math/mathml";
import { readOMML, writeOMML } from "../math/omml";
import { contentOf, renderMath } from "../math/MathNode";
import {
  TEMPLATES,
  isLinearForm,
  matrixInsert,
  removeOuterBrackets,
  setFractionType,
  setLimitLocation,
  toLinearForm,
  toProfessional,
  wrapInBrackets,
} from "../math/ops";

const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const mr = (t: string) => `<m:r><m:t>${t}</m:t></m:r>`;

/** An OMML sample with most object kinds, written the way Word does. */
const OMML_SAMPLE =
  `<m:oMath ${M}>` +
  `<m:f><m:num>${mr("a")}</m:num><m:den>${mr("b")}</m:den></m:f>${mr("+")}` +
  `<m:sSup><m:e>${mr("x")}</m:e><m:sup>${mr("2")}</m:sup></m:sSup>${mr("+")}` +
  `<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${mr("i=1")}</m:sub><m:sup>${mr("n")}</m:sup><m:e>${mr("i")}</m:e></m:nary>` +
  `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${mr("y")}</m:e></m:rad>` +
  `<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e><m:m><m:mr><m:e>${mr("1")}</m:e><m:e>${mr("0")}</m:e></m:mr><m:mr><m:e>${mr("0")}</m:e><m:e>${mr("1")}</m:e></m:mr></m:m></m:e></m:d>` +
  `<m:func><m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>sin</m:t></m:r></m:fName><m:e>${mr("θ")}</m:e></m:func>` +
  `<m:acc><m:accPr><m:chr m:val="̂"/></m:accPr><m:e>${mr("v")}</m:e></m:acc>` +
  `<m:nary><m:naryPr><m:limLoc m:val="subSup"/></m:naryPr><m:sub>${mr("0")}</m:sub><m:sup>${mr("1")}</m:sup><m:e>${mr("t")}</m:e></m:nary>` +
  `</m:oMath>`;

const mathNodes = (e: Editor) => {
  const out: { content: Content; display: boolean }[] = [];
  e.state.doc.descendants((n) => {
    if (n.type.name === "math") out.push({ content: contentOf(n), display: !!n.attrs.display });
  });
  return out;
};

async function importBody(body: string) {
  const imp = await readDocx(await buildDocx({ body }));
  const editor = makeEditor("<p></p>");
  applyDocxImport(editor, imp);
  return { editor, imp };
}

async function exportDocx(editor: Editor): Promise<{ bytes: Uint8Array; xml: string }> {
  const input = collectDocxInput(editor, { title: "Equations" });
  input.now = new Date("2026-09-26T00:00:00Z");
  const bytes = await writeDocx(input);
  const zip = await JSZip.loadAsync(bytes);
  return { bytes, xml: await zip.file("word/document.xml")!.async("string") };
}

describe("OMML", () => {
  it("reads Word's math objects into the model", () => {
    const c = readOMML(parseXml(OMML_SAMPLE).documentElement);
    expect(toLinear(c)).toBe("a/b+x^2+∑_(i=1)^n▒i √y [■(1&0@0&1)] sin⁡θ v̂ ∫_0^1▒t");
    const nary = c.filter(isObj).filter((o) => o.t === "nary");
    expect(nary.map((o) => o.t === "nary" && [o.chr, o.limLoc])).toEqual([["∑", "undOvr"], ["∫", "subSup"]]);
  });

  it("writes OMML that reads back to the same model", () => {
    const c = parseLinear("(a+b)^n=∑_(k=0)^n▒〖(n¦k) a^k b^(n-k)〗");
    const xml = `<w:p ${M}>${writeOMML(c)}</w:p>`;
    const back = readOMML(parseXml(xml).documentElement.firstElementChild!);
    expect(back).toEqual(c);
  });

  it("imports inline and display equations from .docx and exports them again", async () => {
    const body =
      `<w:p><w:r><w:t xml:space="preserve">Area: </w:t></w:r>${OMML_SAMPLE}</w:p>` +
      `<w:p><m:oMathPara ${M}><m:oMath>${mr("E=m")}<m:sSup><m:e>${mr("c")}</m:e><m:sup>${mr("2")}</m:sup></m:sSup></m:oMath></m:oMathPara></w:p>`;
    const { editor, imp } = await importBody(body);
    expect(imp.warnings.join(" ")).not.toContain("equation");
    const first = mathNodes(editor);
    expect(first.map((m) => m.display)).toEqual([false, true]);
    expect(toLinear(first[1].content)).toBe("E=mc^2");

    const { bytes, xml } = await exportDocx(editor);
    expect(xml).toContain("<m:oMathPara><m:oMath>");
    expect(xml).toContain('xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"');
    parseXml(xml); // well-formed with the m: namespace declared
    const again = makeEditor("<p></p>");
    applyDocxImport(again, await readDocx(bytes));
    expect(mathNodes(again)).toEqual(first);
  });

  it("keeps header equations as linear text (the margin schema has no math node)", async () => {
    const imp = await readDocx(
      await buildDocx({
        body: "<w:p><w:r><w:t>Body</w:t></w:r></w:p>",
        header: `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p>${OMML_SAMPLE.replace("<m:oMath ", "<m:oMath ")}</w:p></w:hdr>`,
      }),
    );
    expect(JSON.stringify(imp.header)).toContain("a/b+x^2");
  });
});

describe("math node", () => {
  it("inserts with Ctrl+Alt+= and stores the model as an attribute", () => {
    const e = makeEditor("<p>x</p>");
    pressKey(e, "Mod-Alt-=");
    expect(mathNodes(e)).toHaveLength(1);
    const pos = e.state.doc.content.size - 3;
    const m = new MathInput();
    m.type("1/2 ");
    let at = -1;
    e.state.doc.descendants((n, p) => {
      if (n.type.name === "math") at = p;
    });
    e.commands.updateEquation(at, { content: m.root, display: true });
    expect(toLinear(mathNodes(e)[0].content)).toBe("1/2");
    expect(mathNodes(e)[0].display).toBe(true);
    void pos;
  });

  it("writes MathML in its HTML and reads it back", () => {
    const e = makeEditor("<p></p>");
    e.commands.insertEquation({ content: parseLinear("x=(-b±√(b^2-4ac))/2a"), edit: false });
    const html = e.getHTML();
    expect(html).toContain("<math");
    expect(html).toContain("<mfrac>");
    expect(html).toContain("<msqrt>");
    const back = makeEditor(html);
    expect(mathNodes(back)).toEqual(mathNodes(e));
    expect(e.getText()).toContain("x=(-b±√(b^2-4ac))/2a");
  });

  it("imports MathML pasted from another page", () => {
    const e = makeEditor("<p></p>");
    e.view.pasteHTML('<p>Energy <math display="block"><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math></p>');
    const m = mathNodes(e);
    expect(m).toHaveLength(1);
    expect(toLinear(m[0].content)).toBe("𝐸=𝑚𝑐^2");
    expect(m[0].display).toBe(true);
  });

  it("pastes Word's equation (OMML in its msEquation comment), not the picture", () => {
    const e = makeEditor("<p></p>");
    const word =
      `<html xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"><body><!--StartFragment--><p class=MsoNormal>` +
      `<!--[if gte msEquation 12]><m:oMathPara><m:oMath><m:sSup><m:sSupPr><span style='font-family:"Cambria Math"'><m:ctrlPr></m:ctrlPr></span></m:sSupPr>` +
      `<m:e><i><span style='font-family:"Cambria Math"'><m:r>x</m:r></span></i></m:e><m:sup><i><span><m:r>2</m:r></span></i></m:sup></m:sSup></m:oMath></m:oMathPara><![endif]-->` +
      `<![if !msEquation]><img width=40 height=20 src="file:///C:/Temp/msohtmlclip1/01/clip_image001.png"><![endif]></p><!--EndFragment--></body></html>`;
    e.view.pasteHTML(word);
    const m = mathNodes(e);
    expect(m.map((x) => [toLinear(x.content), x.display])).toEqual([["x^2", true]]);
    expect(e.getHTML()).not.toContain("<img");
  });

  it("renders with KaTeX", () => {
    const el = document.createElement("span");
    renderMath(el, parseLinear("∑_(i=1)^n▒i^2"), false);
    expect(el.querySelector(".katex")).not.toBeNull();
    renderMath(el, [run()], false);
    expect(el.classList.contains("doc-math-empty")).toBe(true);
  });

  it("syncs through Yjs like any node attribute", () => {
    const { editors, sync } = makeSyncedEditors(2);
    editors[0].commands.insertEquation({ content: parseLinear("a^2+b^2=c^2"), edit: false });
    sync();
    expect(mathNodes(editors[1]).map((m) => toLinear(m.content))).toEqual(["a^2+b^2=c^2"]);
  });
});

describe("KaTeX output", () => {
  it("every built-up fixture equation is valid KaTeX input", () => {
    for (const c of cases as { input: string; mode: string; convert: boolean }[]) {
      const content = c.mode === "latex" ? parseLatex(c.input) : parseLinear(c.input);
      expect(() => katex.renderToString(toKatex(content), { throwOnError: true, strict: "ignore" }), c.input).not.toThrow();
    }
  });

  it("LaTeX input and the LaTeX linear view round-trip", () => {
    const src = "\\frac{a}{b}+\\sqrt[3]x+\\sum_{i=1}^{n}{i^2}";
    expect(latexContent(parseLatex(src))).toBe(src);
  });
});

describe("equation commands", () => {
  it("offers a template for each toolbar group", () => {
    expect(TEMPLATES.map((g) => g.id)).toEqual([
      "fraction",
      "script",
      "radical",
      "integral",
      "operator",
      "bracket",
      "function",
      "accent",
      "limit",
      "matrix",
    ]);
    for (const g of TEMPLATES)
      for (const t of g.items) {
        const m = new MathInput();
        m.insertObject(t.make());
        expect(m.root.some(isObj), t.id).toBe(true);
      }
  });

  it("changes fraction kind, limit position, brackets and matrix size", () => {
    const c = parseLinear("a/b+∑_i▒x+■(1&2)");
    expect(toLinear(setFractionType(c, "skw"))).toBe("a⁄b+∑_i▒x+■(1&2)");
    const lim = setLimitLocation(c, "subSup").find((n) => n.t === "nary");
    expect(lim && lim.t === "nary" && lim.limLoc).toBe("subSup");
    expect(toLinear(matrixInsert(c, "row"))).toBe("a/b+∑_i▒x+■(1&2@&)");
    const wrapped = wrapInBrackets(parseLinear("x+1"));
    expect(toLinear(wrapped)).toBe("(x+1)");
    expect(toLinear(removeOuterBrackets(wrapped))).toBe("x+1");
  });

  it("switches between linear and professional form", () => {
    const c = parseLinear("√(x+1)/2");
    const lin = toLinearForm(c);
    expect(isLinearForm(lin)).toBe(true);
    expect(toProfessional(lin)).toEqual(c);
  });

  it("corrects \\words in free-typed linear text", () => {
    expect(correctWords("\\alpha +\\beta\\sqrt x")).toBe("α+β√x");
  });

  it("undo after an autocorrection restores the typed text", () => {
    const m = new MathInput();
    m.type("x^2 ");
    expect(m.root.some(isObj)).toBe(true);
    m.undo();
    expect(toLinear(m.root)).toBe("x^2 ");
    expect(m.root.some(isObj)).toBe(false);
  });

  it("round-trips MathML export and import", () => {
    const c = parseLinear("f(x)=∫_0^x▒sin⁡t");
    const back = mapRuns(parseMathML(toMathML(c)).content, (r) => ({ ...r, text: [...r.text].map(plainAlpha).join("") }));
    expect(toLinear(back)).toBe(toLinear(c));
  });
});
