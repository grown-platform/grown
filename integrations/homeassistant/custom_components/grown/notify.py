"""Push Home Assistant notifications into Grown.

``notify.send_message`` on this entity creates a notification for the Grown
user who owns the API token (POST /api/v1/notifications/push); it shows up in
Grown's notification bell like any other.
"""

from __future__ import annotations

from homeassistant.components.notify import NotifyEntity, NotifyEntityFeature
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .api import GrownAuthError, GrownError, GrownNotFoundError, GrownRateLimitError
from .const import DEFAULT_PUSH_TITLE, PUSH_MESSAGE_MAX, PUSH_TITLE_MAX
from .coordinator import GrownConfigEntry, GrownCoordinator
from .entity import GrownEntity

# Sends are serialized: Grown rate-limits pushes per token.
PARALLEL_UPDATES = 1


def _clip(text: str, limit: int) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: GrownConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the Grown notify entity."""
    async_add_entities([GrownNotifyEntity(entry.runtime_data.coordinator)])


class GrownNotifyEntity(GrownEntity, NotifyEntity):
    """Sends a notification to the connected Grown user."""

    _attr_translation_key = "notifications"
    _attr_supported_features = NotifyEntityFeature.TITLE

    def __init__(self, coordinator: GrownCoordinator) -> None:
        super().__init__(coordinator, "notify")

    async def async_send_message(self, message: str, title: str | None = None) -> None:
        """Push one notification into Grown."""
        title = _clip(title or DEFAULT_PUSH_TITLE, PUSH_TITLE_MAX) or DEFAULT_PUSH_TITLE
        body = _clip(message, PUSH_MESSAGE_MAX)
        try:
            await self.coordinator.client.async_push_notification(title, body)
        except GrownRateLimitError as err:
            wait = f"; retry in {err.retry_after}s" if err.retry_after else ""
            raise HomeAssistantError(
                f"Grown is rate-limiting notifications from this token (60 per minute{wait})"
            ) from err
        except GrownAuthError as err:
            self.coordinator.config_entry.async_start_reauth(self.hass)
            raise HomeAssistantError(
                "Grown rejected the API token (it needs the notifications:write scope)"
            ) from err
        except GrownNotFoundError as err:
            raise HomeAssistantError(
                "This Grown server has no notification push endpoint (Grown 0.4 or later is needed)"
            ) from err
        except GrownError as err:
            raise HomeAssistantError(f"Could not send the notification to Grown: {err}") from err
