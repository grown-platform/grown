// Ports of OnlyOffice's form tests (behaviour only): word/forms/forms.js
// and word/forms/complexForm.js in the Docs editor, and the text-form part
// of word/js-api/api-text-form.js / api-inline-level-sdt.js. The pure
// format / mask cases of forms.js also run against the Forms app's
// validators (pages/forms/validate.test.ts, CC4); here the same cases go
// through the editor's fields.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { makeEditor, paragraphText, pressKey, setCursor, textblocks, typeText } from "../harness";
import {
  allSdts,
  canFill,
  colorRgba,
  innerText,
  insertContentControl,
  mainForm,
  moveIntoControl,
  prOf,
  removeContentControl,
  sdtAt,
  sdtById,
  setCheckbox,
  setFillMode,
  setFormFixed,
  setSdtDate,
  setSdtText,
  updateContentControl,
  type SdtHit,
  type SdtPr,
  type SdtType,
} from "../../sdt";
import { allForms, getAllFormsData, isAllRequiredFormsFilled, maxCharacters, setAllFormsData } from "../../forms";

const idOf = (h: SdtHit) => String(h.node.attrs.sdtId);
const fresh = (e: Editor, id: string) => sdtById(e.state.doc, id)!;

/** Adds a form field at the end of the last paragraph. */
function addForm(e: Editor, type: SdtType, pr: Partial<SdtPr> = {}, key = ""): string {
  const tbs = textblocks(e);
  const last = tbs[tbs.length - 1];
  setCursor(e, last.pos + last.node.content.size);
  const hit = insertContentControl(e, type, { pr: { form: { key }, ...pr } })!;
  return idOf(hit);
}

