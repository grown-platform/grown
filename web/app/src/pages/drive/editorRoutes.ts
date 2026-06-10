import type { DriveFile } from "./types";

/** Mime type → which editor app would normally open this file. */
const MIME_TO_EDITOR: Array<{ test: (m: string) => boolean; app: string }> = [
  {
    test: (m) =>
      m === "text/csv" ||
      m === "application/csv" ||
      m === "application/vnd.ms-excel" ||
      m ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      m === "application/vnd.oasis.opendocument.spreadsheet",
    app: "sheets",
  },
  {
    test: (m) =>
      m === "application/msword" ||
      m ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      m === "application/vnd.oasis.opendocument.text" ||
      m === "application/rtf",
    app: "docs",
  },
  {
    test: (m) =>
      m === "application/vnd.ms-powerpoint" ||
      m ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      m === "application/vnd.oasis.opendocument.presentation",
    app: "slides",
  },
  {
    test: (m) => m === "application/pdf",
    app: "pdf",
  },
];

/** Returns the app id of the editor that should open this file, or null for
 *  files that have no dedicated editor (images, video, audio, plain text). */
export function editorAppFor(file: DriveFile): string | null {
  const m = file.mime_type;
  for (const rule of MIME_TO_EDITOR) {
    if (rule.test(m)) return rule.app;
  }
  return null;
}

/** Returns the route to navigate to when "Open" is invoked on a file. Routes
 *  through the editor when one is mapped; otherwise the generic FileViewer at
 *  /drive/file/:id. */
export function openFileRoute(file: DriveFile): string {
  const app = editorAppFor(file);
  if (app) return `/${app}/${file.id}`;
  return `/drive/file/${file.id}`;
}
