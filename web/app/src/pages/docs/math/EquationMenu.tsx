// Context-menu items for an equation (Docs M11): edit, linear/professional
// view, display/inline, fraction kind, limit position, brackets, matrix rows
// and columns, delete.
import { ListDivider, ListItemButton, Typography } from "@mui/joy";
import type { Editor } from "@tiptap/react";
import type { Content } from "./model";
import { contentOf } from "./MathNode";
import {
  hasObject,
  isLinearForm,
  matrixDelete,
  matrixInsert,
  removeOuterBrackets,
  setFractionType,
  setLimitLocation,
  toLinearForm,
  toProfessional,
  wrapInBrackets,
} from "./ops";

/** mathAt: the position of the equation containing a DOM target, or null. */
export function mathAt(editor: Editor, target: HTMLElement | null): number | null {
  const el = target?.closest?.(".doc-math") as HTMLElement | null;
  if (!el) return null;
  try {
    const pos = editor.view.posAtDOM(el, 0);
    for (const p of [pos, pos - 1]) {
      const n = p >= 0 ? editor.state.doc.nodeAt(p) : null;
      if (n && n.type.name === "math") return p;
    }
  } catch {
    /* not in the document */
  }
  return null;
}

interface Props {
  editor: Editor;
  pos: number;
  run: (fn: () => void) => () => void;
  onEdit: () => void;
}

export function EquationMenuItems({ editor, pos, run, onEdit }: Props) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "math") return null;
  const c = contentOf(node);
  const set = (next: Content, display?: boolean) => editor.chain().focus().updateEquation(pos, { content: next, display }).run();
  const linear = isLinearForm(c);
  const items: Array<[string, () => void, string?]> = [
    ["Edit equation", onEdit, "eq-edit"],
    linear ? ["Professional format", () => set(toProfessional(c)), "eq-professional"] : ["Linear format", () => set(toLinearForm(c)), "eq-linear"],
    node.attrs.display ? ["Change to inline", () => set(c, false), "eq-inline"] : ["Change to display", () => set(c, true), "eq-display-menu"],
  ];
  if (hasObject(c, "f"))
    items.push(
      ["Stacked fraction", () => set(setFractionType(c, "bar")), "eq-frac-bar"],
      ["Skewed fraction", () => set(setFractionType(c, "skw")), "eq-frac-skw"],
      ["Linear fraction", () => set(setFractionType(c, "lin")), "eq-frac-lin"],
    );
  if (hasObject(c, "nary"))
    items.push(
      ["Limits under and over", () => set(setLimitLocation(c, "undOvr")), "eq-lim-undovr"],
      ["Limits as scripts", () => set(setLimitLocation(c, "subSup")), "eq-lim-subsup"],
    );
  const unwrapped = removeOuterBrackets(c);
  items.push(unwrapped !== c ? ["Remove brackets", () => set(unwrapped), "eq-unwrap"] : ["Add brackets", () => set(wrapInBrackets(c)), "eq-wrap"]);
  if (hasObject(c, "m"))
    items.push(
      ["Insert matrix row", () => set(matrixInsert(c, "row")), "eq-m-row"],
      ["Insert matrix column", () => set(matrixInsert(c, "column")), "eq-m-col"],
      ["Delete matrix row", () => set(matrixDelete(c, "row")), "eq-m-delrow"],
      ["Delete matrix column", () => set(matrixDelete(c, "column")), "eq-m-delcol"],
    );
  items.push(["Delete equation", () => editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run(), "eq-delete"]);
  return (
    <>
      <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
        Equation
      </Typography>
      {items.map(([label, fn, id]) => (
        <ListItemButton key={label} onClick={run(fn)} role="menuitem" data-testid={id}>
          {label}
        </ListItemButton>
      ))}
      <ListDivider />
    </>
  );
}
