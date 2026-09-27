import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readOdp } from "./read";
import { readPptx } from "../pptx/read";
import { deckToPptx } from "../pptx/write";

// Local-only corpus: OnlyOffice's sample .odp files (AGPL; never committed)
// used purely as input, next to the .pptx OnlyOffice converted each one to.
// Point GROWN_CONVERSION_CORPUS at research/onlyoffice/core (the default
// probe); the tests skip when the files aren't there (CI).
//
//   GROWN_CONVERSION_CORPUS=$PWD/../../research/onlyoffice/core npx vitest run src/pages/slides/odp/corpus.test.ts

const ROOT = resolve(
  process.env.GROWN_CONVERSION_CORPUS ||
    join(__dirname, "../../../../../../research/onlyoffice/core"),
);
const DIR = "OdfFile/Test/test_odf/ExampleFiles";

// [tag, .odp, the .pptx OnlyOffice made from it]
const CASES: [string, string, string][] = [
  ["oo:core/OdfFile/Test/test_odf/ExampleFiles#audio.odp", "audio.odp", "audio.pptx"],
  ["oo:core/OdfFile/Test/test_odf/ExampleFiles#entrance.odp", "entrance.odp", "entrance.pptx"],
  ["oo:core/OdfFile/Test/test_odf/ExampleFiles#motion.odp", "motion.odp", "motion.odp-my.pptx"],
  ["oo:core/OdfFile/Test/test_odf/ExampleFiles#openDocument.odp", "openDocument.odp", "openDocument.pptx"],
  ["oo:core/OdfFile/Test/test_odf/ExampleFiles#playAudio.odp", "playAudio.odp", "playAudio.pptx"],
  ["oo:core/OdfFile/Test/test_odf/ExampleFiles#runProgram.odp", "runProgram.odp", "runProgram.pptx"],
];

const words = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("odp corpus (local only)", () => {
  for (const [tag, odp, pptx] of CASES) {
    const file = join(ROOT, DIR, odp);
    it.skipIf(!existsSync(file))(`${tag}`, async () => {
      const src = await readOdp(new Uint8Array(readFileSync(file)));
      expect(src.deck.slides.length).toBeGreaterThan(0);
      const els = src.deck.slides.flatMap((s) => s.elements);
      expect(els.length).toBeGreaterThan(0);
      for (const e of els) for (const v of [e.x, e.y, e.w, e.h]) expect(Number.isFinite(v)).toBe(true);
      // Every element lies (at least partly) on its slide.
      for (const e of els) {
        expect(e.x + e.w).toBeGreaterThan(0);
        expect(e.x).toBeLessThan(960);
      }

      // OnlyOffice's converted .pptx has as many slides.
      const ref = join(ROOT, DIR, pptx);
      if (existsSync(ref)) {
        const other = await readPptx(new Uint8Array(readFileSync(ref)));
        expect(src.deck.slides.length).toBe(other.deck.slides.length);
      }

      // ODP → Grown → pptx → Grown keeps the slides, something drawn on
      // each, and all their text (pptx may merge a shape and its text).
      const again = await readPptx(await deckToPptx(src.deck));
      expect(again.deck.slides.length).toBe(src.deck.slides.length);
      const texts = (d: typeof src.deck) =>
        d.slides.map((s) => s.elements.map((e) => words(e.text)).filter(Boolean).sort());
      expect(texts(again.deck)).toEqual(texts(src.deck));
      for (const [i, s] of again.deck.slides.entries())
        expect(s.elements.length > 0).toBe(src.deck.slides[i].elements.length > 0);
    });
  }
});
