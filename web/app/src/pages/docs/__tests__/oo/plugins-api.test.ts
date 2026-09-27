// Ports of OnlyOffice word/plugins/pluginsApi.js (add-in fields, field
// wrappers, editing restrictions) and word/js-api/api-color.js against
// Grown's scripting API (docs/api, M13). Behaviour only. The current
// word / sentence case was ported in M2 (text-selection-units.test.ts).
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { makeEditor, paragraphText } from "../harness";
import { createDocApi } from "../../api/docApi";
import { ApiColor } from "../../api/color";
import { marginExtensions } from "../../margin";
import { updateFields } from "../../references";

/** MoveToNewParagraph: append an empty paragraph and put the caret in it. */
function newParagraph(e: Editor): number {
  const end = e.state.doc.content.size;
  e.chain().insertContentAt(end, { type: "paragraph" }).setTextSelection(end + 1).run();
  return e.state.doc.childCount - 1;
}

describe("OnlyOffice pluginsApi: add-in fields", () => {
  it("oo:word/plugins/pluginsApi.js#Test work with addin fields", () => {
    const e = makeEditor("<p></p>");
    const api = createDocApi({ editor: e });
    expect(api.GetAllAddinFields().length).toBe(0);

    newParagraph(e);
    api.AddAddinField({ Value: "Test addin", Content: 123 });
    expect(api.GetAllAddinFields()).toEqual([{ FieldId: "1", Value: "Test addin", Content: "123" }]);

    newParagraph(e);
    expect(api.GetAllFields().length).toBe(1);
    e.commands.insertField("PAGE");
    expect(api.GetAllFields().length).toBe(2);
    expect(api.GetAllAddinFields().length).toBe(1);

    newParagraph(e);
    api.AddAddinField({ Value: "Addin №2", Content: "This is the second addin field" });
    expect(api.GetAllAddinFields()).toEqual([
      { FieldId: "1", Value: "Test addin", Content: "123" },
      { FieldId: "3", Value: "Addin №2", Content: "This is the second addin field" },
    ]);

    api.UpdateAddinFields([{ FieldId: "1", Value: "Addin №1", Content: "This is the first addin field" }]);
    expect(api.GetAllAddinFields()).toEqual([
      { FieldId: "1", Value: "Addin №1", Content: "This is the first addin field" },
      { FieldId: "3", Value: "Addin №2", Content: "This is the second addin field" },
    ]);

    api.SelectAddinField("1");
    expect(api.GetSelectedText()).toBe("This is the first addin field");
    api.SelectAddinField("25"); // unknown id: the selection stays
    expect(api.GetSelectedText()).toBe("This is the first addin field");
    api.SelectAddinField("3");
    expect(api.GetSelectedText()).toBe("This is the second addin field");

    // RemoveFromContent(1, 1): the paragraph holding the first field.
    const p1 = e.state.doc.child(0).nodeSize;
    e.commands.deleteRange({ from: p1, to: p1 + e.state.doc.child(1).nodeSize });
    expect(api.GetAllAddinFields()).toEqual([{ FieldId: "3", Value: "Addin №2", Content: "This is the second addin field" }]);

    api.RemoveAddinField("3");
    expect(api.GetAllAddinFields()).toEqual([]);
  });

  it("oo:word/plugins/pluginsApi.js#Test addin fields in header/footer", () => {
    const body = makeEditor("<p></p>");
    const header = new Editor({ extensions: marginExtensions(), content: "<p></p>" });
    const api = createDocApi({ editor: body, parts: () => [header], active: () => header });
    api.AddAddinField({ FieldId: "1", Value: "Addin №1", Content: "This is the first addin field" });
    const fields = api.GetAllAddinFields();
    expect(fields.length).toBe(1);
    expect(fields[0].Value).toBe("Addin №1");
    expect(fields[0].Content).toBe("This is the first addin field");
    // It lives in the header, not the body.
    expect(header.getHTML()).toContain('data-field-instr="ADDIN Addin №1"');
    expect(body.getHTML()).not.toContain("ADDIN");
    header.destroy();
  });

  it("oo:word/plugins/pluginsApi.js#Test RemoveFieldWrapper", () => {
    const e = makeEditor("<p></p>");
    const api = createDocApi({ editor: e });
    expect(api.GetAllFields().length).toBe(0);
    newParagraph(e);
    e.commands.insertField("PAGE");
    const p = newParagraph(e);
    e.commands.insertField("PAGE");
    const fields = api.GetAllFields();
    expect(fields.length).toBe(2);
    updateFields(e, "all");
    expect(paragraphText(e, p)).toBe("1");
    api.RemoveFieldWrapper(api.GetAllFields()[1].FieldId);
    expect(api.GetAllFields().length).toBe(1);
    expect(paragraphText(e, p)).toBe("1");
    expect(e.state.doc.child(p).firstChild?.isText).toBe(true);
  });

  it("oo:word/plugins/pluginsApi.js#Test SetEditingRestrictions", () => {
    const e = makeEditor("<p></p>");
    const api = createDocApi({ editor: e });
    expect(api.CanEdit()).toBe(true);
    api.SetEditingRestrictions("readOnly");
    expect(api.CanEdit()).toBe(false);
    api.SetEditingRestrictions("none");
    expect(api.CanEdit()).toBe(true);
  });
});

