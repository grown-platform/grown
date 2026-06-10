import { useEffect, useRef, useState } from "react";
import { Sheet, List, ListItemButton, ListDivider, Typography } from "@mui/joy";
import type { Editor } from "@tiptap/react";
import { copySelection, cutSelection, paste } from "./editorActions";

interface MenuPos {
  x: number;
  y: number;
}

interface EditorContextMenuProps {
  editor: Editor | null;
  /** onComment opens the comments panel anchored to the current selection. */
  onComment: () => void;
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
}: EditorContextMenuProps) {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    const el = editor.view.dom as HTMLElement;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const { from, to } = editor.state.selection;
      setHasSelection(from !== to);
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
            const prev = (editor.getAttributes("link").href as string) || "";
            const url = window.prompt("Link URL", prev);
            if (url === null) return;
            if (url === "") editor.chain().focus().unsetLink().run();
            else editor.chain().focus().setLink({ href: url }).run();
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
