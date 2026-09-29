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
import { formatValue } from "./numberFormat";
import { NUMBER_FORMAT_PRESETS, applyNumberFormat } from "./numberFormatActions";
import {
  sortRange,
  sortSheet,
  randomizeRange,
  toggleFilter,
  splitTextToColumns,
  type SortError,
} from "./dataActions";
import {
  changeSelectionCase,
  deleteRowsCols,
  fillSelection,
  insertRowsCols,
  moveSelection,
  pasteSpecialHere,
  shiftCells,
} from "./editActions";
import type { TextCase } from "./textCase";
import { shortcutHint } from "./sheetShortcuts";
import { useShortcutScheme } from "../../lib/shortcutScheme";

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
  /** File ▸ Version history (opens the version history panel). */
  versionHistory?: () => void;
  /** File ▸ Import. */
  importFile?: () => void;
  /** File ▸ Print (page setup + preview). */
  print?: () => void;
}

/** What View ▸ Show / Zoom / Page break preview reflect for the active sheet. */
export interface ViewState {
  showFormulas: boolean;
  showGridLines: boolean;
  showHeadings: boolean;
  zoom: number;
  pageBreakPreview: boolean;
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
  /** Opens the sparkline group dialog. */
  onInsertSparklines?: () => void;
  /** Opens the Insert pivot table dialog. */
  onInsertPivot: () => void;
  /** Applies an icon-set rule to the current selection. */
  onIconSet: (style: IconStyle) => void;
  /** Clears all icon-set rules. */
  onClearIconSets: () => void;
  /** Opens the Custom number format dialog. */
  onCustomNumberFormat: () => void;
  /** Opens the column filter dialog (values, conditions, top 10, colour, sort). */
  onFilterColumn?: () => void;
  /** Toggles red circles around cells that break their validation rule. */
  onCircleInvalid?: () => void;
  /** Opens Edit ▸ Fill ▸ Series… */
  onFillSeries?: () => void;
  /** Opens the multi-key Sort range dialog. */
  onSortDialog?: () => void;
  /** Opens the Paste special dialog. */
  onPasteSpecial?: () => void;
  /** Current view options of the active sheet. */
  view?: ViewState;
  /** Changes view options (show formulas, gridlines, headings, zoom, page-break preview). */
  onView?: (patch: Partial<ViewState>) => void;
  /** Insert ▸ Page break actions at the selection. */
  onPageBreak?: (action: "insert" | "remove" | "reset") => void;
  /** Opens Data ▸ Protect sheets and ranges. */
  onProtect?: () => void;
  /** Insert ▸ Function… (the function wizard). */
  onInsertFunction?: () => void;
  /** Insert ▸ Link (Ctrl+K). */
  onInsertLink?: () => void;
  /** Insert ▸ Comment (Ctrl+Alt+M). */
  onInsertComment?: () => void;
  /** View ▸ Comments (the side panel). */
  onShowComments?: () => void;
  /** Data ▸ What-if analysis ▸ Goal seek… */
  onGoalSeek?: () => void;
  /** Tools ▸ Trace precedents / dependents / Remove arrows. */
  onTrace?: (kind: "precedents" | "dependents" | "clear") => void;
  /** Help ▸ Keyboard shortcuts (Ctrl+/). */
  onShortcuts?: () => void;
  /** Insert ▸ Table (Ctrl+L). */
  onInsertTable?: () => void;
  /** Format ▸ Format as table (a style for the table at the selection, or a new table). */
  onFormatAsTable?: (style?: string) => void;
  /** Data ▸ Table properties (the table at the selection). */
  onTableProperties?: () => void;
}

const TEXT_CASES: [TextCase, string][] = [
  ["lower", "lowercase"],
  ["upper", "UPPERCASE"],
  ["sentence", "Sentence case"],
  ["capitalize", "Capitalize Each Word"],
  ["toggle", "tOGGLE cASE"],
];

