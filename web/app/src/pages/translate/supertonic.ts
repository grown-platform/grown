/**
 * Supertonic — on-device multilingual text-to-speech.
 *
 * This is a faithful TypeScript port of the official Supertonic web example
 * (https://github.com/supertone-inc/supertonic, `web/helper.js`), wired to run
 * entirely client-side via onnxruntime-web. The pipeline is a flow-matching TTS:
 *
 *   text → UnicodeProcessor (codepoint indexer)
 *        → duration_predictor.onnx   (how long the speech should be)
 *        → text_encoder.onnx         (text embeddings)
 *        → vector_estimator.onnx     (iterative denoising, `totalStep` passes)
 *        → vocoder.onnx              (latent → 44.1 kHz waveform)
 *        → 16-bit PCM WAV
 *
 * Model assets (~398 MB across 4 ONNX files + 2 JSON) are NOT vendored into the
 * repo — that would bloat it and the build. Instead they're fetched at runtime
 * from the official Hugging Face Hub repo (Supertone/supertonic-3) on first
 * Speak. We route every model/config/voice/WASM fetch through the **Cache API**
 * (see `cachedFetch`) so the first Speak downloads + stores them indefinitely
 * and every later run — including fully offline — loads from Cache Storage. The
 * ONNX `InferenceSession`s are created from the cached `ArrayBuffer`s rather
 * than from a URL, so onnxruntime never re-fetches them. Execution prefers
 * WebGPU and falls back to WASM; onnxruntime-web's WASM binaries are loaded from
 * the jsDelivr CDN (and likewise cached) so they don't enter our Vite bundle.
 *
 * Everything here is loaded behind a dynamic import in the page, so none of
 * onnxruntime-web lands in the main app bundle.
 */
import * as ort from "onnxruntime-web";

// Where the model + config assets live. Override with VITE_SUPERTONIC_URL to
// self-host them (e.g. copy the HF `onnx/` and `voice_styles/` dirs under a
// path you serve). `resolve` on the Hub returns the raw LFS bytes.
const ASSET_BASE =
  (import.meta.env.VITE_SUPERTONIC_URL as string | undefined) ||
  "https://huggingface.co/Supertone/supertonic-3/resolve/main";
const ONNX_DIR = `${ASSET_BASE}/onnx`;

/**
 * The 10 voice styles published in the Supertone/supertonic-3 repo under
 * `voice_styles/{id}.json`. Each is a tiny JSON style vector; the heavy ONNX
 * models are shared across all voices. `M1` is the default. The URL for a given
 * voice is `${ASSET_BASE}/voice_styles/${voiceId}.json`.
 */
export const SUPERTONIC_VOICES = [
  { id: "F1", label: "Female 1 (F1)" },
  { id: "F2", label: "Female 2 (F2)" },
  { id: "F3", label: "Female 3 (F3)" },
  { id: "F4", label: "Female 4 (F4)" },
  { id: "F5", label: "Female 5 (F5)" },
  { id: "M1", label: "Male 1 (M1)" },
  { id: "M2", label: "Male 2 (M2)" },
  { id: "M3", label: "Male 3 (M3)" },
  { id: "M4", label: "Male 4 (M4)" },
  { id: "M5", label: "Male 5 (M5)" },
] as const;

export type SupertonicVoiceId = (typeof SUPERTONIC_VOICES)[number]["id"];

export const DEFAULT_VOICE_ID: SupertonicVoiceId = "M1";

const VALID_VOICE_IDS = new Set<string>(SUPERTONIC_VOICES.map((v) => v.id));

/** Build the cache-keyed URL for a voice style JSON, validating the id. */
function voiceStyleUrl(voiceId: string): string {
  const id = VALID_VOICE_IDS.has(voiceId) ? voiceId : DEFAULT_VOICE_ID;
  return `${ASSET_BASE}/voice_styles/${id}.json`;
}

