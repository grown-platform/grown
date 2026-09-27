import { useMemo, useState } from "react";
import { Box, Divider, Input, Modal, ModalClose, ModalDialog, Sheet, Typography } from "@mui/joy";
import { SHEET_SHORTCUTS, SHORTCUT_GROUPS, displayCombo } from "./sheetShortcuts";

// Help ▸ Keyboard shortcuts (Ctrl+/): generated from the binding table the
// editor's key handler uses, so the list can't drift from what the keys do.

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function SheetShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SHORTCUT_GROUPS.map((g) => ({
      title: g,
      items: SHEET_SHORTCUTS.filter(
        (s) => s.group === g && (!needle || s.label.toLowerCase().includes(needle) || s.keys.some((k) => k.toLowerCase().includes(needle))),
      ),
    })).filter((g) => g.items.length);
  }, [q]);
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="sheet-shortcuts-title" sx={{ width: 760, maxWidth: "95vw", maxHeight: "85vh", overflow: "auto" }}>
        <ModalClose />
        <Typography id="sheet-shortcuts-title" level="title-lg">
          Keyboard shortcuts
        </Typography>
        <Input
          size="sm"
          placeholder="Search shortcuts"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          slotProps={{ input: { "aria-label": "Search shortcuts" } }}
          sx={{ my: 1 }}
        />
        <Divider />
        <Box
          sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, mt: 1 }}
          data-testid="sheet-shortcuts"
        >
          {groups.map((g) => (
            <Box key={g.title}>
              <Typography level="title-sm" sx={{ mb: 0.5 }}>
                {g.title}
              </Typography>
              {g.items.map((s) => (
                <Box key={s.id} data-shortcut={s.id} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}>
                  <Typography level="body-sm" sx={{ flex: 1 }}>
                    {s.label}
                  </Typography>
                  <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {s.keys.map((k) => (
                      <Sheet key={k} variant="soft" sx={{ px: 0.75, py: 0.25, borderRadius: "sm", fontSize: 12, fontFamily: "monospace" }}>
                        {displayCombo(k, isMac)}
                      </Sheet>
                    ))}
                  </Box>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </ModalDialog>
    </Modal>
  );
}
