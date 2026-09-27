import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Hunspell, caseShape, editDistance } from "./hunspell";
import { spellTokens, wordAt } from "./tokenize";

// A hand-written dictionary exercising the affix features.
const AFF = `
SET UTF-8
TRY esianrtolcdugmphbyfvkwz'
REP 2
REP f ph
REP ph f
NOSUGGEST !
KEEPCASE K
FORBIDDENWORD X
NEEDAFFIX N
PFX U Y 1
PFX U 0 un .
SFX S Y 3
SFX S 0 s [^sxzhy]
SFX S y ies [^aeiou]y
SFX S 0 es [sxzh]
SFX D Y 2
SFX D 0 ed [^ey]
SFX D 0 d e
SFX L Y 1
SFX L 0 ly/S .
`;
const DIC = `9
happy/UL
box/S
fly/S
walk/SD
love/SD
telephone/S
iPod/K
bad/X
foo/N
`;

describe("Hunspell engine", () => {
  const h = new Hunspell(AFF, DIC);

  it("accepts stems and affixed forms", () => {
    for (const w of ["happy", "unhappy", "boxes", "flies", "walked", "loved", "walks", "telephones"]) expect(h.correct(w), w).toBe(true);
    for (const w of ["happys", "boxs", "flys", "loveed", "unwalk", "telefone"]) expect(h.correct(w), w).toBe(false);
  });

  it("handles cross products and twofold suffixes", () => {
    expect(h.correct("unhappyly")).toBe(true); // PFX U × SFX L
    expect(h.correct("happylies")).toBe(true); // ly/S continuation (twofold)
    expect(h.correct("happies")).toBe(false);
  });

  it("follows capitalisation rules", () => {
    expect(h.correct("Happy")).toBe(true);
    expect(h.correct("HAPPY")).toBe(true);
    expect(h.correct("hAPPY")).toBe(false);
    expect(h.correct("iPod")).toBe(true);
    expect(h.correct("Ipod")).toBe(false); // KEEPCASE
  });

  it("honours FORBIDDENWORD and NEEDAFFIX", () => {
    expect(h.correct("bad")).toBe(false);
    expect(h.correct("foo")).toBe(false);
  });

  it("suggests REP, single edits and keeps the input's case", () => {
    expect(h.suggest("telefone")).toContain("telephone");
    expect(h.suggest("wlaked")[0]).toBe("walked");
    expect(h.suggest("Hapy")[0]).toBe("Happy");
    expect(h.suggest("BOXS")).toContain("BOXES");
  });

  it("adds and removes personal words", () => {
    const d = new Hunspell(AFF, DIC);
    expect(d.correct("Grown")).toBe(false);
    d.add("Grown");
    expect(d.correct("Grown")).toBe(true);
    expect(d.correct("GROWN")).toBe(true);
    d.remove("Grown");
    expect(d.correct("Grown")).toBe(false);
  });

  it("parses long and numeric flags", () => {
    const l = new Hunspell("FLAG long\nSFX Aa Y 1\nSFX Aa 0 s .\n", "1\ncat/Aa\n");
    expect(l.correct("cats")).toBe(true);
    const n = new Hunspell("FLAG num\nSFX 101 Y 1\nSFX 101 0 s .\n", "1\ndog/101,7\n");
    expect(n.correct("dogs")).toBe(true);
  });

  it("supports COMPOUNDFLAG compounds", () => {
    const c = new Hunspell("COMPOUNDFLAG Z\nCOMPOUNDMIN 2\n", "2\nfoot/Z\nball/Z\n");
    expect(c.correct("football")).toBe(true);
    expect(c.correct("footbal")).toBe(false);
  });

  it("helpers", () => {
    expect(caseShape("Hello")).toBe("capital");
    expect(caseShape("NASA")).toBe("upper");
    expect(caseShape("iPod")).toBe("mixed");
    expect(editDistance("teh", "the")).toBe(1);
  });
});

describe("spell tokens", () => {
  it("splits words, keeps apostrophes, skips numbers, capitals and URLs", () => {
    const t = spellTokens("Don’t visit https://example.com/x or NASA in 2024, 21st ok");
    expect(t.map((x) => x.word)).toEqual(["Don’t", "visit", "or", "in", "ok"]);
    expect(t[1]).toMatchObject({ from: 6, to: 11 });
  });
  it("wordAt", () => {
    expect(wordAt("hello world", 7)?.word).toBe("world");
  });
});

describe("en-US dictionary (public/dict)", () => {
  const dir = resolve(__dirname, "../../../public/dict");
  const h = new Hunspell(readFileSync(`${dir}/en-US.aff`, "utf8"), gunzipSync(readFileSync(`${dir}/en-US.dic.gz`)).toString("utf8"));

  it("checks common English", () => {
    const ok = "The quick brown fox jumps over the lazy dog while running happily and unhappily through beautiful gardens. It's John's car, isn't it? Organization realized colors".split(/[^A-Za-z']+/).filter(Boolean);
    for (const w of ok) expect(h.correct(w), w).toBe(true);
    for (const w of ["teh", "recieve", "definately", "colour", "accomodate"]) expect(h.correct(w), w).toBe(false);
    expect(h.correct("don’t")).toBe(true); // ICONV ’ -> '
  });

  it("checks ordinals through COMPOUNDRULE", () => {
    for (const w of ["1st", "2nd", "11th", "21st", "112th"]) expect(h.correct(w), w).toBe(true);
    for (const w of ["1th", "11st", "22th"]) expect(h.correct(w), w).toBe(false);
  });

  it("suggests the intended word first", () => {
    expect(h.suggest("teh")[0]).toBe("the");
    expect(h.suggest("recieve")[0]).toBe("receive");
    expect(h.suggest("definately")).toContain("definitely");
    expect(h.suggest("Acommodate")).toContain("Accommodate");
    expect(h.suggest("alot")).toContain("a lot");
  });

  it("is fast enough for a worker", () => {
    const words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor".split(" ");
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) for (const w of words) h.correct(w);
    expect(performance.now() - t0).toBeLessThan(1500);
    const t1 = performance.now();
    h.suggest("mispelled");
    expect(performance.now() - t1).toBeLessThan(1500);
  });
});
