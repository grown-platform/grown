import {
  CANVAS_W,
  CANVAS_H,
  shapeClipPath,
  elementTransform,
  type DeckDoc,
  type Slide,
  type SlideElement,
} from "./model";

export type DeckFormat =
  | "pptx"
  | "pdf"
  | "txt"
  | "html"
  | "jpg"
  | "png"
  | "svg";

// Mirrors Google Slides' File → Download menu. jpg/png/svg export the current
// slide (like Google); pptx/pdf/txt/html cover the whole deck. (ODP needs a
// dedicated writer lib and is omitted rather than shipped broken.)
export const DECK_DOWNLOAD_FORMATS: { fmt: DeckFormat; label: string }[] = [
  { fmt: "pptx", label: "Microsoft PowerPoint (.pptx)" },
  { fmt: "pdf", label: "PDF Document (.pdf)" },
  { fmt: "txt", label: "Plain Text (.txt)" },
  { fmt: "html", label: "Web Page (.html)" },
  { fmt: "jpg", label: "JPEG image (.jpg, current slide)" },
  { fmt: "png", label: "PNG image (.png, current slide)" },
  { fmt: "svg", label: "Scalable Vector Graphics (.svg, current slide)" },
];

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Serialize one element to an absolutely-positioned HTML string (for print/HTML export).
function elementHTML(el: SlideElement): string {
  const tf = elementTransform(el);
  const xform = tf ? `transform:${tf};transform-origin:center;` : "";
  const box = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;${xform}`;
  if (el.type === "text") {
    const style =
      box +
      `font-size:${el.fontSize}px;font-family:${el.fontFamily || "Arial"};color:${el.color || "#000"};` +
      `font-weight:${el.bold ? 700 : 400};font-style:${el.italic ? "italic" : "normal"};` +
      `text-decoration:${el.underline ? "underline" : "none"};text-align:${el.align || "left"};` +
      `display:flex;flex-direction:column;justify-content:${el.valign === "middle" ? "center" : el.valign === "bottom" ? "flex-end" : "flex-start"};` +
      `white-space:pre-wrap;word-break:break-word;line-height:1.2;padding:4px;overflow:hidden;box-sizing:border-box;`;
    return `<div style="${style}">${esc(el.text || "").replace(/\n/g, "<br/>")}</div>`;
  }
  const bd =
    el.stroke && el.stroke !== "none"
      ? `border:${el.strokeWidth}px solid ${el.stroke};`
      : "";
  if (el.type === "rect")
    return `<div style="${box}background:${el.fill};${bd}box-sizing:border-box;"></div>`;
  if (el.type === "roundRect")
    return `<div style="${box}background:${el.fill};border-radius:${Math.min(el.w, el.h) * 0.18}px;${bd}box-sizing:border-box;"></div>`;
  if (el.type === "ellipse")
    return `<div style="${box}background:${el.fill};border-radius:50%;${bd}box-sizing:border-box;"></div>`;
  if (
    el.type === "triangle" ||
    el.type === "diamond" ||
    el.type === "rightArrow"
  ) {
    const clip = shapeClipPath(el.type);
    const sh =
      el.stroke && el.stroke !== "none"
        ? `filter:drop-shadow(0 0 ${el.strokeWidth || 1}px ${el.stroke});`
        : "";
    return `<div style="${box}background:${el.fill};clip-path:${clip};${sh}"></div>`;
  }
  if (el.type === "line")
    return `<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${Math.max(el.strokeWidth || 2, 1)}px;background:${el.stroke};"></div>`;
  if (el.type === "image")
    return el.src
      ? `<img src="${el.src}" style="${box}object-fit:contain;"/>`
      : `<div style="${box}background:#f1f3f4;"></div>`;
  return "";
}

function slideHTML(slide: Slide): string {
  const inner = slide.elements.map(elementHTML).join("");
  return `<div class="slide" style="position:relative;width:${CANVAS_W}px;height:${CANVAS_H}px;background:${slide.background};overflow:hidden;">${inner}</div>`;
}

function fullHTML(deck: DeckDoc, title: string): string {
  const slides = deck.slides.map(slideHTML).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:${CANVAS_W}px ${CANVAS_H}px;margin:0}body{margin:0}.slide{page-break-after:always}</style>
