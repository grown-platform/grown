"""Grown task lists as Home Assistant to-do lists (one entity per list)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .api import GrownError
from .coordinator import GrownConfigEntry, GrownCoordinator, format_task_due, parse_task_due
from .entity import GrownEntity

PARALLEL_UPDATES = 0


def item_from_task(task: dict[str, Any]) -> TodoItem:
    """Convert a Grown Task (JSON) into a TodoItem."""
    return TodoItem(
        summary=task.get("title") or "",
        uid=task["id"],
        status=TodoItemStatus.COMPLETED if task.get("completed") else TodoItemStatus.NEEDS_ACTION,
        due=parse_task_due(task.get("due_at") or ""),
        description=task.get("notes") or None,
    )


async def async_setup_entry(
    hass: HomeAssistant,
    entry: GrownConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Create a to-do entity per Grown task list; follow lists as they change."""
    coordinator = entry.runtime_data.coordinator
    known: set[str] = set()

    @callback
    def _sync_lists() -> None:
        current = set(coordinator.data.task_lists)
        added = current - known
        if added:
            known.update(added)
            async_add_entities(GrownTodoListEntity(coordinator, list_id) for list_id in added)
        removed = known - current
        if removed:
            registry = er.async_get(hass)
            for list_id in removed:
                known.discard(list_id)
                unique_id = f"{entry.entry_id}_tasklist_{list_id}"
                if entity_id := registry.async_get_entity_id("todo", "grown", unique_id):
                    registry.async_remove(entity_id)

    _sync_lists()
    entry.async_on_unload(coordinator.async_add_listener(_sync_lists))


class GrownTodoListEntity(GrownEntity, TodoListEntity):
    """One Grown task list."""

    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
        | TodoListEntityFeature.MOVE_TODO_ITEM
        | TodoListEntityFeature.SET_DUE_DATE_ON_ITEM
        | TodoListEntityFeature.SET_DUE_DATETIME_ON_ITEM
        | TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM
    )

    def __init__(self, coordinator: GrownCoordinator, list_id: str) -> None:
        super().__init__(coordinator, f"tasklist_{list_id}")
        self._list_id = list_id

    @property
    def available(self) -> bool:
        return super().available and self._list_id in self.coordinator.data.task_lists

    @property
    def name(self) -> str | None:
        task_list = self.coordinator.data.task_lists.get(self._list_id)
        return (task_list or {}).get("name") or "Tasks"

    @property
    def todo_items(self) -> list[TodoItem] | None:
        tasks = self.coordinator.data.tasks.get(self._list_id)
        if tasks is None:
            return None
        return [item_from_task(t) for t in tasks]

    def _task(self, uid: str) -> dict[str, Any]:
        for task in self.coordinator.data.tasks.get(self._list_id, []):
            if task["id"] == uid:
                return task
        raise HomeAssistantError(f"Task {uid} is not in this Grown list")

    async def async_create_todo_item(self, item: TodoItem) -> None:
        client = self.coordinator.client
        try:
            created = await client.async_create_task(
                self._list_id,
                item.summary or "",
                notes=item.description or "",
                due_at=format_task_due(item.due),
            )
            if item.status == TodoItemStatus.COMPLETED:
                await client.async_toggle_task(self._list_id, created["id"])
        except GrownError as err:
            raise HomeAssistantError(f"Could not create the Grown task: {err}") from err
        await self.coordinator.async_request_refresh()

    async def async_update_todo_item(self, item: TodoItem) -> None:
        if item.uid is None:
            raise HomeAssistantError("Missing task id")
        current = self._task(item.uid)
        client = self.coordinator.client
        try:
            await client.async_update_task(
                self._list_id,
                item.uid,
                title=item.summary if item.summary is not None else current.get("title") or "",
                notes=item.description or "",
                due_at=format_task_due(item.due),
                parent_task_id=current.get("parent_task_id") or "",
            )
            want_done = item.status == TodoItemStatus.COMPLETED
            if item.status is not None and want_done != bool(current.get("completed")):
                await client.async_toggle_task(self._list_id, item.uid)
        except GrownError as err:
            raise HomeAssistantError(f"Could not update the Grown task: {err}") from err
        await self.coordinator.async_request_refresh()

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        try:
            for uid in uids:
                await self.coordinator.client.async_delete_task(self._list_id, uid)
        except GrownError as err:
            raise HomeAssistantError(f"Could not delete the Grown task: {err}") from err
        await self.coordinator.async_request_refresh()

    async def async_move_todo_item(self, uid: str, previous_uid: str | None = None) -> None:
        """Move ``uid`` right after ``previous_uid`` (or to the top)."""
        order = [t["id"] for t in self.coordinator.data.tasks.get(self._list_id, [])]
        if uid not in order:
            raise HomeAssistantError(f"Task {uid} is not in this Grown list")
        order.remove(uid)
        position = 0
        if previous_uid is not None:
            if previous_uid not in order:
                raise HomeAssistantError(f"Task {previous_uid} is not in this Grown list")
            position = order.index(previous_uid) + 1
        try:
            await self.coordinator.client.async_reorder_task(self._list_id, uid, position)
        except GrownError as err:
            raise HomeAssistantError(f"Could not move the Grown task: {err}") from err
        await self.coordinator.async_request_refresh()
