// Office Math Markup (OMML, the m: namespace in .docx) <-> the equation
// model. The model mirrors OMML one to one, so both directions are direct.
import { type Content, type MNode, type MObj, type MRun, isRun, normalize, run } from "./model";
import { NARY_INTEGRALS } from "./symbols";

export const OMML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

// --- reading -------------------------------------------------------------------

// Names match without prefix and case, so the OMML Word puts in clipboard
// HTML (<m:omath> parsed as HTML) reads too.
const local = (e: Element) => (e.localName || e.nodeName).replace(/^.*:/, "").toLowerCase();
const kids = (e: Element | null | undefined, name?: string) => {
  const out: Element[] = [];
  if (!e) return out;
  for (let c = e.firstElementChild; c; c = c.nextElementSibling) if (!name || local(c) === name) out.push(c);
  return out;
};
const kid = (e: Element | null | undefined, name: string) => kids(e, name)[0] ?? null;
function val(e: Element | null | undefined): string | null {
  if (!e) return null;
  for (let i = 0; i < e.attributes.length; i++) {
    const a = e.attributes[i];
    if (a.name.replace(/^.*:/, "").toLowerCase() === "val") return a.value;
  }
  return null;
}
const prop = (e: Element, pr: string, name: string) => val(kid(kid(e, pr), name));
const on = (e: Element, pr: string, name: string) => {
  const p = kid(kid(e, pr), name);
  if (!p) return false;
  const v = val(p);
  return v == null || v === "1" || v === "on" || v === "true";
};

/** readOMML reads an m:oMath element into model content. */
export function readOMML(oMath: Element): Content {
  return normalize(readContent(oMath));
}

/** readOMathPara: the equations of an m:oMathPara (one per m:oMath). */
export function readOMathPara(para: Element): Content[] {
  return kids(para, "omath").map(readOMML);
}

function arg(e: Element | null): Content {
  return e ? normalize(readContent(e)) : [run()];
}

function readRun(r: Element): MRun {
  let text = "";
  for (const c of kids(r)) {
    const n = local(c);
    if (n === "t") text += c.textContent ?? "";
    else if (n === "tab") text += "\t";
    else if (n === "br") text += "";
  }
  if (!kids(r).some((c) => local(c) === "t")) {
    // Word's clipboard HTML puts the text straight into <m:r> (maybe in spans)
    const walk = (e: Element) => {
      for (const n of Array.from(e.childNodes)) {
        if (n.nodeType === 3) text += n.textContent ?? "";
        else if (n.nodeType === 1 && local(n as Element) !== "rpr") walk(n as Element);
      }
    };
    walk(r);
    text = text.replace(/\u00a0/g, " ");
  }
  const out = run(text);
  for (const rPr of kids(r, "rpr")) {
    const sty = val(kid(rPr, "sty"));
    if (sty === "p" || sty === "b" || sty === "bi") out.sty = sty;
    if (kid(rPr, "nor")) out.nor = true;
    const color = val(kid(rPr, "color"));
    if (color && /^[0-9a-f]{6}$/i.test(color)) out.color = "#" + color.toLowerCase();
  }
  return out;
}

function readContent(e: Element): Content {
  const out: Content = [];
  for (const c of kids(e)) {
    const n = readNode(c);
    if (n) out.push(...n);
  }
  return out;
}

