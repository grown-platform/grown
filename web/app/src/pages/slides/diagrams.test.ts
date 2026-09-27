import { describe, expect, it } from "vitest";
import { DIAGRAM_LAYOUTS, diagramMembers, fitFont, formatOutline, newDiagram, outlineTree, parseOutline, rebuildDiagram, refitDiagram } from "./diagrams";
import { applyTheme, findTheme, OFFICE_THEME } from "./theme";
import { unionRects } from "./geometry";
import type { DeckDoc } from "./model";

const box = { x: 96, y: 108, w: 768, h: 367 };

describe("outline", () => {
  it("parses levels from tabs, two-space indents and bullets", () => {
    expect(parseOutline("A\n\tB\n    C\n- D\n\n  * E")).toEqual([
      { text: "A", level: 0 },
      { text: "B", level: 1 },
      { text: "C", level: 2 },
      { text: "D", level: 0 },
      { text: "E", level: 1 },
    ]);
  });
  it("clamps a jump of more than one level", () => {
    expect(parseOutline("\t\tA\n\t\t\t\tB").map((i) => i.level)).toEqual([0, 1]);
  });
  it("round-trips through formatOutline and builds a tree", () => {
    const items = parseOutline("A\n\tB\n\tC\nD");
    expect(parseOutline(formatOutline(items))).toEqual(items);
    expect(outlineTree(items)).toEqual([
      { text: "A", children: [{ text: "B", children: [] }, { text: "C", children: [] }] },
      { text: "D", children: [] },
    ]);
  });
});

