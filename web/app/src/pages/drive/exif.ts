// Dependency-free image-metadata reader. Recovers dimensions for JPEG/PNG and,
// for JPEG, the embedded EXIF camera/lens/capture/date/GPS fields. Everything is
// best-effort: it returns whatever it can parse and leaves the rest undefined.

export interface GpsCoord {
  lat: number;
  lon: number;
}

export interface ImageMeta {
  width?: number;
  height?: number;
  make?: string;
  model?: string;
  lens?: string;
  software?: string;
  dateTaken?: string; // human-readable
  exposure?: string; // e.g. "1/250 s"
  fNumber?: string; // e.g. "f/2.8"
  iso?: number;
  focalLength?: string; // e.g. "26 mm"
  orientation?: number;
  gps?: GpsCoord;
}

// EXIF type → byte size, for locating inline vs. offset values.
const TYPE_SIZES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

export function readImageMeta(buf: ArrayBuffer): ImageMeta {
  const view = new DataView(buf);
  const meta: ImageMeta = {};
  try {
    // PNG: signature + IHDR(width,height) at fixed offsets.
    if (view.byteLength >= 24 && view.getUint32(0) === 0x89504e47) {
      meta.width = view.getUint32(16);
      meta.height = view.getUint32(20);
      return meta;
    }
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return meta; // not JPEG

    // Walk JPEG segments for SOF (dimensions) and APP1 (Exif).
    let offset = 2;
    let exifTiff = -1;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break;
      if (marker === 0xffd9 || marker === 0xffda) break; // EOI / start of scan
      const size = view.getUint16(offset + 2);
      if (size < 2) break;
      // SOF0..SOF15 carry dimensions (skip DHT/JPG/DAC: C4/C8/CC).
      if (
        marker >= 0xffc0 && marker <= 0xffcf &&
        marker !== 0xffc4 && marker !== 0xffc8 && marker !== 0xffcc
      ) {
        if (offset + 9 <= view.byteLength) {
          meta.height = view.getUint16(offset + 5);
          meta.width = view.getUint16(offset + 7);
        }
      }
      if (marker === 0xffe1 && exifTiff < 0) {
        const exif = offset + 4;
        if (
          exif + 6 <= view.byteLength &&
          view.getUint32(exif) === 0x45786966 && // "Exif"
          view.getUint16(exif + 4) === 0x0000
        ) {
          exifTiff = exif + 6;
        }
      }
      offset += 2 + size;
    }
    if (exifTiff >= 0) parseExif(view, exifTiff, meta);
  } catch {
    /* malformed/truncated — return what we have */
  }
  return meta;
}

interface IfdEntry {
  type: number;
  count: number;
  off: number; // absolute byte offset to the value
}

