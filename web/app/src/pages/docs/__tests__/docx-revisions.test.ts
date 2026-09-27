// DOCX tracked changes both ways (Docs M5): w:ins / w:del, w:rPrChange,
// w:pPrChange and inserted/deleted paragraph marks, with author and date,
// in the body and in headers.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as Y from "yjs";
import type { Editor } from "@tiptap/core";
import {
  makeEditor,
  paragraphPos,
  paragraphReviewTypes,
  paragraphTexts,
  pressKey,
  reviewText,
  selectText,
  setCursor,
  textblocks,
  typeText,
} from "./harness";
import { buildDocx, STYLES } from "./docx-fixture";
import { readDocx } from "../docx/read";
import { writeDocx } from "../docx/write";
import { applyDocxImport, collectDocxInput } from "../docx/apply";
import { collectChanges, parsePropsChange, setReviewClock } from "../changes";
import type { DocxImport } from "../docx/model";

const D1 = "2026-01-02T03:04:05Z";
const D2 = "2026-01-03T00:00:00Z";
const rev = (id: number, author: string, date: string) => `w:id="${id}" w:author="${author}" w:date="${date}"`;

const BODY =
  `<w:p><w:pPr><w:rPr><w:ins ${rev(1, "Ann", D1)}/></w:rPr></w:pPr>` +
  `<w:ins ${rev(2, "Ann", D1)}><w:r><w:t xml:space="preserve">new </w:t></w:r></w:ins>` +
  `<w:ins ${rev(3, "Ann", D1)}><w:r><w:rPr><w:b/></w:rPr><w:t>words</w:t></w:r></w:ins>` +
  `<w:r><w:t xml:space="preserve"> old</w:t></w:r></w:p>` +
  `<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange ${rev(4, "Bob", D2)}><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:pPrChange></w:pPr>` +
  `<w:r><w:rPr><w:b/><w:rPrChange ${rev(5, "Bob", D2)}><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t xml:space="preserve">bold now </w:t></w:r>` +
  `<w:del ${rev(6, "Bob", D2)}><w:r><w:delText>gone</w:delText></w:r></w:del>` +
  `<w:ins ${rev(7, "Bob", D2)}><w:r><w:t>here</w:t></w:r></w:ins></w:p>` +
  `<w:p><w:pPr><w:rPr><w:del ${rev(8, "Cy", D1)}/></w:rPr></w:pPr><w:r><w:t>joined</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>tail</w:t></w:r></w:p>`;

const HEADER = `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t xml:space="preserve">Draft </w:t></w:r><w:ins ${rev(9, "Ann", D1)}><w:r><w:t>v2</w:t></w:r></w:ins></w:p></w:hdr>`;

async function importInto(bytes: Uint8Array): Promise<{ editor: Editor; imp: DocxImport; ydoc: Y.Doc }> {
  const imp = await readDocx(bytes);
  const ydoc = new Y.Doc();
  const editor = makeEditor("<p></p>", { ydoc });
  applyDocxImport(editor, imp);
  return { editor, imp, ydoc };
}

async function exportFrom(editor: Editor): Promise<Uint8Array> {
  const input = collectDocxInput(editor, { title: "Revisions" });
  input.now = new Date("2026-09-26T00:00:00Z");
  return writeDocx(input);
}

async function documentXml(bytes: Uint8Array, part = "word/document.xml"): Promise<string> {
  return (await JSZip.loadAsync(bytes)).file(part)!.async("string");
}

beforeEach(() => setReviewClock(() => new Date("2026-09-26T12:00:00Z")));
afterEach(() => setReviewClock(null));

describe("docx revisions: reader", () => {
  it("maps insertions, deletions, formatting and paragraph changes with author and date", async () => {
    const { editor, imp } = await importInto(await buildDocx({ body: BODY, styles: STYLES, header: HEADER }));
    expect(paragraphTexts(editor)).toEqual(["new words old", "bold now gonehere", "joined", "tail"]);
    expect(reviewText(editor, 0)).toEqual([["add", "new words"], ["common", " old"]]);
    expect(reviewText(editor, 1)).toEqual([["common", "bold now "], ["remove", "gone"], ["add", "here"]]);
    expect(paragraphReviewTypes(editor)).toEqual(["add", "common", "remove", "common"]);

    const changes = collectChanges(editor.state.doc);
    const summary = changes.map((c) => [c.kind, c.author, c.date, c.inserted, c.deleted]);
    expect(summary).toEqual([
      // Two runs by Ann at one time: one change; the paragraph mark (after
      // unchanged text) is another.
      ["insert", "Ann", D1, "new words", ""],
      ["insert", "Ann", D1, "¶", ""],
      ["paragraph", "Bob", D2, "", ""],
      ["format", "Bob", D2, "", ""],
      // Adjacent deletion + insertion by Bob at one time: a replacement.
      ["replace", "Bob", D2, "here", "gone"],
      ["delete", "Cy", D1, "", "¶"],
    ]);
    const fmt = changes.find((c) => c.kind === "format")!;
    expect(JSON.parse(String(fmt.parts[0].mark!.attrs.old))).toEqual([{ type: "italic" }]);
    const props = parsePropsChange(textblocks(editor)[1].node.attrs.propsChange)!;
    expect(props).toMatchObject({ author: "Bob", date: D2, type: "heading", attrs: { level: 1 } });
    expect(textblocks(editor)[1].node.attrs.textAlign).toBe("center");

    // Header revisions come through the margin schema.
    const hdr = JSON.stringify(imp.header);
    expect(hdr).toContain('"type":"insertion"');
    expect(hdr).toContain('"author":"Ann"');

    // Resolving works on imported changes: rejecting Ann's inserted
    // paragraph mark joins the first two paragraphs; Cy's deleted one stays.
    editor.commands.rejectAllSuggestions();
    expect(paragraphTexts(editor)).toEqual([" oldbold now gone", "joined", "tail"]);
    expect(editor.getHTML()).toContain("<em>bold now </em>");
    expect(collectChanges(editor.state.doc)).toEqual([]);
  });
});