function readNode(c: Element): MNode[] | null {
  switch (local(c)) {
    case "r":
      return [readRun(c)];
    case "f": {
      const t = prop(c, "fpr", "type");
      return [{ t: "f", type: t === "skw" || t === "lin" || t === "noBar" ? t : "bar", num: arg(kid(c, "num")), den: arg(kid(c, "den")) }];
    }
    case "ssup":
      return [{ t: "sSup", base: arg(kid(c, "e")), sup: arg(kid(c, "sup")) }];
    case "ssub":
      return [{ t: "sSub", base: arg(kid(c, "e")), sub: arg(kid(c, "sub")) }];
    case "ssubsup":
      return [{ t: "sSubSup", base: arg(kid(c, "e")), sub: arg(kid(c, "sub")), sup: arg(kid(c, "sup")) }];
    case "spre":
      return [{ t: "sPre", base: arg(kid(c, "e")), sub: arg(kid(c, "sub")), sup: arg(kid(c, "sup")) }];
    case "rad":
      return [{ t: "rad", deg: on(c, "radpr", "deghide") ? [run()] : arg(kid(c, "deg")), base: arg(kid(c, "e")) }];
    case "nary": {
      const chr = prop(c, "narypr", "chr") || "∫";
      const loc = prop(c, "narypr", "limloc");
      return [
        {
          t: "nary",
          chr,
          limLoc: loc === "subSup" || loc === "undOvr" ? loc : NARY_INTEGRALS.includes(chr) ? "subSup" : "undOvr",
          sub: on(c, "narypr", "subhide") ? null : arg(kid(c, "sub")),
          sup: on(c, "narypr", "suphide") ? null : arg(kid(c, "sup")),
          base: arg(kid(c, "e")),
        },
      ];
    }
    case "d": {
      const dPr = kid(c, "dpr");
      const beg = kid(dPr, "begchr") ? val(kid(dPr, "begchr")) ?? "" : "(";
      const end = kid(dPr, "endchr") ? val(kid(dPr, "endchr")) ?? "" : ")";
      const sep = kid(dPr, "sepchr") ? val(kid(dPr, "sepchr")) ?? "|" : "|";
      const items = kids(c, "e").map((e) => arg(e));
      return [{ t: "d", beg, end, sep: sep === "|" ? "∣" : sep, items: items.length ? items : [[run()]] }];
    }
    case "func":
      return [{ t: "func", name: arg(kid(c, "fname")), arg: arg(kid(c, "e")) }];
    case "limlow":
      return [{ t: "limLow", base: arg(kid(c, "e")), lim: arg(kid(c, "lim")) }];
    case "limupp":
      return [{ t: "limUpp", base: arg(kid(c, "e")), lim: arg(kid(c, "lim")) }];
    case "acc":
      return [{ t: "acc", chr: prop(c, "accpr", "chr") || "̂", base: arg(kid(c, "e")) }];
    case "bar":
      return [{ t: "bar", pos: prop(c, "barpr", "pos") === "top" ? "top" : "bot", base: arg(kid(c, "e")) }];
    case "box":
      return [{ t: "box", base: arg(kid(c, "e")) }];
    case "borderbox":
      return [{ t: "borderBox", base: arg(kid(c, "e")) }];
    case "groupchr": {
      const chr = prop(c, "groupchrpr", "chr") || "⏟";
      const pos = prop(c, "groupchrpr", "pos");
      return [{ t: "groupChr", chr, pos: pos === "top" ? "top" : "bot", base: arg(kid(c, "e")) }];
    }
    case "m": {
      const rows = kids(c, "mr").map((mr) => kids(mr, "e").map((e) => arg(e)));
      const cols = Math.max(1, ...rows.map((r) => r.length));
      for (const r of rows) while (r.length < cols) r.push([run()]);
      return [{ t: "m", rows: rows.length ? rows : [[[run()]]] }];
    }
    case "eqarr":
      return [{ t: "eqArr", rows: kids(c, "e").map((e) => arg(e)) }];
    case "phant":
      return [{ t: "phant", base: arg(kid(c, "e")) }];
    case "omath":
      return readContent(c);
    // properties and run wrappers
    case "rpr":
    case "ctrlpr":
    case "argpr":
    case "omathparapr":
      return null;
    default: {
      // w:r inside math, w:ins / w:del wrappers, smart tags: keep their content
      const inner = readContent(c);
      if (inner.length) return inner;
      const t = c.textContent ?? "";
      return t && local(c) === "t" ? [run(t)] : null;
    }
  }
}

// --- writing -------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const v = (name: string, value: string) => `<m:${name} m:val="${esc(value)}"/>`;
const wrap = (name: string, c: Content | null) => (c && c.some((n) => !isRun(n) || n.text) ? `<m:${name}>${writeContent(c)}</m:${name}>` : `<m:${name}/>`);

function writeRun(r: MRun): string {
  if (!r.text) return "";
  const mPr = r.nor ? "<m:rPr><m:nor/></m:rPr>" : r.sty && r.sty !== "i" ? `<m:rPr>${v("sty", r.sty)}</m:rPr>` : "";
  const color = r.color ? `<w:color w:val="${r.color.slice(1).toUpperCase()}"/>` : "";
  const wPr = `<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>${color}</w:rPr>`;
  return `<m:r>${mPr}${wPr}<m:t xml:space="preserve">${esc(r.text)}</m:t></m:r>`;
}