function parseExif(view: DataView, tiff: number, meta: ImageMeta) {
  if (tiff + 8 > view.byteLength) return;
  const le = view.getUint16(tiff) === 0x4949; // "II" little / "MM" big
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);

  const ascii = (off: number, count: number) => {
    let s = "";
    for (let i = 0; i < count && off + i < view.byteLength; i++) {
      const c = view.getUint8(off + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  };
  const rational = (off: number, signed: boolean) => {
    if (off + 8 > view.byteLength) return NaN;
    const num = signed ? view.getInt32(off, le) : u32(off);
    const den = signed ? view.getInt32(off + 4, le) : u32(off + 4);
    return den ? num / den : NaN;
  };

  const readIFD = (ifd: number) => {
    const map = new Map<number, IfdEntry>();
    if (ifd < 0 || ifd + 2 > view.byteLength) return map;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > view.byteLength) break;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZES[type] || 1) * count;
      const off = size <= 4 ? e + 8 : tiff + u32(e + 8);
      map.set(u16(e), { type, count, off });
    }
    return map;
  };

  const getAscii = (m: Map<number, IfdEntry>, tag: number) => {
    const en = m.get(tag);
    return en && en.type === 2 ? ascii(en.off, en.count) || undefined : undefined;
  };
  const getInt = (m: Map<number, IfdEntry>, tag: number) => {
    const en = m.get(tag);
    if (!en) return undefined;
    return en.type === 3 ? u16(en.off) : u32(en.off);
  };
  const getRat = (m: Map<number, IfdEntry>, tag: number) => {
    const en = m.get(tag);
    if (!en) return undefined;
    const v = rational(en.off, en.type === 10);
    return isFinite(v) ? v : undefined;
  };
  const ptr = (m: Map<number, IfdEntry>, tag: number) => {
    const en = m.get(tag);
    return en ? u32(en.off) : undefined;
  };

  const ifd0 = readIFD(tiff + u32(tiff + 4));
  meta.make = getAscii(ifd0, 0x010f) || meta.make;
  meta.model = getAscii(ifd0, 0x0110) || meta.model;
  meta.software = getAscii(ifd0, 0x0131) || meta.software;
  const orient = getInt(ifd0, 0x0112);
  if (orient) meta.orientation = orient;
  let dateRaw = getAscii(ifd0, 0x0132);

  const exifOff = ptr(ifd0, 0x8769);
  if (exifOff != null) {
    const ex = readIFD(tiff + exifOff);
    dateRaw = getAscii(ex, 0x9003) || dateRaw; // DateTimeOriginal
    const exp = getRat(ex, 0x829a);
    if (exp != null) meta.exposure = formatExposure(exp);
    const fn = getRat(ex, 0x829d);
    if (fn != null) meta.fNumber = "f/" + trim(fn);
    const iso = getInt(ex, 0x8827);
    if (iso) meta.iso = iso;
    const fl = getRat(ex, 0x920a);
    if (fl != null) meta.focalLength = Math.round(fl) + " mm";
    meta.lens = getAscii(ex, 0xa434) || meta.lens;
    if (!meta.width) {
      const w = getInt(ex, 0xa002);
      if (w) meta.width = w;
    }
    if (!meta.height) {
      const h = getInt(ex, 0xa003);
      if (h) meta.height = h;
    }
  }
  if (dateRaw) meta.dateTaken = formatExifDate(dateRaw);

  const gpsOff = ptr(ifd0, 0x8825);
  if (gpsOff != null) {
    const gps = readIFD(tiff + gpsOff);
    const ref = (tag: number) => {
      const en = gps.get(tag);
      return en ? String.fromCharCode(view.getUint8(en.off)) : undefined;
    };
    const triple = (tag: number) => {
      const en = gps.get(tag);
      if (!en || en.count < 3) return null;
      return [rational(en.off, false), rational(en.off + 8, false), rational(en.off + 16, false)];
    };
    const lat = triple(0x0002);
    const lon = triple(0x0004);
    if (lat && lon) {
      let dlat = lat[0] + lat[1] / 60 + lat[2] / 3600;
      let dlon = lon[0] + lon[1] / 60 + lon[2] / 3600;
      if (ref(0x0001) === "S") dlat = -dlat;
      if (ref(0x0003) === "W") dlon = -dlon;
      if (
        isFinite(dlat) && isFinite(dlon) && !(dlat === 0 && dlon === 0) &&
        Math.abs(dlat) <= 90 && Math.abs(dlon) <= 180
      ) {
        meta.gps = { lat: dlat, lon: dlon };
      }
    }
  }
}

function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function formatExposure(sec: number): string {
  if (sec <= 0) return "";
  if (sec < 1) return "1/" + Math.round(1 / sec) + " s";
  return trim(sec) + " s";
}

// EXIF dates are "YYYY:MM:DD HH:MM:SS". Render them more readably.
function formatExifDate(raw: string): string {
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return raw;
  const [, y, mo, d, h, mi] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (isNaN(dt.getTime())) return raw;
  return dt.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/** Back-compat: GPS-only reader used by older callers. */
export function readJpegGps(buf: ArrayBuffer): GpsCoord | null {
  return readImageMeta(buf).gps ?? null;
}
