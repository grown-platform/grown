// Deck picture assets (M6): pictures uploaded to the deck's asset store are
// referenced by URL. Exports that leave the browser (pptx, HTML, SVG/PNG)
// need the bytes, so inlineImages turns those URLs back into data: URLs.

import type { DeckDoc, SlideElement } from "./model";

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
      if (e.children) collect(e.children);
    }
  };
  deck.slides.forEach((s) => collect(s.elements));
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
      ...(e.children ? { children: swap(e.children) } : {}),
    }));
  return { ...deck, slides: deck.slides.map((s) => ({ ...s, elements: swap(s.elements) })) };
}