describe("docx revisions: writer", () => {
  it("writes w:ins, w:del, w:rPrChange, w:pPrChange and paragraph-mark revisions in schema order", async () => {
    const e = makeEditor("<p>Hello world</p><p>Second line</p><p>Third</p>", { suggesting: true, userName: "Dee" });
    setCursor(e, paragraphPos(e, 0, 11));
    typeText(e, "!");
    selectText(e, "world");
    pressKey(e, "Backspace");
    selectText(e, "Second");
    e.commands.toggleBold();
    setCursor(e, paragraphPos(e, 1, 2));
    e.commands.setTextAlign("right");
    setCursor(e, paragraphPos(e, 2, 0));
    pressKey(e, "Backspace"); // deletes the paragraph mark of "Second line"
    setCursor(e, paragraphPos(e, 2, 5));
    pressKey(e, "Enter");
    const xml = await documentXml(await exportFrom(e));
    expect(xml).toMatch(/<w:ins w:id="\d+" w:author="Dee" w:date="2026-09-26T12:00:00Z"><w:r><w:t xml:space="preserve">!<\/w:t><\/w:r><\/w:ins>/);
    expect(xml).toMatch(/<w:del w:id="\d+" w:author="Dee" w:date="2026-09-26T12:00:00Z"><w:r><w:delText xml:space="preserve">world<\/w:delText><\/w:r><\/w:del>/);
    // rPrChange is the last child of rPr and holds the old (empty) rPr.
    expect(xml).toMatch(/<w:rPr><w:b\/><w:rPrChange w:id="\d+" w:author="Dee" w:date="[^"]+"><w:rPr\/><\/w:rPrChange><\/w:rPr><w:t xml:space="preserve">Second<\/w:t>/);
    // pPr: jc, then the paragraph mark's rPr (deleted), then pPrChange.
    expect(xml).toMatch(/<w:pPr><w:jc w:val="right"\/><w:rPr><w:del w:id="\d+" w:author="Dee" w:date="[^"]+"\/><\/w:rPr><w:pPrChange w:id="\d+" w:author="Dee" w:date="[^"]+"><w:pPr\/><\/w:pPrChange><\/w:pPr>/);
    expect(xml).toMatch(/<w:pPr><w:rPr><w:ins w:id="\d+" w:author="Dee" w:date="[^"]+"\/><\/w:rPr><\/w:pPr><w:r><w:t xml:space="preserve">Third<\/w:t>/);
    // Revision ids are unique.
    const ids = [...xml.matchAll(/<w:(?:ins|del|rPrChange|pPrChange) w:id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("round-trips Grown → docx → Grown → docx → Grown with the same changes", async () => {
    const e = makeEditor("<p>Alpha beta gamma</p><p>Delta</p>", { suggesting: true, userName: "Eve" });
    selectText(e, "beta");
    typeText(e, "BETA");
    selectText(e, "gamma");
    e.commands.toggleItalic();
    setCursor(e, paragraphPos(e, 1, 0));
    e.commands.toggleHeading({ level: 2 });
    setCursor(e, paragraphPos(e, 1, 5));
    pressKey(e, "Enter");
    typeText(e, "Epsilon");
    const summary = (ed: Editor) =>
      collectChanges(ed.state.doc).map((c) => [c.kind, c.author, c.date, c.inserted, c.deleted, c.formatted]);
    const first = await importInto(await exportFrom(e));
    expect(summary(first.editor)).toEqual(summary(e));
    expect(paragraphTexts(first.editor)).toEqual(paragraphTexts(e));
    const second = await importInto(await exportFrom(first.editor));
    expect(second.editor.getJSON()).toEqual(first.editor.getJSON());
    // Rejecting everything gives back the original text in both.
    e.commands.rejectAllSuggestions();
    second.editor.commands.rejectAllSuggestions();
    expect(paragraphTexts(second.editor)).toEqual(["Alpha beta gamma", "Delta"]);
    expect(second.editor.getHTML()).toBe(e.getHTML());
  });

  it("writes header revisions", async () => {
    const { editor } = await importInto(await buildDocx({ body: "<w:p><w:r><w:t>Body</w:t></w:r></w:p>", styles: STYLES, header: HEADER }));
    const header = await documentXml(await exportFrom(editor), "word/header1.xml");
    expect(header).toMatch(/<w:ins w:id="\d+" w:author="Ann" w:date="2026-01-02T03:04:05Z"><w:r><w:t xml:space="preserve">v2<\/w:t><\/w:r><\/w:ins>/);
  });
});
