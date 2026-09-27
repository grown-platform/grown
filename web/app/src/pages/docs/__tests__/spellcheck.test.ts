// Spell check and proofing language in the Docs editor (M13).
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { makeEditor, selectText } from "./harness";
import { buildDocx } from "./docx-fixture";
import { LocalSpellBackend } from "../../../lib/spell/backend";
import { SpellService, setSpellService } from "../../../lib/spell/service";
import { checkSpellingNow, collectWords, ignoreAll, misspellingAt, replaceMisspelling } from "../spellcheck";
import { docLanguage, setDocLanguage } from "../language";
import { readDocx } from "../docx/read";
import { writeDocx } from "../docx/write";
import { applyDocxImport, collectDocxInput } from "../docx/apply";

const DICT = resolve(__dirname, "../../../../public/dict");
let svc: SpellService;

beforeAll(() => {
  const backend = new LocalSpellBackend(async (name) => ({
    aff: readFileSync(`${DICT}/${name}.aff`, "utf8"),
    dic: gunzipSync(readFileSync(`${DICT}/${name}.dic.gz`)).toString("utf8"),
  }));
  svc = new SpellService(backend, { enabled: true, words: [] });
  setSpellService(svc);
});
afterAll(() => setSpellService(null));

const words = (list: { word: string }[]) => list.map((m) => m.word);

describe("Docs spell check", () => {
  it("flags misspellings with red squiggles, skipping code, URLs and tracked deletions", async () => {
    const e = makeEditor('<p>This sentance has teh errors, <code>fooo</code> and https://exmaple.com/x.</p>');
    const bad = await checkSpellingNow(e);
    expect(words(bad)).toEqual(["sentance", "teh"]);
    expect(e.view.dom.querySelectorAll(".spell-error").length).toBe(2);
    expect(e.view.dom.querySelector(".spell-error")?.textContent).toBe("sentance");
    expect(e.view.dom.getAttribute("spellcheck")).toBe("false");
  });

  it("suggests and replaces keeping the run's formatting", async () => {
    const e = makeEditor("<p>A <strong>recieve</strong> button.</p>");
    const [m] = await checkSpellingNow(e);
    expect(m.word).toBe("recieve");
    const sugg = await svc.suggest(m.lang, m.word);
    expect(sugg[0]).toBe("receive");
    replaceMisspelling(e, misspellingAt(e.state, m.from + 2)!, sugg[0]);
    expect(e.getHTML()).toContain("<strong>receive</strong>");
    expect(await checkSpellingNow(e)).toEqual([]);
  });

  it("ignore once, ignore all (per document) and add to dictionary (per user)", async () => {
    const e = makeEditor("<p>Grwn and Grwn and zorblax.</p>");
    let bad = await checkSpellingNow(e);
    expect(words(bad)).toEqual(["Grwn", "Grwn", "zorblax"]);
    e.commands.ignoreSpellingOnce(bad[0].from, bad[0].to);
    bad = await checkSpellingNow(e);
    expect(words(bad)).toEqual(["Grwn", "zorblax"]);
    ignoreAll(e, "Grwn");
    bad = await checkSpellingNow(e);
    expect(words(bad)).toEqual(["zorblax"]);
    svc.addWord("zorblax");
    expect(await checkSpellingNow(e)).toEqual([]);
    expect(svc.words).toContain("zorblax");
    svc.removeWord("zorblax");
    expect(words(await checkSpellingNow(e))).toEqual(["zorblax"]);
  });

  it("checks each run in its own language; no-proofing and dictionary-less languages are skipped", async () => {
    const e = makeEditor("<p>colour color</p><p>Bonjour tout le monde</p><p>xyzzyq</p>");
    expect(words(await checkSpellingNow(e))).toEqual(["colour", "Bonjour", "le", "monde", "xyzzyq"]);
    selectText(e, "colour color");
    e.commands.setTextLanguage("en-GB");
    // en-GB accepts "colour" and rejects "color".
    expect(words(await checkSpellingNow(e))).toEqual(["color", "Bonjour", "le", "monde", "xyzzyq"]);
    selectText(e, "Bonjour tout le monde");
    e.commands.setTextLanguage("fr-FR"); // no French dictionary: not checked
    selectText(e, "xyzzyq");
    e.commands.setTextLanguage("zxx"); // "Do not check spelling"
    expect(words(await checkSpellingNow(e))).toEqual(["color"]);
    expect(e.getHTML()).toContain('lang="fr-FR"');
    expect(e.getHTML()).toContain('data-noproof="true"');
  });

  it("follows the document language", async () => {
    const e = makeEditor("<p>colour</p>");
    expect(docLanguage(e)).toBe("en-US");
    expect(words(await checkSpellingNow(e))).toEqual(["colour"]);
    setDocLanguage(e, "en-GB");
    expect(await checkSpellingNow(e)).toEqual([]);
    expect(e.view.dom.getAttribute("lang")).toBe("en-GB");
  });

  it("is off when the user turns it off", async () => {
    const e = makeEditor("<p>teh</p>");
    expect(words(await checkSpellingNow(e))).toEqual(["teh"]);
    e.commands.setSpellcheck(false);
    expect(await checkSpellingNow(e)).toEqual([]);
    e.commands.setSpellcheck(true);
    expect(words(await checkSpellingNow(e))).toEqual(["teh"]);
  });

  it("collectWords breaks words at inline atoms", () => {
    const e = makeEditor('<p>ab<span data-field-instr="PAGE">1</span>cd</p>');
    expect(words(collectWords(e.state.doc, "en-US"))).toEqual(["ab", "cd"]);
  });
});

describe("proofing language in DOCX", () => {
  it("reads w:lang / w:noProof per run and the document default; writes them back", async () => {
    const styles = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
    const body =
      '<w:p><w:r><w:rPr><w:lang w:val="en-GB"/></w:rPr><w:t xml:space="preserve">Plain </w:t></w:r>' +
      '<w:r><w:rPr><w:lang w:val="fr-FR"/></w:rPr><w:t xml:space="preserve">Bonjour </w:t></w:r>' +
      '<w:r><w:rPr><w:noProof/></w:rPr><w:t>qwzx</w:t></w:r></w:p>';
    const imp = await readDocx(await buildDocx({ body, styles }));
    expect(imp.lang).toBe("en-GB");
    const e = makeEditor("<p></p>");
    applyDocxImport(e, imp);
    expect(docLanguage(e)).toBe("en-GB");
    const html = e.getHTML();
    expect(html).not.toContain('lang="en-GB"'); // redundant run language dropped
    expect(html).toContain('<span lang="fr-FR" class="doc-lang">Bonjour </span>');
    expect(html).toContain('data-noproof="true"');
    const input = collectDocxInput(e, { title: "t" });
    input.now = new Date("2026-09-27T00:00:00Z");
    const zip = await JSZip.loadAsync(await writeDocx(input));
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain('<w:lang w:val="fr-FR"/>');
    expect(doc).toContain("<w:noProof/>");
    expect(await zip.file("word/styles.xml")!.async("string")).toContain('<w:lang w:val="en-GB"/>');
  });
});
