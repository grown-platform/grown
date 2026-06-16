import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Divider,
} from "@mui/joy";

// A platform-wide keyboard-shortcut help overlay. Press "?" anywhere (outside a
// text field) to toggle it; it shows the shortcuts for the current app plus the
// global ones. Mounted once in App so every route gets it.

interface Shortcut {
  keys: string;
  desc: string;
}
interface Group {
  title: string;
  items: Shortcut[];
}

const GLOBAL: Group = {
  title: "Global",
  items: [
    { keys: "?", desc: "Show this help" },
    { keys: "Esc", desc: "Close dialog / exit full screen" },
  ],
};

// Per-app shortcut groups, matched by route prefix.
const BY_APP: { match: string; group: Group }[] = [
  {
    match: "/docs",
    group: {
      title: "Docs",
      items: [
        { keys: "Ctrl/⌘ B", desc: "Bold" },
        { keys: "Ctrl/⌘ I", desc: "Italic" },
        { keys: "Ctrl/⌘ U", desc: "Underline" },
        { keys: "Ctrl/⌘ K", desc: "Insert link" },
        { keys: "Ctrl/⌘ Z", desc: "Undo" },
        { keys: "Ctrl/⌘ Shift Z", desc: "Redo" },
        { keys: "Ctrl/⌘ /", desc: "All editor shortcuts" },
      ],
    },
  },
  {
    match: "/sheets",
    group: {
      title: "Sheets",
      items: [
        { keys: "Ctrl/⌘ B", desc: "Bold" },
        { keys: "Ctrl/⌘ Z", desc: "Undo" },
        { keys: "Ctrl/⌘ C / V", desc: "Copy / paste" },
        { keys: "Ctrl/⌘ F", desc: "Find" },
        { keys: "Ctrl/⌘ \\", desc: "Clear formatting" },
      ],
    },
  },
  {
    match: "/slides",
    group: {
      title: "Slides",
      items: [
        { keys: "Ctrl/⌘ B / I / U", desc: "Bold / italic / underline" },
        { keys: "Ctrl/⌘ D", desc: "Duplicate element" },
        { keys: "Ctrl/⌘ K", desc: "Insert link" },
        { keys: "Delete", desc: "Remove selected element" },
        { keys: "Esc", desc: "Exit slideshow" },
      ],
    },
  },
  {
    match: "/drive",
    group: {
      title: "Drive",
      items: [
        { keys: "Enter", desc: "Open" },
        { keys: "Delete", desc: "Move to trash" },
        { keys: "F2", desc: "Rename" },
      ],
    },
  },
];

export function KeyboardHelpOverlay() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);
      if (typing) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  const appGroup = BY_APP.find((a) => loc.pathname.startsWith(a.match))?.group;
  const groups = appGroup ? [appGroup, GLOBAL] : [GLOBAL];

  return (
    <Modal open onClose={() => setOpen(false)}>
      <ModalDialog sx={{ maxWidth: 460, width: "92vw" }}>
        <ModalClose />
        <Typography level="h4" sx={{ mb: 1 }}>
          Keyboard shortcuts
        </Typography>
        {groups.map((g, gi) => (
          <Box key={g.title} sx={{ mb: 1.5 }}>
            {gi > 0 && <Divider sx={{ my: 1 }} />}
            <Typography
              level="body-xs"
              sx={{
                textTransform: "uppercase",
                letterSpacing: 0.5,
                opacity: 0.6,
                mb: 0.5,
              }}
            >
              {g.title}
            </Typography>
            {g.items.map((s) => (
              <Box
                key={s.desc}
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  py: 0.25,
                  gap: 2,
                }}
              >
                <Typography level="body-sm">{s.desc}</Typography>
                <Typography
                  level="body-xs"
                  sx={{
                    fontFamily: "monospace",
                    bgcolor: "background.level1",
                    px: 0.75,
                    py: 0.25,
                    borderRadius: "sm",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.keys}
                </Typography>
              </Box>
            ))}
          </Box>
        ))}
      </ModalDialog>
    </Modal>
  );
}
