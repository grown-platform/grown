// Port of OnlyOffice word/custom-xml/custom-xml.js (behaviour only):
// content controls bound to custom XML parts (w:dataBinding) load their
// value from the part and write it back, and the XPath subset bindings
// use. Fixtures are Grown's own. The block and inline modules repeat
// several case names; the inline ones carry an "(inline)" suffix so every
// upstream case has its own tag.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { makeEditor, paragraphText } from "../harness";
import { allSdts, innerText, insertContentControl, prOf, setCheckbox, setSdtText, type SdtType } from "../../sdt";
import {
  checkDataBinding,
  findByXPath,
  getCustomXml,
  parseCustomXml,
  putCustomXml,
  setDataBinding,
  updateDataBinding,
  writeBinding,
  xpathOf,
  XML_DECL,
} from "../../customXml";
import type { DataBinding } from "../../sdtModel";

const NS = "http://example.com/picture";
const ITEM = "{5B7A1C20-3D4E-4F60-8A9B-0C1D2E3F4A5B}";
const ITEM2 = "{5B7A1C20-3D4E-4F60-8A9B-0C1D2E3F4A5C}";
const doc = (v: string) => `${XML_DECL}<documentData xmlns="${NS}"><simpleText>${v}</simpleText></documentData>`;
const BIND: DataBinding = { prefix: `xmlns:ns0='${NS}'`, storeItemId: ITEM, xpath: "/ns0:documentData[1]/ns0:simpleText[1]" };

// Small made-up base64 payloads (JPEG / PNG magic numbers only).
const PIC1 = "/9j/4AAQSkZJRgABAQEASABIAADGrown1";
const PIC2 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABGrown2";

function setup(xml: string, id = ITEM, uris = [NS]): Editor {
  const e = makeEditor("<p></p>");
  putCustomXml(e, { itemId: id, xml, uris });
  return e;
}
function addBound(e: Editor, type: SdtType, inline: boolean, db: DataBinding = BIND, pr: Record<string, unknown> = {}) {
  // Each control in its own paragraph at the end (as upstream).
  if (allSdts(e.state.doc).length) {
    e.commands.setTextSelection(e.state.doc.content.size);
    e.commands.insertContentAt(e.state.doc.content.size, { type: "paragraph" });
    e.commands.setTextSelection(e.state.doc.content.size - 1);
  }
  const extra = type === "date" ? { date: { format: "DD-MM-YYYY", full: null } } : {};
  const h = insertContentControl(e, type, { level: inline ? "inline" : "block", pr: { ...extra, ...pr } })!;
  const id = String(h.node.attrs.sdtId);
  setDataBinding(e, h.pos, db);
  return () => allSdts(e.state.doc).find((x) => String(x.node.attrs.sdtId) === id)!;
}
const xmlOf = (e: Editor, id = ITEM) => getCustomXml(e, id)!.xml;

function dateCase(inline: boolean) {
  const e = setup(doc("2000-01-01"));
  const c = addBound(e, "date", inline);
  updateDataBinding(e, c().pos);
  expect(innerText(c().node), "date loaded and formatted").toBe("01-01-2000");
  expect(prOf(c().node).date?.full).toBe("2000-01-01");
  expect(xmlOf(e)).toBe(doc("01-01-2000"));
  writeBinding(e, BIND, "2020-02-02");
  checkDataBinding(e, c().pos);
  updateDataBinding(e, c().pos);
  expect(xmlOf(e)).toBe(doc("02-02-2020"));
}

function dateAndCheckbox(inline: boolean) {
  const e = setup(doc("2000-01-01"));
  putCustomXml(e, { itemId: ITEM2, xml: `${XML_DECL}<weather>true</weather>`, uris: ["/weather[1]"] });
  const c1 = addBound(e, "date", inline);
  updateDataBinding(e, c1().pos);
  expect(innerText(c1().node)).toBe("01-01-2000");
  const c2 = addBound(e, "checkbox", inline, { prefix: "", storeItemId: ITEM2, xpath: "/weather[1]" });
  expect(prOf(c2().node).checkbox?.checked).toBe(true);
  expect(xmlOf(e)).toBe(doc("01-01-2000"));
  expect(xmlOf(e, ITEM2)).toBe(`${XML_DECL}<weather>true</weather>`);
}

