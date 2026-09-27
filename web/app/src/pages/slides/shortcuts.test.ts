import { describe, expect, it } from "vitest";
import { filterShortcuts, formatKeys, SHORTCUTS } from "./shortcuts";
import { editorKeyAction, isPrintKey, isSaveKey, paneKey, presentKeyAction, railKeyAction, textKeyAction } from "./keymap";

function run(p: NonNullable<(typeof SHORTCUTS)[number]["probe"]>): unknown {
  switch (p.area) {
    case "editor":
      return editorKeyAction(p.input, { hasSelection: !!p.ctx?.hasSelection, drawing: p.ctx?.drawing });
    case "text":
      return textKeyAction(p.input, { editing: !!p.ctx?.editing });
    case "rail":
      return railKeyAction(p.input);
    case "present":
      return presentKeyAction(p.input);
    case "global":
      if (isSaveKey(p.input)) return "save";
      if (isPrintKey(p.input)) return "print";
      if (paneKey(p.input)) return `pane:${paneKey(p.input)}`;
      return null;
  }
}

describe("shortcut table", () => {
  it.each(SHORTCUTS.filter((s) => s.probe).map((s) => [`${s.group}: ${s.label}`, s] as const))("%s", (_, s) => {
    expect(run(s.probe!)).toEqual(s.probe!.action);
  });

  it("every row has keys and a group; most rows are checked against the key maps", () => {
    for (const s of SHORTCUTS) {
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.group).toBeTruthy();
    }
    expect(SHORTCUTS.filter((s) => s.probe).length / SHORTCUTS.length).toBeGreaterThan(0.8);
  });

  it("formats for macOS and filters", () => {
    expect(formatKeys("Ctrl+Shift+Z", true)).toBe("⌘⇧Z");
    expect(formatKeys("Ctrl+Shift+Z", false)).toBe("Ctrl+Shift+Z");
    expect(filterShortcuts("bold").map((s) => s.label)).toEqual(["Bold / italic / underline"]);
    expect(filterShortcuts("ctrl+m").some((s) => s.label === "New slide")).toBe(true);
    expect(filterShortcuts("")).toHaveLength(SHORTCUTS.length);
  });
});