function writeObj(o: MObj): string {
  switch (o.t) {
    case "f":
      return `<m:f>${o.type !== "bar" ? `<m:fPr>${v("type", o.type)}</m:fPr>` : ""}${wrap("num", o.num)}${wrap("den", o.den)}</m:f>`;
    case "sSup":
      return `<m:sSup>${wrap("e", o.base)}${wrap("sup", o.sup)}</m:sSup>`;
    case "sSub":
      return `<m:sSub>${wrap("e", o.base)}${wrap("sub", o.sub)}</m:sSub>`;
    case "sSubSup":
      return `<m:sSubSup>${wrap("e", o.base)}${wrap("sub", o.sub)}${wrap("sup", o.sup)}</m:sSubSup>`;
    case "sPre":
      return `<m:sPre>${wrap("sub", o.sub)}${wrap("sup", o.sup)}${wrap("e", o.base)}</m:sPre>`;
    case "rad": {
      const hide = !o.deg.some((n) => !isRun(n) || n.text);
      return `<m:rad>${hide ? `<m:radPr>${v("degHide", "1")}</m:radPr>` : ""}${wrap("deg", o.deg)}${wrap("e", o.base)}</m:rad>`;
    }
    case "nary": {
      const pr = v("chr", o.chr) + v("limLoc", o.limLoc) + (o.sub ? "" : v("subHide", "1")) + (o.sup ? "" : v("supHide", "1"));
      return `<m:nary><m:naryPr>${pr}</m:naryPr>${wrap("sub", o.sub)}${wrap("sup", o.sup)}${wrap("e", o.base)}</m:nary>`;
    }
    case "d": {
      let pr = "";
      if (o.beg !== "(") pr += v("begChr", o.beg);
      if (o.end !== ")") pr += v("endChr", o.end);
      if (o.items.length > 1 && o.sep !== "∣") pr += v("sepChr", o.sep);
      return `<m:d>${pr ? `<m:dPr>${pr}</m:dPr>` : ""}${o.items.map((e) => wrap("e", e)).join("")}</m:d>`;
    }
    case "func":
      return `<m:func>${wrap("fName", o.name)}${wrap("e", o.arg)}</m:func>`;
    case "limLow":
      return `<m:limLow>${wrap("e", o.base)}${wrap("lim", o.lim)}</m:limLow>`;
    case "limUpp":
      return `<m:limUpp>${wrap("e", o.base)}${wrap("lim", o.lim)}</m:limUpp>`;
    case "acc":
      return `<m:acc><m:accPr>${v("chr", o.chr)}</m:accPr>${wrap("e", o.base)}</m:acc>`;
    case "bar":
      return `<m:bar><m:barPr>${v("pos", o.pos)}</m:barPr>${wrap("e", o.base)}</m:bar>`;
    case "box":
      return `<m:box>${wrap("e", o.base)}</m:box>`;
    case "borderBox":
      return `<m:borderBox>${wrap("e", o.base)}</m:borderBox>`;
    case "groupChr":
      return `<m:groupChr><m:groupChrPr>${v("chr", o.chr)}${v("pos", o.pos)}${v("vertJc", o.pos === "top" ? "bot" : "top")}</m:groupChrPr>${wrap("e", o.base)}</m:groupChr>`;
    case "m":
      return `<m:m>${o.rows.map((r) => `<m:mr>${r.map((c) => wrap("e", c)).join("")}</m:mr>`).join("")}</m:m>`;
    case "eqArr":
      return `<m:eqArr>${o.rows.map((r) => wrap("e", r)).join("")}</m:eqArr>`;
    case "phant":
      return `<m:phant>${wrap("e", o.base)}</m:phant>`;
  }
}

function writeContent(c: Content): string {
  return c.map((n) => (isRun(n) ? writeRun(n) : writeObj(n))).join("");
}

/** writeOMML: an m:oMath element (inside m:oMathPara for a display equation). */
export function writeOMML(c: Content, display = false): string {
  const math = `<m:oMath>${writeContent(c)}</m:oMath>`;
  return display ? `<m:oMathPara>${math}</m:oMathPara>` : math;
}
