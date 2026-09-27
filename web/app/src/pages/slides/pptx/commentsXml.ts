// pptx comments (Slides M10): DeckDoc.comments ⇄ PowerPoint's comment
// parts — `ppt/commentAuthors.xml` (p:cmAuthorLst, from presentation.xml)
// and one `ppt/comments/commentN.xml` (p:cmLst) per slide that has any.
// Replies are p:cm entries whose p15:threadingInfo names the parent (the
// PowerPoint 2013+ convention); a Grown extension keeps what the format has
// no field for (thread id, element anchor, resolved state, exact position),
// so Grown reads back exactly what it wrote. Positions are in the format's
// 1/576-inch units.

import type JSZip from "jszip";
import type { DeckDoc, Slide } from "../model";
import { CANVAS_W, uid } from "../model";
import { markerPosition, type CommentReply, type SlideComment } from "../comments";

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_P15 = "http://schemas.microsoft.com/office/powerpoint/2012/main";
const NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_GROWN = "urn:grown:slides";
const REL_AUTHORS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors";
const REL_COMMENTS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const CT_AUTHORS = "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml";
const CT_COMMENTS = "application/vnd.openxmlformats-officedocument.presentationml.comments+xml";
const EXT_THREAD = "{C676402C-5697-4E1C-873F-D02D1690AC5C}";
const EXT_GROWN = "{8A3C5B61-4F0E-4C39-9D6B-2F1E4B0C7A10}";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Logical px → 1/576 inch, for a slide `wIn` inches wide. */
const toUnits = (px: number, wIn: number) => Math.round((px / CANVAS_W) * wIn * 576);
const toPx = (u: number, wIn: number) => Math.round(((u / 576) * CANVAS_W) / wIn);

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

function nextRid(rels: string): string {
  let n = 1;
  for (const m of rels.matchAll(/Id="rId(\d+)"/g)) n = Math.max(n, Number(m[1]) + 1);
  return `rId${n}`;
}

function addRel(rels: string, type: string, target: string): string {
  const base = rels || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_REL}"></Relationships>`;
  return base.replace("</Relationships>", `<Relationship Id="${nextRid(base)}" Type="${type}" Target="${target}"/></Relationships>`);
}

/** Write the deck's comment threads into a pptx package (pptxgenjs output:
 *  ppt/slides/slideN.xml in deck order). */
