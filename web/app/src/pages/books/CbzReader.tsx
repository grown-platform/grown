import { useEffect, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/joy";
import { loadZip, bytesToBlobPart } from "./zip";

interface CbzReaderProps {
  url: string;
  /** page index to show (0-based) */
  page: number;
  onPageCount?: (n: number) => void;
}

const IMG_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

/** Best-effort CBZ reader: a CBZ is a ZIP of page images shown one at a time. */
export function CbzReader({ url, page, onPageCount }: CbzReaderProps) {
  const [names, setNames] = useState<string[] | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zipState, setZipState] = useState<Awaited<
    ReturnType<typeof loadZip>
  > | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNames(null);
    setError(null);
    (async () => {
      try {
        const z = await loadZip(url);
        if (cancelled) return;
        const pages = z.entries
          .filter((e) => IMG_RE.test(e.name) && !e.name.includes("__MACOSX"))
          .map((e) => e.name)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        if (!pages.length) throw new Error("no images in archive");
        setZipState(z);
        setNames(pages);
        onPageCount?.(pages.length);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!zipState || !names) return;
    let cancelled = false;
    let made: string | null = null;
    (async () => {
      try {
        const name = names[Math.min(page, names.length - 1)];
        const entry = zipState.get(name)!;
        const bytes = await zipState.readBytes(entry);
        if (cancelled) return;
        made = URL.createObjectURL(new Blob([bytesToBlobPart(bytes)]));
        setImgUrl(made);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [zipState, names, page]);

  if (error) {
    return (
      <Box sx={{ p: 3 }} role="alert">
        <Typography color="danger">Couldn’t render CBZ: {error}</Typography>
        <Typography level="body-sm" sx={{ mt: 1, opacity: 0.7 }}>
          Use Download from the menu to open it in a comic reader.
        </Typography>
      </Box>
    );
  }
  if (names === null || imgUrl === null) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
      <Box
        component="img"
        src={imgUrl}
        alt={`Page ${page + 1}`}
        sx={{
          maxWidth: "100%",
          maxHeight: "calc(100vh - 120px)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
        }}
      />
    </Box>
  );
}
