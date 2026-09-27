import { describe, expect, it } from "vitest";
import type { Slide } from "./model";
import { deleteSlides, moveSlides, railAt, railClamp, railClick, railGo, railSelectAll, railTarget, type RailSel } from "./railOps";
import { editorKeyAction, railKeyAction } from "./keymap";
import { addNextSlide } from "./deckOps";

const deck = (n: number): Slide[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, background: "#fff", elements: [] }));
const ids = (xs: Slide[]) => xs.map((x) => x.id);

/** Replays rail keys the way DeckEditor does, on a deck and a selection. */
function press(slides: Slide[], s: RailSel, key: string, mods: { ctrl?: boolean; shift?: boolean } = {}): { slides: Slide[]; s: RailSel } {
  const a = railKeyAction({ key, ctrlKey: mods.ctrl, shiftKey: mods.shift });
  if (!a) return { slides, s };
  switch (a.type) {
    case "go":
      return { slides, s: railGo(s, railTarget(s.cur, a.to, slides.length), a.extend) };
    case "move": {
      const r = moveSlides(slides, s, a.how);
      return r ? { slides: r.slides, s: r.sel } : { slides, s };
    }
    case "delete": {
      const r = deleteSlides(slides, s, () => ({ id: "blank", background: "#fff", elements: [] }));
      return { slides: r.slides, s: r.sel };
    }
    case "selectAll":
      return { slides, s: railSelectAll(slides.length, s.cur) };
    case "newSlide": {
      const r = addNextSlide(slides, s.cur, () => ({ id: `new${slides.length}`, background: "#fff", elements: [] }));
      return { slides: r.slides, s: railAt(r.cur) };
    }
    default:
      return { slides, s };
  }
}

describe("OnlyOffice parity: slide rail", () => {
  it("oo:slide/shortcuts/shortcuts.js#Check actions with slides", () => {
    let slides = deck(7);
    let s = railAt(0);
    // Ctrl+M and Enter add the next slide and select it.
    ({ slides, s } = press(slides, s, "m", { ctrl: true }));
    expect(s.cur).toBe(1);
    expect(slides[1].id).toBe("new7");
    ({ slides, s } = press(slides, s, "Enter"));
    expect(s).toEqual(railAt(2));
    expect(slides).toHaveLength(9);
    slides = deck(7);
    s = railAt(0);
    // Down / Up / PgDn / PgUp / Home / End move.
    ({ s } = press(slides, s, "ArrowDown"));
    expect(s.cur).toBe(1);
    ({ s } = press(slides, s, "ArrowUp"));
    expect(s.cur).toBe(0);
    ({ s } = press(slides, s, "PageDown"));
    expect(s.cur).toBe(5);
    ({ s } = press(slides, s, "PageUp"));
    expect(s.cur).toBe(0);
    ({ s } = press(slides, s, "End"));
    expect(s.cur).toBe(6);
    ({ s } = press(slides, s, "Home"));
    expect(s).toEqual(railAt(0));
    // Shift+Down / Shift+Up extend the selection.
    ({ s } = press(slides, s, "ArrowDown", { shift: true }));
    ({ s } = press(slides, s, "ArrowDown", { shift: true }));
    ({ s } = press(slides, s, "ArrowDown", { shift: true }));
    expect(s.sel).toEqual([0, 1, 2, 3]);
    ({ s } = press(slides, s, "ArrowUp", { shift: true }));
    expect(s.sel).toEqual([0, 1, 2]);
    // Shift+End / Shift+Home select to the end / start.
    ({ s } = press(slides, railAt(3), "End", { shift: true }));
    expect(s.sel).toEqual([3, 4, 5, 6]);
    ({ s } = press(slides, railAt(3), "Home", { shift: true }));
    expect(s.sel).toEqual([0, 1, 2, 3]);
    // Ctrl+Down moves the selected slides [0..3] down one, still selected.
    ({ slides, s } = press(slides, s, "ArrowDown", { ctrl: true }));
    expect(ids(slides)).toEqual(["s4", "s0", "s1", "s2", "s3", "s5", "s6"]);
    expect(s.sel).toEqual([1, 2, 3, 4]);
    ({ slides, s } = press(slides, s, "ArrowUp", { ctrl: true }));
    expect(ids(slides)).toEqual(ids(deck(7)));
    expect(s.sel).toEqual([0, 1, 2, 3]);
    // Ctrl+Shift+Down / Up move them to the end / start.
    ({ slides, s } = press(slides, s, "ArrowDown", { ctrl: true, shift: true }));
    expect(ids(slides)).toEqual(["s4", "s5", "s6", "s0", "s1", "s2", "s3"]);
    expect(s.sel).toEqual([3, 4, 5, 6]);
    ({ slides, s } = press(slides, s, "ArrowUp", { ctrl: true, shift: true }));
    expect(ids(slides)).toEqual(ids(deck(7)));
    // Delete / Backspace remove the selection.
    ({ slides, s } = press(slides, s, "Delete"));
    expect(ids(slides)).toEqual(["s4", "s5", "s6"]);
    ({ slides, s } = press(slides, railAt(1), "Backspace"));
    expect(ids(slides)).toEqual(["s4", "s6"]);
    // Ctrl+A selects every slide.
    ({ s } = press(slides, s, "a", { ctrl: true }));
    expect(s.sel).toEqual([0, 1]);
    // On the canvas the same Ctrl+M adds a slide (main-canvas hotkeys).
    expect(editorKeyAction({ key: "m", ctrlKey: true }, { hasSelection: false })).toEqual({ type: "newSlide" });
  });
});

describe("railOps", () => {
  it("click, Shift+click and Ctrl+click", () => {
    let s = railClick(railAt(2), 5, { shift: true });
    expect(s).toEqual({ sel: [2, 3, 4, 5], anchor: 2, cur: 5 });
    s = railClick(s, 3, { toggle: true });
    expect(s.sel).toEqual([2, 4, 5]);
    s = railClick(s, 0, { toggle: true });
    expect(s).toEqual({ sel: [0, 2, 4, 5], anchor: 0, cur: 0 });
    expect(railClick(railAt(1), 1, { toggle: true })).toEqual(railAt(1)); // never empty
    expect(railClick(s, 3, {})).toEqual(railAt(3));
  });

  it("moves a non-contiguous selection, keeping order", () => {
    const r = moveSlides(deck(5), { sel: [0, 2], anchor: 0, cur: 2 }, 1)!;
    expect(ids(r.slides)).toEqual(["s1", "s0", "s3", "s2", "s4"]);
    expect(r.sel).toEqual({ sel: [1, 3], anchor: 1, cur: 3 });
    expect(moveSlides(deck(3), railAt(2), 1)).toBeNull();
    expect(moveSlides(deck(3), railAt(0), -1)).toBeNull();
    expect(moveSlides(deck(3), railAt(0), "start")).toBeNull();
  });

  it("deleting everything leaves one blank slide", () => {
    const r = deleteSlides(deck(2), railSelectAll(2, 0), () => ({ id: "b", background: "#fff", elements: [] }));
    expect(ids(r.slides)).toEqual(["b"]);
    expect(r.sel).toEqual(railAt(0));
  });

  it("clamps after remote deletions", () => {
    expect(railClamp({ sel: [3, 4], anchor: 3, cur: 4 }, 3)).toEqual({ sel: [2], anchor: 2, cur: 2 });
  });
});
