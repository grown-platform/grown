"""Config flow for the Grown Workspace integration."""

from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any
from urllib.parse import urlsplit

import aiohttp
import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_TOKEN, CONF_URL
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_create_clientsession
from homeassistant.helpers.selector import (
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .api import (
    GrownAuthError,
    GrownClient,
    GrownConnectionError,
    GrownError,
    normalize_url,
)
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

FLOW_SESSION_KEY = f"{DOMAIN}_flow_session"


def _flow_session(hass: HomeAssistant) -> aiohttp.ClientSession:
    """One cookie-less session for all Grown config flows (closed at HA stop).

    Never the shared HA session: a cookie Grown set there would be replayed
    and win over the token being validated.
    """
    session = hass.data.get(FLOW_SESSION_KEY)
    if session is None or session.closed:
        session = async_create_clientsession(hass, cookie_jar=aiohttp.DummyCookieJar())
        hass.data[FLOW_SESSION_KEY] = session
    return session


TOKEN_SELECTOR = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))
URL_SELECTOR = TextSelector(TextSelectorConfig(type=TextSelectorType.URL))


class _ValidationResult:
    __slots__ = ("title", "unique_id", "url")

    def __init__(self, url: str, title: str, unique_id: str) -> None:
        self.url = url
        self.title = title
        self.unique_id = unique_id


class GrownConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Grown Workspace."""

    VERSION = 1

    async def _async_validate(
        self, url: str, token: str, errors: dict[str, str]
    ) -> _ValidationResult | None:
        """Check URL + token against Grown; fill ``errors`` on failure."""
        try:
            url = normalize_url(url)
        except ValueError:
            errors[CONF_URL] = "invalid_url"
            return None
        if not token.strip():
            errors[CONF_TOKEN] = "invalid_auth"
            return None
        client = GrownClient(_flow_session(self.hass), url, token)
        try:
            account = await client.async_get_account_or_none()
            if account is None:
                # Pre-0.4 Grown without the Home Assistant endpoints (the token
                # was proven on unread-count): key the entry by server URL
                # instead of the Grown user.
                host = urlsplit(url).netloc
                return _ValidationResult(url, f"Grown ({host})", f"url:{url}")
        except GrownAuthError:
            errors["base"] = "invalid_auth"
        except GrownConnectionError:
            errors["base"] = "cannot_connect"
        except GrownError as err:
            _LOGGER.warning("Unexpected answer from Grown at %s: %s", url, err)
            errors["base"] = "cannot_connect"
        except Exception:
            _LOGGER.exception("Unexpected error validating Grown at %s", url)
            errors["base"] = "unknown"
        else:
            title = account.org_name or account.email or urlsplit(url).netloc
            return _ValidationResult(url, title, account.user_id)
        return None

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for the Grown URL and an API token."""
        errors: dict[str, str] = {}
        if user_input is not None:
            result = await self._async_validate(
                user_input[CONF_URL], user_input[CONF_TOKEN], errors
            )
            if result is not None:
                await self.async_set_unique_id(result.unique_id)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=result.title,
                    data={CONF_URL: result.url, CONF_TOKEN: user_input[CONF_TOKEN].strip()},
                )
        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(
                vol.Schema(
                    {
                        vol.Required(CONF_URL): URL_SELECTOR,
                        vol.Required(CONF_TOKEN): TOKEN_SELECTOR,
                    }
                ),
                user_input,
            ),
            errors=errors,
        )

    async def async_step_reauth(
        self, entry_data: Mapping[str, Any]
    ) -> ConfigFlowResult:
        """Grown rejected the stored token: ask for a new one."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Validate a replacement token against the same Grown server."""
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            result = await self._async_validate(
                entry.data[CONF_URL], user_input[CONF_TOKEN], errors
            )
            if result is not None:
                await self.async_set_unique_id(result.unique_id)
                self._abort_if_unique_id_mismatch(reason="wrong_account")
                return self.async_update_reload_and_abort(
                    entry, data_updates={CONF_TOKEN: user_input[CONF_TOKEN].strip()}
                )
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required(CONF_TOKEN): TOKEN_SELECTOR}),
            description_placeholders={"url": entry.data[CONF_URL], "name": entry.title},
            errors=errors,
        )

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Change the Grown URL (and optionally the token) of an entry."""
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            token = user_input.get(CONF_TOKEN) or entry.data[CONF_TOKEN]
            result = await self._async_validate(user_input[CONF_URL], token, errors)
            if result is not None:
                await self.async_set_unique_id(result.unique_id)
                self._abort_if_unique_id_mismatch(reason="wrong_account")
                return self.async_update_reload_and_abort(
                    entry, data_updates={CONF_URL: result.url, CONF_TOKEN: token.strip()}
                )
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=self.add_suggested_values_to_schema(
                vol.Schema(
                    {
                        vol.Required(CONF_URL): URL_SELECTOR,
                        vol.Optional(CONF_TOKEN): TOKEN_SELECTOR,
                    }
                ),
                {CONF_URL: entry.data[CONF_URL]},
            ),
            errors=errors,
        )
