import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Sheet,
  Divider,
} from "@mui/joy";
import { shortcutGroups } from "./shortcuts";
import { useShortcutScheme } from "../../lib/shortcutScheme";
import { ShortcutSchemeSwitch } from "../../components/ShortcutSchemeSwitch";

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** ShortcutsDialog is the Help → Keyboard shortcuts overlay (Ctrl+/). It
 *  lists the active scheme's chords and switches the scheme. */
export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  const scheme = useShortcutScheme("docs");
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
        <ShortcutSchemeSwitch app="docs" />
        <Divider sx={{ my: 2 }} />
        <Box
          data-testid="docs-shortcuts"
          data-scheme={scheme}
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 2,
          }}
        >
          {shortcutGroups(scheme).map((g) => (
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
