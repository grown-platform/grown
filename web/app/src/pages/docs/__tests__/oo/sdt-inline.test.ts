// Ports of OnlyOffice's inline-level content control tests (behaviour
// only): word/content-control/inline-level/{cursorAndSelection,checkbox,
// date-time}.js. Fixtures are built with Grown's commands.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { makeEditor, paragraphText, pressKey, reviewText, setCursor, textblocks, typeText } from "../harness";
import {
  allSdts,
  insertContentControl,
  moveIntoControl,
  prOf,
  setSdtDate,
  toggleCheckbox,
  innerText,
  type SdtHit,
} from "../../sdt";

/** The only control in the document (fresh position). */
function only(e: Editor): SdtHit | null {
  return allSdts(e.state.doc)[0] ?? null;
}
const selectedOnly = (e: Editor, hit: SdtHit | null) =>
  !!hit && e.state.selection instanceof NodeSelection && e.state.selection.from === hit.pos;
const paraStart = (e: Editor) => textblocks(e)[0].pos;
const paraEnd = (e: Editor) => textblocks(e)[0].pos + textblocks(e)[0].node.content.size;

describe("OnlyOffice inline content controls: cursor and selection", () => {
  it("oo:word/content-control/inline-level/cursorAndSelection.js#Test behaviour of controls filled with placeholder", () => {
    for (const fromStart of [true, false]) {
      const key = fromStart ? "Delete" : "Backspace";
      const e = makeEditor("<p></p>");
      insertContentControl(e, "text");
      expect(paragraphText(e), "text with the placeholder").toBe("Your text here");
      expect(only(e)).not.toBeNull();
      setCursor(e, fromStart ? paraStart(e) : paraEnd(e));
      expect(only(e)!.node.attrs.plc).toBe(true);

      pressKey(e, key);
      expect(only(e)!.node.attrs.plc, `${key} once: still the placeholder`).toBe(true);
      expect(selectedOnly(e, only(e)), `${key} once: the control is selected`).toBe(true);

      pressKey(e, key);
      expect(only(e)!.node.attrs.plc, `${key} twice: placeholder gone`).toBe(false);
      expect(innerText(only(e)!.node)).toBe("");
      expect(selectedOnly(e, only(e))).toBe(true);

      pressKey(e, key);
      expect(only(e), `${key} three times: removed`).toBeNull();
      expect(paragraphText(e)).toBe("");
    }
  });

  it("oo:word/content-control/inline-level/cursorAndSelection.js#Test deletion checkbox content control", () => {
    for (const type of ["checkbox", "picture"] as const) {
      for (const fromStart of [true, false]) {
        const key = fromStart ? "Delete" : "Backspace";
        const e = makeEditor("<p></p>");
        insertContentControl(e, type);
        expect(only(e)).not.toBeNull();
        setCursor(e, fromStart ? paraStart(e) : paraEnd(e));
        pressKey(e, key);
        expect(selectedOnly(e, only(e)), `${type} ${key}: selected`).toBe(true);
        pressKey(e, key);
        expect(only(e), `${type} ${key}: removed`).toBeNull();
        expect(paragraphText(e)).toBe("");
      }
    }
  });
});

describe("OnlyOffice checkbox content control", () => {
  it("oo:word/content-control/inline-level/checkbox.js#Test various actions with checkbox content control", () => {
    const e = makeEditor("<p></p>");
    const symbols = { checkedSymbol: "T", uncheckedSymbol: "F" };
    expect(insertContentControl(e, "checkbox", { pr: { checkbox: { checked: false, ...symbols } } })).not.toBeNull();
    expect(prOf(only(e)!.node).checkbox?.checked).toBe(false);
    expect(paragraphText(e, 0)).toBe("F");

    const toggle = () => toggleCheckbox(e, only(e)!.pos);
    const checked = () => prOf(only(e)!.node).checkbox?.checked;
    toggle();
    expect(checked()).toBe(true);
    expect(paragraphText(e, 0), "toggle in normal mode").toBe("T");

    e.commands.setSuggesting(true);
    toggle();
    expect(checked()).toBe(false);
    expect(reviewText(e, 0), "toggle in review").toEqual([["add", "F"], ["remove", "T"]]);
    toggle();
    expect(checked()).toBe(true);
    expect(reviewText(e, 0), "toggle back in review").toEqual([["common", "T"]]);
    e.commands.setSuggesting(false);

    toggle();
    expect(checked()).toBe(false);
    expect(paragraphText(e, 0)).toBe("F");

    e.commands.setSuggesting(true);
    toggle();
    expect(checked()).toBe(true);
    expect(reviewText(e, 0)).toEqual([["add", "T"], ["remove", "F"]]);
    toggle();
    expect(checked()).toBe(false);
    expect(reviewText(e, 0)).toEqual([["common", "F"]]);

    // A second check box added while tracking: its symbol is an insertion.
    e.commands.setSuggesting(false);
    const f = makeEditor("<p>x</p><p></p>");
    f.commands.setSuggesting(true);
    setCursor(f, textblocks(f)[1].pos);
    insertContentControl(f, "checkbox", { pr: { checkbox: { checked: false, ...symbols } } });
    const box2 = () => allSdts(f.state.doc)[0];
    expect(prOf(box2().node).checkbox?.checked).toBe(false);
    expect(reviewText(f, 1), "adding a check box in review").toEqual([["add", "F"]]);
    toggleCheckbox(f, box2().pos);
    expect(prOf(box2().node).checkbox?.checked).toBe(true);
    expect(reviewText(f, 1), "toggle a check box added in review").toEqual([["add", "T"]]);
    toggleCheckbox(f, box2().pos);
    expect(reviewText(f, 1)).toEqual([["add", "F"]]);
  });
});

describe("OnlyOffice date picker content control", () => {
  it("oo:word/content-control/inline-level/date-time.js#Test temporary content control", () => {
    const init = () => {
      const e = makeEditor("<p></p>");
      insertContentControl(e, "date", { pr: { temporary: true } });
      return e;
    };
    let e = init();
    expect(only(e)).not.toBeNull();
    expect(paragraphText(e)).toBe("Enter a date");
    moveIntoControl(e, only(e)!.pos);
    typeText(e, "123");
    expect(only(e), "a temporary control goes once text is entered").toBeNull();
    expect(paragraphText(e)).toBe("123");

    e = init();
    setSdtDate(e, only(e)!.pos, "2024-07-24", "mm/dd/yyyy");
    expect(only(e), "a temporary control goes once a date is set").toBeNull();
    expect(paragraphText(e)).toBe("07/24/2024");
  });
});
