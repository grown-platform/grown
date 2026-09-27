import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OFFICE_CONVERT_DISABLED,
  convertOnServer,
  joinAccept,
  legacyAccept,
  needsServerConversion,
  officeConvertCaps,
  parseCaps,
  resetOfficeConvertCaps,
} from "./officeConvert";

const serverCaps = {
  enabled: true,
  formats: { doc: "docx", dot: "docx", wpd: "docx", rtf: "docx", odt: "docx", xls: "xlsx", xlt: "xlsx", ods: "xlsx", ppt: "pptx", pps: "pptx", pot: "pptx", odp: "pptx" },
  legacy: ["doc", "dot", "pot", "pps", "ppt", "wpd", "xls", "xlt"],
  preferred: [] as string[],
  max_bytes: 1024,
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetOfficeConvertCaps();
});

describe("officeConvert capabilities", () => {
  it("treats a disabled or malformed answer as unavailable", () => {
    expect(parseCaps({ enabled: false })).toEqual(OFFICE_CONVERT_DISABLED);
    expect(parseCaps(null)).toEqual(OFFICE_CONVERT_DISABLED);
    expect(parseCaps("yes")).toEqual(OFFICE_CONVERT_DISABLED);
  });

  it("keeps only known targets and listed formats", () => {
    const c = parseCaps({ enabled: true, formats: { doc: "docx", exe: "bin" }, legacy: ["doc", "exe", 3], preferred: [] });
    expect(c.formats).toEqual({ doc: "docx" });
    expect(c.legacy).toEqual(["doc"]);
  });

  it("routes legacy formats to the server, ODF only when preferred", () => {
    const c = parseCaps(serverCaps);
    expect(needsServerConversion(c, "Report.DOC")).toBe(true);
    expect(needsServerConversion(c, "old.xls", "xlsx")).toBe(true);
    expect(needsServerConversion(c, "old.xls", "docx")).toBe(false);
    expect(needsServerConversion(c, "deck.ppt", "pptx")).toBe(true);
    expect(needsServerConversion(c, "notes.odt", "docx")).toBe(false);
    expect(needsServerConversion(c, "new.docx")).toBe(false);
    const pref = parseCaps({ ...serverCaps, preferred: ["odt", "ods", "odp", "rtf"] });
    expect(needsServerConversion(pref, "notes.odt", "docx")).toBe(true);
    expect(needsServerConversion(pref, "deck.odp", "pptx")).toBe(true);
    expect(needsServerConversion(OFFICE_CONVERT_DISABLED, "Report.doc")).toBe(false);
  });

  it("builds per-app accept lists without duplicates", () => {
    const c = parseCaps(serverCaps);
    expect(legacyAccept(c, "docx")).toBe(".doc,.dot,.wpd");
    expect(legacyAccept(c, "pptx")).toBe(".pot,.pps,.ppt");
    expect(legacyAccept(OFFICE_CONVERT_DISABLED, "docx")).toBe("");
    expect(joinAccept(".xlsx,.xls", legacyAccept(c, "xlsx"))).toBe(".xlsx,.xls,.xlt");
    expect(joinAccept(".docx", "")).toBe(".docx");
  });

  it("fetches capabilities once and falls back when the endpoint fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(serverCaps), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const a = await officeConvertCaps();
    const b = await officeConvertCaps();
    expect(a.enabled).toBe(true);
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/convert/capabilities");

    resetOfficeConvertCaps();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect((await officeConvertCaps()).enabled).toBe(false);
  });
});

describe("convertOnServer", () => {
  it("posts the bytes and returns a renamed OOXML file", async () => {
    resetOfficeConvertCaps(parseCaps(serverCaps));
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await convertOnServer(new Blob([new Uint8Array([0xd0, 0xcf])]), "Quarterly report.doc");
    expect(out.name).toBe("Quarterly report.docx");
    expect(out.type).toContain("wordprocessingml");
    expect(out.size).toBe(4);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/convert/office?from=doc&to=docx&name=Quarterly+report");
    expect(init.method).toBe("POST");
  });

  it("surfaces server errors and refuses oversize or unknown files", async () => {
    resetOfficeConvertCaps(parseCaps(serverCaps));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("file content does not match its format", { status: 422 })));
    await expect(convertOnServer(new Blob(["x"]), "a.xls")).rejects.toThrow("does not match");
    await expect(convertOnServer(new Blob([new Uint8Array(2048)]), "big.ppt")).rejects.toThrow("too large");
    await expect(convertOnServer(new Blob(["x"]), "a.exe")).rejects.toThrow("can’t be converted");
    resetOfficeConvertCaps(OFFICE_CONVERT_DISABLED);
    await expect(convertOnServer(new Blob(["x"]), "a.doc")).rejects.toThrow("can’t be converted");
  });
});
