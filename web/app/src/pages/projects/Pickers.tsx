// Reusable dropdown pickers for issue properties — mirrors Linear's status /
// priority / assignee / project / label pickers used in rows and the detail panel.
import type { ReactNode } from "react";
import {
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  Box,
  Avatar,
  Typography,
  Checkbox,
  Chip,
} from "@mui/joy";
import CheckIcon from "@mui/icons-material/Check";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import {
  STATUSES,
  PRIORITIES,
  statusMeta,
  priorityMeta,
  avatarColor,
  initials,
} from "./meta";
import type { Member, Project, Label } from "./types";

const triggerSx = {
  cursor: "pointer",
  border: "none",
  background: "transparent",
  p: 0.5,
  borderRadius: "6px",
  display: "inline-flex",
  alignItems: "center",
  gap: 0.75,
  minHeight: 0,
  "&:hover": { background: "var(--joy-palette-neutral-100)" },
} as const;

function Trigger({ children }: { children: ReactNode }) {
  return (
    <MenuButton slots={{ root: Box }} slotProps={{ root: { sx: triggerSx } }}>
      {children}
    </MenuButton>
  );
}

export function StatusPicker({
  value,
  onChange,
  showLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  showLabel?: boolean;
}) {
  const m = statusMeta(value);
  return (
    <Dropdown>
      <Trigger>
        {m.icon(16)}
        {showLabel && <Typography level="body-sm">{m.label}</Typography>}
      </Trigger>
      <Menu size="sm" placement="bottom-start" sx={{ minWidth: 200 }}>
        {STATUSES.map((s) => (
          <MenuItem
            key={s.value}
            onClick={() => onChange(s.value)}
            selected={s.value === value}
          >
            {s.icon(16)}
            <Typography level="body-sm" sx={{ flex: 1 }}>
              {s.label}
            </Typography>
            {s.value === value && <CheckIcon sx={{ fontSize: 15 }} />}
          </MenuItem>
        ))}
      </Menu>
    </Dropdown>
  );
}

export function PriorityPicker({
  value,
  onChange,
  showLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  showLabel?: boolean;
}) {
  const m = priorityMeta(value);
  return (
    <Dropdown>
      <Trigger>
        {m.icon(16)}
        {showLabel && <Typography level="body-sm">{m.label}</Typography>}
      </Trigger>
      <Menu size="sm" placement="bottom-start" sx={{ minWidth: 180 }}>
        {PRIORITIES.map((p) => (
          <MenuItem
            key={p.value}
            onClick={() => onChange(p.value)}
            selected={p.value === value}
          >
            {p.icon(16)}
            <Typography level="body-sm" sx={{ flex: 1 }}>
              {p.label}
            </Typography>
            {p.value === value && <CheckIcon sx={{ fontSize: 15 }} />}
          </MenuItem>
        ))}
      </Menu>
    </Dropdown>
  );
}

export function AssigneePicker({
  members,
  value,
  onChange,
  showLabel,
}: {
  members: Member[];
  value: string;
  onChange: (v: string) => void;
  showLabel?: boolean;
}) {
  const cur = members.find((m) => m.id === value);
  return (
    <Dropdown>
      <Trigger>
        {cur ? (
          <Avatar
            sx={{
              "--Avatar-size": "20px",
              bgcolor: avatarColor(cur.id),
              fontSize: 10,
            }}
          >
            {initials(cur.name)}
          </Avatar>
        ) : (
          <PersonOutlineIcon sx={{ fontSize: 18, color: "#8a8f98" }} />
        )}
        {showLabel && (
          <Typography level="body-sm">
            {cur ? cur.name : "Unassigned"}
          </Typography>
        )}
      </Trigger>
      <Menu
        size="sm"
        placement="bottom-start"
        sx={{ minWidth: 220, maxHeight: 320, overflow: "auto" }}
      >
        <MenuItem onClick={() => onChange("")} selected={!value}>
          <PersonOutlineIcon sx={{ fontSize: 18, color: "#8a8f98" }} />
          <Typography level="body-sm" sx={{ flex: 1 }}>
            Unassigned
          </Typography>
          {!value && <CheckIcon sx={{ fontSize: 15 }} />}
        </MenuItem>
        {members.map((m) => (
          <MenuItem
            key={m.id}
            onClick={() => onChange(m.id)}
            selected={m.id === value}
          >
            <Avatar
              sx={{
                "--Avatar-size": "20px",
                bgcolor: avatarColor(m.id),
                fontSize: 10,
              }}
            >
              {initials(m.name)}
            </Avatar>
            <Typography level="body-sm" sx={{ flex: 1 }}>
              {m.name}
            </Typography>
            {m.id === value && <CheckIcon sx={{ fontSize: 15 }} />}
          </MenuItem>
        ))}
      </Menu>
    </Dropdown>
  );
}

