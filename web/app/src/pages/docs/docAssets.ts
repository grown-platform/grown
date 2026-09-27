// Document picture storage (Docs M7). Pictures go to the document's asset
// store (POST /api/v1/docs/d/{id}/assets, internal/docs/assets.go) and are
// referenced by URL instead of living in the Yjs document as data: URLs.
// When the store is unavailable (no blob store, offline, a shared view that
// can't write) the data: URL is kept, as before. Existing data: URLs are
// migrated one at a time when a picture is edited, never in bulk.

import type { EditorView } from "@tiptap/pm/view";

const docOf = new WeakMap<object, string>();

/** Bind an editor view to the document whose asset store it uses. */
export function setAssetDoc(view: EditorView | null | undefined, docId: string | null) {
  if (!view) return;
  if (docId) docOf.set(view, docId);
  else docOf.delete(view);
}

export function assetDocOf(view: EditorView | null | undefined): string | null {
  return (view && docOf.get(view)) ?? null;
}

/** Is `src` one of our asset URLs? */
export function isDocAssetUrl(src: string | null | undefined): boolean {
  return !!src && /^\/api\/v1\/docs\/d\/[^/]+\/assets\/[0-9a-f]{64}$/.test(src);
}

export const isDataUrl = (src: string | null | undefined) => !!src && /^data:/i.test(src);

/** Upload a picture; returns its asset URL, or null when the store refuses
 *  or is unavailable. */
export async function uploadPicture(docId: string, blob: Blob): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.append("file", blob, (blob as File).name || "picture");
    const r = await fetch(`/api/v1/docs/d/${encodeURIComponent(docId)}/assets`, { method: "POST", body: fd, credentials: "same-origin" });
    if (!r.ok) return null;
    const j = (await r.json()) as { url?: string };
    return typeof j.url === "string" && isDocAssetUrl(j.url) ? j.url : null;
  } catch {
    return null;
  }
}

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(src: string): Blob | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  try {
    if (m[2]) {
      const bin = atob(m[3].replace(/\s+/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: m[1] });
    }
    return new Blob([decodeURIComponent(m[3])], { type: m[1] });
  } catch {
    return null;
  }
}

/** The src to store for a picture file: its asset URL when it uploads,
 *  else a data: URL. */
export async function storePicture(view: EditorView | null | undefined, file: Blob): Promise<string> {
  const doc = assetDocOf(view);
  if (doc) {
    const url = await uploadPicture(doc, file);
    if (url) return url;
  }
  return readAsDataUrl(file);
}

/** The natural pixel size of a picture (null when it can't load). */
export function naturalSize(src: string): Promise<{ width: number; height: number } | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(null), 5000);
    img.onload = () => {
      clearTimeout(t);
      resolve(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    };
    img.onerror = () => {
      clearTimeout(t);
      resolve(null);
    };
    img.src = src;
  });
}

const migrating = new Set<string>();

/**
 * Migrate-on-edit: upload a data: URL picture and point every node using
 * it at the asset URL. Fire-and-forget; a failure keeps the data: URL.
 */
export async function migrateDataUrl(view: EditorView, src: string): Promise<boolean> {
  const doc = assetDocOf(view);
  if (!doc || !isDataUrl(src) || migrating.has(src)) return false;
  const blob = dataUrlToBlob(src);
  if (!blob) return false;
  migrating.add(src);
  try {
    const url = await uploadPicture(doc, blob);
    if (!url || (view as { isDestroyed?: boolean }).isDestroyed) return false;
    const tr = view.state.tr;
    view.state.doc.descendants((n, pos) => {
      if ((n.type.name === "image" || n.type.name === "inlineImage") && n.attrs.src === src) tr.setNodeMarkup(pos, undefined, { ...n.attrs, src: url });
    });
    if (!tr.docChanged) return false;
    view.dispatch(tr.setMeta("addToHistory", false));
    return true;
  } finally {
    migrating.delete(src);
  }
}

/** Save a picture to the user's disk. */
export async function downloadPicture(src: string, name = "picture") {
  let href = src;
  let revoke = false;
  if (!isDataUrl(src)) {
    try {
      const r = await fetch(src, { credentials: "same-origin" });
      if (r.ok) {
        href = URL.createObjectURL(await r.blob());
        revoke = true;
      }
    } catch {
      /* fall back to the URL itself */
    }
  }
  const type = /^data:image\/(\w+)/.exec(src)?.[1];
  const a = document.createElement("a");
  a.href = href;
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, "_") || "picture"}${type ? `.${type === "jpeg" ? "jpg" : type}` : ""}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