// ---------------------------------------------------------------------------
// Indefinite, offline-first caching via the Cache API
// ---------------------------------------------------------------------------
//
// The Supertonic assets (~398 MB of ONNX + small JSON configs) plus the
// onnxruntime-web WASM binaries are large and never change for a given model
// version, so we store them in Cache Storage forever. The cache is cache-first
// (serve a stored Response if present), put-on-miss (download once, then keep),
// and never evicted by us — so after the first Speak everything loads from disk
// and the feature works fully offline.
//
// The name is *versioned but persistent*: bump the `-v1` suffix to intentionally
// invalidate (e.g. when the model repo changes), but nothing here ever expires
// it. Combined with the transformers.js NLLB model (~600 MB, cached separately
// by the library in its own `transformers-cache`), the Translate app keeps
// roughly ~1 GB in Cache Storage once both translation + TTS are warmed up. The
// browser may still evict caches under storage pressure unless persistent
// storage is granted, so on the first successful cache we request
// `navigator.storage.persist()` (best-effort) to ask the browser to keep it.
const CACHE_NAME = "supertonic-models-v1";

let persistRequested = false;
function requestPersistentStorage(): void {
  if (persistRequested) return;
  persistRequested = true;
  // Best-effort: ask the browser to exempt our ~1 GB of model caches from
  // eviction. Ignored if unsupported or denied — caching still works either way.
  void navigator.storage?.persist?.().catch(() => {});
}

/**
 * Cache-first fetch backed by a single, indefinitely-kept Cache. On a hit we
 * return the stored Response; on a miss we fetch, store a clone, and return it.
 * Falls back to a plain `fetch` if the Cache API is unavailable.
 */
async function cachedFetch(url: string): Promise<Response> {
  if (typeof caches === "undefined") return fetch(url);
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (res.ok) {
    // Store a clone (the body can only be consumed once) and keep it forever.
    await cache.put(url, res.clone());
    requestPersistentStorage();
  }
  return res;
}

// onnxruntime-web ships its WASM/threading binaries separately; point at a CDN
// matching the installed version so we don't have to copy them into public/.
const WASM_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
ort.env.wasm.wasmPaths = WASM_BASE;

