// Pure clipboard payloads for the slides editor. Copying elements writes the
// internal format (JSON under CLIP_MIME) next to plain text, so a paste in
// another tab or deck restores the elements; pasting plain text or HTML from
// elsewhere makes a new text box.

import { newElement, uid, type SlideElement } from "./model";
import { duplicateElements } from "./deckOps";

/** MIME type of the internal element payload on the system clipboard. */
export const CLIP_MIME = "application/x-grown-slides+json";

interface Payload {
  grownSlides: 1;
  elements: SlideElement[];
}

/** encodeClipboard serialises elements as the internal clipboard payload. */
export function encodeClipboard(els: readonly SlideElement[]): string {
  const p: Payload = { grownSlides: 1, elements: [...els] };
  return JSON.stringify(p);
}

function validElement(e: unknown): e is SlideElement {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  const ok =
    typeof o.id === "string" &&
    typeof o.type === "string" &&
    ["x", "y", "w", "h"].every((k) => typeof o[k] === "number" && Number.isFinite(o[k]));
  if (!ok) return false;
  if (o.children !== undefined)
    return Array.isArray(o.children) && o.children.every(validElement);
  return true;
}

/** decodeClipboard parses an internal payload; anything else (including
 *  malformed JSON or elements) yields null. */
export function decodeClipboard(s: string | null | undefined): SlideElement[] | null {
  if (!s) return null;
  try {
    const p = JSON.parse(s) as Partial<Payload>;
    if (p?.grownSlides !== 1 || !Array.isArray(p.elements)) return null;
    if (!p.elements.length || !p.elements.every(validElement)) return null;
    return p.elements;
  } catch {
    return null;
  }
}

/** clipboardText is the plain-text flavour of copied elements: their text
 *  (group members included), one element per line. */
export function clipboardText(els: readonly SlideElement[]): string {
  const out: string[] = [];
  const walk = (e: SlideElement) => {
    if (e.text) out.push(e.text);
    if (e.table) out.push(e.table.cells.map((r) => r.join("\t")).join("\n"));
    e.children?.forEach(walk);
  };
  els.forEach(walk);
  return out.join("\n");
}

/** htmlToText flattens an HTML fragment to text: block ends and <br> become
 *  newlines, tags are dropped and the common entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * pasteElements turns clipboard data into new elements to insert: the
 * internal format wins (fresh ids, offset like a duplicate), then HTML, then
 * plain text (each as one text box). Returns [] when there's nothing usable.
 */
export function pasteElements(
  data: { internal?: string | null; html?: string | null; text?: string | null },
  makeId: () => string = uid,
): SlideElement[] {
  const els = decodeClipboard(data.internal);
  if (els) return duplicateElements(els, makeId);
  const text = data.html ? htmlToText(data.html) : (data.text ?? "").trim();
  if (!text) return [];
  const box = newElement("text");
  return [{ ...box, id: makeId(), text }];
}