</head><body>${slides}</body></html>`;
}

function pxToInch(px: number): number {
  return (px / CANVAS_W) * 10;
} // 16:9 → 10in wide
function pxToPt(px: number): number {
  return px * 0.75;
} // 960px logical → 720pt
function hex(c?: string): string {
  return (c || "#000000").replace("#", "").slice(0, 6).padEnd(6, "0");
}

// Fractional (0..1) polygon points for clip-path shapes, kept in sync with
// shapeClipPath() in model.ts. Used for SVG/pptx polygon rendering.
function clipPathPoints(type: SlideElement["type"]): [number, number][] {
  switch (type) {
    case "triangle":
      return [
        [0.5, 0],
        [1, 1],
        [0, 1],
      ];
    case "diamond":
      return [
        [0.5, 0],
        [1, 0.5],
        [0.5, 1],
        [0, 0.5],
      ];
    case "rightArrow":
      return [
        [0, 0.3],
        [0.6, 0.3],
        [0.6, 0],
        [1, 0.5],
        [0.6, 1],
        [0.6, 0.7],
        [0, 0.7],
      ];
    default:
      return [];
  }
}

// Render one slide to a standalone SVG string (matches the canvas model).
function slideToSVG(slide: Slide): string {
  const parts: string[] = [
    `<rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="${slide.background || "#ffffff"}"/>`,
  ];
  for (const el of slide.elements) {
    const strokeAttr =
      el.stroke && el.stroke !== "none"
        ? ` stroke="${el.stroke}" stroke-width="${el.strokeWidth || 1}"`
        : "";
    if (el.type === "rect") {
      parts.push(
        `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="${el.fill || "none"}"${strokeAttr}/>`,
      );
    } else if (el.type === "roundRect") {
      const r = Math.min(el.w, el.h) * 0.18;
      parts.push(
        `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${r}" ry="${r}" fill="${el.fill || "none"}"${strokeAttr}/>`,
      );
    } else if (
      el.type === "triangle" ||
      el.type === "diamond" ||
      el.type === "rightArrow"
    ) {
      // Map the CSS clip-path percentages to absolute SVG points.
      const pts = clipPathPoints(el.type)
        .map(([px, py]) => `${el.x + px * el.w},${el.y + py * el.h}`)
        .join(" ");
      parts.push(
        `<polygon points="${pts}" fill="${el.fill || "none"}"${strokeAttr}/>`,
      );
    } else if (el.type === "ellipse") {
      parts.push(
        `<ellipse cx="${el.x + el.w / 2}" cy="${el.y + el.h / 2}" rx="${el.w / 2}" ry="${el.h / 2}" fill="${el.fill || "none"}"${el.stroke && el.stroke !== "none" ? ` stroke="${el.stroke}" stroke-width="${el.strokeWidth || 1}"` : ""}/>`,
      );
    } else if (el.type === "line") {
      parts.push(
        `<line x1="${el.x}" y1="${el.y}" x2="${el.x + el.w}" y2="${el.y}" stroke="${el.stroke || "#000"}" stroke-width="${el.strokeWidth || 2}"/>`,
      );
    } else if (el.type === "image" && el.src) {
      parts.push(
        `<image href="${el.src}" x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" preserveAspectRatio="xMidYMid meet"/>`,
      );
    } else if (el.type === "text") {
      const anchor =
        el.align === "center"
          ? "middle"
          : el.align === "right"
            ? "end"
            : "start";
      const tx =
        el.align === "center"
          ? el.x + el.w / 2
          : el.align === "right"
            ? el.x + el.w
            : el.x + 4;
      const size = el.fontSize || 18;
      const lines = (el.text || "").split("\n");
      const lineH = size * 1.2;
      const blockH = lines.length * lineH;
      const startY =
        el.valign === "middle"
          ? el.y + (el.h - blockH) / 2 + size
          : el.valign === "bottom"
            ? el.y + el.h - blockH + size
            : el.y + size;
      const tspans = lines
        .map(
          (ln, i) =>
            `<tspan x="${tx}" y="${startY + i * lineH}">${esc(ln)}</tspan>`,
        )
        .join("");
      parts.push(
        `<text font-family="${el.fontFamily || "Arial"}" font-size="${size}" fill="${el.color || "#000"}" text-anchor="${anchor}"${el.bold ? ` font-weight="bold"` : ""}${el.italic ? ` font-style="italic"` : ""}${el.underline ? ` text-decoration="underline"` : ""}>${tspans}</text>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">${parts.join("")}</svg>`;
}

// Rasterize an SVG string to a PNG/JPEG blob via an offscreen canvas.
function svgToImage(
  svg: string,
  type: "image/png" | "image/jpeg",
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url =
      "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no 2d context"));
        return;
      }
      if (type === "image/jpeg") {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        type,
        0.92,
      );
    };
    img.onerror = () => reject(new Error("SVG render failed"));
    img.src = url;
  });
}

