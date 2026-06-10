// Global command palette (Cmd/Ctrl+K) — Linear's signature quick-action surface.
// Searches a static command list plus all issues; Enter runs the selection.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  ModalDialog,
  Input,
  List,
  ListItem,
  ListItemButton,
  Typography,
  Box,
  Chip,
} from "@mui/joy";
import SearchIcon from "@mui/icons-material/Search";
import { statusMeta } from "./meta";
import type { Issue } from "./types";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  issues,
  onOpenIssue,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  issues: Issue[];
  onOpenIssue: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const cmds = commands
      .filter((c) => !ql || c.label.toLowerCase().includes(ql))
      .map((c) => ({ kind: "cmd" as const, c }));
    const iss = issues
      .filter(
        (i) =>
          ql &&
          (i.title.toLowerCase().includes(ql) ||
            i.identifier.toLowerCase().includes(ql)),
      )
      .slice(0, 20)
      .map((i) => ({ kind: "issue" as const, i }));
    return [...cmds, ...iss];
  }, [q, commands, issues]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const exec = (idx: number) => {
    const r = results[idx];
    if (!r) return;
    if (r.kind === "cmd") r.c.run();
    else onOpenIssue(r.i.id);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: 600,
          maxWidth: "95vw",
          p: 0,
          overflow: "hidden",
          top: "15%",
          transform: "translate(-50%, 0)",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 2,
            py: 1.5,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <SearchIcon sx={{ color: "#8a8f98" }} />
          <Input
            slotProps={{ input: { ref: inputRef } }}
            variant="plain"
            placeholder="Type a command or search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                exec(active);
              }
            }}
            sx={{
              flex: 1,
              "--Input-focusedThickness": "0",
              "& input": { fontSize: 16 },
            }}
          />
        </Box>
        <List
          sx={{
            maxHeight: 380,
            overflow: "auto",
            "--ListItem-paddingY": "8px",
          }}
        >
          {results.length === 0 && (
            <ListItem>
              <Typography level="body-sm" sx={{ color: "#8a8f98" }}>
                No results
              </Typography>
            </ListItem>
          )}
          {results.map((r, idx) => (
            <ListItem key={r.kind === "cmd" ? r.c.id : r.i.id}>
              <ListItemButton
                selected={idx === active}
                onMouseEnter={() => setActive(idx)}
                onClick={() => exec(idx)}
              >
                {r.kind === "cmd" ? (
                  <>
                    <Box sx={{ display: "flex", color: "#8a8f98" }}>
                      {r.c.icon}
                    </Box>
                    <Typography level="body-sm" sx={{ flex: 1 }}>
                      {r.c.label}
                    </Typography>
                    {r.c.hint && (
                      <Chip size="sm" variant="soft">
                        {r.c.hint}
                      </Chip>
                    )}
                  </>
                ) : (
                  <>
                    {statusMeta(r.i.status).icon(16)}
                    <Typography
                      level="body-xs"
                      sx={{ color: "#8a8f98", width: 64, flexShrink: 0 }}
                    >
                      {r.i.identifier}
                    </Typography>
                    <Typography
                      level="body-sm"
                      sx={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.i.title}
                    </Typography>
                  </>
                )}
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </ModalDialog>
    </Modal>
  );
}