describe("OnlyOffice forms in the editor", () => {
  it("oo:word/forms/forms.js#Check remove/delete in editing mode", () => {
    const e = makeEditor("<p></p>");
    const para = () => textblocks(e)[0];
    let id = addForm(e, "text");
    expect(fresh(e, id).node.attrs.plc).toBe(true);
    setCursor(e, para().pos + para().node.content.size);
    pressKey(e, "Backspace");
    expect(fresh(e, id).node.attrs.plc).toBe(true);
    expect(e.state.selection instanceof NodeSelection && e.state.selection.from === fresh(e, id).pos, "right of the form: selected").toBe(true);
    pressKey(e, "Backspace");
    expect(sdtById(e.state.doc, id), "second Backspace removes it").toBeNull();

    id = addForm(e, "text");
    setCursor(e, para().pos);
    pressKey(e, "Delete");
    expect(e.state.selection instanceof NodeSelection).toBe(true);
    pressKey(e, "Delete");
    expect(sdtById(e.state.doc, id)).toBeNull();

    id = addForm(e, "text");
    setSdtText(e, fresh(e, id).pos, "Inner Text");
    expect(fresh(e, id).node.attrs.plc).toBe(false);
    expect(innerText(fresh(e, id).node)).toBe("Inner Text");
    setCursor(e, para().pos + para().node.content.size);
    pressKey(e, "Backspace");
    expect(sdtAt(e.state)?.pos).toBe(fresh(e, id).pos);
    pressKey(e, "Backspace");
    expect(sdtById(e.state.doc, id)).toBeNull();
  });

  it("oo:word/forms/forms.js#Check format in text form", () => {
    const e = makeEditor("<p></p>");
    const id = addForm(e, "text", { textForm: { format: { type: "digit" } } });
    setFillMode(e, true);
    moveIntoControl(e, fresh(e, id).pos);
    expect(fresh(e, id).node.attrs.plc).toBe(true);
    expect(sdtAt(e.state)?.pos).toBe(fresh(e, id).pos);
    typeText(e, "AB12C3");
    expect(innerText(fresh(e, id).node), "digits only").toBe("123");

    updateContentControl(e, fresh(e, id).pos, { textForm: { format: { type: "letter" } } });
    moveIntoControl(e, fresh(e, id).pos, true);
    typeText(e, "A1");
    expect(innerText(fresh(e, id).node), "letters now: nothing fits after digits").toBe("123");
    pressKey(e, "Backspace");
    pressKey(e, "Backspace");
    pressKey(e, "Backspace");
    expect(fresh(e, id).node.attrs.plc, "emptied: the placeholder is back").toBe(true);
    typeText(e, "AB12C3");
    expect(innerText(fresh(e, id).node)).toBe("ABC");

    // A second field with a mask.
    setFillMode(e, false);
    e.commands.setContent(`${e.getHTML()}<p></p>`);
    const id2 = addForm(e, "text");
    expect(maxCharacters(prOf(fresh(e, id2).node))).toBe(-1);
    updateContentControl(e, fresh(e, id2).pos, { textForm: { format: { type: "mask", value: "999-aaa" } } });
    expect(maxCharacters(prOf(fresh(e, id2).node))).toBe(7);
    setFillMode(e, true);
    const first = allSdts(e.state.doc)[0];
    moveIntoControl(e, fresh(e, id2).pos);
    typeText(e, "112-A");
    moveIntoControl(e, first.pos);
    expect(innerText(fresh(e, id2).node)).toBe("112-A");

    moveIntoControl(e, fresh(e, id2).pos, true);
    typeText(e, "B1");
    expect(innerText(fresh(e, id2).node), "typed as is").toBe("112-AB1");
    moveIntoControl(e, first.pos);
    expect(innerText(fresh(e, id2).node), "leaving: back to the last value that fit").toBe("112-A");

    moveIntoControl(e, fresh(e, id2).pos, true);
    typeText(e, "BB");
    moveIntoControl(e, first.pos);
    moveIntoControl(e, fresh(e, id2).pos, true);
    typeText(e, "C");
    moveIntoControl(e, first.pos);
    expect(innerText(fresh(e, id2).node), "the mask is full").toBe("112-ABB");
  });

  it("oo:word/forms/forms.js#Check filling out the required forms", () => {
    const e = makeEditor("<p></p><p></p><p></p>");
    expect(allForms(e.state.doc).length).toBe(0);
    const at = (i: number, end: boolean) => {
      const b = textblocks(e)[i];
      setCursor(e, end ? b.pos + b.node.content.size : b.pos);
    };
    at(0, false);
    insertContentControl(e, "checkbox", { pr: { form: { key: "" } } });
    at(0, true);
    insertContentControl(e, "comboBox", { pr: { form: { key: "" } } });
    at(0, true);
    insertContentControl(e, "comboBox"); // a plain control, not a form
    at(1, false);
    const box = idOf(insertContentControl(e, "checkbox", { pr: { form: { key: "" } } })!);
    at(1, true);
    const text = idOf(insertContentControl(e, "text", { pr: { form: { key: "" } } })!);
    at(2, true);
    const text2 = idOf(insertContentControl(e, "text", { pr: { form: { key: "" } } })!);
    expect(allForms(e.state.doc).length).toBe(5);

    setFillMode(e, true);
    const filled = () => isAllRequiredFormsFilled(e.state.doc);
    expect(filled(), "nothing required").toBe(true);
    const setRequired = (id: string) => updateContentControl(e, fresh(e, id).pos, { form: { ...prOf(fresh(e, id).node).form!, required: true } });
    setRequired(box);
    expect(filled(), "required check box").toBe(false);
    setCheckbox(e, fresh(e, box).pos, true);
    expect(filled()).toBe(true);
    setRequired(text);
    expect(filled()).toBe(false);
    moveIntoControl(e, fresh(e, text).pos, true);
    typeText(e, "AB");
    expect(innerText(fresh(e, text).node)).toBe("AB");
    expect(filled()).toBe(true);

    updateContentControl(e, fresh(e, text2).pos, { textForm: { format: { type: "mask", value: "999-aaa" } } });
    expect(filled(), "an empty field with a mask").toBe(true);
    moveIntoControl(e, fresh(e, text2).pos, true);
    typeText(e, "123");
    expect(innerText(fresh(e, text2).node)).toBe("123");
    expect(filled(), "mask filled too short").toBe(false);
    typeText(e, "-ABC");
    expect(innerText(fresh(e, text2).node)).toBe("123-ABC");
    expect(filled()).toBe(true);
    pressKey(e, "Backspace");
    pressKey(e, "Backspace");
    typeText(e, "12");
    expect(innerText(fresh(e, text2).node)).toBe("123-A12");
    expect(filled(), "wrong characters for the mask").toBe(false);
    pressKey(e, "Backspace");
    pressKey(e, "Backspace");
    typeText(e, "ABC");
    expect(innerText(fresh(e, text2).node), "too long: the last letter doesn't fit").toBe("123-AAB");
    expect(filled()).toBe(true);

    const url = "https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)";
    updateContentControl(e, fresh(e, text2).pos, { textForm: { format: { type: "regexp", value: url } } });
    expect(filled(), "the value is no hyperlink").toBe(false);
    setSdtText(e, fresh(e, text2).pos, "");
    expect(filled(), "cleared").toBe(true);
    setSdtText(e, fresh(e, text2).pos, "https://www.onlyoffice.com/");
    expect(filled()).toBe(true);
  });

  it("oo:word/forms/forms.js#Check GetAllForms function", () => {
    const e = makeEditor("<p>Hello Word!</p><p>Абракадабра</p>");
    expect(allForms(e.state.doc).length).toBe(0);
    setCursor(e, 1);
    insertContentControl(e, "checkbox", { pr: { form: { key: "" } } });
    expect(allForms(e.state.doc).length).toBe(1);
    setCursor(e, e.state.doc.content.size - 1);
    insertContentControl(e, "comboBox", { pr: { form: { key: "" } } });
    expect(allForms(e.state.doc).length).toBe(2);
    setCursor(e, e.state.doc.content.size - 1);
    insertContentControl(e, "comboBox");
    expect(allForms(e.state.doc).length, "a plain combo box is no form").toBe(2);
  });

  it("oo:word/forms/forms.js#Check GetAllFormsData/SetAllFormsData", () => {
    const e = makeEditor("<p></p>");
    const text = (key: string, value: string) => {
      const id = addForm(e, "text", {}, key);
      setSdtText(e, fresh(e, id).pos, value);
      return id;
    };
    const radio = (group: string, choice: string) => addForm(e, "checkbox", { checkbox: { checked: false, checkedSymbol: "☒", uncheckedSymbol: "☐", groupKey: group, choiceName: choice } }, choice);
    const t1 = text("TextForm1", "123");
    const t11 = text("TextForm1", "qqq");
    const t2 = text("TextForm2", "222");
    const t3 = text("TextForm3", "333");
    const r = [radio("Group1", "Choice1"), radio("Group1", "123"), radio("Group1", "Last"), radio("Group2", "Choice1"), radio("Group2", "Choice2")];
    addForm(e, "checkbox", {}, "CheckBox1");
    addForm(e, "dropDownList", { items: [{ value: "v1", label: "Item1" }, { value: "v2", label: "Item2" }] }, "DropDown1");
    addForm(e, "comboBox", { items: [{ value: "opt1", label: "Option1" }, { value: "opt2", label: "Option2" }] }, "ComboBox1");
    const dp = addForm(e, "date", {}, "DatePicker1");
    setSdtDate(e, fresh(e, dp).pos, "2024-07-24", "mm/dd/yyyy");

    const expected = (t1v: string, t2v: string, g1: string, g2: string) => [
      { key: "TextForm1", value: t1v, tag: "", type: "text", role: "" },
      { key: "TextForm2", value: t2v, tag: "", type: "text", role: "" },
      { key: "TextForm3", value: "333", tag: "", type: "text", role: "" },
      { key: "Group1", value: g1, tag: "", type: "radio", role: "", options: [{ value: "Choice1", label: "" }, { value: "123", label: "" }, { value: "Last", label: "" }] },
      { key: "Group2", value: g2, tag: "", type: "radio", role: "", options: [{ value: "Choice1", label: "" }, { value: "Choice2", label: "" }] },
      { key: "CheckBox1", value: false, tag: "", type: "checkBox", role: "", options: [true, false], label: "" },
      { key: "DropDown1", value: "", tag: "", type: "dropDownList", role: "", options: [{ value: "v1", label: "Item1" }, { value: "v2", label: "Item2" }] },
      { key: "ComboBox1", value: "", tag: "", type: "comboBox", role: "", options: [{ value: "opt1", label: "Option1" }, { value: "opt2", label: "Option2" }] },
      { key: "DatePicker1", value: "07/24/2024", tag: "", type: "dateTime", role: "", format: "mm/dd/yyyy", lang: "en-US" },
    ];
    expect(getAllFormsData(e.state.doc)).toEqual(expected("123", "222", "", ""));

    setFillMode(e, true);
    setAllFormsData(e, [
      { key: "TextForm1", value: "text1" },
      { key: "TextForm2", value: "another text", type: "text" },
      { key: "Group1", value: "Last" },
      { key: "Group2", value: "Choice2" },
    ]);
    expect(innerText(fresh(e, t1).node)).toBe("text1");
    expect(innerText(fresh(e, t11).node)).toBe("text1");
    expect(innerText(fresh(e, t2).node)).toBe("another text");
    expect(innerText(fresh(e, t3).node)).toBe("333");
    expect(r.map((id) => prOf(fresh(e, id).node).checkbox?.checked)).toEqual([false, false, true, false, true]);
    expect(getAllFormsData(e.state.doc)).toEqual(expected("text1", "another text", "Last", "Choice2"));
  });
});

