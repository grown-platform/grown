import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_FONTS, FONT_FALLBACKS, PICKER_FONTS, fontFaceCss, fontStack, primaryFamily, resolveImportedFont, substituteFor } from "./fonts";
import { usedFonts } from "../pages/sheets/fontBundle";

describe("font bundle (CC7)", () => {
  it("maps Office fonts to metric-compatible open fonts", () => {
    expect(substituteFor("Calibri")).toBe("Carlito");
    expect(substituteFor("Cambria")).toBe("Caladea");
    expect(substituteFor("Arial")).toBe("Arimo"); // Liberation Sans 2.x = Arimo
    expect(substituteFor("Times New Roman")).toBe("Tinos");
    expect(FONT_FALLBACKS.Arial).toEqual({ font: "Liberation Sans", metric: true });
    expect(FONT_FALLBACKS["Times New Roman"]).toEqual({ font: "Liberation Serif", metric: true });
    expect(substituteFor("Comic Sans MS")).toBe("");
  });

  it("builds CSS stacks", () => {
    expect(fontStack("Calibri")).toBe("Calibri, Carlito, sans-serif");
    expect(fontStack('"Times New Roman", serif')).toBe('"Times New Roman", Tinos, serif');
    expect(fontStack("Noto Sans Mono")).toBe('"Noto Sans Mono", monospace');
    expect(primaryFamily("'Segoe UI', Arial")).toBe("Segoe UI");
  });

  it("keeps imported names (export writes them back) and resolves theme fonts", () => {
    expect(resolveImportedFont("Calibri")).toBe("Calibri");
    expect(resolveImportedFont("+mn-lt", { minor: "Calibri", major: "Calibri Light" })).toBe("Calibri");
    expect(resolveImportedFont("+mj-lt", { major: "Cambria" })).toBe("Cambria");
    expect(document.getElementById("grown-font-bundle")).not.toBeNull();
  });

  it("declares a local-first alias face per fallback and ships every file it names", () => {
    const css = fontFaceCss();
    expect(css).toContain('font-family:"Calibri";font-style:normal;font-weight:400;font-display:swap;src:local("Calibri"), url(/fonts/carlito/latin-400-normal.woff2)');
    expect(css).toContain('font-family:"Liberation Sans"');
    const dir = resolve(__dirname, "../../public/fonts");
    for (const url of css.match(/\/fonts\/[\w/-]+\.woff2/g) ?? []) expect(existsSync(resolve(dir, "..", url.slice(1))), url).toBe(true);
    for (const f of BUNDLED_FONTS) expect(existsSync(`${dir}/${f.slug}/LICENSE.txt`)).toBe(true);
  });

  it("offers one list in every picker", () => {
    expect(PICKER_FONTS).toContain("Calibri");
    expect(PICKER_FONTS).toContain("Noto Sans");
    expect(new Set(PICKER_FONTS).size).toBe(PICKER_FONTS.length);
    expect(usedFonts([{ celldata: [{ v: { ff: "Calibri" } }, { v: { ff: 1 } }, { v: null }] }])).toEqual(["Calibri"]);
  });
});
