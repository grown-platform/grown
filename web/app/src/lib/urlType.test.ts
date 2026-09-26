/**
 * Hyperlink classification (urlType.ts).
 *
 * The `oo:` tests port the behaviour of OnlyOffice's tests/common/api/api.js
 * (`asc_getUrlType`, browser and desktop variants). Our type names map as
 * Http → "http", Email → "email", Unsafe → "unsafe", Invalid → "invalid".
 * Where the reference marks its own answer `//todo`, we implement the answer
 * the todo asks for and note the reference value in a comment.
 */
import { describe, expect, it, vi } from "vitest";
import { getUrlType, normalizeLink, resolveLinkInput, type UrlType } from "./urlType";

type Row = [string, UrlType];

/** Rows shared by both variants (everything except local paths). */
const COMMON: Row[] = [
  ["http://foo.com/blah_blah", "http"],
  ["http://foo.com/blah_blah_(wikipedia)_(again)", "http"],
  ["https://www.example.com/foo/?bar=baz&inga=42&quux", "http"],
  ["http://userid:password@example.com:8080", "http"],
  ["http://userid@example.com:8080/", "http"],
  ["http://142.42.1.1", "http"],
  ["http://142.42.1.1:8080/", "http"],
  ["http://foo.com/blah_(wikipedia)_blah#cite-1", "http"],
  ["http://foo.bar/?q=Test%20URL-encoded%20stuff", "http"],
  ["http://a.b-c.de", "http"],
  ["ftp://public.ftp-servers.example.com/mydirectory/myfile.txt", "http"],
  ["ftp://user001:secretpassword@private.ftp-servers.example.com/mydirectory/myfile.txt", "http"],
  ["ftps://user001:secretpassword@private.ftp-servers.example.com/mydirectory/myfile.txt", "http"],
  ["http://مثال.إختبار", "http"], // reference: Unsafe, marked "todo Http"
  ["http://фывап.ролдж", "http"],
  ["http://", "unsafe"],
  ["http:///a", "unsafe"],
  ["http://.www.foo.bar/", "unsafe"],

  ["mysite@ourearth.com", "email"], // reference: Http, marked "todo Email"
  ["my.ownsite@ourearth.org", "email"],
  ["mysite@you.me.net", "email"], // reference: Http, marked "todo Email"
  ["mysite@.com.my", "invalid"], // reference: Email, marked "todo Invalid"
  ["@you.me.net", "invalid"], // reference: Http, marked "todo Invalid"
  [".mysite@mysite.org", "invalid"], // reference: Email, marked "todo Invalid"
  ["mysite()*@gmail.com", "invalid"],

  ["smb://192.168.56.1/e/Testfolder/TestFile.docx", "unsafe"],
  ["tessa://tessaclient.EPD/?Action=OpenCard&ID=c40076f5-daa9-4929-8f66-d3fd6ae2dcb1", "unsafe"],

  ["file://localhost/etc/fstab", "unsafe"],
  ["file:///etc/fstab", "unsafe"],
  ["file://localhost/c:/WINDOWS/clock.avi", "unsafe"],
  ["file:///c:/WINDOWS/clock.avi", "unsafe"],
  ['file://"C:\\Users\\User\\Documents\\About.pdf"', "invalid"],
  ["file://'C:\\Users\\User\\Documents\\About.pdf'", "invalid"],
];

function check(rows: Row[], isLocalFile?: (s: string) => boolean) {
  for (const [input, want] of rows) {
    expect(getUrlType(input, { isLocalFile }), input).toBe(want);
  }
}

describe("urlType: OnlyOffice asc_getUrlType parity", () => {
  it("oo:common/api/api.js#Test asc_getUrlType", () => {
    check([
      ...COMMON,
      ["joplin://x-callback-url/openFolder?id=1234", "unsafe"],
      ["/home/user/123.txt", "invalid"],
      ["123.txt", "http"],
      ["../../123.txt", "invalid"],
    ]);
  });

  it("oo:common/api/api.js#Test asc_getUrlType desktop", () => {
    // Desktop host: every scheme-less path is a local file.
    check(
      [
        ...COMMON,
        ["/home/user/123.txt", "unsafe"],
        ["123.txt", "unsafe"],
        ["../../123.txt", "unsafe"],
      ],
      () => true,
    );
  });
});

describe("urlType: Grown behaviour", () => {
  it("classifies script schemes, anchors and whitespace", () => {
    check([
      ["javascript:alert(1)", "invalid"],
      ["JavaScript:alert(1)", "invalid"],
      ["data:text/html,hi", "invalid"],
      ["vbscript:msgbox", "invalid"],
      ["#heading-1", "internal"],
      ["#", "invalid"],
      ["", "invalid"],
      ["   ", "invalid"],
      ["foo bar.com", "invalid"],
      ["mailto:me@example.com", "email"],
      ["mailto:me@example.com?subject=hi", "email"],
      ["mailto:nobody", "invalid"],
      ["example.com", "http"],
      ["example.com:8080/x", "http"],
      ["localhost:3000", "invalid"], // no dot: not obviously a public host
      ["http://localhost:3000", "http"],
      ["C:\\Users\\me\\a.docx", "invalid"],
      ["tel:+15551234", "unsafe"],
    ]);
  });

  it("normalizes bare hosts and addresses", () => {
    expect(normalizeLink(" example.com/x ")).toEqual({ type: "http", href: "https://example.com/x" });
    expect(normalizeLink("example.com:8080")).toEqual({ type: "http", href: "https://example.com:8080" });
    expect(normalizeLink("HTTP://Example.com")).toEqual({ type: "http", href: "HTTP://Example.com" });
    expect(normalizeLink("me@example.com")).toEqual({ type: "email", href: "mailto:me@example.com" });
    expect(normalizeLink("mailto:me@example.com")).toEqual({ type: "email", href: "mailto:me@example.com" });
    expect(normalizeLink("#top")).toEqual({ type: "internal", href: "#top" });
    expect(normalizeLink("javascript:alert(1)")).toEqual({ type: "invalid", href: "" });
  });

  it("resolveLinkInput: cancel, remove, reject, confirm", () => {
    const alert = vi.fn();
    const yes = vi.fn(() => true);
    const no = vi.fn(() => false);
    expect(resolveLinkInput(null, { alert, confirm: yes })).toBeNull();
    expect(resolveLinkInput("  ", { alert, confirm: yes })).toBe("");
    expect(resolveLinkInput("example.com", { alert, confirm: yes })).toBe("https://example.com");
    expect(resolveLinkInput("javascript:alert(1)", { alert, confirm: yes })).toBeNull();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(resolveLinkInput("smb://host/share", { alert, confirm: yes })).toBe("smb://host/share");
    expect(resolveLinkInput("smb://host/share", { alert, confirm: no })).toBeNull();
    expect(yes).toHaveBeenCalledTimes(1);
    expect(no).toHaveBeenCalledTimes(1);
  });
});
