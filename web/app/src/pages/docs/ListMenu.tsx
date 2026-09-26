// ListMenu is the toolbar's list library (M3): bullet, numbering and
// multilevel lists (numbering.ts LIST_LIBRARY), plus restart / continue /
// set value, list settings and "None".
import { useState } from "react";
import { Box, Dropdown, IconButton, ListDivider, Menu, MenuButton, MenuItem, Tooltip, Typography } from "@mui/joy";
import FormatListNumberedRtlIcon from "@mui/icons-material/FormatListNumberedRtl";
import type { Editor } from "@tiptap/react";
import {
  applyListPreset,
  continueNumbering,
  currentList,
  removeNumbering,
  restartNumbering,
} from "./docModel";
import { LIST_LIBRARY, levelText, type ListPreset } from "./numbering";
import { openParagraphDialog } from "./ParagraphDialogs";

/** Three preview lines for a preset: levels 1-3 with their labels. */
function previewLines(p: ListPreset): string[] {
  const lvls = p.lvls();
  if (p.kind !== "multilevel") return [0, 0, 0].map((_, i) => levelText(lvls, 0, [i + 1]));
  return [0, 1, 2].map((l) => `${"  ".repeat(l)}${levelText(lvls, l, [1, 1, 1])}`);
}

function Tile({ p, onPick }: { p: ListPreset; onPick: () => void }) {
  return (
    <Tooltip title={p.label} size="sm">
      <Box
        role="menuitem"
        tabIndex={0}
        data-testid={`list-preset-${p.id}`}
        onClick={onPick}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick()}
        sx={{
          width: p.kind === "multilevel" ? 112 : 64,
          height: 58,
          border: "1px solid",
          borderColor: "neutral.outlinedBorder",
          borderRadius: "sm",
          p: 0.5,
          cursor: "pointer",
          fontSize: 11,
          lineHeight: 1.45,
          overflow: "hidden",
          whiteSpace: "nowrap",
          "&:hover, &:focus-visible": { bgcolor: "background.level1", borderColor: "primary.outlinedBorder" },
        }}
      >
        {previewLines(p).map((l, i) => (
          <Box key={i} sx={{ display: "flex", gap: 0.5 }}>
            <span>{l}</span>
            <Box sx={{ flex: 1, height: 3, mt: "7px", bgcolor: "neutral.outlinedBorder", borderRadius: 2 }} />
          </Box>
        ))}
      </Box>
    </Tooltip>
  );
}

export function ListMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const inList = !!currentList(editor);
  const pick = (id: string) => {
    setOpen(false);
    applyListPreset(editor, id);
    editor.commands.focus();
  };
  const group = (kind: ListPreset["kind"], title: string) => (
    <>
      <Typography level="body-xs" sx={{ px: 1.5, pt: 1, opacity: 0.6 }}>
        {title}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, px: 1.5, py: 0.75, maxWidth: 320 }}>
        {LIST_LIBRARY.filter((p) => p.kind === kind).map((p) => (
          <Tile key={p.id} p={p} onPick={() => pick(p.id)} />
        ))}
      </Box>
    </>
  );
  return (
    <Dropdown open={open} onOpenChange={(_, o) => setOpen(o)}>
      <Tooltip title="List library" size="sm">
        <MenuButton slots={{ root: IconButton }} slotProps={{ root: { size: "sm", variant: "plain", "aria-label": "List library" } }}>
          <FormatListNumberedRtlIcon />
        </MenuButton>
      </Tooltip>
      <Menu size="sm" placement="bottom-start" sx={{ maxHeight: "75vh", overflow: "auto" }} data-testid="list-library">
        {group("bullet", "Bullets")}
        {group("number", "Numbering")}
        {group("multilevel", "Multilevel lists")}
        <ListDivider />
        <MenuItem disabled={!inList} onClick={() => removeNumbering(editor)}>
          None
        </MenuItem>
        <MenuItem disabled={!inList} onClick={() => restartNumbering(editor)}>
          Restart numbering
        </MenuItem>
        <MenuItem disabled={!inList} onClick={() => continueNumbering(editor)}>
          Continue numbering
        </MenuItem>
        <MenuItem disabled={!inList} onClick={() => openParagraphDialog("numberingValue")}>
          Set numbering value…
        </MenuItem>
        <MenuItem disabled={!inList} onClick={() => openParagraphDialog("listSettings")}>
          List settings…
        </MenuItem>
      </Menu>
    </Dropdown>
  );
}
