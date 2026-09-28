"""The Grown Workspace integration.

Connects Home Assistant to a Grown Workspace server with a personal API token:
Grown Calendar becomes a calendar entity, every Grown task list a to-do list,
unread notifications / open tasks become sensors, and a notify entity lets
automations push notifications into Grown.
"""

from __future__ import annotations

import aiohttp

from homeassistant.const import CONF_TOKEN, CONF_URL, Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers.aiohttp_client import async_create_clientsession

from .api import GrownAuthError, GrownClient, GrownError
from .coordinator import GrownConfigEntry, GrownCoordinator, GrownRuntimeData

PLATFORMS: list[Platform] = [
    Platform.CALENDAR,
    Platform.NOTIFY,
    Platform.SENSOR,
    Platform.TODO,
]


async def async_setup_entry(hass: HomeAssistant, entry: GrownConfigEntry) -> bool:
    """Set up Grown from a config entry."""
    # Own session with no cookie jar: Grown authenticates a session cookie in
    # preference to the bearer token, so cookies must never be replayed. HA
    # detaches it when the entry unloads.
    session = async_create_clientsession(hass, cookie_jar=aiohttp.DummyCookieJar())
    client = GrownClient(session, entry.data[CONF_URL], entry.data[CONF_TOKEN])
    try:
        # None on Grown older than 0.4 (no info/push endpoints): everything but
        # the identity lookup and notify still works.
        account = await client.async_get_account_or_none()
    except GrownAuthError as err:
        raise ConfigEntryAuthFailed(f"Grown rejected the API token: {err}") from err
    except GrownError as err:
        raise ConfigEntryNotReady(f"Cannot reach Grown: {err}") from err

    coordinator = GrownCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = GrownRuntimeData(client=client, coordinator=coordinator, account=account)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: GrownConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
