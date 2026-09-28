"""Grown Calendar as a Home Assistant calendar entity."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from homeassistant.components.calendar import (
    EVENT_DESCRIPTION,
    EVENT_END,
    EVENT_LOCATION,
    EVENT_RRULE,
    EVENT_START,
    EVENT_SUMMARY,
    CalendarEntity,
    CalendarEntityFeature,
    CalendarEvent,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .api import EDIT_SCOPE_ALL_EVENTS, EDIT_SCOPE_THIS_EVENT, GrownError
from .coordinator import GrownConfigEntry, GrownCoordinator, rfc3339
from .entity import GrownEntity

PARALLEL_UPDATES = 0

# HA's recurrence_range value for "this and following occurrences".
THIS_AND_FUTURE = "THISANDFUTURE"


def event_from_grown(raw: dict[str, Any]) -> CalendarEvent | None:
    """Convert a Grown Event (JSON) into a CalendarEvent, or None if unusable."""
    start = dt_util.parse_datetime(raw.get("start_at") or "")
    end = dt_util.parse_datetime(raw.get("end_at") or "")
    if start is None:
        return None
    if end is None or end <= start:
        end = start + timedelta(hours=1)
    ev_start: date | datetime
    ev_end: date | datetime
    if raw.get("all_day"):
        # Grown stores all-day items as local midnight -> next local midnight.
        ev_start = dt_util.as_local(start).date()
        ev_end = dt_util.as_local(end).date()
        if ev_end <= ev_start:
            ev_end = ev_start + timedelta(days=1)
    else:
        ev_start, ev_end = dt_util.as_local(start), dt_util.as_local(end)

    recurrence = (raw.get("recurrence") or "").strip()
    if recurrence.upper().startswith("RRULE:"):
        recurrence = recurrence[len("RRULE:") :]
    # Expanded occurrences share the master's id; recurrence_id pins the one.
    recurrence_id = raw.get("start_at") if raw.get("recurring_event_id") else None
    return CalendarEvent(
        start=ev_start,
        end=ev_end,
        summary=raw.get("title") or "",
        description=raw.get("description") or None,
        location=raw.get("location") or None,
        uid=raw.get("recurring_event_id") or raw.get("id"),
        recurrence_id=recurrence_id,
        rrule=recurrence or None,
    )


def _to_grown_times(start: date | datetime, end: date | datetime) -> tuple[str, str, bool]:
    """HA event start/end -> Grown (start_at, end_at, all_day)."""
    if isinstance(start, datetime):
        end_dt = end if isinstance(end, datetime) else start + timedelta(hours=1)
        if start.tzinfo is None:
            start = start.replace(tzinfo=dt_util.get_default_time_zone())
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=dt_util.get_default_time_zone())
        return rfc3339(start), rfc3339(end_dt), False
    end_date = end if isinstance(end, date) and not isinstance(end, datetime) else start
    if end_date <= start:
        end_date = start + timedelta(days=1)
    return (
        rfc3339(dt_util.start_of_local_day(start)),
        rfc3339(dt_util.start_of_local_day(end_date)),
        True,
    )


async def async_setup_entry(
    hass: HomeAssistant,
    entry: GrownConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the Grown calendar."""
    async_add_entities([GrownCalendarEntity(entry.runtime_data.coordinator)])


