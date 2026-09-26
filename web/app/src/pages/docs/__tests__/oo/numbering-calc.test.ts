// Ports of OnlyOffice word/numbering/numberingCalculation.js (behaviour
// only): numbering that comes from paragraph styles, and which paragraphs
// belong to a list. Levels are Grown's library lists (numbering.ts).
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { makeEditor, numberingText, setBlockAttrs } from "../harness";
import { getDocModel, paragraphsInList } from "../../docModel";
import { presetById, type LvlDef } from "../../numbering";
import type { StyleDef } from "../../styles";

let styleCounter = 0;
function createStyle(e: Editor): StyleDef {
  const id = `style${++styleCounter}`;
  const s: StyleDef = { id, name: id, type: "paragraph", basedOn: "Normal" };
  getDocModel(e).sheet.put(s);
  return s;
}

/** A 1. / 1.1. / 1.1.1. list (OnlyOffice's multilevel preset 7). */
function createNum(e: Editor, link: (lvls: LvlDef[]) => void = () => {}): string {
  const lvls = presetById("ml-legal")!.lvls();
  link(lvls);
  return getDocModel(e).numbering.createList(lvls);
}

function setStyleNum(e: Editor, s: StyleDef, numId: string | null, lvl?: number) {
  const sheet = getDocModel(e).sheet;
  const cur = sheet.get(s.id)!;
  const pPr = { ...cur.pPr };
  if (numId == null) {
    delete pPr.numId;
    delete pPr.numLvl;
  } else {
    pPr.numId = numId;
    if (lvl === undefined) delete pPr.numLvl;
    else pPr.numLvl = lvl;
  }
  sheet.put({ ...cur, pPr });
}

const texts = (e: Editor, n: number) => Array.from({ length: n }, (_, i) => numberingText(e, i));

describe("OnlyOffice numbering calculation", () => {
  it("oo:word/numbering/numberingCalculation.js#Test the numbering specified in a style", () => {
    const e = makeEditor("<p>Style1</p><p>Style2</p><p>Style3</p>");
    const [s0, s1, s2] = [createStyle(e), createStyle(e), createStyle(e)];
    [s0, s1, s2].forEach((s, i) => setBlockAttrs(e, i, { styleId: s.id }));
    expect(texts(e, 3)).toEqual(["", "", ""]);

    // Numbering in the styles, with the right levels.
    const num = createNum(e, (l) => {
      l[0].pStyle = s0.id;
      l[1].pStyle = s1.id;
      l[2].pStyle = s2.id;
    });
    setStyleNum(e, s0, num, 0);
    setStyleNum(e, s1, num, 1);
    setStyleNum(e, s2, num, 2);
    expect(texts(e, 3)).toEqual(["1.", "1.1.", "1.1.1."]);

    // Numbering in the styles without levels: level 0, and only the style
    // linked to level 0 is numbered (Word's rule).
    setStyleNum(e, s0, num);
    setStyleNum(e, s1, num);
    setStyleNum(e, s2, num);
    expect(texts(e, 3)).toEqual(["1.", "", ""]);

    // Styles inheriting from each other: the chain contains the linked style.
    setStyleNum(e, s1, null);
    setStyleNum(e, s2, null);
    const sheet = getDocModel(e).sheet;
    sheet.put({ ...sheet.get(s1.id)!, basedOn: s0.id });
    sheet.put({ ...sheet.get(s2.id)!, basedOn: s1.id });
    expect(texts(e, 3)).toEqual(["1.", "2.", "3."]);
  });

  it("oo:word/numbering/numberingCalculation.js#Test numbering collection", () => {
    const e = makeEditor("<p>Paragraph 1</p><p>Paragraph 2</p><p>Paragraph 3</p><p>Paragraph 4</p>");
    const style = createStyle(e);
    setBlockAttrs(e, 1, { styleId: style.id });
    const num = createNum(e);
    expect(paragraphsInList(e, num, 0)).toEqual([]);

    setBlockAttrs(e, 0, { numId: num, numLvl: 0 });
    expect(paragraphsInList(e, num, 0)).toEqual([0]);
    expect(numberingText(e, 0)).toBe("1.");

    // Numbering added to a style reaches the paragraph that already uses it.
    const sheet = getDocModel(e).sheet;
    getDocModel(e).numbering.setLevel(num, 0, { ...getDocModel(e).numbering.level(num, 0)!, pStyle: style.id });
    setStyleNum(e, style, num, 0);
    expect(paragraphsInList(e, num, 0)).toEqual([0, 1]);
    expect(numberingText(e, 1)).toBe("2.");

    setBlockAttrs(e, 2, { styleId: style.id });
    expect(paragraphsInList(e, num, 0)).toEqual([0, 1, 2]);
    expect(numberingText(e, 2)).toBe("3.");

    setBlockAttrs(e, 3, { styleId: style.id });
    expect(paragraphsInList(e, num, 0)).toEqual([0, 1, 2, 3]);
    expect(numberingText(e, 3)).toBe("4.");

    // Direct numId "0" cancels the style's numbering.
    setBlockAttrs(e, 3, { numId: "0", numLvl: 0 });
    expect(paragraphsInList(e, num, 0)).toEqual([0, 1, 2]);
    expect(numberingText(e, 3)).toBe("");

    // Back to the default style: no numbering.
    setBlockAttrs(e, 2, { styleId: null });
    expect(paragraphsInList(e, num, 0)).toEqual([0, 1]);
    expect(numberingText(e, 2)).toBe("");

    // Remove the numbering link from the style.
    getDocModel(e).numbering.setLevel(num, 0, { ...getDocModel(e).numbering.level(num, 0)!, pStyle: null });
    setStyleNum(e, sheet.get(style.id)!, null);
    expect(paragraphsInList(e, num, 0)).toEqual([0]);
    expect(numberingText(e, 1)).toBe("");

    // Remove the first paragraph: nothing left in the list.
    const first = e.state.doc.child(0);
    e.view.dispatch(e.state.tr.delete(0, first.nodeSize));
    expect(paragraphsInList(e, num, 0)).toEqual([]);
  });
});
