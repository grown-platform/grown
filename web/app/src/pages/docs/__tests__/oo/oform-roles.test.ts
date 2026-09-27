// OnlyOffice oform XML parity (cross-cutting CC4): OnlyOffice writes a
// form's "user master" (the role that fills a field: a name and a colour)
// to XML and reads it back unchanged. In Grown a fillable form field carries
// its role name (form properties) and its colour (the control colour), and
// both travel through the docx w:sdtPr: this is that write → read round trip
// (sdtPrXml → readSdtPr), for an unassigned field, a named role and a role
// colour.
import { describe, expect, it } from "vitest";
import { readSdtPr, sdtPrXml } from "../../docx/sdt";
import { ROOT_NS, kid, parseXml } from "../../docx/xml";
import { defaultPr, type SdtPr } from "../../sdtModel";

function roundTrip(pr: SdtPr): SdtPr {
  const xml = `<w:body ${ROOT_NS}>${sdtPrXml(pr, false, 7)}</w:body>`;
  const doc = parseXml(xml);
  return readSdtPr(kid(doc.documentElement, "sdtPr")).pr;
}

/** The part of a field that describes who fills it in. */
const who = (pr: SdtPr) => ({ key: pr.form?.key, role: pr.form?.role ?? null, color: pr.color ?? null });

describe("OnlyOffice parity: form roles through docx XML", () => {
  it("oo:oform/xml/oformXml.js#UserMaster:", () => {
    // An empty role (no name, no colour).
    const field = defaultPr("text", { form: { key: "Name" } });
    const empty = roundTrip(field);
    expect(who(empty)).toEqual({ key: "Name", role: null, color: null });
    expect(empty).toEqual(field);

    // A named role.
    const named = defaultPr("text", { form: { key: "Name", role: "RoleName" } });
    expect(who(roundTrip(named))).toEqual({ key: "Name", role: "RoleName", color: null });
    expect(roundTrip(named)).toEqual(named);

    // A role with a colour, RGB(4, 8, 15).
    const coloured = defaultPr("text", { form: { key: "Name", role: "RoleName" }, color: "#04080f" });
    expect(who(roundTrip(coloured))).toEqual({ key: "Name", role: "RoleName", color: "#04080f" });
    expect(roundTrip(coloured)).toEqual(coloured);

    // Written twice, read twice: stable.
    expect(sdtPrXml(roundTrip(coloured), false, 7)).toBe(sdtPrXml(coloured, false, 7));
  });
});
