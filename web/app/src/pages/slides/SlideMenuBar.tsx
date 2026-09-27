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
import { DECK_DOWNLOAD_FORMATS, type DeckFormat } from "./export";
import type { ElementType, TextAlign } from "./model";
import type { TextCommands } from "./TextFormatControls";
import type { TableCommands } from "./TableControls";
import type { ImageCommands } from "./ImageControls";
import { CASE_MODES } from "../../lib/textCase";

export interface SlideActions {
  newDeck: () => void;
  open: () => void;
  importSlides: () => void;
  makeCopy: () => void;
  rename: () => void;
  trash: () => void;
  share: () => void;
  download: (fmt: DeckFormat) => void | Promise<void>;
  print: () => void;
  /** File ▸ Version history (opens the version history panel). */
  versionHistory?: () => void;
  undo: () => void;
  redo: () => void;
  insert: (type: ElementType) => void;
  /** Open the shape gallery (toolbar). */
  openShapes: () => void;
  /** Arm the draw tool for a gallery id ("star5", "bentConnector3:arrow"). */
  drawShape: (id: string) => void;
  insertImageFile: () => void;
  newSlide: () => void;
  duplicateSlide: () => void;
  deleteSlide: () => void;
  present: () => void;
  toggle: (attr: "bold" | "italic" | "underline" | "strike") => void;
  setList: (v: "bullet" | "number" | null) => void;
  setLineSpacing: (v: number) => void;
  setAlign: (a: TextAlign) => void;
  /** Text formatting (M4). */
  text: TextCommands;
  arrange: (dir: "front" | "back" | "forward" | "backward") => void;
  rotate: (op: "cw" | "ccw" | "flipH" | "flipV") => void;
  setLink: () => void;
  deleteSelected: () => void;
  selectAll: () => void;
  align: (how: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
  distribute: (axis: "horizontal" | "vertical") => void;
  centerOnPage: (axis: "horizontal" | "vertical") => void;
  group: () => void;
  ungroup: () => void;
  toggleLock: () => void;
  /** Align/distribute reference: the slide or the selection. */
  alignTo: "slide" | "selection";
  setAlignTo: (v: "slide" | "selection") => void;
  snapGuides: boolean;
  toggleSnapGuides: () => void;
  snapGrid: boolean;
  toggleSnapGrid: () => void;
  selection: {
    count: number;
    canGroup: boolean;
    canUngroup: boolean;
    locked: boolean;
  };
  setBackground: () => void;
  /** Themes and layouts (M7). */
  changeTheme: () => void;
  editTheme: () => void;
  layouts: { id: string; name: string }[];
  currentLayout?: string;
  applyLayout: (id: string) => void;
  newSlideWithLayout: (id: string) => void;
  resetSlide: () => void;
  slideHidden: boolean;
  toggleSkip: () => void;
  pageSetup: () => void;
  headerFooter: () => void;
  paste: () => void;
  duplicateSelected: () => void;
  openTransition: () => void;
  openAnimations: () => void;
  toggleNotes: () => void;
  /** Insert ▸ Table: open the size picker. */
  insertTable: () => void;
  /** Table commands (null when no table is selected). */
  table: TableCommands | null;
  /** Picture commands (null when no picture is selected). */
  image: ImageCommands | null;
  /** Alt text for the selection. */
  altText: () => void;
}

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
const kbd = (s: string) => (
  <Typography level="body-xs" sx={{ ml: "auto", pl: 3, opacity: 0.5 }}>
    {s}
  </Typography>
);
const section = (s: string) => (
  <Typography
    level="body-xs"
    sx={{ px: 1.5, pt: 0.75, pb: 0.25, opacity: 0.55, fontWeight: 600 }}
  >
    {s}
  </Typography>
);
const arrow = <ArrowRightIcon sx={{ ml: "auto", opacity: 0.4 }} />;
const sub = { pl: 3 };
/** A check mark column for toggle items (blank when off, to keep alignment). */
const check = (on: boolean) => (
  <Box component="span" sx={{ width: 18, display: "inline-block", opacity: on ? 1 : 0 }}>
    ✓
  </Box>
);

// Menu structures mirror docs/google-reference/slides/editor.md (captured 2026-06-09):
// File · Edit · View · Insert · Format · Slide · Arrange · Tools · Extensions · Help.
// Engine-supported items are wired; the rest are present-but-disabled stubs so the
// structure matches Google Slides. Submenus are flattened inline like the Sheets menu.
export function SlideMenuBar({ actions }: { actions: SlideActions }) {
  const top = (label: string, children: React.ReactNode) => (
    <Dropdown>
      <MenuButton variant="plain" size="sm" sx={menuButtonSx}>
        {label}
      </MenuButton>
      <Menu
        size="sm"
        placement="bottom-start"
        sx={{ minWidth: 250, maxHeight: "80vh", overflowY: "auto" }}
      >
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
      <FileMenu actions={actions} />

      {/* EDIT — ref: 10 items */}
      {top(
        "Edit",
        <>
          <MenuItem onClick={actions.undo}>Undo{kbd("Ctrl+Z")}</MenuItem>
          <MenuItem onClick={actions.redo}>Redo{kbd("Ctrl+Y")}</MenuItem>
          <ListDivider />
          <MenuItem onClick={() => document.execCommand("cut")}>
            Cut{kbd("Ctrl+X")}
          </MenuItem>
          <MenuItem onClick={() => document.execCommand("copy")}>
            Copy{kbd("Ctrl+C")}
          </MenuItem>
          <MenuItem onClick={actions.paste}>Paste{kbd("Ctrl+V")}</MenuItem>
          <MenuItem onClick={actions.paste}>
            Paste without formatting{kbd("Ctrl+Shift+V")}
          </MenuItem>
          <MenuItem onClick={actions.selectAll}>Select all{kbd("Ctrl+A")}</MenuItem>
          <ListDivider />
          <MenuItem onClick={actions.deleteSelected}>Delete</MenuItem>
          <MenuItem onClick={actions.duplicateSelected}>
            Duplicate{kbd("Ctrl+D")}
          </MenuItem>
          <MenuItem onClick={actions.text.findReplace}>Find and replace{kbd("Ctrl+H")}</MenuItem>
        </>,
      )}

      {/* VIEW — ref: 11 items */}
      {top(
        "View",
        <>
          <MenuItem disabled>Mode{arrow}</MenuItem>
          <MenuItem onClick={actions.present}>
            Slideshow{kbd("Ctrl+F5")}
          </MenuItem>
          <MenuItem disabled>Slides recordings</MenuItem>
          <MenuItem disabled>Motion</MenuItem>
          <MenuItem onClick={actions.editTheme}>Theme builder</MenuItem>
          <MenuItem disabled>Comments{arrow}</MenuItem>
          <MenuItem disabled>Guides{arrow}</MenuItem>
          {section("Snap to")}
          <MenuItem sx={sub} onClick={actions.toggleSnapGuides}>
            {check(actions.snapGuides)}Guides
          </MenuItem>
          <MenuItem sx={sub} onClick={actions.toggleSnapGrid}>
            {check(actions.snapGrid)}Grid
          </MenuItem>
          <MenuItem disabled>Live pointers{arrow}</MenuItem>
          <MenuItem disabled>Zoom{arrow}</MenuItem>
          <ListDivider />
          <MenuItem onClick={actions.toggleNotes}>Show speaker notes</MenuItem>
          <MenuItem
            onClick={() => document.documentElement.requestFullscreen?.()}
          >
            Full screen
          </MenuItem>
        </>,
      )}

      {/* INSERT — ref: 22 items */}
      {top(
        "Insert",
        <>
          <MenuItem onClick={actions.insertImageFile}>Image</MenuItem>
          <MenuItem onClick={() => actions.insert("text")}>Text box</MenuItem>
          {section("Shape")}
          <MenuItem sx={sub} onClick={actions.openShapes}>
            All shapes…
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.insert("rect")}>
            Rectangle
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.insert("roundRect")}>
            Rounded rectangle
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.insert("ellipse")}>
            Ellipse
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.insert("triangle")}>
            Triangle
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.insert("diamond")}>
            Diamond
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.insert("rightArrow")}>
            Right arrow
          </MenuItem>
          <MenuItem onClick={() => actions.insert("line")}>
            Line{kbd("Q")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.drawShape("straightConnector1:arrow")}>
            Arrow
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.drawShape("bentConnector3:arrow")}>
            Elbow connector
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.drawShape("curvedConnector3:arrow")}>
            Curved connector
          </MenuItem>
          <ListDivider />
          <MenuItem disabled>Diagram{arrow}</MenuItem>
          <MenuItem onClick={actions.insertTable}>Table…</MenuItem>
          <MenuItem disabled>Chart{arrow}</MenuItem>
          <MenuItem disabled>Word art</MenuItem>
          <MenuItem disabled>Video</MenuItem>
          <MenuItem disabled>Audio</MenuItem>
          <MenuItem onClick={actions.text.specialChars}>Special characters…</MenuItem>
          <MenuItem onClick={actions.openAnimations}>Animation</MenuItem>
          <MenuItem onClick={actions.setLink}>Link…{kbd("Ctrl+K")}</MenuItem>
          <MenuItem disabled>Comment{kbd("Ctrl+Alt+M")}</MenuItem>
          <ListDivider />
          <MenuItem onClick={actions.newSlide}>
            New slide{kbd("Ctrl+M")}
          </MenuItem>
          <MenuItem onClick={actions.headerFooter}>Slide numbers…</MenuItem>
          <MenuItem onClick={actions.headerFooter}>Header &amp; footer…</MenuItem>
        </>,
      )}

      {/* FORMAT — ref: 9 items */}
      {top(
        "Format",
        <>
          {section("Text")}
          <MenuItem sx={sub} onClick={() => actions.toggle("bold")}>
            Bold{kbd("Ctrl+B")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.toggle("italic")}>
            Italic{kbd("Ctrl+I")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.toggle("underline")}>
            Underline{kbd("Ctrl+U")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.toggle("strike")}>
            Strikethrough{kbd("Alt+Shift+5")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.text.toggle("super")}>
            Superscript{kbd("Ctrl+.")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.text.toggle("sub")}>
            Subscript{kbd("Ctrl+,")}
          </MenuItem>
          {section("Size")}
          <MenuItem sx={sub} onClick={() => actions.text.fontStep(1)}>
            Increase font size{kbd("Ctrl+]")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.text.fontStep(-1)}>
            Decrease font size{kbd("Ctrl+[")}
          </MenuItem>
          {section("Capitalization")}
          {CASE_MODES.map((m) => (
            <MenuItem key={m.mode} sx={sub} onClick={() => actions.text.changeCase(m.mode)}>
              {m.label}
            </MenuItem>
          ))}
          {section("Align")}
          <MenuItem sx={sub} onClick={() => actions.setAlign("left")}>
            Left{kbd("Ctrl+L")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.setAlign("center")}>
            Center{kbd("Ctrl+E")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.setAlign("right")}>
            Right{kbd("Ctrl+R")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.setAlign("justify")}>
            Justified{kbd("Ctrl+J")}
          </MenuItem>
          {section("Indentation")}
          <MenuItem sx={sub} onClick={() => actions.text.indent(1)}>
            Increase indent{kbd("Tab")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.text.indent(-1)}>
            Decrease indent{kbd("Shift+Tab")}
          </MenuItem>
          <ListDivider />
          {section("Bullets & numbering")}
          <MenuItem sx={sub} onClick={() => actions.setList("bullet")}>
            Bulleted list{kbd("Ctrl+Shift+L")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.text.list("bullet", "➢")}>
            Arrow bullets ➢
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.text.list("bullet", "✓")}>
            Check bullets ✓
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.setList("number")}>
            Numbered list{kbd("Ctrl+Shift+7")}
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.text.list("number", "alphaUcPeriod")}>
            Lettered list A. B. C.
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.text.list("number", "romanUcPeriod")}>
            Roman list I. II. III.
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.setList(null)}>
            No list
          </MenuItem>
          {section("Line spacing")}
          <MenuItem sx={sub} onClick={() => actions.setLineSpacing(1)}>
            Single
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.setLineSpacing(1.5)}>
            1.5
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.setLineSpacing(2)}>
            Double
          </MenuItem>
          {section("Text fitting")}
          <MenuItem sx={sub} onClick={() => actions.text.setAutofit(false)}>
            Do not autofit
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.text.setAutofit(true)}>
            Shrink text on overflow
          </MenuItem>
          {section("Text direction")}
          <MenuItem sx={sub} onClick={() => actions.text.setDirection("ltr")}>
            Left to right
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.text.setDirection("rtl")}>
            Right to left
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.text.setDirection("vert")}>
            Rotate text 90°
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.text.setDirection("vert270")}>
            Rotate text 270°
          </MenuItem>
          <ListDivider />
          {section("Table")}
          <MenuItem sx={sub} disabled={!actions.table} onClick={() => actions.table?.insertRow("above")}>
            Insert row above
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.table} onClick={() => actions.table?.insertRow("below")}>
            Insert row below
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.table} onClick={() => actions.table?.insertCol("left")}>
            Insert column left
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.table} onClick={() => actions.table?.insertCol("right")}>
            Insert column right
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.table} onClick={() => actions.table?.deleteRow()}>
            Delete row
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.table} onClick={() => actions.table?.deleteCol()}>
            Delete column
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.table?.canMerge} onClick={() => actions.table?.merge()}>
            Merge cells
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.table} onClick={() => actions.table?.split()}>
            Split cell…
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.table} onClick={() => actions.table?.distributeRows()}>
            Distribute rows
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.table} onClick={() => actions.table?.distributeCols()}>
            Distribute columns
          </MenuItem>
          {section("Image")}
          <MenuItem sx={sub} disabled={!actions.image} onClick={() => actions.image?.toggleCrop()}>
            Crop image
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.image} onClick={() => actions.image?.resetCrop()}>
            Reset crop
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.image} onClick={() => actions.image?.actualSize()}>
            Actual size
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.image} onClick={() => actions.image?.fitToSlide()}>
            Fit to slide
          </MenuItem>
          <MenuItem sx={sub} disabled={!actions.image} onClick={() => actions.image?.replace()}>
            Replace image…
          </MenuItem>
          <MenuItem sx={sub} disabled={actions.selection.count === 0} onClick={actions.altText}>
            Alt text…
          </MenuItem>
          <MenuItem disabled>Borders &amp; lines{arrow}</MenuItem>
          <MenuItem onClick={actions.text.textOptions}>Text options…</MenuItem>
          <MenuItem onClick={actions.text.paintFormat}>Paint format{kbd("Ctrl+Shift+C")}</MenuItem>
          <MenuItem onClick={actions.text.clearFormat}>Clear formatting{kbd("Ctrl+Space")}</MenuItem>
        </>,
      )}

      {/* SLIDE — Slides-specific; ref: 13 items */}
      {top(
        "Slide",
        <>
          <MenuItem onClick={actions.newSlide}>
            New slide{kbd("Ctrl+M")}
          </MenuItem>
          {section("New slide with layout")}
          {actions.layouts.map((l) => (
            <MenuItem key={l.id} sx={sub} onClick={() => actions.newSlideWithLayout(l.id)}>
              {l.name}
            </MenuItem>
          ))}
          <ListDivider />
          <MenuItem disabled>Create a slide{arrow}</MenuItem>
          <MenuItem disabled>Templates</MenuItem>
          <MenuItem onClick={actions.duplicateSlide}>Duplicate slide</MenuItem>
          <MenuItem onClick={actions.deleteSlide}>Delete slide</MenuItem>
          <MenuItem onClick={actions.toggleSkip}>
            {check(actions.slideHidden)}Skip slide
          </MenuItem>
          <MenuItem disabled>Move slide{arrow}</MenuItem>
          <ListDivider />
          <MenuItem onClick={actions.setBackground}>
            Change background…
          </MenuItem>
          {section("Apply layout")}
          {actions.layouts.map((l) => (
            <MenuItem key={l.id} sx={sub} onClick={() => actions.applyLayout(l.id)}>
              {check(l.id === actions.currentLayout)}
              {l.name}
            </MenuItem>
          ))}
          <MenuItem onClick={actions.resetSlide} disabled={!actions.currentLayout}>
            Reset slide
          </MenuItem>
          <MenuItem onClick={actions.openTransition}>Transition…</MenuItem>
          <MenuItem onClick={actions.editTheme}>Edit theme</MenuItem>
          <MenuItem onClick={actions.changeTheme}>Change theme</MenuItem>
        </>,
      )}

      {/* ARRANGE — Slides-specific; ref: 8 items */}
      {top(
        "Arrange",
        <>
          {section("Order")}
          <MenuItem sx={sub} onClick={() => actions.arrange("front")}>
            Bring to front
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.arrange("forward")}>
            Bring forward
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.arrange("backward")}>
            Send backward
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.arrange("back")}>
            Send to back
          </MenuItem>
          <ListDivider />
          {section("Align")}
          {(
            [
              ["left", "Left"],
              ["center", "Center"],
              ["right", "Right"],
              ["top", "Top"],
              ["middle", "Middle"],
              ["bottom", "Bottom"],
            ] as const
          ).map(([how, label]) => (
            <MenuItem
              key={how}
              sx={sub}
              disabled={!actions.selection.count}
              onClick={() => actions.align(how)}
            >
              {label}
            </MenuItem>
          ))}
          <MenuItem
            sx={sub}
            onClick={() =>
              actions.setAlignTo(
                actions.alignTo === "slide" ? "selection" : "slide",
              )
            }
          >
            {check(actions.alignTo === "slide")}Align to slide
          </MenuItem>
          {section("Distribute")}
          <MenuItem
            sx={sub}
            disabled={
              actions.selection.count < (actions.alignTo === "slide" ? 1 : 3)
            }
            onClick={() => actions.distribute("horizontal")}
          >
            Horizontally
          </MenuItem>
          <MenuItem
            sx={sub}
            disabled={
              actions.selection.count < (actions.alignTo === "slide" ? 1 : 3)
            }
            onClick={() => actions.distribute("vertical")}
          >
            Vertically
          </MenuItem>
          {section("Center on page")}
          <MenuItem
            sx={sub}
            disabled={!actions.selection.count}
            onClick={() => actions.centerOnPage("horizontal")}
          >
            Horizontally
          </MenuItem>
          <MenuItem
            sx={sub}
            disabled={!actions.selection.count}
            onClick={() => actions.centerOnPage("vertical")}
          >
            Vertically
          </MenuItem>
          {section("Rotate")}
          <MenuItem sx={sub} onClick={() => actions.rotate("cw")}>
            Rotate clockwise 90°
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.rotate("ccw")}>
            Rotate counter-clockwise 90°
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.rotate("flipH")}>
            Flip horizontally
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.rotate("flipV")}>
            Flip vertically
          </MenuItem>
          <ListDivider />
          <MenuItem
            disabled={!actions.selection.canGroup}
            onClick={actions.group}
          >
            Group{kbd("Ctrl+Alt+G")}
          </MenuItem>
          <MenuItem
            disabled={!actions.selection.canUngroup}
            onClick={actions.ungroup}
          >
            Ungroup{kbd("Ctrl+Alt+Shift+G")}
          </MenuItem>
          <MenuItem
            disabled={!actions.selection.count}
            onClick={actions.toggleLock}
          >
            {actions.selection.locked ? "Unlock position" : "Lock position"}
          </MenuItem>
        </>,
      )}

      {/* TOOLS — ref: 8 items */}
      {top(
        "Tools",
        <>
          <MenuItem disabled>Spelling{arrow}</MenuItem>
          <MenuItem disabled>Linked objects</MenuItem>
          <MenuItem disabled>Dictionary{kbd("Ctrl+Shift+Y")}</MenuItem>
          <MenuItem disabled>Q&amp;A history</MenuItem>
          <MenuItem disabled>Notification settings</MenuItem>
          <MenuItem disabled>Preferences</MenuItem>
          <MenuItem disabled>Accessibility</MenuItem>
          <MenuItem disabled>Activity dashboard</MenuItem>
        </>,
      )}

      {/* EXTENSIONS — ref: 2 items */}
      {top(
        "Extensions",
        <>
          <MenuItem disabled>Add-ons{arrow}</MenuItem>
          <MenuItem disabled>Apps Script</MenuItem>
        </>,
      )}

      {/* HELP — ref: 6 items */}
      {top(
        "Help",
        <>
          <MenuItem disabled>Search the menus{kbd("Alt+/")}</MenuItem>
          <MenuItem disabled>Slides Help</MenuItem>
          <MenuItem disabled>Training</MenuItem>
          <MenuItem disabled>Updates</MenuItem>
          <MenuItem disabled>Help Slides improve</MenuItem>
          <MenuItem
            onClick={() =>
              window.alert(
                "Keyboard shortcuts\n\nBold Ctrl+B · Italic Ctrl+I · Underline Ctrl+U · Strikethrough Ctrl+5\nSuperscript Ctrl+. · Subscript Ctrl+, · Font size Ctrl+] / Ctrl+[\nAlign Ctrl+L/E/R/J · Bullets Ctrl+Shift+L · Indent Tab / Shift+Tab\nCopy/paste format Ctrl+Shift+C / Ctrl+Shift+V · Clear formatting Ctrl+Space\nLink Ctrl+K · Find and replace Ctrl+H · Line break Shift+Enter\nNo-break space Ctrl+Shift+Space · € Ctrl+Alt+E · En dash Ctrl+Alt+-\nNew slide Ctrl+M · Slideshow Ctrl+F5\nUndo Ctrl+Z · Redo Ctrl+Y · Duplicate Ctrl+D",
              )
            }
          >
            Keyboard shortcuts{kbd("Ctrl+/")}
          </MenuItem>
        </>,
      )}
    </Box>
  );
}

