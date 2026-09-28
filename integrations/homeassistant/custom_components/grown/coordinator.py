"""Polling coordinator for the Grown Workspace integration."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import date, datetime
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import GrownAccount, GrownAuthError, GrownClient, GrownError
from .const import CALENDAR_LOOKAHEAD, CALENDAR_LOOKBEHIND, DOMAIN, UPDATE_INTERVAL

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class GrownData:
    """One poll's worth of Grown state."""

    # list id -> TaskList JSON, in Grown's display order.
    task_lists: dict[str, dict[str, Any]] = field(default_factory=dict)
    # list id -> Task JSON list, in Grown's display order.
    tasks: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    unread_notifications: int = 0
    # Events overlapping [now - CALENDAR_LOOKBEHIND, now + CALENDAR_LOOKAHEAD].
    events: list[dict[str, Any]] = field(default_factory=list)

    @property
    def open_tasks(self) -> int:
        return sum(1 for items in self.tasks.values() for t in items if not t.get("completed"))

    def overdue_tasks(self, now: datetime) -> int:
        today = dt_util.as_local(now).date()
        count = 0
        for items in self.tasks.values():
            for t in items:
                if t.get("completed"):
                    continue
                due = parse_task_due(t.get("due_at") or "")
                if due is None:
                    continue
                if isinstance(due, datetime):
                    if due < now:
                        count += 1
                elif due < today:
                    count += 1
        return count


@dataclass(slots=True)
class GrownRuntimeData:
    """What the config entry keeps at runtime (entry.runtime_data)."""

    client: GrownClient
    coordinator: GrownCoordinator
    account: GrownAccount | None


type GrownConfigEntry = ConfigEntry[GrownRuntimeData]


def rfc3339(value: datetime) -> str:
    """Format an aware datetime the way Grown's Go time.RFC3339 parser accepts."""
    return dt_util.as_utc(value).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_task_due(value: str) -> date | datetime | None:
    """Decode a Grown task due_at.

    Grown's Tasks app treats due_at as a date (it shows ``due_at[:10]``), which
    this integration writes as UTC midnight. UTC midnight therefore reads back
    as a plain date; any other instant is a real due datetime.
    """
    if not value:
        return None
    parsed = dt_util.parse_datetime(value)
    if parsed is None:
        return dt_util.parse_date(value[:10])
    parsed = dt_util.as_utc(parsed)
    if (parsed.hour, parsed.minute, parsed.second, parsed.microsecond) == (0, 0, 0, 0):
        return parsed.date()
    return parsed


def format_task_due(value: date | datetime | None) -> str:
    """Encode a todo due date/datetime as a Grown task due_at."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=dt_util.get_default_time_zone())
        return rfc3339(value)
    return f"{value.isoformat()}T00:00:00Z"


class GrownCoordinator(DataUpdateCoordinator[GrownData]):
    """Fetches task lists + tasks, unread count and the upcoming events."""

    config_entry: GrownConfigEntry

    def __init__(self, hass: HomeAssistant, entry: GrownConfigEntry, client: GrownClient) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=UPDATE_INTERVAL,
        )
        self.client = client

    async def _async_update_data(self) -> GrownData:
        now = dt_util.utcnow()
        try:
            lists, unread, events = await asyncio.gather(
                self.client.async_list_task_lists(),
                self.client.async_unread_count(),
                self.client.async_list_events(
                    rfc3339(now - CALENDAR_LOOKBEHIND), rfc3339(now + CALENDAR_LOOKAHEAD)
                ),
            )
            lists = sorted(lists, key=lambda tl: tl.get("position") or 0)
            per_list = await asyncio.gather(
                *(self.client.async_list_tasks(tl["id"]) for tl in lists)
            )
        except GrownAuthError as err:
            raise ConfigEntryAuthFailed(f"Grown rejected the API token: {err}") from err
        except GrownError as err:
            raise UpdateFailed(f"Error talking to Grown: {err}") from err

        return GrownData(
            task_lists={tl["id"]: tl for tl in lists},
            tasks={
                tl["id"]: sorted(items, key=lambda t: t.get("position") or 0)
                for tl, items in zip(lists, per_list, strict=True)
            },
            unread_notifications=unread,
            events=events,
        )
