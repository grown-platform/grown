import { describe, it, expect } from "vitest";
import { LANGUAGES, langByCode, type Language } from "./languages";

describe("translate/languages", () => {
  it("exposes a non-empty list of languages", () => {
    expect(Array.isArray(LANGUAGES)).toBe(true);
    expect(LANGUAGES.length).toBeGreaterThan(10);
  });

  it("every entry has a unique non-empty short code", () => {
    const codes = new Set<string>();
    for (const l of LANGUAGES) {
      // Canonical short codes are lowercase BCP-47-ish (e.g. "en", "zh").
      expect(l.code).toMatch(/^[a-z]{2,}$/);
      expect(codes.has(l.code)).toBe(false);
      codes.add(l.code);
    }
    expect(codes.size).toBe(LANGUAGES.length);
  });

  it("every entry has a non-empty display name", () => {
    for (const l of LANGUAGES) {
      expect(typeof l.name).toBe("string");
      expect(l.name.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a non-empty bcp47 tag", () => {
    for (const l of LANGUAGES) {
      expect(typeof l.bcp47).toBe("string");
      expect(l.bcp47.length).toBeGreaterThan(0);
    }
  });

  it("nllb is either a FLORES-200 code or null", () => {
    for (const l of LANGUAGES) {
      if (l.nllb !== null) {
        // FLORES-200 codes look like "eng_Latn": 3-letter lang + _ + 4-char script.
        expect(l.nllb).toMatch(/^[a-z]{3}_[A-Z][a-z]{3}$/);
      }
    }
  });

  it("supertonic is either a short code or null", () => {
    for (const l of LANGUAGES) {
      expect(l.supertonic === null || typeof l.supertonic === "string").toBe(true);
      if (typeof l.supertonic === "string") {
        // Supertonic reuses our canonical short codes for the langs it speaks.
        expect(l.supertonic).toBe(l.code);
      }
    }
  });

  describe("langByCode", () => {
    const hits: Array<[string, string]> = [
      ["en", "English"],
      ["es", "Spanish"],
      ["zh", "Chinese (Simplified)"],
      ["ko", "Korean"],
    ];
    it.each(hits)("looks up %s -> %s", (code, name) => {
      const found = langByCode(code);
      expect(found).toBeDefined();
      expect(found?.code).toBe(code);
      expect(found?.name).toBe(name);
    });

    const misses: string[] = ["", "xx", "EN", " en", "en ", "english", "zz"];
    it.each(misses)("returns undefined for miss %j", (code) => {
      expect(langByCode(code)).toBeUndefined();
    });

    it("is exact and case-sensitive (no normalization)", () => {
      // langByCode does a strict === match; uppercase / padded input misses.
      expect(langByCode("EN")).toBeUndefined();
      expect(langByCode("Es")).toBeUndefined();
      expect(langByCode(" en")).toBeUndefined();
    });

    it("returns the same row object held in LANGUAGES", () => {
      const expected = LANGUAGES.find((l) => l.code === "fr");
      expect(langByCode("fr")).toBe(expected);
    });

    it("resolves every code in the catalog", () => {
      for (const l of LANGUAGES) {
        expect(langByCode(l.code)).toBe(l);
      }
    });
  });

  it("Language type is exported and usable", () => {
    const sample: Language["code"] = LANGUAGES[0].code;
    expect(typeof sample).toBe("string");
  });

  it("includes the anchor set of supertonic-supported languages", () => {
    const supported = LANGUAGES.filter((l) => l.supertonic !== null);
    // The set is anchored on the 31 Supertonic languages.
    expect(supported.length).toBe(31);
  });
});
