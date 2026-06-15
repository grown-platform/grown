import { Node, mergeAttributes } from "@tiptap/core";

// Drawing is a block node holding an Excalidraw scene. The editable scene JSON
// lives in `scene`; a rendered SVG data-URL lives in `src` so the drawing
// displays inline and survives HTML export. Double-clicking re-opens the
// Excalidraw editor (handled in DocEditor).

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    drawing: {
      insertDrawing: (attrs: { scene: string; src: string }) => ReturnType;
      updateDrawing: (
        pos: number,
        attrs: { scene: string; src: string },
      ) => ReturnType;
    };
  }
}

export const Drawing = Node.create({
  name: "drawing",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      scene: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-scene") || "",
        renderHTML: (attrs) =>
          attrs.scene ? { "data-scene": attrs.scene } : {},
      },
      src: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("src") || "",
        renderHTML: (attrs) => (attrs.src ? { src: attrs.src } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "img.doc-drawing" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes, { class: "doc-drawing" })];
  },
  addCommands() {
    return {
      insertDrawing:
        (attrs) =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs }).run(),
      updateDrawing:
        (pos, attrs) =>
        ({ tr, dispatch }) => {
          const node = tr.doc.nodeAt(pos);
          if (!node || node.type.name !== "drawing") return false;
          if (dispatch)
            dispatch(tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
          return true;
        },
    };
  },
});
