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
 * Speak and cached by the browser (HTTP cache + onnxruntime's own caching), so
 * subsequent runs are offline-fast. Execution prefers WebGPU and falls back to
 * WASM; onnxruntime-web's WASM binaries are loaded from the jsDelivr CDN so they
 * don't enter our Vite bundle.
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
const VOICE_STYLE_URL = `${ASSET_BASE}/voice_styles/M1.json`;

// onnxruntime-web ships its WASM/threading binaries separately; point at a CDN
// matching the installed version so we don't have to copy them into public/.
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;

/** The 32 language tags Supertonic accepts (`na` = language-agnostic). */
export const SUPERTONIC_LANGS = new Set([
  "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi",
  "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro",
  "ru", "sk", "sl", "sv", "tr", "uk", "vi", "na",
]);

export function supertonicSupportsLang(lang: string): boolean {
  return SUPERTONIC_LANGS.has(lang);
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} failed (${res.status})`);
  return (await res.json()) as T;
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

/** A ready-to-use engine: the TTS pipeline, default voice style, and backend. */
export interface SupertonicEngine {
  tts: TextToSpeech;
  style: Style;
  backend: "webgpu" | "wasm";
}

let enginePromise: Promise<SupertonicEngine> | null = null;

async function loadModels(
  providers: ort.InferenceSession.ExecutionProviderConfig[],
  onProgress: LoadProgress,
): Promise<{ tts: TextToSpeech; sampleRate: number }> {
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
    sessions.push(
      await ort.InferenceSession.create(`${ONNX_DIR}/${models[i][1]}`, opts),
    );
  }
  const [dp, te, ve, voc] = sessions;
  const tts = new TextToSpeech(cfgs, new UnicodeProcessor(indexer), dp, te, ve, voc);
  return { tts, sampleRate: cfgs.ae.sample_rate };
}

/** Load (once) and return the Supertonic engine, preferring WebGPU. */
export async function getSupertonicEngine(
  onProgress: LoadProgress,
): Promise<SupertonicEngine> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    let backend: "webgpu" | "wasm" = "wasm";
    let tts: TextToSpeech;
    try {
      onProgress("Initialising Supertonic (WebGPU)…");
      ({ tts } = await loadModels(["webgpu"], onProgress));
      backend = "webgpu";
    } catch {
      onProgress("WebGPU unavailable — falling back to WASM…");
      ({ tts } = await loadModels(["wasm"], onProgress));
      backend = "wasm";
    }
    onProgress("Loading default voice style…");
    const style = await loadStyle(VOICE_STYLE_URL);
    return { tts, style, backend };
  })();
  // If loading fails, clear the cache so a later Speak can retry cleanly.
  enginePromise.catch(() => {
    enginePromise = null;
  });
  return enginePromise;
}

/**
 * Synthesise `text` in `lang` and return a playable WAV Blob URL plus its
 * duration. `totalStep` trades quality for speed (8 is the example default).
 */
export async function synthesize(
  engine: SupertonicEngine,
  text: string,
  lang: string,
  opts: { totalStep?: number; speed?: number; onStep?: DenoiseProgress } = {},
): Promise<{ url: string; duration: number }> {
  const { totalStep = 8, speed = 1.05, onStep } = opts;
  const { wav, duration } = await engine.tts.call(
    text, lang, engine.style, totalStep, speed, 0.3, onStep,
  );
  const wavLen = Math.floor(engine.tts.sampleRate * duration[0]);
  const wavOut = wav.slice(0, wavLen);
  const buffer = writeWavFile(wavOut, engine.tts.sampleRate);
  const blob = new Blob([buffer], { type: "audio/wav" });
  return { url: URL.createObjectURL(blob), duration: duration[0] };
}
