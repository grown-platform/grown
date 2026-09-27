// DrawingML text body writer (ECMA-376 §21.1.2) for Grown text boxes.
//
// pptxgenjs merges element options into every run (so a run can't turn off
// an element-level bold) and repeats `a:pPr` per run, so text boxes are
// written here instead and swapped in for pptxgenjs's `p:txBody`
// (write.ts patchElements). Every run carries its full effective
// formatting; paragraphs carry level, alignment, spacing and bullets; the
// body carries insets, anchor, vertical text and autofit.

import { INDENT_STEP, type SlideElement, type TextRun } from "../model";
import { effective, insetsOf, paragraphs } from "../textOps";

/** EMU per logical px (960 px = 10 in = 9 144 000 EMU). */
export const EMU_PER_PX = 9525;

/** How a link is written: a relationship id and/or a `ppaction://` action. */
export interface LinkRef {
  rid: string;
  action?: string;
}

/** Resolves a Grown link (URL or slide target) to a hyperlink reference,
 *  adding the relationship it needs; null drops the link. */
export type LinkResolver = (url: string) => LinkRef | null;

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Characters XML 1.0 can't hold (a tab is fine; "\v" is a line break). */
function xmlText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return esc(s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""));
}

const hex = (c: string | undefined) =>
  (c || "#000000").replace("#", "").slice(0, 6).padEnd(6, "0").toUpperCase();

const ALGN: Record<string, string> = { left: "l", center: "ctr", right: "r", justify: "just" };

function rPrXml(el: SlideElement, r: TextRun, tag: "rPr" | "endParaRPr", link: LinkResolver): string {
  const size = effective(el, r, "fontSize") as number;
  const url = r.url ?? el.url;
  const attrs = [
    `lang="en-US"`,
    `sz="${Math.round(size * 75)}"`,
    effective(el, r, "bold") ? `b="1"` : `b="0"`,
    effective(el, r, "italic") ? `i="1"` : `i="0"`,
  ];
  if (effective(el, r, "underline")) attrs.push(`u="sng"`);
  if (effective(el, r, "strike")) attrs.push(`strike="sngStrike"`);
  const bl = effective(el, r, "baseline");
  if (bl) attrs.push(`baseline="${bl === "super" ? 30000 : -25000}"`);
  attrs.push(`dirty="0"`);
  const kids: string[] = [];
  const color = effective(el, r, "color") as string | undefined;
  kids.push(`<a:solidFill><a:srgbClr val="${hex(color)}"/></a:solidFill>`);
  const face = (effective(el, r, "fontFamily") as string | undefined) || "Arial";
  kids.push(
    `<a:latin typeface="${esc(face)}"/><a:ea typeface="${esc(face)}"/><a:cs typeface="${esc(face)}"/>`,
  );
  if (url && tag === "rPr") {
    const ref = link(url);
    if (ref)
      kids.push(
        `<a:hlinkClick r:id="${ref.rid}"${ref.action ? ` action="${esc(ref.action)}"` : ""}/>`,
      );
  }
  return `<a:${tag} ${attrs.join(" ")}>${kids.join("")}</a:${tag}>`;
}

function pPrXml(el: SlideElement, level: number, align: string, hasText: boolean): string {
  const step = INDENT_STEP * EMU_PER_PX;
  const attrs: string[] = [];
  if (el.list) attrs.push(`marL="${(level + 1) * step}"`, `indent="${-step}"`);
  else attrs.push(`marL="${level * step}"`, `indent="0"`);
  if (level) attrs.push(`lvl="${level}"`);
  attrs.push(`algn="${ALGN[align] ?? "l"}"`);
  if (el.rtl) attrs.push(`rtl="1"`);
  const kids: string[] = [];
  if (el.lineSpacing) kids.push(`<a:lnSpc><a:spcPct val="${Math.round(el.lineSpacing * 100000)}"/></a:lnSpc>`);
  if (el.spaceBefore) kids.push(`<a:spcBef><a:spcPts val="${Math.round(el.spaceBefore * 75)}"/></a:spcBef>`);
  if (el.spaceAfter) kids.push(`<a:spcAft><a:spcPts val="${Math.round(el.spaceAfter * 75)}"/></a:spcAft>`);
  if (el.list === "bullet" && hasText) {
    const ch = el.bulletStyle || ["•", "◦", "▪"][level % 3];
    kids.push(`<a:buFont typeface="Arial"/><a:buChar char="${esc(ch)}"/>`);
  } else if (el.list === "number" && hasText) {
    const scheme =
      level === 0 && el.bulletStyle ? el.bulletStyle : ["arabicPeriod", "alphaLcPeriod", "romanLcPeriod"][level % 3];
    kids.push(`<a:buFont typeface="+mj-lt"/><a:buAutoNum type="${esc(scheme)}"/>`);
  } else kids.push(`<a:buNone/>`);
  return `<a:pPr ${attrs.join(" ")}>${kids.join("")}</a:pPr>`;
}

/** The `p:txBody` XML for a text element (r: and a: prefixes unbound). */
export function textBodyXml(el: SlideElement, link: LinkResolver): string {
  const ins = insetsOf(el);
  const anchor = el.valign === "middle" ? "ctr" : el.valign === "bottom" ? "b" : "t";
  const bodyAttrs = [
    `wrap="square"`,
    `lIns="${Math.round(ins.l * EMU_PER_PX)}"`,
    `tIns="${Math.round(ins.t * EMU_PER_PX)}"`,
    `rIns="${Math.round(ins.r * EMU_PER_PX)}"`,
    `bIns="${Math.round(ins.b * EMU_PER_PX)}"`,
    `rtlCol="0"`,
    `anchor="${anchor}"`,
  ];
  if (el.vert) bodyAttrs.push(`vert="${el.vert}"`);
  const body = `<a:bodyPr ${bodyAttrs.join(" ")}>${el.autofit === "shrink" ? "<a:normAutofit/>" : "<a:noAutofit/>"}</a:bodyPr>`;
  return `<p:txBody>${body}<a:lstStyle/>${parasXml(el, link)}</p:txBody>`;
}

/** The `a:p` paragraphs of a text element (text boxes and table cells). */
export function parasXml(el: SlideElement, link: LinkResolver): string {
  const paras = paragraphs(el).map((p) => {
    const level = p.props.level ?? 0;
    const align = p.props.align ?? el.align ?? "left";
    const hasText = p.runs.some((r) => r.text.replace(/\v/g, ""));
    const parts: string[] = [pPrXml(el, level, align, hasText)];
    for (const r of p.runs)
      r.text.split("\v").forEach((t, j) => {
        if (j > 0) parts.push(`<a:br>${rPrXml(el, r, "rPr", () => null)}</a:br>`);
        if (t) parts.push(`<a:r>${rPrXml(el, r, "rPr", link)}<a:t>${xmlText(t)}</a:t></a:r>`);
      });
    const last = p.runs[p.runs.length - 1] ?? { text: "" };
    parts.push(rPrXml(el, last, "endParaRPr", link));
    return `<a:p>${parts.join("")}</a:p>`;
  });
  return paras.join("");
}