export async function addCommentParts(zip: JSZip, deck: DeckDoc, slideWidthIn = 10): Promise<void> {
  const order = new Map(deck.slides.map((s, i) => [s.id, i]));
  const threads = (deck.comments ?? []).filter((c) => order.has(c.slideId));
  if (!threads.length) return;
  const authors = new Map<string, { id: number; name: string; last: number }>();
  const authorOf = (id: string, name: string) => {
    let a = authors.get(id);
    if (!a) authors.set(id, (a = { id: authors.size, name, last: 0 }));
    return a;
  };
  const bySlide = new Map<number, string[]>();
  const push = (i: number, xml: string) => bySlide.set(i, [...(bySlide.get(i) ?? []), xml]);
  for (const c0 of threads) {
    const i = order.get(c0.slideId)!;
    // Element comments are written at the element's current corner, which
    // is also how the reader finds the element again (ids are not kept).
    const at = markerPosition(c0, deck.slides[i].elements);
    const c = at.orphan ? { ...c0, elId: undefined } : { ...c0, x: at.x, y: at.y };
    const a = authorOf(c.authorId, c.authorName);
    const idx = ++a.last;
    const pos = `<p:pos x="${toUnits(c.x, slideWidthIn)}" y="${toUnits(c.y, slideWidthIn)}"/>`;
    const grown =
      `<p:ext uri="${EXT_GROWN}"><gr:cm xmlns:gr="${NS_GROWN}" id="${esc(c.id)}" x="${c.x}" y="${c.y}" authorId="${esc(c.authorId)}"` +
      (c.elId ? ` elId="${esc(c.elId)}"` : "") +
      (c.resolved ? ` resolved="1"` : "") +
      (c.resolvedBy ? ` resolvedBy="${esc(c.resolvedBy)}"` : "") +
      `/></p:ext>`;
    push(
      i,
      `<p:cm authorId="${a.id}" dt="${esc(c.createdAt)}" idx="${idx}">${pos}<p:text>${esc(c.body)}</p:text><p:extLst>${grown}</p:extLst></p:cm>`,
    );
    for (const r of c.replies) {
      const ra = authorOf(r.authorId, r.authorName);
      const ridx = ++ra.last;
      push(
        i,
        `<p:cm authorId="${ra.id}" dt="${esc(r.createdAt)}" idx="${ridx}">${pos}<p:text>${esc(r.body)}</p:text><p:extLst>` +
          `<p:ext uri="${EXT_THREAD}"><p15:threadingInfo xmlns:p15="${NS_P15}" timeZoneBias="0"><p15:parentCm authorId="${a.id}" idx="${idx}"/></p15:threadingInfo></p:ext>` +
          `<p:ext uri="${EXT_GROWN}"><gr:reply xmlns:gr="${NS_GROWN}" id="${esc(r.id)}" authorId="${esc(r.authorId)}"/></p:ext>` +
          `</p:extLst></p:cm>`,
      );
    }
  }
  const ctPath = "[Content_Types].xml";
  let ct = (await zip.file(ctPath)?.async("string")) ?? "";
  const override = (part: string, type: string) => {
    if (!ct.includes(`PartName="${part}"`)) ct = ct.replace("</Types>", `<Override PartName="${part}" ContentType="${type}"/></Types>`);
  };
  const authorXml = [...authors.values()]
    .map((a) => `<p:cmAuthor id="${a.id}" name="${esc(a.name)}" initials="${esc(initials(a.name))}" lastIdx="${a.last}" clrIdx="${a.id % 8}"/>`)
    .join("");
  zip.file("ppt/commentAuthors.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:cmAuthorLst xmlns:p="${NS_P}">${authorXml}</p:cmAuthorLst>`);
  override("/ppt/commentAuthors.xml", CT_AUTHORS);
  const presRels = "ppt/_rels/presentation.xml.rels";
  zip.file(presRels, addRel((await zip.file(presRels)?.async("string")) ?? "", REL_AUTHORS, "commentAuthors.xml"));
  let n = 0;
  for (const [i, items] of [...bySlide.entries()].sort((x, y) => x[0] - y[0])) {
    n++;
    zip.file(`ppt/comments/comment${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:cmLst xmlns:p="${NS_P}">${items.join("")}</p:cmLst>`);
    override(`/ppt/comments/comment${n}.xml`, CT_COMMENTS);
    const relsPath = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
    zip.file(relsPath, addRel((await zip.file(relsPath)?.async("string")) ?? "", REL_COMMENTS, `../comments/comment${n}.xml`));
  }
  zip.file(ctPath, ct);
}

// ---- read ----

function parseXml(s: string): Document {
  return new DOMParser().parseFromString(s, "application/xml");
}
const byLocal = (root: Document | Element, name: string) =>
  Array.from(root.getElementsByTagNameNS("*", name));

function relTargets(relsXml: string | undefined, typeSuffix: string): string[] {
  if (!relsXml) return [];
  return byLocal(parseXml(relsXml), "Relationship")
    .filter((r) => (r.getAttribute("Type") ?? "").endsWith(typeSuffix) && r.getAttribute("TargetMode") !== "External")
    .map((r) => r.getAttribute("Target") ?? "");
}

function resolve(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

const relsPathOf = (part: string) => {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
};

/** Read comment threads from a pptx package. `slides` pairs each slide part
 *  path with the id its imported slide got; `slideWidthIn` is the slide
 *  width in inches. Unknown authors get "pptx:<name>" ids. */
export async function readCommentParts(
  zip: JSZip,
  presPath: string,
  slides: { path: string; id: string }[],
  slideWidthIn: number,
): Promise<SlideComment[]> {
  const text = async (p: string) => zip.file(p)?.async("string");
  const authorsPath = relTargets(await text(relsPathOf(presPath)), "/commentAuthors")[0];
  const names = new Map<string, string>();
  if (authorsPath) {
    const x = await text(resolve(presPath, authorsPath));
    if (x) for (const a of byLocal(parseXml(x), "cmAuthor")) names.set(a.getAttribute("id") ?? "", a.getAttribute("name") ?? "");
  }
  const out: SlideComment[] = [];
  for (const s of slides) {
    for (const target of relTargets(await text(relsPathOf(s.path)), "/comments")) {
      const x = await text(resolve(s.path, target));
      if (!x) continue;
      const heads = new Map<string, SlideComment>();
      const replies: { parent: string; r: CommentReply }[] = [];
      for (const cm of byLocal(parseXml(x), "cm").filter((e) => e.namespaceURI === NS_P)) {
        const aid = cm.getAttribute("authorId") ?? "";
        const name = names.get(aid) ?? "Unknown";
        const body = byLocal(cm, "text")[0]?.textContent ?? "";
        const dt = cm.getAttribute("dt") || new Date(0).toISOString();
        const key = `${aid}:${cm.getAttribute("idx") ?? ""}`;
        const parent = byLocal(cm, "parentCm")[0];
        const gc = byLocal(cm, "cm").find((e) => e.namespaceURI === NS_GROWN);
        const gr = byLocal(cm, "reply").find((e) => e.namespaceURI === NS_GROWN);
        if (parent) {
          replies.push({
            parent: `${parent.getAttribute("authorId") ?? ""}:${parent.getAttribute("idx") ?? ""}`,
            r: {
              id: gr?.getAttribute("id") || uid(),
              authorId: gr?.getAttribute("authorId") || `pptx:${name}`,
              authorName: name,
              body,
              createdAt: dt,
            },
          });
          continue;
        }
        const pos = byLocal(cm, "pos")[0];
        const num = (e: Element | null | undefined, k: string) => Number(e?.getAttribute(k) ?? 0) || 0;
        const c: SlideComment = {
          id: gc?.getAttribute("id") || uid(),
          slideId: s.id,
          x: gc?.hasAttribute("x") ? num(gc, "x") : toPx(num(pos, "x"), slideWidthIn),
          y: gc?.hasAttribute("y") ? num(gc, "y") : toPx(num(pos, "y"), slideWidthIn),
          authorId: gc?.getAttribute("authorId") || `pptx:${name}`,
          authorName: name,
          body,
          createdAt: dt,
          replies: [],
        };
        const elId = gc?.getAttribute("elId");
        if (elId) c.elId = elId;
        if (gc?.getAttribute("resolved") === "1") c.resolved = true;
        const by = gc?.getAttribute("resolvedBy");
        if (by) c.resolvedBy = by;
        heads.set(key, c);
        out.push(c);
      }
      for (const { parent, r } of replies) heads.get(parent)?.replies.push(r);
    }
  }
  return out;
}

/** Re-anchor imported element comments: element ids are not kept by the
 *  pptx reader, so a thread goes to the element whose top-right corner is
 *  at its point (where the writer put it); else it stays on the slide. */
export function anchorImported(comments: SlideComment[], slides: Slide[]): SlideComment[] {
  return comments.map((c) => {
    if (!c.elId) return c;
    const els = slides.find((s) => s.id === c.slideId)?.elements ?? [];
    if (els.some((e) => e.id === c.elId)) return c;
    const hit = els.find((e) => Math.abs(e.x + e.w - c.x) <= 1 && Math.abs(e.y - c.y) <= 1);
    const { elId: _drop, ...rest } = c;
    void _drop;
    return hit ? { ...c, elId: hit.id } : rest;
  });
}
