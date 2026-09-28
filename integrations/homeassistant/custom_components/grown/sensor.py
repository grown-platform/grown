"""Grown counters as sensors."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from homeassistant.components.sensor import (
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .coordinator import GrownConfigEntry, GrownCoordinator, GrownData
from .entity import GrownEntity

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class GrownSensorDescription(SensorEntityDescription):
    """Describes a Grown counter."""

    value_fn: Callable[[GrownData], int]


SENSORS: tuple[GrownSensorDescription, ...] = (
    GrownSensorDescription(
        key="unread_notifications",
        translation_key="unread_notifications",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.unread_notifications,
    ),
    GrownSensorDescription(
        key="open_tasks",
        translation_key="open_tasks",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.open_tasks,
    ),
    GrownSensorDescription(
        key="overdue_tasks",
        translation_key="overdue_tasks",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.overdue_tasks(dt_util.utcnow()),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: GrownConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up Grown sensors."""
    coordinator = entry.runtime_data.coordinator
    async_add_entities(GrownSensor(coordinator, description) for description in SENSORS)


class GrownSensor(GrownEntity, SensorEntity):
    """A Grown counter."""

    entity_description: GrownSensorDescription

    def __init__(self, coordinator: GrownCoordinator, description: GrownSensorDescription) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def native_value(self) -> int:
        return self.entity_description.value_fn(self.coordinator.data)
