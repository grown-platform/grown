"""Shared fixtures: a fake Grown server behind HA's aiohttp test mocker."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from homeassistant.const import CONF_TOKEN, CONF_URL
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.grown.const import DOMAIN

URL = "https://grown.example.com"
TOKEN = "grw_0123456789abcdef0123456789abcdef0123456789abcdef"
API = f"{URL}/api/v1"

INFO = {
    "user_id": "user-1",
    "email": "ada@example.com",
    "name": "Ada",
    "org_id": "org-1",
    "org_name": "Acme Household",
    "scopes": [
        "calendar:read",
        "calendar:write",
        "tasks:read",
        "tasks:write",
        "notifications:read",
        "notifications:write",
    ],
    "version": "v0.4.0",
}


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations: None) -> None:
    """Let HA load custom_components/grown in every test."""


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_event(event_id: str, title: str, start: datetime, hours: float = 1, **extra: Any) -> dict:
    """A Grown Event as protojson (UseProtoNames + EmitUnpopulated) emits it."""
    event = {
        "id": event_id,
        "org_id": "org-1",
        "owner_id": "user-1",
        "title": title,
        "description": "",
        "location": "",
        "start_at": _iso(start),
        "end_at": _iso(start + timedelta(hours=hours)),
        "all_day": False,
        "color": "",
        "recurrence": "",
        "created_at": "2026-09-01T00:00:00Z",
        "updated_at": "2026-09-01T00:00:00Z",
        "attendees": [],
        "recurring_event_id": "",
        "item_type": "event",
        "reminders": [],
        "status": "busy",
        "visibility": "default",
        "task_done": False,
        "original_start": "",
        "recurrence_parent_id": "",
    }
    event.update(extra)
    return event


def make_task(task_id: str, list_id: str, title: str, position: int, **extra: Any) -> dict:
    task = {
        "id": task_id,
        "org_id": "org-1",
        "list_id": list_id,
        "owner_user_id": "user-1",
        "title": title,
        "notes": "",
        "due_at": "",
        "completed": False,
        "completed_at": "",
        "parent_task_id": "",
        "position": position,
        "created_at": "2026-09-01T00:00:00Z",
        "updated_at": "2026-09-01T00:00:00Z",
    }
    task.update(extra)
    return task


class FakeGrown:
    """Registers canned Grown answers on the aiohttp mocker."""

    def __init__(self, mocker: AiohttpClientMocker) -> None:
        self.mocker = mocker
        now = datetime.now(timezone.utc).replace(microsecond=0)
        self.lists = [
            {"id": "list-b", "org_id": "org-1", "owner_user_id": "user-1", "name": "Groceries",
             "position": 1, "created_at": "2026-09-01T00:00:00Z"},
            {"id": "list-a", "org_id": "org-1", "owner_user_id": "user-1", "name": "Chores",
             "position": 0, "created_at": "2026-09-01T00:00:00Z"},
        ]
        self.tasks = {
            "list-a": [
                make_task("t1", "list-a", "Take out bins", 0, due_at="2020-01-01T00:00:00Z"),
                make_task("t2", "list-a", "Water plants", 1, completed=True),
            ],
            "list-b": [make_task("t3", "list-b", "Milk", 0, notes="oat")],
        }
        self.events = [
            make_event("ev-now", "Standup", now - timedelta(minutes=10)),
            make_event("ev-later", "Dentist", now + timedelta(days=2)),
        ]
        self.unread = "3"  # int64 -> JSON string under protojson

    def register(self) -> None:
        m = self.mocker
        m.get(f"{API}/integrations/homeassistant/info", json=INFO)
        m.get(f"{API}/notifications/unread-count", json={"count": self.unread})
        m.get(f"{API}/tasks/lists", json={"lists": self.lists})
        for list_id, tasks in self.tasks.items():
            m.get(f"{API}/tasks/lists/{list_id}/tasks", json={"tasks": tasks})
        m.get(f"{API}/calendar/events", json={"events": self.events})


@pytest.fixture
def fake_grown(aioclient_mock: AiohttpClientMocker) -> FakeGrown:
    return FakeGrown(aioclient_mock)


@pytest.fixture
def config_entry() -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        title="Acme Household",
        unique_id="user-1",
        data={CONF_URL: URL, CONF_TOKEN: TOKEN},
    )


@pytest.fixture
async def setup_integration(
    hass: HomeAssistant, fake_grown: FakeGrown, config_entry: MockConfigEntry
) -> MockConfigEntry:
    fake_grown.register()
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    return config_entry


def calls(mocker: AiohttpClientMocker, method: str, path: str) -> list[tuple]:
    """Recorded mock calls for METHOD on API path (exact, query ignored)."""
    out = []
    for call in mocker.mock_calls:
        call_method, call_url = call[0], call[1]
        if call_method.upper() == method and str(call_url).split("?")[0] == f"{API}{path}":
            out.append(call)
    return out
