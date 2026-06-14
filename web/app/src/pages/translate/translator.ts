/**
 * In-browser translation engine.
 *
 * Two engines, tried in order, both fully on-device (no backend call):
 *
 *   1. The browser's built-in **Translator API** (Chrome's on-device
 *      translation, `self.Translator` / the older `window.translation`). It's
 *      the lightest path — the model is managed by the browser and shared
 *      across sites — so we always prefer it when the requested pair is
 *      available.
 *
 *   2. **transformers.js** (`@huggingface/transformers`) running
 *      `Xenova/nllb-200-distilled-600M` via WASM/WebGPU. This is the universal
 *      fallback that works in any browser, at the cost of a ~600 MB model
 *      download on first use (cached by the browser afterward). It's imported
 *      dynamically so none of it lands in the main bundle.
 *
 * Both engines are wrapped behind `translate()`, which reports progress (model
 * download %, then a generic "translating" phase) through a callback so the UI
 * can show a meaningful loading state.
 */
import type { Language } from "./languages";

export type Engine = "browser" | "transformers";

export interface TranslateProgress {
  /** Coarse phase for the UI. */
  phase: "checking" | "downloading" | "translating";
  /** 0..1 download progress when phase === "downloading"; undefined otherwise. */
  progress?: number;
  /** Free-text status (e.g. "Downloading translation model…"). */
  message: string;
}

export interface TranslateResult {
  text: string;
  engine: Engine;
}

type ProgressFn = (p: TranslateProgress) => void;

// ---------------------------------------------------------------------------
// 1) Browser built-in Translator API
// ---------------------------------------------------------------------------

// The Translator API is still being standardised, so it surfaces under a few
// shapes across browser versions. We feature-detect all of them and treat the
// API as loosely-typed (no published lib.dom types yet).
type AnyTranslator = {
  create?: (opts: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }) => Promise<{ translate: (t: string) => Promise<string> }>;
  availability?: (opts: {
    sourceLanguage: string;
    targetLanguage: string;
  }) => Promise<string>;
};

function getBrowserTranslator(): AnyTranslator | null {
  const g = self as unknown as {
    Translator?: AnyTranslator;
    translation?: AnyTranslator;
    ai?: { translator?: AnyTranslator };
  };
  return g.Translator ?? g.translation ?? g.ai?.translator ?? null;
}

/** True when the browser exposes some form of the on-device Translator API. */
export function browserTranslatorAvailable(): boolean {
  return getBrowserTranslator() != null;
}

async function translateWithBrowser(
  text: string,
  from: Language,
  to: Language,
  onProgress: ProgressFn,
): Promise<string | null> {
  const api = getBrowserTranslator();
  if (!api?.create) return null;

  // If the implementation exposes availability(), respect it — "unavailable"
  // means this pair can't run on-device and we should fall through.
  try {
    if (api.availability) {
      const status = await api.availability({
        sourceLanguage: from.bcp47,
        targetLanguage: to.bcp47,
      });
      if (status === "unavailable") return null;
    }
  } catch {
    // availability() is best-effort; ignore and try create().
  }

  onProgress({ phase: "checking", message: "Preparing browser translator…" });
  try {
    const translator = await api.create({
      sourceLanguage: from.bcp47,
      targetLanguage: to.bcp47,
      // The monitor surfaces a download for language packs the browser hasn't
      // fetched yet, so we can show progress for those too.
      monitor: (m) => {
        m.addEventListener("downloadprogress", (e: Event) => {
          const { loaded } = e as unknown as { loaded: number };
          onProgress({
            phase: "downloading",
            progress: loaded,
            message: "Downloading on-device language pack…",
          });
        });
      },
    });
    onProgress({ phase: "translating", message: "Translating…" });
    return await translator.translate(text);
  } catch {
    // Any failure (pair unsupported, download blocked) → use the fallback.
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2) transformers.js (NLLB) fallback
// ---------------------------------------------------------------------------

const NLLB_MODEL = "Xenova/nllb-200-distilled-600M";

// Lazily-created translation pipeline, memoised across calls so the model is
// downloaded/compiled only once per session.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nllbPipeline: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getNllbPipeline(onProgress: ProgressFn): Promise<any> {
  if (nllbPipeline) return nllbPipeline;
  nllbPipeline = (async () => {
    // Dynamic import keeps transformers.js out of the main bundle entirely.
    const tf = await import("@huggingface/transformers");
    // Persist the ~600 MB NLLB model in the browser's Cache Storage forever so
    // the first run downloads it and every later run — including fully offline —
    // loads it from cache. `useBrowserCache` is transformers.js's default, but
    // we force it on (and keep remote models allowed for the first download).
    // The library uses a stable cache name ("transformers-cache") that we don't
    // override, so the model is never re-downloaded across sessions. Together
    // with the Supertonic TTS cache this keeps ~1 GB of models on-device.
    tf.env.useBrowserCache = true;
    tf.env.allowRemoteModels = true;
    // Let the lib pick WebGPU when available and fall back to WASM itself.
    return tf.pipeline("translation", NLLB_MODEL, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: (p: any) => {
        if (p?.status === "progress" && typeof p.progress === "number") {
          onProgress({
            phase: "downloading",
            progress: p.progress / 100,
            message: `Downloading translation model… ${Math.round(p.progress)}%`,
          });
        }
      },
    });
  })();
  return nllbPipeline;
}

async function translateWithTransformers(
  text: string,
  from: Language,
  to: Language,
  onProgress: ProgressFn,
): Promise<string> {
  if (!from.nllb || !to.nllb) {
    throw new Error(
      `The offline model can't translate ${from.name} → ${to.name}.`,
    );
  }
  onProgress({
    phase: "downloading",
    message: "Loading translation model… (first run downloads it on-device)",
  });
  const pipe = await getNllbPipeline(onProgress);
  onProgress({ phase: "translating", message: "Translating…" });
  const out = await pipe(text, {
    src_lang: from.nllb,
    tgt_lang: to.nllb,
  });
  // pipeline() returns an array of { translation_text }.
  const first = Array.isArray(out) ? out[0] : out;
  return (first?.translation_text ?? "").trim();
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Translate `text` from → to, preferring the browser engine and falling back to
 * transformers.js. Reports progress through `onProgress`.
 */
export async function translate(
  text: string,
  from: Language,
  to: Language,
  onProgress: ProgressFn,
): Promise<TranslateResult> {
  const trimmed = text.trim();
  if (!trimmed) return { text: "", engine: "browser" };

  // Same language in and out — nothing to do.
  if (from.code === to.code) return { text: trimmed, engine: "browser" };

  // 1) Browser built-in, when present and able to handle the pair.
  if (browserTranslatorAvailable()) {
    const viaBrowser = await translateWithBrowser(trimmed, from, to, onProgress);
    if (viaBrowser != null) return { text: viaBrowser, engine: "browser" };
  }

  // 2) transformers.js fallback.
  const viaTf = await translateWithTransformers(trimmed, from, to, onProgress);
  return { text: viaTf, engine: "transformers" };
}
