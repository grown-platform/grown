import type { Editor } from "@tiptap/react";
import { exportBodyHtml } from "./docModel";

export type DownloadFormat =
  | "docx"
  | "odt"
  | "rtf"
  | "pdf"
  | "txt"
  | "html"
  | "epub"
  | "md";

export const DOWNLOAD_FORMATS: { fmt: DownloadFormat; label: string }[] = [
  { fmt: "docx", label: "Microsoft Word (.docx)" },
  { fmt: "odt", label: "OpenDocument Format (.odt)" },
  { fmt: "rtf", label: "Rich Text Format (.rtf)" },
  { fmt: "pdf", label: "PDF Document (.pdf)" },
  { fmt: "txt", label: "Plain Text (.txt)" },
  { fmt: "html", label: "Web Page (.html)" },
  { fmt: "epub", label: "EPUB Publication (.epub)" },
  { fmt: "md", label: "Markdown (.md)" },
];

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Editors whose downloads include a document's server-side comments. */
const exportDocIds = new WeakMap<Editor, string>();

export function setExportDocId(editor: Editor, docId: string): void {
  exportDocIds.set(editor, docId);
}

/** rasterize draws an image the .docx can't embed (Excalidraw SVG) as PNG. */
async function rasterize(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const w = Math.max(1, Math.min(2000, img.naturalWidth || 600));
  const h = Math.max(1, Math.min(2000, img.naturalHeight || 400));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) return null;
  return { data: new Uint8Array(await blob.arrayBuffer()), mime: "image/png", width: w, height: h };
}

/** exportDocx builds the .docx in the browser with the direct writer. */
export async function exportDocx(editor: Editor, title: string): Promise<Blob> {
  const [{ collectDocxInput }, { writeDocx }, { listComments }] = await Promise.all([
    import("./docx/apply"),
    import("./docx/write"),
    import("./api"),
  ]);
  const docId = exportDocIds.get(editor);
  const comments = docId ? await listComments(docId).catch(() => []) : [];
  const input = collectDocxInput(editor, { title, comments });
  input.rasterize = (src) => rasterize(src).catch(() => null);
  const bytes = await writeDocx(input);
  return new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function fullHtml(editor: Editor, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${exportBodyHtml(editor)}</body></html>`;
}

/**
 * downloadDoc exports the document in the requested format. Plain text, HTML,
 * are produced client-side, .docx by the direct writer (docx/write.ts); the
 * other formats are converted by the backend pandoc endpoint from the
 * editor's rendered HTML.
 */
export async function downloadDoc(
  editor: Editor,
  title: string,
  fmt: DownloadFormat,
): Promise<void> {
  const name = (title || "document").replace(/[/\\?%*:|"<>]/g, "-");

  if (fmt === "txt") {
    triggerDownload(
      new Blob([editor.getText()], { type: "text/plain" }),
      `${name}.txt`,
    );
    return;
  }
  if (fmt === "html") {
    triggerDownload(
      new Blob([fullHtml(editor, name)], { type: "text/html" }),
      `${name}.html`,
    );
    return;
  }
  if (fmt === "docx") {
    // The direct writer keeps styles, lists, header/footer, notes and
    // comments; pandoc (below) stays as the fallback.
    try {
      triggerDownload(await exportDocx(editor, name), `${name}.docx`);
      return;
    } catch (e) {
      console.warn("direct .docx export failed; falling back to pandoc", e);
    }
  }
  // Everything else (pdf/odt/rtf/epub/md) is rendered by the backend.
  const resp = await fetch(
    `/api/v1/docs/convert?to=${fmt}&name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "text/html" },
      body: fullHtml(editor, name),
    },
  );
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(
      `Export failed: HTTP ${resp.status}${detail ? " — " + detail.slice(0, 400) : ""}`,
    );
  }
  triggerDownload(await resp.blob(), `${name}.${fmt}`);
}
