import { describe, it, expect } from "vitest";
import { deckToPptx } from "./write";
import { readPptx } from "./read";
import { DECK_TEMPLATES } from "../templates";
import { newElement, type DeckDoc, type SlideElement } from "../model";

// Round trip: DeckDoc → pptx (pptxgenjs + patches) → DeckDoc. The fixture
// .pptx is generated here, never checked in.

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Normalise a deck for comparison: ids dropped, absent/false flags removed,
 * colours lower-cased, numbers rounded to 0.01 px, and the values the
 * exporter writes for unset text fields filled in on both sides. Empty image
 * placeholders are dropped (they are not exported).
 */
function normalize(deck: DeckDoc) {
  const round = (v: unknown): unknown => {
    if (typeof v === "number") return Math.round(v * 100) / 100;
    if (typeof v === "string")
      return /^#[0-9a-f]{6,8}$/i.test(v) ? v.toLowerCase() : v;
    if (Array.isArray(v)) return v.map(round);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (
          k === "id" ||
          k === "animation" ||
          x === undefined ||
          x === false ||
          x === null
        )
          continue;
        if (k === "rotation" && x === 0) continue;
        if (k === "transition" && x === "none") continue;
        o[k] = round(x);
      }
      return o;
    }
    return v;
  };
  const withDefaults = (el: SlideElement): SlideElement =>
    el.type === "group"
      ? { ...el, children: (el.children || []).map(withDefaults) }
      : el.type === "text"
      ? {
          fontFamily: "Arial",
          fontSize: 18,
          color: "#000000",
          align: "left",
          valign: "top",
          ...el,
          // Exported links pick up PowerPoint's hyperlink underline; see read.ts.
          ...(el.url ? { underline: undefined } : {}),
        }
      : el;
  return round({
    slides: deck.slides.map((s) => ({
      ...s,
      // An image placeholder with no picture yet has nothing to export.
      elements: s.elements
        .filter((e) => e.type !== "image" || e.src)
        .map(withDefaults),
    })),
  });
}

async function roundTrip(deck: DeckDoc, title?: string) {
  const bytes = await deckToPptx(deck, title);
  return readPptx(bytes);
}

const FULL: DeckDoc = {
  slides: [
    {
      id: "s1",
      background: "#FAFAFA",
      notes: "Speaker notes\nsecond line",
      transition: "fade",
      elements: [
        {
          id: "t1",
          type: "text",
          x: 48,
          y: 24,
          w: 864,
          h: 96,
          text: "Quarterly review",
          fontSize: 40,
          fontFamily: "Georgia",
          bold: true,
          color: "#1a73e8",
          align: "center",
          valign: "middle",
        },
        {
          id: "t2",
          type: "text",
          x: 96,
          y: 150,
          w: 400,
          h: 200,
          text: "Revenue up\nCosts down\nHiring on track",
          fontSize: 20,
          fontFamily: "Verdana",
          italic: true,
          underline: true,
          strike: true,
          list: "bullet",
          lineSpacing: 1.5,
          color: "#202124",
          align: "left",
          valign: "top",
        },
        {
          id: "t3",
          type: "text",
          x: 520,
          y: 150,
          w: 300,
          h: 120,
          text: "Plan\nBuild\nShip",
          fontSize: 18,
          list: "number",
          color: "#5f6368",
          align: "right",
          valign: "bottom",
          rotation: 350,
        },
        {
          id: "t4",
          type: "text",
          x: 96,
          y: 380,
          w: 240,
          h: 40,
          text: "grown.example",
          fontSize: 16,
          color: "#0b57d0",
          url: "https://grown.example/docs",
        },
      ],
    },
    {
      id: "s2",
      background: "#202124",
      transition: "slide-left",
      elements: [
        {
          id: "r",
          type: "rect",
          x: 10,
          y: 10,
          w: 100,
          h: 60,
          fill: "#4285f4",
          stroke: "none",
          strokeWidth: 0,
        },
        {
          id: "e",
          type: "ellipse",
          x: 120,
          y: 10,
          w: 100,
          h: 60,
          fill: "#34a853",
          stroke: "#0d652d",
          strokeWidth: 3,
        },
        {
          id: "tr",
          type: "triangle",
          x: 230,
          y: 10,
          w: 100,
          h: 60,
          fill: "#fbbc04",
          stroke: "none",
          strokeWidth: 0,
          rotation: 90,
        },
        {
          id: "d",
          type: "diamond",
          x: 340,
          y: 10,
          w: 100,
          h: 60,
          fill: "#a142f4",
          stroke: "none",
          strokeWidth: 0,
          flipH: true,
        },
        {
          id: "a",
          type: "rightArrow",
          x: 450,
          y: 10,
          w: 100,
          h: 60,
          fill: "#ea4335",
          stroke: "none",
          strokeWidth: 0,
          flipV: true,
          url: "https://grown.example/arrow",
        },
        {
          id: "rr",
          type: "roundRect",
          x: 560,
          y: 10,
          w: 100,
          h: 60,
          fill: "#4285f480",
          stroke: "#ffffff",
          strokeWidth: 1.5,
        },
        {
          id: "o",
          type: "rect",
          x: 670,
          y: 10,
          w: 100,
          h: 60,
          fill: "none",
          stroke: "#ffffff",
          strokeWidth: 2,
        },
        {
          id: "l1",
          type: "line",
          x: 10,
          y: 200,
          w: 300,
          h: 0,
          stroke: "#ffffff",
          strokeWidth: 3,
        },
        {
          id: "l2",
          type: "line",
          x: 400,
          y: 200,
          w: 200,
          h: 0,
          stroke: "#fbbc04",
          strokeWidth: 2,
          rotation: 30,
        },
      ],
    },
    {
      id: "s3",
      background: "#ffffff",
      transition: "slide-right",
      elements: [
        {
          id: "tb",
          type: "table",
          x: 96,
          y: 96,
          w: 480,
          h: 150,
          table: {
            rows: 3,
            cols: 3,
            cells: [
              ["Region", "Q1", "Q2"],
              ["North", "10", "12"],
              ["South", "", "9"],
            ],
          },
          fill: "#e8f0fe",
          stroke: "#bdc1c6",
          strokeWidth: 1,
          fontSize: 16,
          fontFamily: "Arial",
          color: "#202124",
        },
        {
          id: "img",
          type: "image",
          x: 600,
          y: 300,
          w: 200,
          h: 150,
          src: PNG_1PX,
          rotation: 15,
          url: "https://grown.example/img",
        },
      ],
    },
    { id: "s4", background: "#ffffff", transition: "slide-up", elements: [] },
  ],
};

