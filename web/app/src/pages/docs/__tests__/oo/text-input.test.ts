// Ports of OnlyOffice word/api/textInput.js (behaviour only): typing,
// correcting just-typed text (the autocorrect / IME re-conversion
// primitive, correctEnteredText in textOps.ts) and IME composition, alone
// and between two collaborating editors. The TextSpeaker, complex-script
// and in-shape variants are n/a (no screen-reader hook, the browser shapes
// text, no shapes yet).
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { addText, correctEnteredText, getSelectedText } from "../../textOps";
import {
  compose,
  composeText,
  makeEditor,
  makeSyncedEditors,
  paragraphPos,
  paragraphText,
  selectAll,
  setCursor,
  textblocks,
  typeText,
} from "../harness";

const caret = (e: Editor) => e.state.selection.from;
const left = (e: Editor) => setCursor(e, caret(e) - 1);

describe("OnlyOffice textInput", () => {
  it("oo:word/api/textInput.js#EnterText/CorrectEnterText/CompositeInput", () => {
    const e = makeEditor("<p></p>");
    selectAll(e);
    expect(getSelectedText(e)).toBe("\r\n");
    addText(e, "Hello World!");
    selectAll(e);
    expect(getSelectedText(e)).toBe("Hello World!\r\n");

    setCursor(e, paragraphPos(e, 0, 2));
    typeText(e, "123");
    expect(paragraphText(e, 0)).toBe("He123llo World!");
    typeText(e, "AA");
    expect(paragraphText(e, 0)).toBe("He123AAllo World!");

    // A correction only applies when the text before the caret matches.
    expect(correctEnteredText(e, "AB", "ABC")).toBe(false);
    expect(paragraphText(e, 0)).toBe("He123AAllo World!");
    expect(correctEnteredText(e, "AA", "ABC")).toBe(true);
    expect(paragraphText(e, 0)).toBe("He123ABCllo World!");

    typeText(e, "DD");
    left(e);
    expect(correctEnteredText(e, "DD", "CC")).toBe(false);
    expect(paragraphText(e, 0)).toBe("He123ABCDDllo World!");

    setCursor(e, paragraphPos(e, 0, paragraphText(e, 0).length));
    typeText(e, "qq");
    correctEnteredText(e, "!qq", "!?");
    expect(paragraphText(e, 0)).toBe("He123ABCDDllo World!?");

    // IME composition: only the final candidate is committed.
    const c = compose(e);
    c.update("WWW");
    c.update("123");
    c.end();
    expect(paragraphText(e, 0)).toBe("He123ABCDDllo World!?123");

    // A correction may reach back past the composed text.
    composeText(e, "Zzz");
    correctEnteredText(e, "3Zzz", "$");
    expect(paragraphText(e, 0)).toBe("He123ABCDDllo World!?12$");

    // Corrections that collapse into the preceding text.
    const f = makeEditor("<p></p>");
    composeText(f, "x");
    composeText(f, "yz");
    correctEnteredText(f, "yz", "x");
    expect(paragraphText(f, 0)).toBe("xx");

    // Sinhala input: the composition goes through several candidate
    // sequences (including an empty one) before committing "ෑඒ".
    e.chain().insertContentAt(e.state.doc.content.size, { type: "paragraph" }).run();
    setCursor(e, paragraphPos(e, 1, 0));
    typeText(e, "1");
    const s = compose(e);
    s.update([]);
    s.update([3536]);
    s.update([3537]);
    s.update([3537, 3474]);
    s.end();
    expect(paragraphText(e, 1)).toBe("1ෑඒ");
    const last = textblocks(e)[1];
    expect(caret(e)).toBe(last.pos + last.node.content.size);
    expect(e.state.selection).toBeInstanceOf(TextSelection);
  });

  it("oo:word/api/textInput.js#EnterText/CorrectEnterText/CompositeInput in collaboration", () => {
    const { editors, sync } = makeSyncedEditors(2);
    const [a, b] = editors;
    typeText(a, "ABC");
    sync();
    expect(paragraphText(a, 0)).toBe("ABC");
    expect(paragraphText(b, 0)).toBe("ABC");

    // Type, sync, correct, sync.
    left(a);
    typeText(a, "111");
    sync();
    correctEnteredText(a, "11", "23");
    sync();
    expect(paragraphText(a, 0)).toBe("AB123C");
    expect(paragraphText(b, 0)).toBe("AB123C");

    // Type and correct with no sync in between.
    typeText(a, "QQQ");
    correctEnteredText(a, "QQ", "RS");
    sync();
    expect(paragraphText(a, 0)).toBe("AB123QRSC");
    expect(paragraphText(b, 0)).toBe("AB123QRSC");

    // A concurrent edit by the other user doesn't disturb the correction.
    setCursor(b, paragraphPos(b, 0, 0));
    typeText(b, ">");
    typeText(a, "zz");
    correctEnteredText(a, "zz", "Z");
    sync();
    expect(paragraphText(a, 0)).toBe(">AB123QRSZC");
    expect(paragraphText(b, 0)).toBe(">AB123QRSZC");
  });
});
