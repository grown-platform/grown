import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readPptx } from "./read";
import { deckToPptx } from "./write";

// Local-only corpus: OnlyOffice's sample .pptx files (AGPL; never committed)
// used purely as input. Point GROWN_CONVERSION_CORPUS at research/onlyoffice/core
// (the default probe); the tests skip when the files aren't there (CI).
//
//   GROWN_CONVERSION_CORPUS=$PWD/../../research/onlyoffice/core npx vitest run src/pages/slides/pptx/corpus.test.ts

const ROOT = resolve(
  process.env.GROWN_CONVERSION_CORPUS ||
    join(__dirname, "../../../../../../research/onlyoffice/core"),
);

const CASES: [string, string][] = [
  [
    "oo:core/OdfFile/Test/test_odf/ExampleFiles#audio.pptx",
    "OdfFile/Test/test_odf/ExampleFiles/audio.pptx",
  ],
  [
    "oo:core/OdfFile/Test/test_odf/ExampleFiles#entrance.pptx",
    "OdfFile/Test/test_odf/ExampleFiles/entrance.pptx",
  ],
  [
    "oo:core/OdfFile/Test/test_odf/ExampleFiles#interaction.pptx",
    "OdfFile/Test/test_odf/ExampleFiles/interaction.pptx",
  ],
  [
    "oo:core/OdfFile/Test/test_odf/ExampleFiles#motion.odp-my.pptx",
    "OdfFile/Test/test_odf/ExampleFiles/motion.odp-my.pptx",
  ],
  [
    "oo:core/OdfFile/Test/test_odf/ExampleFiles#openDocument.pptx",
    "OdfFile/Test/test_odf/ExampleFiles/openDocument.pptx",
  ],
  [
    "oo:core/OdfFile/Test/test_odf/ExampleFiles#playAudio.pptx",
    "OdfFile/Test/test_odf/ExampleFiles/playAudio.pptx",
  ],
  [
    "oo:core/OdfFile/Test/test_odf/ExampleFiles#runProgram.pptx",
    "OdfFile/Test/test_odf/ExampleFiles/runProgram.pptx",
  ],
  [
    "oo:core/OdfFile/Test/Test/ExampleFiles#69238.pptx",
    "OdfFile/Test/Test/ExampleFiles/69238.pptx",
  ],
];

describe("pptx corpus (local only)", () => {
  for (const [tag, rel] of CASES) {
    const file = join(ROOT, rel);
    it.skipIf(!existsSync(file))(`${tag}`, async () => {
      const src = await readPptx(new Uint8Array(readFileSync(file)));
      expect(src.deck.slides.length).toBeGreaterThan(0);
      const drawn = src.deck.slides.reduce((n, s) => n + s.elements.length, 0);
      expect(drawn).toBeGreaterThan(0);
      for (const s of src.deck.slides)
        for (const e of s.elements)
          for (const v of [e.x, e.y, e.w, e.h])
            expect(Number.isFinite(v)).toBe(true);

      // Import → export → re-import keeps slides, elements and their text.
      const again = await readPptx(await deckToPptx(src.deck));
      expect(again.deck.slides.length).toBe(src.deck.slides.length);
      const sig = (d: typeof src.deck) =>
        d.slides.map((s) => s.elements.map((e) => `${e.type}:${e.text ?? ""}`));
      expect(sig(again.deck)).toEqual(sig(src.deck));
    });
  }
});
