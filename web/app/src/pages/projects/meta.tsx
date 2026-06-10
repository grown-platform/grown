// Visual metadata for issue status, priority, and project state — the colored
// glyphs Linear uses throughout its list/board/detail surfaces.
import type { ReactNode } from "react";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import DonutLargeIcon from "@mui/icons-material/DonutLarge";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import DragHandleIcon from "@mui/icons-material/DragHandle";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import SignalCellularAltIcon from "@mui/icons-material/SignalCellularAlt";
import SignalCellularAlt2BarIcon from "@mui/icons-material/SignalCellularAlt2Bar";
import SignalCellularAlt1BarIcon from "@mui/icons-material/SignalCellularAlt1Bar";

export interface StatusMeta {
  value: string;
  label: string;
  color: string;
  icon: (size?: number) => ReactNode;
}

// Order is the display/grouping order in list & board views.
export const STATUSES: StatusMeta[] = [
  {
    value: "backlog",
    label: "Backlog",
    color: "#bec2c8",
    icon: (s = 16) => (
      <CircleOutlinedIcon sx={{ fontSize: s, color: "#bec2c8" }} />
    ),
  },
  {
    value: "todo",
    label: "Todo",
    color: "#e2e2e2",
    icon: (s = 16) => (
      <RadioButtonUncheckedIcon sx={{ fontSize: s, color: "#8a8f98" }} />
    ),
  },
  {
    value: "in_progress",
    label: "In Progress",
    color: "#f2c94c",
    icon: (s = 16) => <DonutLargeIcon sx={{ fontSize: s, color: "#f2c94c" }} />,
  },
  {
    value: "done",
    label: "Done",
    color: "#5e6ad2",
    icon: (s = 16) => (
      <CheckCircleIcon sx={{ fontSize: s, color: "#5e6ad2" }} />
    ),
  },
  {
    value: "canceled",
    label: "Canceled",
    color: "#95a2b3",
    icon: (s = 16) => <CancelIcon sx={{ fontSize: s, color: "#95a2b3" }} />,
  },
];

export const statusMeta = (v: string): StatusMeta =>
  STATUSES.find((s) => s.value === v) ?? STATUSES[0];

export interface PriorityMeta {
  value: number;
  label: string;
  color: string;
  icon: (size?: number) => ReactNode;
}

// 0 none, 1 urgent, 2 high, 3 medium, 4 low (Linear's numeric priority).
export const PRIORITIES: PriorityMeta[] = [
  {
    value: 0,
    label: "No priority",
    color: "#8a8f98",
    icon: (s = 16) => <DragHandleIcon sx={{ fontSize: s, color: "#8a8f98" }} />,
  },
  {
    value: 1,
    label: "Urgent",
    color: "#f2994a",
    icon: (s = 16) => (
      <WarningRoundedIcon sx={{ fontSize: s, color: "#f2994a" }} />
    ),
  },
  {
    value: 2,
    label: "High",
    color: "#5e6ad2",
    icon: (s = 16) => (
      <SignalCellularAltIcon sx={{ fontSize: s, color: "#5e6ad2" }} />
    ),
  },
  {
    value: 3,
    label: "Medium",
    color: "#5e6ad2",
    icon: (s = 16) => (
      <SignalCellularAlt2BarIcon sx={{ fontSize: s, color: "#5e6ad2" }} />
    ),
  },
  {
    value: 4,
    label: "Low",
    color: "#5e6ad2",
    icon: (s = 16) => (
      <SignalCellularAlt1BarIcon sx={{ fontSize: s, color: "#5e6ad2" }} />
    ),
  },
];

export const priorityMeta = (v: number): PriorityMeta =>
  PRIORITIES.find((p) => p.value === v) ?? PRIORITIES[0];

// Project lifecycle states.
export interface StateMeta {
  value: string;
  label: string;
  color: string;
}
export const PROJECT_STATES: StateMeta[] = [
  { value: "backlog", label: "Backlog", color: "#bec2c8" },
  { value: "planned", label: "Planned", color: "#8a8f98" },
  { value: "started", label: "In Progress", color: "#f2c94c" },
  { value: "paused", label: "Paused", color: "#e2944a" },
  { value: "completed", label: "Completed", color: "#5e6ad2" },
  { value: "canceled", label: "Canceled", color: "#95a2b3" },
];
export const projectStateMeta = (v: string): StateMeta =>
  PROJECT_STATES.find((s) => s.value === v) ?? PROJECT_STATES[0];

// Label color palette (Linear-ish).
export const LABEL_COLORS = [
  "#eb5757",
  "#f2994a",
  "#f2c94c",
  "#6fcf97",
  "#56ccf2",
  "#2f80ed",
  "#9b51e0",
  "#bb6bd9",
  "#95a2b3",
  "#4cb782",
];

// Deterministic avatar color from a seed string.
const AVATAR_COLORS = [
  "#5e6ad2",
  "#e0777d",
  "#5b9279",
  "#c46b45",
  "#7a5980",
  "#2a9d8f",
  "#d9a441",
  "#1d8348",
  "#26b5ce",
  "#6c5ce7",
];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export function initials(name: string): string {
  const parts = (name || "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}