// Route onnxruntime's own WASM binary requests through our indefinite cache so
// the runtime itself works offline after the first run. ORT fetches its .wasm
// (and .mjs) files relative to `wasmPaths`; we intercept those by overriding the
// global fetch ORT uses, restricted to the jsDelivr ORT path so nothing else is
// affected. This is installed once, lazily, when models first load.
let wasmFetchPatched = false;
function patchOrtWasmFetch(): void {
  if (wasmFetchPatched || typeof window === "undefined") return;
  wasmFetchPatched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const u =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (typeof u === "string" && u.startsWith(WASM_BASE)) {
      return cachedFetch(u);
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof window.fetch;
}

/** The 32 language tags Supertonic accepts (`na` = language-agnostic). */
export const SUPERTONIC_LANGS = new Set([
  "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi",
  "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro",
  "ru", "sk", "sl", "sv", "tr", "uk", "vi", "na",
]);

export function supertonicSupportsLang(lang: string): boolean {
  return SUPERTONIC_LANGS.has(lang);
}

/**
 * Whether the Supertonic model files are already in Cache Storage, i.e. a Speak
 * will run fully offline without re-downloading. We probe the largest asset (the
 * vector estimator) as a proxy for "the model set has been cached". Best-effort:
 * returns false if the Cache API is unavailable.
 */
export async function supertonicModelsCached(): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(`${ONNX_DIR}/vector_estimator.onnx`);
    return hit != null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Config / voice-style shapes (subset of the JSON we read)
// ---------------------------------------------------------------------------

interface Cfgs {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
}

interface VoiceStyleJSON {
  style_ttl: { dims: number[]; data: unknown };
  style_dp: { dims: number[]; data: unknown };
}

class Style {
  constructor(
    public ttl: ort.Tensor,
    public dp: ort.Tensor,
  ) {}
}

// ---------------------------------------------------------------------------
// Text preprocessing (UnicodeProcessor) — ports helper.js verbatim
// ---------------------------------------------------------------------------

class UnicodeProcessor {
  constructor(private indexer: number[]) {}

  call(textList: string[], langList: string[]) {
    const processed = textList.map((t, i) => this.preprocess(t, langList[i]));
    const lengths = processed.map((t) => t.length);
    const maxLen = Math.max(...lengths);

    const textIds = processed.map((text) => {
      const row = new Array<number>(maxLen).fill(0);
      for (let j = 0; j < text.length; j++) {
        const cp = text.codePointAt(j)!;
        row[j] = cp < this.indexer.length ? this.indexer[cp] : -1;
      }
      return row;
    });

    const textMask = lengthToMask(lengths, maxLen);
    return { textIds, textMask };
  }

  private preprocess(text: string, lang: string): string {
    text = text.normalize("NFKD");

    // Strip emoji (wide unicode ranges).
    const emoji =
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
    text = text.replace(emoji, "");

    const replacements: Record<string, string> = {
      "–": "-", "‑": "-", "—": "-", "_": " ",
      "“": '"', "”": '"', "‘": "'", "’": "'",
      "´": "'", "`": "'", "[": " ", "]": " ", "|": " ",
      "/": " ", "#": " ", "→": " ", "←": " ",
    };
    for (const [k, v] of Object.entries(replacements)) text = text.replaceAll(k, v);

    text = text.replace(/[♥☆♡©\\]/g, "");

    const exprs: Record<string, string> = {
      "@": " at ", "e.g.,": "for example, ", "i.e.,": "that is, ",
    };
    for (const [k, v] of Object.entries(exprs)) text = text.replaceAll(k, v);

    text = text
      .replace(/ ,/g, ",").replace(/ \./g, ".").replace(/ !/g, "!")
      .replace(/ \?/g, "?").replace(/ ;/g, ";").replace(/ :/g, ":")
      .replace(/ '/g, "'");

    while (text.includes('""')) text = text.replace('""', '"');
    while (text.includes("''")) text = text.replace("''", "'");
    while (text.includes("``")) text = text.replace("``", "`");

    text = text.replace(/\s+/g, " ").trim();

    // Ensure trailing punctuation.
    if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(text)) {
      text += ".";
    }

    if (!SUPERTONIC_LANGS.has(lang)) {
      throw new Error(`Unsupported Supertonic language: ${lang}`);
    }
    return `<${lang}>${text}</${lang}>`;
  }
}

/** lengths → [bsz][1][maxLen] float mask of 1.0 (real token) / 0.0 (pad). */
function lengthToMask(lengths: number[], maxLen: number): number[][][] {
  return lengths.map((len) => {
    const row = new Array<number>(maxLen).fill(0);
    for (let j = 0; j < Math.min(len, maxLen); j++) row[j] = 1.0;
    return [row];
  });
}

// ---------------------------------------------------------------------------
// TextToSpeech engine
// ---------------------------------------------------------------------------

export type DenoiseProgress = (step: number, total: number) => void;

class TextToSpeech {
  readonly sampleRate: number;

  constructor(
    private cfgs: Cfgs,
    private textProcessor: UnicodeProcessor,
    private dpOrt: ort.InferenceSession,
    private textEncOrt: ort.InferenceSession,
    private vectorEstOrt: ort.InferenceSession,
    private vocoderOrt: ort.InferenceSession,
  ) {
    this.sampleRate = cfgs.ae.sample_rate;
  }

  /** Synthesise `text` (single chunk) into a float waveform + duration. */
  private async infer(
    textList: string[],
    langList: string[],
    style: Style,
    totalStep: number,
    speed: number,
    onStep?: DenoiseProgress,
  ): Promise<{ wav: number[]; duration: number[] }> {
    const bsz = textList.length;
    const { textIds, textMask } = this.textProcessor.call(textList, langList);

    const textIdsTensor = new ort.Tensor(
      "int64",
      BigInt64Array.from(textIds.flat().map((x) => BigInt(x))),
      [bsz, textIds[0].length],
    );
    const textMaskTensor = new ort.Tensor(
      "float32",
      Float32Array.from(textMask.flat(2) as number[]),
      [bsz, 1, textMask[0][0].length],
    );

    // 1) Duration prediction (scaled by speed).
    const dpOut = await this.dpOrt.run({
      text_ids: textIdsTensor,
      style_dp: style.dp,
      text_mask: textMaskTensor,
    });
    const duration = Array.from(dpOut.duration.data as Float32Array).map(
      (d) => d / speed,
    );

    // 2) Text encoding.
    const textEncOut = await this.textEncOrt.run({
      text_ids: textIdsTensor,
      style_ttl: style.ttl,
      text_mask: textMaskTensor,
    });
    const textEmb = textEncOut.text_emb;

    // 3) Sample the initial noisy latent, masked to the predicted length.
    let { xt, latentMask } = this.sampleNoisyLatent(duration);
    const latentMaskTensor = new ort.Tensor(
      "float32",
      Float32Array.from(latentMask.flat(2) as number[]),
      [bsz, 1, latentMask[0][0].length],
    );
    const totalStepTensor = new ort.Tensor(
      "float32",
      new Float32Array(bsz).fill(totalStep),
      [bsz],
    );

    // 4) Iterative denoising (flow-matching).
    for (let step = 0; step < totalStep; step++) {
      onStep?.(step + 1, totalStep);

      const currentStepTensor = new ort.Tensor(
        "float32",
        new Float32Array(bsz).fill(step),
        [bsz],
      );
      const xtTensor = new ort.Tensor(
        "float32",
        Float32Array.from(xt.flat(2) as number[]),
        [bsz, xt[0].length, xt[0][0].length],
      );

      const veOut = await this.vectorEstOrt.run({
        noisy_latent: xtTensor,
        text_emb: textEmb,
        style_ttl: style.ttl,
        latent_mask: latentMaskTensor,
        text_mask: textMaskTensor,
        current_step: currentStepTensor,
        total_step: totalStepTensor,
      });

      // Reshape the flat denoised output back to [bsz][dim][len].
      const denoised = veOut.denoised_latent.data as Float32Array;
      const latentDim = xt[0].length;
      const latentLen = xt[0][0].length;
      const next: number[][][] = [];
      let idx = 0;
      for (let b = 0; b < bsz; b++) {
        const batch: number[][] = [];
        for (let d = 0; d < latentDim; d++) {
          const row: number[] = [];
          for (let t = 0; t < latentLen; t++) row.push(denoised[idx++]);
          batch.push(row);
        }
        next.push(batch);
      }
      xt = next;
    }

    // 5) Vocode the final latent into a waveform.
    const finalTensor = new ort.Tensor(
      "float32",
      Float32Array.from(xt.flat(2) as number[]),
      [bsz, xt[0].length, xt[0][0].length],
    );
    const vocOut = await this.vocoderOrt.run({ latent: finalTensor });
    const wav = Array.from(vocOut.wav_tts.data as Float32Array);

    return { wav, duration };
  }

  /** Public entry: chunk long text, synthesise each, join with short silences. */
  async call(
    text: string,
    lang: string,
    style: Style,
    totalStep: number,
    speed = 1.05,
    silenceDuration = 0.3,
    onStep?: DenoiseProgress,
  ): Promise<{ wav: number[]; duration: number[] }> {
    if (style.ttl.dims[0] !== 1) {
      throw new Error("Single-speaker TTS supports a single style only.");
    }
    const maxLen = lang === "ko" || lang === "ja" ? 120 : 300;
    const textList = chunkText(text, maxLen);
    const langList = new Array(textList.length).fill(lang);

    let wavCat: number[] = [];
    let durCat = 0;
    for (let i = 0; i < textList.length; i++) {
      const { wav, duration } = await this.infer(
        [textList[i]], [langList[i]], style, totalStep, speed, onStep,
      );
      if (wavCat.length === 0) {
        wavCat = wav;
        durCat = duration[0];
      } else {
        const silence = new Array<number>(
          Math.floor(silenceDuration * this.sampleRate),
        ).fill(0);
        wavCat = [...wavCat, ...silence, ...wav];
        durCat += duration[0] + silenceDuration;
      }
    }
    return { wav: wavCat, duration: [durCat] };
  }

  private sampleNoisyLatent(duration: number[]) {
    const { base_chunk_size } = this.cfgs.ae;
    const { chunk_compress_factor, latent_dim } = this.cfgs.ttl;
    const bsz = duration.length;
    const maxDur = Math.max(...duration);

    const wavLenMax = Math.floor(maxDur * this.sampleRate);
    const wavLengths = duration.map((d) => Math.floor(d * this.sampleRate));

    const chunkSize = base_chunk_size * chunk_compress_factor;
    const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
    const latentDimVal = latent_dim * chunk_compress_factor;

    // Gaussian noise via Box–Muller.
    const xt: number[][][] = [];
    for (let b = 0; b < bsz; b++) {
      const batch: number[][] = [];
      for (let d = 0; d < latentDimVal; d++) {
        const row: number[] = [];
        for (let t = 0; t < latentLen; t++) {
          const u1 = Math.max(0.0001, Math.random());
          const u2 = Math.random();
          row.push(Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2));
        }
        batch.push(row);
      }
      xt.push(batch);
    }

    const latentLengths = wavLengths.map((len) =>
      Math.floor((len + chunkSize - 1) / chunkSize),
    );
    const latentMask = lengthToMask(latentLengths, latentLen);

    for (let b = 0; b < bsz; b++)
      for (let d = 0; d < latentDimVal; d++)
        for (let t = 0; t < latentLen; t++) xt[b][d][t] *= latentMask[b][0][t];

    return { xt, latentMask };
  }
}

