// Hand-off of a directly imported .docx from the Docs home (which creates
// the document) to the editor (which applies it once the Yjs document is
// bound). Same idea as the HTML `docseed:<id>` channel, but it carries the
// whole model (body, styles, numbering, header/footer, comments). Kept in
// memory, and in sessionStorage when it fits so a reload still seeds.
import type { DocxImport } from "./model";

const pending = new Map<string, DocxImport>();
const key = (id: string) => `docseed-docx:${id}`;

export function stashDocxSeed(docId: string, imp: DocxImport): void {
  pending.set(docId, imp);
  try {
    sessionStorage.setItem(key(docId), JSON.stringify(imp));
  } catch {
    /* too large for sessionStorage: memory only */
  }
}

/** Whether a seed is waiting for `docId` (without consuming it). */
export function hasDocxSeed(docId: string): boolean {
  if (pending.has(docId)) return true;
  try {
    return sessionStorage.getItem(key(docId)) !== null;
  } catch {
    return false;
  }
}

export function takeDocxSeed(docId: string): DocxImport | null {
  let imp = pending.get(docId) ?? null;
  pending.delete(docId);
  try {
    const raw = sessionStorage.getItem(key(docId));
    sessionStorage.removeItem(key(docId));
    if (!imp && raw) imp = JSON.parse(raw) as DocxImport;
  } catch {
    /* ignore */
  }
  return imp;
}
