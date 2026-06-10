import { Box, Typography } from "@mui/joy";
import type { CalendarEvent } from "./types";
import {
  DOW,
  monthGrid,
  isToday,
  fmtTime,
  startOfDay,
  addDays,
} from "./dateutils";

/** Returns a background color for a calendar item, accounting for item_type. */
function itemBgColor(e: CalendarEvent): string {
  switch (e.item_type) {
    case "task":
      return e.color || "#0f9d58"; // green-ish for tasks
    case "out_of_office":
      return e.color || "#e67c73"; // red-ish for OOO
    case "focus_time":
      return e.color || "#f6bf26"; // amber for focus
    default:
      return e.color || "#1a73e8";
  }
}

/** Returns a short label suffix to distinguish non-event types. */
function itemTypeLabel(e: CalendarEvent): string {
  switch (e.item_type) {
    case "task":
      return e.task_done ? " ✓" : " ☐";
    case "out_of_office":
      return " [OOO]";
    case "focus_time":
      return " [Focus]";
    default:
      return "";
  }
}

/** Returns border/pattern style for non-event items. */
function itemBoxStyle(e: CalendarEvent): object {
  if (e.item_type === "out_of_office") {
    return {
      backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.15) 4px, rgba(255,255,255,0.15) 8px)`,
    };
  }
  if (e.item_type === "focus_time") {
    return { border: "2px solid", borderColor: "rgba(255,255,255,0.5)" };
  }
  return {};
}

function evStart(e: CalendarEvent): Date {
  return new Date(e.start_at);
}
function evEnd(e: CalendarEvent): Date {
  return new Date(e.end_at);
}
// Recurring events expand into multiple instances that share an id; key on the
// id + occurrence start so React keys stay unique within a render.
function evKey(e: CalendarEvent): string {
  return `${e.id}@${e.start_at}`;
}
function onDay(e: CalendarEvent, day: Date): boolean {
  const s = startOfDay(evStart(e)).getTime();
  const en = evEnd(e).getTime();
  const d0 = startOfDay(day).getTime();
  const d1 = addDays(startOfDay(day), 1).getTime();
  return s < d1 && en > d0;
}

// ---- Month view ----
export function MonthView({
  date,
  events,
  onDayClick,
  onEventClick,
}: {
  date: Date;
  events: CalendarEvent[];
  onDayClick: (d: Date) => void;
  onEventClick: (e: CalendarEvent) => void;
}) {
  const grid = monthGrid(date);
  return (
    <Box
      sx={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
        {DOW.map((d) => (
          <Typography
            key={d}
            level="body-xs"
            sx={{ textAlign: "center", py: 0.5, fontWeight: 600, opacity: 0.7 }}
          >
            {d}
          </Typography>
        ))}
      </Box>
      <Box
        sx={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "repeat(7,1fr)",
          gridAutoRows: "1fr",
          border: "1px solid",
          borderColor: "divider",
          borderRight: 0,
          borderBottom: 0,
        }}
      >
        {grid.map((day, i) => {
          const inMonth = day.getMonth() === date.getMonth();
          const dayEvents = events
            .filter((e) => onDay(e, day))
            .sort((a, b) => evStart(a).getTime() - evStart(b).getTime());
          return (
            <Box
              key={i}
              onClick={() => onDayClick(day)}
              sx={{
                borderRight: "1px solid",
                borderBottom: "1px solid",
                borderColor: "divider",
                p: 0.5,
                minHeight: 92,
                bgcolor: inMonth ? "background.body" : "background.level1",
                cursor: "pointer",
                overflow: "hidden",
                "&:hover": { bgcolor: "background.level1" },
              }}
            >
              <Box sx={{ display: "flex", justifyContent: "center", mb: 0.25 }}>
                <Typography
                  level="body-xs"
                  sx={{
                    width: 22,
                    height: 22,
                    lineHeight: "22px",
                    textAlign: "center",
                    borderRadius: "50%",
                    fontWeight: isToday(day) ? 700 : 400,
                    opacity: inMonth ? 1 : 0.4,
                    bgcolor: isToday(day) ? "primary.500" : "transparent",
                    color: isToday(day) ? "#fff" : "inherit",
                  }}
                >
                  {day.getDate()}
                </Typography>
              </Box>
              {dayEvents.slice(0, 3).map((e) => (
                <Box
                  key={evKey(e)}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onEventClick(e);
                  }}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    px: 0.5,
                    py: "1px",
                    mb: "1px",
                    borderRadius: "sm",
                    bgcolor: e.all_day ? itemBgColor(e) : "transparent",
                    color: e.all_day ? "#fff" : "inherit",
                    cursor: "pointer",
                    "&:hover": {
                      bgcolor: e.all_day ? itemBgColor(e) : "background.level2",
                    },
                    ...itemBoxStyle(e),
                  }}
                >
                  {!e.all_day && (
                    <Box
                      sx={{
                        width: 7,
                        height: 7,
                        borderRadius: e.item_type === "task" ? "2px" : "50%",
                        bgcolor: itemBgColor(e),
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <Typography
                    level="body-xs"
                    noWrap
                    sx={{
                      flex: 1,
                      color: "inherit",
                      textDecoration:
                        e.item_type === "task" && e.task_done
                          ? "line-through"
                          : "none",
                      opacity: e.item_type === "task" && e.task_done ? 0.6 : 1,
                    }}
                  >
                    {!e.all_day && <b>{fmtTime(evStart(e))} </b>}
                    {e.title || "(no title)"}
                    {itemTypeLabel(e)}
                  </Typography>
                </Box>
              ))}
              {dayEvents.length > 3 && (
                <Typography level="body-xs" sx={{ opacity: 0.6, px: 0.5 }}>
                  +{dayEvents.length - 3} more
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ---- Week / Day time-grid view ----
const HOUR_H = 44;
export function TimeGridView({
  days,
  events,
  onSlotClick,
  onEventClick,
}: {
  days: Date[];
  events: CalendarEvent[];
  onSlotClick: (d: Date) => void;
  onEventClick: (e: CalendarEvent) => void;
}) {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <Box
      sx={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      {/* day headers */}
      <Box
        sx={{
          display: "flex",
          borderBottom: "1px solid",
          borderColor: "divider",
          pl: "52px",
        }}
      >
        {days.map((d, i) => (
          <Box key={i} sx={{ flex: 1, textAlign: "center", py: 0.5 }}>
            <Typography level="body-xs" sx={{ opacity: 0.7 }}>
              {DOW[d.getDay()]}
            </Typography>
            <Typography
              level="title-md"
              sx={{
                display: "inline-flex",
                width: 32,
                height: 32,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                bgcolor: isToday(d) ? "primary.500" : "transparent",
                color: isToday(d) ? "#fff" : "inherit",
              }}
            >
              {d.getDate()}
            </Typography>
          </Box>
        ))}
      </Box>
      {/* all-day strip */}
      <Box
        sx={{
          display: "flex",
          borderBottom: "1px solid",
          borderColor: "divider",
          minHeight: 24,
          pl: "52px",
        }}
      >
        {days.map((d, i) => (
          <Box
            key={i}
            sx={{
              flex: 1,
              borderLeft: i === 0 ? "none" : "1px solid",
              borderColor: "divider",
              p: "1px",
            }}
          >
            {events
              .filter((e) => e.all_day && onDay(e, d))
              .map((e) => (
                <Box
                  key={evKey(e)}
                  onClick={() => onEventClick(e)}
                  sx={{
                    bgcolor: itemBgColor(e),
                    color: "#fff",
                    borderRadius: "sm",
                    px: 0.5,
                    mb: "1px",
                    cursor: "pointer",
                    ...itemBoxStyle(e),
                  }}
                >
                  <Typography
                    level="body-xs"
                    noWrap
                    sx={{
                      color: "#fff",
                      textDecoration:
                        e.item_type === "task" && e.task_done
                          ? "line-through"
                          : "none",
                    }}
                  >
                    {e.title || "(no title)"}
                    {itemTypeLabel(e)}
                  </Typography>
                </Box>
              ))}
          </Box>
        ))}
      </Box>
      {/* scrollable hour grid */}
      <Box sx={{ flex: 1, overflowY: "auto" }}>
        <Box sx={{ display: "flex", position: "relative" }}>
          {/* hour labels */}
          <Box sx={{ width: 52, flexShrink: 0 }}>
            {hours.map((h) => (
              <Box key={h} sx={{ height: HOUR_H, position: "relative" }}>
                <Typography
                  level="body-xs"
                  sx={{ position: "absolute", top: -7, right: 6, opacity: 0.6 }}
                >
                  {h === 0
                    ? ""
                    : h < 12
                      ? `${h} AM`
                      : h === 12
                        ? "12 PM"
                        : `${h - 12} PM`}
                </Typography>
              </Box>
            ))}
          </Box>
          {/* day columns */}
          {days.map((day, di) => {
            const timed = events.filter((e) => !e.all_day && onDay(e, day));
            return (
              <Box
                key={di}
                sx={{
                  flex: 1,
                  position: "relative",
                  borderLeft: "1px solid",
                  borderColor: "divider",
                }}
              >
                {hours.map((h) => (
                  <Box
                    key={h}
                    onClick={() => {
                      const d = new Date(day);
                      d.setHours(h, 0, 0, 0);
                      onSlotClick(d);
                    }}
                    sx={{
                      height: HOUR_H,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      cursor: "pointer",
                      "&:hover": { bgcolor: "background.level1" },
                    }}
                  />
                ))}
                {timed.map((e) => {
                  const s = evStart(e),
                    en = evEnd(e);
                  const dayStart = startOfDay(day).getTime();
                  const top =
                    Math.max(0, (s.getTime() - dayStart) / 3600000) * HOUR_H;
                  const height = Math.max(
                    18,
                    ((en.getTime() - s.getTime()) / 3600000) * HOUR_H - 2,
                  );
                  return (
                    <Box
                      key={evKey(e)}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onEventClick(e);
                      }}
                      sx={{
                        position: "absolute",
                        left: 2,
                        right: 2,
                        top,
                        height,
                        bgcolor: itemBgColor(e),
                        color: "#fff",
                        borderRadius: "sm",
                        px: 0.5,
                        overflow: "hidden",
                        cursor: "pointer",
                        boxShadow: "xs",
                        zIndex: 1,
                        ...itemBoxStyle(e),
                      }}
                    >
                      <Typography
                        level="body-xs"
                        sx={{
                          color: "#fff",
                          fontWeight: 600,
                          textDecoration:
                            e.item_type === "task" && e.task_done
                              ? "line-through"
                              : "none",
                        }}
                        noWrap
                      >
                        {e.title || "(no title)"}
                        {itemTypeLabel(e)}
                      </Typography>
                      <Typography
                        level="body-xs"
                        sx={{ color: "#fff", opacity: 0.9 }}
                        noWrap
                      >
                        {fmtTime(s)}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
