import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  Button,
  Box,
  Stack,
  Switch,
  Sheet,
  Select,
  Option,
  Chip,
  ChipDelete,
  IconButton,
  Divider,
  Checkbox,
  RadioGroup,
  Radio,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import type { CalendarEvent, EventInput, ItemType, Attendee } from "./types";
import {
  EVENT_COLORS,
  toLocalInput,
  toDateInput,
  addDays,
  DOW,
} from "./dateutils";
import {
  buildPreset,
  buildCustom,
  classify,
  parseCustom,
  describe,
  DAY_CODES,
  type RecurrenceKind,
  type CustomFreq,
} from "./recurrence";
import {
  listAttendees,
  addAttendee,
  removeAttendee,
  setRSVP,
  getEventMeet,
  setEventMeet,
  clearEventMeet,
  type EventMeet,
} from "./api";
import { createMeeting, listRooms } from "../meet/api";
import type { MeetRoom } from "../meet/types";
import VideocamIcon from "@mui/icons-material/Videocam";

const REMINDER_OPTIONS: { label: string; minutes: number }[] = [
  { label: "At time of event", minutes: 0 },
  { label: "5 minutes before", minutes: 5 },
  { label: "10 minutes before", minutes: 10 },
  { label: "30 minutes before", minutes: 30 },
  { label: "1 hour before", minutes: 60 },
  { label: "1 day before", minutes: 1440 },
];