describe("diagram layouts", () => {
  for (const l of DIAGRAM_LAYOUTS) {
    it(`${l.label}: members fit the box and carry the outline text`, () => {
      const els = diagramMembers(l.value, l.sample, box, OFFICE_THEME);
      expect(els.length).toBeGreaterThan(0);
      for (const e of els) for (const k of ["x", "y", "w", "h"] as const) expect(Number.isFinite(e[k])).toBe(true);
      const b = unionRects(els.filter((e) => e.type !== "text" && !e.rotation))!;
      expect(b.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(b.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(b.x + b.w).toBeLessThanOrEqual(box.x + box.w + 1);
      expect(b.y + b.h).toBeLessThanOrEqual(box.y + box.h + 1);
      const text = els.filter((e) => e.type === "text").map((e) => e.text).join("\n");
      for (const item of parseOutline(l.sample)) expect(text).toContain(item.text);
    });
  }

  it("process draws n boxes and n-1 arrows in a row", () => {
    const els = diagramMembers("process", "a\nb\nc", box, OFFICE_THEME);
    const boxes = els.filter((e) => e.preset === "roundRect");
    const arrows = els.filter((e) => e.preset === "rightArrow");
    expect(boxes.length).toBe(3);
    expect(arrows.length).toBe(2);
    expect(new Set(boxes.map((b) => b.y)).size).toBe(1);
    expect(boxes[0].x).toBeLessThan(arrows[0].x);
    expect(arrows[0].x).toBeLessThan(boxes[1].x);
  });

  it("hierarchy draws one box per item and elbow lines to the children", () => {
    const els = diagramMembers("hierarchy", "Root\n\tA\n\tB\n\t\tB1", box, OFFICE_THEME);
    expect(els.filter((e) => e.preset === "roundRect").length).toBe(4);
    // Root: down, bar, 2 drops; B: down + 1 drop (no bar for one child).
    expect(els.filter((e) => e.type === "connector").length).toBe(6);
    const [root, a] = els.filter((e) => e.preset === "roundRect");
    expect(root.y).toBeLessThan(a.y);
  });

  it("pyramid tiers widen downwards; the top is a triangle", () => {
    const els = diagramMembers("pyramid", "a\nb\nc", box, OFFICE_THEME).filter((e) => e.type === "shape");
    expect(els.map((e) => e.preset)).toEqual(["triangle", "trapezoid", "trapezoid"]);
    expect(els[0].w).toBeLessThan(els[1].w);
    expect(els[1].w).toBeLessThan(els[2].w);
    // The trapezoid's top matches the tier above's bottom: inset = w/6 at tier 2.
    const t = els[2];
    const inset = (t.adj!.adj * Math.min(t.w, t.h)) / 100000;
    expect(Math.abs(inset - (t.w - els[1].w) / 2)).toBeLessThan(0.5);
  });

  it("venn circles are translucent theme accents", () => {
    const els = diagramMembers("venn", "a\nb\nc", box, OFFICE_THEME).filter((e) => e.type === "shape");
    expect(els.map((e) => e.themeRefs?.fill)).toEqual(["accent1/alpha:50000", "accent2/alpha:50000", "accent3/alpha:50000"]);
    expect(els[0].fill).toMatch(/^#[0-9a-f]{8}$/);
  });

  it("text sizes shrink to fit", () => {
    expect(fitFont("Hello", { w: 400, h: 200 })).toBe(28);
    expect(fitFont("A rather long label here", { w: 100, h: 40 })).toBeLessThan(12);
  });
});

describe("diagram groups", () => {
  it("new diagrams are groups that remember their layout and outline", () => {
    const g = newDiagram("cycle", "a\nb\nc", box, OFFICE_THEME);
    expect(g.type).toBe("group");
    expect(g.diagram).toEqual({ layout: "cycle", outline: "a\nb\nc" });
    expect(g.children!.filter((e) => e.preset === "ellipse").length).toBe(3);
  });

  it("editing the outline or layout rebuilds inside the current box, keeping the id", () => {
    const g = { ...newDiagram("list", "a\nb", box, OFFICE_THEME), x: 10, y: 20, w: 400, h: 200, rotation: 5 };
    const r = rebuildDiagram(g, { outline: "a\nb\nc" }, OFFICE_THEME);
    expect(r.id).toBe(g.id);
    expect(r.rotation).toBe(5);
    expect(r.children!.filter((e) => e.type === "text").length).toBe(3);
    expect(r.children!.every((c) => c.x >= 9 && c.y >= 19)).toBe(true);
    const p = rebuildDiagram(r, { layout: "process" }, OFFICE_THEME);
    expect(p.diagram).toEqual({ layout: "process", outline: "a\nb\nc" });
    expect(p.children!.filter((e) => e.preset === "rightArrow").length).toBe(2);
  });

  it("a theme change recolours diagram members", () => {
    const g = newDiagram("process", "a\nb", box, OFFICE_THEME);
    const deck: DeckDoc = { slides: [{ id: "s", background: "#fff", elements: [g] }] };
    const coral = findTheme("coral")!;
    const out = applyTheme(deck, coral).slides[0].elements[0];
    const first = out.children!.find((e) => e.preset === "roundRect")!;
    expect(first.fill!.toLowerCase()).toBe(coral.colors.accent1.toLowerCase());
  });
});

describe("refitDiagram", () => {
  it("rebuilds a resized diagram so text refits; moves and other groups pass through", () => {
    const g = newDiagram("process", "Plan\nBuild", box, OFFICE_THEME);
    const moved = { ...g, x: g.x + 10 };
    expect(refitDiagram(g, moved, OFFICE_THEME)).toBe(moved);
    const small = { ...g, w: 160, h: 80 };
    const r = refitDiagram(g, small, OFFICE_THEME);
    expect(r.id).toBe(g.id);
    const bigFont = g.children!.find((c) => c.type === "text")!.fontSize!;
    const smallFont = r.children!.find((c) => c.type === "text")!.fontSize!;
    expect(smallFont).toBeLessThan(bigFont);
    const plain = { ...g, diagram: undefined };
    expect(refitDiagram(plain, { ...plain, w: 10 }, OFFICE_THEME).children).toBe(plain.children);
  });
});