describe("OnlyOffice api-color", () => {
  const api = createDocApi({ editor: makeEditor("<p></p>") });

  it("oo:word/js-api/api-color.js#GetClassType, IsAutoColor, IsThemeColor", () => {
    const auto = api.AutoColor();
    const theme = api.ThemeColor("accent1");
    const hex = api.HexColor("#bada55");
    expect(hex.GetClassType()).toBe("color");
    expect(hex.IsAutoColor()).toBe(false);
    expect(auto.IsAutoColor()).toBe(true);
    expect(hex.IsThemeColor()).toBe(false);
    expect(theme.IsThemeColor()).toBe(true);
  });

  it("oo:word/js-api/api-color.js#GetRGB, GetRGBA, GetHex", () => {
    const rgb = api.RGB(186, 218, 85);
    expect(rgb.GetRGB()).toEqual({ r: 186, g: 218, b: 85 });
    expect(rgb.GetRGBA()).toEqual({ r: 186, g: 218, b: 85, a: 255 });
    expect(rgb.GetHex()).toBe("#BADA55");
    const rgba = api.RGBA(186, 218, 85, 123);
    expect(rgba.GetRGB()).toEqual({ r: 186, g: 218, b: 85 });
    expect(rgba.GetRGBA()).toEqual({ r: 186, g: 218, b: 85, a: 123 });
    expect(rgba.GetHex()).toBe("#BADA55");
    let hex = api.HexColor("#bada55");
    expect(hex.GetRGB()).toEqual({ r: 186, g: 218, b: 85 });
    expect(hex.GetRGBA()).toEqual({ r: 186, g: 218, b: 85, a: 255 });
    expect(hex.GetHex()).toBe("#BADA55");
    hex = api.HexColor("ZZZZ");
    expect(hex.GetRGB()).toEqual({ r: 0, g: 0, b: 0 });
    expect(hex.GetHex()).toBe("#000000");
    const theme = api.ThemeColor("accent2");
    expect(theme.GetRGB()).toEqual({ r: 192, g: 80, b: 77 });
    expect(theme.GetRGBA()).toEqual({ r: 192, g: 80, b: 77, a: 255 });
    expect(theme.GetHex()).toBe("#C0504D");
    const auto = api.AutoColor();
    expect(auto.GetRGB()).toEqual({ r: 0, g: 0, b: 0 });
    expect(auto.GetRGBA()).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(auto.GetHex()).toBe("#000000");
  });

  it("oo:word/js-api/api-color.js#ToJSON, FromJSON", () => {
    const check = (c: ApiColor) => {
      const back = api.FromJSON(c.ToJSON());
      expect(back.GetRGBA()).toEqual(c.GetRGBA());
      expect(back.GetHex()).toBe(c.GetHex());
      return back;
    };
    expect(check(api.AutoColor()).IsAutoColor()).toBe(true);
    expect(check(api.ThemeColor("accent4")).IsThemeColor()).toBe(true);
    check(api.HexColor("#f5a355"));
    check(api.RGB(156, 13, 88));
    check(api.RGBA(34, 139, 34, 120));
  });
});
