/**
 * Minimal ZIP reader for the books reader (EPUB + CBZ are ZIP containers).
 *
 * Parses the End-of-Central-Directory record and the central directory, then
 * extracts entries. Supports STORE (method 0) and DEFLATE (method 8); DEFLATE
 * is inflated with the browser-native DecompressionStream("deflate-raw").
 * This avoids pulling in a third-party zip dependency for a best-effort viewer.
 */

export interface ZipEntry {
  name: string;
  /** offset of the local file header within the archive */
  headerOffset: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

export class ZipArchive {
  private view: DataView;
  private bytes: Uint8Array;
  readonly entries: ZipEntry[];

  constructor(buf: ArrayBuffer) {
    this.bytes = new Uint8Array(buf);
    this.view = new DataView(buf);
    this.entries = this.readCentralDirectory();
  }

  private readCentralDirectory(): ZipEntry[] {
    const len = this.view.byteLength;
    // EOCD is at the end; scan backwards over the (optional) comment.
    let eocd = -1;
    const minEocd = 22;
    for (let i = len - minEocd; i >= 0 && i >= len - minEocd - 0x10000; i--) {
      if (this.view.getUint32(i, true) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("not a zip archive (no EOCD)");
    const count = this.view.getUint16(eocd + 10, true);
    let off = this.view.getUint32(eocd + 16, true);
    const out: ZipEntry[] = [];
    for (let i = 0; i < count; i++) {
      if (this.view.getUint32(off, true) !== CEN_SIG) break;
      const method = this.view.getUint16(off + 10, true);
      const compSize = this.view.getUint32(off + 20, true);
      const uncompSize = this.view.getUint32(off + 24, true);
      const nameLen = this.view.getUint16(off + 28, true);
      const extraLen = this.view.getUint16(off + 30, true);
      const commentLen = this.view.getUint16(off + 32, true);
      const headerOffset = this.view.getUint32(off + 42, true);
      const name = new TextDecoder().decode(
        this.bytes.subarray(off + 46, off + 46 + nameLen),
      );
      out.push({
        name,
        headerOffset,
        compressionMethod: method,
        compressedSize: compSize,
        uncompressedSize: uncompSize,
      });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  has(name: string): boolean {
    return this.entries.some((e) => e.name === name);
  }

  get(name: string): ZipEntry | undefined {
    return this.entries.find((e) => e.name === name);
  }

  async readBytes(entry: ZipEntry): Promise<Uint8Array> {
    // Local file header: 30 bytes fixed + name + extra (lengths re-read here,
    // central-directory extra length can differ from the local one).
    const h = entry.headerOffset;
    const nameLen = this.view.getUint16(h + 26, true);
    const extraLen = this.view.getUint16(h + 28, true);
    const dataStart = h + 30 + nameLen + extraLen;
    const comp = this.bytes.subarray(
      dataStart,
      dataStart + entry.compressedSize,
    );
    if (entry.compressionMethod === 0) {
      return comp;
    }
    if (entry.compressionMethod === 8) {
      const ds = new DecompressionStream("deflate-raw");
      const stream = new Blob([bytesToBlobPart(comp)]).stream().pipeThrough(ds);
      const ab = await new Response(stream).arrayBuffer();
      return new Uint8Array(ab);
    }
    throw new Error(
      `unsupported compression method ${entry.compressionMethod}`,
    );
  }

  async readText(entry: ZipEntry): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(entry));
  }
}

/**
 * bytesToBlobPart returns a Blob-safe view of a Uint8Array. TS's DOM lib types
 * reject Uint8Array<ArrayBufferLike> as a BlobPart (SharedArrayBuffer concern);
 * copying into a fresh ArrayBuffer-backed array sidesteps that without unsafe
 * casts and guarantees the bytes are detached from any shared buffer.
 */
export function bytesToBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export async function loadZip(url: string): Promise<ZipArchive> {
  const resp = await fetch(url, { credentials: "same-origin" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return new ZipArchive(await resp.arrayBuffer());
}
