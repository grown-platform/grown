// SHA-512 (FIPS 180-4), synchronous, for OOXML password hashes (Docs M10:
// w:documentProtection hashes a password with a salt and runs the hash
// again 100,000 times; Web Crypto's async digest per round would be far
// slower than hashing in place). The round constants are derived at load
// time from their definition (fractional parts of cube / square roots of
// the first primes), so no table is transcribed by hand.

const MASK64 = (1n << 64n) - 1n;

function primes(n: number): number[] {
  const out: number[] = [];
  for (let c = 2; out.length < n; c++) if (out.every((p) => c % p !== 0)) out.push(c);
  return out;
}

/** floor(n^(1/k)) for bigint n (k = 2 or 3). */
function iroot(n: bigint, k: bigint): bigint {
  let x = BigInt(Math.floor(Math.pow(Number(n), 1 / Number(k))));
  const f = (y: bigint) => y ** k;
  // Newton steps, then settle exactly.
  for (let i = 0; i < 60; i++) {
    if (x <= 0n) x = 1n;
    const next = ((k - 1n) * x + n / x ** (k - 1n)) / k;
    if (next === x) break;
    x = next;
  }
  while (f(x) > n) x--;
  while (f(x + 1n) <= n) x++;
  return x;
}

const P = primes(80);
const K = new Uint32Array(160);
P.forEach((p, i) => {
  const v = iroot(BigInt(p) << 192n, 3n) & MASK64;
  K[2 * i] = Number(v >> 32n);
  K[2 * i + 1] = Number(v & 0xffffffffn);
});
const H0 = new Uint32Array(16);
P.slice(0, 8).forEach((p, i) => {
  const v = iroot(BigInt(p) << 128n, 2n) & MASK64;
  H0[2 * i] = Number(v >> 32n);
  H0[2 * i + 1] = Number(v & 0xffffffffn);
});

const W = new Uint32Array(160);

function compress(H: Uint32Array, block: Uint8Array, off: number): void {
  for (let i = 0; i < 32; i++) {
    const j = off + i * 4;
    W[i] = ((block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3]) >>> 0;
  }
  for (let i = 16; i < 80; i++) {
    // σ0(W[i-15]) = rotr1 ^ rotr8 ^ shr7
    let xh = W[2 * (i - 15)];
    let xl = W[2 * (i - 15) + 1];
    const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
    const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
    // σ1(W[i-2]) = rotr19 ^ rotr61 ^ shr6
    xh = W[2 * (i - 2)];
    xl = W[2 * (i - 2) + 1];
    const s1h = ((xh >>> 19) | (xl << 13)) ^ ((xl >>> 29) | (xh << 3)) ^ (xh >>> 6);
    const s1l = ((xl >>> 19) | (xh << 13)) ^ ((xh >>> 29) | (xl << 3)) ^ ((xl >>> 6) | (xh << 26));
    let lo = (s0l >>> 0) + (s1l >>> 0) + W[2 * (i - 7) + 1] + W[2 * (i - 16) + 1];
    const hi = s0h + s1h + W[2 * (i - 7)] + W[2 * (i - 16)] + Math.floor(lo / 0x100000000);
    lo >>>= 0;
    W[2 * i] = hi >>> 0;
    W[2 * i + 1] = lo;
  }
  let ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7];
  let eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];
  for (let i = 0; i < 80; i++) {
    // Σ1(e) = rotr14 ^ rotr18 ^ rotr41
    const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
    const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
    const chh = (eh & fh) ^ (~eh & gh);
    const chl = (el & fl) ^ (~el & gl);
    let t1l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + K[2 * i + 1] + W[2 * i + 1];
    let t1h = hh + S1h + chh + K[2 * i] + W[2 * i] + Math.floor(t1l / 0x100000000);
    t1l >>>= 0;
    t1h >>>= 0;
    // Σ0(a) = rotr28 ^ rotr34 ^ rotr39
    const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
    const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
    const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
    const mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
    let t2l = (S0l >>> 0) + (mjl >>> 0);
    const t2h = (S0h + mjh + Math.floor(t2l / 0x100000000)) >>> 0;
    t2l >>>= 0;
    hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
    let nl = (dl >>> 0) + t1l;
    eh = (dh + t1h + Math.floor(nl / 0x100000000)) >>> 0;
    el = nl >>> 0;
    dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
    nl = t1l + t2l;
    ah = (t1h + t2h + Math.floor(nl / 0x100000000)) >>> 0;
    al = nl >>> 0;
  }
  const add = (i: number, h: number, l: number) => {
    const lo = H[i + 1] + (l >>> 0);
    H[i] = (H[i] + h + Math.floor(lo / 0x100000000)) >>> 0;
    H[i + 1] = lo >>> 0;
  };
  add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl);
  add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
}

/** sha512 of bytes. */
export function sha512(data: Uint8Array): Uint8Array {
  const H = H0.slice();
  const len = data.length;
  const full = Math.floor(len / 128) * 128;
  for (let off = 0; off < full; off += 128) compress(H, data, off);
  const restLen = len - full;
  const padLen = restLen < 112 ? 128 : 256;
  const tail = new Uint8Array(padLen);
  tail.set(data.subarray(full));
  tail[restLen] = 0x80;
  const bits = len * 8;
  const dv = new DataView(tail.buffer);
  dv.setUint32(padLen - 4, bits >>> 0);
  dv.setUint32(padLen - 8, Math.floor(bits / 0x100000000));
  for (let off = 0; off < padLen; off += 128) compress(H, tail, off);
  const out = new Uint8Array(64);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
