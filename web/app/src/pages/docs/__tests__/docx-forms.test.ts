// DOCX content controls, forms, protection and custom XML both ways
// (Docs M10). Fixtures are built in code.
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { Editor } from "@tiptap/core";
import { makeEditor, paragraphTexts, setCursor, textblocks } from "./harness";
import { buildDocx, PNG_1PX } from "./docx-fixture";
import { readDocx } from "../docx/read";
import { writeDocx } from "../docx/write";
import { applyDocxImport, collectDocxInput } from "../docx/apply";
import { parseXml } from "../docx/xml";
import { allSdts, innerText, insertContentControl, prOf, setSdtPicture, setSdtText, setCheckbox, updateContentControl } from "../sdt";
import { getProtection, protectWith, setProtection } from "../protection";
import { customXmlParts, getCustomXml, putCustomXml, setDataBinding } from "../customXml";
import { getAllFormsData } from "../forms";

const r = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const sdt = (pr: string, content: string) => `<w:sdt><w:sdtPr>${pr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const ITEM = "{11111111-2222-3333-4444-555555555555}";

const WORD_BODY =
  `<w:p>${r("Name: ")}${sdt('<w:alias w:val="Full name"/><w:tag w:val="name"/><w:id w:val="101"/><w:lock w:val="sdtLocked"/><w:showingPlcHdr/><w15:color w15:val="FF0000"/><w:text/>', r("Click here"))}</w:p>` +
  `<w:p>${sdt('<w:id w:val="102"/><w14:checkbox><w14:checked w14:val="1"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>', r("☒"))}${r(" I agree")}</w:p>` +
  `<w:p>${sdt('<w:id w:val="103"/><w:dropDownList><w:listItem w:displayText="Red" w:value="r"/><w:listItem w:displayText="Blue" w:value="b"/></w:dropDownList>', r("Blue"))}` +
  `${sdt('<w:id w:val="104"/><w:comboBox><w:listItem w:displayText="One" w:value="1"/></w:comboBox>', r("Other"))}` +
  `${sdt('<w:id w:val="105"/><w:date w:fullDate="2024-07-24T00:00:00Z"><w:dateFormat w:val="d MMMM yyyy"/><w:lid w:val="en-US"/></w:date>', r("24 July 2024"))}</w:p>` +
  sdt('<w:alias w:val="Section"/><w:id w:val="106"/><w:lock w:val="contentLocked"/>', `<w:p>${r("Block one")}</w:p><w:p>${r("Block two")}</w:p>`) +
  `<w:p>${sdt(`<w:id w:val="107"/><w:dataBinding w:prefixMappings="xmlns:ns0='urn:t'" w:xpath="/ns0:root[1]/ns0:city[1]" w:storeItemID="${ITEM}"/><w:text/>`, r("Paris"))}</w:p>` +
  // A TOC building block stays a table of contents (unwrapped).
  sdt('<w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj>', `<w:p>${r("Contents")}</w:p>`) +
  // OnlyOffice's form properties.
  `<w:p>${sdt('<w:id w:val="108"/><w:formPr w:key="Phone" w:required="1"/><w:textFormPr><w:maxCharacters w:val="14"/><w:format w:type="mask" w:val="(999) 999-9999"/></w:textFormPr><w:showingPlcHdr/>', r("Your text here"))}</w:p>`;

const SETTINGS = `<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:documentProtection w:edit="forms" w:enforcement="1" w:algorithmName="SHA-512" w:hashValue="aGFzaA==" w:saltValue="c2FsdA==" w:spinCount="100000"/></w:settings>`;

async function wordDoc(): Promise<Uint8Array> {
  const bytes = await buildDocx({ body: WORD_BODY, settings: SETTINGS, rels: [["rIdCx", "customXml", "../customXml/item1.xml"]] });
  const zip = await JSZip.loadAsync(bytes);
  zip.file("customXml/item1.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<root xmlns="urn:t"><city>Paris</city></root>`);
  zip.file("customXml/itemProps1.xml", `<?xml version="1.0" encoding="UTF-8"?><ds:datastoreItem ds:itemID="${ITEM}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="urn:t"/></ds:schemaRefs></ds:datastoreItem>`);
  zip.file("customXml/_rels/item1.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>`);
  return zip.generateAsync({ type: "uint8array" });
}