// FileMenu — ref: 19 items. New + Download expand inline (Joy nested flyouts unreliable).
function FileMenu({ actions }: { actions: SlideActions }) {
  const [open, setOpen] = useState(false);
  const [dl, setDl] = useState(false);
  const [nw, setNw] = useState(false);
  const close = () => {
    setOpen(false);
    setDl(false);
    setNw(false);
  };
  return (
    <Dropdown
      open={open}
      onOpenChange={(_, o) => {
        setOpen(o);
        if (!o) {
          setDl(false);
          setNw(false);
        }
      }}
    >
      <MenuButton variant="plain" size="sm" sx={menuButtonSx}>
        File
      </MenuButton>
      <Menu
        size="sm"
        placement="bottom-start"
        sx={{ minWidth: 260, maxHeight: "80vh", overflowY: "auto" }}
      >
        <ListItemButton
          onClick={() => setNw((v) => !v)}
          sx={{ borderRadius: "sm", fontSize: "0.875rem" }}
        >
          New
          <ArrowRightIcon
            sx={{
              ml: "auto",
              transform: nw ? "rotate(90deg)" : "none",
              transition: "transform 120ms",
            }}
          />
        </ListItemButton>
        {nw && (
          <>
            <MenuItem
              sx={sub}
              onClick={() => {
                close();
                actions.newDeck();
              }}
            >
              Presentation
            </MenuItem>
            <MenuItem
              sx={sub}
              onClick={() => {
                close();
                location.assign("/docs");
              }}
            >
              Document
            </MenuItem>
            <MenuItem
              sx={sub}
              onClick={() => {
                close();
                location.assign("/sheets");
              }}
            >
              Spreadsheet
            </MenuItem>
            <MenuItem sx={sub} disabled>
              Form
            </MenuItem>
          </>
        )}
        <MenuItem onClick={actions.open}>Open{kbd("Ctrl+O")}</MenuItem>
        <MenuItem
          onClick={() => {
            close();
            actions.importSlides();
          }}
        >
          Import slides (.pptx)
        </MenuItem>
        <MenuItem onClick={actions.makeCopy}>Make a copy</MenuItem>
        <ListDivider />
        <MenuItem onClick={actions.share}>Share</MenuItem>
        <MenuItem disabled>Email{arrow}</MenuItem>
        <ListItemButton
          onClick={() => setDl((v) => !v)}
          sx={{ borderRadius: "sm", fontSize: "0.875rem" }}
        >
          Download
          <ArrowRightIcon
            sx={{
              ml: "auto",
              transform: dl ? "rotate(90deg)" : "none",
              transition: "transform 120ms",
            }}
          />
        </ListItemButton>
        {dl &&
          DECK_DOWNLOAD_FORMATS.map((f) => (
            <MenuItem
              key={f.fmt}
              sx={sub}
              onClick={() => {
                close();
                setTimeout(() => actions.download(f.fmt), 0);
              }}
            >
              {f.label}
            </MenuItem>
          ))}
        <MenuItem disabled>Approvals</MenuItem>
        <MenuItem disabled>Convert to video</MenuItem>
        <ListDivider />
        <MenuItem onClick={actions.rename}>Rename</MenuItem>
        <MenuItem color="danger" onClick={actions.trash}>
          Move to trash
        </MenuItem>
        <MenuItem
          disabled={!actions.versionHistory}
          onClick={() => {
            close();
            actions.versionHistory?.();
          }}
        >
          Version history
        </MenuItem>
        <MenuItem disabled>Make available offline</MenuItem>
        <ListDivider />
        <MenuItem disabled>Details</MenuItem>
        <MenuItem disabled>Security limitations</MenuItem>
        <MenuItem disabled>Language{arrow}</MenuItem>
        <MenuItem onClick={actions.pageSetup}>Page setup</MenuItem>
        <MenuItem disabled>Print preview</MenuItem>
        <MenuItem onClick={actions.print}>Print{kbd("Ctrl+P")}</MenuItem>
      </Menu>
    </Dropdown>
  );
}
