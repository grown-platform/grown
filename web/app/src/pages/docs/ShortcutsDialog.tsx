import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Sheet,
  Divider,
} from "@mui/joy";
import { SHORTCUT_GROUPS } from "./shortcuts";

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

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
          {SHORTCUT_GROUPS.map((g) => (
            <Box key={g.title}>
              <Typography level="title-sm" sx={{ mb: 0.5 }}>
                {g.title}
              </Typography>
              {g.items.map(({ label, keys, note }) => (
                <Box
                  key={label}
                  title={note ? `Grown binding (${note})` : undefined}
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
