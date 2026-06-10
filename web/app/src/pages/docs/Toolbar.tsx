import {
  Sheet,
  IconButton,
  Divider,
  Select,
  Option,
  Input,
  Dropdown,
  MenuButton,
  Menu,
  MenuItem,
  Box,
  Tooltip,
  Button,
  Chip,
} from "@mui/joy";
import SearchIcon from "@mui/icons-material/Search";
import EditNoteIcon from "@mui/icons-material/EditNote";
import VisibilityIcon from "@mui/icons-material/Visibility";
import FormatLineSpacingIcon from "@mui/icons-material/FormatLineSpacing";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import PrintIcon from "@mui/icons-material/Print";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import FormatColorTextIcon from "@mui/icons-material/FormatColorText";
import BorderColorIcon from "@mui/icons-material/BorderColor";
import LinkIcon from "@mui/icons-material/Link";
import ImageIcon from "@mui/icons-material/Image";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import FormatAlignJustifyIcon from "@mui/icons-material/FormatAlignJustify";
import ChecklistIcon from "@mui/icons-material/Checklist";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import FormatIndentDecreaseIcon from "@mui/icons-material/FormatIndentDecrease";
import FormatIndentIncreaseIcon from "@mui/icons-material/FormatIndentIncrease";
import FormatClearIcon from "@mui/icons-material/FormatClear";
import RemoveIcon from "@mui/icons-material/Remove";
import AddIcon from "@mui/icons-material/Add";
import type { Editor } from "@tiptap/react";

export type EditorMode = "editing" | "viewing";

interface ToolbarProps {
  editor: Editor | null;
  onOpenMenus: () => void;
  mode: EditorMode;
  onModeChange: (m: EditorMode) => void;
}

const FONTS = [
  "Arial",
  "Georgia",
  "Courier New",
  "Times New Roman",
  "Verdana",
  "Trebuchet MS",
  "Roboto",
];
const TEXT_COLORS = [
  "#000000",
  "#434343",
  "#666666",
  "#999999",
  "#b7b7b7",
  "#cccccc",
  "#ffffff",
  "#980000",
  "#ff0000",
  "#ff9900",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#4a86e8",
  "#0000ff",
  "#9900ff",
  "#ff00ff",
  "#3D5A80",
  "#2A9D8F",
  "#1D8348",
  "#D9A441",
  "#B8627D",
];
const HIGHLIGHTS = [
  "#fff475",
  "#ccff90",
  "#a7ffeb",
  "#cbf0f8",
  "#aecbfa",
  "#d7aefb",
  "#fdcfe8",
  "#e8eaed",
  "#ffd966",
];

const LINE_SPACINGS = ["1", "1.15", "1.5", "2", "2.5", "3"];

