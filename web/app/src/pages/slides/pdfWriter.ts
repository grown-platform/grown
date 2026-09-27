// A small PDF 1.4 writer for the Slides PDF export (M12), written from the
// PDF 1.7 spec (ISO 32000-1): one JPEG picture per page (the rendered page),
// an invisible text layer so the file is searchable and copyable, and link
// annotations. Pure: bytes in, bytes out.

export interface PdfJpeg {
  /** Baseline JPEG bytes (DCTDecode). */
  data: Uint8Array;
  /** Pixel size. */
  width: number;
  height: number;
}

/** Page-space rectangle, points from the top-left corner. */
export interface PdfBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfText {
  /** Left of the baseline, from the page's top-left, in points. */
  x: number;
  y: number;
  size: number;
  text: string;
}

export interface PdfPage {
  /** Page size in points. */
  w: number;
  h: number;
  /** The picture, drawn at `box` (default: the whole page). */
  image?: PdfJpeg;
  box?: PdfBox;
  /** Invisible text (render mode 3): selectable and searchable. */
  texts?: PdfText[];
  links?: { box: PdfBox; url: string }[];
}

export interface PdfMeta {
  title?: string;
  author?: string;
  /** Fixed creation date (tests); default now. */
  date?: Date;
}

// Unicode → WinAnsiEncoding (PDF spec Annex D) for the non-Latin-1 slots.
const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a,
  "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** winAnsiBytes encodes text for a standard-14 font; characters outside
 *  WinAnsiEncoding are dropped (the picture still shows them). */
export function winAnsiBytes(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (WIN_ANSI[ch] !== undefined) out.push(WIN_ANSI[ch]);
    else if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else if (c === 0x09) out.push(0x20);
  }
  return out;
}

/** A PDF literal string "(…)" with ( ) \ escaped, from byte values. */
function literal(bytes: number[]): string {
  let s = "(";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s + ")";
}

/** A text string (document metadata) as UTF-16BE hex with a BOM. */
export function utf16Hex(text: string): string {
  let h = "<FEFF";
  for (let i = 0; i < text.length; i++) h += text.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return h + ">";
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

function pdfDate(d: Date): string {
  const p = (v: number) => String(v).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Only web and mail links become URI actions. */
function safeUri(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url);
}

/** buildPdf writes the pages to a PDF file. */
export function buildPdf(pages: readonly PdfPage[], meta: PdfMeta = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (b: Uint8Array) => {
    chunks.push(b);
    length += b.length;
  };
  const ascii = (s: string) => {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    push(b);
  };
  // Object numbers: 1 catalog, 2 pages, 3 font, 4 info, then per page:
  // page, content, [image], [annots…].
  let next = 5;
  const plan = pages.map((p) => {
    const page = next++;
    const content = next++;
    const image = p.image ? next++ : 0;
    const links = (p.links ?? []).filter((l) => safeUri(l.url)).map((l) => ({ ...l, obj: next++ }));
    return { page, content, image, links };
  });
  const obj = (num: number, body: string) => {
    offsets[num] = length;
    ascii(`${num} 0 obj\n${body}\nendobj\n`);
  };
  const stream = (num: number, dict: string, data: Uint8Array) => {
    offsets[num] = length;
    ascii(`${num} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`);
    push(data);
    ascii(`\nendstream\nendobj\n`);
  };

  ascii("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  obj(2, `<< /Type /Pages /Kids [${plan.map((p) => `${p.page} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  obj(3, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  const info = [`/Producer ${utf16Hex("Grown Slides")}`, `/CreationDate (${pdfDate(meta.date ?? new Date())})`];
  if (meta.title) info.push(`/Title ${utf16Hex(meta.title)}`);
  if (meta.author) info.push(`/Author ${utf16Hex(meta.author)}`);
  obj(4, `<< ${info.join(" ")} >>`);

  pages.forEach((p, i) => {
    const pl = plan[i];
    const annots = pl.links.length ? ` /Annots [${pl.links.map((l) => `${l.obj} 0 R`).join(" ")}]` : "";
    const xobj = pl.image ? ` /XObject << /Im0 ${pl.image} 0 R >>` : "";
    obj(pl.page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(p.w)} ${n(p.h)}] /Resources << /Font << /F1 3 0 R >>${xobj} >> /Contents ${pl.content} 0 R${annots} >>`);
    // Content: the picture, then the invisible text.
    let c = "";
    if (p.image) {
      const b = p.box ?? { x: 0, y: 0, w: p.w, h: p.h };
      c += `q ${n(b.w)} 0 0 ${n(b.h)} ${n(b.x)} ${n(p.h - b.y - b.h)} cm /Im0 Do Q\n`;
    }
    const texts = (p.texts ?? []).filter((t) => t.text.trim());
    if (texts.length) {
      c += "BT 3 Tr\n";
      for (const t of texts) {
        const bytes = winAnsiBytes(t.text);
        if (!bytes.length) continue;
        c += `/F1 ${n(t.size)} Tf 1 0 0 1 ${n(t.x)} ${n(p.h - t.y)} Tm ${literal(bytes)} Tj\n`;
      }
      c += "ET\n";
    }
    const cb = new Uint8Array(c.length);
    for (let k = 0; k < c.length; k++) cb[k] = c.charCodeAt(k) & 0xff;
    stream(pl.content, "", cb);
    if (p.image && pl.image)
      stream(pl.image, `/Type /XObject /Subtype /Image /Width ${p.image.width} /Height ${p.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, p.image.data);
    for (const l of pl.links) {
      const r = [l.box.x, p.h - l.box.y - l.box.h, l.box.x + l.box.w, p.h - l.box.y].map(n).join(" ");
      obj(l.obj, `<< /Type /Annot /Subtype /Link /Rect [${r}] /Border [0 0 0] /A << /S /URI /URI ${literal(winAnsiBytes(l.url))} >> >>`);
    }
  });

  const xref = length;
  let x = `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let k = 1; k < next; k++) x += `${String(offsets[k] ?? 0).padStart(10, "0")} 00000 n \n`;
  ascii(x);
  ascii(`trailer\n<< /Size ${next} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let o = 0;
  for (const ch of chunks) {
    out.set(ch, o);
    o += ch.length;
  }
  return out;
}