/** Split text into <= maxLen sentence-aligned chunks. */
function chunkText(text: string, maxLen = 300): string[] {
  const paragraphs = text.trim().split(/\n\s*\n+/).filter((p) => p.trim());
  const chunks: string[] = [];
  for (let paragraph of paragraphs) {
    paragraph = paragraph.trim();
    if (!paragraph) continue;
    const sentences = paragraph.split(
      /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/,
    );
    let current = "";
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 <= maxLen) {
        current += (current ? " " : "") + sentence;
      } else {
        if (current) chunks.push(current.trim());
        current = sentence;
      }
    }
    if (current) chunks.push(current.trim());
  }
  // Guard against empty input producing zero chunks.
  return chunks.length ? chunks : [text.trim()];
}

/** Encode a float waveform as a 16-bit PCM WAV ArrayBuffer. */
export function writeWavFile(audioData: number[], sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = audioData.length * 2;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const int16 = new Int16Array(audioData.length);
  for (let i = 0; i < audioData.length; i++) {
    const c = Math.max(-1.0, Math.min(1.0, audioData[i]));
    int16[i] = Math.floor(c * 32767);
  }
  new Uint8Array(buffer, 44).set(new Uint8Array(int16.buffer));
  return buffer;
}

// ---------------------------------------------------------------------------
// Loading + a small module-level engine cache
// ---------------------------------------------------------------------------

