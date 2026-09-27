import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { deckToPptx } from "./write";
import { readPptx } from "./read";
import { findTransitionEl, insertTiming, insertTransition, readTiming, readTransitionEl, transitionXml } from "./motionXml";
import { TRANSITION_DEFS, slideTransition } from "../transitions";
import { ANIM_CATALOG } from "../animOps";
import type { AnimEffect, DeckDoc, Slide, SlideElement } from "../model";

// Transitions (p:transition) and animations (p:timing), M8. Packages are
// generated here with deckToPptx; the foreign-timing case is hand-written
// from ECMA-376 §19.5.

const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml").documentElement;
const NS = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`;

describe("transition XML", () => {
  it("writes each type with its option, and reads it back", () => {
    for (const d of TRANSITION_DEFS) {
      if (d.type === "none") continue;
      for (const o of d.options.length ? d.options : [{ value: undefined }]) {
        const slide: Slide = { id: "s", background: "#fff", elements: [], transition: d.type, ...(o.value ? { transitionDir: o.value } : {}) };
        const xml = transitionXml(slide);
        const tr = findTransitionEl(parse(`<p:sld ${NS}>${xml}</p:sld>`));
        const back = readTransitionEl(tr);
        expect(back.transition).toBe(d.type);
        if (o.value) expect(slideTransition(back).dir).toBe(o.value);
        expect(back.transitionDur).toBeUndefined();
      }
    }
  });

  it("writes durations as p14:dur with a classic fallback, and advance timings", () => {
    const xml = transitionXml({ transition: "wipe", transitionDir: "d", transitionDur: 1250, advanceOnClick: false, advanceAfter: 4000 });
    expect(xml).toContain(`Requires="p14"`);
    expect(xml).toContain(`<p:transition spd="slow" p14:dur="1250" advClick="0" advTm="4000"><p:wipe dir="d"/></p:transition>`);
    expect(xml).toContain(`<mc:Fallback><p:transition spd="slow" advClick="0" advTm="4000"><p:wipe dir="d"/></p:transition></mc:Fallback>`);
    const back = readTransitionEl(findTransitionEl(parse(`<p:sld ${NS}>${xml}</p:sld>`)));
    expect(back).toEqual({ transition: "wipe", transitionDir: "d", transitionDur: 1250, advanceOnClick: false, advanceAfter: 4000 });
    // Morph and reveal need their extension; the fallback is a fade.
    const morph = transitionXml({ transition: "morph" });
    expect(morph).toContain(`Requires="p159"`);
    expect(morph).toContain(`<p159:morph option="byObject"/>`);
    expect(morph).toContain(`<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback>`);
    // Advance timing alone (no transition effect).
    expect(transitionXml({ advanceAfter: 2000 })).toBe(`<p:transition advTm="2000"/>`);
    expect(readTransitionEl(parse(`<p:transition ${NS} advTm="2000"/>`))).toEqual({ advanceAfter: 2000 });
    expect(transitionXml({})).toBe("");
  });

  it("reads classic speeds and extension effects", () => {
    const r = (x: string) => readTransitionEl(parse(`<p:transition ${NS} ${x}</p:transition>`));
    expect(r(`spd="fast"><p:fade thruBlk="1"/>`)).toEqual({ transition: "fade", transitionDir: "black", transitionDur: 500 });
    expect(r(`spd="med"><p:split orient="vert" dir="in"/>`)).toEqual({ transition: "split", transitionDir: "vert-in", transitionDur: 750 });
    expect(r(`><p:pull dir="d"/>`)).toEqual({ transition: "uncover", transitionDir: "d" });
    expect(r(`><p:zoom dir="out"/>`)).toEqual({ transition: "zoom", transitionDir: "out" });
    expect(r(`><p:checker/>`)).toEqual({ transition: "fade" });
  });

  it("replaces an existing transition (AlternateContent too) and puts timing after it", () => {
    const alt = transitionXml({ transition: "reveal" });
    const src = `<p:sld><p:cSld/><p:clrMapOvr/>${alt}<p:timing><p:tnLst/></p:timing></p:sld>`;
    const out = insertTransition(src, `<p:transition><p:fade/></p:transition>`);
    expect(out).toBe(`<p:sld><p:cSld/><p:clrMapOvr/><p:transition><p:fade/></p:transition><p:timing><p:tnLst/></p:timing></p:sld>`);
    expect(insertTiming(out, "<p:timing/>")).toBe(`<p:sld><p:cSld/><p:clrMapOvr/><p:transition><p:fade/></p:transition><p:timing/></p:sld>`);
    expect(insertTiming(`<p:sld><p:cSld/><p:clrMapOvr/></p:sld>`, "<p:timing/>")).toBe(`<p:sld><p:cSld/><p:clrMapOvr/><p:timing/></p:sld>`);
    expect(insertTiming(`<p:sld><p:cSld/>${alt}</p:sld>`, "<p:timing/>")).toBe(`<p:sld><p:cSld/>${alt}<p:timing/></p:sld>`);
  });
});

// ------------------------------------------------------------ round trips

const box = (id: string, x: number): SlideElement => ({ id, type: "rect", x, y: 100, w: 80, h: 60, fill: "#4285f4", stroke: "none", strokeWidth: 0 });
const text = (id: string, t: string): SlideElement => ({ id, type: "text", text: t, x: 40, y: 300, w: 400, h: 150, fontSize: 18, color: "#000000" });

/** Effects with element ids replaced by the element's index on the slide. */
function byIndex(s: Slide): Omit<AnimEffect, "id">[] {
  return (s.anims ?? []).map(({ id: _id, el, ...rest }) => ({ ...rest, el: String(s.elements.findIndex((e) => e.id === el)) }));
}

async function roundTrip(deck: DeckDoc) {
  const r = await readPptx(await deckToPptx(deck, "motion"));
  return r;
}

describe("pptx round trip: animations", () => {
  const all: AnimEffect[] = [];
  const els: SlideElement[] = [];
  let n = 0;
  for (const cls of ["entr", "emph", "exit"] as const)
    for (const d of ANIM_CATALOG[cls]) {
      const id = `e${n}`;
      els.push(box(id, 10 + n * 20));
      const e: AnimEffect = { id: `a${n}`, el: id, cls, kind: d.kind, start: n % 3 === 0 ? "click" : n % 3 === 1 ? "with" : "after" };
      if (d.dirs) e.dir = (["l", "r", "t", "b"] as const)[n % 4];
      if (n % 4 === 1) e.delay = 250;
      if (n % 5 === 2) e.dur = 1500;
      if (d.kind === "grow") e.scale = 0.5;
      if (d.kind === "spin") e.angle = 720;
      if (d.kind === "colorPulse") e.color = "#00c853";
      all.push(e);
      n++;
    }
  els.push(text("t", "First point\nSecond point\n\nThird point"));
  all.push({ id: "p", el: "t", cls: "entr", kind: "fly", dir: "l", start: "click", byPara: true });
  all.push({ id: "q", el: "t", cls: "emph", kind: "pulse", start: "after", delay: 500 });
  const deck: DeckDoc = {
    slides: [
      { id: "s1", background: "#ffffff", elements: els, anims: all, transition: "push", transitionDir: "d", transitionDur: 800, advanceAfter: 3000 },
      { id: "s2", background: "#ffffff", elements: [box("x", 10), box("y", 200)], transition: "morph", advanceOnClick: false },
    ],
  };

  it("keeps every catalogue effect with its start, delay, duration and options", async () => {
    const r = await roundTrip(deck);
    expect(r.warnings).toEqual([]);
    const s = r.deck.slides[0];
    expect(byIndex(s)).toEqual(byIndex(deck.slides[0]));
    expect(s.transition).toBe("push");
    expect(s.transitionDir).toBe("d");
    expect(s.transitionDur).toBe(800);
    expect(s.advanceAfter).toBe(3000);
    const s2 = r.deck.slides[1];
    expect([s2.transition, s2.advanceOnClick, s2.anims]).toEqual(["morph", false, undefined]);
  });

  it("survives a double round trip", async () => {
    const once = await roundTrip(deck);
    const twice = await roundTrip(once.deck);
    expect(byIndex(twice.deck.slides[0])).toEqual(byIndex(deck.slides[0]));
  });

  it("writes PowerPoint's timing tree: presets, node types, paragraph targets, build list", async () => {
    const zip = await JSZip.loadAsync(await deckToPptx(deck, "motion"));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml.indexOf("<p:transition")).toBeLessThan(xml.indexOf("<p:timing>"));
    expect(xml).toContain(`nodeType="mainSeq"`);
    expect(xml).toMatch(/presetID="2" presetClass="entr" presetSubtype="8" fill="hold" grpId="0" nodeType="clickEffect"/);
    expect(xml).toContain(`nodeType="withEffect"`);
    expect(xml).toContain(`nodeType="afterEffect"`);
    expect(xml).toContain(`<p:txEl><p:pRg st="3" end="3"/></p:txEl>`);
    expect(xml).toMatch(/<p:bldP spid="\d+" grpId="0" build="p"\/>/);
    expect(xml).toContain(`<p:by x="50000" y="50000"/>`);
    expect(xml).toContain(`<p:animRot by="43200000">`);
    // Every spid in the timing names a shape on the slide.
    const ids = new Set([...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]));
    for (const m of xml.matchAll(/spid="(\d+)"/g)) expect(ids.has(m[1])).toBe(true);
    const slide2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(slide2).not.toContain("<p:timing");
  });

  it("exports pre-M8 element animations and reads them as effects", async () => {
    const legacy: DeckDoc = {
      slides: [
        {
          id: "s",
          background: "#ffffff",
          elements: [
            { ...box("a", 10), animation: { type: "fly-in-left", order: 1 } },
            { ...box("b", 200), animation: { type: "fade-in", order: 1 } },
            { ...box("c", 400), animation: { type: "appear", order: 2 } },
          ],
        },
      ],
    };
    const r = await roundTrip(legacy);
    expect(byIndex(r.deck.slides[0])).toEqual([
      { el: "0", cls: "entr", kind: "fly", dir: "l", start: "click" },
      { el: "1", cls: "entr", kind: "fade", start: "with" },
      { el: "2", cls: "entr", kind: "appear", start: "click" },
    ]);
  });
});

describe("reading foreign timing", () => {
  it("maps presets, skips motion paths with a note, and merges paragraph builds", () => {
    const eff = (id: number, cls: string, pid: number, sub: number, node: string, spid: string, extra = "", delay = 0) =>
      `<p:par><p:cTn id="${id}" presetID="${pid}" presetClass="${cls}" presetSubtype="${sub}" fill="hold" nodeType="${node}"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>` +
      `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${id + 100}" dur="750"/><p:tgtEl><p:spTgt spid="${spid}">${extra}</p:spTgt></p:tgtEl></p:cBhvr></p:animEffect>` +
      `</p:childTnLst></p:cTn></p:par>`;
    const click = (inner: string) => `<p:par><p:cTn id="90" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="91" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
    const para = (i: number) => `<p:txEl><p:pRg st="${i}" end="${i}"/></p:txEl>`;
    const xml =
      `<p:sld ${NS}><p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>` +
      click(eff(3, "entr", 10, 0, "clickEffect", "4", "", 200)) +
      click(eff(4, "path", 0, 0, "clickEffect", "4")) +
      click(eff(5, "entr", 22, 8, "clickEffect", "5", para(0))) +
      click(eff(6, "entr", 22, 8, "clickEffect", "5", para(1))) +
      click(eff(7, "exit", 3, 10, "clickEffect", "6")) +
      `</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`;
    let k = 0;
    const r = readTiming(
      parse(xml),
      new Map([
        ["4", ["A", "A2"]],
        ["5", ["T"]],
        ["6", ["C"]],
      ]),
      () => `id${++k}`,
    );
    expect(r.simplified).toBe(true);
    expect(r.anims.map(({ id: _i, ...e }) => e)).toEqual([
      { el: "A", cls: "entr", kind: "fade", start: "click", delay: 200, dur: 750 },
      { el: "A2", cls: "entr", kind: "fade", start: "with", delay: 200, dur: 750 },
      { el: "T", cls: "entr", kind: "wipe", dir: "l", start: "click", dur: 750, byPara: true },
      { el: "C", cls: "exit", kind: "fade", start: "click", dur: 750 },
    ]);
  });
});