/** A complex form "111<text>222<text>333" built with the editor. */
function complexForm(e: Editor, sub2: SdtType = "text"): { complex: string; sub: string[] } {
  const complex = idOf(insertContentControl(e, "complex", { pr: { form: { key: "" } } })!);
  const inside = (end = true) => moveIntoControl(e, fresh(e, complex).pos, end);
  inside();
  typeText(e, "111");
  inside();
  const a = idOf(insertContentControl(e, "text", { pr: { form: { key: "" } } })!);
  inside();
  typeText(e, "222");
  inside();
  const b = idOf(insertContentControl(e, sub2, { pr: { form: { key: "" } } })!);
  inside();
  typeText(e, "333");
  return { complex, sub: [a, b] };
}

describe("OnlyOffice complex forms in the editor", () => {
  it("oo:word/forms/complexForm.js#Check main form for subforms", () => {
    const e = makeEditor("<p></p>");
    const complex = idOf(insertContentControl(e, "complex", { pr: { form: { key: "" } } })!);
    const ids: string[] = [];
    for (const t of ["text", "comboBox", "checkbox", "picture"] as SdtType[]) {
      moveIntoControl(e, fresh(e, complex).pos, true);
      ids.push(idOf(insertContentControl(e, t, { pr: { form: { key: "" } } })!));
    }
    expect(mainForm(e.state.doc, fresh(e, complex).pos)?.pos).toBe(fresh(e, complex).pos);
    for (const id of ids) expect(mainForm(e.state.doc, fresh(e, id).pos)?.pos, prOf(fresh(e, id).node).type).toBe(fresh(e, complex).pos);
    expect(allForms(e.state.doc).length, "one form").toBe(1);
  });

  it("oo:word/forms/complexForm.js#Check conversion to fixed and vice versa", () => {
    const e = makeEditor("<p></p>");
    const { complex, sub } = complexForm(e);
    setFillMode(e, true);
    setSdtText(e, fresh(e, sub[0]).pos, "abc def");
    setSdtText(e, fresh(e, sub[1]).pos, "ABC DEF");
    setFillMode(e, false);
    expect(innerText(fresh(e, complex).node)).toBe("111abc def222ABC DEF333");
    for (const fixed of [true, false]) {
      moveIntoControl(e, fresh(e, sub[0]).pos, true);
      expect(sdtAt(e.state)?.pos).toBe(fresh(e, sub[0]).pos);
      expect(setFormFixed(e, fresh(e, sub[0]).pos, fixed)).toBe(true);
      expect(prOf(fresh(e, sub[0]).node).form?.fixed).toBe(fixed);
      moveIntoControl(e, fresh(e, sub[0]).pos, true);
      expect(sdtAt(e.state)?.pos, "still in the form field").toBe(fresh(e, sub[0]).pos);
      expect(canFill(e.state, fresh(e, sub[0]).node)).toBe(true);
    }
  });

  it("oo:word/forms/complexForm.js#Positioning, moving cursor and adding/removing text", () => {
    const e = makeEditor("<p>Hello Word!</p><p>Абракадабра</p>");
    setCursor(e, 1);
    const { complex, sub } = complexForm(e);
    expect(allForms(e.state.doc).length).toBe(1);
    expect(prOf(fresh(e, sub[0]).node).form).toBeTruthy();
    expect(fresh(e, sub[0]).node.attrs.plc).toBe(true);

    setFillMode(e, true);
    moveIntoControl(e, fresh(e, sub[0]).pos);
    typeText(e, "abc");
    expect(fresh(e, sub[0]).node.attrs.plc).toBe(false);
    moveIntoControl(e, fresh(e, sub[1]).pos);
    typeText(e, "def");
    expect(fresh(e, sub[1]).node.attrs.plc).toBe(false);

    // Fill mode: arrows cross from field to field at their edges.
    moveIntoControl(e, fresh(e, sub[1]).pos);
    pressKey(e, "ArrowLeft");
    expect(sdtAt(e.state)?.pos, "left of field 2: end of field 1").toBe(fresh(e, sub[0]).pos);
    expect(e.state.selection.from).toBe(fresh(e, sub[0]).pos + fresh(e, sub[0]).node.nodeSize - 1);
    moveIntoControl(e, fresh(e, sub[1]).pos, true);
    pressKey(e, "ArrowRight");
    expect(sdtAt(e.state)?.pos, "right of the last field: stays").toBe(fresh(e, sub[1]).pos);

    // Typing into the fields; the complex form's own text stays.
    setSdtText(e, fresh(e, sub[0]).pos, "");
    setSdtText(e, fresh(e, sub[1]).pos, "");
    expect(fresh(e, sub[0]).node.attrs.plc && fresh(e, sub[1]).node.attrs.plc && !fresh(e, complex).node.attrs.plc).toBe(true);
    moveIntoControl(e, fresh(e, sub[0]).pos);
    typeText(e, "abcdef");
    expect(innerText(fresh(e, sub[0]).node)).toBe("abcdef");
    expect(fresh(e, sub[1]).node.attrs.plc).toBe(true);
    pressKey(e, "ArrowRight");
    typeText(e, "ABC");
    expect(innerText(fresh(e, complex).node)).toBe("111abcdef222ABC333");

    // Max characters: what doesn't fit goes on into the next field.
    setSdtText(e, fresh(e, sub[0]).pos, "");
    setSdtText(e, fresh(e, sub[1]).pos, "");
    updateContentControl(e, fresh(e, sub[0]).pos, { textForm: { maxChars: 3 } });
    expect(maxCharacters(prOf(fresh(e, sub[0]).node))).toBe(3);
    moveIntoControl(e, fresh(e, sub[0]).pos);
    typeText(e, "abcdef");
    expect(innerText(fresh(e, sub[0]).node)).toBe("abc");
    expect(innerText(fresh(e, sub[1]).node)).toBe("def");
    expect(sdtAt(e.state)?.pos).toBe(fresh(e, sub[1]).pos);
    expect(e.state.selection.from, "caret at the end of field 2").toBe(fresh(e, sub[1]).pos + fresh(e, sub[1]).node.nodeSize - 1);
    expect(innerText(fresh(e, complex).node)).toBe("111abc222def333");

    // Fixed text of the complex form can't be typed over in fill mode.
    const c = fresh(e, complex);
    setCursor(e, c.pos + 2);
    typeText(e, "X");
    expect(innerText(fresh(e, complex).node)).toBe("111abc222def333");
  });
});

