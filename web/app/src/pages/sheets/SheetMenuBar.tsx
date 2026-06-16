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
import { SHEET_DOWNLOAD_FORMATS, type SheetFormat } from "./export";
import { ICON_STYLE_LABELS, type IconStyle } from "./iconSets";
import {
  sortRange,
  sortSheet,
  randomizeRange,
  toggleFilter,
  splitTextToColumns,
  type SortError,
} from "./dataActions";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet API is loosely typed here. */
type Wb = () => any;

export interface SheetActions {
  newSheet: () => void;
  open: () => void;
  makeCopy: () => void;
  rename: () => void;
  trash: () => void;
  share: () => void;
  download: (fmt: SheetFormat) => void | Promise<void>;
}

interface SheetMenuBarProps {
  getWb: Wb;
  actions: SheetActions;
  /** Opens the Find & replace dialog (rendered by the editor). */
  onFindReplace: () => void;
  /** Opens the Conditional formatting dialog. */
  onConditionalFormat: () => void;
  /** Opens the Named ranges dialog. */
  onNamedRanges: () => void;
  /** Opens the Data validation dialog. */
  onDataValidation: () => void;
  /** Opens the Insert chart dialog. */
  onInsertChart: () => void;
  /** Opens the Insert pivot table dialog. */
  onInsertPivot: () => void;
  /** Applies an icon-set rule to the current selection. */
  onIconSet: (style: IconStyle) => void;
  /** Clears all icon-set rules. */
  onClearIconSets: () => void;
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
const sub = { pl: 3 }; // indent for flattened submenu items

// Menu structures mirror docs/google-reference/sheets/editor.md (captured 2026-06-08):
// File · Edit · View · Insert · Format · Data · Tools · Extensions · Help.
// Items the FortuneSheet engine supports are wired; the rest are present-but-disabled
// stubs so the structure matches Google Sheets. Joy nested flyouts are unreliable, so
// submenus are flattened inline (section headers / indented items) like the Docs menu.
// User-facing messages for the few cases where a Data op can't run (matches Sheets'
// "select a range first" guidance rather than silently doing nothing).
const SORT_ERR: Record<NonNullable<SortError>, string> = {
  "no-selection": "Select a range first.",
  "single-cell": "Select a range of two or more cells first.",
};

export function SheetMenuBar({
  getWb,
  actions,
  onFindReplace,
  onConditionalFormat,
  onNamedRanges,
  onDataValidation,
  onInsertChart,
  onInsertPivot,
  onIconSet,
  onClearIconSets,
}: SheetMenuBarProps) {
  const wb = () => {
    try {
      return getWb();
    } catch {
      return null;
    }
  };
  const sel = (): any => {
    try {
      const s = wb()?.getSelection?.();
      return Array.isArray(s) ? s[0] : s;
    } catch {
      return null;
    }
  };
  const rowIdx = () => sel()?.row?.[0] ?? 0;
  const colIdx = () => sel()?.column?.[0] ?? 0;
  const call = (fn: (w: any) => void) => () => {
    const w = wb();
    if (w) {
      try {
        fn(w);
      } catch {
        /* ignore */
      }
    }
  };
  const fmt = (attr: string, value: any) =>
    call((w) => {
      const r = sel();
      if (r) w.setCellFormatByRange(attr, value, r);
    });
  // Run a Data op that may fail with a SortError; surface a small alert when it does.
  const dataOp = (fn: (w: any) => SortError) => () => {
    const w = wb();
    if (!w) return;
    try {
      const err = fn(w);
      if (err) window.alert(SORT_ERR[err]);
    } catch (e) {
      window.alert(`Operation failed: ${(e as Error).message}`);
    }
  };

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

      {/* EDIT — ref: 9 items */}
      {top(
        "Edit",
        <>
          <MenuItem onClick={call((w) => w.handleUndo())}>
            Undo{kbd("Ctrl+Z")}
          </MenuItem>
          <MenuItem onClick={call((w) => w.handleRedo())}>
            Redo{kbd("Ctrl+Y")}
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={() => document.execCommand("cut")}>
            Cut{kbd("Ctrl+X")}
          </MenuItem>
          <MenuItem onClick={() => document.execCommand("copy")}>
            Copy{kbd("Ctrl+C")}
          </MenuItem>
          <MenuItem onClick={() => document.execCommand("paste")}>
            Paste{kbd("Ctrl+V")}
          </MenuItem>
          <MenuItem disabled>Paste special{arrow}</MenuItem>
          <MenuItem disabled>Move{arrow}</MenuItem>
          <ListDivider />
          {section("Delete")}
          <MenuItem
            sx={sub}
            onClick={call((w) =>
              w.deleteRowOrColumn("row", rowIdx(), rowIdx()),
            )}
          >
            Delete row
          </MenuItem>
          <MenuItem
            sx={sub}
            onClick={call((w) =>
              w.deleteRowOrColumn("column", colIdx(), colIdx()),
            )}
          >
            Delete column
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={onFindReplace}>
            Find and replace{kbd("Ctrl+H")}
          </MenuItem>
        </>,
      )}

      {/* VIEW — ref: 7 items */}
      {top(
        "View",
        <>
          <MenuItem disabled>Show{arrow}</MenuItem>
          {section("Freeze")}
          <MenuItem
            sx={sub}
            onClick={call((w) => w.freeze("row", { row: 0, column: 0 }))}
          >
            1 row
          </MenuItem>
          <MenuItem
            sx={sub}
            onClick={call((w) => w.freeze("column", { row: 0, column: 0 }))}
          >
            1 column
          </MenuItem>
          <MenuItem
            sx={sub}
            onClick={call((w) =>
              w.freeze("row", { row: rowIdx(), column: colIdx() }),
            )}
          >
            Up to current row
          </MenuItem>
          <MenuItem
            sx={sub}
            onClick={call((w) =>
              w.freeze("column", { row: rowIdx(), column: colIdx() }),
            )}
          >
            Up to current column
          </MenuItem>
          <MenuItem
            sx={sub}
            onClick={call((w) =>
              w.freeze("both", { row: rowIdx(), column: colIdx() }),
            )}
          >
            Up to current row & column
          </MenuItem>
          <MenuItem
            sx={sub}
            onClick={call((w) => w.freeze("both", { row: 0, column: 0 }))}
          >
            No rows or columns
          </MenuItem>
          <ListDivider />
          <MenuItem disabled>Group{arrow}</MenuItem>
          <MenuItem disabled>Comments{arrow}</MenuItem>
          <MenuItem disabled>Hidden sheets{arrow}</MenuItem>
          <MenuItem disabled>Zoom{arrow}</MenuItem>
          <ListDivider />
          <MenuItem
            onClick={() => document.documentElement.requestFullscreen?.()}
          >
            Full screen
          </MenuItem>
        </>,
      )}

      {/* INSERT — ref: 19 items */}
      {top(
        "Insert",
        <>
          <MenuItem disabled>Cells{arrow}</MenuItem>
          {section("Rows")}
          <MenuItem
            sx={sub}
            onClick={call((w) =>
              w.insertRowOrColumn("row", rowIdx(), 1, "lefttop"),
            )}
          >
            Row above
          </MenuItem>
          <MenuItem
            sx={sub}
            onClick={call((w) =>
              w.insertRowOrColumn("row", rowIdx(), 1, "rightbottom"),
            )}
          >
            Row below
          </MenuItem>
          {section("Columns")}
          <MenuItem
            sx={sub}
            onClick={call((w) =>
              w.insertRowOrColumn("column", colIdx(), 1, "lefttop"),
            )}
          >
            Column left
          </MenuItem>
          <MenuItem
            sx={sub}
            onClick={call((w) =>
              w.insertRowOrColumn("column", colIdx(), 1, "rightbottom"),
            )}
          >
            Column right
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={call((w) => w.addSheet())}>
            Sheet{kbd("Shift+F11")}
          </MenuItem>
          <MenuItem disabled>Generate a table</MenuItem>
          <MenuItem disabled>Pre-built tables</MenuItem>
          <MenuItem disabled>Timeline</MenuItem>
          <MenuItem onClick={onInsertChart}>Chart</MenuItem>
          <MenuItem onClick={onInsertPivot}>Pivot table</MenuItem>
          <MenuItem disabled>Image{arrow}</MenuItem>
          <MenuItem disabled>Drawing</MenuItem>
          <MenuItem disabled>Function{arrow}</MenuItem>
          <MenuItem disabled>Link{kbd("Ctrl+K")}</MenuItem>
          <MenuItem disabled>Checkbox</MenuItem>
          <MenuItem disabled>Dropdown{arrow}</MenuItem>
          <MenuItem disabled>Emoji</MenuItem>
          <MenuItem disabled>Smart chips{arrow}</MenuItem>
          <MenuItem disabled>Comment{kbd("Ctrl+Alt+M")}</MenuItem>
          <MenuItem disabled>Note{kbd("Shift+F2")}</MenuItem>
        </>,
      )}

      {/* FORMAT — ref: 13 items */}
      {top(
        "Format",
        <>
          <MenuItem disabled>Theme</MenuItem>
          {section("Number")}
          <MenuItem sx={sub} onClick={fmt("ct", { fa: "General", t: "g" })}>
            Automatic
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("ct", { fa: "@", t: "s" })}>
            Plain text
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("ct", { fa: "#,##0.00", t: "n" })}>
            Number
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("ct", { fa: "0.00%", t: "n" })}>
            Percent
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("ct", { fa: "0.00E+00", t: "n" })}>
            Scientific
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("ct", { fa: "$#,##0.00", t: "n" })}>
            Currency
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("ct", { fa: "$#,##0", t: "n" })}>
            Currency (rounded)
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("ct", { fa: "yyyy-MM-dd", t: "d" })}>
            Date
          </MenuItem>
          <MenuItem
            sx={sub}
            onClick={fmt("ct", { fa: "h:mm:ss AM/PM", t: "d" })}
          >
            Time
          </MenuItem>
          <MenuItem
            sx={sub}
            onClick={fmt("ct", { fa: "yyyy-MM-dd h:mm:ss", t: "d" })}
          >
            Date time
          </MenuItem>
          {section("Text")}
          <MenuItem sx={sub} onClick={fmt("bl", 1)}>
            Bold{kbd("Ctrl+B")}
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("it", 1)}>
            Italic{kbd("Ctrl+I")}
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("un", 1)}>
            Underline{kbd("Ctrl+U")}
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("cl", 1)}>
            Strikethrough{kbd("Alt+Shift+5")}
          </MenuItem>
          {section("Alignment")}
          <MenuItem sx={sub} onClick={fmt("ht", "1")}>
            Left
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("ht", "0")}>
            Center
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("ht", "2")}>
            Right
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("vt", "0")}>
            Top
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("vt", "1")}>
            Middle
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("vt", "2")}>
            Bottom
          </MenuItem>
          <ListDivider />
          <MenuItem disabled>Wrapping{arrow}</MenuItem>
          <MenuItem disabled>Rotation{arrow}</MenuItem>
          <MenuItem
            onClick={call((w) => {
              const r = sel();
              if (r) w.mergeCells(r, "merge-all");
            })}
          >
            Merge cells
          </MenuItem>
          <MenuItem
            onClick={call((w) => {
              const r = sel();
              if (r) w.cancelMerge(r);
            })}
          >
            Unmerge
          </MenuItem>
          <MenuItem disabled>Convert to table{kbd("Ctrl+Alt+T")}</MenuItem>
          <MenuItem onClick={onConditionalFormat}>
            Conditional formatting
          </MenuItem>
          {section("Icon set")}
          {(Object.keys(ICON_STYLE_LABELS) as IconStyle[]).map((style) => (
            <MenuItem key={style} sx={sub} onClick={() => onIconSet(style)}>
              {ICON_STYLE_LABELS[style]}
            </MenuItem>
          ))}
          <MenuItem sx={sub} onClick={onClearIconSets}>
            Clear icon sets
          </MenuItem>
          <MenuItem disabled>Alternating colors</MenuItem>
          <MenuItem onClick={fmt("ct", { fa: "General", t: "g" })}>
            Clear formatting{kbd("Ctrl+\\")}
          </MenuItem>
        </>,
      )}

      {/* DATA — Sheets-only; ref: 17 items. Sort / filter / randomize / split are
          wired to the FortuneSheet engine; the rest remain present-but-disabled stubs. */}
      {top(
        "Data",
        <>
          <MenuItem disabled>Analyze data</MenuItem>
          <ListDivider />
          {section("Sort sheet")}
          <MenuItem
            sx={sub}
            onClick={dataOp((w) => sortSheet(w, true, colIdx()))}
          >
            Sort sheet by current column (A → Z)
          </MenuItem>
          <MenuItem
            sx={sub}
            onClick={dataOp((w) => sortSheet(w, false, colIdx()))}
          >
            Sort sheet by current column (Z → A)
          </MenuItem>
          {section("Sort range")}
          <MenuItem sx={sub} onClick={dataOp((w) => sortRange(w, true))}>
            Sort range (A → Z)
          </MenuItem>
          <MenuItem sx={sub} onClick={dataOp((w) => sortRange(w, false))}>
            Sort range (Z → A)
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={dataOp((w) => toggleFilter(w))}>
            Create a filter
          </MenuItem>
          <MenuItem disabled>Create group by view{arrow}</MenuItem>
          <MenuItem disabled>Create filter view</MenuItem>
          <MenuItem disabled>Add a slicer</MenuItem>
          <ListDivider />
          <MenuItem disabled>Protect sheets and ranges</MenuItem>
          <MenuItem onClick={onNamedRanges}>Named ranges</MenuItem>
          <MenuItem disabled>Named functions</MenuItem>
          <MenuItem onClick={dataOp((w) => randomizeRange(w))}>
            Randomize range
          </MenuItem>
          <ListDivider />
          <MenuItem disabled>Column stats</MenuItem>
          <MenuItem onClick={onDataValidation}>Data validation</MenuItem>
          <MenuItem disabled>Data cleanup{arrow}</MenuItem>
          <MenuItem onClick={dataOp((w) => splitTextToColumns(w))}>
            Split text to columns
          </MenuItem>
          <MenuItem disabled>Data extraction</MenuItem>
          <ListDivider />
          <MenuItem disabled>Data connectors{arrow}</MenuItem>
        </>,
      )}

      {/* TOOLS — ref: 7 items */}
      {top(
        "Tools",
        <>
          <MenuItem disabled>Create a new form</MenuItem>
          <MenuItem disabled>Spelling{arrow}</MenuItem>
          <MenuItem disabled>Suggestion controls{arrow}</MenuItem>
          <MenuItem disabled>Conditional notifications</MenuItem>
          <MenuItem disabled>Notification settings{arrow}</MenuItem>
          <MenuItem disabled>Accessibility</MenuItem>
          <MenuItem disabled>Activity dashboard</MenuItem>
        </>,
      )}

      {/* EXTENSIONS — Sheets; ref: 5 items (all stubs) */}
      {top(
        "Extensions",
        <>
          <MenuItem disabled>Add-ons{arrow}</MenuItem>
          <MenuItem disabled>Macros{arrow}</MenuItem>
          <MenuItem disabled>Apps Script</MenuItem>
          <MenuItem disabled>AppSheet{arrow}</MenuItem>
          <MenuItem disabled>Data Studio{arrow}</MenuItem>
        </>,
      )}

      {/* HELP — ref: 8 items */}
      {top(
        "Help",
        <>
          <MenuItem disabled>Search the menus{kbd("Alt+/")}</MenuItem>
          <MenuItem disabled>Ask Gemini for help</MenuItem>
          <MenuItem disabled>Sheets Help</MenuItem>
          <MenuItem disabled>Training</MenuItem>
          <MenuItem disabled>Updates</MenuItem>
          <MenuItem disabled>Help Sheets improve</MenuItem>
          <MenuItem disabled>Function list</MenuItem>
          <MenuItem
            onClick={() =>
              window.alert(
                "Keyboard shortcuts\n\nBold Ctrl+B · Italic Ctrl+I · Underline Ctrl+U\nUndo Ctrl+Z · Redo Ctrl+Y · Find/replace Ctrl+H",
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

// FileMenu — ref: 16 items. New + Download expand inline (Joy nested flyouts unreliable).
function FileMenu({ actions }: { actions: SheetActions }) {
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
                actions.newSheet();
              }}
            >
              Spreadsheet
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
                location.assign("/slides");
              }}
            >
              Presentation
            </MenuItem>
            <MenuItem sx={sub} disabled>
              Form
            </MenuItem>
          </>
        )}
        <MenuItem onClick={actions.open}>Open{kbd("Ctrl+O")}</MenuItem>
        <MenuItem disabled>Import</MenuItem>
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
          SHEET_DOWNLOAD_FORMATS.map((f) => (
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
        <MenuItem disabled>Settings</MenuItem>
        <ListDivider />
        <MenuItem onClick={() => window.print()}>Print{kbd("Ctrl+P")}</MenuItem>
      </Menu>
    </Dropdown>
  );
}
