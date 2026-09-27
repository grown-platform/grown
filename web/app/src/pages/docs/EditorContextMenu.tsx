import { useEffect, useRef, useState } from "react";
import { Sheet, List, ListItemButton, ListDivider, Typography } from "@mui/joy";
import type { Editor } from "@tiptap/react";
import { copySelection, cutSelection, paste } from "./editorActions";
import { promptLink } from "./links";
import { isInTable } from "@tiptap/pm/tables";
import { distributeColumns, distributeRows } from "./tables";
import { openTableSettings } from "./TableUI";
import { EquationMenuItems, mathAt } from "./math/EquationMenu";

interface MenuPos {
  x: number;
  y: number;
}

interface EditorContextMenuProps {
  editor: Editor | null;
  /** onComment opens the comments panel anchored to the current selection. */
  onComment: () => void;
  /** onEditEquation opens the equation panel for the math node at pos. */
  onEditEquation?: (pos: number) => void;
}

function kbd(s: string) {
  return (
    <Typography level="body-xs" sx={{ ml: "auto", pl: 3, opacity: 0.5 }}>
      {s}
    </Typography>
  );
}

/** EditorContextMenu renders a right-click menu over the editor with the
 *  document body actions (Cut/Copy/Paste, Comment, Insert link, …). Items that
 *  require a selection are disabled when nothing is selected, mirroring Docs. */
export function EditorContextMenu({
  editor,
  onComment,
  onEditEquation,
}: EditorContextMenuProps) {
  const [pos, setPos] = useState<MenuPos | null>(null);
  // The equation under the pointer (M11), as a document position.
  const [mathPos, setMathPos] = useState<number | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [inTable, setInTable] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    const el = editor.view.dom as HTMLElement;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const { from, to } = editor.state.selection;
      setHasSelection(from !== to);
      setInTable(isInTable(editor.state));
      setMathPos(mathAt(editor, e.target as HTMLElement));
      setPos({ x: e.clientX, y: e.clientY });
    };
    el.addEventListener("contextmenu", onContextMenu);
    return () => el.removeEventListener("contextmenu", onContextMenu);
  }, [editor]);

  // Dismiss on outside click, scroll, or Escape.
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    // Defer so the opening click doesn't immediately close it.
    const t = window.setTimeout(
      () => document.addEventListener("mousedown", onDown),
      0,
    );
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.clearTimeout(t);
    };
  }, [pos]);

  if (!pos || !editor) return null;

  const run = (fn: () => void) => () => {
    fn();
    setPos(null);
  };

  // Clamp the menu within the viewport.
  const MENU_W = 240,
    MENU_H = 360;
  const x = Math.min(pos.x, window.innerWidth - MENU_W - 8);
  const y = Math.min(pos.y, window.innerHeight - MENU_H - 8);

  return (
    <Sheet
      ref={ref}
      variant="outlined"
      sx={{
        position: "fixed",
        top: y,
        left: x,
        zIndex: 1300,
        minWidth: MENU_W,
        boxShadow: "md",
        borderRadius: "sm",
        py: 0.5,
      }}
      role="menu"
    >
      <List
        size="sm"
        sx={{
          "--ListItem-radius": "6px",
          "--ListItem-minHeight": "32px",
          px: 0.5,
        }}
      >
        {mathPos != null && (
          <EquationMenuItems editor={editor} pos={mathPos} run={run} onEdit={() => onEditEquation?.(mathPos)} />
        )}
        <ListItemButton
          disabled={!hasSelection}
          onClick={run(() => cutSelection())}
          role="menuitem"
        >
          Cut{kbd("Ctrl+X")}
        </ListItemButton>
        <ListItemButton
          disabled={!hasSelection}
          onClick={run(() => copySelection())}
          role="menuitem"
        >
          Copy{kbd("Ctrl+C")}
        </ListItemButton>
        <ListItemButton
          onClick={run(() => {
            void paste(editor, false);
          })}
          role="menuitem"
        >
          Paste{kbd("Ctrl+V")}
        </ListItemButton>
        <ListItemButton
          onClick={run(() => {
            void paste(editor, true);
          })}
          role="menuitem"
        >
          Paste without formatting{kbd("Ctrl+Shift+V")}
        </ListItemButton>
        <ListDivider />
        <ListItemButton
          disabled={!hasSelection}
          onClick={run(() => onComment())}
          role="menuitem"
        >
          Comment{kbd("Ctrl+Alt+M")}
        </ListItemButton>
        <ListItemButton
          onClick={run(() => {
            promptLink(editor);
          })}
          role="menuitem"
        >
          Insert link{kbd("Ctrl+K")}
        </ListItemButton>
        <ListDivider />
        <ListItemButton
          disabled={!hasSelection}
          onClick={run(() => editor.chain().focus().toggleBold().run())}
          role="menuitem"
        >
          Bold{kbd("Ctrl+B")}
        </ListItemButton>
        <ListItemButton
          disabled={!hasSelection}
          onClick={run(() => editor.chain().focus().toggleItalic().run())}
          role="menuitem"
        >
          Italic{kbd("Ctrl+I")}
        </ListItemButton>
        {inTable && (
          <>
            <ListDivider />
            <ListItemButton onClick={run(() => editor.chain().focus().addRowAfter().run())} role="menuitem">
              Insert row below
            </ListItemButton>
            <ListItemButton onClick={run(() => editor.chain().focus().addColumnAfter().run())} role="menuitem">
              Insert column right
            </ListItemButton>
            <ListItemButton onClick={run(() => editor.chain().focus().mergeOrSplit().run())} role="menuitem">
              Merge / split cells
            </ListItemButton>
            <ListItemButton onClick={run(() => distributeColumns(editor))} role="menuitem">
              Distribute columns
            </ListItemButton>
            <ListItemButton onClick={run(() => distributeRows(editor))} role="menuitem">
              Distribute rows
            </ListItemButton>
            <ListItemButton onClick={run(() => openTableSettings())} role="menuitem">
              Table settings…
            </ListItemButton>
          </>
        )}
        <ListDivider />
        <ListItemButton
          disabled={!hasSelection}
          onClick={run(() => editor.chain().focus().deleteSelection().run())}
          role="menuitem"
        >
          Delete
        </ListItemButton>
        <ListItemButton
          onClick={run(() => editor.chain().focus().selectAll().run())}
          role="menuitem"
        >
          Select all{kbd("Ctrl+A")}
        </ListItemButton>
      </List>
    </Sheet>
  );
}
