import type {
  CalendarEvent,
  EventInput,
  ListEventsResponse,
  Attendee,
  ListAttendeesResponse,
} from "./types";

const API_BASE = "/api/v1";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

export async function listEvents(
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const q = new URLSearchParams({
    time_min: timeMin,
    time_max: timeMax,
  }).toString();
  const r = await jsonFetch<ListEventsResponse>(`/calendar/events?${q}`);
  return r.events ?? [];
}

export function createEvent(input: EventInput): Promise<CalendarEvent> {
  return jsonFetch<CalendarEvent>("/calendar/events", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateEvent(
  id: string,
  input: EventInput,
): Promise<CalendarEvent> {
  return jsonFetch<CalendarEvent>(`/calendar/events/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteEvent(
  id: string,
  scope?: number,
  originalStart?: string,
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (scope !== undefined) body.scope = scope;
  if (originalStart !== undefined) body.original_start = originalStart;
  await jsonFetch<unknown>(`/calendar/events/${id}`, {
    method: "DELETE",
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  });
}

// ---- Attendee APIs ----

export async function listAttendees(eventId: string): Promise<Attendee[]> {
  const r = await jsonFetch<ListAttendeesResponse>(
    `/calendar/events/${eventId}/attendees`,
  );
  return r.attendees ?? [];
}

export function addAttendee(
  eventId: string,
  email: string,
  optional?: boolean,
): Promise<Attendee> {
  return jsonFetch<Attendee>(`/calendar/events/${eventId}/attendees`, {
    method: "POST",
    body: JSON.stringify({
      event_id: eventId,
      email,
      optional: optional ?? false,
    }),
  });
}

export async function removeAttendee(
  eventId: string,
  email: string,
): Promise<void> {
  await jsonFetch<unknown>(
    `/calendar/events/${eventId}/attendees/${encodeURIComponent(email)}`,
    {
      method: "DELETE",
    },
  );
}

export function setRSVP(
  eventId: string,
  responseStatus: string,
): Promise<Attendee> {
  return jsonFetch<Attendee>(`/calendar/events/${eventId}/attendees/rsvp`, {
    method: "PATCH",
    body: JSON.stringify({
      event_id: eventId,
      response_status: responseStatus,
    }),
  });
}
