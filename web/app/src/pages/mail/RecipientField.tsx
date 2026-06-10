import { useRef, useState } from "react";
import { Box, Chip, Avatar, Sheet, List, ListItemButton, Typography } from "@mui/joy";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import AlternateEmailIcon from "@mui/icons-material/AlternateEmail";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

export interface Recipient {
  name?: string;
  email: string;
}

/** parseOne turns "Name <email>" or "email" into a Recipient. */
export function parseOne(raw: string): Recipient {
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2].trim() };
  return { email: raw.trim() };
}

/** parseRecipients splits a comma/semicolon-separated string into Recipients. */
export function parseRecipients(s: string): Recipient[] {
  if (!s) return [];
  return s
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(parseOne);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const display = (r: Recipient) => r.name || r.email;
const fullForm = (r: Recipient) => (r.name ? `${r.name} <${r.email}>` : r.email);

function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

interface MenuState {
  x: number;
  y: number;
  idx: number;
}

/**
 * RecipientField renders email recipients as Gmail-style pills. Typing an
 * address and pressing Enter / Tab / comma (or blurring) turns it into a pill.
 * Right-clicking a pill opens a context menu (Copy, Copy "<email>", Cut, Change
 * name, Change email address, More info).
 */
export function RecipientField({
  placeholder,
  value,
  onChange,
  autoFocus,
}: {
  placeholder: string;
  value: Recipient[];
  onChange: (v: Recipient[]) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(raw: string) {
    const t = raw.trim().replace(/[,;]+$/, "").trim();
    if (!t) return;
    onChange([...value, parseOne(t)]);
    setText("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "Tab" || e.key === "," || e.key === ";") {
      if (text.trim()) {
        e.preventDefault();
        commit(text);
      }
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function update(idx: number, patch: Partial<Recipient>) {
    onChange(value.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  const invalid = (r: Recipient) => !EMAIL_RE.test(r.email);

  return (
    <Box
      onClick={() => inputRef.current?.focus()}
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 0.5,
        py: 0.75,
        px: 1.25,
        minHeight: 40,
        cursor: "text",
      }}
    >
      {value.map((r, i) => (
        <Chip
          key={`${r.email}-${i}`}
          variant="soft"
          color={invalid(r) ? "danger" : "neutral"}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, idx: i });
          }}
          startDecorator={
            <Avatar size="sm" sx={{ "--Avatar-size": "20px", fontSize: 11 }}>
              {display(r).charAt(0).toUpperCase()}
            </Avatar>
          }
          endDecorator={
            <Box
              component="span"
              onClick={(e) => {
                e.stopPropagation();
                remove(i);
              }}
              sx={{ cursor: "pointer", display: "flex", px: 0.25, opacity: 0.6, "&:hover": { opacity: 1 } }}
              aria-label="Remove recipient"
            >
              ✕
            </Box>
          }
          sx={{ "--Chip-radius": "999px", maxWidth: "100%" }}
          title={fullForm(r)}
        >
          {display(r)}
        </Chip>
      ))}
      <Box
        component="input"
        ref={inputRef}
        autoFocus={autoFocus}
        value={text}
        placeholder={value.length === 0 ? placeholder : ""}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => text.trim() && commit(text)}
        onPaste={(e: React.ClipboardEvent<HTMLInputElement>) => {
          const pasted = e.clipboardData.getData("text");
          if (/[,;\n]/.test(pasted)) {
            e.preventDefault();
            const parts = parseRecipients(pasted);
            if (parts.length) onChange([...value, ...parts]);
          }
        }}
        sx={{
          flex: 1,
          minWidth: 120,
          border: "none",
          outline: "none",
          background: "transparent",
          font: "inherit",
          color: "inherit",
          py: 0.5,
        }}
      />

      {menu && (
        <RecipientMenu
          x={menu.x}
          y={menu.y}
          recipient={value[menu.idx]}
          onClose={() => setMenu(null)}
          onCopy={() => copy(fullForm(value[menu.idx]))}
          onCopyEmail={() => copy(value[menu.idx].email)}
          onCut={() => {
            copy(fullForm(value[menu.idx]));
            remove(menu.idx);
          }}
          onChangeName={() => {
            const next = window.prompt("Name", value[menu.idx].name || "");
            if (next !== null) update(menu.idx, { name: next.trim() || undefined });
          }}
          onChangeEmail={() => {
            const next = window.prompt("Email address", value[menu.idx].email);
            if (next !== null && next.trim()) update(menu.idx, { email: next.trim() });
          }}
        />
      )}
    </Box>
  );
}

function RecipientMenu({
  x,
  y,
  recipient,
  onClose,
  onCopy,
  onCopyEmail,
  onCut,
  onChangeName,
  onChangeEmail,
}: {
  x: number;
  y: number;
  recipient: Recipient;
  onClose: () => void;
  onCopy: () => void;
  onCopyEmail: () => void;
  onCut: () => void;
  onChangeName: () => void;
  onChangeEmail: () => void;
}) {
  // Keep the menu on-screen.
  const left = Math.min(x, window.innerWidth - 300);
  const top = Math.min(y, window.innerHeight - 280);

  const item = (
    icon: React.ReactNode,
    label: React.ReactNode,
    shortcut: string,
    action: () => void,
  ) => (
    <ListItemButton
      onClick={() => {
        action();
        onClose();
      }}
      sx={{ gap: 1.5, borderRadius: "sm", py: 0.75 }}
    >
      <Box sx={{ display: "flex", color: "text.tertiary" }}>{icon}</Box>
      <Typography level="body-sm" sx={{ flex: 1 }} noWrap>
        {label}
      </Typography>
      <Typography level="body-xs" sx={{ color: "text.tertiary", ml: 2 }}>
        {shortcut}
      </Typography>
    </ListItemButton>
  );

  return (
    <>
      {/* Backdrop closes the menu on any outside interaction. */}
      <Box
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        sx={{ position: "fixed", inset: 0, zIndex: 1300 }}
      />
      <Sheet
        variant="outlined"
        sx={{
          position: "fixed",
          left,
          top,
          zIndex: 1301,
          width: 288,
          borderRadius: "md",
          boxShadow: "lg",
          py: 0.5,
        }}
      >
        <List size="sm" sx={{ "--ListItem-paddingX": "10px" }}>
          {item(<ContentCopyIcon fontSize="small" />, "Copy", "⌘C", onCopy)}
          {item(
            <ContentCopyIcon fontSize="small" />,
            <>Copy &quot;{recipient.email}&quot;</>,
            "⌥C",
            onCopyEmail,
          )}
          {item(<ContentCutIcon fontSize="small" />, "Cut", "⌘X", onCut)}
          {item(
            <DriveFileRenameOutlineIcon fontSize="small" />,
            "Change name",
            "⇧E",
            onChangeName,
          )}
          {item(
            <AlternateEmailIcon fontSize="small" />,
            "Change email address",
            "⇧F",
            onChangeEmail,
          )}
          {item(
            <InfoOutlinedIcon fontSize="small" />,
            "More info",
            "⌥→",
            () =>
              window.alert(
                `${recipient.name ? recipient.name + "\n" : ""}${recipient.email}`,
              ),
          )}
        </List>
      </Sheet>
    </>
  );
}
