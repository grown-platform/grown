import { useEffect, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/joy";
import { loadZip, ZipArchive, bytesToBlobPart } from "./zip";

interface EpubReaderProps {
  url: string;
  fontScale: number;
  lineHeight: number;
  dark: boolean;
  justify: boolean;
  /** notify the parent of the parsed chapter list for the TOC panel */
  onToc?: (toc: { label: string; index: number }[]) => void;
  /** chapter index to display */
  chapter: number;
  onChapterCount?: (n: number) => void;
}

/**
 * Best-effort EPUB renderer: reads the OPF spine, resolves each XHTML chapter,
 * strips scripts, rewrites relative image hrefs to blob URLs, and renders the
 * chapter HTML. Not a full EPUB engine (no pagination/CSS sandboxing) but it
 * reflows the text content of standard EPUBs.
 */
export function EpubReader({
  url,
  fontScale,
  lineHeight,
  dark,
  justify,
  onToc,
  chapter,
  onChapterCount,
}: EpubReaderProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chapters, setChapters] = useState<{ href: string; label: string }[]>(
    [],
  );
  const [zip, setZip] = useState<ZipArchive | null>(null);
  const [opfDir, setOpfDir] = useState("");

  // Load + parse the EPUB structure once.
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    (async () => {
      try {
        const z = await loadZip(url);
        if (cancelled) return;
        const container = z.get("META-INF/container.xml");
        if (!container) throw new Error("missing META-INF/container.xml");
        const cxml = new DOMParser().parseFromString(
          await z.readText(container),
          "application/xml",
        );
        const opfPath = cxml
          .querySelector("rootfile")
          ?.getAttribute("full-path");
        if (!opfPath) throw new Error("missing OPF rootfile");
        const dir = opfPath.includes("/")
          ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
          : "";
        const opfEntry = z.get(opfPath);
        if (!opfEntry) throw new Error("OPF not found in archive");
        const opf = new DOMParser().parseFromString(
          await z.readText(opfEntry),
          "application/xml",
        );

        const manifest = new Map<string, string>();
        opf.querySelectorAll("manifest > item").forEach((it) => {
          const id = it.getAttribute("id");
          const href = it.getAttribute("href");
          if (id && href) manifest.set(id, href);
        });
        const titleMap = new Map<string, string>();
        const spine = Array.from(opf.querySelectorAll("spine > itemref"))
          .map((ref) => ref.getAttribute("idref"))
          .filter((id): id is string => !!id && manifest.has(id))
          .map((id, i) => {
            const href = manifest.get(id)!;
            titleMap.set(href, `Chapter ${i + 1}`);
            return { href, label: `Chapter ${i + 1}` };
          });
        if (!spine.length) throw new Error("empty spine");
        if (cancelled) return;
        setZip(z);
        setOpfDir(dir);
        setChapters(spine);
        onChapterCount?.(spine.length);
        onToc?.(spine.map((s, i) => ({ label: s.label, index: i })));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Render the selected chapter.
  useEffect(() => {
    if (!zip || !chapters.length) return;
    let cancelled = false;
    const blobUrls: string[] = [];
    (async () => {
      try {
        const ch = chapters[Math.min(chapter, chapters.length - 1)];
        const entry = zip.get(opfDir + ch.href) || zip.get(ch.href);
        if (!entry) throw new Error(`chapter not found: ${ch.href}`);
        const raw = await zip.readText(entry);
        const doc = new DOMParser().parseFromString(
          raw,
          "application/xhtml+xml",
        );
        doc
          .querySelectorAll("script, style[src], link")
          .forEach((n) => n.remove());
        // Rewrite relative <img> sources to blob URLs from the archive.
        for (const img of Array.from(doc.querySelectorAll("img"))) {
          const src = img.getAttribute("src");
          if (!src || /^https?:|^data:/.test(src)) continue;
          const resolved = resolvePath(opfDir + ch.href, src);
          const imgEntry = zip.get(resolved) || zip.get(src);
          if (imgEntry) {
            const bytes = await zip.readBytes(imgEntry);
            const blobUrl = URL.createObjectURL(
              new Blob([bytesToBlobPart(bytes)]),
            );
            blobUrls.push(blobUrl);
            img.setAttribute("src", blobUrl);
          }
        }
        const body = doc.querySelector("body");
        if (cancelled) return;
        setHtml(body ? body.innerHTML : raw);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      blobUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [zip, chapters, chapter, opfDir]);

  if (error) {
    return (
      <Box sx={{ p: 3 }} role="alert">
        <Typography color="danger">Couldn’t render EPUB: {error}</Typography>
        <Typography level="body-sm" sx={{ mt: 1, opacity: 0.7 }}>
          Use Download from the menu to open it in a dedicated reader.
        </Typography>
      </Box>
    );
  }
  if (html === null) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  return (
    <Box
      sx={{
        maxWidth: 720,
        mx: "auto",
        px: 3,
        py: 4,
        fontSize: `${fontScale}rem`,
        lineHeight,
        textAlign: justify ? "justify" : "left",
        color: dark ? "#ddd" : "inherit",
        "& img": { maxWidth: "100%", height: "auto" },
        "& h1, & h2, & h3": { lineHeight: 1.2 },
      }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function resolvePath(from: string, rel: string): string {
  const base = from.includes("/")
    ? from.slice(0, from.lastIndexOf("/") + 1)
    : "";
  const parts = (base + rel).split("/");
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  return stack.join("/");
}