describe("pptx round trip (export → import)", () => {
  it("preserves a deck with every element type, notes, backgrounds and transitions", async () => {
    const r = await roundTrip(FULL, "Round trip");
    expect(r.warnings).toEqual([]);
    expect(r.title).toBe("Round trip");
    expect(normalize(r.deck)).toEqual(normalize(FULL));
  });

  it("preserves element order (z-order) on each slide", async () => {
    const r = await roundTrip(FULL);
    expect(r.deck.slides[1].elements.map((e) => e.type)).toEqual(
      FULL.slides[1].elements.map((e) => e.type),
    );
  });

  it("preserves the default element of every insertable type", async () => {
    const types = [
      "text",
      "rect",
      "ellipse",
      "triangle",
      "diamond",
      "rightArrow",
      "roundRect",
      "line",
      "table",
    ] as const;
    const deck: DeckDoc = {
      slides: types.map((t, i) => {
        const el = newElement(t);
        if (t === "table") el.table!.cells[0][0] = "cell";
        return { id: `s${i}`, background: "#ffffff", elements: [el] };
      }),
    };
    // A fresh table has no font family; the exporter writes Arial.
    const expected = normalize({
      slides: deck.slides.map((s) => ({
        ...s,
        elements: s.elements.map((e) =>
          e.type === "table" ? { fontFamily: "Arial", ...e } : e,
        ),
      })),
    });
    expect(normalize((await roundTrip(deck)).deck)).toEqual(expected);
  });

  it.each(DECK_TEMPLATES.map((t) => [t.id, t] as const))(
    "preserves the %s template",
    async (_id, t) => {
      const deck = t.build();
      expect(normalize((await roundTrip(deck)).deck)).toEqual(normalize(deck));
    },
  );

  it("is stable: a second export of the imported deck reads back identically", async () => {
    const once = (await roundTrip(FULL)).deck;
    const twice = (await roundTrip(once)).deck;
    expect(normalize(twice)).toEqual(normalize(once));
  });

  it("preserves groups: nested, rotated and flipped, with members of every kind", async () => {
    const deck: DeckDoc = {
      slides: [
        {
          id: "s",
          background: "#ffffff",
          elements: [
            { ...newElement("rect"), x: 0, y: 0 },
            {
              id: "g",
              type: "group",
              x: 100,
              y: 80,
              w: 400,
              h: 300,
              rotation: 30,
              flipH: true,
              children: [
                { ...newElement("text"), x: 100, y: 80, w: 200, h: 60, text: "In a group" },
                {
                  id: "inner",
                  type: "group",
                  x: 300,
                  y: 200,
                  w: 200,
                  h: 180,
                  children: [
                    { ...newElement("ellipse"), x: 300, y: 200, w: 100, h: 80 },
                    { ...newElement("roundRect"), x: 400, y: 300, w: 100, h: 80, rotation: 45 },
                  ],
                },
                { ...newElement("image", PNG_1PX), x: 120, y: 280, w: 80, h: 80 },
              ],
            },
            { ...newElement("ellipse"), x: 700, y: 400 },
          ],
        },
      ],
    };
    const r = await roundTrip(deck);
    expect(r.warnings).toEqual([]);
    expect(normalize(r.deck)).toEqual(normalize(deck));
    // And again (stable).
    expect(normalize((await roundTrip(r.deck)).deck)).toEqual(normalize(deck));
  });

  it("keeps non-integer px geometry and font sizes to 0.01 px", async () => {
    const el: SlideElement = {
      id: "t",
      type: "text",
      x: 10.25,
      y: 33.33,
      w: 123.45,
      h: 67.89,
      text: "x",
      fontSize: 13,
    };
    const r = await roundTrip({
      slides: [{ id: "s", background: "#ffffff", elements: [el] }],
    });
    expect(r.deck.slides[0].elements[0]).toMatchObject({
      x: 10.25,
      y: 33.33,
      w: 123.45,
      h: 67.89,
      fontSize: 13,
    });
  });
});