class GrownCalendarEntity(GrownEntity, CalendarEntity):
    """The Grown Calendar of the connected account's organization."""

    _attr_translation_key = "calendar"
    _attr_supported_features = (
        CalendarEntityFeature.CREATE_EVENT
        | CalendarEntityFeature.DELETE_EVENT
        | CalendarEntityFeature.UPDATE_EVENT
    )

    def __init__(self, coordinator: GrownCoordinator) -> None:
        super().__init__(coordinator, "calendar")

    @property
    def event(self) -> CalendarEvent | None:
        """The current event, else the next upcoming one."""
        now = dt_util.now()
        best: CalendarEvent | None = None
        for raw in self.coordinator.data.events:
            ev = event_from_grown(raw)
            if ev is None or ev.end_datetime_local <= now:
                continue
            if best is None or ev.start_datetime_local < best.start_datetime_local:
                best = ev
        return best

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        """Events in a window, straight from Grown (recurrences expanded)."""
        try:
            raws = await self.coordinator.client.async_list_events(
                rfc3339(start_date), rfc3339(end_date)
            )
        except GrownError as err:
            raise HomeAssistantError(f"Could not load Grown events: {err}") from err
        events = [ev for raw in raws if (ev := event_from_grown(raw)) is not None]
        events.sort(key=lambda ev: ev.start_datetime_local)
        return events

    async def async_create_event(self, **kwargs: Any) -> None:
        """Create a Grown event."""
        start_at, end_at, all_day = _to_grown_times(kwargs[EVENT_START], kwargs[EVENT_END])
        body: dict[str, Any] = {
            "title": kwargs.get(EVENT_SUMMARY) or "",
            "description": kwargs.get(EVENT_DESCRIPTION) or "",
            "location": kwargs.get(EVENT_LOCATION) or "",
            "start_at": start_at,
            "end_at": end_at,
            "all_day": all_day,
            "recurrence": kwargs.get(EVENT_RRULE) or "",
            "item_type": "event",
        }
        try:
            await self.coordinator.client.async_create_event(body)
        except GrownError as err:
            raise HomeAssistantError(f"Could not create the Grown event: {err}") from err
        await self.coordinator.async_request_refresh()

    async def async_update_event(
        self,
        uid: str,
        event: dict[str, Any],
        recurrence_id: str | None = None,
        recurrence_range: str | None = None,
    ) -> None:
        """Edit a Grown event. Grown replaces every field, so merge first."""
        client = self.coordinator.client
        try:
            current = await client.async_get_event(uid)
        except GrownError as err:
            raise HomeAssistantError(f"Could not load the Grown event: {err}") from err
        start_at, end_at, all_day = _to_grown_times(event[EVENT_START], event[EVENT_END])
        body: dict[str, Any] = {
            key: current.get(key)
            for key in (
                "attendees",
                "color",
                "item_type",
                "reminders",
                "status",
                "visibility",
                "task_done",
                "recurrence",
            )
        }
        body.update(
            title=event.get(EVENT_SUMMARY, current.get("title") or ""),
            description=event.get(EVENT_DESCRIPTION, current.get("description") or "") or "",
            location=event.get(EVENT_LOCATION, current.get("location") or "") or "",
            start_at=start_at,
            end_at=end_at,
            all_day=all_day,
        )
        if EVENT_RRULE in event:
            body["recurrence"] = event[EVENT_RRULE] or ""
        if recurrence_id and recurrence_range != THIS_AND_FUTURE:
            body["scope"] = EDIT_SCOPE_THIS_EVENT
            body["original_start"] = recurrence_id
        elif recurrence_id:
            body["scope"] = EDIT_SCOPE_ALL_EVENTS
        try:
            await client.async_update_event(uid, body)
        except GrownError as err:
            raise HomeAssistantError(f"Could not update the Grown event: {err}") from err
        await self.coordinator.async_request_refresh()

    async def async_delete_event(
        self,
        uid: str,
        recurrence_id: str | None = None,
        recurrence_range: str | None = None,
    ) -> None:
        """Delete a Grown event, one occurrence, or a whole series.

        Grown has no "this and following" split: THISANDFUTURE deletes the
        series (EDIT_SCOPE_ALL_EVENTS).
        """
        scope: str | None = None
        original_start: str | None = None
        if recurrence_id and recurrence_range != THIS_AND_FUTURE:
            scope, original_start = EDIT_SCOPE_THIS_EVENT, recurrence_id
        elif recurrence_id:
            scope = EDIT_SCOPE_ALL_EVENTS
        try:
            await self.coordinator.client.async_delete_event(
                uid, scope=scope, original_start=original_start
            )
        except GrownError as err:
            raise HomeAssistantError(f"Could not delete the Grown event: {err}") from err
        await self.coordinator.async_request_refresh()
