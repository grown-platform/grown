/**
 * sceneIO.ts — Excalidraw glue for whiteboard import/export: .vsdx import
 * (via the pure reader in vsdx.ts) and PNG / SVG / .excalidraw downloads.
 */
import {
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
  getCommonBounds,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import { parseVsdx, layoutVsdxPages, recenterText } from "./vsdx";

/* eslint-disable @typescript-eslint/no-explicit-any -- Excalidraw API types are loose here. */

// A .vsdx picked on the whiteboard list is handed to the new board's editor.
const pending = new Map<string, File>();
export function setPendingImport(boardId: string, file: File) {
  pending.set(boardId, file);
}
export function takePendingImport(boardId: string): File | undefined {
  const f = pending.get(boardId);
  pending.delete(boardId);
  return f;
}

export interface ImportResult {
  elements: number;
  pages: number;
  warnings: string[];
}

/** importVsdx appends a Visio drawing to the right of the current scene. */
export async function importVsdx(api: any, file: Blob): Promise<ImportResult> {
  const doc = await parseVsdx(await file.arrayBuffer());
  const existing = api.getSceneElements() as readonly any[];
  let origin = { x: 100, y: 100 };
  if (existing.length) {
    const [, minY, maxX] = getCommonBounds(existing as any);
    origin = { x: Math.round(maxX + 200), y: Math.round(minY) || 100 };
  }
  const skeletons = layoutVsdxPages(doc, { origin });
  const created = convertToExcalidrawElements(skeletons as any, {
    regenerateIds: true,
  });
  recenterText(created as any);
  const files = Object.values(doc.files);
  if (files.length) api.addFiles(files);
  api.updateScene({
    elements: [...existing, ...created],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  if (created.length)
    api.scrollToContent(created, { fitToContent: true, animate: false });
  return {
    elements: created.length,
    pages: doc.pages.length,
    warnings: doc.warnings,
  };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(title: string): string {
  return (title.trim() || "whiteboard").replace(/[\\/:*?"<>|]+/g, "_");
}

export type ExportKind = "png" | "svg" | "excalidraw";

/** exportScene downloads the board as PNG, SVG or .excalidraw JSON. */
export async function exportScene(
  api: any,
  kind: ExportKind,
  title: string,
): Promise<void> {
  const elements = api.getSceneElements();
  const appState = { ...api.getAppState(), exportBackground: true };
  const files = api.getFiles();
  const name = safeName(title);
  if (kind === "png") {
    const blob = await exportToBlob({
      elements,
      appState,
      files,
      mimeType: "image/png",
      exportPadding: 16,
    });
    download(blob, `${name}.png`);
  } else if (kind === "svg") {
    const svg = await exportToSvg({
      elements,
      appState,
      files,
      exportPadding: 16,
    });
    download(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml",
      }),
      `${name}.svg`,
    );
  } else {
    const json = serializeAsJSON(elements, api.getAppState(), files, "local");
    download(
      new Blob([json], { type: "application/vnd.excalidraw+json" }),
      `${name}.excalidraw`,
    );
  }
}
