/**
 * Speak the translated text aloud.
 *
 * Primary path: **Supertonic** on-device TTS (supertonic.ts), loaded lazily on
 * first Speak. Fallback: the browser's built-in `speechSynthesis`, used when
 * Supertonic can't load (model fetch fails / unsupported browser) or the target
 * language isn't in Supertonic's set — so Speak always does something.
 */
import type { Language } from "./languages";

export interface SpeakProgress {
  message: string;
}

export interface SpeakResult {
  /** How the audio was produced, for the UI to surface. */
  engine: "supertonic" | "browser";
  backend?: "webgpu" | "wasm";
  /** Stop playback (and revoke any object URL). */
  stop: () => void;
}

/** Speak via Supertonic, returning a started <audio> element. */
async function speakSupertonic(
  text: string,
  lang: Language,
  audio: HTMLAudioElement,
  onProgress: (p: SpeakProgress) => void,
  voiceId?: string,
): Promise<SpeakResult> {
  // Dynamic import keeps onnxruntime-web out of the main bundle.
  const st = await import("./supertonic");
  if (!lang.supertonic || !st.supertonicSupportsLang(lang.supertonic)) {
    throw new Error(`Supertonic has no voice for ${lang.name}.`);
  }
  const engine = await st.getSupertonicEngine((m) => onProgress({ message: m }));
  onProgress({ message: "Synthesising speech…" });
  const { url } = await st.synthesize(engine, text, lang.supertonic, {
    voiceId,
    onStep: (step, total) =>
      onProgress({ message: `Denoising ${step}/${total}…` }),
  });
  audio.src = url;
  await audio.play();
  return {
    engine: "supertonic",
    backend: engine.backend,
    stop: () => {
      audio.pause();
      URL.revokeObjectURL(url);
    },
  };
}

/** Speak via the browser's speechSynthesis, matching the best available voice. */
function speakBrowser(text: string, lang: Language): SpeakResult {
  if (!("speechSynthesis" in window)) {
    throw new Error("This browser can't speak text out loud.");
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang.bcp47;
  const voice = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang.toLowerCase().startsWith(lang.code.toLowerCase()));
  if (voice) utter.voice = voice;
  window.speechSynthesis.speak(utter);
  return {
    engine: "browser",
    stop: () => window.speechSynthesis.cancel(),
  };
}

/**
 * Speak `text` in `lang`, preferring Supertonic and falling back to the browser.
 * `audio` is a reused <audio> element so callers control the player UI.
 * `voiceId` selects the Supertonic voice (default `M1`); the browser fallback
 * is unaffected by it.
 */
export async function speak(
  text: string,
  lang: Language,
  audio: HTMLAudioElement,
  onProgress: (p: SpeakProgress) => void,
  voiceId?: string,
): Promise<SpeakResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Nothing to speak yet — translate first.");

  // Try Supertonic only when it can voice this language; otherwise go straight
  // to the browser fallback.
  if (lang.supertonic) {
    try {
      return await speakSupertonic(trimmed, lang, audio, onProgress, voiceId);
    } catch (e) {
      // Fall through to the browser engine, but surface why we fell back.
      onProgress({
        message: `Supertonic unavailable (${(e as Error).message}) — using browser voice.`,
      });
    }
  }
  return speakBrowser(trimmed, lang);
}
