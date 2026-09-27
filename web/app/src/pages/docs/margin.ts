// The header/footer (margin) editor's schema, shared by MarginEditor and
// the DOCX reader/writer, which convert the `header` / `footer` Yjs
// fragments to and from ProseMirror documents.
import { Node, getSchema, mergeAttributes, type Extensions } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { DeletionMark, FormatChangeMark, InsertionMark, TrackParagraphs } from "./suggesting";
import { parseInstr } from "./fields";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    marginField: {
      /** Insert a page-dependent field (PAGE, NUMPAGES, SECTIONPAGES,
       *  DATE…) into a header or footer. */
      insertMarginField: (instr: string) => ReturnType;
    };
  }
}

/** Page-number formats a field may ask for (`\* roman`), as CSS counters. */
export function fieldCounterFormat(instr: string): string | null {
  const f = parseInstr(instr).formats.map((x) => x.toLowerCase());
  if (f.includes("roman")) return parseInstr(instr).formats.includes("ROMAN") ? "upper-roman" : "lower-roman";
  if (f.includes("alphabetic")) return parseInstr(instr).formats.includes("ALPHABETIC") ? "upper-alpha" : "lower-alpha";
  return null;
}

/** Fields that show the page they are drawn on (M9). */
export const PAGE_FIELDS = new Set(["PAGE", "NUMPAGES", "SECTIONPAGES"]);

/**
 * MarginField: the header/footer version of the body's `field` node (same
 * name and attributes, so DOCX and the body share code). PAGE, NUMPAGES
 * and SECTIONPAGES render through CSS counters that every page's header /
 * footer box sets (counter-reset: hfpage N hfpages M hfsecpages K), so one
 * shared header shows the right number on each page.
 */
export const MarginField = Node.create({
  name: "field",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      instr: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-field-instr") ?? "",
        renderHTML: (a) => ({ "data-field-instr": a.instr }),
      },
      result: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-field-result") ?? el.textContent ?? "",
        renderHTML: (a) => (a.result ? { "data-field-result": a.result } : {}),
      },
      locked: {
        default: false,
        parseHTML: (el) => (el as HTMLElement).hasAttribute("data-field-locked"),
        renderHTML: (a) => (a.locked ? { "data-field-locked": "true" } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-field-instr]", priority: 60 }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const instr = String(node.attrs.instr ?? "");
    const type = parseInstr(instr).type;
    const live = PAGE_FIELDS.has(type);
    const fmt = fieldCounterFormat(instr);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "hf-field",
        "data-field": type,
        ...(fmt ? { "data-fmt": fmt } : {}),
        contenteditable: "false",
      }),
      live ? "" : String(node.attrs.result ?? ""),
    ];
  },
  renderText({ node }) {
    return String(node.attrs.result ?? "");
  },
  addCommands() {
    return {
      insertMarginField:
        (instr) =>
        ({ tr, dispatch }) => {
          const type = parseInstr(instr).type;
          const result = type === "DATE" ? new Date().toLocaleDateString() : "";
          tr.replaceSelectionWith(this.type.create({ instr, result }), false);
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      "Alt-Shift-p": () => this.editor.commands.insertMarginField("PAGE"),
      "Alt-Shift-P": () => this.editor.commands.insertMarginField("PAGE"),
    };
  },
});

/** The extensions MarginEditor uses (minus Collaboration and the
 *  Suggesting plugin). Tracked-change marks and paragraph attributes are
 *  part of the schema so changes in headers and footers can be tracked. */
export function marginExtensions(): Extensions {
  return [
    StarterKit.configure({ history: false }),
    Underline,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    InsertionMark,
    DeletionMark,
    FormatChangeMark,
    TrackParagraphs,
    MarginField,
  ];
}

let schema: Schema | null = null;

export function marginSchema(): Schema {
  return (schema ??= getSchema(marginExtensions()));
}

/** CSS for header/footer fields inside a box that sets the counters. */
export const MARGIN_FIELD_CSS: Record<string, Record<string, string>> = {
  "& .hf-field": { whiteSpace: "nowrap" },
  "& .hf-field[data-field='PAGE']::after": { content: "counter(hfpage)" },
  "& .hf-field[data-field='NUMPAGES']::after": { content: "counter(hfpages)" },
  "& .hf-field[data-field='SECTIONPAGES']::after": { content: "counter(hfsecpages)" },
  "& .hf-field[data-field='PAGE'][data-fmt='lower-roman']::after": { content: "counter(hfpage, lower-roman)" },
  "& .hf-field[data-field='PAGE'][data-fmt='upper-roman']::after": { content: "counter(hfpage, upper-roman)" },
  "& .hf-field[data-field='PAGE'][data-fmt='lower-alpha']::after": { content: "counter(hfpage, lower-alpha)" },
  "& .hf-field[data-field='PAGE'][data-fmt='upper-alpha']::after": { content: "counter(hfpage, upper-alpha)" },
  "& [data-pgfmt='lowerRoman'] .hf-field[data-field='PAGE']:not([data-fmt])::after": { content: "counter(hfpage, lower-roman)" },
  "& [data-pgfmt='upperRoman'] .hf-field[data-field='PAGE']:not([data-fmt])::after": { content: "counter(hfpage, upper-roman)" },
  "& [data-pgfmt='lowerLetter'] .hf-field[data-field='PAGE']:not([data-fmt])::after": { content: "counter(hfpage, lower-alpha)" },
  "& [data-pgfmt='upperLetter'] .hf-field[data-field='PAGE']:not([data-fmt])::after": { content: "counter(hfpage, upper-alpha)" },
};
