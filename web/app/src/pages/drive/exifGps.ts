// Minimal, dependency-free EXIF GPS reader for JPEG images. Parses the APP1
// (Exif) segment's GPS IFD to recover latitude/longitude in decimal degrees.
// Returns null when there is no usable GPS metadata (the common case for
// non-JPEG, screenshots, or stripped photos).

export interface GpsCoord {
  lat: number;
  lon: number;
}

export function readJpegGps(buf: ArrayBuffer): GpsCoord | null {
  try {
    const view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG (SOI)

    // Walk JPEG marker segments to find APP1 (0xFFE1) starting with "Exif\0\0".
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break;
      const size = view.getUint16(offset + 2);
      if (size < 2) break;
      if (marker === 0xffe1) {
        const exif = offset + 4;
        if (
          exif + 6 <= view.byteLength &&
          view.getUint32(exif) === 0x45786966 && // "Exif"
          view.getUint16(exif + 4) === 0x0000
        ) {
          return parseTiffGps(view, exif + 6);
        }
      }
      offset += 2 + size;
    }
  } catch {
    /* malformed/truncated — treat as no GPS */
  }
  return null;
}

function parseTiffGps(view: DataView, tiff: number): GpsCoord | null {
  if (tiff + 8 > view.byteLength) return null;
  const le = view.getUint16(tiff) === 0x4949; // "II" little-endian, "MM" big-endian
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);

  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > view.byteLength) return null;

  // Find the GPS IFD pointer (tag 0x8825) within IFD0.
  let gpsOff: number | null = null;
  const n0 = u16(ifd0);
  for (let i = 0; i < n0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > view.byteLength) break;
    if (u16(e) === 0x8825) {
      gpsOff = u32(e + 8);
      break;
    }
  }
  if (gpsOff == null) return null;
  const gps = tiff + gpsOff;
  if (gps + 2 > view.byteLength) return null;

  const rat3 = (off: number): number[] | null => {
    if (off + 24 > view.byteLength) return null;
    const r = (o: number) => {
      const den = u32(o + 4);
      return den ? u32(o) / den : 0;
    };
    return [r(off), r(off + 8), r(off + 16)];
  };

  let latRef = "N";
  let lonRef = "E";
  let lat: number[] | null = null;
  let lon: number[] | null = null;
  const ng = u16(gps);
  for (let i = 0; i < ng; i++) {
    const e = gps + 2 + i * 12;
    if (e + 12 > view.byteLength) break;
    const tag = u16(e);
    if (tag === 0x0001) latRef = String.fromCharCode(view.getUint8(e + 8));
    else if (tag === 0x0003) lonRef = String.fromCharCode(view.getUint8(e + 8));
    else if (tag === 0x0002) lat = rat3(tiff + u32(e + 8));
    else if (tag === 0x0004) lon = rat3(tiff + u32(e + 8));
  }
  if (!lat || !lon) return null;

  let dlat = lat[0] + lat[1] / 60 + lat[2] / 3600;
  let dlon = lon[0] + lon[1] / 60 + lon[2] / 3600;
  if (latRef === "S") dlat = -dlat;
  if (lonRef === "W") dlon = -dlon;
  if (!isFinite(dlat) || !isFinite(dlon) || (dlat === 0 && dlon === 0)) return null;
  if (Math.abs(dlat) > 90 || Math.abs(dlon) > 180) return null;
  return { lat: dlat, lon: dlon };
}
