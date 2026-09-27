// The Layout menu (Docs M9), after OnlyOffice's Layout tab: margins,
// orientation, size, columns, breaks, line numbers, hyphenation, page
// background (watermark, colour, borders) and header/footer options.
// Presets apply to the section at the caret; the dialogs offer "whole
// document" and "this point forward".
import { useState } from "react";
import { Box, Dropdown, ListDivider, Menu, MenuButton, MenuItem, Typography } from "@mui/joy";
import type { Editor } from "@tiptap/react";
import {
  COLUMN_PRESETS,
  MARGIN_PRESETS,
  PAGE_SIZES,
  SECTION_START_LABEL,
  SECTION_STARTS,
  setOrientation,
  setPageSize,
  type LineNumberRestart,
} from "./sections";
import { getSettings, setDocSettings, setSectionProps } from "./pageLayout";
import { openLayoutDialog } from "./LayoutDialogs";
import type { DocActions } from "./MenuBar";

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

const head = (t: string) => (
  <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
    {t}
  </Typography>
);

const PAGE_COLORS = ["#ffffff", "#fff8e1", "#e8f5e9", "#e3f2fd", "#fce4ec", "#f3e5f5", "#eceff1"];

export function LayoutMenu({ editor, actions }: { editor: Editor | null; actions: DocActions }) {
  const [open, setOpen] = useState(false);
  const run = (fn: (e: Editor) => void) => () => {
    setOpen(false);
    if (editor) fn(editor);
  };
  const lineNumbers = (restart: LineNumberRestart | null) =>
    run((e) => setSectionProps(e, (p) => ({ ...p, lnNum: restart ? { countBy: 1, start: 1, distance: 0, ...(p.lnNum ?? {}), restart } : null })));
  return (
    <Dropdown open={open} onOpenChange={(_, o) => setOpen(o)}>
      <MenuButton variant="plain" size="sm" sx={menuButtonSx} data-testid="menu-layout">
        Layout
      </MenuButton>
      <Menu size="sm" placement="bottom-start" sx={{ minWidth: 260, maxHeight: "80vh", overflowY: "auto" }}>
        <MenuItem onClick={run(() => actions.pageSetup())} data-testid="layout-page-setup">
          Page setup…
        </MenuItem>
        <ListDivider />
        {head("Margins")}
        {MARGIN_PRESETS.map((m) => (
          <MenuItem
            key={m.id}
            data-testid={`layout-margins-${m.id}`}
            onClick={run((e) => {
              setSectionProps(e, (p) => ({ ...p, margins: { ...p.margins, ...m.margins } }));
              if (!!m.mirror !== getSettings(e).mirror) setDocSettings(e, { mirror: !!m.mirror });
            })}
          >
            {m.name}
          </MenuItem>
        ))}
        <ListDivider />
        {head("Orientation")}
        <MenuItem data-testid="layout-portrait" onClick={run((e) => setSectionProps(e, (p) => setOrientation(p, "portrait")))}>
          Portrait
        </MenuItem>
        <MenuItem data-testid="layout-landscape" onClick={run((e) => setSectionProps(e, (p) => setOrientation(p, "landscape")))}>
          Landscape
        </MenuItem>
        <ListDivider />
        {head("Size")}
        {PAGE_SIZES.slice(0, 6).map((s) => (
          <MenuItem key={s.id} onClick={run((e) => setSectionProps(e, (p) => setPageSize(p, s.w, s.h)))}>
            {s.name}
          </MenuItem>
        ))}
        <MenuItem onClick={run(() => openLayoutDialog("pagesetup"))}>More sizes…</MenuItem>
        <ListDivider />
        {head("Columns")}
        {COLUMN_PRESETS.map((c) => (
          <MenuItem key={c.id} data-testid={`layout-columns-${c.id}`} onClick={run((e) => setSectionProps(e, c.apply))}>
            {c.name}
          </MenuItem>
        ))}
        <MenuItem onClick={run(() => openLayoutDialog("columns"))}>More columns…</MenuItem>
        <ListDivider />
        {head("Breaks")}
        <MenuItem onClick={run((e) => void (e.chain().focus().insertPageBreak().run() || e.chain().focus().setPageBreak().run()))}>
          Page break
        </MenuItem>
        <MenuItem data-testid="layout-column-break" onClick={run((e) => void e.chain().focus().insertColumnBreak().run())}>
          Column break
        </MenuItem>
        {SECTION_STARTS.map((k) => (
          <MenuItem key={k} data-testid={`layout-break-${k}`} onClick={run((e) => void e.chain().focus().insertSectionBreak(k).run())}>
            Section break: {SECTION_START_LABEL[k].toLowerCase()}
          </MenuItem>
        ))}
        <ListDivider />
        {head("Line numbers")}
        <MenuItem onClick={lineNumbers(null)}>None</MenuItem>
        <MenuItem data-testid="layout-line-numbers" onClick={lineNumbers("continuous")}>
          Continuous
        </MenuItem>
        <MenuItem onClick={lineNumbers("newPage")}>Restart each page</MenuItem>
        <MenuItem onClick={lineNumbers("newSection")}>Restart each section</MenuItem>
        <MenuItem onClick={run(() => openLayoutDialog("linenumbers"))}>Line numbering options…</MenuItem>
        <ListDivider />
        {head("Hyphenation")}
        <MenuItem onClick={run((e) => setDocSettings(e, { hyphenation: { ...getSettings(e).hyphenation, auto: false } }))}>None</MenuItem>
        <MenuItem onClick={run((e) => setDocSettings(e, { hyphenation: { ...getSettings(e).hyphenation, auto: true } }))}>Automatic</MenuItem>
        <MenuItem onClick={run(() => openLayoutDialog("hyphenation"))}>Hyphenation options…</MenuItem>
        <ListDivider />
        {head("Page background")}
        <MenuItem data-testid="layout-watermark" onClick={run(() => openLayoutDialog("watermark"))}>
          Watermark…
        </MenuItem>
        <Box sx={{ display: "flex", gap: 0.5, px: 1.5, py: 0.5, alignItems: "center" }}>
          <Typography level="body-sm" sx={{ mr: 0.5 }}>
            Page color
          </Typography>
          {PAGE_COLORS.map((c) => (
            <Box
              key={c}
              component="button"
              type="button"
              title={c === "#ffffff" ? "No color" : c}
              data-testid={`page-color-${c.slice(1)}`}
              onMouseDown={(ev: React.MouseEvent) => ev.preventDefault()}
              onClick={run((e) => setDocSettings(e, { pageColor: c === "#ffffff" ? null : c }))}
              sx={{ width: 18, height: 18, borderRadius: "3px", border: "1px solid #bdc1c6", bgcolor: c, cursor: "pointer", p: 0 }}
            />
          ))}
        </Box>
        <MenuItem
          onClick={run((e) =>
            setSectionProps(e, (p) => ({
              ...p,
              borders: p.borders ? null : { style: "single", color: "#000000", width: 0.75, space: 24, offsetFrom: "text", display: "all" },
            })),
          )}
        >
          Page borders (box on / off)
        </MenuItem>
        <ListDivider />
        <MenuItem data-testid="layout-hf-options" onClick={run(() => openLayoutDialog("headerfooter"))}>
          Header &amp; footer options…
        </MenuItem>
        <MenuItem onClick={run(() => openLayoutDialog("pagenumbers"))}>Page numbers…</MenuItem>
      </Menu>
    </Dropdown>
  );
}
