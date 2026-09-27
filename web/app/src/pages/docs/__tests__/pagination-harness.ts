// Pagination test helpers (Docs M9): an editor laid out on a MockMeasurer
// grid with a given page setup (points are layout units, 1:1).
import type { Editor } from "@tiptap/core";
import { makeEditor } from "./harness";
import { MockMeasurer } from "./measurer";
import { setDocSettings } from "../pageLayout";
import { getLayout, setPaginationMeasurer, syncSettings } from "../paginationPlugin";
import { defaultSection, normalizeSection, type DocSettings, type Margins, type SectionProps } from "../sections";
import type { Layout } from "../pagination";

export interface PageOpts {
  /** Page width / height and margins, e.g. OnlyOffice's 400 x 400 / 50. */
  w?: number;
  h?: number;
  margin?: number | Partial<Margins>;
  section?: Partial<SectionProps>;
  settings?: Partial<DocSettings>;
  lineHeight?: number;
  charWidth?: number;
}

export function sectionFor(o: PageOpts): SectionProps {
  const base = defaultSection();
  const m = typeof o.margin === "number" ? { top: o.margin, bottom: o.margin, left: o.margin, right: o.margin } : o.margin ?? {};
  const w = o.w ?? base.pageW;
  const h = o.h ?? base.pageH;
  return normalizeSection({
    ...base,
    pageW: w,
    pageH: h,
    orient: w > h ? "landscape" : "portrait",
    margins: { ...base.margins, header: 0, footer: 0, ...m },
    ...o.section,
  });
}

/** pagedEditor: an editor whose layout uses a grid measurer. */
export function pagedEditor(html: string, o: PageOpts = {}): Editor {
  const e = makeEditor(html);
  setDocSettings(e, { section: sectionFor(o), ...o.settings });
  setPaginationMeasurer(e, new MockMeasurer({ lineHeight: o.lineHeight ?? 20, charWidth: o.charWidth ?? 10 }));
  syncSettings(e);
  return e;
}

export function layoutOf(e: Editor): Layout {
  const dl = getLayout(e);
  if (!dl) throw new Error("no layout");
  return dl.layout;
}

/** Pages a top-level block occupies (0-based, distinct). */
export function pagesOf(e: Editor, block: number): number[] {
  const out: number[] = [];
  for (const p of layoutOf(e).blocks[block]) if (out[out.length - 1] !== p.page) out.push(p.page);
  return out;
}