function checkboxCase(inline: boolean) {
  for (const [v, want] of [["true", true], ["false", false], ["0", false], ["1", true], ["hello", false]] as const) {
    const e = setup(doc(v));
    const c = addBound(e, "checkbox", inline);
    expect(prOf(c().node).checkbox?.checked, `"${v}"`).toBe(want);
    if (v !== "hello") continue;
    setCheckbox(e, c().pos, true);
    updateDataBinding(e, c().pos);
    expect(xmlOf(e)).toBe(doc("true"));
    setCheckbox(e, c().pos, false);
    updateDataBinding(e, c().pos);
    expect(xmlOf(e)).toBe(doc("false"));
    if (inline) {
      writeBinding(e, BIND, "true");
      checkDataBinding(e, c().pos);
      expect(xmlOf(e)).toBe(doc("true"));
      expect(prOf(c().node).checkbox?.checked).toBe(true);
    }
  }
}

function listCase(type: "comboBox" | "dropDownList", inline: boolean) {
  const e = setup(doc("hello"));
  const c = addBound(e, type, inline, BIND, { items: [{ label: "123", value: "123" }, { label: "456", value: "456" }] });
  expect(innerText(c().node), "loaded").toBe("hello");
  expect(inline ? paragraphText(e) : innerText(c().node)).toBe("hello");
  expect(xmlOf(e)).toBe(doc("hello"));
  const v = type === "comboBox" ? "hello123" : "123";
  writeBinding(e, BIND, v);
  checkDataBinding(e, c().pos);
  expect(innerText(c().node)).toBe(v);
  expect(xmlOf(e)).toBe(doc(v));
}

function pictureCase(inline: boolean) {
  const e = setup(doc(PIC1));
  const c = addBound(e, "picture", inline);
  expect(prOf(c().node).picture?.src).toBe(`data:image/jpeg;base64,${PIC1}`);
  expect(xmlOf(e)).toBe(doc(PIC1));
  writeBinding(e, BIND, PIC2);
  checkDataBinding(e, c().pos);
  expect(prOf(c().node).picture?.src).toBe(`data:image/png;base64,${PIC2}`);
  expect(xmlOf(e)).toBe(doc(PIC2));
}

function textCase(inline: boolean) {
  const e = setup(doc("hello"));
  const c = addBound(e, "text", inline);
  expect(innerText(c().node)).toBe("hello");
  expect(xmlOf(e)).toBe(doc("hello"));
  writeBinding(e, BIND, "qwe");
  checkDataBinding(e, c().pos);
  expect(innerText(c().node)).toBe("qwe");
  expect(xmlOf(e)).toBe(doc("qwe"));
}


describe("OnlyOffice custom XML: block content controls", () => {
  it("oo:word/custom-xml/custom-xml.js#Date and CheckBox content control's load/save from/to different CustomXML's", () => dateAndCheckbox(false));
  it("oo:word/custom-xml/custom-xml.js#Date content control load/save CustomXML", () => dateCase(false));
  it("oo:word/custom-xml/custom-xml.js#Test invalid date content when loading customXML (bug 72133)", () => {
    const e = setup(doc("BAD DATE"));
    const c = addBound(e, "date", false);
    expect(innerText(c().node), "an invalid date shows as is").toBe("BAD DATE");
    writeBinding(e, BIND, "Invalid date");
    checkDataBinding(e, c().pos);
    updateDataBinding(e, c().pos);
    expect(xmlOf(e)).toBe(doc("Invalid date"));
  });
  it("oo:word/custom-xml/custom-xml.js#Checkbox content control load/save CustomXML", () => checkboxCase(false));
  it("oo:word/custom-xml/custom-xml.js#ComboBox content control load from/save CustomXML", () => listCase("comboBox", false));
  it("oo:word/custom-xml/custom-xml.js#DropDown content control load from/save CustomXML", () => listCase("dropDownList", false));
  it("oo:word/custom-xml/custom-xml.js#Picture content control load from/save CustomXML", () => pictureCase(false));
  it("oo:word/custom-xml/custom-xml.js#Simple text content control load from/save CustomXML", () => textCase(false));
});