async function importInto(bytes: Uint8Array): Promise<Editor> {
  const imp = await readDocx(bytes);
  const e = makeEditor("<p></p>");
  applyDocxImport(e, imp);
  return e;
}

async function exportBytes(e: Editor): Promise<Uint8Array> {
  const input = collectDocxInput(e, { title: "Form" });
  input.now = new Date("2026-09-27T00:00:00Z");
  return writeDocx(input);
}

/** A comparable summary of every control. */
function controls(e: Editor) {
  return allSdts(e.state.doc).map((h) => {
    const pr = { ...prOf(h.node) };
    return { level: h.node.type.name, plc: !!h.node.attrs.plc, text: innerText(h.node), pr };
  });
}

describe("DOCX content controls", () => {
  it("reads Word's content controls, protection and custom XML", async () => {
    const e = await importInto(await wordDoc());
    const c = controls(e);
    const byTag = (t: string) => c.find((x) => x.pr.type === t)!;
    expect(c.map((x) => x.pr.type)).toEqual(["text", "checkbox", "dropDownList", "comboBox", "date", "richText", "text", "text"]);
    expect(c[0]).toMatchObject({ plc: true, text: "Click here", pr: { alias: "Full name", tag: "name", lock: "sdtLocked", color: "#ff0000" } });
    expect(c[0].pr.placeholder, "a shown placeholder is the placeholder text").toBe("Click here");
    expect(byTag("checkbox").pr.checkbox).toMatchObject({ checked: true, checkedSymbol: "☒", uncheckedSymbol: "☐" });
    expect(byTag("dropDownList")).toMatchObject({ text: "Blue", pr: { items: [{ label: "Red", value: "r" }, { label: "Blue", value: "b" }] } });
    expect(byTag("date").pr.date).toMatchObject({ full: "2024-07-24", format: "d MMMM yyyy" });
    expect(c[5]).toMatchObject({ level: "sdtBlock", text: "Block one\nBlock two", pr: { alias: "Section", lock: "contentLocked" } });
    expect(c[6].pr.dataBinding).toEqual({ prefix: "xmlns:ns0='urn:t'", xpath: "/ns0:root[1]/ns0:city[1]", storeItemId: ITEM });
    expect(c[7].pr).toMatchObject({ form: { key: "Phone", required: true }, textForm: { maxChars: 14, format: { type: "mask", value: "(999) 999-9999" } } });
    expect(e.state.doc.toJSON().content.some((n: { type: string }) => n.type === "tableOfContents") || paragraphTexts(e).includes("Contents")).toBe(true);
    expect(getProtection(e)).toMatchObject({ mode: "forms", enforced: true, hash: "aGFzaA==", salt: "c2FsdA==", spinCount: 100000 });
    expect(getCustomXml(e, ITEM)?.uris).toEqual(["urn:t"]);
    expect(getCustomXml(e, ITEM)?.xml).toContain("<city>Paris</city>");
  });

  it("writes them in schema shape and reads its own output back the same", async () => {
    const e = await importInto(await wordDoc());
    const bytes = await exportBytes(e);
    const zip = await JSZip.loadAsync(bytes);
    const doc = parseXml(await zip.file("word/document.xml")!.async("string"));
    const sdts = doc.getElementsByTagName("w:sdt");
    expect(sdts.length).toBeGreaterThanOrEqual(8);
    // sdtPr child order: alias, tag, id, lock, …, showingPlcHdr, dataBinding, w15, type, extension.
    const names = [...sdts[0].getElementsByTagName("w:sdtPr")[0].children].map((c) => c.tagName);
    expect(names).toEqual(["w:alias", "w:tag", "w:id", "w:lock", "w:showingPlcHdr", "w15:color", "w:text", "gf:pr"]);
    const ids = [...doc.getElementsByTagName("w:id")].map((x) => x.getAttribute("w:val"));
    expect(new Set(ids).size, "unique w:id").toBe(ids.length);
    const settings = await zip.file("word/settings.xml")!.async("string");
    expect(settings).toMatch(/<w:documentProtection w:edit="forms" w:enforcement="1" w:algorithmName="SHA-512" w:hashValue="aGFzaA==" w:saltValue="c2FsdA==" w:spinCount="100000"\/><w:defaultTabStop/);
    expect(zip.file("customXml/item1.xml")).toBeTruthy();
    expect(await zip.file("customXml/itemProps1.xml")!.async("string")).toContain(`ds:itemID="${ITEM}"`);
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain('Target="../customXml/item1.xml"');
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain("/customXml/itemProps1.xml");

    const again = await importInto(bytes);
    expect(controls(again)).toEqual(controls(e));
    expect(getProtection(again)).toEqual(getProtection(e));
    expect(customXmlParts(again).map((p) => [p.itemId, p.uris, p.xml])).toEqual(customXmlParts(e).map((p) => [p.itemId, p.uris, p.xml]));
    // And stable on a second round.
    const third = await importInto(await exportBytes(again));
    expect(controls(third)).toEqual(controls(again));
  });

  it("round-trips an editor-built form (every control type, forms, binding, picture)", async () => {
    const e = makeEditor("<p>Form</p><p></p>");
    setCursor(e, textblocks(e)[1].pos);
    const add = (type: Parameters<typeof insertContentControl>[1], pr: Record<string, unknown> = {}) => {
      const b = textblocks(e);
      setCursor(e, b[b.length - 1].pos + b[b.length - 1].node.content.size);
      return insertContentControl(e, type, { pr })!;
    };
    const name = add("text", { form: { key: "name", required: true, role: "Applicant" }, placeholder: "Your name", textForm: { maxChars: 20 } });
    setSdtText(e, name.pos, "Ada");
    add("checkbox", { form: { key: "g" }, checkbox: { checked: false, checkedSymbol: "☒", uncheckedSymbol: "☐", groupKey: "size", choiceName: "S" } });
    const radioM = add("checkbox", { form: { key: "g2" }, checkbox: { checked: false, checkedSymbol: "☒", uncheckedSymbol: "☐", groupKey: "size", choiceName: "M" } });
    setCheckbox(e, radioM.pos, true);
    add("dropDownList", { form: { key: "color" }, items: [{ label: "Red", value: "r" }], borderColor: "#112233", backgroundColor: "theme:accent1" });
    add("date", { form: { key: "when" }, date: { format: "yyyy-MM-dd", full: null } });
    const pic = add("picture", { form: { key: "photo" } });
    setSdtPicture(e, allSdts(e.state.doc).find((h) => prOf(h.node).type === "picture")!.pos, `data:image/png;base64,${PNG_1PX}`, { width: 40 });
    const complex = add("complex", { form: { key: "addr" } });
    putCustomXml(e, { itemId: ITEM, uris: [], xml: `<?xml version="1.0" encoding="UTF-8"?>\n<root><city>Rome</city></root>` });
    const bound = add("text");
    setDataBinding(e, allSdts(e.state.doc)[allSdts(e.state.doc).length - 1].pos, { prefix: "", xpath: "/root[1]/city[1]", storeItemId: ITEM });
    updateContentControl(e, allSdts(e.state.doc)[0].pos, { alias: "Name", tag: "t1", appearance: "tags" });
    setProtection(e, protectWith("readOnly", "pw", 10));
    expect([name, pic, complex, bound].every(Boolean)).toBe(true);

    const before = controls(e);
    expect(before.find((c) => c.pr.dataBinding)?.text).toBe("Rome");
    const again = await importInto(await exportBytes(e));
    expect(controls(again)).toEqual(before);
    expect(getAllFormsData(again.state.doc)).toEqual(getAllFormsData(e.state.doc));
    expect(getProtection(again)).toEqual(getProtection(e));
  });
});