interface EventDialogProps {
  event: CalendarEvent | null; // null = create
  defaultStart?: Date; // slot to prefill for new events
  defaultItemType?: ItemType; // for new items from the Create menu
  currentUserEmail?: string;
  onClose: () => void;
  onSave: (input: EventInput) => Promise<CalendarEvent | void>;
  onDelete?: (
    id: string,
    scope?: number,
    originalStart?: string,
  ) => Promise<void>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RSVP_LABELS: Record<string, string> = {
  needs_action: "Awaiting",
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Maybe",
};

function RsvpIcon({ status }: { status: string }) {
  switch (status) {
    case "accepted":
      return <CheckCircleOutlineIcon fontSize="small" color="success" />;
    case "declined":
      return <CancelOutlinedIcon fontSize="small" color="error" />;
    case "tentative":
      return <HelpOutlineIcon fontSize="small" color="warning" />;
    default:
      return <HelpOutlineIcon fontSize="small" sx={{ opacity: 0.4 }} />;
  }
}

// EditScope enum values mirror proto EditScope.
const SCOPE_ALL = 2;
const SCOPE_THIS = 1;

export function EventDialog({
  event,
  defaultStart,
  defaultItemType,
  currentUserEmail,
  onClose,
  onSave,
  onDelete,
}: EventDialogProps) {
  const initialStart = event
    ? new Date(event.start_at)
    : defaultStart || new Date();
  const initialEnd = event
    ? new Date(event.end_at)
    : new Date(initialStart.getTime() + 60 * 60 * 1000);
  const [title, setTitle] = useState(event?.title ?? "");
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [color, setColor] = useState(event?.color || EVENT_COLORS[0]);
  const [saving, setSaving] = useState(false);

  // New fields.
  const [itemType, setItemType] = useState<ItemType>(
    event?.item_type ?? defaultItemType ?? "event",
  );
  const [reminders, setReminders] = useState<number[]>(event?.reminders ?? []);
  const [eventStatus, setEventStatus] = useState(event?.status ?? "busy");
  const [visibility, setVisibility] = useState(event?.visibility ?? "default");
  const [taskDone, setTaskDone] = useState(event?.task_done ?? false);

  function toggleReminder(minutes: number) {
    setReminders((cur) =>
      cur.includes(minutes)
        ? cur.filter((m) => m !== minutes)
        : [...cur, minutes].sort((a, b) => a - b),
    );
  }

  // Recurrence state.
  const initialRule = event?.recurrence ?? "";
  const [recKind, setRecKind] = useState<RecurrenceKind>(() =>
    classify(initialRule, initialStart),
  );
  const initCustom = parseCustom(initialRule);
  const [customFreq, setCustomFreq] = useState<CustomFreq>(initCustom.freq);
  const [customInterval, setCustomInterval] = useState<number>(
    initCustom.interval,
  );
  const [customByDay, setCustomByDay] = useState<string[]>(
    initCustom.byDay.length
      ? initCustom.byDay
      : [DAY_CODES[initialStart.getDay()]],
  );

  // Attendees state (flat email list in the form, mirrored to the attendees table).
  const [attendees, setAttendees] = useState<string[]>(event?.attendees ?? []);
  const [guestInput, setGuestInput] = useState("");
  const [guestError, setGuestError] = useState<string | null>(null);

  // Structured attendee data (loaded from the attendees table for existing events).
  const [structuredAttendees, setStructuredAttendees] = useState<Attendee[]>(
    [],
  );
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [rsvpSaving, setRsvpSaving] = useState(false);

  // Meet video meeting attached to this event. For a not-yet-created event the
  // selection is held "pending" and attached right after the event is saved.
  const [meet, setMeet] = useState<EventMeet | null>(null);
  const [meetPending, setMeetPending] = useState(false);
  const [meetBusy, setMeetBusy] = useState(false);
  const [rooms, setRooms] = useState<MeetRoom[]>([]);

  // For a recurring instance: "This event" vs "All events" scope.
  const isRecurringInstance = !!event?.recurring_event_id;
  const [editScope, setEditScope] = useState<number>(SCOPE_ALL);

  // Load structured attendees when editing an existing event.
  useEffect(() => {
    if (!event?.id) return;
    setAttendeesLoading(true);
    listAttendees(event.id)
      .then(setStructuredAttendees)
      .catch(() => {
        /* ignore — fall back to flat attendees list */
      })
      .finally(() => setAttendeesLoading(false));
  }, [event?.id]);

  // Load the event's attached meeting (and pickable rooms). Existing events
  // load their saved meeting; new events start empty.
  useEffect(() => {
    setMeetPending(false);
    if (!event?.id) {
      setMeet(null);
    } else {
      getEventMeet(event.id)
        .then(setMeet)
        .catch(() => setMeet(null));
    }
    listRooms()
      .then((rs) => setRooms(rs.filter((r) => r.code)))
      .catch(() => {
        /* picker is optional */
      });
  }, [event?.id]);

  async function createMeetingForEvent() {
    setMeetBusy(true);
    try {
      const room = await createMeeting(title || "Meeting");
      if (!room.code) return;
      await applyMeet({ room_id: room.id, code: room.code });
    } catch {
      /* ignore */
    } finally {
      setMeetBusy(false);
    }
  }

  async function attachRoom(roomId: string) {
    const room = rooms.find((r) => r.id === roomId);
    if (!room?.code) return;
    setMeetBusy(true);
    try {
      await applyMeet({ room_id: room.id, code: room.code });
    } catch {
      /* ignore */
    } finally {
      setMeetBusy(false);
    }
  }

  // Persist the chosen meeting now for existing events, or hold it pending for
  // a new event (attached on save once the event has an id).
  async function applyMeet(link: EventMeet) {
    if (event?.id) {
      setMeet(await setEventMeet(event.id, link));
      setMeetPending(false);
    } else {
      setMeet(link);
      setMeetPending(true);
    }
  }

  async function removeMeeting() {
    setMeetBusy(true);
    try {
      if (event?.id && !meetPending) await clearEventMeet(event.id);
      setMeet(null);
      setMeetPending(false);
    } catch {
      /* ignore */
    } finally {
      setMeetBusy(false);
    }
  }

  // The note shown when editing a single occurrence of a recurring series.
  const recurrenceString = useMemo(() => {
    if (recKind === "custom")
      return buildCustom(
        customFreq,
        customInterval,
        customFreq === "WEEKLY" ? customByDay : [],
      );
    return buildPreset(recKind, start);
  }, [recKind, customFreq, customInterval, customByDay, start]);

  function addGuest() {
    const v = guestInput.trim().toLowerCase();
    if (!v) return;
    if (!EMAIL_RE.test(v)) {
      setGuestError("Enter a valid email address");
      return;
    }
    if (attendees.includes(v)) {
      setGuestError("Already added");
      setGuestInput("");
      return;
    }
    setAttendees((a) => [...a, v]);
    setGuestInput("");
    setGuestError(null);
  }

  async function handleRsvp(newStatus: string) {
    if (!event?.id) return;
    setRsvpSaving(true);
    try {
      const updated = await setRSVP(event.id, newStatus);
      setStructuredAttendees((cur) =>
        cur.map((a) => (a.email === updated.email ? updated : a)),
      );
    } catch {
      // ignore
    } finally {
      setRsvpSaving(false);
    }
  }

  async function handleRemoveStructuredAttendee(email: string) {
    if (!event?.id) return;
    try {
      await removeAttendee(event.id, email);
      setStructuredAttendees((cur) => cur.filter((a) => a.email !== email));
      setAttendees((cur) => cur.filter((e) => e !== email));
    } catch {
      // ignore
    }
  }

  async function save() {
    setSaving(true);
    let s = start,
      e = end;
    if (allDay) {
      s = new Date(start);
      s.setHours(0, 0, 0, 0);
      e = addDays(new Date(s), 1);
    }
    if (e <= s) e = new Date(s.getTime() + 60 * 60 * 1000);
    const input: EventInput = {
      title: title.trim() || "(no title)",
      description,
      location,
      start_at: s.toISOString(),
      end_at: e.toISOString(),
      all_day: allDay,
      color,
      recurrence: recurrenceString,
      attendees,
      item_type: itemType,
      reminders,
      status: eventStatus,
      visibility,
      task_done: taskDone,
    };
    // For recurring instances: pass scope + original_start.
    if (isRecurringInstance && editScope === SCOPE_THIS) {
      input.scope = SCOPE_THIS;
      input.original_start = event!.start_at; // the occurrence's computed start
    } else if (event) {
      input.scope = SCOPE_ALL;
    }
    try {
      const saved = await onSave(input);
      // Sync newly added attendees to the attendees table if editing an existing event.
      if (event?.id) {
        const existingEmails = new Set(structuredAttendees.map((a) => a.email));
        const toAdd = attendees.filter((em) => !existingEmails.has(em));
        await Promise.all(toAdd.map((em) => addAttendee(event.id, em)));
      }
      // Attach a meeting chosen during creation, now that the event has an id.
      if (!event?.id && meetPending && meet && saved && "id" in saved) {
        try {
          await setEventMeet(saved.id, meet);
        } catch {
          /* meeting attach is best-effort */
        }
      }
      onClose();
    } catch (err) {
      window.alert(`Save failed: ${(err as Error).message}`);
      setSaving(false);
    }
  }

  const toggleByDay = (code: string) =>
    setCustomByDay((d) =>
      d.includes(code) ? d.filter((x) => x !== code) : [...d, code],
    );

  // Determine if the current user is an attendee so we can show RSVP controls.
  const myAttendeeRecord = currentUserEmail
    ? structuredAttendees.find(
        (a) => a.email === currentUserEmail.toLowerCase(),
      )
    : undefined;

  const dialogTitle = event
    ? itemType === "task"
      ? "Edit task"
      : itemType === "out_of_office"
        ? "Edit out of office"
        : itemType === "focus_time"
          ? "Edit focus time"
          : "Edit event"
    : itemType === "task"
      ? "New task"
      : itemType === "out_of_office"
        ? "New out of office"
        : itemType === "focus_time"
          ? "New focus time"
          : "New event";

  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 500 },
          maxWidth: "100vw",
          maxHeight: "92vh",
          overflowY: "auto",
        }}
      >
        <ModalClose />
        <Typography level="h4">{dialogTitle}</Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {/* Recurring instance scope selector */}
          {isRecurringInstance && (
            <Sheet
              variant="soft"
              color="warning"
              sx={{ p: 1.5, borderRadius: "md" }}
            >
              <FormLabel sx={{ mb: 0.75 }}>Edit recurring event</FormLabel>
              <RadioGroup
                value={String(editScope)}
                onChange={(e) => setEditScope(Number(e.target.value))}
                orientation="vertical"
              >
                <Radio
                  value={String(SCOPE_THIS)}
                  label="This event"
                  size="sm"
                />
                <Radio
                  value={String(SCOPE_ALL)}
                  label="All events in the series"
                  size="sm"
                />
              </RadioGroup>
            </Sheet>
          )}

          {/* Item type selector */}
          <FormControl>
            <FormLabel>Type</FormLabel>
            <Select
              value={itemType}
              onChange={(_, v) => v && setItemType(v)}
              aria-label="Item type"
            >
              <Option value="event">Event</Option>
              <Option value="task">Task</Option>
              <Option value="out_of_office">Out of office</Option>
              <Option value="focus_time">Focus time</Option>
            </Select>
          </FormControl>
          {/* Task done checkbox */}
          {itemType === "task" && (
            <FormControl
              orientation="horizontal"
              sx={{ justifyContent: "space-between" }}
            >
              <FormLabel>Completed</FormLabel>
              <Checkbox
                checked={taskDone}
                onChange={(e) => setTaskDone(e.target.checked)}
              />
            </FormControl>
          )}
          <Input
            placeholder="Add title"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            sx={{ fontSize: "1.1rem" }}
          />
          <FormControl
            orientation="horizontal"
            sx={{ justifyContent: "space-between" }}
          >
            <FormLabel>All day</FormLabel>
            <Switch
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
          </FormControl>
          <Box sx={{ display: "flex", gap: 1 }}>
            <FormControl sx={{ flex: 1 }}>
              <FormLabel>Start</FormLabel>
              {allDay ? (
                <Input
                  type="date"
                  value={toDateInput(start)}
                  onChange={(e) =>
                    setStart(new Date(e.target.value + "T00:00"))
                  }
                />
              ) : (
                <Input
                  type="datetime-local"
                  value={toLocalInput(start)}
                  onChange={(e) => setStart(new Date(e.target.value))}
                />
              )}
            </FormControl>
            {!allDay && (
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>End</FormLabel>
                <Input
                  type="datetime-local"
                  value={toLocalInput(end)}
                  onChange={(e) => setEnd(new Date(e.target.value))}
                />
              </FormControl>
            )}
          </Box>

          {/* Recurrence — only show when editing the whole series or creating */}
          {(!isRecurringInstance || editScope === SCOPE_ALL) && (
            <>
              <FormControl>
                <FormLabel>Repeat</FormLabel>
                <Select
                  value={recKind}
                  onChange={(_, v) => v && setRecKind(v)}
                  aria-label="Repeat"
                >
                  <Option value="none">Does not repeat</Option>
                  <Option value="daily">Daily</Option>
                  <Option value="weekly">
                    Weekly on {DOW[start.getDay()]}
                  </Option>
                  <Option value="monthly">Monthly</Option>
                  <Option value="yearly">Annually</Option>
                  <Option value="weekday">Every weekday (Mon–Fri)</Option>
                  <Option value="custom">Custom…</Option>
                </Select>
                {recKind !== "none" && recKind !== "custom" && (
                  <Typography level="body-xs" sx={{ mt: 0.5, opacity: 0.7 }}>
                    {describe(recurrenceString, start)}
                  </Typography>
                )}
              </FormControl>

              {recKind === "custom" && (
                <Sheet variant="soft" sx={{ p: 1.5, borderRadius: "md" }}>
                  <Stack spacing={1}>
                    <Box
                      sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}
                    >
                      <FormControl sx={{ width: 96 }}>
                        <FormLabel>Every</FormLabel>
                        <Input
                          type="number"
                          slotProps={{ input: { min: 1, max: 365 } }}
                          value={customInterval}
                          onChange={(e) =>
                            setCustomInterval(
                              Math.max(1, parseInt(e.target.value, 10) || 1),
                            )
                          }
                        />
                      </FormControl>
                      <FormControl sx={{ flex: 1 }}>
                        <FormLabel>Period</FormLabel>
                        <Select
                          value={customFreq}
                          onChange={(_, v) => v && setCustomFreq(v)}
                          aria-label="Period"
                        >
                          <Option value="DAILY">
                            {customInterval > 1 ? "days" : "day"}
                          </Option>
                          <Option value="WEEKLY">
                            {customInterval > 1 ? "weeks" : "week"}
                          </Option>
                          <Option value="MONTHLY">
                            {customInterval > 1 ? "months" : "month"}
                          </Option>
                          <Option value="YEARLY">
                            {customInterval > 1 ? "years" : "year"}
                          </Option>
                        </Select>
                      </FormControl>
                    </Box>
                    {customFreq === "WEEKLY" && (
                      <Box>
                        <FormLabel sx={{ mb: 0.5 }}>Repeat on</FormLabel>
                        <Box sx={{ display: "flex", gap: 0.5 }}>
                          {DAY_CODES.map((code, i) => {
                            const on = customByDay.includes(code);
                            return (
                              <Box
                                key={code}
                                component="button"
                                type="button"
                                aria-pressed={on}
                                aria-label={DOW[i]}
                                onClick={() => toggleByDay(code)}
                                sx={{
                                  width: 30,
                                  height: 30,
                                  borderRadius: "50%",
                                  border: "1px solid",
                                  borderColor: on
                                    ? "primary.500"
                                    : "neutral.300",
                                  bgcolor: on ? "primary.500" : "transparent",
                                  color: on ? "#fff" : "text.primary",
                                  cursor: "pointer",
                                  fontSize: 12,
                                }}
                              >
                                {DOW[i][0]}
                              </Box>
                            );
                          })}
                        </Box>
                      </Box>
                    )}
                    <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                      {describe(recurrenceString, start)}
                    </Typography>
                  </Stack>
                </Sheet>
              )}
            </>
          )}

          <FormControl>
            <FormLabel>Location</FormLabel>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </FormControl>

          {/* Video meeting (Meet) */}
          <FormControl>
            <FormLabel>Video meeting</FormLabel>
            {meet ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Button
                  component="a"
                  href={`/meet/${meet.code}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                  color="success"
                  variant="solid"
                  startDecorator={<VideocamIcon />}
                >
                  Join
                </Button>
                <Typography
                  level="body-sm"
                  sx={{ fontFamily: "monospace", opacity: 0.7, wordBreak: "break-all" }}
                >
                  {`${window.location.origin}/meet/${meet.code}`}
                </Typography>
                {meetPending && (
                  <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                    (added when you save)
                  </Typography>
                )}
                <Button
                  size="sm"
                  variant="plain"
                  color="danger"
                  onClick={removeMeeting}
                  disabled={meetBusy}
                >
                  Remove
                </Button>
              </Box>
            ) : (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Button
                  size="sm"
                  variant="soft"
                  startDecorator={<VideocamIcon />}
                  onClick={createMeetingForEvent}
                  disabled={meetBusy}
                >
                  New meeting
                </Button>
                {rooms.length > 0 && (
                  <Select<string>
                    size="sm"
                    placeholder="Add existing room"
                    value={null}
                    onChange={(_, v) => {
                      if (v) void attachRoom(v);
                    }}
                    disabled={meetBusy}
                    sx={{ minWidth: 200 }}
                  >
                    {rooms.map((r) => (
                      <Option key={r.id} value={r.id}>
                        {r.name || r.code}
                      </Option>
                    ))}
                  </Select>
                )}
              </Box>
            )}
          </FormControl>

          <FormControl>
            <FormLabel>Description</FormLabel>
            <Textarea
              minRows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormControl>

          {/* Guests / Attendees */}
          <FormControl error={!!guestError}>
            <FormLabel>Guests</FormLabel>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Input
                sx={{ flex: 1 }}
                placeholder="Add guest email"
                type="email"
                value={guestInput}
                onChange={(e) => {
                  setGuestInput(e.target.value);
                  setGuestError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addGuest();
                  }
                }}
                endDecorator={
                  <IconButton
                    variant="plain"
                    size="sm"
                    aria-label="Add guest"
                    onClick={addGuest}
                  >
                    <AddIcon />
                  </IconButton>
                }
              />
            </Box>
            {guestError && (
              <Typography level="body-xs" color="danger" sx={{ mt: 0.25 }}>
                {guestError}
              </Typography>
            )}

            {/* Structured attendees with RSVP status (for existing events) */}
            {structuredAttendees.length > 0 && !attendeesLoading && (
              <Stack spacing={0.5} sx={{ mt: 0.75 }}>
                {structuredAttendees.map((a) => (
                  <Box
                    key={a.email}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      px: 0.5,
                    }}
                  >
                    <RsvpIcon status={a.response_status} />
                    <Typography level="body-sm" sx={{ flex: 1 }}>
                      {a.email}
                    </Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                      {RSVP_LABELS[a.response_status] ?? a.response_status}
                    </Typography>
                    {event && (
                      <IconButton
                        size="sm"
                        variant="plain"
                        color="neutral"
                        aria-label={`Remove ${a.email}`}
                        onClick={() => handleRemoveStructuredAttendee(a.email)}
                      >
                        <ChipDelete component="span" />
                      </IconButton>
                    )}
                  </Box>
                ))}
              </Stack>
            )}

            {/* Flat attendee chips for events that don't have structured attendees yet */}
            {structuredAttendees.length === 0 && attendees.length > 0 && (
              <Box
                sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.75 }}
              >
                {attendees.map((a) => (
                  <Chip
                    key={a}
                    variant="soft"
                    color="neutral"
                    endDecorator={
                      <ChipDelete
                        aria-label={`Remove ${a}`}
                        onDelete={() =>
                          setAttendees((cur) => cur.filter((x) => x !== a))
                        }
                      />
                    }
                  >
                    {a}
                  </Chip>
                ))}
              </Box>
            )}
          </FormControl>

          {/* RSVP controls — only shown when the current user is an attendee on an existing event */}
          {event && myAttendeeRecord && (
            <Sheet variant="soft" sx={{ p: 1.5, borderRadius: "md" }}>
              <FormLabel sx={{ mb: 0.75 }}>Your RSVP</FormLabel>
              <Box sx={{ display: "flex", gap: 1 }}>
                {(["accepted", "tentative", "declined"] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    loading={rsvpSaving}
                    variant={
                      myAttendeeRecord.response_status === s
                        ? "solid"
                        : "outlined"
                    }
                    color={
                      s === "accepted"
                        ? "success"
                        : s === "declined"
                          ? "danger"
                          : "warning"
                    }
                    onClick={() => handleRsvp(s)}
                  >
                    {s === "accepted"
                      ? "Accept"
                      : s === "declined"
                        ? "Decline"
                        : "Maybe"}
                  </Button>
                ))}
              </Box>
            </Sheet>
          )}

          {/* Reminders */}
          <FormControl>
            <FormLabel>Notifications</FormLabel>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
              {REMINDER_OPTIONS.map(({ label, minutes }) => {
                const on = reminders.includes(minutes);
                return (
                  <Chip
                    key={minutes}
                    variant={on ? "solid" : "outlined"}
                    color={on ? "primary" : "neutral"}
                    onClick={() => toggleReminder(minutes)}
                    sx={{ cursor: "pointer" }}
                  >
                    {label}
                  </Chip>
                );
              })}
            </Box>
          </FormControl>

          {/* Status & Visibility — only for events/ooo/focus */}
          {itemType !== "task" && (
            <Box sx={{ display: "flex", gap: 1 }}>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Status</FormLabel>
                <Select
                  value={eventStatus}
                  onChange={(_, v) => v && setEventStatus(v)}
                  aria-label="Status"
                >
                  <Option value="busy">Busy</Option>
                  <Option value="free">Free</Option>
                </Select>
              </FormControl>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Visibility</FormLabel>
                <Select
                  value={visibility}
                  onChange={(_, v) => v && setVisibility(v)}
                  aria-label="Visibility"
                >
                  <Option value="default">Default</Option>
                  <Option value="public">Public</Option>
                  <Option value="private">Private</Option>
                </Select>
              </FormControl>
            </Box>
          )}

          <FormControl>
            <FormLabel>Color</FormLabel>
            <Box sx={{ display: "flex", gap: 0.75 }}>
              {EVENT_COLORS.map((c) => (
                <Sheet
                  key={c}
                  role="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    bgcolor: c,
                    cursor: "pointer",
                    outline: color === c ? "2px solid" : "none",
                    outlineColor: "text.primary",
                    outlineOffset: 2,
                  }}
                />
              ))}
            </Box>
          </FormControl>

          <Divider />
          <Box sx={{ display: "flex", gap: 1 }}>
            {event && onDelete && (
              <Button
                variant="plain"
                color="danger"
                onClick={async () => {
                  if (isRecurringInstance && editScope === SCOPE_THIS) {
                    await onDelete(
                      event.recurring_event_id ?? event.id,
                      SCOPE_THIS,
                      event.start_at,
                    );
                  } else {
                    await onDelete(event.id);
                  }
                  onClose();
                }}
              >
                Delete
              </Button>
            )}
            <Box sx={{ flex: 1 }} />
            <Button variant="plain" color="neutral" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={saving} onClick={save}>
              Save
            </Button>
          </Box>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
