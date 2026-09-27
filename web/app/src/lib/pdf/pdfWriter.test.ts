// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPdf, helveticaWidth, utf16Hex, winAnsiBytes } from "./pdfWriter";

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
const fakeJpeg = { data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 4, height: 2 };

async function openWithPdfjs(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false }).promise;
}

describe("pdfWriter", () => {
  it("writes one page object per page with the page size", () => {
    const pdf = latin1(
      buildPdf(
        [
          { w: 720, h: 405, image: fakeJpeg },
          { w: 612, h: 792 },
        ],
        { title: "Deck", date: new Date(0) },
      ),
    );
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(2);
    expect(pdf).toContain("/Count 2");
    expect(pdf).toContain("/MediaBox [0 0 720 405]");
    expect(pdf).toContain("/MediaBox [0 0 612 792]");
    expect(pdf).toContain("/Filter /DCTDecode");
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("has a valid cross-reference table", () => {
    const bytes = buildPdf([{ w: 100, h: 100, image: fakeJpeg, texts: [{ x: 1, y: 20, size: 10, text: "Hi" }] }]);
    const pdf = latin1(bytes);
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const rows = pdf.slice(startxref).split("\n").slice(3).filter((l) => / n $/.test(l));
    rows.forEach((row, i) => {
      const off = Number(row.slice(0, 10));
      expect(pdf.slice(off).startsWith(`${i + 1} 0 obj`)).toBe(true);
    });
  });

  it("encodes text as WinAnsi and metadata as UTF-16", () => {
    expect(winAnsiBytes("A€–é")).toEqual([0x41, 0x80, 0x96, 0xe9]);
    expect(winAnsiBytes("日本")).toEqual([]);
    expect(utf16Hex("Hé")).toBe("<FEFF004800E9>");
  });

  it("is readable by pdf.js: page count, sizes, text layer and links", async () => {
    const bytes = buildPdf(
      [
        {
          w: 720,
          h: 405,
          image: fakeJpeg,
          texts: [
            { x: 40, y: 60, size: 28, text: "Quarterly (review)" },
            { x: 40, y: 100, size: 14, text: "Revenue up 12% – see appendix" },
          ],
          links: [
            { box: { x: 40, y: 80, w: 200, h: 20 }, url: "https://example.com/report" },
            { box: { x: 0, y: 0, w: 5, h: 5 }, url: "javascript:alert(1)" },
          ],
        },
        { w: 612, h: 792, texts: [{ x: 36, y: 50, size: 11, text: "Speaker notes here" }] },
      ],
      { title: "Quarterly" },
    );
    const doc = await openWithPdfjs(bytes);
    expect(doc.numPages).toBe(2);
    const p1 = await doc.getPage(1);
    expect(p1.view).toEqual([0, 0, 720, 405]);
    const text = (await p1.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    expect(text).toContain("Quarterly (review)");
    expect(text).toContain("Revenue up 12% – see appendix");
    const annots = await p1.getAnnotations();
    expect(annots.map((a: { url?: string }) => a.url)).toEqual(["https://example.com/report"]);
    const p2 = await doc.getPage(2);
    expect(p2.view).toEqual([0, 0, 612, 792]);
    const meta = await doc.getMetadata();
    expect((meta.info as { Title?: string }).Title).toBe("Quarterly");
  });

  it("stretches a text run to its rendered width with Tz", () => {
    expect(helveticaWidth(winAnsiBytes("Hi"))).toBeCloseTo(0.944);
    const pdf = latin1(
      buildPdf([{ w: 100, h: 100, texts: [{ x: 0, y: 10, size: 10, text: "Hi", w: 18.88 }, { x: 0, y: 30, size: 10, text: "Hi" }] }], { producer: "Grown Docs" }),
    );
    expect(pdf).toContain("200 Tz /F1 10 Tf");
    expect(pdf).toContain("100 Tz /F1 10 Tf");
    expect(pdf).toContain(utf16Hex("Grown Docs"));
  });
});
