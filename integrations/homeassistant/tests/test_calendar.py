"""Grown Event <-> CalendarEvent conversion and event updates."""

from __future__ import annotations

from datetime import date, datetime, timezone

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.grown.calendar import event_from_grown

from .conftest import API, calls, make_event

CAL = "calendar.acme_household_calendar"


async def test_all_day_event_uses_local_dates(hass: HomeAssistant) -> None:
    await hass.config.async_set_time_zone("America/New_York")
    # What Grown's UI stores for an all-day Oct 3 in New York.
    raw = make_event("e", "Trip", datetime(2026, 10, 3, 4, tzinfo=timezone.utc), hours=24, all_day=True)
    ev = event_from_grown(raw)
    assert ev.start == date(2026, 10, 3)
    assert ev.end == date(2026, 10, 4)
    assert ev.recurrence_id is None
    assert ev.uid == "e"


async def test_recurring_instance_carries_master_uid_and_recurrence_id(hass: HomeAssistant) -> None:
    raw = make_event(
        "master-1", "Gym", datetime(2026, 10, 5, 17, tzinfo=timezone.utc),
        recurrence="RRULE:FREQ=WEEKLY;COUNT=4", recurring_event_id="master-1",
    )
    ev = event_from_grown(raw)
    assert ev.uid == "master-1"
    assert ev.recurrence_id == "2026-10-05T17:00:00Z"
    assert ev.rrule == "FREQ=WEEKLY;COUNT=4"
    assert isinstance(ev.start, datetime) and ev.start.tzinfo is not None


def test_unusable_event_is_skipped() -> None:
    assert event_from_grown(make_event("x", "bad", datetime(2026, 1, 1, tzinfo=timezone.utc)) | {"start_at": ""}) is None


async def test_update_event_merges_grown_fields(
    hass: HomeAssistant, setup_integration: MockConfigEntry, aioclient_mock: AiohttpClientMocker
) -> None:
    current = make_event(
        "ev-1", "Old", datetime(2026, 10, 5, 17, tzinfo=timezone.utc),
        color="#ff0000", attendees=["bob@example.com"], reminders=[10], location="Room 1",
    )
    aioclient_mock.get(f"{API}/calendar/events/ev-1", json=current)
    aioclient_mock.patch(f"{API}/calendar/events/ev-1", json=current)
    entity = hass.data["entity_components"]["calendar"].get_entity(CAL)
    start = dt_util.as_local(datetime(2026, 10, 6, 9, tzinfo=timezone.utc))
    end = dt_util.as_local(datetime(2026, 10, 6, 10, tzinfo=timezone.utc))
    await entity.async_update_event("ev-1", {"summary": "New", "dtstart": start, "dtend": end})
    (patch,) = calls(aioclient_mock, "PATCH", "/calendar/events/ev-1")
    body = patch[2]
    assert body["title"] == "New"
    assert body["start_at"] == "2026-10-06T09:00:00Z"
    assert body["end_at"] == "2026-10-06T10:00:00Z"
    assert body["all_day"] is False
    # Untouched Grown-only fields survive the full-replace PATCH.
    assert body["color"] == "#ff0000"
    assert body["attendees"] == ["bob@example.com"]
    assert body["reminders"] == [10]
    assert body["location"] == "Room 1"
    assert "scope" not in body
