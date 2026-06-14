/**
 * Language catalog for the Translate app.
 *
 * One entry per language we offer in the source/target pickers. Each row
 * carries the codes the various engines need, because every engine speaks a
 * slightly different dialect of "language code":
 *
 *   - `code`  — our canonical short code (BCP-47-ish, e.g. "en", "pt").
 *   - `bcp47` — the full tag the browser Translator API wants (e.g. "zh-Hans").
 *   - `nllb`  — the FLORES-200 code transformers.js / NLLB expects (e.g.
 *               "eng_Latn"); null when NLLB has no clean match so we can hide
 *               unsupported pairs from the fallback engine.
 *   - `supertonic` — the language tag Supertonic's TTS wraps text in (it uses
 *               the same short codes as `code` for the 31 it supports); null
 *               when Supertonic can't speak it (we fall back to speechSynthesis).
 *
 * The set is anchored on the 31 languages Supertonic supports so that "translate
 * then speak" works end-to-end for as many targets as possible.
 */
export interface Language {
  code: string;
  name: string;
  bcp47: string;
  nllb: string | null;
  supertonic: string | null;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", bcp47: "en", nllb: "eng_Latn", supertonic: "en" },
  { code: "es", name: "Spanish", bcp47: "es", nllb: "spa_Latn", supertonic: "es" },
  { code: "fr", name: "French", bcp47: "fr", nllb: "fra_Latn", supertonic: "fr" },
  { code: "de", name: "German", bcp47: "de", nllb: "deu_Latn", supertonic: "de" },
  { code: "it", name: "Italian", bcp47: "it", nllb: "ita_Latn", supertonic: "it" },
  { code: "pt", name: "Portuguese", bcp47: "pt", nllb: "por_Latn", supertonic: "pt" },
  { code: "nl", name: "Dutch", bcp47: "nl", nllb: "nld_Latn", supertonic: "nl" },
  { code: "ru", name: "Russian", bcp47: "ru", nllb: "rus_Cyrl", supertonic: "ru" },
  { code: "uk", name: "Ukrainian", bcp47: "uk", nllb: "ukr_Cyrl", supertonic: "uk" },
  { code: "pl", name: "Polish", bcp47: "pl", nllb: "pol_Latn", supertonic: "pl" },
  { code: "cs", name: "Czech", bcp47: "cs", nllb: "ces_Latn", supertonic: "cs" },
  { code: "sk", name: "Slovak", bcp47: "sk", nllb: "slk_Latn", supertonic: "sk" },
  { code: "sl", name: "Slovenian", bcp47: "sl", nllb: "slv_Latn", supertonic: "sl" },
  { code: "hr", name: "Croatian", bcp47: "hr", nllb: "hrv_Latn", supertonic: "hr" },
  { code: "bg", name: "Bulgarian", bcp47: "bg", nllb: "bul_Cyrl", supertonic: "bg" },
  { code: "ro", name: "Romanian", bcp47: "ro", nllb: "ron_Latn", supertonic: "ro" },
  { code: "hu", name: "Hungarian", bcp47: "hu", nllb: "hun_Latn", supertonic: "hu" },
  { code: "el", name: "Greek", bcp47: "el", nllb: "ell_Grek", supertonic: "el" },
  { code: "fi", name: "Finnish", bcp47: "fi", nllb: "fin_Latn", supertonic: "fi" },
  { code: "sv", name: "Swedish", bcp47: "sv", nllb: "swe_Latn", supertonic: "sv" },
  { code: "da", name: "Danish", bcp47: "da", nllb: "dan_Latn", supertonic: "da" },
  { code: "et", name: "Estonian", bcp47: "et", nllb: "est_Latn", supertonic: "et" },
  { code: "lv", name: "Latvian", bcp47: "lv", nllb: "lvs_Latn", supertonic: "lv" },
  { code: "lt", name: "Lithuanian", bcp47: "lt", nllb: "lit_Latn", supertonic: "lt" },
  { code: "tr", name: "Turkish", bcp47: "tr", nllb: "tur_Latn", supertonic: "tr" },
  { code: "ar", name: "Arabic", bcp47: "ar", nllb: "arb_Arab", supertonic: "ar" },
  { code: "hi", name: "Hindi", bcp47: "hi", nllb: "hin_Deva", supertonic: "hi" },
  { code: "id", name: "Indonesian", bcp47: "id", nllb: "ind_Latn", supertonic: "id" },
  { code: "vi", name: "Vietnamese", bcp47: "vi", nllb: "vie_Latn", supertonic: "vi" },
  { code: "ja", name: "Japanese", bcp47: "ja", nllb: "jpn_Jpan", supertonic: "ja" },
  { code: "ko", name: "Korean", bcp47: "ko", nllb: "kor_Hang", supertonic: "ko" },
  // Chinese is in our picker for translation even though Supertonic's published
  // set centres on the 31 above; TTS falls back to speechSynthesis for it.
  { code: "zh", name: "Chinese (Simplified)", bcp47: "zh-Hans", nllb: "zho_Hans", supertonic: null },
];

/** Look up a Language row by our canonical short code. */
export function langByCode(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}
