import { useEffect, useState } from "react";
import {
  Box,
  Typography,
  IconButton,
  Checkbox,
  List,
  ListItem,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
} from "@mui/joy";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { MONTHS, monthGrid, addMonths, sameDay, isToday } from "./dateutils";

const MINI_DOW = ["S", "M", "T", "W", "T", "F", "S"];

/** MiniMonth is the small month navigator in the left pane. Clicking a day
 *  jumps the main view to that date; the month arrows browse independently. */
function MiniMonth({
  anchor,
  onPick,
}: {
  anchor: Date;
  onPick: (d: Date) => void;
}) {
  const [m, setM] = useState(
    new Date(anchor.getFullYear(), anchor.getMonth(), 1),
  );
  useEffect(() => {
    setM(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  }, [anchor]);
  const grid = monthGrid(m);
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
        <Typography level="title-sm" sx={{ flex: 1 }}>
          {MONTHS[m.getMonth()]} {m.getFullYear()}
        </Typography>
        <IconButton
          size="sm"
          variant="plain"
          onClick={() => setM(addMonths(m, -1))}
          aria-label="Previous month"
        >
          <ChevronLeftIcon />
        </IconButton>
        <IconButton
          size="sm"
          variant="plain"
          onClick={() => setM(addMonths(m, 1))}
          aria-label="Next month"
        >
          <ChevronRightIcon />
        </IconButton>
      </Box>
      <Box
        sx={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 0 }}
      >
        {MINI_DOW.map((d, i) => (
          <Typography
            key={i}
            level="body-xs"
            sx={{ textAlign: "center", opacity: 0.5, fontSize: 10 }}
          >
            {d}
          </Typography>
        ))}
        {grid.map((day, i) => {
          const inMonth = day.getMonth() === m.getMonth();
          const selected = sameDay(day, anchor);
          const today = isToday(day);
          return (
            <Box
              key={i}
              component="button"
              onClick={() => onPick(day)}
              sx={{
                all: "unset",
                cursor: "pointer",
                textAlign: "center",
                py: "2px",
                borderRadius: "50%",
                fontSize: 11,
                lineHeight: "20px",
                height: 24,
                width: 24,
                mx: "auto",
                display: "block",
                color: today
                  ? "#fff"
                  : inMonth
                    ? "text.primary"
                    : "text.tertiary",
                bgcolor: today
                  ? "primary.500"
                  : selected
                    ? "primary.softBg"
                    : "transparent",
                "&:hover": {
                  bgcolor: today ? "primary.600" : "background.level2",
                },
              }}
            >
              {day.getDate()}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export interface CalendarToggle {
  id: string;
  name: string;
  color: string;
  checked: boolean;
  disabled?: boolean;
  removable?: boolean;
}

interface CalendarSidebarProps {
  anchor: Date;
  onPickDate: (d: Date) => void;
  calendars: CalendarToggle[];
  otherCalendars: CalendarToggle[];
  onToggle: (id: string) => void;
  onAddOther: () => void;
  onRemove: (id: string) => void;
}

/** CalendarSidebar mirrors Google Calendar's left pane: mini-month navigator +
 *  "My calendars" / "Other calendars" with visibility checkboxes. */
export function CalendarSidebar({
  anchor,
  onPickDate,
  calendars,
  otherCalendars,
  onToggle,
  onAddOther,
  onRemove,
}: CalendarSidebarProps) {
  const section = (
    title: string,
    items: CalendarToggle[],
    action?: React.ReactNode,
  ) => (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", px: 1, mb: 0.5 }}>
        <Typography level="body-sm" sx={{ flex: 1, fontWeight: 600 }}>
          {title}
        </Typography>
        {action}
      </Box>
      <List size="sm" sx={{ "--ListItem-minHeight": "30px" }}>
        {items.map((c) => (
          <ListItem
            key={c.id}
            sx={{ "&:hover .cal-actions": { opacity: 1 } }}
            endAction={
              <Dropdown>
                <MenuButton
                  className="cal-actions"
                  slots={{ root: IconButton }}
                  slotProps={{
                    root: {
                      size: "sm",
                      variant: "plain",
                      sx: { opacity: { xs: 1, md: 0 } },
                      "aria-label": `Options for ${c.name}`,
                    },
                  }}
                >
                  <MoreVertIcon />
                </MenuButton>
                <Menu size="sm" placement="bottom-end">
                  <MenuItem onClick={() => onToggle(c.id)}>
                    {c.checked ? "Hide from list" : "Show on calendar"}
                  </MenuItem>
                  {c.removable && (
                    <MenuItem color="danger" onClick={() => onRemove(c.id)}>
                      Remove from list
                    </MenuItem>
                  )}
                </Menu>
              </Dropdown>
            }
          >
            <Checkbox
              size="sm"
              checked={c.checked}
              onChange={() => onToggle(c.id)}
              label={c.name}
              slotProps={{
                checkbox: {
                  sx: {
                    "--Checkbox-size": "16px",
                    color: c.color,
                    "&.Mui-checked": { bgcolor: c.color, borderColor: c.color },
                  },
                },
              }}
              sx={{
                "& .MuiCheckbox-checkbox": {
                  bgcolor: c.checked ? c.color : "transparent",
                  borderColor: c.color,
                },
              }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Box
      sx={{
        width: { xs: "100%", md: 232 },
        flexShrink: 0,
        pr: { xs: 0, md: 2 },
        overflowY: "auto",
      }}
    >
      <MiniMonth anchor={anchor} onPick={onPickDate} />
      {section("My calendars", calendars)}
      {section(
        "Other calendars",
        otherCalendars,
        <IconButton
          size="sm"
          variant="plain"
          aria-label="Add other calendars"
          onClick={onAddOther}
        >
          <AddIcon />
        </IconButton>,
      )}
    </Box>
  );
}
