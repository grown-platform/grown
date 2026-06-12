/*
 * dummyRecording.ts — synthesizes a real, playable/downloadable call-recording
 * WAV for the demo PBX (no backend audio store). Output is 8 kHz mono 16-bit
 * PCM, the classic telephony recording format, so the file size lines up with
 * what a real call would produce and it plays in every browser.
 *
 * The audio is deterministic per (seconds, seed): alternating "talk spurts"
 * between two parties over faint line noise, so it sounds like a muffled phone
 * call rather than a test tone — without being grating.
 */

const SAMPLE_RATE = 8000; // Hz — narrowband telephony

/** Parse "mm:ss" (or "hh:mm:ss") into seconds. */
export function durationToSeconds(d: string): number {
  const parts = d.split(":").map((p) => parseInt(p, 10) || 0);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Byte size a recording of the given duration will occupy (WAV header + PCM). */
export function recordingBytes(seconds: number): number {
  return 44 + Math.floor(seconds * SAMPLE_RATE) * 2;
}

/** Human-readable size string, matching the rest of the admin UI. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// Small deterministic PRNG (mulberry32) so each row sounds stable across renders.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synth(seconds: number, seed: number): Int16Array {
  const n = Math.max(1, Math.floor(seconds * SAMPLE_RATE));
  const out = new Int16Array(n);
  const rnd = mulberry32(seed);
  let t = 0;
  while (t < n) {
    const speaking = rnd() > 0.35;
    const segLen = Math.floor((0.4 + rnd() * 1.8) * SAMPLE_RATE);
    if (speaking) {
      const f0 = 110 + rnd() * 80; // pitch of this "party"
      const syl = 3 + rnd() * 3; // syllable rate (Hz)
      for (let i = 0; i < segLen && t < n; i++, t++) {
        const tt = i / SAMPLE_RATE;
        const env = Math.max(0, Math.sin(2 * Math.PI * syl * tt)); // syllables
        const v =
          Math.sin(2 * Math.PI * f0 * tt) * 0.6 +
          Math.sin(2 * Math.PI * f0 * 2 * tt) * 0.25 +
          (rnd() * 2 - 1) * 0.15; // breath noise
        out[t] = Math.round(Math.max(-1, Math.min(1, v * env * 0.28)) * 0.9 * 32767);
      }
    } else {
      for (let i = 0; i < segLen && t < n; i++, t++) {
        out[t] = Math.round((rnd() * 2 - 1) * 0.015 * 32767); // faint gap noise
      }
    }
  }
  return out;
}

function encodeWav(samples: Int16Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(buf);
  let p = 0;
  const u16 = (v: number) => {
    dv.setUint16(p, v, true);
    p += 2;
  };
  const u32 = (v: number) => {
    dv.setUint32(p, v, true);
    p += 4;
  };
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(p++, s.charCodeAt(i));
  };
  str("RIFF");
  u32(36 + samples.length * 2);
  str("WAVE");
  str("fmt ");
  u32(16);
  u16(1); // PCM
  u16(1); // mono
  u32(sampleRate);
  u32(sampleRate * 2); // byte rate
  u16(2); // block align
  u16(16); // bits per sample
  str("data");
  u32(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    dv.setInt16(p, samples[i], true);
    p += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** Build a playable/downloadable WAV blob for a recording of the given length. */
export function makeRecordingWav(seconds: number, seed: number): Blob {
  return encodeWav(synth(seconds, seed), SAMPLE_RATE);
}

/** Trigger a browser download of a blob under the given filename. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
