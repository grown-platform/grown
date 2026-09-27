// Drop cap (Docs M13): paragraph attributes rendered with CSS
// `initial-letter` on ::first-letter (a float fallback for browsers
// without it). Word keeps a drop cap as a separate framed paragraph
// (w:framePr w:dropCap="drop|margin" w:lines="N") holding the letter; the
// DOCX reader merges that frame into the paragraph after it and the writer
// splits it back out (docx/read.ts, docx/write.ts).
import { Extension } from "@tiptap/core";

export type DropCapKind = "drop" | "margin";

export interface DropCapProps {
  kind: DropCapKind;
  /** Lines to drop (1-10). */
  lines: number;
  /** Letter font (null: the paragraph's). */
  font: string | null;
  /** Distance from the text, points. */
  distance: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    dropCap: {
      /** Set (or with null remove) the drop cap of the paragraph at the caret. */
      setDropCap: (props: Partial<DropCapProps> | null) => ReturnType;
    };
  }
}

const num = (v: string | null, d: number) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : d;
};

export const DropCap = Extension.create({
  name: "dropCap",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          dropCap: {
            default: null,
            parseHTML: (el) => {
              const v = (el as HTMLElement).getAttribute("data-drop-cap");
              return v === "drop" || v === "margin" ? v : null;
            },
            renderHTML: (a) => (a.dropCap ? { "data-drop-cap": a.dropCap } : {}),
          },
          dropCapLines: {
            default: 3,
            parseHTML: (el) => Math.max(1, Math.min(10, Math.round(num((el as HTMLElement).getAttribute("data-drop-lines"), 3)))),
            renderHTML: (a) => (a.dropCap ? { "data-drop-lines": String(a.dropCapLines ?? 3), style: `--dc-lines:${a.dropCapLines ?? 3};--dc-gap:${a.dropCapDistance ?? 0}pt` } : {}),
          },
          dropCapFont: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).getAttribute("data-drop-font") || null,
            renderHTML: (a) => (a.dropCap && a.dropCapFont ? { "data-drop-font": a.dropCapFont, style: `--dc-font:${JSON.stringify(a.dropCapFont)}` } : {}),
          },
          dropCapDistance: {
            default: 0,
            parseHTML: (el) => num((el as HTMLElement).getAttribute("data-drop-distance"), 0),
            renderHTML: (a) => (a.dropCap && a.dropCapDistance ? { "data-drop-distance": String(a.dropCapDistance) } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setDropCap:
        (props) =>
        ({ state, tr, dispatch }) => {
          const $f = state.selection.$from;
          let depth = -1;
          for (let d = $f.depth; d >= 0; d--)
            if ($f.node(d).type.name === "paragraph") {
              depth = d;
              break;
            }
          if (depth < 0) return false;
          const pos = $f.before(depth);
          const node = $f.node(depth);
          const attrs = props
            ? {
                ...node.attrs,
                dropCap: props.kind ?? (node.attrs.dropCap as DropCapKind | null) ?? "drop",
                dropCapLines: Math.max(1, Math.min(10, Math.round(props.lines ?? (node.attrs.dropCapLines as number) ?? 3))),
                dropCapFont: props.font !== undefined ? props.font : node.attrs.dropCapFont,
                dropCapDistance: props.distance ?? node.attrs.dropCapDistance ?? 0,
              }
            : { ...node.attrs, dropCap: null, dropCapLines: 3, dropCapFont: null, dropCapDistance: 0 };
          if (dispatch) dispatch(tr.setNodeMarkup(pos, undefined, attrs));
          return true;
        },
    };
  },
  onCreate() {
    if (typeof document === "undefined" || document.querySelector("style[data-grown='docs-drop-cap']")) return;
    const s = document.createElement("style");
    s.dataset.grown = "docs-drop-cap";
    s.textContent = [
      ".ProseMirror p[data-drop-cap]::first-letter{initial-letter:var(--dc-lines,3);-webkit-initial-letter:var(--dc-lines,3);font-family:var(--dc-font,inherit);margin-right:calc(var(--dc-gap,0pt) + .08em);color:inherit}",
      "@supports not (initial-letter: 2){.ProseMirror p[data-drop-cap]::first-letter{float:left;font-size:calc(var(--dc-lines,3) * 1.15em);line-height:.85;padding-top:.08em}}",
      ".ProseMirror p[data-drop-cap='margin']::first-letter{margin-left:-1.1em;margin-right:calc(var(--dc-gap,0pt) + .45em)}",
    ].join("\n");
    document.head.appendChild(s);
  },
});

/** The drop cap of a paragraph node, if any. */
export function dropCapOf(attrs: Record<string, unknown>): DropCapProps | null {
  const kind = attrs.dropCap;
  if (kind !== "drop" && kind !== "margin") return null;
  return {
    kind,
    lines: (attrs.dropCapLines as number) ?? 3,
    font: (attrs.dropCapFont as string | null) ?? null,
    distance: (attrs.dropCapDistance as number) ?? 0,
  };
}
