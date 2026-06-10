import { useEffect, useRef, useState } from "react";
import {
  Box,
  Container,
  Typography,
  Input,
  Sheet,
  IconButton,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Divider,
  Checkbox,
  Button,
  Tooltip,
  Modal,
  ModalDialog,
  Textarea,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listTaskLists,
  createTaskList,
  updateTaskList,
  deleteTaskList,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  toggleTask,
} from "./api";
import type { TaskList, Task } from "./types";

interface TasksAppProps {
  user: User;
}

export default function TasksApp({ user }: TasksAppProps) {
  const [lists, setLists] = useState<TaskList[] | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedExpanded, setCompletedExpanded] = useState(false);

  // New list input
  const [newListName, setNewListName] = useState("");
  const [addingList, setAddingList] = useState(false);

  // Rename list modal
  const [renaming, setRenaming] = useState<TaskList | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // New task input
  const [newTaskTitle, setNewTaskTitle] = useState("");

  // Edit task modal
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDueAt, setEditDueAt] = useState("");

  const newTaskRef = useRef<HTMLInputElement>(null);

  async function reloadLists() {
    try {
      const ls = await listTaskLists();
      setLists(ls);
      if (ls.length > 0 && !selectedListId) {
        setSelectedListId(ls[0].id);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function reloadTasks(listId: string) {
    setLoadingTasks(true);
    try {
      const ts = await listTasks(listId);
      setTasks(ts);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingTasks(false);
    }
  }

  useEffect(() => {
    reloadLists();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedListId) reloadTasks(selectedListId);
    else setTasks([]);
  }, [selectedListId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedList =
    (lists ?? []).find((l) => l.id === selectedListId) ?? null;

  // Partition tasks
  const activeTasks = tasks.filter((t) => !t.completed && !t.parent_task_id);
  const subtasksFor = (parentId: string) =>
    tasks.filter((t) => t.parent_task_id === parentId);
  const completedTasks = tasks.filter((t) => t.completed);

  // ---- Optimistic mutations ----
  function patchTask(id: string, patch: Partial<Task>) {
    setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function handleToggle(task: Task) {
    patchTask(task.id, {
      completed: !task.completed,
      completed_at: !task.completed ? new Date().toISOString() : "",
    });
    try {
      const updated = await toggleTask(task.list_id, task.id);
      patchTask(task.id, updated);
    } catch {
      if (selectedListId) reloadTasks(selectedListId);
    }
  }

  async function handleDeleteTask(task: Task) {
    setTasks((cur) => cur.filter((t) => t.id !== task.id));
    try {
      await deleteTask(task.list_id, task.id);
    } catch {
      if (selectedListId) reloadTasks(selectedListId);
    }
  }

  async function handleAddTask() {
    const title = newTaskTitle.trim();
    if (!title || !selectedListId) return;
    setNewTaskTitle("");
    try {
      const t = await createTask(selectedListId, { title });
      setTasks((cur) => [...cur, t]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleSaveEdit() {
    if (!editingTask) return;
    const updated = await updateTask(editingTask.list_id, editingTask.id, {
      title: editTitle,
      notes: editNotes,
      due_at: editDueAt,
    });
    patchTask(editingTask.id, updated);
    setEditingTask(null);
  }

  function openEdit(task: Task) {
    setEditingTask(task);
    setEditTitle(task.title);
    setEditNotes(task.notes);
    setEditDueAt(task.due_at ? task.due_at.slice(0, 10) : "");
  }

  // ---- List management ----
  async function handleAddList() {
    const name = newListName.trim();
    if (!name) return;
    setNewListName("");
    setAddingList(false);
    try {
      const l = await createTaskList({ name });
      setLists((cur) => [...(cur ?? []), l]);
      setSelectedListId(l.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleRenameList() {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) return;
    try {
      const updated = await updateTaskList(renaming.id, { name });
      setLists((cur) =>
        (cur ?? []).map((l) => (l.id === updated.id ? updated : l)),
      );
      setRenaming(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDeleteList(list: TaskList) {
    if (!window.confirm(`Delete list "${list.name}" and all its tasks?`))
      return;
    try {
      await deleteTaskList(list.id);
      setLists((cur) => (cur ?? []).filter((l) => l.id !== list.id));
      if (selectedListId === list.id) {
        const remaining = (lists ?? []).filter((l) => l.id !== list.id);
        setSelectedListId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <Header user={user} />
      <Container
        maxWidth="lg"
        sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1.5, sm: 3 } }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <TaskAltIcon sx={{ fontSize: 28, color: "primary.main" }} />
          <Typography
            level="h2"
            sx={{ flex: 1, fontSize: { xs: "xl", sm: "xl3" } }}
          >
            Tasks
          </Typography>
        </Box>

        {error && (
          <Sheet
            color="danger"
            variant="soft"
            sx={{ p: 2, mb: 2, borderRadius: "md" }}
          >
            <Typography color="danger">{error}</Typography>
          </Sheet>
        )}

        <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
          {/* Left panel: task lists */}
          <Sheet
            variant="outlined"
            sx={{
              width: 220,
              flexShrink: 0,
              borderRadius: "md",
              display: { xs: "none", sm: "flex" },
              flexDirection: "column",
            }}
          >
            <Typography
              level="body-xs"
              sx={{
                px: 2,
                pt: 1.5,
                pb: 0.5,
                opacity: 0.6,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              My lists
            </Typography>
            <List
              size="sm"
              sx={{ "--ListItem-radius": "6px", px: 0.5, pb: 0.5 }}
            >
              {(lists ?? []).map((l) => (
                <ListItem
                  key={l.id}
                  endAction={
                    <Dropdown>
                      <MenuButton
                        slots={{ root: IconButton }}
                        slotProps={{
                          root: {
                            size: "sm",
                            variant: "plain",
                            "aria-label": "List options",
                          },
                        }}
                      >
                        <MoreVertIcon sx={{ fontSize: 16 }} />
                      </MenuButton>
                      <Menu size="sm" placement="bottom-end">
                        <MenuItem
                          onClick={() => {
                            setRenaming(l);
                            setRenameValue(l.name);
                          }}
                        >
                          <ListItemDecorator>
                            <EditOutlinedIcon />
                          </ListItemDecorator>
                          Rename
                        </MenuItem>
                        <ListDivider />
                        <MenuItem
                          color="danger"
                          onClick={() => handleDeleteList(l)}
                        >
                          <ListItemDecorator>
                            <DeleteOutlineIcon />
                          </ListItemDecorator>
                          Delete list
                        </MenuItem>
                      </Menu>
                    </Dropdown>
                  }
                >
                  <ListItemButton
                    selected={l.id === selectedListId}
                    onClick={() => setSelectedListId(l.id)}
                    sx={{ borderRadius: "6px" }}
                  >
                    <Typography noWrap sx={{ fontSize: "sm" }}>
                      {l.name}
                    </Typography>
                  </ListItemButton>
                </ListItem>
              ))}
            </List>

            {addingList ? (
              <Box sx={{ px: 1, pb: 1, display: "flex", gap: 0.5 }}>
                <Input
                  size="sm"
                  autoFocus
                  placeholder="List name"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddList();
                    if (e.key === "Escape") setAddingList(false);
                  }}
                  sx={{ flex: 1 }}
                />
                <Button size="sm" onClick={handleAddList}>
                  Add
                </Button>
              </Box>
            ) : (
              <Box sx={{ px: 1, pb: 1 }}>
                <Button
                  size="sm"
                  variant="plain"
                  color="neutral"
                  startDecorator={<AddIcon />}
                  onClick={() => setAddingList(true)}
                  sx={{ width: "100%", justifyContent: "flex-start" }}
                >
                  New list
                </Button>
              </Box>
            )}
          </Sheet>

          {/* Main: task list panel */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {lists === null && !error && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress />
              </Box>
            )}

            {lists !== null && selectedList === null && (
              <Sheet
                variant="soft"
                sx={{ p: 4, borderRadius: "md", textAlign: "center" }}
              >
                <Typography level="body-lg" sx={{ opacity: 0.7 }}>
                  Create a list to get started.
                </Typography>
              </Sheet>
            )}

            {selectedList && (
              <>
                <Typography level="h3" sx={{ mb: 2 }}>
                  {selectedList.name}
                </Typography>

                {/* Add task input */}
                <Sheet
                  variant="outlined"
                  sx={{
                    borderRadius: "md",
                    display: "flex",
                    alignItems: "center",
                    px: 1.5,
                    py: 0.75,
                    mb: 2,
                    gap: 1,
                  }}
                >
                  <AddIcon sx={{ opacity: 0.4 }} />
                  <Input
                    ref={newTaskRef}
                    variant="plain"
                    placeholder="Add a task"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddTask();
                    }}
                    sx={{ flex: 1, "--Input-focusedThickness": "0px" }}
                  />
                  {newTaskTitle && (
                    <Button size="sm" onClick={handleAddTask}>
                      Add
                    </Button>
                  )}
                </Sheet>

                {loadingTasks && (
                  <Box
                    sx={{ display: "flex", justifyContent: "center", py: 3 }}
                  >
                    <CircularProgress size="sm" />
                  </Box>
                )}

                {!loadingTasks && tasks.length === 0 && (
                  <Sheet
                    variant="soft"
                    sx={{ p: 3, borderRadius: "md", textAlign: "center" }}
                  >
                    <Typography level="body-md" sx={{ opacity: 0.6 }}>
                      No tasks yet.
                    </Typography>
                  </Sheet>
                )}

                {/* Active tasks */}
                {!loadingTasks && activeTasks.length > 0 && (
                  <List size="sm" sx={{ "--List-gap": "2px", mb: 1 }}>
                    {activeTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        subtasks={subtasksFor(task.id)}
                        onToggle={() => handleToggle(task)}
                        onEdit={() => openEdit(task)}
                        onDelete={() => handleDeleteTask(task)}
                        onToggleSubtask={(st) => handleToggle(st)}
                        onDeleteSubtask={(st) => handleDeleteTask(st)}
                        onEditSubtask={(st) => openEdit(st)}
                      />
                    ))}
                  </List>
                )}

                {/* Completed section */}
                {!loadingTasks && completedTasks.length > 0 && (
                  <Box>
                    <Divider sx={{ my: 1 }} />
                    <Button
                      variant="plain"
                      color="neutral"
                      size="sm"
                      startDecorator={
                        completedExpanded ? (
                          <ExpandLessIcon />
                        ) : (
                          <ExpandMoreIcon />
                        )
                      }
                      onClick={() => setCompletedExpanded((v) => !v)}
                      sx={{ mb: 0.5 }}
                    >
                      Completed ({completedTasks.length})
                    </Button>
                    {completedExpanded && (
                      <List
                        size="sm"
                        sx={{ "--List-gap": "2px", opacity: 0.6 }}
                      >
                        {completedTasks.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            subtasks={[]}
                            onToggle={() => handleToggle(task)}
                            onEdit={() => openEdit(task)}
                            onDelete={() => handleDeleteTask(task)}
                            onToggleSubtask={() => {}}
                            onDeleteSubtask={() => {}}
                            onEditSubtask={() => {}}
                          />
                        ))}
                      </List>
                    )}
                  </Box>
                )}
              </>
            )}
          </Box>
        </Box>
      </Container>

      {/* Rename list modal */}
      {renaming && (
        <Modal open onClose={() => setRenaming(null)}>
          <ModalDialog sx={{ width: 360 }}>
            <Typography level="title-md" sx={{ mb: 1.5 }}>
              Rename list
            </Typography>
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameList();
              }}
              sx={{ mb: 2 }}
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
              <Button
                variant="plain"
                color="neutral"
                onClick={() => setRenaming(null)}
              >
                Cancel
              </Button>
              <Button onClick={handleRenameList}>Rename</Button>
            </Box>
          </ModalDialog>
        </Modal>
      )}

      {/* Edit task modal */}
      {editingTask && (
        <Modal open onClose={() => setEditingTask(null)}>
          <ModalDialog
            sx={{ width: { xs: "100vw", sm: 480 }, maxWidth: "100vw" }}
          >
            <Typography level="title-md" sx={{ mb: 1.5 }}>
              Edit task
            </Typography>
            <Input
              autoFocus
              placeholder="Title"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              sx={{ mb: 1.5 }}
            />
            <Textarea
              placeholder="Notes"
              minRows={3}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              sx={{ mb: 1.5 }}
            />
            <Box sx={{ mb: 2 }}>
              <Typography level="body-xs" sx={{ mb: 0.5, opacity: 0.7 }}>
                Due date (optional)
              </Typography>
              <Input
                type="date"
                value={editDueAt}
                onChange={(e) => setEditDueAt(e.target.value)}
              />
            </Box>
            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
              <Button
                variant="plain"
                color="neutral"
                onClick={() => setEditingTask(null)}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveEdit}>Save</Button>
            </Box>
          </ModalDialog>
        </Modal>
      )}
    </>
  );
}

interface TaskRowProps {
  task: Task;
  subtasks: Task[];
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleSubtask: (t: Task) => void;
  onDeleteSubtask: (t: Task) => void;
  onEditSubtask: (t: Task) => void;
}

function TaskRow({
  task,
  subtasks,
  onToggle,
  onEdit,
  onDelete,
  onToggleSubtask,
  onDeleteSubtask,
  onEditSubtask,
}: TaskRowProps) {
  const hasDue = task.due_at && !task.completed;
  const dueLabel = hasDue ? formatDue(task.due_at) : null;
  const isOverdue = hasDue && new Date(task.due_at) < new Date();

  return (
    <>
      <ListItem
        sx={{ borderRadius: "md" }}
        endAction={
          <Box sx={{ display: "flex", gap: 0.25 }}>
            <Tooltip title="Edit" size="sm">
              <IconButton
                size="sm"
                variant="plain"
                onClick={onEdit}
                aria-label="Edit task"
              >
                <EditOutlinedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete" size="sm">
              <IconButton
                size="sm"
                variant="plain"
                color="danger"
                onClick={onDelete}
                aria-label="Delete task"
              >
                <DeleteOutlineIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        }
      >
        <Checkbox
          size="sm"
          checked={task.completed}
          onChange={onToggle}
          label={
            <Box>
              <Typography
                level="body-sm"
                sx={{
                  textDecoration: task.completed ? "line-through" : "none",
                  opacity: task.completed ? 0.5 : 1,
                }}
              >
                {task.title}
              </Typography>
              {dueLabel && (
                <Typography
                  level="body-xs"
                  color={isOverdue ? "danger" : "neutral"}
                  sx={{ opacity: 0.8 }}
                >
                  {dueLabel}
                </Typography>
              )}
              {task.notes && (
                <Typography
                  level="body-xs"
                  sx={{ opacity: 0.6, whiteSpace: "pre-wrap" }}
                >
                  {task.notes.slice(0, 80)}
                  {task.notes.length > 80 ? "…" : ""}
                </Typography>
              )}
            </Box>
          }
        />
      </ListItem>
      {subtasks.map((st) => (
        <ListItem
          key={st.id}
          sx={{ pl: 4, borderRadius: "md" }}
          endAction={
            <Box sx={{ display: "flex", gap: 0.25 }}>
              <IconButton
                size="sm"
                variant="plain"
                onClick={() => onEditSubtask(st)}
                aria-label="Edit subtask"
              >
                <EditOutlinedIcon sx={{ fontSize: 14 }} />
              </IconButton>
              <IconButton
                size="sm"
                variant="plain"
                color="danger"
                onClick={() => onDeleteSubtask(st)}
                aria-label="Delete subtask"
              >
                <DeleteOutlineIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          }
        >
          <Checkbox
            size="sm"
            checked={st.completed}
            onChange={() => onToggleSubtask(st)}
            label={
              <Typography
                level="body-xs"
                sx={{
                  textDecoration: st.completed ? "line-through" : "none",
                  opacity: st.completed ? 0.5 : 1,
                }}
              >
                {st.title}
              </Typography>
            }
          />
        </ListItem>
      ))}
    </>
  );
}

function formatDue(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return isoStr;
  }
}
