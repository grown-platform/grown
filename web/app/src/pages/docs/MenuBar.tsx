import { useState } from "react";
import {
  Box,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListItemButton,
  ListDivider,
  Typography,
} from "@mui/joy";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";
import type { Editor } from "@tiptap/react";
import { copySelection, cutSelection, paste } from "./editorActions";
import { downloadDoc, DOWNLOAD_FORMATS } from "./export";

const menuButtonSx = {
  fontWeight: 400,
  fontSize: "0.875rem",
  px: 1,
  py: 0.25,
  minHeight: 0,
  bgcolor: "transparent",
  color: "text.primary",
  "&:hover": { bgcolor: "background.level1" },
};

function kbd(s: string) {
  return (
    <Typography level="body-xs" sx={{ ml: "auto", pl: 3, opacity: 0.5 }}>
      {s}
    </Typography>
  );
}

/** transformSelection rewrites the selected text via fn (for capitalization). */
function transformSelection(editor: Editor, fn: (s: string) => string) {
  const { from, to } = editor.state.selection;
  if (from === to) return;
  const text = editor.state.doc.textBetween(from, to, "\n");
  editor.chain().focus().insertContentAt({ from, to }, fn(text)).run();
}
const toTitleCase = (s: string) =>
  s.replace(
    /\w\S*/g,
    (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
  );

/** bumpFont changes the selection's font size by delta points. */
function bumpFont(editor: Editor, delta: number) {
  const cur =
    parseInt(
      (editor.getAttributes("textStyle").fontSize as string) || "11",
      10,
    ) || 11;
  editor
    .chain()
    .focus()
    .setFontSize(`${Math.max(1, Math.min(96, cur + delta))}pt`)
    .run();
}

/** FileMenu is a controlled dropdown whose Download row expands an inline list
 *  of export formats. Joy's nested-flyout submenus proved unreliable, so we
 *  expand the formats in place within the same menu. */
function FileMenu({
  editor,
  actions,
  title,
}: {
  editor: Editor | null;
  actions: DocActions;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [dl, setDl] = useState(false);
  return (
    <Dropdown
      open={open}
      onOpenChange={(_, o) => {
        setOpen(o);
        if (!o) setDl(false);
      }}
    >
      <MenuButton variant="plain" size="sm" sx={menuButtonSx}>
        File
      </MenuButton>
      <Menu size="sm" placement="bottom-start" sx={{ minWidth: 250 }}>
        <MenuItem onClick={actions.newDoc}>New document</MenuItem>
        <MenuItem onClick={actions.open}>Open…{kbd("Ctrl+O")}</MenuItem>
        <MenuItem onClick={actions.makeCopy}>Make a copy</MenuItem>
        <ListDivider />
        <MenuItem onClick={actions.share}>Share</MenuItem>
        {/* ListItemButton (not MenuItem) so clicking does NOT close the menu. */}
        <ListItemButton
          onClick={() => setDl((v) => !v)}
          sx={{ borderRadius: "sm", fontSize: "0.875rem" }}
        >
          Download
          <ArrowRightIcon
            sx={{
              ml: "auto",
              transition: "transform 120ms",
              transform: dl ? "rotate(90deg)" : "none",
            }}
          />
        </ListItemButton>
        {dl &&
          DOWNLOAD_FORMATS.map(({ fmt, label }) => (
            <MenuItem
              key={fmt}
              sx={{ pl: 3 }}
              onClick={() => {
                // Close the menu first, then run the download on the next tick so
                // the anchor click happens in a stable DOM (not mid-unmount).
                setOpen(false);
                setDl(false);
                setTimeout(() => {
                  if (!editor) {
                    window.alert("Editor not ready yet.");
                    return;
                  }
                  downloadDoc(editor, title, fmt).catch((e) =>
                    window.alert(`Download failed: ${(e as Error).message}`),
                  );
                }, 0);
              }}
            >
              {label}
            </MenuItem>
          ))}
        <ListDivider />
        <MenuItem onClick={actions.nameVersion}>Name current version</MenuItem>
        <MenuItem onClick={actions.versionHistory}>
          Version history{kbd("Ctrl+Alt+Shift+H")}
        </MenuItem>
        <ListDivider />
        <MenuItem onClick={actions.rename}>Rename</MenuItem>
        <MenuItem onClick={actions.docDetails}>Document details</MenuItem>
        <MenuItem color="danger" onClick={actions.trash}>
          Move to trash
        </MenuItem>
        <ListDivider />
        <MenuItem onClick={actions.pageSetup}>Page setup</MenuItem>
        <MenuItem onClick={() => window.print()}>Print{kbd("Ctrl+P")}</MenuItem>
      </Menu>
    </Dropdown>
  );
}

export interface DocActions {
  newDoc: () => void;
  open: () => void;
  makeCopy: () => void;
  rename: () => void;
  trash: () => void;
  share: () => void;
  download: () => void;
  docDetails: () => void;
  wordCount: () => void;
  findReplace: () => void;
  emoji: () => void;
  specialChars: () => void;
  pageSetup: () => void;
  togglePageNumbers: () => void;
  versionHistory: () => void;
  nameVersion: () => void;
  comments: () => void;
  commentOnSelection: () => void;
  searchMenus: () => void;
  shortcuts: () => void;
  toggleOutline: () => void;
}

interface MenuBarProps {
  editor: Editor | null;
  actions: DocActions;
  title: string;
}

export function MenuBar({ editor, actions, title }: MenuBarProps) {
  const run = (fn: (e: Editor) => void) => () => {
    if (editor) fn(editor);
  };

  // Dropdowns open left-aligned (bottom-start) under their menu title.
  const top = (label: string, children: React.ReactNode) => (
    <Dropdown>
      <MenuButton variant="plain" size="sm" sx={menuButtonSx}>
        {label}
      </MenuButton>
      <Menu size="sm" placement="bottom-start" sx={{ minWidth: 240 }}>
        {children}
      </Menu>
    </Dropdown>
  );

  return (
    <Box
      sx={{
        display: "flex",
        gap: 0.25,
        alignItems: "center",
        flexWrap: { xs: "nowrap", md: "wrap" },
        overflowX: { xs: "auto", md: "visible" },
        WebkitOverflowScrolling: "touch",
        pb: { xs: 0.25, md: 0 },
      }}
    >
      <FileMenu editor={editor} actions={actions} title={title} />

      {top(
        "Edit",
        <>
          <MenuItem onClick={run((e) => e.chain().focus().undo().run())}>
            Undo{kbd("Ctrl+Z")}
          </MenuItem>
          <MenuItem onClick={run((e) => e.chain().focus().redo().run())}>
            Redo{kbd("Ctrl+Y")}
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={() => cutSelection()}>Cut{kbd("Ctrl+X")}</MenuItem>
          <MenuItem onClick={() => copySelection()}>
            Copy{kbd("Ctrl+C")}
          </MenuItem>
          <MenuItem onClick={run((e) => paste(e, false))}>
            Paste{kbd("Ctrl+V")}
          </MenuItem>
          <MenuItem onClick={run((e) => paste(e, true))}>
            Paste without formatting{kbd("Ctrl+Shift+V")}
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={run((e) => e.chain().focus().selectAll().run())}>
            Select all{kbd("Ctrl+A")}
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().deleteSelection().run())}
          >
            Delete
          </MenuItem>
          <MenuItem onClick={actions.findReplace}>
            Find and replace{kbd("Ctrl+H")}
          </MenuItem>
        </>,
      )}

      {top(
        "View",
        <>
          <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
            Mode
          </Typography>
          <MenuItem onClick={run((e) => e.setEditable(true))}>Editing</MenuItem>
          <MenuItem disabled>Suggesting</MenuItem>
          <MenuItem onClick={run((e) => e.setEditable(false))}>
            Viewing
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={actions.toggleOutline}>Show outline</MenuItem>
          <MenuItem onClick={actions.comments}>Comments</MenuItem>
          <MenuItem onClick={actions.togglePageNumbers}>
            Show page numbers
          </MenuItem>
          <MenuItem disabled>Show ruler</MenuItem>
          <MenuItem disabled>Show non-printing characters</MenuItem>
          <ListDivider />
          <MenuItem
            onClick={() => document.documentElement.requestFullscreen?.()}
          >
            Full screen
          </MenuItem>
          <MenuItem onClick={() => document.exitFullscreen?.()}>
            Exit full screen
          </MenuItem>
        </>,
      )}

      {top(
        "Insert",
        <>
          <MenuItem
            onClick={run((e) => {
              const u = window.prompt("Image URL");
              if (u) e.chain().focus().setImage({ src: u }).run();
            })}
          >
            Image…
          </MenuItem>
          <MenuItem
            onClick={run((e) =>
              e
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run(),
            )}
          >
            Table (3×3)
          </MenuItem>
          <MenuItem disabled>Building blocks</MenuItem>
          <MenuItem disabled>Smart chips</MenuItem>
          <MenuItem
            onClick={run((e) => {
              const u = window.prompt("Link URL");
              if (u) e.chain().focus().setLink({ href: u }).run();
            })}
          >
            Link…{kbd("Ctrl+K")}
          </MenuItem>
          <MenuItem disabled>Drawing</MenuItem>
          <MenuItem disabled>Chart</MenuItem>
          <ListDivider />
          <MenuItem onClick={actions.emoji}>Emoji…</MenuItem>
          <MenuItem onClick={actions.specialChars}>
            Special characters…
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().setHorizontalRule().run())}
          >
            Horizontal line
          </MenuItem>
          <MenuItem disabled>Page break</MenuItem>
          <MenuItem disabled>Footnote</MenuItem>
          <MenuItem disabled>Headers & footers</MenuItem>
          <ListDivider />
          <MenuItem onClick={actions.commentOnSelection}>
            Comment{kbd("Ctrl+Alt+M")}
          </MenuItem>
        </>,
      )}

      {top(
        "Format",
        <>
          <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
            Text
          </Typography>
          <MenuItem onClick={run((e) => e.chain().focus().toggleBold().run())}>
            Bold{kbd("Ctrl+B")}
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().toggleItalic().run())}
          >
            Italic{kbd("Ctrl+I")}
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().toggleUnderline().run())}
          >
            Underline{kbd("Ctrl+U")}
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().toggleStrike().run())}
          >
            Strikethrough
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().toggleSuperscript().run())}
          >
            Superscript
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().toggleSubscript().run())}
          >
            Subscript
          </MenuItem>
          <MenuItem onClick={run((e) => bumpFont(e, 1))}>
            Increase font size{kbd("Ctrl+Shift+.")}
          </MenuItem>
          <MenuItem onClick={run((e) => bumpFont(e, -1))}>
            Decrease font size{kbd("Ctrl+Shift+,")}
          </MenuItem>
          <MenuItem
            onClick={run((e) => transformSelection(e, (s) => s.toUpperCase()))}
          >
            UPPERCASE
          </MenuItem>
          <MenuItem
            onClick={run((e) => transformSelection(e, (s) => s.toLowerCase()))}
          >
            lowercase
          </MenuItem>
          <MenuItem onClick={run((e) => transformSelection(e, toTitleCase))}>
            Title Case
          </MenuItem>
          <ListDivider />
          <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
            Paragraph styles
          </Typography>
          <MenuItem
            onClick={run((e) => e.chain().focus().setParagraph().run())}
          >
            Normal text{kbd("Ctrl+Alt+0")}
          </MenuItem>
          {[1, 2, 3, 4, 5, 6].map((l) => (
            <MenuItem
              key={l}
              onClick={run((e) =>
                e
                  .chain()
                  .focus()
                  .toggleHeading({ level: l as 1 })
                  .run(),
              )}
            >
              Heading {l}
              {kbd(`Ctrl+Alt+${l}`)}
            </MenuItem>
          ))}
          <ListDivider />
          <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
            Align & indent
          </Typography>
          <MenuItem
            onClick={run((e) => e.chain().focus().setTextAlign("left").run())}
          >
            Left{kbd("Ctrl+Shift+L")}
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().setTextAlign("center").run())}
          >
            Center{kbd("Ctrl+Shift+E")}
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().setTextAlign("right").run())}
          >
            Right{kbd("Ctrl+Shift+R")}
          </MenuItem>
          <MenuItem
            onClick={run((e) =>
              e.chain().focus().setTextAlign("justify").run(),
            )}
          >
            Justified{kbd("Ctrl+Shift+J")}
          </MenuItem>
          <MenuItem
            onClick={run((e) =>
              e.chain().focus().sinkListItem("listItem").run(),
            )}
          >
            Increase indent{kbd("Ctrl+]")}
          </MenuItem>
          <MenuItem
            onClick={run((e) =>
              e.chain().focus().liftListItem("listItem").run(),
            )}
          >
            Decrease indent{kbd("Ctrl+[")}
          </MenuItem>
          <ListDivider />
          <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
            Line & paragraph spacing
          </Typography>
          <MenuItem
            onClick={run((e) => e.chain().focus().setLineHeight("1").run())}
          >
            Single
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().setLineHeight("1.15").run())}
          >
            1.15
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().setLineHeight("1.5").run())}
          >
            1.5
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().setLineHeight("2").run())}
          >
            Double
          </MenuItem>
          <ListDivider />
          <MenuItem
            onClick={run((e) => e.chain().focus().toggleBulletList().run())}
          >
            Bulleted list
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().toggleOrderedList().run())}
          >
            Numbered list
          </MenuItem>
          <MenuItem
            onClick={run((e) => e.chain().focus().toggleTaskList().run())}
          >
            Checklist
          </MenuItem>
          <MenuItem onClick={actions.pageSetup}>Page orientation…</MenuItem>
          <ListDivider />
          <MenuItem
            onClick={run((e) =>
              e.chain().focus().clearNodes().unsetAllMarks().run(),
            )}
          >
            Clear formatting{kbd("Ctrl+\\")}
          </MenuItem>
        </>,
      )}

      {top(
        "Tools",
        <>
          <MenuItem disabled>Spelling and grammar</MenuItem>
          <MenuItem onClick={actions.wordCount}>
            Word count{kbd("Ctrl+Shift+C")}
          </MenuItem>
          <MenuItem disabled>Citations</MenuItem>
          <MenuItem disabled>Line numbers</MenuItem>
          <ListDivider />
          <MenuItem disabled>Translate document</MenuItem>
          <MenuItem disabled>Voice typing (soon){kbd("Ctrl+Shift+S")}</MenuItem>
          <ListDivider />
          <MenuItem disabled>Preferences</MenuItem>
          <MenuItem disabled>Accessibility</MenuItem>
        </>,
      )}

      {top(
        "Help",
        <>
          <MenuItem onClick={actions.searchMenus}>
            Search the menus{kbd("Alt+/")}
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={actions.shortcuts}>
            Keyboard shortcuts{kbd("Ctrl+/")}
          </MenuItem>
          <MenuItem
            onClick={() =>
              window.alert(
                "grown-workspace Docs — a self-hosted collaborative editor.",
              )
            }
          >
            About Docs
          </MenuItem>
        </>,
      )}
    </Box>
  );
}
