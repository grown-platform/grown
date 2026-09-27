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
import { CASE_MODES, changeCase } from "./textCase";
import { hasSpaceAfter, hasSpaceBefore } from "./paragraphFormat";
import { indent, outdent, stepFontSize } from "./shortcuts";
import { downloadDoc, DOWNLOAD_FORMATS } from "./export";
import { applyStyle, continueNumbering, currentStyle, restartNumbering } from "./docModel";
import { openParagraphDialog } from "./ParagraphDialogs";
import { promptLink } from "./links";
import { TableSizePicker, insertPickedTable, openConvertTextDialog, openTableSettings } from "./TableUI";
import { openReferenceDialog } from "./ReferenceDialogs";
import { insertTableOfContents, toggleFieldCodes, updateFields } from "./references";
import { setTocLevel, tocLevelAtSelection } from "./toc";
import { getDocModel } from "./docModel";
import { autofitTable, distributeColumns, distributeRows, setCellProps, splitTable, tableToText, toggleRepeatHeader } from "./tables";
import { LayoutMenu } from "./LayoutMenu";
import { openLayoutDialog } from "./LayoutDialogs";
import { setDocSettings } from "./pageLayout";

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
        <MenuItem onClick={actions.pageSetup}>Page setup…</MenuItem>
        <MenuItem onClick={actions.printPreview ?? (() => window.print())} data-testid="file-print">
          Print…{kbd("Ctrl+P")}
        </MenuItem>
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
  find?: () => void;
  autoCorrect?: () => void;
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
  insertFootnote: () => void;
  insertEndnote: () => void;
  toggleHeaderFooter: () => void;
  toggleSuggesting: () => void;
  reviewPanel?: () => void;
  trackForEveryone?: (on: boolean) => void;
  setDisplayMode?: (m: "markup" | "simple" | "final" | "original") => void;
  nextChange?: () => void;
  previousChange?: () => void;
  acceptCurrentChange?: () => void;
  rejectCurrentChange?: () => void;
  acceptAllChanges?: () => void;
  rejectAllChanges?: () => void;
  insertDrawing: () => void;
  insertEquation?: () => void;
  customSpacing: () => void;
  printPreview?: () => void;
  togglePageThumbnails?: () => void;
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
  const applyStyleRun = (id: string) =>
    run((e) => {
      e.commands.focus();
      applyStyle(e, id);
    });

  // Insert is controlled so the table size picker (not a MenuItem) can
  // close it after a pick.
  const [insertOpen, setInsertOpen] = useState(false);
  // References is controlled so the Add text level row can close it.
  const [refOpen, setRefOpen] = useState(false);
  // Dropdowns open left-aligned (bottom-start) under their menu title.
  const top = (
    label: string,
    children: React.ReactNode,
    ctl?: { open: boolean; setOpen: (o: boolean) => void },
  ) => (
    <Dropdown {...(ctl ? { open: ctl.open, onOpenChange: (_: unknown, o: boolean) => ctl.setOpen(o) } : {})}>
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
          {actions.find && (
            <MenuItem onClick={actions.find}>Find{kbd("Ctrl+F")}</MenuItem>
          )}
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
          <MenuItem onClick={actions.toggleSuggesting}>Suggesting</MenuItem>
          <MenuItem onClick={run((e) => e.setEditable(false))}>
            Viewing
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={actions.toggleOutline}>Show outline</MenuItem>
          <MenuItem onClick={actions.comments}>Comments</MenuItem>
          <MenuItem onClick={actions.togglePageNumbers}>
            Show page numbers
          </MenuItem>
          <MenuItem onClick={run((e) => setDocSettings(e, { pageless: false }))} data-testid="view-print-layout">
            Print layout
          </MenuItem>
          <MenuItem onClick={run((e) => setDocSettings(e, { pageless: true }))} data-testid="view-pageless">
            Pageless
          </MenuItem>
          {actions.togglePageThumbnails && (
            <MenuItem onClick={actions.togglePageThumbnails} data-testid="view-thumbnails">
              Page thumbnails
            </MenuItem>
          )}
          <MenuItem disabled>Show ruler</MenuItem>
          <MenuItem disabled>Show non-printing characters</MenuItem>
          {actions.setDisplayMode && (
            <>
              <ListDivider />
              <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
                Changes
              </Typography>
              <MenuItem onClick={() => actions.setDisplayMode!("markup")}>Markup</MenuItem>
              <MenuItem onClick={() => actions.setDisplayMode!("simple")}>Simple markup</MenuItem>
              <MenuItem onClick={() => actions.setDisplayMode!("final")}>Final</MenuItem>
              <MenuItem onClick={() => actions.setDisplayMode!("original")}>Original</MenuItem>
            </>
          )}
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
          <Typography level="body-xs" sx={{ px: 1.5, pt: 0.5, opacity: 0.6 }}>
            Table
          </Typography>
          <TableSizePicker
            onPick={(r, c) => {
              setInsertOpen(false);
              if (editor) insertPickedTable(editor, r, c);
            }}
          />
          <MenuItem onClick={() => openConvertTextDialog()}>Convert text to table…</MenuItem>
          <ListDivider />
          <MenuItem disabled>Building blocks</MenuItem>
          <MenuItem disabled>Smart chips</MenuItem>
          <MenuItem
            onClick={run((e) => {
              promptLink(e);
            })}
          >
            Link…{kbd("Ctrl+K")}
          </MenuItem>
          <MenuItem onClick={actions.insertDrawing}>Drawing</MenuItem>
          <MenuItem onClick={actions.insertEquation} data-testid="insert-equation">
            Equation{kbd("Ctrl+Alt+=")}
          </MenuItem>
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
          <MenuItem
            onClick={run(
              (e) =>
                e.chain().focus().insertPageBreak().run() ||
                e.chain().focus().setPageBreak().run(),
            )}
          >
            Page break
          </MenuItem>
          <MenuItem onClick={run((e) => void e.chain().focus().insertColumnBreak().run())}>
            Column break{kbd("Ctrl+Shift+Enter")}
          </MenuItem>
          <MenuItem onClick={run((e) => void e.chain().focus().insertSectionBreak("nextPage").run())}>Section break (next page)</MenuItem>
          <MenuItem onClick={run((e) => void e.chain().focus().insertSectionBreak("continuous").run())}>Section break (continuous)</MenuItem>
          <MenuItem onClick={() => openLayoutDialog("pagenumbers")} data-testid="insert-page-numbers">
            Page numbers…
          </MenuItem>
          <MenuItem onClick={actions.insertFootnote}>Footnote</MenuItem>
          <MenuItem onClick={actions.insertEndnote}>Endnote</MenuItem>
          <MenuItem onClick={run((e) => void e.chain().focus().insertField("PAGE").run())} data-testid="insert-page-number">
            Page number{kbd("Alt+Shift+P")}
          </MenuItem>
          <MenuItem onClick={() => openReferenceDialog("bookmarks")} data-testid="insert-bookmark">
            Bookmark…
          </MenuItem>
          <MenuItem onClick={() => openReferenceDialog("caption")} data-testid="insert-caption">
            Caption…
          </MenuItem>
          <MenuItem onClick={() => openReferenceDialog("crossref")} data-testid="insert-crossref">
            Cross-reference…
          </MenuItem>
          <MenuItem onClick={run((e) => void insertTableOfContents(e))} data-testid="insert-toc">
            Table of contents
          </MenuItem>
          <MenuItem onClick={actions.toggleHeaderFooter}>
            Headers &amp; footers
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={actions.commentOnSelection}>
            Comment{kbd("Ctrl+Alt+M")}
          </MenuItem>
        </>,
        { open: insertOpen, setOpen: setInsertOpen },
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
          <MenuItem
            onClick={run((e) => {
              e.commands.focus();
              stepFontSize(e, 1);
            })}
          >
            Increase font size{kbd("Ctrl+Shift+.")}
          </MenuItem>
          <MenuItem
            onClick={run((e) => {
              e.commands.focus();
              stepFontSize(e, -1);
            })}
          >
            Decrease font size{kbd("Ctrl+Shift+,")}
          </MenuItem>
          <ListDivider />
          <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
            Change case
          </Typography>
          {CASE_MODES.map(({ mode, label }) => (
            <MenuItem
              key={mode}
              onClick={run((e) => {
                e.commands.focus();
                changeCase(e, mode);
              })}
            >
              {label}
            </MenuItem>
          ))}
          <ListDivider />
          <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
            Paragraph styles
          </Typography>
          <MenuItem onClick={applyStyleRun("Normal")}>
            Normal text{kbd("Ctrl+Alt+0")}
          </MenuItem>
          {["Title", "Subtitle"].map((id) => (
            <MenuItem key={id} onClick={applyStyleRun(id)}>
              {id}
            </MenuItem>
          ))}
          {[1, 2, 3, 4, 5, 6].map((l) => (
            <MenuItem
              key={l}
              onClick={run((e) => {
                e.commands.focus();
                applyStyle(e, currentStyle(e)?.id === `Heading${l}` ? "Normal" : `Heading${l}`);
              })}
            >
              Heading {l}
              {kbd(`Ctrl+Alt+${l}`)}
            </MenuItem>
          ))}
          <MenuItem onClick={applyStyleRun("Quote")}>
            Quote
          </MenuItem>
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
            onClick={run((e) => {
              e.commands.focus();
              indent(e);
            })}
          >
            Increase indent{kbd("Ctrl+M")}
          </MenuItem>
          <MenuItem
            onClick={run((e) => {
              e.commands.focus();
              outdent(e);
            })}
          >
            Decrease indent{kbd("Ctrl+Shift+M")}
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
          {editor && hasSpaceBefore(editor.state) ? (
            <MenuItem
              onClick={run((e) => e.chain().focus().removeSpaceBefore().run())}
            >
              Remove space before paragraph
            </MenuItem>
          ) : (
            <MenuItem
              onClick={run((e) => e.chain().focus().addSpaceBefore().run())}
            >
              Add space before paragraph
            </MenuItem>
          )}
          {editor && hasSpaceAfter(editor.state) ? (
            <MenuItem
              onClick={run((e) => e.chain().focus().removeSpaceAfter().run())}
            >
              Remove space after paragraph
            </MenuItem>
          ) : (
            <MenuItem
              onClick={run((e) => e.chain().focus().addSpaceAfter().run())}
            >
              Add space after paragraph
            </MenuItem>
          )}
          <MenuItem onClick={actions.customSpacing}>Custom spacing…</MenuItem>
          <MenuItem onClick={() => openParagraphDialog("paragraph")}>
            Paragraph settings…
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
          <MenuItem onClick={run((e) => restartNumbering(e))}>Restart numbering</MenuItem>
          <MenuItem onClick={run((e) => continueNumbering(e))}>Continue numbering</MenuItem>
          <MenuItem onClick={() => openParagraphDialog("numberingValue")}>
            Set numbering value…
          </MenuItem>
          <MenuItem onClick={() => openParagraphDialog("listSettings")}>
            List settings…
          </MenuItem>
          <MenuItem onClick={actions.pageSetup}>Page setup…</MenuItem>
          <ListDivider />
          <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
            Table
          </Typography>
          <MenuItem onClick={run((e) => e.chain().focus().addRowAfter().run())}>
            Insert row below
          </MenuItem>
          <MenuItem onClick={run((e) => e.chain().focus().addRowBefore().run())}>
            Insert row above
          </MenuItem>
          <MenuItem onClick={run((e) => e.chain().focus().addColumnAfter().run())}>
            Insert column right
          </MenuItem>
          <MenuItem onClick={run((e) => e.chain().focus().addColumnBefore().run())}>
            Insert column left
          </MenuItem>
          <MenuItem onClick={run((e) => e.chain().focus().deleteRow().run())}>
            Delete row
          </MenuItem>
          <MenuItem onClick={run((e) => e.chain().focus().deleteColumn().run())}>
            Delete column
          </MenuItem>
          <MenuItem onClick={run((e) => e.chain().focus().mergeOrSplit().run())}>
            Merge / split cells
          </MenuItem>
          <MenuItem onClick={run((e) => distributeRows(e))}>Distribute rows</MenuItem>
          <MenuItem onClick={run((e) => distributeColumns(e))}>Distribute columns</MenuItem>
          <MenuItem onClick={run((e) => toggleRepeatHeader(e))}>Repeat header row</MenuItem>
          <MenuItem onClick={run((e) => autofitTable(e, "contents"))}>Autofit to contents</MenuItem>
          <MenuItem onClick={run((e) => autofitTable(e, "window"))}>Autofit to window</MenuItem>
          {(["top", "middle", "bottom"] as const).map((v) => (
            <MenuItem key={v} onClick={run((e) => setCellProps(e, { verticalAlign: v === "top" ? null : v }))}>
              Align cell {v}
            </MenuItem>
          ))}
          <MenuItem onClick={run((e) => splitTable(e))}>Split table</MenuItem>
          <MenuItem onClick={run((e) => tableToText(e))}>Convert table to text</MenuItem>
          <MenuItem onClick={() => openTableSettings()}>Table settings…</MenuItem>
          {(
            [
              ["Yellow", "#fff3a0"],
              ["Green", "#d4edbc"],
              ["Blue", "#cfe2f3"],
              ["Pink", "#f4cccc"],
              ["None", null],
            ] as [string, string | null][]
          ).map(([label, color]) => (
            <MenuItem
              key={label}
              onClick={run((e) =>
                e.chain().focus().setCellAttribute("backgroundColor", color).run(),
              )}
            >
              {color != null && (
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    mr: 1,
                    borderRadius: "2px",
                    bgcolor: color,
                    border: "1px solid #dadce0",
                  }}
                />
              )}
              Cell color: {label}
            </MenuItem>
          ))}
          <MenuItem onClick={run((e) => e.chain().focus().deleteTable().run())}>
            Delete table
          </MenuItem>
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

      <LayoutMenu editor={editor} actions={actions} />

      {top(
        "References",
        <>
          <MenuItem onClick={run((e) => void insertTableOfContents(e))} data-testid="ref-insert-toc">
            Insert table of contents
          </MenuItem>
          <MenuItem onClick={() => openReferenceDialog("toc")} data-testid="ref-toc-settings">
            Table of contents settings…
          </MenuItem>
          <MenuItem onClick={() => openReferenceDialog("tof")} data-testid="ref-insert-tof">
            Insert table of figures…
          </MenuItem>
          <MenuItem onClick={run((e) => void updateFields(e, "selection"))} data-testid="ref-update">
            Update table / fields{kbd("F9")}
          </MenuItem>
          <MenuItem onClick={run((e) => void updateFields(e, "all"))} data-testid="ref-update-all">
            Update all fields{kbd("Ctrl+F9")}
          </MenuItem>
          <Typography level="body-xs" sx={{ px: 1.5, pt: 0.5, opacity: 0.6 }}>
            Add text (level in the table of contents)
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, px: 1.5, pb: 0.75, maxWidth: 260 }} data-testid="ref-add-text">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => {
              const cur = editor ? tocLevelAtSelection(editor, getDocModel(editor)?.sheet) : -1;
              return (
                <Box
                  key={l}
                  component="button"
                  type="button"
                  title={l ? `Level ${l}` : "Do not show in table of contents"}
                  data-testid={`ref-add-text-${l}`}
                  onMouseDown={(ev: React.MouseEvent) => ev.preventDefault()}
                  onClick={() => {
                    setRefOpen(false);
                    if (editor) {
                      setTocLevel(editor, l, getDocModel(editor)?.sheet);
                      editor.commands.focus();
                    }
                  }}
                  sx={{
                    minWidth: l ? 24 : 44,
                    height: 24,
                    fontSize: 12,
                    borderRadius: "4px",
                    border: "1px solid",
                    borderColor: cur === l ? "primary.solidBg" : "neutral.outlinedBorder",
                    bgcolor: cur === l ? "primary.softBg" : "background.surface",
                    cursor: "pointer",
                  }}
                >
                  {l ? l : "None"}
                </Box>
              );
            })}
          </Box>
          <ListDivider />
          <MenuItem onClick={() => openReferenceDialog("caption")} data-testid="ref-caption">
            Insert caption…
          </MenuItem>
          <MenuItem onClick={() => openReferenceDialog("crossref")} data-testid="ref-crossref">
            Cross-reference…
          </MenuItem>
          <MenuItem onClick={() => openReferenceDialog("bookmarks")} data-testid="ref-bookmarks">
            Bookmarks…
          </MenuItem>
          <MenuItem onClick={() => openReferenceDialog("hyperlink")} data-testid="ref-hyperlink">
            Link settings…
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={run((e) => void e.chain().focus().insertField("PAGE").run())}>
            Page number{kbd("Alt+Shift+P")}
          </MenuItem>
          <MenuItem onClick={run((e) => void e.chain().focus().insertField("NUMPAGES").run())}>Page count</MenuItem>
          <MenuItem onClick={() => openReferenceDialog("field")} data-testid="ref-field">
            Date, time and other fields…
          </MenuItem>
          <MenuItem onClick={run((e) => void toggleFieldCodes(e))}>Show field codes{kbd("Alt+F9")}</MenuItem>
        </>,
        { open: refOpen, setOpen: setRefOpen },
      )}

      {top(
        "Tools",
        <>
          <MenuItem disabled>Spelling and grammar</MenuItem>
          <MenuItem onClick={actions.wordCount}>
            Word count{kbd("Ctrl+Shift+C")}
          </MenuItem>
          <MenuItem disabled>Citations</MenuItem>
          <MenuItem onClick={() => openLayoutDialog("linenumbers")}>Line numbers…</MenuItem>
          <ListDivider />
          <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
            Review
          </Typography>
          <MenuItem onClick={actions.toggleSuggesting}>Track changes (for me)</MenuItem>
          {actions.trackForEveryone && (
            <MenuItem onClick={() => actions.trackForEveryone!(true)}>Track changes for everyone</MenuItem>
          )}
          {actions.trackForEveryone && (
            <MenuItem onClick={() => actions.trackForEveryone!(false)}>Stop tracking for everyone</MenuItem>
          )}
          {actions.reviewPanel && <MenuItem onClick={actions.reviewPanel}>Review changes…</MenuItem>}
          {actions.previousChange && <MenuItem onClick={actions.previousChange}>Previous change</MenuItem>}
          {actions.nextChange && <MenuItem onClick={actions.nextChange}>Next change</MenuItem>}
          {actions.acceptCurrentChange && <MenuItem onClick={actions.acceptCurrentChange}>Accept current change</MenuItem>}
          {actions.rejectCurrentChange && <MenuItem onClick={actions.rejectCurrentChange}>Reject current change</MenuItem>}
          {actions.acceptAllChanges && <MenuItem onClick={actions.acceptAllChanges}>Accept all changes</MenuItem>}
          {actions.rejectAllChanges && <MenuItem onClick={actions.rejectAllChanges}>Reject all changes</MenuItem>}
          <ListDivider />
          <MenuItem disabled>Translate document</MenuItem>
          <MenuItem disabled>Voice typing (soon){kbd("Ctrl+Shift+S")}</MenuItem>
          <ListDivider />
          <MenuItem disabled>Preferences</MenuItem>
          {actions.autoCorrect && (
            <MenuItem onClick={actions.autoCorrect}>AutoCorrect options…</MenuItem>
          )}
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
