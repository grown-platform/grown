import { describe, expect, it } from "vitest";
import { makeEditor } from "./harness";
import { promptLink, syncSelectionFromDOM } from "../links";

/** Select the first paragraph's text in the DOM only, as the browser does
 *  for Shift+Home before its selectionchange event reaches ProseMirror. */
function selectInDomOnly(root: HTMLElement) {
  const text = root.querySelector("p")!.firstChild!;
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.setBaseAndExtent(text, text.textContent!.length, text, 0);
}

describe("Ctrl+K link race (flaky oo-shortcuts e2e)", () => {
  it("syncSelectionFromDOM reads a selection the state hasn't seen yet", () => {
    const ed = makeEditor("<p>Grown</p>");
    expect(ed.state.selection.empty).toBe(true);
    selectInDomOnly(ed.view.dom);
    expect(syncSelectionFromDOM(ed.view)).toBe(true);
    const { anchor, head } = ed.state.selection;
    expect([anchor, head]).toEqual([6, 1]);
    // Nothing to do the second time.
    expect(syncSelectionFromDOM(ed.view)).toBe(false);
  });

  it("promptLink links the DOM selection even when the state is stale", () => {
    const ed = makeEditor("<p>Grown</p>");
    selectInDomOnly(ed.view.dom);
    const href = promptLink(ed, { prompt: () => "https://example.com" });
    expect(href).toBe("https://example.com");
    const a = ed.view.dom.querySelector('a[href="https://example.com"]');
    expect(a?.textContent).toBe("Grown");
  });

  it("an empty selection inserts the URL as linked text; empty input unlinks", () => {
    const ed = makeEditor("<p>See </p>");
    promptLink(ed, { prompt: () => "https://grown.haus" });
    expect(ed.view.dom.querySelector("a")?.textContent).toBe("https://grown.haus");
    ed.commands.setTextSelection(7);
    promptLink(ed, { prompt: () => "" });
    expect(ed.view.dom.querySelector("a")).toBeNull();
    expect(ed.getText()).toBe("Seehttps://grown.haus"); // HTML parsing trims the trailing space
  });

  it("cancel leaves the document alone", () => {
    const ed = makeEditor("<p>Grown</p>", { cursor: "all" });
    expect(promptLink(ed, { prompt: () => null })).toBeNull();
    expect(ed.view.dom.querySelector("a")).toBeNull();
  });
});
