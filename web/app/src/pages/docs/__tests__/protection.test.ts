// Document protection (Docs M10): password hashing and enforcement.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { makeEditor, paragraphText, paragraphTexts, reviewText, selectText, setCursor, textblocks, typeText } from "./harness";
import { sha512, toBase64 } from "../sha512";
import { checkPassword, getProtection, hashPassword, protectWith, setProtection, NO_PROTECTION } from "../protection";
import { allSdts, innerText, insertContentControl, isFillMode, moveIntoControl } from "../sdt";

describe("SHA-512", () => {
  it("matches node:crypto for lengths around the block boundaries", () => {
    for (const n of [0, 1, 3, 55, 56, 64, 111, 112, 113, 127, 128, 129, 255, 256, 1000]) {
      const data = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff);
      expect(toBase64(sha512(data)), `length ${n}`).toBe(createHash("sha512").update(data).digest("base64"));
    }
  });
});

describe("w:documentProtection password hash", () => {
  it("is SHA-512 over salt + UTF-16LE password, then spun with a 4-byte LE counter", () => {
    const salt = toBase64(new Uint8Array(16).map((_, i) => i + 1));
    // Reference with node:crypto.
    const ref = (pw: string, spin: number) => {
      let h = createHash("sha512").update(Buffer.concat([Buffer.from(salt, "base64"), Buffer.from(pw, "utf16le")])).digest();
      for (let i = 0; i < spin; i++) {
        const it = Buffer.alloc(4);
        it.writeUInt32LE(i);
        h = createHash("sha512").update(Buffer.concat([h, it])).digest();
      }
      return h.toString("base64");
    };
    expect(hashPassword("secret", salt, 1000)).toBe(ref("secret", 1000));
    expect(hashPassword("päßwörd", salt, 10)).toBe(ref("päßwörd", 10));
  });

  it("checks passwords; no password always opens", () => {
    const p = protectWith("readOnly", "open sesame", 500);
    expect(p.hash).toBeTruthy();
    expect(p.spinCount).toBe(500);
    expect(checkPassword(p, "open sesame")).toBe(true);
    expect(checkPassword(p, "open sesam")).toBe(false);
    expect(checkPassword(protectWith("readOnly"), "")).toBe(true);
    expect(protectWith("none", "x")).toEqual(NO_PROTECTION);
  });
});

describe("protection in the editor", () => {
  it("read only: no edits", () => {
    const e = makeEditor("<p>Hello</p>");
    setProtection(e, protectWith("readOnly"));
    expect(getProtection(e).mode).toBe("readOnly");
    typeText(e, "X");
    expect(paragraphText(e)).toBe("Hello");
    setProtection(e, NO_PROTECTION);
    typeText(e, "X");
    expect(paragraphText(e)).toBe("HelloX");
  });

  it("comments only: comment marks apply, text doesn't change", () => {
    const e = makeEditor("<p>Hello world</p>");
    setProtection(e, protectWith("comments"));
    typeText(e, "X");
    expect(paragraphText(e)).toBe("Hello world");
    selectText(e, "world");
    e.commands.setMark("commentMark", { commentId: "c1" });
    let marked = false;
    e.state.doc.descendants((n) => {
      if (n.marks.some((m) => m.type.name === "commentMark")) marked = true;
    });
    expect(marked).toBe(true);
    selectText(e, "Hello");
    e.commands.toggleBold();
    expect(e.getHTML()).not.toContain("<strong>");
  });

  it("tracked changes only: edits are tracked and can't be accepted", () => {
    const e = makeEditor("<p>Hello</p>");
    setProtection(e, protectWith("trackedChanges"));
    typeText(e, " there");
    expect(reviewText(e, 0)).toEqual([
      ["common", "Hello"],
      ["add", " there"],
    ]);
    e.commands.acceptAllSuggestions();
    expect(reviewText(e, 0)[1]).toEqual(["add", " there"]);
    setProtection(e, NO_PROTECTION);
    e.commands.acceptAllSuggestions();
    expect(reviewText(e, 0)).toEqual([["common", "Hello there"]]);
  });

  it("filling forms only: fields can be filled, nothing else", () => {
    const e = makeEditor("<p>Name: </p><p>Other</p>");
    setCursor(e, textblocks(e)[0].pos + textblocks(e)[0].node.content.size);
    const f = insertContentControl(e, "text", { pr: { form: { key: "name" } } })!;
    setProtection(e, protectWith("forms"));
    expect(isFillMode(e.state)).toBe(true);
    setCursor(e, textblocks(e)[1].pos);
    typeText(e, "X");
    expect(paragraphTexts(e)[1]).toBe("Other");
    moveIntoControl(e, allSdts(e.state.doc)[0].pos);
    typeText(e, "Ada");
    expect(innerText(allSdts(e.state.doc)[0].node)).toBe("Ada");
    expect(f).not.toBeNull();
  });
});
