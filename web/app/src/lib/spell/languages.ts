// Proofing languages (shared by Docs, Sheets, Slides).
//
// Every language can be set on text (Word's "Set proofing language"), but
// only the ones with a bundled dictionary are checked; the rest are
// skipped, as Word does when a language's proofing tools are missing.
// Dictionaries live in /public/dict (see public/dict/README.md for their
// licences) and are loaded on demand by the spell worker.

export interface ProofingLanguage {
  /** BCP 47 tag, as written to DOCX w:lang and the HTML lang attribute. */
  tag: string;
  name: string;
  /** Base name of the bundled dictionary files, when there is one. */
  dictionary?: string;
}

/** "No proofing" (Word's "Do not check spelling or grammar"). */
export const NO_PROOFING = "zxx";

export const LANGUAGES: ProofingLanguage[] = [
  { tag: "en-US", name: "English (United States)", dictionary: "en-US" },
  { tag: "en-GB", name: "English (United Kingdom)", dictionary: "en-GB" },
  { tag: "en-AU", name: "English (Australia)", dictionary: "en-GB" },
  { tag: "en-CA", name: "English (Canada)", dictionary: "en-US" },
  { tag: "en-IE", name: "English (Ireland)", dictionary: "en-GB" },
  { tag: "en-NZ", name: "English (New Zealand)", dictionary: "en-GB" },
  { tag: "de-DE", name: "German (Germany)" },
  { tag: "es-ES", name: "Spanish (Spain)" },
  { tag: "es-MX", name: "Spanish (Mexico)" },
  { tag: "fr-FR", name: "French (France)" },
  { tag: "it-IT", name: "Italian (Italy)" },
  { tag: "nl-NL", name: "Dutch (Netherlands)" },
  { tag: "pt-BR", name: "Portuguese (Brazil)" },
  { tag: "pt-PT", name: "Portuguese (Portugal)" },
  { tag: "pl-PL", name: "Polish (Poland)" },
  { tag: "ru-RU", name: "Russian (Russia)" },
  { tag: "sv-SE", name: "Swedish (Sweden)" },
  { tag: "ja-JP", name: "Japanese (Japan)" },
  { tag: "zh-CN", name: "Chinese (Simplified)" },
];

export const DEFAULT_LANGUAGE = "en-US";

/** normalizeLang canonicalises a tag ("en_us" -> "en-US"). */
export function normalizeLang(tag: string | null | undefined): string {
  if (!tag) return "";
  const parts = tag.trim().replace(/_/g, "-").split("-");
  if (!parts[0]) return "";
  return [parts[0].toLowerCase(), ...parts.slice(1).map((p) => (p.length === 2 ? p.toUpperCase() : p))].join("-");
}

/** languageName: "English (United States)" for "en-US", else the tag. */
export function languageName(tag: string): string {
  const t = normalizeLang(tag);
  if (t === NO_PROOFING) return "Do not check spelling";
  return LANGUAGES.find((l) => l.tag === t)?.name ?? t;
}

/** dictionaryFor picks the bundled dictionary for a tag: an exact match,
 *  then a regional sibling ("en-ZA" -> en-GB, "en" -> en-US), else null
 *  (not checked). */
export function dictionaryFor(tag: string | null | undefined): string | null {
  const t = normalizeLang(tag);
  if (!t || t === NO_PROOFING) return null;
  const exact = LANGUAGES.find((l) => l.tag === t);
  if (exact) return exact.dictionary ?? null;
  const base = t.split("-")[0];
  if (base === "en") return /-(GB|AU|NZ|IE|ZA|IN)$/.test(t) ? "en-GB" : "en-US";
  return LANGUAGES.find((l) => l.tag.split("-")[0] === base && l.dictionary)?.dictionary ?? null;
}