export function ProjectPicker({
  projects,
  value,
  onChange,
  showLabel,
}: {
  projects: Project[];
  value: string;
  onChange: (v: string) => void;
  showLabel?: boolean;
}) {
  const cur = projects.find((p) => p.id === value);
  return (
    <Dropdown>
      <Trigger>
        <FolderOutlinedIcon
          sx={{ fontSize: 16, color: cur ? cur.color : "#8a8f98" }}
        />
        {showLabel && (
          <Typography level="body-sm">
            {cur ? cur.name : "No project"}
          </Typography>
        )}
      </Trigger>
      <Menu
        size="sm"
        placement="bottom-start"
        sx={{ minWidth: 220, maxHeight: 320, overflow: "auto" }}
      >
        <MenuItem onClick={() => onChange("")} selected={!value}>
          <FolderOutlinedIcon sx={{ fontSize: 16, color: "#8a8f98" }} />
          <Typography level="body-sm" sx={{ flex: 1 }}>
            No project
          </Typography>
          {!value && <CheckIcon sx={{ fontSize: 15 }} />}
        </MenuItem>
        {projects.map((p) => (
          <MenuItem
            key={p.id}
            onClick={() => onChange(p.id)}
            selected={p.id === value}
          >
            <FolderOutlinedIcon sx={{ fontSize: 16, color: p.color }} />
            <Typography level="body-sm" sx={{ flex: 1 }}>
              {p.name}
            </Typography>
            {p.id === value && <CheckIcon sx={{ fontSize: 15 }} />}
          </MenuItem>
        ))}
      </Menu>
    </Dropdown>
  );
}

export function LabelPicker({
  labels,
  value,
  onChange,
}: {
  labels: Label[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (id: string) => {
    onChange(
      value.includes(id) ? value.filter((x) => x !== id) : [...value, id],
    );
  };
  const selected = labels.filter((l) => value.includes(l.id));
  return (
    <Dropdown>
      <Trigger>
        <LabelOutlinedIcon sx={{ fontSize: 16, color: "#8a8f98" }} />
        {selected.length > 0 && (
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {selected.map((l) => (
              <Chip
                key={l.id}
                size="sm"
                variant="soft"
                sx={{
                  "--Chip-radius": "6px",
                  bgcolor: `${l.color}22`,
                  color: l.color,
                }}
              >
                {l.name}
              </Chip>
            ))}
          </Box>
        )}
      </Trigger>
      <Menu
        size="sm"
        placement="bottom-start"
        sx={{ minWidth: 220, maxHeight: 320, overflow: "auto" }}
      >
        {labels.length === 0 && (
          <MenuItem disabled>
            <Typography level="body-xs">No labels yet</Typography>
          </MenuItem>
        )}
        {labels.map((l) => (
          <MenuItem key={l.id} onClick={() => toggle(l.id)}>
            <Checkbox
              size="sm"
              checked={value.includes(l.id)}
              readOnly
              sx={{ pointerEvents: "none" }}
            />
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                bgcolor: l.color,
              }}
            />
            <Typography level="body-sm" sx={{ flex: 1 }}>
              {l.name}
            </Typography>
          </MenuItem>
        ))}
      </Menu>
    </Dropdown>
  );
}
