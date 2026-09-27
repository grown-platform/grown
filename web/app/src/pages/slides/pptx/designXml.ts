// pptx XML for M7 deck design: theme colour/font scheme, the master colour
// map of dark themes, slide backgrounds (gradients, theme colours), slide
// layouts with their placeholders, and slide placeholder tags/fields.
// String/DOM helpers used by write.ts after pptxgenjs has built the package.

import type { DeckTheme, Placeholder, Slide, SlideElement, SlideLayout, ThemeColors } from "../model";
import { EMU_PER_PX, esc, schemeClrXml, textBodyXml } from "./textXml";

export { schemeClrXml };

const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const hex = (c: string) => c.replace("#", "").slice(0, 6).padEnd(6, "0").toUpperCase();

/** The `a:clrScheme` of a theme (ECMA-376 slot order). */
export function clrSchemeXml(theme: DeckTheme): string {
  const order: (keyof ThemeColors)[] = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  const slots = order.map((k) => `<a:${k}><a:srgbClr val="${hex(theme.colors[k])}"/></a:${k}>`).join("");
  return `<a:clrScheme name="${esc(theme.name)}">${slots}</a:clrScheme>`;
}

/** Put a theme's colour scheme and name into a theme part (fonts are set
 *  through pptxgenjs `theme`). */
