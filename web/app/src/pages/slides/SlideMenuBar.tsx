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
import type { ElementType } from "./model";

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
  undo: () => void;
  redo: () => void;
  insert: (type: ElementType) => void;
  insertImageFile: () => void;
  newSlide: () => void;
  duplicateSlide: () => void;
  deleteSlide: () => void;
  present: () => void;
  toggle: (attr: "bold" | "italic" | "underline" | "strike") => void;
  setList: (v: "bullet" | "number" | null) => void;
  setLineSpacing: (v: number) => void;
  setAlign: (a: "left" | "center" | "right") => void;
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
  paste: () => void;
  duplicateSelected: () => void;
  openTransition: () => void;
  openAnimations: () => void;
  toggleNotes: () => void;
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
          <MenuItem disabled>Find and replace{kbd("Ctrl+H")}</MenuItem>
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
          <MenuItem disabled>Theme builder</MenuItem>
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
          <ListDivider />
          <MenuItem disabled>Diagram{arrow}</MenuItem>
          <MenuItem onClick={() => actions.insert("table")}>Table (3×3)</MenuItem>
          <MenuItem disabled>Chart{arrow}</MenuItem>
          <MenuItem disabled>Word art</MenuItem>
          <MenuItem disabled>Video</MenuItem>
          <MenuItem disabled>Audio</MenuItem>
          <MenuItem disabled>Special characters</MenuItem>
          <MenuItem onClick={actions.openAnimations}>Animation</MenuItem>
          <MenuItem onClick={actions.setLink}>Link…{kbd("Ctrl+K")}</MenuItem>
          <MenuItem disabled>Comment{kbd("Ctrl+Alt+M")}</MenuItem>
          <ListDivider />
          <MenuItem onClick={actions.newSlide}>
            New slide{kbd("Ctrl+M")}
          </MenuItem>
          <MenuItem disabled>Slide numbers</MenuItem>
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
            Strikethrough
          </MenuItem>
          {section("Align")}
          <MenuItem sx={sub} onClick={() => actions.setAlign("left")}>
            Left
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.setAlign("center")}>
            Center
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.setAlign("right")}>
            Right
          </MenuItem>
          <ListDivider />
          {section("Bullets & numbering")}
          <MenuItem sx={sub} onClick={() => actions.setList("bullet")}>
            Bulleted list
          </MenuItem>
          <MenuItem sx={sub} onClick={() => actions.setList("number")}>
            Numbered list
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
          <ListDivider />
          <MenuItem disabled>Table{arrow}</MenuItem>
          <MenuItem disabled>Image{arrow}</MenuItem>
          <MenuItem disabled>Borders &amp; lines{arrow}</MenuItem>
          <MenuItem disabled>Format options{kbd("Ctrl+\\")}</MenuItem>
          <MenuItem disabled>Clear formatting</MenuItem>
        </>,
      )}

      {/* SLIDE — Slides-specific; ref: 13 items */}
      {top(
        "Slide",
        <>
          <MenuItem onClick={actions.newSlide}>
            New slide{kbd("Ctrl+M")}
          </MenuItem>
          <MenuItem disabled>Create a slide{arrow}</MenuItem>
          <MenuItem disabled>Templates</MenuItem>
          <MenuItem onClick={actions.duplicateSlide}>Duplicate slide</MenuItem>
          <MenuItem onClick={actions.deleteSlide}>Delete slide</MenuItem>
          <MenuItem disabled>Skip slide</MenuItem>
          <MenuItem disabled>Move slide{arrow}</MenuItem>
          <ListDivider />
          <MenuItem onClick={actions.setBackground}>
            Change background…
          </MenuItem>
          <MenuItem disabled>Apply layout{arrow}</MenuItem>
          <MenuItem onClick={actions.openTransition}>Transition…</MenuItem>
          <MenuItem disabled>Edit theme</MenuItem>
          <MenuItem disabled>Change theme</MenuItem>
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
                "Keyboard shortcuts\n\nBold Ctrl+B · Italic Ctrl+I · Underline Ctrl+U\nNew slide Ctrl+M · Slideshow Ctrl+F5\nUndo Ctrl+Z · Redo Ctrl+Y · Duplicate Ctrl+D",
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
        <MenuItem disabled>Version history{arrow}</MenuItem>
        <MenuItem disabled>Make available offline</MenuItem>
        <ListDivider />
        <MenuItem disabled>Details</MenuItem>
        <MenuItem disabled>Security limitations</MenuItem>
        <MenuItem disabled>Language{arrow}</MenuItem>
        <MenuItem disabled>Page setup</MenuItem>
        <MenuItem disabled>Print preview</MenuItem>
        <MenuItem onClick={actions.print}>Print{kbd("Ctrl+P")}</MenuItem>
      </Menu>
    </Dropdown>
  );
}
