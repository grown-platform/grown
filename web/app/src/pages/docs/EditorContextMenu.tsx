import { useEffect, useRef, useState } from "react";
import { Sheet, List, ListItemButton, ListDivider, Typography } from "@mui/joy";
import type { Editor } from "@tiptap/react";
import { copySelection, cutSelection, paste } from "./editorActions";
import { promptLink } from "./links";
import { isInTable } from "@tiptap/pm/tables";
import { distributeColumns, distributeRows } from "./tables";
import { openTableSettings } from "./TableUI";
import { openObjectSettings } from "./ObjectsUI";
import { arrangeObject, selectedObject } from "./objectNodes";
import { EquationMenuItems, mathAt } from "./math/EquationMenu";
import { NodeSelection } from "@tiptap/pm/state";
import { followAt, updateFields, updateTocAt } from "./references";
import { followLink } from "./bookmarks";
import { openReferenceDialog } from "./ReferenceDialogs";
import { SpellMenuItems, spellingAtEvent } from "./SpellMenu";
import type { SpellWord } from "./spellcheck";

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
  // Field / table of contents / link under the pointer (M8).
  const [refAt, setRefAt] = useState<{ field: number | null; toc: number | null; href: string | null }>({ field: null, toc: null, href: null });
  // The misspelled word under the pointer (M13).
  const [spell, setSpell] = useState<SpellWord | null>(null);
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
      const t = e.target as HTMLElement;
      const at = (sel: string) => {
        const el = t.closest?.(sel);
        if (!el || !editor.view.dom.contains(el)) return null;
        try {
          const p = editor.view.posAtDOM(el, 0);
          return p > 0 ? p - (sel === ".doc-toc" ? 1 : 0) : p;
        } catch {
          return null;
        }
      };
      const fieldEl = t.closest?.(".doc-field");
      let field: number | null = null;
      if (fieldEl) {
        try {
          const p = editor.view.posAtDOM(fieldEl, 0);
          field = editor.state.doc.nodeAt(p)?.type.name === "field" ? p : editor.state.doc.nodeAt(p - 1)?.type.name === "field" ? p - 1 : null;
        } catch {
          field = null;
        }
      }
      let toc: number | null = null;
      if (t.closest?.(".doc-toc")) {
        const { from } = editor.state.selection;
        editor.state.doc.descendants((n, p) => {
          if (n.type.name === "tableOfContents" && p <= from && from <= p + n.nodeSize) toc = p;
          return toc == null && !n.isTextblock;
        });
        if (toc == null) toc = at(".doc-toc");
      }
      setRefAt({ field, toc, href: t.closest?.("a[href]")?.getAttribute("href") ?? null });
      setSpell(t.closest?.(".spell-error") ? spellingAtEvent(editor, e) : null);
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
        {spell && <SpellMenuItems editor={editor} m={spell} run={run} />}
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
        {refAt.href && (
          <>
            <ListItemButton onClick={run(() => followLink(editor, refAt.href!))} role="menuitem">
              Open link{kbd("Ctrl+click")}
            </ListItemButton>
            <ListItemButton onClick={run(() => openReferenceDialog("hyperlink"))} role="menuitem">
              Link settings…
            </ListItemButton>
          </>
        )}
        {refAt.field != null && (
          <>
            <ListItemButton
              onClick={run(() => {
                const p = refAt.field!;
                editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, p)));
                updateFields(editor, "selection");
              })}
              role="menuitem"
              data-testid="ctx-update-field"
            >
              Update field{kbd("F9")}
            </ListItemButton>
            <ListItemButton onClick={run(() => void followAt(editor, refAt.field!))} role="menuitem">
              Go to reference
            </ListItemButton>
          </>
        )}
        {refAt.toc != null && (
          <>
            <ListItemButton onClick={run(() => void updateTocAt(editor, refAt.toc!))} role="menuitem" data-testid="ctx-update-toc">
              Update table{kbd("F9")}
            </ListItemButton>
            <ListItemButton onClick={run(() => openReferenceDialog("toc"))} role="menuitem">
              Table settings…
            </ListItemButton>
          </>
        )}
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
        {(() => {
          // A selected picture, shape or chart (M7).
          const obj = selectedObject(editor.state);
          if (!obj) return null;
          return (
            <>
              <ListDivider />
              <ListItemButton onClick={run(() => openObjectSettings())} role="menuitem" data-testid="ctx-object-settings">
                {obj.node.type.name === "chart" ? "Chart settings…" : obj.node.type.name === "shape" || obj.node.type.name === "textBox" ? "Shape settings…" : "Image settings…"}
              </ListItemButton>
              <ListItemButton onClick={run(() => arrangeObject(editor.view, obj.pos, "front"))} role="menuitem">
                Bring to front
              </ListItemButton>
              <ListItemButton onClick={run(() => arrangeObject(editor.view, obj.pos, "back"))} role="menuitem">
                Send to back
              </ListItemButton>
            </>
          );
        })()}
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
