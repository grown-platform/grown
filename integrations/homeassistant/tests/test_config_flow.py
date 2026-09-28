"""Config flow: user step, legacy fallback, reauth, reconfigure."""

from __future__ import annotations

import aiohttp
import pytest

from homeassistant.config_entries import SOURCE_USER
from homeassistant.const import CONF_TOKEN, CONF_URL
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.grown.const import DOMAIN

from .conftest import API, INFO, TOKEN, URL


@pytest.fixture(autouse=True)
def no_setup(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep flows from actually setting up the entry they create."""

    async def _ok(*_args, **_kwargs) -> bool:
        return True

    monkeypatch.setattr("custom_components.grown.async_setup_entry", _ok)


async def _start(hass: HomeAssistant) -> dict:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"
    return result


async def test_user_flow_creates_entry_titled_by_org(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    aioclient_mock.get(f"{API}/integrations/homeassistant/info", json=INFO)
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: URL + "/", CONF_TOKEN: f"  {TOKEN} "}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Acme Household"
    assert result["data"] == {CONF_URL: URL, CONF_TOKEN: TOKEN}
    assert result["result"].unique_id == "user-1"


@pytest.mark.parametrize(
    ("mock_kwargs", "error"),
    [
        ({"status": 401}, "invalid_auth"),
        ({"status": 403}, "invalid_auth"),
        ({"status": 502}, "cannot_connect"),
        ({"exc": aiohttp.ClientConnectionError()}, "cannot_connect"),
    ],
)
async def test_user_flow_errors_then_recovers(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, mock_kwargs: dict, error: str
) -> None:
    aioclient_mock.get(f"{API}/integrations/homeassistant/info", **mock_kwargs)
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: URL, CONF_TOKEN: TOKEN}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": error}

    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/integrations/homeassistant/info", json=INFO)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: URL, CONF_TOKEN: TOKEN}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def test_user_flow_invalid_url(hass: HomeAssistant) -> None:
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: "grown.example.com", CONF_TOKEN: TOKEN}
    )
    assert result["errors"] == {CONF_URL: "invalid_url"}


async def test_user_flow_legacy_grown_without_info(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    """Pre-0.4 Grown (no info endpoint): validate via unread-count, key by URL."""
    aioclient_mock.get(f"{API}/integrations/homeassistant/info", status=404)
    aioclient_mock.get(f"{API}/notifications/unread-count", json={"count": "0"})
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: URL, CONF_TOKEN: TOKEN}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Grown (grown.example.com)"
    assert result["result"].unique_id == f"url:{URL}"


async def test_user_flow_already_configured(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, config_entry: MockConfigEntry
) -> None:
    config_entry.add_to_hass(hass)
    aioclient_mock.get(f"{API}/integrations/homeassistant/info", json=INFO)
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: URL, CONF_TOKEN: TOKEN}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_reauth_updates_token(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, config_entry: MockConfigEntry
) -> None:
    config_entry.add_to_hass(hass)
    result = await config_entry.start_reauth_flow(hass)
    assert result["step_id"] == "reauth_confirm"
    aioclient_mock.get(f"{API}/integrations/homeassistant/info", json=INFO)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "grw_new"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reauth_successful"
    assert config_entry.data[CONF_TOKEN] == "grw_new"
    assert config_entry.data[CONF_URL] == URL


async def test_reauth_rejects_other_account(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, config_entry: MockConfigEntry
) -> None:
    config_entry.add_to_hass(hass)
    result = await config_entry.start_reauth_flow(hass)
    aioclient_mock.get(
        f"{API}/integrations/homeassistant/info", json={**INFO, "user_id": "someone-else"}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "grw_other"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "wrong_account"
    assert config_entry.data[CONF_TOKEN] == TOKEN


async def test_reauth_bad_token_shows_error(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, config_entry: MockConfigEntry
) -> None:
    config_entry.add_to_hass(hass)
    result = await config_entry.start_reauth_flow(hass)
    aioclient_mock.get(f"{API}/integrations/homeassistant/info", status=401)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "grw_bad"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_auth"}


async def test_reconfigure_changes_url_keeps_token(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, config_entry: MockConfigEntry
) -> None:
    config_entry.add_to_hass(hass)
    new_url = "https://grown.internal:8443"
    aioclient_mock.get(f"{new_url}/api/v1/integrations/homeassistant/info", json=INFO)
    result = await config_entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: new_url + "/"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reconfigure_successful"
    assert config_entry.data == {CONF_URL: new_url, CONF_TOKEN: TOKEN}
