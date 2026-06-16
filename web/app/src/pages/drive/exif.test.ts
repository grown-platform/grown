import { describe, it, expect } from "vitest";
import { readImageMeta, readJpegGps, type ImageMeta } from "./exif";

// ---------------------------------------------------------------------------
// Helpers for building synthetic binary inputs.
// ---------------------------------------------------------------------------

function toBuf(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

// Big-endian helpers for assembling raw byte arrays.
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

/**
 * Build a TIFF/EXIF block (big-endian, "MM") and return its bytes. The block
 * starts at the TIFF header — i.e. what `parseExif` sees as offset `tiff`.
 *
 * `ifd0` and optional `exif`/`gps` sub-IFDs are described as lists of entries.
 * Values that don't fit in 4 bytes are appended after the IFD and referenced
 * by a TIFF-relative offset.
 */
interface Entry {
  tag: number;
  type: number;
  count: number;
  // Either an inline 4-byte value (already left-justified per EXIF) or a
  // payload appended to the data pool and referenced by offset.
  inline?: number[]; // exactly 4 bytes
  data?: number[]; // arbitrary-length, stored in the pool
}

function buildTiff(opts: {
  ifd0: Entry[];
  exif?: Entry[];
  gps?: Entry[];
}): number[] {
  // Layout plan (all offsets TIFF-relative):
  //   [0..7]   header: "MM" 0x002A, offset-to-IFD0 = 8
  //   [8..]    IFD0
  //   then     EXIF IFD (if any)
  //   then     GPS IFD (if any)
  //   then     data pool (values > 4 bytes)
  const header = [0x4d, 0x4d, 0x00, 0x2a, ...u32be(8)];

  // We need to know where each IFD lands. Compute sizes first.
  const ifdSize = (entries: Entry[]) => 2 + entries.length * 12 + 4; // count + entries + nextIFD

  // Reserve pointer-entry slots: parseExif reads ExifIFDPointer(0x8769) and
  // GPSInfoIFDPointer(0x8825) from ifd0. The caller supplies the rest of ifd0;
  // we append pointer entries here as needed.
  const ifd0Entries = [...opts.ifd0];

  const ifd0Off = 8;
  const exifOff = ifd0Off + ifdSize(ifd0EntriesWithPointers());
  const gpsOff = exifOff + (opts.exif ? ifdSize(opts.exif) : 0);
  let poolOff = gpsOff + (opts.gps ? ifdSize(opts.gps) : 0);

  function ifd0EntriesWithPointers(): Entry[] {
    const e = [...opts.ifd0];
    if (opts.exif) e.push({ tag: 0x8769, type: 4, count: 1, inline: [] });
    if (opts.gps) e.push({ tag: 0x8825, type: 4, count: 1, inline: [] });
    return e;
  }

  // Fill in pointer entries now that exifOff/gpsOff are known.
  if (opts.exif) ifd0Entries.push({ tag: 0x8769, type: 4, count: 1, inline: u32be(exifOff) });
  if (opts.gps) ifd0Entries.push({ tag: 0x8825, type: 4, count: 1, inline: u32be(gpsOff) });

  const pool: number[] = [];
  const poolBase = poolOff;

  // Serialize one IFD; entries needing the pool get an offset assigned now.
  function serializeIFD(entries: Entry[]): number[] {
    const out: number[] = [...u16be(entries.length)];
    for (const e of entries) {
      out.push(...u16be(e.tag), ...u16be(e.type), ...u32be(e.count));
      if (e.data && e.data.length > 4) {
        const at = poolBase + pool.length;
        pool.push(...e.data);
        out.push(...u32be(at));
      } else if (e.data) {
        const padded = [...e.data, 0, 0, 0, 0].slice(0, 4);
        out.push(...padded);
      } else {
        const inl = [...(e.inline ?? []), 0, 0, 0, 0].slice(0, 4);
        out.push(...inl);
      }
    }
    out.push(...u32be(0)); // next IFD = none
    return out;
  }

  const ifd0Bytes = serializeIFD(ifd0Entries);
  const exifBytes = opts.exif ? serializeIFD(opts.exif) : [];
  const gpsBytes = opts.gps ? serializeIFD(opts.gps) : [];

  return [...header, ...ifd0Bytes, ...exifBytes, ...gpsBytes, ...pool];
}

/** Wrap a TIFF block as a JPEG with an APP1/Exif segment. */
function jpegWithExif(tiff: number[]): ArrayBuffer {
  const exifPayload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + TIFF
  const app1Size = exifPayload.length + 2; // size field includes itself
  const bytes = [
    ...u16be(0xffd8), // SOI
    ...u16be(0xffe1), // APP1
    ...u16be(app1Size),
    ...exifPayload,
    ...u16be(0xffd9), // EOI
  ];
  return toBuf(bytes);
}

// ASCII string as a null-terminated byte payload.
const asciiBytes = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
// Unsigned rational (8 bytes, big-endian num/den).
const ratBE = (num: number, den: number) => [...u32be(num), ...u32be(den)];

describe("readImageMeta — container parsing", () => {
  it("returns empty meta for empty / too-short buffers", () => {
    expect(readImageMeta(new ArrayBuffer(0))).toEqual({});
    expect(readImageMeta(toBuf([0xff]))).toEqual({});
    expect(readImageMeta(toBuf([0x00, 0x00, 0x00]))).toEqual({});
  });

  it("returns empty meta for non-image bytes", () => {
    expect(readImageMeta(toBuf([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual({});
  });

  it("parses PNG width/height from the IHDR header", () => {
    // 8-byte PNG sig, 4-byte length, "IHDR", width(@16), height(@20)
    const bytes = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
      ...u32be(13), // IHDR length
      0x49, 0x48, 0x44, 0x52, // "IHDR"
      ...u32be(640), // width  @ offset 16
      ...u32be(480), // height @ offset 20
      0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, etc.
    ];
    const meta = readImageMeta(toBuf(bytes));
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(480);
    // PNG path returns early — no EXIF fields.
    expect(meta.make).toBeUndefined();
  });

  it("reads JPEG dimensions from a SOF0 segment", () => {
    // SOI, SOF0 (marker FFC0, size, precision, height, width, comps...)
    const sof = [
      ...u16be(0xffc0),
      ...u16be(11), // segment size
      0x08, // precision
      ...u16be(300), // height
      ...u16be(400), // width
      0x03, 0, 0, 0, // components
    ];
    const bytes = [...u16be(0xffd8), ...sof, ...u16be(0xffd9)];
    const meta = readImageMeta(toBuf(bytes));
    expect(meta.height).toBe(300);
    expect(meta.width).toBe(400);
  });

  it("SOI with no segments yields empty meta", () => {
    expect(readImageMeta(toBuf([...u16be(0xffd8), ...u16be(0xffd9)]))).toEqual({});
  });
});

describe("readImageMeta — EXIF field extraction", () => {
  it("extracts make/model/software/orientation from IFD0", () => {
    const tiff = buildTiff({
      ifd0: [
        { tag: 0x010f, type: 2, count: 5, data: asciiBytes("Sony") },
        { tag: 0x0110, type: 2, count: 7, data: asciiBytes("A7 III") },
        { tag: 0x0131, type: 2, count: 5, data: asciiBytes("v1.0") }, // count includes NUL → >4 → pooled
        { tag: 0x0112, type: 3, count: 1, inline: [...u16be(6), 0, 0] }, // orientation
      ],
    });
    const meta = readImageMeta(jpegWithExif(tiff));
    expect(meta.make).toBe("Sony");
    expect(meta.model).toBe("A7 III");
    expect(meta.software).toBe("v1.0");
    expect(meta.orientation).toBe(6);
  });

  it("extracts and formats EXIF sub-IFD camera settings + date", () => {
    const tiff = buildTiff({
      ifd0: [{ tag: 0x010f, type: 2, count: 6, data: asciiBytes("Canon") }],
      exif: [
        { tag: 0x9003, type: 2, count: 20, data: asciiBytes("2021:06:15 14:30:00") }, // DateTimeOriginal
        { tag: 0x829a, type: 5, count: 1, data: ratBE(1, 250) }, // ExposureTime
        { tag: 0x829d, type: 5, count: 1, data: ratBE(28, 10) }, // FNumber 2.8
        { tag: 0x8827, type: 3, count: 1, inline: [...u16be(400), 0, 0] }, // ISO
        { tag: 0x920a, type: 5, count: 1, data: ratBE(263, 10) }, // FocalLength 26.3
        { tag: 0xa434, type: 2, count: 12, data: asciiBytes("FE 50mm") }, // LensModel
        { tag: 0xa002, type: 3, count: 1, inline: [...u16be(6000), 0, 0] }, // PixelXDimension
        { tag: 0xa003, type: 3, count: 1, inline: [...u16be(4000), 0, 0] }, // PixelYDimension
      ],
    });
    const meta = readImageMeta(jpegWithExif(tiff));
    expect(meta.make).toBe("Canon");
    expect(meta.exposure).toBe("1/250 s");
    expect(meta.fNumber).toBe("f/2.8");
    expect(meta.iso).toBe(400);
    expect(meta.focalLength).toBe("26 mm"); // rounded
    expect(meta.lens).toBe("FE 50mm");
    expect(meta.width).toBe(6000);
    expect(meta.height).toBe(4000);
    // DateTimeOriginal formatted via toLocaleString — just confirm year + month.
    expect(meta.dateTaken).toContain("2021");
    expect(meta.dateTaken).toContain("Jun");
  });

  it("formats exposures >= 1 second without a fraction", () => {
    const tiff = buildTiff({
      ifd0: [],
      exif: [{ tag: 0x829a, type: 5, count: 1, data: ratBE(2, 1) }], // 2s
    });
    expect(readImageMeta(jpegWithExif(tiff)).exposure).toBe("2 s");
  });

  it("extracts GPS coordinates and applies S/W hemisphere refs", () => {
    // 37°48'30\"N => 37.808333... ; 122°25'0\"W => -122.4166...
    const tiff = buildTiff({
      ifd0: [],
      gps: [
        { tag: 0x0001, type: 2, count: 2, data: asciiBytes("N") }, // lat ref
        { tag: 0x0002, type: 5, count: 3, data: [...ratBE(37, 1), ...ratBE(48, 1), ...ratBE(30, 1)] },
        { tag: 0x0003, type: 2, count: 2, data: asciiBytes("W") }, // lon ref
        { tag: 0x0004, type: 5, count: 3, data: [...ratBE(122, 1), ...ratBE(25, 1), ...ratBE(0, 1)] },
      ],
    });
    const meta = readImageMeta(jpegWithExif(tiff));
    expect(meta.gps).toBeDefined();
    expect(meta.gps!.lat).toBeCloseTo(37.808333, 4);
    expect(meta.gps!.lon).toBeCloseTo(-122.416666, 4);
  });

  it("rejects degenerate (0,0) GPS coordinates", () => {
    const tiff = buildTiff({
      ifd0: [],
      gps: [
        { tag: 0x0001, type: 2, count: 2, data: asciiBytes("N") },
        { tag: 0x0002, type: 5, count: 3, data: [...ratBE(0, 1), ...ratBE(0, 1), ...ratBE(0, 1)] },
        { tag: 0x0003, type: 2, count: 2, data: asciiBytes("E") },
        { tag: 0x0004, type: 5, count: 3, data: [...ratBE(0, 1), ...ratBE(0, 1), ...ratBE(0, 1)] },
      ],
    });
    expect(readImageMeta(jpegWithExif(tiff)).gps).toBeUndefined();
  });

  it("APP1 segment without the Exif signature is ignored", () => {
    // APP1 present but payload is not "Exif\0\0" — parseExif never runs.
    const app1 = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x00, 0x01, 0x02]; // "JFIF.."
    const bytes = [
      ...u16be(0xffd8),
      ...u16be(0xffe1),
      ...u16be(app1.length + 2),
      ...app1,
      ...u16be(0xffd9),
    ];
    expect(readImageMeta(toBuf(bytes))).toEqual({});
  });
});

describe("readJpegGps — back-compat helper", () => {
  it("returns the GPS coord when present", () => {
    const tiff = buildTiff({
      ifd0: [],
      gps: [
        { tag: 0x0001, type: 2, count: 2, data: asciiBytes("N") },
        { tag: 0x0002, type: 5, count: 3, data: [...ratBE(10, 1), ...ratBE(0, 1), ...ratBE(0, 1)] },
        { tag: 0x0003, type: 2, count: 2, data: asciiBytes("E") },
        { tag: 0x0004, type: 5, count: 3, data: [...ratBE(20, 1), ...ratBE(0, 1), ...ratBE(0, 1)] },
      ],
    });
    const gps = readJpegGps(jpegWithExif(tiff));
    expect(gps).not.toBeNull();
    expect(gps!.lat).toBeCloseTo(10, 5);
    expect(gps!.lon).toBeCloseTo(20, 5);
  });

  it("returns null when there is no GPS data", () => {
    expect(readJpegGps(new ArrayBuffer(0))).toBeNull();
    const meta: ImageMeta = readImageMeta(new ArrayBuffer(0));
    expect(meta.gps).toBeUndefined();
  });
});
