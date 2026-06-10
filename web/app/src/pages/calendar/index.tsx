import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Container,
  Typography,
  Button,
  IconButton,
  Dropdown,
  MenuButton,
  Menu,
  MenuItem,
  CircularProgress,
  Sheet,
  Drawer,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import MenuIcon from "@mui/icons-material/Menu";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { listEvents, createEvent, updateEvent, deleteEvent } from "./api";
import type { CalendarEvent, EventInput, ItemType } from "./types";
import { EventDialog } from "./EventDialog";
import { MonthView, TimeGridView } from "./views";
import { CalendarSidebar, type CalendarToggle } from "./CalendarSidebar";
import {
  MONTHS,
  DOW,
  addDays,
  addMonths,
  monthGrid,
  weekDays,
  startOfDay,
  startOfWeek,
} from "./dateutils";

type View = "day" | "week" | "month";

interface CalendarAppProps {
  user: User;
}

/** Returns true when window.innerWidth < 900. */
function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.innerWidth < 900);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 900);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile;
}

export default function CalendarApp({ user }: CalendarAppProps) {
  const isMobile = useMobile();
  // Default to day view on mobile, week on desktop
  const [view, setView] = useState<View>(() =>
    window.innerWidth < 900 ? "day" : "week",
  );
  const [anchor, setAnchor] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    event: CalendarEvent | null;
    slot?: Date;
    itemType?: ItemType;
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Left-pane calendars. The user's primary calendar controls event visibility;
  // additional calendars (Tasks/Birthdays/Holidays + any the user adds) are
  // toggleable named calendars, persisted in localStorage. Per-calendar event
  // association is a future enhancement (needs a backend calendars table).
  const CAL_PALETTE = [
    "#8e24aa",
    "#039be5",
    "#e67c73",
    "#f6bf26",
    "#33b679",
    "#7986cb",
    "#616161",
  ];
  const [toggles, setToggles] = useState<Record<string, boolean>>(() => {
    try {
      const s = localStorage.getItem("grown.calendar.toggles");
      if (s) return JSON.parse(s);
    } catch {
      /* ignore */
    }
    return { primary: true, tasks: true, birthdays: true, holidays: true };
  });
  const [customCals, setCustomCals] = useState<
    { id: string; name: string; color: string }[]
  >(() => {
    try {
      const s = localStorage.getItem("grown.calendar.custom");
      if (s) return JSON.parse(s);
    } catch {
      /* ignore */
    }
    return [];
  });
  useEffect(() => {
    try {
      localStorage.setItem("grown.calendar.toggles", JSON.stringify(toggles));
    } catch {
      /* ignore */
    }
  }, [toggles]);
  useEffect(() => {
    try {
      localStorage.setItem("grown.calendar.custom", JSON.stringify(customCals));
    } catch {
      /* ignore */
    }
  }, [customCals]);

  const userName = user.display_name || user.email;
  const checked = (id: string) => toggles[id] !== false;
  const calendars: CalendarToggle[] = [
    {
      id: "primary",
      name: userName,
      color: "#1a73e8",
      checked: checked("primary"),
    },
    { id: "tasks", name: "Tasks", color: "#33b679", checked: checked("tasks") },
    {
      id: "birthdays",
      name: "Birthdays",
      color: "#f4511e",
      checked: checked("birthdays"),
    },
  ];
  const otherCalendars: CalendarToggle[] = [
    {
      id: "holidays",
      name: "Holidays",
      color: "#8e24aa",
      checked: checked("holidays"),
    },
    ...customCals.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      checked: checked(c.id),
      removable: true,
    })),
  ];
  const onToggleCalendar = (id: string) =>
    setToggles((t) => ({ ...t, [id]: t[id] === false }));
  function onAddOther() {
    const name = window.prompt("Add a calendar (name):");
    if (!name || !name.trim()) return;
    const id = `cal-${name.trim().toLowerCase().replace(/\s+/g, "-")}-${customCals.length}`;
    const color = CAL_PALETTE[customCals.length % CAL_PALETTE.length];
    setCustomCals((c) => [...c, { id, name: name.trim(), color }]);
    setToggles((t) => ({ ...t, [id]: true }));
  }
  function onRemoveOther(id: string) {
    setCustomCals((c) => c.filter((x) => x.id !== id));
    setToggles((t) => {
      const n = { ...t };
      delete n[id];
      return n;
    });
  }

  const range = useMemo(() => {
    if (view === "month") {
      const g = monthGrid(anchor);
      return { from: g[0], to: addDays(g[41], 1) };
    }
    if (view === "day") {
      const s = startOfDay(anchor);
      return { from: s, to: addDays(s, 1) };
    }
    const s = startOfWeek(anchor);
    return { from: s, to: addDays(s, 7) };
  }, [view, anchor]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(
        await listEvents(range.from.toISOString(), range.to.toISOString()),
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);
  useEffect(() => {
    reload();
  }, [reload]);

  function navigate(dir: -1 | 0 | 1) {
    if (dir === 0) {
      setAnchor(new Date());
      return;
    }
    if (view === "month") setAnchor((a) => addMonths(a, dir));
    else if (view === "day") setAnchor((a) => addDays(a, dir));
    else setAnchor((a) => addDays(a, dir * 7));
  }

  const label = useMemo(() => {
    if (view === "month")
      return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
    if (view === "day")
      return `${DOW[anchor.getDay()]}, ${MONTHS[anchor.getMonth()]} ${anchor.getDate()}, ${anchor.getFullYear()}`;
    const w = weekDays(anchor, 7);
    const a = w[0],
      b = w[6];
    const moA = MONTHS[a.getMonth()].slice(0, 3),
      moB = MONTHS[b.getMonth()].slice(0, 3);
    return a.getMonth() === b.getMonth()
      ? `${moA} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`
      : `${moA} ${a.getDate()} – ${moB} ${b.getDate()}, ${b.getFullYear()}`;
  }, [view, anchor]);

  async function onSave(input: EventInput) {
    if (dialog?.event) await updateEvent(dialog.event.id, input);
    else await createEvent(input);
    await reload();
  }
  async function onDelete(id: string, scope?: number, originalStart?: string) {
    setEvents((cur) =>
      cur.filter((e) => e.id !== id && e.recurring_event_id !== id),
    );
    try {
      await deleteEvent(id, scope, originalStart);
    } catch {
      reload();
    }
  }

  const days = view === "month" ? [] : weekDays(anchor, view === "day" ? 1 : 7);
  const visibleEvents = checked("primary") ? events : [];

  const sidebarContent = (
    <CalendarSidebar
      anchor={anchor}
      onPickDate={(d) => {
        setAnchor(d);
        if (isMobile) setSidebarOpen(false);
      }}
      calendars={calendars}
      otherCalendars={otherCalendars}
      onToggle={onToggleCalendar}
      onAddOther={onAddOther}
      onRemove={onRemoveOther}
    />
  );

  return (
    <>
      <Header user={user} />
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - 56px)",
        }}
      >
        <Container
          maxWidth={false}
          sx={{
            py: { xs: 1, sm: 2 },
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            px: { xs: 1, sm: 3 },
          }}
        >
          {/* Toolbar */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: { xs: 0.5, sm: 1.5 },
              mb: { xs: 1, sm: 2 },
              flexWrap: "wrap",
            }}
          >
            {/* Mobile: hamburger for sidebar */}
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              sx={{ display: { xs: "inline-flex", md: "none" } }}
              aria-label="Calendar settings"
              onClick={() => setSidebarOpen(true)}
            >
              <MenuIcon />
            </IconButton>
            <Dropdown>
              <MenuButton
                variant="solid"
                color="primary"
                startDecorator={<AddIcon />}
                sx={{ borderRadius: "xl" }}
              >
                Create
              </MenuButton>
              <Menu placement="bottom-start">
                <MenuItem
                  onClick={() =>
                    setDialog({ event: null, slot: anchor, itemType: "event" })
                  }
                >
                  Event
                </MenuItem>
                <MenuItem
                  onClick={() =>
                    setDialog({ event: null, slot: anchor, itemType: "task" })
                  }
                >
                  Task
                </MenuItem>
                <MenuItem
                  onClick={() =>
                    setDialog({
                      event: null,
                      slot: anchor,
                      itemType: "out_of_office",
                    })
                  }
                >
                  Out of office
                </MenuItem>
                <MenuItem
                  onClick={() =>
                    setDialog({
                      event: null,
                      slot: anchor,
                      itemType: "focus_time",
                    })
                  }
                >
                  Focus time
                </MenuItem>
                <MenuItem disabled>Appointment schedule</MenuItem>
              </Menu>
            </Dropdown>
            <Button
              variant="outlined"
              color="neutral"
              onClick={() => navigate(0)}
            >
              Today
            </Button>
            <IconButton
              variant="plain"
              onClick={() => navigate(-1)}
              aria-label="Previous"
            >
              <ChevronLeftIcon />
            </IconButton>
            <IconButton
              variant="plain"
              onClick={() => navigate(1)}
              aria-label="Next"
            >
              <ChevronRightIcon />
            </IconButton>
            <Typography
              level="title-lg"
              sx={{
                ml: { xs: 0, sm: 1 },
                fontSize: { xs: "0.9rem", sm: "1.125rem" },
              }}
            >
              {label}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Dropdown>
              <MenuButton
                variant="outlined"
                color="neutral"
                endDecorator={<ArrowDropDownIcon />}
                sx={{ textTransform: "capitalize" }}
              >
                {view}
              </MenuButton>
              <Menu placement="bottom-end">
                <MenuItem onClick={() => setView("day")}>
                  Day{" "}
                  <Typography
                    level="body-xs"
                    sx={{ ml: "auto", pl: 2, opacity: 0.5 }}
                  >
                    D
                  </Typography>
                </MenuItem>
                <MenuItem onClick={() => setView("week")}>
                  Week{" "}
                  <Typography
                    level="body-xs"
                    sx={{ ml: "auto", pl: 2, opacity: 0.5 }}
                  >
                    W
                  </Typography>
                </MenuItem>
                <MenuItem onClick={() => setView("month")}>
                  Month{" "}
                  <Typography
                    level="body-xs"
                    sx={{ ml: "auto", pl: 2, opacity: 0.5 }}
                  >
                    M
                  </Typography>
                </MenuItem>
              </Menu>
            </Dropdown>
          </Box>

          {error && (
            <Sheet
              color="danger"
              variant="soft"
              sx={{ p: 1.5, mb: 1, borderRadius: "md" }}
            >
              <Typography color="danger">
                Couldn't load events: {error}
              </Typography>
            </Sheet>
          )}

          {/* Mobile sidebar drawer */}
          <Drawer
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            size="sm"
            sx={{ display: { xs: "flex", md: "none" } }}
          >
            <Box sx={{ p: 2, overflowY: "auto" }}>{sidebarContent}</Box>
          </Drawer>

          {/* Left pane (mini-month + calendars) beside the main view. */}
          <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
            {/* Desktop sidebar */}
            <Box sx={{ display: { xs: "none", md: "block" } }}>
              {sidebarContent}
            </Box>
            {/* Week view wraps in overflowX: auto on mobile so columns can scroll horizontally */}
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                overflowX: view === "week" ? "auto" : "hidden",
              }}
            >
              {loading && events.length === 0 ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                  <CircularProgress />
                </Box>
              ) : view === "month" ? (
                <MonthView
                  date={anchor}
                  events={visibleEvents}
                  onDayClick={(d) => {
                    const s = new Date(d);
                    s.setHours(9, 0, 0, 0);
                    setDialog({ event: null, slot: s });
                  }}
                  onEventClick={(e) => setDialog({ event: e })}
                />
              ) : (
                <TimeGridView
                  days={days}
                  events={visibleEvents}
                  onSlotClick={(d) => setDialog({ event: null, slot: d })}
                  onEventClick={(e) => setDialog({ event: e })}
                />
              )}
            </Box>
          </Box>
        </Container>
      </Box>

      {dialog && (
        <EventDialog
          event={dialog.event}
          defaultStart={dialog.slot}
          defaultItemType={dialog.itemType}
          currentUserEmail={user.email}
          onClose={() => setDialog(null)}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}
    </>
  );
}
