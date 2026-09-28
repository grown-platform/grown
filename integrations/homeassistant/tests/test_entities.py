"""Setup, entities, services and error handling against a fake Grown."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from homeassistant.components.calendar import DOMAIN as CALENDAR_DOMAIN
from homeassistant.components.notify import DOMAIN as NOTIFY_DOMAIN
from homeassistant.components.todo import DOMAIN as TODO_DOMAIN
from homeassistant.config_entries import ConfigEntryState, SOURCE_REAUTH
from homeassistant.const import STATE_ON, STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.grown.coordinator import format_task_due, parse_task_due

from .conftest import API, FakeGrown, calls, make_task

CAL = "calendar.acme_household_calendar"
NOTIFY = "notify.acme_household_notifications"
CHORES = "todo.acme_household_chores"
GROCERIES = "todo.acme_household_groceries"


async def test_setup_creates_entities(hass: HomeAssistant, setup_integration: MockConfigEntry) -> None:
    assert setup_integration.state is ConfigEntryState.LOADED

    assert hass.states.get("sensor.acme_household_unread_notifications").state == "3"
    # t1 open (and overdue: due 2020-01-01), t2 done, t3 open.
    assert hass.states.get("sensor.acme_household_open_tasks").state == "2"
    assert hass.states.get("sensor.acme_household_overdue_tasks").state == "1"

    # Todo state = number of incomplete items; one entity per list.
    assert hass.states.get(CHORES).state == "1"
    assert hass.states.get(GROCERIES).state == "1"

    cal = hass.states.get(CAL)
    assert cal.state == STATE_ON  # "Standup" started 10 minutes ago
    assert cal.attributes["message"] == "Standup"

    assert hass.states.get(NOTIFY) is not None


async def test_todo_items(hass: HomeAssistant, setup_integration: MockConfigEntry) -> None:
    result = await hass.services.async_call(
        TODO_DOMAIN, "get_items", {}, target={"entity_id": CHORES},
        blocking=True, return_response=True,
    )
    items = result[CHORES]["items"]
    assert [i["summary"] for i in items] == ["Take out bins", "Water plants"]
    assert items[0]["status"] == "needs_action"
    assert items[0]["due"] == "2020-01-01"  # UTC midnight reads as a date
    assert items[1]["status"] == "completed"


async def test_todo_add_update_complete_delete(
    hass: HomeAssistant, setup_integration: MockConfigEntry, aioclient_mock: AiohttpClientMocker
) -> None:
    aioclient_mock.post(f"{API}/tasks/lists/list-a/tasks", json=make_task("t9", "list-a", "New", 2))
    aioclient_mock.patch(f"{API}/tasks/lists/list-a/tasks/t1", json={})
    aioclient_mock.post(f"{API}/tasks/lists/list-a/tasks/t1/toggle", json={})
    aioclient_mock.delete(f"{API}/tasks/lists/list-a/tasks/t2", json={})

    await hass.services.async_call(
        TODO_DOMAIN, "add_item",
        {"item": "New", "due_date": "2026-10-01", "description": "note"},
        target={"entity_id": CHORES}, blocking=True,
    )
    (add,) = calls(aioclient_mock, "POST", "/tasks/lists/list-a/tasks")
    assert add[2] == {"title": "New", "notes": "note", "due_at": "2026-10-01T00:00:00Z"}

    await hass.services.async_call(
        TODO_DOMAIN, "update_item", {"item": "t1", "status": "completed"},
        target={"entity_id": CHORES}, blocking=True,
    )
    (patch,) = calls(aioclient_mock, "PATCH", "/tasks/lists/list-a/tasks/t1")
    # Full replace: title/notes/due kept, parent preserved.
    assert patch[2] == {
        "title": "Take out bins", "notes": "", "due_at": "2020-01-01T00:00:00Z", "parent_task_id": "",
    }
    assert len(calls(aioclient_mock, "POST", "/tasks/lists/list-a/tasks/t1/toggle")) == 1

    await hass.services.async_call(
        TODO_DOMAIN, "remove_item", {"item": "Water plants"},
        target={"entity_id": CHORES}, blocking=True,
    )
    assert len(calls(aioclient_mock, "DELETE", "/tasks/lists/list-a/tasks/t2")) == 1


async def test_todo_rename_without_status_change_does_not_toggle(
    hass: HomeAssistant, setup_integration: MockConfigEntry, aioclient_mock: AiohttpClientMocker
) -> None:
    aioclient_mock.patch(f"{API}/tasks/lists/list-b/tasks/t3", json={})
    await hass.services.async_call(
        TODO_DOMAIN, "update_item", {"item": "t3", "rename": "Oat milk"},
        target={"entity_id": GROCERIES}, blocking=True,
    )
    (patch,) = calls(aioclient_mock, "PATCH", "/tasks/lists/list-b/tasks/t3")
    assert patch[2]["title"] == "Oat milk"
    assert patch[2]["notes"] == "oat"
    assert not calls(aioclient_mock, "POST", "/tasks/lists/list-b/tasks/t3/toggle")


async def test_todo_move(
    hass: HomeAssistant, setup_integration: MockConfigEntry, aioclient_mock: AiohttpClientMocker
) -> None:
    aioclient_mock.post(f"{API}/tasks/lists/list-a/tasks/t1/reorder", json={})
    entity = hass.data["entity_components"][TODO_DOMAIN].get_entity(CHORES)
    await entity.async_move_todo_item("t1", "t2")
    (move,) = calls(aioclient_mock, "POST", "/tasks/lists/list-a/tasks/t1/reorder")
    assert move[2] == {"position": 1}


async def test_new_and_removed_lists_follow_grown(
    hass: HomeAssistant, setup_integration: MockConfigEntry,
    fake_grown: FakeGrown, aioclient_mock: AiohttpClientMocker,
) -> None:
    aioclient_mock.clear_requests()
    fake_grown.lists = [
        fake_grown.lists[1],  # Chores stays
        {"id": "list-c", "org_id": "org-1", "owner_user_id": "user-1", "name": "Garden",
         "position": 2, "created_at": "2026-09-01T00:00:00Z"},
    ]
    fake_grown.tasks = {"list-a": fake_grown.tasks["list-a"], "list-c": []}
    fake_grown.register()
    await setup_integration.runtime_data.coordinator.async_refresh()
    await hass.async_block_till_done()

    assert hass.states.get("todo.acme_household_garden").state == "0"
    registry = er.async_get(hass)
    assert registry.async_get(GROCERIES) is None


async def test_calendar_events_and_create_delete(
    hass: HomeAssistant, setup_integration: MockConfigEntry, aioclient_mock: AiohttpClientMocker
) -> None:
    now = dt_util.now()
    result = await hass.services.async_call(
        CALENDAR_DOMAIN, "get_events",
        {"start_date_time": now - timedelta(days=1), "end_date_time": now + timedelta(days=5)},
        target={"entity_id": CAL}, blocking=True, return_response=True,
    )
    assert [e["summary"] for e in result[CAL]["events"]] == ["Standup", "Dentist"]

    aioclient_mock.post(f"{API}/calendar/events", json={"id": "ev-new"})
    await hass.services.async_call(
        CALENDAR_DOMAIN, "create_event",
        {"summary": "Holiday", "start_date": "2026-12-24", "end_date": "2026-12-26"},
        target={"entity_id": CAL}, blocking=True,
    )
    (create,) = calls(aioclient_mock, "POST", "/calendar/events")
    body = create[2]
    assert body["title"] == "Holiday"
    assert body["all_day"] is True
    tz = dt_util.get_default_time_zone()
    assert dt_util.parse_datetime(body["start_at"]).astimezone(tz).date() == date(2026, 12, 24)
    assert dt_util.parse_datetime(body["end_at"]).astimezone(tz).date() == date(2026, 12, 26)

    entity = hass.data["entity_components"][CALENDAR_DOMAIN].get_entity(CAL)
    aioclient_mock.delete(f"{API}/calendar/events/ev-series", json={})
    await entity.async_delete_event("ev-series", recurrence_id="2026-10-01T09:00:00Z")
    (delete,) = calls(aioclient_mock, "DELETE", "/calendar/events/ev-series")
    assert delete[1].query["scope"] == "EDIT_SCOPE_THIS_EVENT"
    assert delete[1].query["original_start"] == "2026-10-01T09:00:00Z"


async def test_notify_pushes_to_grown(
    hass: HomeAssistant, setup_integration: MockConfigEntry, aioclient_mock: AiohttpClientMocker
) -> None:
    aioclient_mock.post(f"{API}/notifications/push", status=201, json={"id": "n1"})
    await hass.services.async_call(
        NOTIFY_DOMAIN, "send_message", {"message": "Washer done", "title": "Laundry"},
        target={"entity_id": NOTIFY}, blocking=True,
    )
    await hass.services.async_call(
        NOTIFY_DOMAIN, "send_message", {"message": "x" * 2500},
        target={"entity_id": NOTIFY}, blocking=True,
    )
    first, second = calls(aioclient_mock, "POST", "/notifications/push")
    assert first[2] == {"title": "Laundry", "message": "Washer done"}
    assert second[2]["title"] == "Home Assistant"
    assert len(second[2]["message"]) == 2000


async def test_notify_rate_limited(
    hass: HomeAssistant, setup_integration: MockConfigEntry, aioclient_mock: AiohttpClientMocker
) -> None:
    aioclient_mock.post(f"{API}/notifications/push", status=429, text="slow down")
    with pytest.raises(HomeAssistantError, match="rate-limiting"):
        await hass.services.async_call(
            NOTIFY_DOMAIN, "send_message", {"message": "hi"},
            target={"entity_id": NOTIFY}, blocking=True,
        )


async def test_auth_failure_during_poll_starts_reauth(
    hass: HomeAssistant, setup_integration: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
) -> None:
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/tasks/lists", status=401)
    aioclient_mock.get(f"{API}/notifications/unread-count", status=401)
    aioclient_mock.get(f"{API}/calendar/events", status=401)
    await setup_integration.runtime_data.coordinator.async_refresh()
    await hass.async_block_till_done()

    flows = hass.config_entries.flow.async_progress()
    assert len(flows) == 1
    assert flows[0]["context"]["source"] == SOURCE_REAUTH
    assert flows[0]["context"]["entry_id"] == setup_integration.entry_id


async def test_server_error_marks_entities_unavailable(
    hass: HomeAssistant, setup_integration: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
) -> None:
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/tasks/lists", status=500)
    aioclient_mock.get(f"{API}/notifications/unread-count", status=500)
    aioclient_mock.get(f"{API}/calendar/events", status=500)
    await setup_integration.runtime_data.coordinator.async_refresh()
    await hass.async_block_till_done()

    assert hass.states.get("sensor.acme_household_open_tasks").state == STATE_UNAVAILABLE
    assert not hass.config_entries.flow.async_progress()


@pytest.mark.parametrize("status", [401, 403])
async def test_setup_auth_failure_starts_reauth(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker,
    config_entry: MockConfigEntry, status: int,
) -> None:
    aioclient_mock.get(f"{API}/integrations/homeassistant/info", status=status)
    config_entry.add_to_hass(hass)
    await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    assert config_entry.state is ConfigEntryState.SETUP_ERROR
    assert any(f["context"]["source"] == SOURCE_REAUTH for f in hass.config_entries.flow.async_progress())


async def test_setup_unreachable_retries(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, config_entry: MockConfigEntry
) -> None:
    aioclient_mock.get(f"{API}/integrations/homeassistant/info", status=503)
    config_entry.add_to_hass(hass)
    await hass.config_entries.async_setup(config_entry.entry_id)
    assert config_entry.state is ConfigEntryState.SETUP_RETRY


async def test_unload(hass: HomeAssistant, setup_integration: MockConfigEntry) -> None:
    assert await hass.config_entries.async_unload(setup_integration.entry_id)
    assert setup_integration.state is ConfigEntryState.NOT_LOADED


def test_due_roundtrip() -> None:
    assert parse_task_due("") is None
    assert parse_task_due("2026-10-01T00:00:00Z") == date(2026, 10, 1)
    assert format_task_due(date(2026, 10, 1)) == "2026-10-01T00:00:00Z"
    due = parse_task_due("2026-10-01T15:30:00Z")
    assert format_task_due(due) == "2026-10-01T15:30:00Z"
    assert format_task_due(None) == ""
