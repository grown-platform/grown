// Deck picture assets (M6): pictures uploaded to the deck's asset store are
// referenced by URL. Exports that leave the browser (pptx, HTML, SVG/PNG)
// need the bytes, so inlineImages turns those URLs back into data: URLs.

import type { DeckDoc, SlideElement, SlideFill, SlideMedia } from "./model";

/** Is `src` a server-side asset (or any same-origin URL) to inline? */
export function isAssetUrl(src: string | undefined): boolean {
  return !!src && src.startsWith("/") && !src.startsWith("//");
}

async function fetchDataUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { credentials: "same-origin" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** inlineImages returns the deck with every asset URL replaced by a data:
 *  URL (each fetched once); URLs that fail to load are kept. */
export async function inlineImages(
  deck: DeckDoc,
  fetcher: (url: string) => Promise<string | null> = fetchDataUrl,
): Promise<DeckDoc> {
  const urls = new Set<string>();
  const collect = (els: readonly SlideElement[]) => {
    for (const e of els) {
      if (e.type === "image" && isAssetUrl(e.src)) urls.add(e.src!);
      // Clips (M11): the file and its poster travel inside a pptx too.
      if (e.type === "media" && e.media) {
        if (isAssetUrl(e.media.src)) urls.add(e.media.src);
        if (isAssetUrl(e.media.poster)) urls.add(e.media.poster!);
      }
      if (e.children) collect(e.children);
    }
  };
  deck.slides.forEach((s) => {
    collect(s.elements);
    if (s.bgFill?.kind === "image" && isAssetUrl(s.bgFill.src)) urls.add(s.bgFill.src);
  });
  if (!urls.size) return deck;
  const map = new Map<string, string>();
  await Promise.all(
    [...urls].map(async (u) => {
      const d = await fetcher(u);
      if (d) map.set(u, d);
    }),
  );
  const swap = (els: SlideElement[]): SlideElement[] =>
    els.map((e) => ({
      ...e,
      ...(e.type === "image" && e.src && map.has(e.src) ? { src: map.get(e.src)! } : {}),
      ...(e.type === "media" && e.media ? { media: swapMedia(e.media, map) } : {}),
      ...(e.children ? { children: swap(e.children) } : {}),
    }));
  return {
    ...deck,
    slides: deck.slides.map((s) => ({
      ...s,
      elements: swap(s.elements),
      ...(s.bgFill?.kind === "image" && map.has(s.bgFill.src) ? { bgFill: { kind: "image" as const, src: map.get(s.bgFill.src)! } } : {}),
    })),
  };
}

function swapMedia(m: SlideMedia, map: Map<string, string>): SlideMedia {
  const out = { ...m };
  if (map.has(m.src)) out.src = map.get(m.src)!;
  if (m.poster && map.has(m.poster)) out.poster = map.get(m.poster)!;
  return out;
}

/** A data: URL as a Blob (null if it isn't a base64 data URL). */
export function dataUrlToBlob(u: string): Blob | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(u);
  if (!m || !m[2]) return null;
  try {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  } catch {
    return null;
  }
}

/** externalizeImages uploads inline raster pictures (data: URLs, e.g. from
 *  a pptx import) with `upload` and points the elements at the returned
 *  URLs. Pictures that fail to upload, and SVGs, stay inline. */
export async function externalizeImages<S extends { elements: SlideElement[]; bgFill?: SlideFill }>(
  slides: S[],
  upload: (b: Blob) => Promise<string>,
): Promise<S[]> {
  const urls = new Set<string>();
  const collect = (els: readonly SlideElement[]) => {
    for (const e of els) {
      if (e.type === "image" && e.src?.startsWith("data:") && !e.src.startsWith("data:image/svg")) urls.add(e.src);
      if (e.type === "media" && e.media) {
        if (e.media.src.startsWith("data:")) urls.add(e.media.src);
        if (e.media.poster?.startsWith("data:") && !e.media.poster.startsWith("data:image/svg")) urls.add(e.media.poster);
      }
      if (e.children) collect(e.children);
    }
  };
  const inlineBg = (s: S) =>
    s.bgFill?.kind === "image" && s.bgFill.src.startsWith("data:") && !s.bgFill.src.startsWith("data:image/svg") ? s.bgFill.src : null;
  slides.forEach((s) => {
    collect(s.elements);
    const bg = inlineBg(s);
    if (bg) urls.add(bg);
  });
  if (!urls.size) return slides;
  const map = new Map<string, string>();
  for (const u of urls) {
    const b = dataUrlToBlob(u);
    if (!b) continue;
    try {
      map.set(u, await upload(b));
    } catch {
      /* keep inline */
    }
  }
  const swap = (els: SlideElement[]): SlideElement[] =>
    els.map((e) => ({
      ...e,
      ...(e.type === "image" && e.src && map.has(e.src) ? { src: map.get(e.src)! } : {}),
      ...(e.type === "media" && e.media ? { media: swapMedia(e.media, map) } : {}),
      ...(e.children ? { children: swap(e.children) } : {}),
    }));
  return slides.map((s) => {
    const bg = inlineBg(s);
    return {
      ...s,
      elements: swap(s.elements),
      ...(bg && map.has(bg) ? { bgFill: { kind: "image" as const, src: map.get(bg)! } } : {}),
    };
  });
}
