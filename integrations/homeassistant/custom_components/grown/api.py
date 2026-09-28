"""Async client for the Grown Workspace REST API (/api/v1).

Grown's JSON API is grpc-gateway generated with ``UseProtoNames`` and
``EmitUnpopulated``: every field is present and snake_case. Authentication is a
personal access token (``grw_...``) sent as ``Authorization: Bearer``.

This module deliberately has no Home Assistant imports so it can be unit-tested
with nothing but aiohttp.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import aiohttp

REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=20)

# grpc-gateway enum names for calendar edit scopes.
EDIT_SCOPE_THIS_EVENT = "EDIT_SCOPE_THIS_EVENT"
EDIT_SCOPE_ALL_EVENTS = "EDIT_SCOPE_ALL_EVENTS"


class GrownError(Exception):
    """Base error for Grown API failures."""


class GrownConnectionError(GrownError):
    """Grown could not be reached (DNS, TCP, TLS, timeout)."""


class GrownAuthError(GrownError):
    """The token was rejected (HTTP 401) or lacks a scope (HTTP 403)."""


class GrownNotFoundError(GrownError):
    """The endpoint or object does not exist (HTTP 404)."""


class GrownRateLimitError(GrownError):
    """Grown rate-limited the request (HTTP 429)."""


class GrownApiError(GrownError):
    """Any other non-2xx answer, or an unparseable body."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


def normalize_url(url: str) -> str:
    """Return ``scheme://host[:port][/path]`` without a trailing slash.

    Raises ValueError for anything that is not an absolute http(s) URL.
    """
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError(f"not an http(s) URL: {url!r}")
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), "", ""))


@dataclass(slots=True)
class GrownAccount:
    """Who a token belongs to (the integrations/homeassistant/info answer)."""

    user_id: str
    email: str
    name: str
    org_id: str
    org_name: str
    scopes: list[str] = field(default_factory=list)
    version: str = ""

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> GrownAccount:
        return cls(
            user_id=str(data.get("user_id") or ""),
            email=str(data.get("email") or ""),
            name=str(data.get("name") or ""),
            org_id=str(data.get("org_id") or ""),
            org_name=str(data.get("org_name") or ""),
            scopes=[str(s) for s in data.get("scopes") or []],
            version=str(data.get("version") or ""),
        )


class GrownClient:
    """Thin async wrapper around the Grown endpoints this integration uses."""

    def __init__(self, session: aiohttp.ClientSession, base_url: str, token: str) -> None:
        self._session = session
        self.base_url = normalize_url(base_url)
        self._token = token.strip()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
        }
        try:
            async with self._session.request(
                method,
                url,
                params=params,
                json=json,
                headers=headers,
                timeout=REQUEST_TIMEOUT,
                allow_redirects=False,
            ) as resp:
                body = await resp.text()
                if resp.status in (401, 403):
                    raise GrownAuthError(f"HTTP {resp.status}: {body.strip()[:200]}")
                if resp.status == 404:
                    raise GrownNotFoundError(f"{method} {path}: not found")
                if resp.status == 429:
                    raise GrownRateLimitError(body.strip()[:200] or "rate limited")
                if resp.status >= 300:
                    raise GrownApiError(resp.status, body.strip()[:200])
                if not body:
                    return {}
                try:
                    return await resp.json(content_type=None)
                except ValueError as err:
                    raise GrownApiError(resp.status, f"invalid JSON: {err}") from err
        except (aiohttp.ClientConnectionError, asyncio.TimeoutError) as err:
            raise GrownConnectionError(f"{method} {url}: {err}") from err

    # ----- identity -------------------------------------------------------

    async def async_get_account(self) -> GrownAccount:
        """GET /api/v1/integrations/homeassistant/info."""
        data = await self._request("GET", "/api/v1/integrations/homeassistant/info")
        account = GrownAccount.from_json(data)
        if not account.user_id:
            raise GrownApiError(200, "info response has no user_id")
        return account

    # ----- notifications --------------------------------------------------

    async def async_unread_count(self) -> int:
        data = await self._request("GET", "/api/v1/notifications/unread-count")
        # int64 is a JSON string under protojson.
        return int(data.get("count") or 0)

    async def async_push_notification(
        self, title: str, message: str, link: str | None = None
    ) -> str:
        """POST /api/v1/notifications/push; returns the new notification id."""
        payload: dict[str, str] = {"title": title, "message": message}
        if link:
            payload["link"] = link
        data = await self._request("POST", "/api/v1/notifications/push", json=payload)
        return str(data.get("id") or "")

    # ----- tasks ----------------------------------------------------------

    async def async_list_task_lists(self) -> list[dict[str, Any]]:
        data = await self._request("GET", "/api/v1/tasks/lists")
        return list(data.get("lists") or [])

    async def async_list_tasks(self, list_id: str) -> list[dict[str, Any]]:
        data = await self._request("GET", f"/api/v1/tasks/lists/{list_id}/tasks")
        return list(data.get("tasks") or [])

    async def async_create_task(
        self, list_id: str, title: str, notes: str = "", due_at: str = ""
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/api/v1/tasks/lists/{list_id}/tasks",
            json={"title": title, "notes": notes, "due_at": due_at},
        )

    async def async_update_task(
        self,
        list_id: str,
        task_id: str,
        *,
        title: str,
        notes: str,
        due_at: str,
        parent_task_id: str = "",
    ) -> dict[str, Any]:
        """PATCH a task. Grown replaces every field, so send them all."""
        return await self._request(
            "PATCH",
            f"/api/v1/tasks/lists/{list_id}/tasks/{task_id}",
            json={
                "title": title,
                "notes": notes,
                "due_at": due_at,
                "parent_task_id": parent_task_id,
            },
        )

    async def async_toggle_task(self, list_id: str, task_id: str) -> dict[str, Any]:
        return await self._request(
            "POST", f"/api/v1/tasks/lists/{list_id}/tasks/{task_id}/toggle", json={}
        )

    async def async_reorder_task(
        self, list_id: str, task_id: str, position: int
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/api/v1/tasks/lists/{list_id}/tasks/{task_id}/reorder",
            json={"position": position},
        )

    async def async_delete_task(self, list_id: str, task_id: str) -> None:
        await self._request("DELETE", f"/api/v1/tasks/lists/{list_id}/tasks/{task_id}")

    # ----- calendar -------------------------------------------------------

    async def async_list_events(self, time_min: str, time_max: str) -> list[dict[str, Any]]:
        """Events (recurring ones expanded) overlapping [time_min, time_max)."""
        data = await self._request(
            "GET",
            "/api/v1/calendar/events",
            params={"time_min": time_min, "time_max": time_max},
        )
        return list(data.get("events") or [])

    async def async_get_event(self, event_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/api/v1/calendar/events/{event_id}")

    async def async_create_event(self, event: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/v1/calendar/events", json=event)

    async def async_update_event(self, event_id: str, event: dict[str, Any]) -> dict[str, Any]:
        return await self._request("PATCH", f"/api/v1/calendar/events/{event_id}", json=event)

    async def async_delete_event(
        self, event_id: str, *, scope: str | None = None, original_start: str | None = None
    ) -> None:
        params: dict[str, str] = {}
        if scope:
            params["scope"] = scope
        if original_start:
            params["original_start"] = original_start
        await self._request(
            "DELETE", f"/api/v1/calendar/events/{event_id}", params=params or None
        )
