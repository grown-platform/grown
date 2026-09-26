// StyleGallery is the toolbar's style picker (M3): paragraph and character
// styles with a preview of each, the style of the current selection (blank
// for mixed selections, as OnlyOffice shows), and style management —
// update from selection, new from selection, delete / restore defaults.
import { Dropdown, ListDivider, Menu, MenuButton, MenuItem, Typography } from "@mui/joy";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import type { Editor } from "@tiptap/react";
import {
  applyStyle,
  clearCharStyle,
  createStyleFromSelection,
  currentStyle,
  deleteStyle,
  getDocModel,
  updateStyleFromSelection,
} from "./docModel";
import { compileStyle, type StyleDef } from "./styles";

/** previewSx renders a style's look in the menu, scaled down. */
function previewSx(editor: Editor, s: StyleDef) {
  const { rPr, pPr } = compileStyle(getDocModel(editor).sheet, s.id);
  const pt = rPr.fontSize ?? 11;
  return {
    fontSize: `${Math.max(12, Math.min(20, pt * 1.15))}px`,
    fontWeight: rPr.bold ? 700 : 400,
    fontStyle: rPr.italic ? "italic" : "normal",
    textDecoration: rPr.underline ? "underline" : undefined,
    fontFamily: rPr.fontFamily,
    color: rPr.color,
    bgcolor: pPr.shading,
    textTransform: rPr.allCaps ? ("uppercase" as const) : undefined,
    fontVariant: rPr.smallCaps ? "small-caps" : undefined,
  };
}

export function StyleGallery({ editor }: { editor: Editor }) {
  const { sheet } = getDocModel(editor);
  const cur = currentStyle(editor);
  const para = sheet.all("paragraph");
  const chars = sheet.all("character");
  const customizedBuiltin = cur?.builtin && sheet.map.has(cur.id);

  const newStyle = () => {
    const name = window.prompt("New style name");
    if (!name) return;
    if (!createStyleFromSelection(editor, name)) window.alert(`A style named "${name}" already exists.`);
    editor.commands.focus();
  };

  return (
    <Dropdown>
      <MenuButton
        size="sm"
        variant="plain"
        endDecorator={<ArrowDropDownIcon />}
        aria-label="Paragraph style"
        data-testid="style-gallery"
        sx={{ minWidth: 132, justifyContent: "space-between", fontWeight: 400 }}
      >
        {cur?.name ?? " "}
      </MenuButton>
      <Menu size="sm" placement="bottom-start" sx={{ minWidth: 260, maxHeight: "70vh", overflow: "auto" }}>
        {para.map((s) => (
          <MenuItem
            key={s.id}
            selected={cur?.id === s.id}
            data-testid={`style-option-${s.id}`}
            onClick={() => {
              applyStyle(editor, s.id);
              editor.commands.focus();
            }}
            sx={previewSx(editor, s)}
          >
            {s.name}
          </MenuItem>
        ))}
        <ListDivider />
        <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.6 }}>
          Character styles
        </Typography>
        {chars.map((s) => (
          <MenuItem
            key={s.id}
            selected={cur?.id === s.id}
            data-testid={`style-option-${s.id}`}
            onClick={() => {
              applyStyle(editor, s.id);
              editor.commands.focus();
            }}
            sx={previewSx(editor, s)}
          >
            {s.name}
          </MenuItem>
        ))}
        <MenuItem
          onClick={() => {
            clearCharStyle(editor);
            editor.commands.focus();
          }}
        >
          Clear character style
        </MenuItem>
        <ListDivider />
        {cur && (
          <MenuItem
            data-testid="style-update"
            onClick={() => {
              updateStyleFromSelection(editor, cur.id);
              editor.commands.focus();
            }}
          >
            Update “{cur.name}” to match selection
          </MenuItem>
        )}
        <MenuItem data-testid="style-new" onClick={newStyle}>
          New style from selection…
        </MenuItem>
        {cur && !cur.builtin && (
          <MenuItem
            color="danger"
            onClick={() => {
              if (window.confirm(`Delete the style “${cur.name}”?`)) deleteStyle(editor, cur.id);
            }}
          >
            Delete “{cur.name}”
          </MenuItem>
        )}
        {customizedBuiltin && (
          <MenuItem onClick={() => deleteStyle(editor, cur!.id)}>Restore “{cur!.name}” defaults</MenuItem>
        )}
      </Menu>
    </Dropdown>
  );
}
