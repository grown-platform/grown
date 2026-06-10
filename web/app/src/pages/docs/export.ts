import type { Editor } from "@tiptap/react";

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

function fullHtml(editor: Editor, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${editor.getHTML()}</body></html>`;
}

/**
 * downloadDoc exports the document in the requested format. Plain text, HTML,
 * and PDF are produced client-side; the binary/markup formats are converted by
 * the backend pandoc endpoint from the editor's rendered HTML.
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
  // Everything else (pdf/docx/odt/rtf/epub/md) is rendered by the backend.
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
