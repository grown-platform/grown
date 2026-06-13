import type { DriveFile } from "./types";
import { isModelFile } from "../3d/formats";

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
 *  through the editor when one is mapped; 3D models open in the 3D app; other
 *  files fall back to the generic FileViewer at /drive/file/:id.
 *
 *  3D models are matched by file extension (glb/gltf/obj/stl/ply/…) rather than
 *  mime type, since most are stored as application/octet-stream. */
export function openFileRoute(file: DriveFile): string {
  const app = editorAppFor(file);
  if (app) return `/${app}/${file.id}`;
  if (isModelFile(file.name)) return `/3d?file=${file.id}`;
  return `/drive/file/${file.id}`;
}
