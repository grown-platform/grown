import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Vite-friendly worker URL — `?url` returns the asset path Vite emits.
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface PdfPreviewProps {
  url: string;
}

/**
 * Renders every page of the PDF at /url into a stacked canvas list.
 * V1: no pagination/lazy-render — fine for typical document sizes.
 */
export function PdfPreview({ url }: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.display = "block";
          canvas.style.margin = "8px auto";
          canvas.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
          container.appendChild(canvas);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("canvas 2d context unavailable");
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <div
        role="alert"
        style={{ padding: 16, color: "var(--joy-palette-danger-plainColor)" }}
      >
        PDF load failed: {error}
      </div>
    );
  }
  return <div ref={containerRef} style={{ padding: 16 }} />;
}
