/** TaskList mirrors grownv1.TaskList (proto snake_case via the gateway). */
export interface TaskList {
  id: string;
  org_id: string;
  owner_user_id: string;
  name: string;
  position: number;
  created_at: string;
}

/** Task mirrors grownv1.Task (proto snake_case via the gateway). */
export interface Task {
  id: string;
  org_id: string;
  list_id: string;
  owner_user_id: string;
  title: string;
  notes: string;
  /** RFC-3339 or empty string. */
  due_at: string;
  completed: boolean;
  completed_at: string;
  /** Empty string when not a subtask. */
  parent_task_id: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ListTaskListsResponse {
  lists: TaskList[];
}

export interface ListTasksResponse {
  tasks: Task[];
}

/** TaskListInput is the editable subset sent on create/update. */
export interface TaskListInput {
  name: string;
}

/** TaskInput is the editable subset sent on create/update. */
export interface TaskInput {
  title: string;
  notes: string;
  due_at: string;
  parent_task_id: string;
}