describe("OnlyOffice text form API", () => {
  it("oo:word/js-api/api-text-form.js#Placeholder", () => {
    const e = makeEditor("<p></p>");
    const id = addForm(e, "text", { placeholder: "Enter your name" }, "Name");
    expect(prOf(fresh(e, id).node).placeholder).toBe("Enter your name");
    expect(paragraphText(e)).toBe("Enter your name");
    updateContentControl(e, fresh(e, id).pos, { placeholder: "TEST" });
    expect(prOf(fresh(e, id).node).placeholder).toBe("TEST");
    expect(paragraphText(e), "an empty field shows the new placeholder").toBe("TEST");
  });

  it("oo:word/js-api/api-text-form.js#Delete", () => {
    const e = makeEditor("<p>Before</p>");
    let id = addForm(e, "text", { placeholder: "Enter your name" }, "Name");
    typeText(e, "");
    setCursor(e, textblocks(e)[0].pos + textblocks(e)[0].node.content.size);
    typeText(e, "After");
    expect(paragraphText(e)).toBe("BeforeEnter your nameAfter");
    removeContentControl(e, fresh(e, id).pos, false);
    expect(sdtById(e.state.doc, id)).toBeNull();
    expect(paragraphText(e)).toBe("BeforeAfter");

    e.commands.setContent("<p>Before</p>");
    id = addForm(e, "text", {}, "Name");
    setSdtText(e, fresh(e, id).pos, "Inside");
    setCursor(e, textblocks(e)[0].pos + textblocks(e)[0].node.content.size);
    typeText(e, "After");
    removeContentControl(e, fresh(e, id).pos, true);
    expect(sdtById(e.state.doc, id)).toBeNull();
    expect(paragraphText(e)).toBe("BeforeInsideAfter");
  });

  it("oo:word/js-api/api-text-form.js#SetBorderColor, GetBorderColor", () => {
    const e = makeEditor("<p></p>");
    const id = addForm(e, "text", {}, "Name");
    const border = () => colorRgba(prOf(fresh(e, id).node).borderColor);
    expect(border()).toBeNull();
    updateContentControl(e, fresh(e, id).pos, { borderColor: "#ff7a64" });
    expect(border()).toMatchObject({ r: 255, g: 122, b: 100 });
    updateContentControl(e, fresh(e, id).pos, { borderColor: "#a1b2c3" });
    expect(border()).toMatchObject({ r: 161, g: 178, b: 195 });
    updateContentControl(e, fresh(e, id).pos, { borderColor: null });
    expect(border()).toBeNull();
  });

  it("oo:word/js-api/api-text-form.js#SetBackgroundColor, GetBackgroundColor", () => {
    const e = makeEditor("<p></p>");
    const id = addForm(e, "text", {}, "Name");
    const bg = () => prOf(fresh(e, id).node).backgroundColor ?? null;
    expect(bg()).toBeNull();
    updateContentControl(e, fresh(e, id).pos, { backgroundColor: "#ff7a64" });
    expect(colorRgba(bg())).toMatchObject({ r: 255, g: 122, b: 100 });
    updateContentControl(e, fresh(e, id).pos, { backgroundColor: "#a1b2c3" });
    expect(colorRgba(bg())).toMatchObject({ r: 161, g: 178, b: 195 });
    // grown-variant: no document theme; a theme colour is kept by name and
    // shows as Word's default accent.
    updateContentControl(e, fresh(e, id).pos, { backgroundColor: "theme:accent3" });
    expect(bg()?.startsWith("theme:")).toBe(true);
    expect(colorRgba(bg())).toMatchObject({ r: 165, g: 165, b: 165 });
    updateContentControl(e, fresh(e, id).pos, { backgroundColor: null });
    expect(bg()).toBeNull();
  });

  it("oo:word/js-api/api-text-form.js#SetLock/GetLock", () => {
    const e = makeEditor("<p></p>");
    const id = addForm(e, "text", {}, "Name");
    expect(prOf(fresh(e, id).node).lock ?? "unlocked").toBe("unlocked");
    updateContentControl(e, fresh(e, id).pos, { lock: "sdtLocked" });
    expect(prOf(fresh(e, id).node).lock).toBe("sdtLocked");
    // A locked field can't be removed.
    const para = textblocks(e)[0];
    setCursor(e, para.pos + para.node.content.size);
    pressKey(e, "Backspace");
    pressKey(e, "Backspace");
    expect(sdtById(e.state.doc, id)).not.toBeNull();
  });
});

