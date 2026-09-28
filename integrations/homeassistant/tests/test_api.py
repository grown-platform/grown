"""GrownClient: request shapes, auth header, error mapping."""

from __future__ import annotations

import asyncio

import aiohttp
import pytest

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.grown.api import (
    GrownApiError,
    GrownAuthError,
    GrownClient,
    GrownConnectionError,
    GrownNotFoundError,
    GrownRateLimitError,
    normalize_url,
)

from .conftest import API, INFO, TOKEN, URL


def client(hass: HomeAssistant, url: str = URL) -> GrownClient:
    return GrownClient(async_get_clientsession(hass), url, TOKEN)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://grown.example.com/", "https://grown.example.com"),
        (" http://10.0.0.5:8080 ", "http://10.0.0.5:8080"),
        ("https://example.com/grown/?x=1#y", "https://example.com/grown"),
    ],
)
def test_normalize_url(raw: str, expected: str) -> None:
    assert normalize_url(raw) == expected


@pytest.mark.parametrize("raw", ["grown.example.com", "ftp://x", "https://", ""])
def test_normalize_url_rejects(raw: str) -> None:
    with pytest.raises(ValueError):
        normalize_url(raw)


async def test_account_and_bearer_header(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(f"{API}/integrations/homeassistant/info", json=INFO)
    account = await client(hass, URL + "/").async_get_account()
    assert account.user_id == "user-1"
    assert account.org_name == "Acme Household"
    assert "notifications:write" in account.scopes
    headers = aioclient_mock.mock_calls[0][3]
    assert headers["Authorization"] == f"Bearer {TOKEN}"


async def test_unread_count_parses_int64_string(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(f"{API}/notifications/unread-count", json={"count": "12"})
    assert await client(hass).async_unread_count() == 12


@pytest.mark.parametrize(
    ("status", "exc"),
    [
        (401, GrownAuthError),
        (403, GrownAuthError),
        (404, GrownNotFoundError),
        (429, GrownRateLimitError),
        (500, GrownApiError),
    ],
)
async def test_status_mapping(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, status: int, exc: type) -> None:
    aioclient_mock.get(f"{API}/tasks/lists", status=status, text="nope")
    with pytest.raises(exc):
        await client(hass).async_list_task_lists()


@pytest.mark.parametrize("error", [aiohttp.ClientConnectionError(), asyncio.TimeoutError()])
async def test_connection_errors(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, error: Exception) -> None:
    aioclient_mock.get(f"{API}/tasks/lists", exc=error)
    with pytest.raises(GrownConnectionError):
        await client(hass).async_list_task_lists()


async def test_push_payload(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.post(f"{API}/notifications/push", status=201, json={"id": "n-1"})
    got = await client(hass).async_push_notification("Door", "Front door opened", link="https://ha/x")
    assert got == "n-1"
    assert aioclient_mock.mock_calls[0][2] == {
        "title": "Door",
        "message": "Front door opened",
        "link": "https://ha/x",
    }


async def test_push_omits_empty_link(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.post(f"{API}/notifications/push", status=201, json={"id": "n-2"})
    await client(hass).async_push_notification("T", "M")
    assert aioclient_mock.mock_calls[0][2] == {"title": "T", "message": "M"}


async def test_events_query_and_delete_scope(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(f"{API}/calendar/events", json={"events": []})
    aioclient_mock.delete(f"{API}/calendar/events/ev-1", json={})
    c = client(hass)
    await c.async_list_events("2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z")
    url = aioclient_mock.mock_calls[0][1]
    assert url.query["time_min"] == "2026-09-01T00:00:00Z"
    assert url.query["time_max"] == "2026-09-02T00:00:00Z"
    await c.async_delete_event("ev-1", scope="EDIT_SCOPE_THIS_EVENT", original_start="2026-09-01T10:00:00Z")
    url = aioclient_mock.mock_calls[1][1]
    assert url.query["scope"] == "EDIT_SCOPE_THIS_EVENT"
    assert url.query["original_start"] == "2026-09-01T10:00:00Z"


async def test_update_task_sends_all_fields(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.patch(f"{API}/tasks/lists/l/tasks/t", json={"id": "t"})
    await client(hass).async_update_task("l", "t", title="A", notes="", due_at="")
    assert aioclient_mock.mock_calls[0][2] == {
        "title": "A",
        "notes": "",
        "due_at": "",
        "parent_task_id": "",
    }


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ('{"error":"title must be 1-200 characters"}', "title must be 1-200 characters"),
        ('{"code":3,"message":"start_at must be RFC3339"}', "start_at must be RFC3339"),
        ("plain failure", "plain failure"),
    ],
)
async def test_error_body_detail(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, body: str, expected: str
) -> None:
    aioclient_mock.post(f"{API}/notifications/push", status=400, text=body)
    with pytest.raises(GrownApiError, match=expected):
        await client(hass).async_push_notification("t", "m")


async def test_rate_limit_retry_after(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.post(
        f"{API}/notifications/push", status=429,
        text='{"error":"rate limit exceeded"}', headers={"Retry-After": "60"},
    )
    with pytest.raises(GrownRateLimitError) as info:
        await client(hass).async_push_notification("t", "m")
    assert info.value.retry_after == 60
    assert "rate limit exceeded" in str(info.value)