/**
 * downloadDeck exports the presentation. pptx is built with pptxgenjs; pdf is
 * produced via a faithful print window (Save as PDF); html/txt are written
 * client-side.
 */
export async function downloadDeck(
  deck: DeckDoc,
  title: string,
  fmt: DeckFormat,
  slideIndex = 0,
): Promise<void> {
  const name = (title || "presentation").replace(/[/\\?%*:|"<>]/g, "-");

  // Current-slide image exports (Google parity: jpg/png/svg).
  if (fmt === "svg" || fmt === "png" || fmt === "jpg") {
    const slide =
      deck.slides[Math.min(slideIndex, deck.slides.length - 1)] ||
      deck.slides[0];
    const svg = slideToSVG(slide);
    if (fmt === "svg") {
      triggerDownload(
        new Blob([svg], { type: "image/svg+xml" }),
        `${name}.svg`,
      );
      return;
    }
    const blob = await svgToImage(
      svg,
      fmt === "png" ? "image/png" : "image/jpeg",
    );
    triggerDownload(blob, `${name}.${fmt}`);
    return;
  }

  if (fmt === "txt") {
    const text = deck.slides
      .map((s, i) => {
        const body = s.elements
          .filter((e) => e.type === "text" && e.text)
          .map((e) => e.text)
          .join("\n");
        const notes =
          s.notes && s.notes.trim()
            ? `\n\n[Speaker notes]\n${s.notes.trim()}`
            : "";
        return `--- Slide ${i + 1} ---\n${body}${notes}`;
      })
      .join("\n\n");
    triggerDownload(new Blob([text], { type: "text/plain" }), `${name}.txt`);
    return;
  }

  if (fmt === "html") {
    triggerDownload(
      new Blob([fullHTML(deck, name)], { type: "text/html" }),
      `${name}.html`,
    );
    return;
  }

  if (fmt === "pdf") {
    // Open a print window with each slide as a page; the user saves as PDF.
    const win = window.open("", "_blank");
    if (!win) {
      window.alert("Allow pop-ups to export as PDF.");
      return;
    }
    win.document.write(fullHTML(deck, name));
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
    }, 300);
    return;
  }

  // pptx — build a real PowerPoint with pptxgenjs.
  const mod = await import("pptxgenjs");
  const PptxGenJS = mod.default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "GROWN16x9", width: 10, height: 5.625 });
  pptx.layout = "GROWN16x9";
  for (const slide of deck.slides) {
    const s = pptx.addSlide();
    s.background = { color: hex(slide.background) };
    for (const el of slide.elements) {
      const pos = {
        x: pxToInch(el.x),
        y: pxToInch(el.y),
        w: pxToInch(el.w),
        h: pxToInch(Math.max(el.h, 1)),
      };
      try {
        if (el.type === "text") {
          s.addText(el.text || "", {
            ...pos,
            fontSize: pxToPt(el.fontSize || 18),
            bold: !!el.bold,
            italic: !!el.italic,
            underline: el.underline ? { style: "sng" } : undefined,
            color: hex(el.color),
            align: el.align || "left",
            valign:
              el.valign === "middle"
                ? "middle"
                : el.valign === "bottom"
                  ? "bottom"
                  : "top",
            fontFace: el.fontFamily || "Arial",
          });
        } else if (
          el.type === "rect" ||
          el.type === "roundRect" ||
          el.type === "ellipse" ||
          el.type === "triangle" ||
          el.type === "diamond" ||
          el.type === "rightArrow"
        ) {
          // pptxgenjs ShapeType names: rect, roundRect, ellipse, triangle, diamond, rightArrow.
          const line =
            el.stroke && el.stroke !== "none"
              ? { color: hex(el.stroke), width: el.strokeWidth }
              : undefined;
          s.addShape(el.type as Parameters<typeof s.addShape>[0], {
            ...pos,
            fill: { color: hex(el.fill) },
            line,
          });
        } else if (el.type === "line") {
          s.addShape("line", {
            x: pos.x,
            y: pos.y,
            w: pos.w,
            h: 0,
            line: { color: hex(el.stroke), width: el.strokeWidth || 2 },
          });
        } else if (el.type === "image" && el.src) {
          if (el.src.startsWith("data:")) s.addImage({ ...pos, data: el.src });
          else s.addImage({ ...pos, path: el.src });
        }
      } catch {
        /* skip element that pptxgenjs rejects */
      }
    }
    if (slide.notes && slide.notes.trim()) s.addNotes(slide.notes);
  }
  await pptx.writeFile({ fileName: `${name}.pptx` });
}