export function patchThemeXml(xml: string, theme: DeckTheme): string {
  let out = xml.replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, clrSchemeXml(theme));
  out = out.replace(/(<a:theme\b[^>]*\bname=")[^"]*(")/, `$1${esc(theme.name)}$2`);
  out = out.replace(/(<a:fontScheme\b[^>]*\bname=")[^"]*(")/, `$1${esc(theme.name)}$2`);
  return out;
}

/** A dark theme maps bg1/tx1/bg2/tx2 to dk1/lt1/dk2/lt2 on the master. */
export function patchClrMap(masterXml: string, dark: boolean): string {
  if (!dark) return masterXml;
  return masterXml.replace(/<p:clrMap\b[^>]*\/>/, (m) =>
    m
      .replace(/\bbg1="[^"]*"/, 'bg1="dk1"')
      .replace(/\btx1="[^"]*"/, 'tx1="lt1"')
      .replace(/\bbg2="[^"]*"/, 'bg2="dk2"')
      .replace(/\btx2="[^"]*"/, 'tx2="lt2"'),
  );
}

/** The `p:bg` for a slide or layout, when pptxgenjs's plain colour isn't
 *  enough: a gradient, or a theme background colour. Null otherwise (a
 *  picture background is written by pptxgenjs). */
export function bgXml(s: Pick<Slide, "background" | "bgFill" | "bgRef">): string | null {
  const f = s.bgFill;
  if (f?.kind === "gradient") {
    const gs = f.stops
      .map((st) => `<a:gs pos="${Math.round(st.pos * 100000)}"><a:srgbClr val="${hex(st.color)}"/></a:gs>`)
      .join("");
    const shade = f.radial
      ? `<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>`
      : `<a:lin ang="${Math.round((((f.angle ?? 90) % 360) + 360) % 360 * 60000)}" scaled="0"/>`;
    return `<p:bg><p:bgPr><a:gradFill rotWithShape="1"><a:gsLst>${gs}</a:gsLst>${shade}</a:gradFill><a:effectLst/></p:bgPr></p:bg>`;
  }
  if (!f && s.bgRef) {
    const clr = schemeClrXml(s.bgRef);
    if (clr) return `<p:bg><p:bgPr><a:solidFill>${clr}</a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
  }
  return null;
}

/** Replace (or add) the `p:bg` of a slide/layout part. */
export function replaceBg(partXml: string, bg: string): string {
  const s = partXml.replace(/<p:bg>[\s\S]*?<\/p:bg>/, "");
  return s.replace(/(<p:cSld\b[^>]*>)/, `$1${bg}`);
}

/** ST_SlideLayoutType values PowerPoint knows (a subset). */
const LAYOUT_TYPES = new Set([
  "title", "obj", "secHead", "twoObj", "twoTxTwoObj", "titleOnly", "blank", "objTx", "picTx", "vertTx",
  "vertTitleAndTx", "tx", "cust",
]);

function phXml(p: Placeholder): string {
  const t = p.type === "obj" ? "" : ` type="${p.type}"`;
  const idx = p.idx !== undefined ? ` idx="${p.idx}"` : "";
  return `<p:ph${t}${idx}/>`;
}

const PH_NAMES: Record<string, string> = {
  title: "Title",
  ctrTitle: "Title",
  subTitle: "Subtitle",
  body: "Text Placeholder",
  obj: "Content Placeholder",
  pic: "Picture Placeholder",
  dt: "Date Placeholder",
  ftr: "Footer Placeholder",
  sldNum: "Slide Number Placeholder",
};

/** A layout placeholder `p:sp` (geometry + text style, prompt left to the app). */
function layoutPhSp(el: SlideElement, id: number): string {
  const p = el.placeholder!;
  const x = Math.round(el.x * EMU_PER_PX);
  const y = Math.round(el.y * EMU_PER_PX);
  const cx = Math.round(el.w * EMU_PER_PX);
  const cy = Math.round(el.h * EMU_PER_PX);
  let body = textBodyXml({ ...el, text: "", runs: undefined, paras: undefined, list: undefined }, () => null);
  if (p.type === "sldNum")
    body = body.replace(/<a:endParaRPr\b/, `<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld>$&`);
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${PH_NAMES[p.type] ?? "Placeholder"} ${id - 1}"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${phXml(p)}</p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `${body}</p:sp>`
  );
}

/**
 * Fill a pptxgenjs-made layout part with a Grown layout: its `type`, its
 * background and its placeholders (text styles included). Decorations are
 * not written (slides carry copies of them).
 */
export function patchLayoutXml(xml: string, layout: SlideLayout): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (layout.type && LAYOUT_TYPES.has(layout.type)) root.setAttribute("type", layout.type);
  const tree = doc.getElementsByTagNameNS(P_NS, "spTree")[0];
  if (tree) {
    for (const sp of Array.from(tree.getElementsByTagNameNS(P_NS, "sp"))) sp.parentNode?.removeChild(sp);
    let id = 2;
    const sps = layout.elements.filter((e) => e.placeholder && e.type === "text").map((e) => layoutPhSp(e, id++)).join("");
    const frag = new DOMParser().parseFromString(
      `<w xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">${sps}</w>`,
      "application/xml",
    );
    for (const n of Array.from(frag.documentElement.childNodes)) tree.appendChild(doc.importNode(n, true));
  }
  let out = new XMLSerializer().serializeToString(doc);
  const decl = /^<\?xml[^>]*\?>\s*/.exec(xml);
  if (decl && !out.startsWith("<?xml")) out = decl[0] + out;
  const bg = bgXml({ background: layout.background ?? "#ffffff", bgFill: layout.bgFill, bgRef: layout.bgRef });
  return bg ? replaceBg(out, bg) : out;
}

/** Tag a slide shape as a placeholder (`p:nvPr/p:ph`). */
export function setPh(doc: Document, node: Element, p: Placeholder): void {
  const nv = Array.from(node.children).find((c) => c.localName.startsWith("nv"));
  const nvPr = nv ? Array.from(nv.children).find((c) => c.localName === "nvPr") : undefined;
  if (!nvPr) return;
  for (const old of Array.from(nvPr.children)) if (old.localName === "ph") nvPr.removeChild(old);
  const ph = doc.createElementNS(P_NS, "p:ph");
  if (p.type !== "obj") ph.setAttribute("type", p.type);
  if (p.idx !== undefined) ph.setAttribute("idx", String(p.idx));
  nvPr.insertBefore(ph, nvPr.firstChild);
}

/** Turn a shape's text runs into a field (`slidenum` / `datetime1`). */
export function toField(doc: Document, node: Element, type: "slidenum" | "datetime1"): void {
  const runs = Array.from(node.getElementsByTagNameNS(A_NS, "r"));
  runs.forEach((r, i) => {
    const fld = doc.createElementNS(A_NS, "a:fld");
    fld.setAttribute("id", type === "slidenum" ? "{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" : "{1D8BD707-D9CF-40AE-B4C6-C98DA3205C09}");
    fld.setAttribute("type", type);
    while (r.firstChild) fld.appendChild(r.firstChild);
    r.parentNode?.replaceChild(fld, r);
    if (i > 0) fld.parentNode?.removeChild(fld);
  });
}

/** Swap the `a:solidFill` colour under `parent` for a theme colour. */
export function setSchemeFill(doc: Document, parent: Element | undefined, ref: string): void {
  if (!parent) return;
  const fill = Array.from(parent.children).find((c) => c.localName === "solidFill");
  const xml = schemeClrXml(ref);
  if (!fill || !xml) return;
  const frag = new DOMParser().parseFromString(`<w xmlns:a="${A_NS}">${xml}</w>`, "application/xml");
  while (fill.firstChild) fill.removeChild(fill.firstChild);
  fill.appendChild(doc.importNode(frag.documentElement.firstChild!, true));
}
