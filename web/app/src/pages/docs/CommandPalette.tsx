import { useMemo, useState } from "react";
import {
  Modal,
  ModalDialog,
  Input,
  List,
  ListItemButton,
  Typography,
  Chip,
  Box,
} from "@mui/joy";
import SearchIcon from "@mui/icons-material/Search";

export interface Command {
  label: string;
  section: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

/** CommandPalette is the toolbar's "Menus" search — type to filter every menu
 *  action and run it, mirroring Google Docs' searchable menus. */
export function CommandPalette({
  open,
  onClose,
  commands,
}: CommandPaletteProps) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? commands.filter(
          (c) =>
            c.label.toLowerCase().includes(t) ||
            c.section.toLowerCase().includes(t),
        )
      : commands;
    return list.slice(0, 50);
  }, [q, commands]);

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ minWidth: 460, maxHeight: "70vh", p: 1.5 }}>
        <Input
          autoFocus
          placeholder="Search the menus"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          startDecorator={<SearchIcon />}
          sx={{ mb: 1 }}
        />
        <List sx={{ overflow: "auto", "--ListItem-radius": "8px" }}>
          {filtered.map((c, i) => (
            <ListItemButton
              key={`${c.label}-${i}`}
              onClick={() => {
                c.run();
                onClose();
              }}
            >
              <Box sx={{ flex: 1 }}>{c.label}</Box>
              <Chip size="sm" variant="soft" color="neutral">
                {c.section}
              </Chip>
            </ListItemButton>
          ))}
          {filtered.length === 0 && (
            <Typography level="body-sm" sx={{ p: 2, opacity: 0.6 }}>
              No matching menu items
            </Typography>
          )}
        </List>
      </ModalDialog>
    </Modal>
  );
}
