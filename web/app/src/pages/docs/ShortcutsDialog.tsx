import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Sheet,
  Divider,
} from "@mui/joy";

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Common actions",
    items: [
      ["Copy", "Ctrl+C"],
      ["Cut", "Ctrl+X"],
      ["Paste", "Ctrl+V"],
      ["Paste without formatting", "Ctrl+Shift+V"],
      ["Undo", "Ctrl+Z"],
      ["Redo", "Ctrl+Y"],
      ["Find and replace", "Ctrl+H"],
      ["Print", "Ctrl+P"],
    ],
  },
  {
    title: "Text formatting",
    items: [
      ["Bold", "Ctrl+B"],
      ["Italic", "Ctrl+I"],
      ["Underline", "Ctrl+U"],
      ["Insert link", "Ctrl+K"],
      ["Increase font size", "Ctrl+Shift+."],
      ["Decrease font size", "Ctrl+Shift+,"],
      ["Clear formatting", "Ctrl+\\"],
    ],
  },
  {
    title: "Paragraph formatting",
    items: [
      ["Normal text", "Ctrl+Alt+0"],
      ["Heading 1–6", "Ctrl+Alt+1…6"],
      ["Align left", "Ctrl+Shift+L"],
      ["Center", "Ctrl+Shift+E"],
      ["Align right", "Ctrl+Shift+R"],
      ["Justify", "Ctrl+Shift+J"],
      ["Increase indent", "Ctrl+]"],
      ["Decrease indent", "Ctrl+["],
    ],
  },
  {
    title: "Menus & tools",
    items: [
      ["Search the menus", "Alt+/"],
      ["Keyboard shortcuts", "Ctrl+/"],
      ["Insert comment", "Ctrl+Alt+M"],
      ["Word count", "Ctrl+Shift+C"],
      ["Version history", "Ctrl+Alt+Shift+H"],
    ],
  },
];

/** ShortcutsDialog is the Help → Keyboard shortcuts overlay (Ctrl+/). */
export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          minWidth: 600,
          maxWidth: 760,
          maxHeight: "80vh",
          overflow: "auto",
        }}
      >
        <ModalClose />
        <Typography level="title-lg" sx={{ mb: 1 }}>
          Keyboard shortcuts
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 2,
          }}
        >
          {GROUPS.map((g) => (
            <Box key={g.title}>
              <Typography level="title-sm" sx={{ mb: 0.5 }}>
                {g.title}
              </Typography>
              {g.items.map(([label, keys]) => (
                <Box
                  key={label}
                  sx={{ display: "flex", alignItems: "center", py: 0.25 }}
                >
                  <Typography level="body-sm" sx={{ flex: 1 }}>
                    {label}
                  </Typography>
                  <Sheet
                    variant="soft"
                    sx={{
                      px: 0.75,
                      py: 0.25,
                      borderRadius: "sm",
                      fontSize: 12,
                      fontFamily: "monospace",
                    }}
                  >
                    {keys}
                  </Sheet>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </ModalDialog>
    </Modal>
  );
}
