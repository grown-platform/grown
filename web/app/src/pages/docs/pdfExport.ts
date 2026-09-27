// Docs ▸ Download ▸ PDF, built in the browser from the paginated layout
// (M9): every laid-out page is cloned exactly as print preview shows it
// (buildPageDom: the section's page size, orientation and margins, page
// colour, border, watermark, columns, line numbers, headers and footers with
// their page numbers, pictures) and drawn into the PDF by lib/pdf/domPdf.ts
// under an invisible, searchable text layer with the page's web links.

import type { Editor } from "@tiptap/react";
import { domPagesToPdf, type DomPage } from "../../lib/pdf/domPdf";
import { afterNextLayout, getLayout, setForcePaged } from "./paginationPlugin";
import { buildPageDom } from "./PagesUI";

/** The live page sheet (the element print preview clones pages from). */
export function docSheet(editor: Editor): HTMLElement | null {
  if (editor.isDestroyed) return null;
  return (editor.view.dom as HTMLElement).closest<HTMLElement>("[data-testid='doc-editor']");
}

const frame = () => new Promise<void>((res) => requestAnimationFrame(() => res()));

/** Wait for a fresh layout (pageless documents are laid out as pages). */
function nextLayout(editor: Editor): Promise<void> {
  return new Promise<void>((res) => {
    const t = window.setTimeout(res, 3000);
    afterNextLayout(editor, () => {
      window.clearTimeout(t);
      res();
    });
  });
}

export interface DocPdfOptions {
  /** 0-based page indices (all when omitted). */
  pages?: number[];
  author?: string;
  onProgress?: (done: number, total: number) => void;
}

/** docToPdf renders the document's pages as a PDF file. */
export async function docToPdf(editor: Editor, title: string, opts: DocPdfOptions = {}): Promise<Uint8Array> {
  const sheet = docSheet(editor);
  if (!sheet) throw new Error("The document isn't on screen, so it can't be laid out as pages.");
  setForcePaged(editor, true);
  const host = document.createElement("div");
  try {
    await nextLayout(editor);
    // Headers, footers and page chrome render on the frame after a layout.
    await frame();
    await frame();
    const dl = getLayout(editor);
    if (!dl || !dl.layout.pages.length) throw new Error("The document has no pages to export.");
    const indices = (opts.pages ?? dl.layout.pages.map((_, i) => i)).filter((i) => i >= 0 && i < dl.layout.pages.length);
    // Off-screen but laid out: the text layer reads line positions from it.
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:absolute;left:-100000px;top:0;pointer-events:none;contain:layout style";
    document.body.appendChild(host);
    const pages: DomPage[] = indices.map((i) => {
      const el = buildPageDom(sheet, dl, i);
      el.classList.remove("doc-dark");
      el.style.margin = "0";
      host.appendChild(el);
      const spec = dl.layout.pages[i].spec;
      return { el, w: spec.w, h: spec.h };
    });
    return await domPagesToPdf(host, pages, { title: title || "Document", author: opts.author, producer: "Grown Docs" }, { printMedia: true, onProgress: opts.onProgress });
  } finally {
    host.remove();
    setForcePaged(editor, false);
  }
}
