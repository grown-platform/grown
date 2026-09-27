import { describe, expect, it } from "vitest";
import {
  applyTheme,
  BUILTIN_THEMES,
  findTheme,
  formatRef,
  mapSlot,
  OFFICE_THEME,
  parseRef,
  reconcileRefs,
  resolveRef,
  shadeRef,
  withColorRef,
  withFontRef,
} from "./theme";
import { findTableTemplate, MEDIUM_STYLE_2_ACCENT_1, tableTemplates } from "./tableStyles";
import type { DeckDoc, SlideElement } from "./model";

const box = (p: Partial<SlideElement>): SlideElement => ({ id: "e", type: "rect", x: 0, y: 0, w: 10, h: 10, ...p });

describe("theme refs", () => {
  it("parses and formats refs with modifiers", () => {
    expect(parseRef("accent1")).toEqual({ slot: "accent1", mods: [] });
    const p = parseRef("tx1/lumMod:65000/lumOff:35000");
    expect(p).toEqual({ slot: "tx1", mods: [{ name: "lumMod", val: 65000 }, { name: "lumOff", val: 35000 }] });
    expect(formatRef(p!.slot, p!.mods)).toBe("tx1/lumMod:65000/lumOff:35000");
    expect(parseRef("accent7")).toBeNull();
    expect(parseRef("accent1/bogus:1")).toBeNull();
    expect(parseRef("accent1/lumMod:x")).toBeNull();
  });

  it("resolves slots through the colour map (light and dark themes)", () => {
    expect(resolveRef("accent2", OFFICE_THEME)).toBe("#ed7d31");
    expect(resolveRef("tx1", OFFICE_THEME)).toBe("#000000");
    expect(resolveRef("bg1", OFFICE_THEME)).toBe("#ffffff");
    const dark = findTheme("simple-dark")!;
    expect(mapSlot("bg1", dark)).toBe("dk1");
    expect(mapSlot("tx1", dark)).toBe("lt1");
    expect(resolveRef("bg1", dark)).toBe(dark.colors.dk1);
    expect(resolveRef("tx2", dark)).toBe(dark.colors.lt2);
    expect(resolveRef("nope", OFFICE_THEME)).toBeUndefined();
  });

  it("applies DrawingML modifiers (lumMod/lumOff) like PowerPoint's palette", () => {
    // 50 % grey: black at lumMod 50 % + lumOff 50 %.
    expect(resolveRef("tx1/lumMod:50000/lumOff:50000", OFFICE_THEME)).toBe("#808080");
    // Darker 50 % of white.
    expect(resolveRef(shadeRef("bg1", -0.5), OFFICE_THEME)).toBe("#808080");
    expect(shadeRef("accent1", 0.8)).toBe("accent1/lumMod:20000/lumOff:80000");
    expect(shadeRef("accent1", 0)).toBe("accent1");
  });

  it("has 8 built-in themes with complete schemes", () => {
    expect(BUILTIN_THEMES.length).toBe(8);
    expect(new Set(BUILTIN_THEMES.map((t) => t.id)).size).toBe(8);
    for (const t of BUILTIN_THEMES) {
      for (const v of Object.values(t.colors)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.fonts.major && t.fonts.minor).toBeTruthy();
    }
  });
});

describe("applyTheme", () => {
  it("restyles theme-bound colours and fonts and keeps explicit ones", () => {
    const office = OFFICE_THEME;
    const coral = findTheme("coral")!;
    const bound = withFontRef(withColorRef(box({ id: "a", type: "text", text: "x" }), "color", "accent1", office), "major", office);
    const fill = withColorRef(box({ id: "b" }), "fill", "accent2/lumMod:75000", office);
    const explicit = box({ id: "c", fill: "#123456", fontFamily: "Georgia" });
    const group = box({ id: "g", type: "group", children: [withColorRef(box({ id: "k" }), "stroke", "accent3", office)] });
    const deck: DeckDoc = {
      slides: [{ id: "s", background: "#ffffff", bgRef: "bg1", elements: [bound, fill, explicit, group] }],
    };
    const out = applyTheme(deck, coral);
    const [a, b, c, g] = out.slides[0].elements;
    expect(out.theme).toBe(coral);
    expect(a.color).toBe(coral.colors.accent1);
    expect(a.fontFamily).toBe(coral.fonts.major);
    expect(b.fill).toBe(resolveRef("accent2/lumMod:75000", coral));
    expect(c).toBe(explicit);
    expect(g.children![0].stroke).toBe(coral.colors.accent3);
    expect(out.slides[0].background).toBe(coral.colors.lt1);
    // Dark theme flips bg1.
    const dark = applyTheme(deck, findTheme("slate")!);
    expect(dark.slides[0].background).toBe(findTheme("slate")!.colors.dk1);
  });

  it("drops a ref when an edit sets an explicit value (explicit colours are kept)", () => {
    const prev = withColorRef(box({ fill: "#000000" }), "fill", "accent1", OFFICE_THEME);
    const edited = { ...prev, fill: "#ff0000" };
    const r = reconcileRefs(prev, edited);
    expect(r.themeRefs).toBeUndefined();
    expect(r.fill).toBe("#ff0000");
    // Picking another theme colour keeps the new ref.
    const picked = withColorRef(prev, "fill", "accent4", OFFICE_THEME);
    expect(reconcileRefs(prev, picked).themeRefs).toEqual({ fill: "accent4" });
    // Unrelated edits keep refs.
    const moved = { ...prev, x: 50 };
    expect(reconcileRefs(prev, moved)).toBe(moved);
  });

  it("colours table styles with the deck theme (M5 gap)", () => {
    const coral = findTheme("coral")!;
    expect(findTableTemplate(MEDIUM_STYLE_2_ACCENT_1, OFFICE_THEME)!.header!.fill).toBe("#4472c4");
    expect(findTableTemplate(MEDIUM_STYLE_2_ACCENT_1, coral)!.header!.fill).toBe(coral.colors.accent1);
    expect(tableTemplates(coral)).toBe(tableTemplates(coral));
  });
});