// Example values shown next to each Format ▸ Number preset.
const PRESET_SAMPLE: Record<string, number | string> = {
  automatic: 1234.56,
  text: "abc",
  percent: 0.1234,
  accounting: -1234.56,
  financial: -1234.56,
  date: 45293.5,
  time: 45293.5,
  datetime: 45293.5,
  duration: 1.5347,
  fraction: 1.75,
};

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
  onInsertSparklines,
  onInsertPivot,
  onIconSet,
  onClearIconSets,
  onCustomNumberFormat,
  onFilterColumn,
  onCircleInvalid,
  onFillSeries,
  onSortDialog,
  onPasteSpecial,
  view,
  onView,
  onPageBreak,
  onProtect,
  onInsertFunction,
  onInsertLink,
  onInsertComment,
  onShowComments,
  onGoalSeek,
  onTrace,
  onShortcuts,
  onInsertTable,
  onFormatAsTable,
  onTableProperties,
}: SheetMenuBarProps) {
  // Menu hints for chords that depend on the user's shortcut scheme.
  const scheme = useShortcutScheme("sheets");
  const hint = (id: string) => {
    const k = shortcutHint(id, scheme);
    return k ? kbd(k) : null;
  };
  const check = (on: boolean | undefined) => (
    <Typography component="span" sx={{ width: 18, display: "inline-block", opacity: on ? 1 : 0 }} aria-hidden>
      ✓
    </Typography>
  );
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
  const rowEnd = () => sel()?.row?.[1] ?? rowIdx();
  const colEnd = () => sel()?.column?.[1] ?? colIdx();
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
          {section("Paste special")}
          <MenuItem sx={sub} onClick={call((w) => pasteSpecialHere(w, { what: "values" }))}>
            Values only{kbd("Ctrl+Shift+V")}
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => pasteSpecialHere(w, { what: "formats" }))}>
            Format only
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => pasteSpecialHere(w, { what: "formulas" }))}>
            Formula only
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => pasteSpecialHere(w, { what: "all", transpose: true }))}>
            Transposed
          </MenuItem>
          {onPasteSpecial && (
            <MenuItem sx={sub} onClick={onPasteSpecial}>
              Paste special…{hint("pasteSpecial")}
            </MenuItem>
          )}
          {section("Fill")}
          <MenuItem sx={sub} onClick={call((w) => fillSelection(w, "down"))}>
            Down{kbd("Ctrl+D")}
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => fillSelection(w, "right"))}>
            Right{kbd("Ctrl+R")}
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => fillSelection(w, "up"))}>
            Up
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => fillSelection(w, "left"))}>
            Left
          </MenuItem>
          {onFillSeries && (
            <MenuItem sx={sub} onClick={onFillSeries}>
              Series…
            </MenuItem>
          )}
          {section("Move")}
          <MenuItem sx={sub} onClick={call((w) => moveSelection(w, "row", -1))}>
            Row up
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => moveSelection(w, "row", 1))}>
            Row down
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => moveSelection(w, "col", -1))}>
            Column left
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => moveSelection(w, "col", 1))}>
            Column right
          </MenuItem>
          <ListDivider />
          {section("Delete")}
          <MenuItem sx={sub} onClick={call((w) => deleteRowsCols(w, "row", rowIdx(), rowEnd()))}>
            Delete row{hint("deleteRowsCols")}
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => deleteRowsCols(w, "col", colIdx(), colEnd()))}>
            Delete column
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => shiftCells(w, "up"))}>
            Delete cells and shift up
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => shiftCells(w, "left"))}>
            Delete cells and shift left
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
          {section("Show")}
          <MenuItem sx={sub} role="menuitemcheckbox" aria-checked={!!view?.showGridLines} onClick={() => onView?.({ showGridLines: !view?.showGridLines })}>
            {check(view?.showGridLines)}Gridlines
          </MenuItem>
          <MenuItem sx={sub} role="menuitemcheckbox" aria-checked={!!view?.showFormulas} onClick={() => onView?.({ showFormulas: !view?.showFormulas })}>
            {check(view?.showFormulas)}Formulas{kbd("Ctrl+`")}
          </MenuItem>
          <MenuItem sx={sub} role="menuitemcheckbox" aria-checked={!!view?.showHeadings} onClick={() => onView?.({ showHeadings: !view?.showHeadings })}>
            {check(view?.showHeadings)}Row and column headings
          </MenuItem>
          <MenuItem sx={sub} role="menuitemcheckbox" aria-checked={!!view?.pageBreakPreview} onClick={() => onView?.({ pageBreakPreview: !view?.pageBreakPreview })}>
            {check(view?.pageBreakPreview)}Page breaks
          </MenuItem>
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
          <MenuItem disabled={!onShowComments} onClick={onShowComments}>
            Comments
          </MenuItem>
          <MenuItem disabled>Hidden sheets{arrow}</MenuItem>
          {section("Zoom")}
          {[0.5, 0.75, 0.9, 1, 1.25, 1.5, 2].map((z) => (
            <MenuItem key={z} sx={sub} role="menuitemradio" aria-checked={Math.abs((view?.zoom ?? 1) - z) < 0.001} onClick={() => onView?.({ zoom: z })}>
              {check(Math.abs((view?.zoom ?? 1) - z) < 0.001)}
              {Math.round(z * 100)}%
            </MenuItem>
          ))}
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
          {section("Cells")}
          <MenuItem sx={sub} onClick={call((w) => shiftCells(w, "right"))}>
            Insert cells and shift right
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => shiftCells(w, "down"))}>
            Insert cells and shift down
          </MenuItem>
          {section("Rows")}
          <MenuItem sx={sub} onClick={call((w) => insertRowsCols(w, "row", rowIdx(), rowEnd() - rowIdx() + 1, "before"))}>
            Row above{hint("insertRowsCols")}
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => insertRowsCols(w, "row", rowEnd(), rowEnd() - rowIdx() + 1, "after"))}>
            Row below
          </MenuItem>
          {section("Columns")}
          <MenuItem sx={sub} onClick={call((w) => insertRowsCols(w, "col", colIdx(), colEnd() - colIdx() + 1, "before"))}>
            Column left
          </MenuItem>
          <MenuItem sx={sub} onClick={call((w) => insertRowsCols(w, "col", colEnd(), colEnd() - colIdx() + 1, "after"))}>
            Column right
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={call((w) => w.addSheet())}>
            Sheet{kbd("Shift+F11")}
          </MenuItem>
          <MenuItem disabled={!onInsertTable} onClick={onInsertTable}>
            Table{hint("insertTable")}
          </MenuItem>
          <MenuItem disabled>Generate a table</MenuItem>
          <MenuItem disabled>Pre-built tables</MenuItem>
          <MenuItem disabled>Timeline</MenuItem>
          <MenuItem onClick={onInsertChart}>Chart</MenuItem>
          {onInsertSparklines && <MenuItem onClick={onInsertSparklines}>Sparklines…</MenuItem>}
          <MenuItem onClick={onInsertPivot}>Pivot table</MenuItem>
          {section("Page break")}
          <MenuItem sx={sub} onClick={() => onPageBreak?.("insert")}>
            Insert page break
          </MenuItem>
          <MenuItem sx={sub} onClick={() => onPageBreak?.("remove")}>
            Remove page break
          </MenuItem>
          <MenuItem sx={sub} onClick={() => onPageBreak?.("reset")}>
            Reset all page breaks
          </MenuItem>
          <MenuItem disabled>Image{arrow}</MenuItem>
          <MenuItem disabled>Drawing</MenuItem>
          <MenuItem disabled={!onInsertFunction} onClick={onInsertFunction}>
            Function…{kbd("Shift+F3")}
          </MenuItem>
          <MenuItem disabled={!onInsertLink} onClick={onInsertLink}>
            Link{kbd("Ctrl+K")}
          </MenuItem>
          <MenuItem disabled>Checkbox</MenuItem>
          <MenuItem disabled>Dropdown{arrow}</MenuItem>
          <MenuItem disabled>Emoji</MenuItem>
          <MenuItem disabled>Smart chips{arrow}</MenuItem>
          <MenuItem disabled={!onInsertComment} onClick={onInsertComment}>
            Comment{kbd("Ctrl+Alt+M")}
          </MenuItem>
          <MenuItem disabled>Note</MenuItem>
        </>,
      )}

      {/* FORMAT — ref: 13 items */}
      {top(
        "Format",
        <>
          <MenuItem disabled>Theme</MenuItem>
          {section("Number")}
          {NUMBER_FORMAT_PRESETS.map((p) => (
            <MenuItem
              key={p.id}
              sx={sub}
              data-numfmt={p.id}
              onClick={call((w) => applyNumberFormat(w, p.fa))}
            >
              {p.label}
              <Typography level="body-xs" sx={{ ml: "auto", pl: 3, opacity: 0.5 }}>
                {formatValue(PRESET_SAMPLE[p.id] ?? 1234.56, p.fa)}
              </Typography>
            </MenuItem>
          ))}
          <MenuItem sx={sub} onClick={onCustomNumberFormat}>
            Custom number format…
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
            Strikethrough{hint("strikethrough")}
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("va", 1)}>
            Superscript{kbd("Ctrl+.")}
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("va", 2)}>
            Subscript{kbd("Ctrl+,")}
          </MenuItem>
          {section("Change case")}
          {TEXT_CASES.map(([mode, label]) => (
            <MenuItem key={mode} sx={sub} data-textcase={mode} onClick={call((w) => changeSelectionCase(w, mode))}>
              {label}
            </MenuItem>
          ))}
          {section("Alignment")}
          <MenuItem sx={sub} onClick={fmt("ht", "1")}>
            Left{hint("alignLeft")}
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("ht", "0")}>
            Center{hint("alignCenter")}
          </MenuItem>
          <MenuItem sx={sub} onClick={fmt("ht", "2")}>
            Right{hint("alignRight")}
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
              if (r) w.mergeCells([r], "merge-all");
            })}
          >
            Merge cells
          </MenuItem>
          <MenuItem
            onClick={call((w) => {
              const r = sel();
              if (r) w.cancelMerge([r]);
            })}
          >
            Unmerge
          </MenuItem>
          <MenuItem disabled={!onFormatAsTable} onClick={() => onFormatAsTable?.()}>
            Format as table…
          </MenuItem>
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
          {onSortDialog && (
            <MenuItem sx={sub} onClick={onSortDialog}>
              Advanced range sorting options…
            </MenuItem>
          )}
          <ListDivider />
          <MenuItem onClick={dataOp((w) => toggleFilter(w))}>
            Create a filter
          </MenuItem>
          {onFilterColumn && (
            <MenuItem onClick={onFilterColumn}>Filter by values or condition…</MenuItem>
          )}
          <MenuItem disabled={!onTableProperties} onClick={onTableProperties}>
            Table properties…
          </MenuItem>
          <MenuItem disabled>Create group by view{arrow}</MenuItem>
          <MenuItem disabled>Create filter view</MenuItem>
          <MenuItem disabled>Add a slicer</MenuItem>
          <ListDivider />
          <MenuItem disabled={!onProtect} onClick={onProtect}>
            Protect sheets and ranges
          </MenuItem>
          <MenuItem onClick={onNamedRanges}>Named ranges</MenuItem>
          <MenuItem disabled>Named functions</MenuItem>
          <MenuItem onClick={dataOp((w) => randomizeRange(w))}>
            Randomize range
          </MenuItem>
          <ListDivider />
          <MenuItem disabled>Column stats</MenuItem>
          <MenuItem onClick={onDataValidation}>Data validation</MenuItem>
          {onCircleInvalid && (
            <MenuItem sx={sub} onClick={onCircleInvalid}>
              Circle invalid data
            </MenuItem>
          )}
          <MenuItem disabled>Data cleanup{arrow}</MenuItem>
          <MenuItem onClick={dataOp((w) => splitTextToColumns(w))}>
            Split text to columns
          </MenuItem>
          <MenuItem disabled>Data extraction</MenuItem>
          {section("What-if analysis")}
          <MenuItem sx={sub} disabled={!onGoalSeek} onClick={onGoalSeek}>
            Goal seek…
          </MenuItem>
          <ListDivider />
          <MenuItem disabled>Data connectors{arrow}</MenuItem>
        </>,
      )}

      {/* TOOLS — ref: 7 items */}
      {top(
        "Tools",
        <>
          {section("Formula auditing")}
          <MenuItem sx={sub} disabled={!onTrace} onClick={() => onTrace?.("precedents")}>
            Trace precedents
          </MenuItem>
          <MenuItem sx={sub} disabled={!onTrace} onClick={() => onTrace?.("dependents")}>
            Trace dependents
          </MenuItem>
          <MenuItem sx={sub} disabled={!onTrace} onClick={() => onTrace?.("clear")}>
            Remove arrows
          </MenuItem>
          <ListDivider />
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
          <MenuItem disabled={!onInsertFunction} onClick={onInsertFunction}>
            Function list
          </MenuItem>
          <MenuItem disabled={!onShortcuts} onClick={onShortcuts}>
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
        <MenuItem
          disabled={!actions.importFile}
          onClick={() => {
            close();
            actions.importFile?.();
          }}
        >
          Import
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
        <MenuItem disabled>Settings</MenuItem>
        <ListDivider />
        <MenuItem
          onClick={() => {
            close();
            if (actions.print) actions.print();
            else window.print();
          }}
        >
          Print{kbd("Ctrl+P")}
        </MenuItem>
      </Menu>
    </Dropdown>
  );
}