describe("OnlyOffice inline content control API", () => {
  it("oo:word/js-api/api-inline-level-sdt.js#SetBorderColor, GetBorderColor", () => {
    const e = makeEditor("<p></p>");
    const h = insertContentControl(e, "richText")!;
    const border = () => colorRgba(prOf(sdtById(e.state.doc, idOf(h))!.node).borderColor);
    expect(border()).toBeNull();
    updateContentControl(e, h.pos, { borderColor: "#ff7a64ff" });
    expect(border()).toEqual({ r: 255, g: 122, b: 100, a: 255 });
    updateContentControl(e, h.pos, { borderColor: "#3c78b4f0" });
    expect(border()).toEqual({ r: 60, g: 120, b: 180, a: 240 });
  });

  it("oo:word/js-api/api-inline-level-sdt.js#SetBackgroundColor, GetBackgroundColor", () => {
    const e = makeEditor("<p></p>");
    const h = insertContentControl(e, "richText")!;
    const bg = () => colorRgba(prOf(sdtById(e.state.doc, idOf(h))!.node).backgroundColor);
    expect(bg()).toBeNull();
    updateContentControl(e, h.pos, { backgroundColor: "#ff7a64ff" });
    expect(bg()).toEqual({ r: 255, g: 122, b: 100, a: 255 });
    updateContentControl(e, h.pos, { backgroundColor: "#3c78b4f0" });
    expect(bg()).toEqual({ r: 60, g: 120, b: 180, a: 240 });
  });
});