export function Toolbar({
  editor,
  onOpenMenus,
  mode,
  onModeChange,
}: ToolbarProps) {
  if (!editor) return null;

  const iconBtn = (
    active: boolean,
    onClick: () => void,
    label: string,
    icon: React.ReactNode,
  ) => (
    <Tooltip title={label} size="sm">
      <IconButton
        size="sm"
        variant={active ? "solid" : "plain"}
        color={active ? "primary" : "neutral"}
        aria-label={label}
        onClick={onClick}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );

  // Current paragraph style for the style <Select>.
  const styleValue = editor.isActive("heading", { level: 1 })
    ? "h1"
    : editor.isActive("heading", { level: 2 })
      ? "h2"
      : editor.isActive("heading", { level: 3 })
        ? "h3"
        : "p";

  const setStyle = (v: string | null) => {
    const c = editor.chain().focus();
    if (v === "p") c.setParagraph().run();
    else if (v) c.toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
  };

  const fontValue =
    (editor.getAttributes("textStyle").fontFamily as string) || "Arial";
  const curSize =
    parseInt(
      (editor.getAttributes("textStyle").fontSize as string) || "11",
      10,
    ) || 11;
  const setSize = (n: number) =>
    editor
      .chain()
      .focus()
      .setFontSize(`${Math.max(1, Math.min(96, n))}pt`)
      .run();

  const swatch = (color: string, onClick: () => void) => (
    <Box
      key={color}
      onClick={onClick}
      sx={{
        width: 18,
        height: 18,
        borderRadius: "3px",
        bgcolor: color,
        cursor: "pointer",
        border: "1px solid",
        borderColor: "neutral.outlinedBorder",
        "&:hover": { transform: "scale(1.15)" },
      }}
    />
  );

  const promptLink = () => {
    const prev = (editor.getAttributes("link").href as string) || "";
    const url = window.prompt("Link URL", prev);
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
  };
  const promptImage = () => {
    const url = window.prompt("Image URL");
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  return (
    <Sheet
      variant="soft"
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        px: 1,
        py: 0.5,
        borderRadius: "xl",
        mb: 2,
        flexWrap: { xs: "nowrap", md: "wrap" },
        overflowX: { xs: "auto", md: "visible" },
        WebkitOverflowScrolling: "touch",
        bgcolor: "background.level1",
      }}
    >
      <Tooltip title="Search the menus" size="sm">
        <Button
          size="sm"
          variant="plain"
          color="neutral"
          startDecorator={<SearchIcon />}
          onClick={onOpenMenus}
          sx={{ borderRadius: "xl", mr: 0.5 }}
        >
          Menus
        </Button>
      </Tooltip>
      <Divider orientation="vertical" sx={{ mx: 0.5 }} />

      {iconBtn(
        false,
        () => editor.chain().focus().undo().run(),
        "Undo",
        <UndoIcon />,
      )}
      {iconBtn(
        false,
        () => editor.chain().focus().redo().run(),
        "Redo",
        <RedoIcon />,
      )}
      {iconBtn(false, () => window.print(), "Print", <PrintIcon />)}

      <Divider orientation="vertical" sx={{ mx: 0.5 }} />

      <Select
        size="sm"
        value={styleValue}
        onChange={(_, v) => setStyle(v)}
        variant="plain"
        sx={{ minWidth: 120 }}
        aria-label="Paragraph style"
      >
        <Option value="p">Normal text</Option>
        <Option value="h1">Heading 1</Option>
        <Option value="h2">Heading 2</Option>
        <Option value="h3">Heading 3</Option>
      </Select>

      <Select
        size="sm"
        value={fontValue}
        variant="plain"
        sx={{ minWidth: 120 }}
        aria-label="Font"
        onChange={(_, v) => v && editor.chain().focus().setFontFamily(v).run()}
      >
        {FONTS.map((f) => (
          <Option key={f} value={f} sx={{ fontFamily: f }}>
            {f}
          </Option>
        ))}
      </Select>

      <Divider orientation="vertical" sx={{ mx: 0.5 }} />

      <Box sx={{ display: "flex", alignItems: "center" }}>
        <IconButton
          size="sm"
          variant="plain"
          aria-label="Decrease font size"
          onClick={() => setSize(curSize - 1)}
        >
          <RemoveIcon />
        </IconButton>
        <Input
          size="sm"
          value={String(curSize)}
          variant="outlined"
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n)) setSize(n);
          }}
          sx={{ width: 48, "--Input-minHeight": "30px" }}
          slotProps={{
            input: {
              "aria-label": "Font size",
              style: { textAlign: "center" },
            },
          }}
        />
        <IconButton
          size="sm"
          variant="plain"
          aria-label="Increase font size"
          onClick={() => setSize(curSize + 1)}
        >
          <AddIcon />
        </IconButton>
      </Box>

      <Divider orientation="vertical" sx={{ mx: 0.5 }} />

      {iconBtn(
        editor.isActive("bold"),
        () => editor.chain().focus().toggleBold().run(),
        "Bold",
        <FormatBoldIcon />,
      )}
      {iconBtn(
        editor.isActive("italic"),
        () => editor.chain().focus().toggleItalic().run(),
        "Italic",
        <FormatItalicIcon />,
      )}
      {iconBtn(
        editor.isActive("underline"),
        () => editor.chain().focus().toggleUnderline().run(),
        "Underline",
        <FormatUnderlinedIcon />,
      )}

      <Dropdown>
        <Tooltip title="Text color" size="sm">
          <MenuButton
            slots={{ root: IconButton }}
            slotProps={{
              root: {
                size: "sm",
                variant: "plain",
                "aria-label": "Text color",
              },
            }}
          >
            <FormatColorTextIcon />
          </MenuButton>
        </Tooltip>
        <Menu sx={{ p: 1 }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 18px)",
              gap: 0.5,
            }}
          >
            {TEXT_COLORS.map((c) =>
              swatch(c, () => editor.chain().focus().setColor(c).run()),
            )}
          </Box>
        </Menu>
      </Dropdown>

      <Dropdown>
        <Tooltip title="Highlight" size="sm">
          <MenuButton
            slots={{ root: IconButton }}
            slotProps={{
              root: {
                size: "sm",
                variant: "plain",
                "aria-label": "Highlight color",
              },
            }}
          >
            <BorderColorIcon />
          </MenuButton>
        </Tooltip>
        <Menu sx={{ p: 1 }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 18px)",
              gap: 0.5,
            }}
          >
            {HIGHLIGHTS.map((c) =>
              swatch(c, () =>
                editor.chain().focus().toggleHighlight({ color: c }).run(),
              ),
            )}
          </Box>
        </Menu>
      </Dropdown>

      <Divider orientation="vertical" sx={{ mx: 0.5 }} />

      {iconBtn(
        editor.isActive("link"),
        promptLink,
        "Insert link",
        <LinkIcon />,
      )}
      {iconBtn(false, promptImage, "Insert image", <ImageIcon />)}

      <Divider orientation="vertical" sx={{ mx: 0.5 }} />

      {iconBtn(
        editor.isActive({ textAlign: "left" }),
        () => editor.chain().focus().setTextAlign("left").run(),
        "Align left",
        <FormatAlignLeftIcon />,
      )}
      {iconBtn(
        editor.isActive({ textAlign: "center" }),
        () => editor.chain().focus().setTextAlign("center").run(),
        "Align center",
        <FormatAlignCenterIcon />,
      )}
      {iconBtn(
        editor.isActive({ textAlign: "right" }),
        () => editor.chain().focus().setTextAlign("right").run(),
        "Align right",
        <FormatAlignRightIcon />,
      )}
      {iconBtn(
        editor.isActive({ textAlign: "justify" }),
        () => editor.chain().focus().setTextAlign("justify").run(),
        "Justify",
        <FormatAlignJustifyIcon />,
      )}

      <Divider orientation="vertical" sx={{ mx: 0.5 }} />

      <Dropdown>
        <Tooltip title="Line & paragraph spacing" size="sm">
          <MenuButton
            slots={{ root: IconButton }}
            slotProps={{
              root: {
                size: "sm",
                variant: "plain",
                "aria-label": "Line spacing",
              },
            }}
          >
            <FormatLineSpacingIcon />
          </MenuButton>
        </Tooltip>
        <Menu size="sm">
          {LINE_SPACINGS.map((s) => (
            <MenuItem
              key={s}
              onClick={() => editor.chain().focus().setLineHeight(s).run()}
            >
              {s}
            </MenuItem>
          ))}
          <MenuItem
            onClick={() => editor.chain().focus().unsetLineHeight().run()}
          >
            Reset
          </MenuItem>
        </Menu>
      </Dropdown>

      {iconBtn(
        editor.isActive("taskList"),
        () => editor.chain().focus().toggleTaskList().run(),
        "Checklist",
        <ChecklistIcon />,
      )}
      {iconBtn(
        editor.isActive("bulletList"),
        () => editor.chain().focus().toggleBulletList().run(),
        "Bulleted list",
        <FormatListBulletedIcon />,
      )}
      {iconBtn(
        editor.isActive("orderedList"),
        () => editor.chain().focus().toggleOrderedList().run(),
        "Numbered list",
        <FormatListNumberedIcon />,
      )}
      {iconBtn(
        false,
        () => editor.chain().focus().liftListItem("listItem").run(),
        "Decrease indent",
        <FormatIndentDecreaseIcon />,
      )}
      {iconBtn(
        false,
        () => editor.chain().focus().sinkListItem("listItem").run(),
        "Increase indent",
        <FormatIndentIncreaseIcon />,
      )}

      <Divider orientation="vertical" sx={{ mx: 0.5 }} />

      {iconBtn(
        false,
        () => editor.chain().focus().clearNodes().unsetAllMarks().run(),
        "Clear formatting",
        <FormatClearIcon />,
      )}

      {/* Right-justified editing-mode control, like Google's top-right cluster. */}
      <Box sx={{ flex: 1 }} />
      <Dropdown>
        <Tooltip title="Mode" size="sm">
          <MenuButton
            slots={{ root: Chip }}
            slotProps={{
              root: {
                variant: "soft",
                color: mode === "editing" ? "primary" : "neutral",
                startDecorator:
                  mode === "editing" ? <EditNoteIcon /> : <VisibilityIcon />,
              },
            }}
          >
            {mode === "editing" ? "Editing" : "Viewing"}
          </MenuButton>
        </Tooltip>
        <Menu size="sm">
          <MenuItem
            selected={mode === "editing"}
            onClick={() => onModeChange("editing")}
          >
            <EditNoteIcon /> Editing
          </MenuItem>
          <MenuItem
            selected={mode === "viewing"}
            onClick={() => onModeChange("viewing")}
          >
            <VisibilityIcon /> Viewing
          </MenuItem>
        </Menu>
      </Dropdown>
    </Sheet>
  );
}
