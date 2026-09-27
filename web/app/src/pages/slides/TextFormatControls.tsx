// Toolbar controls for text formatting (M4). Buttons act on the text
// selection while a box is being edited (the toolbar keeps the editor's
// focus), else on the saved text selection, else on the selected boxes.

import { IconButton, Tooltip } from "@mui/joy";
import FormatStrikethroughIcon from "@mui/icons-material/FormatStrikethrough";
import SuperscriptIcon from "@mui/icons-material/Superscript";
import SubscriptIcon from "@mui/icons-material/Subscript";
import FormatAlignJustifyIcon from "@mui/icons-material/FormatAlignJustify";
import FormatIndentIncreaseIcon from "@mui/icons-material/FormatIndentIncrease";
import FormatIndentDecreaseIcon from "@mui/icons-material/FormatIndentDecrease";
import FormatPaintIcon from "@mui/icons-material/FormatPaint";
import FormatClearIcon from "@mui/icons-material/FormatClear";
import TextIncreaseIcon from "@mui/icons-material/TextIncrease";
import TextDecreaseIcon from "@mui/icons-material/TextDecrease";
import InsertLinkIcon from "@mui/icons-material/InsertLink";
import { FONT_FAMILIES, type SlideElement, type TextAlign } from "./model";
import type { TextToggle } from "./keymap";
import { BULLET_CHARS, NUMBER_SCHEMES } from "./textOps";
import { CASE_MODES, type CaseMode } from "../../lib/textCase";

/** Text commands shared by the toolbar, menus and shortcuts. */
export interface TextCommands {
  toggle: (k: TextToggle) => void;
  fontStep: (dir: 1 | -1) => void;
  setFontSize: (px: number) => void;
  setFontFamily: (f: string) => void;
  setColor: (c: string) => void;
  align: (a: TextAlign) => void;
  valign: (v: "top" | "middle" | "bottom") => void;
  indent: (d: 1 | -1) => void;
  /** Turn a list on with a style (bullet char / numbering scheme), or off. */
  list: (kind: "bullet" | "number" | null, style?: string) => void;
  changeCase: (m: CaseMode) => void;
  clearFormat: () => void;
  /** Paint format: capture (arm) or, when armed, disarm. */
  paintFormat: () => void;
  painting: boolean;
  link: () => void;
  findReplace: () => void;
  specialChars: () => void;
  textOptions: () => void;
  setAutofit: (on: boolean) => void;
  setDirection: (d: "ltr" | "rtl" | "vert" | "vert270") => void;
}

const selStyle: React.CSSProperties = { marginLeft: 4, maxWidth: 120, fontSize: 12 };

export function TextFormatControls({ el, cmd }: { el: SlideElement | undefined; cmd: TextCommands }) {
  if (!el || el.type !== "text") return null;
  const btn = (title: string, icon: React.ReactNode, onClick: () => void, on = false) => (
    <Tooltip title={title}>
      <IconButton size="sm" variant={on ? "soft" : "plain"} aria-label={title} onClick={onClick}>
        {icon}
      </IconButton>
    </Tooltip>
  );
  return (
    <>
      <select
        aria-label="Font"
        title="Font"
        value={el.fontFamily || "Arial"}
        onChange={(e) => cmd.setFontFamily(e.target.value)}
        style={selStyle}
      >
        {[...new Set([...FONT_FAMILIES, el.fontFamily || "Arial"])].map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      {btn("Decrease font size (Ctrl+[)", <TextDecreaseIcon />, () => cmd.fontStep(-1))}
      <input
        type="number"
        min={1}
        max={400}
        value={el.fontSize || 18}
        onChange={(e) => Number(e.target.value) > 0 && cmd.setFontSize(Number(e.target.value))}
        style={{ width: 52 }}
        title="Font size"
        aria-label="Font size"
      />
      {btn("Increase font size (Ctrl+])", <TextIncreaseIcon />, () => cmd.fontStep(1))}
      <input
        type="color"
        value={el.color && /^#[0-9a-f]{6}/i.test(el.color) ? el.color.slice(0, 7) : "#202124"}
        onChange={(e) => cmd.setColor(e.target.value)}
        title="Text color"
        aria-label="Text color"
        style={{ marginLeft: 4 }}
      />
      {btn("Strikethrough (Alt+Shift+5)", <FormatStrikethroughIcon />, () => cmd.toggle("strike"), !!el.strike)}
      {btn("Superscript (Ctrl+.)", <SuperscriptIcon />, () => cmd.toggle("super"), el.baseline === "super")}
      {btn("Subscript (Ctrl+,)", <SubscriptIcon />, () => cmd.toggle("sub"), el.baseline === "sub")}
      {btn("Justify (Ctrl+J)", <FormatAlignJustifyIcon />, () => cmd.align("justify"), el.align === "justify")}
      <select
        aria-label="Vertical align"
        title="Vertical align"
        value={el.valign || "top"}
        onChange={(e) => cmd.valign(e.target.value as "top" | "middle" | "bottom")}
        style={selStyle}
      >
        <option value="top">Top</option>
        <option value="middle">Middle</option>
        <option value="bottom">Bottom</option>
      </select>
      <select
        aria-label="List style"
        title="Bullets and numbering"
        value={el.list ? `${el.list}:${el.bulletStyle ?? ""}` : ""}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return cmd.list(null);
          const [kind, style] = v.split(":");
          cmd.list(kind as "bullet" | "number", style || undefined);
        }}
        style={selStyle}
      >
        <option value="">No list</option>
        <option value="bullet:">• Bullets</option>
        {BULLET_CHARS.slice(1).map((c) => (
          <option key={c} value={`bullet:${c}`}>
            {c} Bullets
          </option>
        ))}
        <option value="number:">1. Numbers</option>
        {NUMBER_SCHEMES.slice(1).map((n) => (
          <option key={n.value} value={`number:${n.value}`}>
            {n.label}
          </option>
        ))}
      </select>
      {btn("Decrease indent (Shift+Tab)", <FormatIndentDecreaseIcon />, () => cmd.indent(-1))}
      {btn("Increase indent (Tab)", <FormatIndentIncreaseIcon />, () => cmd.indent(1))}
      <select
        aria-label="Change case"
        title="Change case"
        value=""
        onChange={(e) => e.target.value && cmd.changeCase(e.target.value as CaseMode)}
        style={selStyle}
      >
        <option value="">Aa</option>
        {CASE_MODES.map((m) => (
          <option key={m.mode} value={m.mode}>
            {m.label}
          </option>
        ))}
      </select>
      {btn("Paint format (Ctrl+Shift+C / Ctrl+Shift+V)", <FormatPaintIcon />, cmd.paintFormat, cmd.painting)}
      {btn("Clear formatting (Ctrl+Space)", <FormatClearIcon />, cmd.clearFormat)}
      {btn("Insert link (Ctrl+K)", <InsertLinkIcon />, cmd.link)}
    </>
  );
}