export type LoadProgress = (message: string) => void;

async function loadJSON<T>(url: string): Promise<T> {
  const res = await cachedFetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} failed (${res.status})`);
  return (await res.json()) as T;
}

/** Cache-first fetch of a model file as bytes for InferenceSession.create(). */
async function loadModelBytes(url: string): Promise<Uint8Array> {
  const res = await cachedFetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadStyle(url: string): Promise<Style> {
  const s = await loadJSON<VoiceStyleJSON>(url);
  const ttlData = Float32Array.from(
    (s.style_ttl.data as number[]).flat(Infinity as 1),
  );
  const dpData = Float32Array.from(
    (s.style_dp.data as number[]).flat(Infinity as 1),
  );
  return new Style(
    new ort.Tensor("float32", ttlData, s.style_ttl.dims),
    new ort.Tensor("float32", dpData, s.style_dp.dims),
  );
}

/**
 * A ready-to-use engine: the TTS pipeline (shared ONNX models) and the backend.
 * Voice styles are loaded lazily per voice id and memoised here, so switching
 * voice only fetches+caches that one small JSON — see `getStyle`.
 */
export interface SupertonicEngine {
  tts: TextToSpeech;
  backend: "webgpu" | "wasm";
  /** Load (and cache) the Style for `voiceId`, memoised per engine. */
  getStyle: (voiceId: string) => Promise<Style>;
}

/**
 * Which onnxruntime execution backend to use.
 *
 * - `"wasm"` (the **default**) runs entirely on the CPU. It's slower than the
 *   GPU path but rock-solid: WASM lives in the renderer's linear memory and
 *   cannot crash the browser's GPU process, so a Speak never takes down the tab.
 * - `"webgpu"` is the opt-in fast path. onnxruntime-web's WebGPU backend pushes
 *   the 257 MB vector-estimator through 8 denoising passes, and on a number of
 *   consumer GPU drivers that crashes the GPU process — which kills the whole
 *   renderer ("Aw, Snap" / browser crash) **uncatchably** (a native crash is not
 *   a JS exception, so the WASM fallback can't rescue it). We therefore never
 *   pick it automatically; the user must explicitly enable it.
 */
export type TtsBackendPref = "wasm" | "webgpu";

let enginePromise: Promise<SupertonicEngine> | null = null;
// The backend the cached engine was built with; if a new request asks for a
// different one we rebuild instead of handing back the wrong-backend engine.
let enginePref: TtsBackendPref | null = null;

async function loadModels(
  providers: ort.InferenceSession.ExecutionProviderConfig[],
  onProgress: LoadProgress,
): Promise<{ tts: TextToSpeech; sampleRate: number }> {
  // Make onnxruntime's WASM binaries load through our indefinite cache too.
  patchOrtWasmFetch();

  const cfgs = await loadJSON<Cfgs>(`${ONNX_DIR}/tts.json`);
  const indexer = await loadJSON<number[]>(`${ONNX_DIR}/unicode_indexer.json`);

  const opts: ort.InferenceSession.SessionOptions = {
    executionProviders: providers,
    graphOptimizationLevel: "all",
  };
  const models: [string, string][] = [
    ["Duration predictor", "duration_predictor.onnx"],
    ["Text encoder", "text_encoder.onnx"],
    ["Vector estimator (257 MB)", "vector_estimator.onnx"],
    ["Vocoder (101 MB)", "vocoder.onnx"],
  ];
  const sessions: ort.InferenceSession[] = [];
  for (let i = 0; i < models.length; i++) {
    onProgress(`Loading TTS model ${i + 1}/4: ${models[i][0]}…`);
    // Create the session from the cached bytes (Uint8Array) rather than a URL,
    // so onnxruntime never re-downloads the model — first run caches, every
    // later run (incl. offline) loads straight from Cache Storage.
    const bytes = await loadModelBytes(`${ONNX_DIR}/${models[i][1]}`);
    sessions.push(await ort.InferenceSession.create(bytes, opts));
  }
  const [dp, te, ve, voc] = sessions;
  const tts = new TextToSpeech(cfgs, new UnicodeProcessor(indexer), dp, te, ve, voc);
  return { tts, sampleRate: cfgs.ae.sample_rate };
}

/**
 * Load (once) and return the Supertonic engine. Defaults to the **WASM (CPU)**
 * backend, which is stable and cannot crash the browser's GPU process; pass
 * `pref = "webgpu"` to opt into the faster (but on some drivers crash-prone) GPU
 * path. The engine is memoised per backend — switching `pref` rebuilds it.
 */
export async function getSupertonicEngine(
  onProgress: LoadProgress,
  pref: TtsBackendPref = "wasm",
): Promise<SupertonicEngine> {
  if (enginePromise && enginePref === pref) return enginePromise;
  enginePref = pref;
  enginePromise = (async () => {
    let backend: "webgpu" | "wasm" = "wasm";
    let tts: TextToSpeech;
    if (pref === "webgpu") {
      // Opt-in GPU path. A WebGPU *init* failure is catchable (we fall back to
      // WASM here); a WebGPU *runtime* GPU-process crash is not — hence WASM is
      // the default and this branch only runs when the user explicitly asks.
      try {
        onProgress("Initialising Supertonic (WebGPU, experimental)…");
        ({ tts } = await loadModels(["webgpu"], onProgress));
        backend = "webgpu";
      } catch {
        onProgress("WebGPU unavailable — falling back to CPU…");
        ({ tts } = await loadModels(["wasm"], onProgress));
        backend = "wasm";
      }
    } else {
      // Default, stable path: CPU only.
      onProgress("Initialising Supertonic (CPU)…");
      ({ tts } = await loadModels(["wasm"], onProgress));
      backend = "wasm";
    }
    // Lazily load + memoise voice styles per id. Each voice is a tiny JSON
    // fetched through cachedFetch, so the first use of a voice downloads +
    // caches it indefinitely and later uses (incl. offline) load from cache.
    const styleCache = new Map<string, Promise<Style>>();
    const getStyle = (voiceId: string): Promise<Style> => {
      const id = VALID_VOICE_IDS.has(voiceId) ? voiceId : DEFAULT_VOICE_ID;
      let p = styleCache.get(id);
      if (!p) {
        p = loadStyle(voiceStyleUrl(id));
        // Drop failed loads so a later attempt can retry cleanly.
        p.catch(() => styleCache.delete(id));
        styleCache.set(id, p);
      }
      return p;
    };
    return { tts, backend, getStyle };
  })();
  // If loading fails, clear the cache so a later Speak can retry cleanly.
  enginePromise.catch(() => {
    enginePromise = null;
    enginePref = null;
  });
  return enginePromise;
}

/**
 * Synthesise `text` in `lang` and return a playable WAV Blob URL plus its
 * duration. `voiceId` selects one of the 10 Supertonic voice styles (default
 * `M1`); its style JSON is loaded + cached on demand. `totalStep` trades
 * quality for speed (8 is the example default).
 */
export async function synthesize(
  engine: SupertonicEngine,
  text: string,
  lang: string,
  opts: {
    voiceId?: string;
    totalStep?: number;
    speed?: number;
    onStep?: DenoiseProgress;
  } = {},
): Promise<{ url: string; duration: number }> {
  const { voiceId = DEFAULT_VOICE_ID, totalStep = 8, speed = 1.05, onStep } = opts;
  // Load (and cache) the selected voice's style — small JSON, per-voice cached.
  const style = await engine.getStyle(voiceId);
  const { wav, duration } = await engine.tts.call(
    text, lang, style, totalStep, speed, 0.3, onStep,
  );
  const wavLen = Math.floor(engine.tts.sampleRate * duration[0]);
  const wavOut = wav.slice(0, wavLen);
  const buffer = writeWavFile(wavOut, engine.tts.sampleRate);
  const blob = new Blob([buffer], { type: "audio/wav" });
  return { url: URL.createObjectURL(blob), duration: duration[0] };
}
