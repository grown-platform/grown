"""Base entity for the Grown Workspace integration."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, MANUFACTURER
from .coordinator import GrownCoordinator


class GrownEntity(CoordinatorEntity[GrownCoordinator]):
    """An entity that belongs to one Grown account (one config entry)."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: GrownCoordinator, key: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        runtime = getattr(entry, "runtime_data", None)
        account = runtime.account if runtime is not None else None
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer=MANUFACTURER,
            model=account.email if account and account.email else None,
            sw_version=account.version if account and account.version else None,
            entry_type=DeviceEntryType.SERVICE,
            configuration_url=coordinator.client.base_url,
        )
