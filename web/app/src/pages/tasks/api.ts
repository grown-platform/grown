import type {
  TaskList,
  Task,
  ListTaskListsResponse,
  ListTasksResponse,
  TaskListInput,
  TaskInput,
} from "./types";

const API_BASE = "/api/v1";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

// ----- Task lists -----

export async function listTaskLists(): Promise<TaskList[]> {
  const r = await jsonFetch<ListTaskListsResponse>("/tasks/lists");
  return r.lists ?? [];
}

export function createTaskList(input: TaskListInput): Promise<TaskList> {
  return jsonFetch<TaskList>("/tasks/lists", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTaskList(
  id: string,
  input: TaskListInput,
): Promise<TaskList> {
  return jsonFetch<TaskList>(`/tasks/lists/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteTaskList(id: string): Promise<void> {
  await jsonFetch<unknown>(`/tasks/lists/${id}`, { method: "DELETE" });
}

// ----- Tasks -----

export async function listTasks(listId: string): Promise<Task[]> {
  const r = await jsonFetch<ListTasksResponse>(`/tasks/lists/${listId}/tasks`);
  return r.tasks ?? [];
}

export function createTask(
  listId: string,
  input: Partial<TaskInput>,
): Promise<Task> {
  return jsonFetch<Task>(`/tasks/lists/${listId}/tasks`, {
    method: "POST",
    body: JSON.stringify({ list_id: listId, ...input }),
  });
}

export function updateTask(
  listId: string,
  id: string,
  input: Partial<TaskInput>,
): Promise<Task> {
  return jsonFetch<Task>(`/tasks/lists/${listId}/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ list_id: listId, ...input }),
  });
}

export async function deleteTask(listId: string, id: string): Promise<void> {
  await jsonFetch<unknown>(`/tasks/lists/${listId}/tasks/${id}`, {
    method: "DELETE",
  });
}

export function toggleTask(listId: string, id: string): Promise<Task> {
  return jsonFetch<Task>(`/tasks/lists/${listId}/tasks/${id}/toggle`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function reorderTask(
  listId: string,
  id: string,
  position: number,
): Promise<Task> {
  return jsonFetch<Task>(`/tasks/lists/${listId}/tasks/${id}/reorder`, {
    method: "POST",
    body: JSON.stringify({ list_id: listId, position }),
  });
}