describe("OnlyOffice custom XML: inline content controls", () => {
  it("oo:word/custom-xml/custom-xml.js#Date and CheckBox inline content control's load/save from/to different CustomXML's", () => dateAndCheckbox(true));
  it("oo:word/custom-xml/custom-xml.js#Date content control load/save CustomXML (inline)", () => dateCase(true));
  it("oo:word/custom-xml/custom-xml.js#Checkbox content control load/save CustomXML (inline)", () => checkboxCase(true));
  it("oo:word/custom-xml/custom-xml.js#ComboBox content control load from/save CustomXML (inline)", () => listCase("comboBox", true));
  it("oo:word/custom-xml/custom-xml.js#DropDown content control load from/save CustomXML (inline)", () => listCase("dropDownList", true));
  it("oo:word/custom-xml/custom-xml.js#Picture content control load from/save CustomXML (inline)", () => pictureCase(true));
  it("oo:word/custom-xml/custom-xml.js#Simple text content control load from/save CustomXML (inline)", () => textCase(true));

  it("editing a bound control writes the part (Grown)", () => {
    const e = setup(doc("hello"));
    const c = addBound(e, "text", true);
    setSdtText(e, c().pos, "typed");
    expect(xmlOf(e)).toBe(doc("typed"));
    putCustomXml(e, { itemId: ITEM, xml: doc("from part"), uris: [NS] });
    return new Promise<void>((r) =>
      queueMicrotask(() => {
        expect(innerText(c().node)).toBe("from part");
        r();
      }),
    );
  });
});

const BOOKS =
  `${XML_DECL}<bookstore>` +
  `<book category="fiction" id="1"><title lang="en">A Tale</title><author>Ann Author</author><year>1901</year></book>` +
  `<book category="fiction" id="2"><title lang="en">Second Book</title><author>Ben Writer</author><year>1902</year></book>` +
  `<book category="poetry" id="3"><title lang="en">Third</title><author>Cy Poet</author><year>1903</year></book>` +
  `<otherbook id="4"><title>-</title><author>-</author><year><title>Nested</title></year></otherbook>` +
  `</bookstore>`;

describe("OnlyOffice custom XML: XPath", () => {
  const x = () => parseCustomXml(BOOKS)!;
  it("oo:word/custom-xml/custom-xml.js#Check /bookstore/book", () => {
    const n = findByXPath(x(), "/bookstore/book");
    expect(n.map((b) => b.el.getAttribute("id"))).toEqual(["1", "2", "3"]);
  });
  it("oo:word/custom-xml/custom-xml.js#Check /bookstore/book/title", () => {
    expect(findByXPath(x(), "/bookstore/book/title").map((b) => b.el.textContent)).toEqual(["A Tale", "Second Book", "Third"]);
  });
  it("oo:word/custom-xml/custom-xml.js#Check /bookstore/book[2]/author", () => {
    const n = findByXPath(x(), "/bookstore/book[2]/author");
    expect(n.length).toBe(1);
    expect(n[0].el.textContent).toBe("Ben Writer");
  });
  it("oo:word/custom-xml/custom-xml.js#Check /bookstore/*", () => {
    expect(findByXPath(x(), "/bookstore/*").map((b) => b.el.getAttribute("id"))).toEqual(["1", "2", "3", "4"]);
  });
  it("oo:word/custom-xml/custom-xml.js#Check /bookstore/book/@category", () => {
    const n = findByXPath(x(), "/bookstore/book/@category");
    expect(n.map((b) => b.el.getAttribute("id"))).toEqual(["1", "2", "3"]);
    expect(n.map((b) => b.el.getAttribute(b.attr!))).toEqual(["fiction", "fiction", "poetry"]);
  });
  it("oo:word/custom-xml/custom-xml.js#Check //bookstore", () => expect(findByXPath(x(), "//bookstore").length).toBe(1));
  it("oo:word/custom-xml/custom-xml.js#Check //title", () => expect(findByXPath(x(), "//title").length).toBe(5));
  it("oo:word/custom-xml/custom-xml.js#Check /bookstore/book//title", () => expect(findByXPath(x(), "/bookstore/book//title").length).toBe(3));
  it("oo:word/custom-xml/custom-xml.js#Check /bookstore/otherbook//title", () => expect(findByXPath(x(), "/bookstore/otherbook//title").length).toBe(2));
  it("oo:word/custom-xml/custom-xml.js#Check getXPath un-unique", () => expect(xpathOf(findByXPath(x(), "/bookstore/book")[1].el)).toBe("/bookstore/book[2]"));
  it("oo:word/custom-xml/custom-xml.js#Check getXPath unique", () => expect(xpathOf(findByXPath(x(), "/bookstore/otherbook/author")[0].el)).toBe("/bookstore/otherbook/author"));
});
