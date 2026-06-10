import { useEffect, useRef, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  FormControl,
  FormLabel,
  Input,
  Button,
  Box,
  Stack,
  Sheet,
  IconButton,
  Divider,
  CircularProgress,
} from "@mui/joy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import AddIcon from "@mui/icons-material/Add";
import {
  listLabelsWithEntities,
  createMailLabel,
  updateMailLabel,
  deleteMailLabel,
} from "./api";
import type { MailLabelEntity } from "./types";

const PRESET_COLORS = [
  "#3D5A80",
  "#E0777D",
  "#5B9279",
  "#C46B45",
  "#7A5980",
  "#2A9D8F",
  "#D9A441",
  "#1D8348",
  "#2E86C1",
  "#A04000",
];

interface Props {
  onClose: () => void;
  /** Called after any create/update/delete so the parent can refresh. */
  onChange?: () => void;
}

/** LabelManagerDialog provides create / rename / recolor / delete for label entities. */
export function LabelManagerDialog({ onClose, onChange }: Props) {
  const [labels, setLabels] = useState<MailLabelEntity[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  // editing: the id being renamed/recolored
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);

  async function reload() {
    try {
      const r = await listLabelsWithEntities();
      setLabels(r.label_objects ?? []);
    } catch {
      setLabels([]);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      window.alert("Label name is required.");
      return;
    }
    setSaving(true);
    try {
      await createMailLabel(name, newColor);
      setNewName("");
      setNewColor(PRESET_COLORS[0]);
      await reload();
      onChange?.();
    } catch (e) {
      window.alert(`Couldn't create label: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(l: MailLabelEntity) {
    setEditingId(l.id);
    setEditName(l.name);
    setEditColor(l.color || PRESET_COLORS[0]);
    setTimeout(() => editInputRef.current?.focus(), 50);
  }

  async function commitEdit(id: string) {
    const name = editName.trim();
    if (!name) {
      window.alert("Label name is required.");
      return;
    }
    setSaving(true);
    try {
      await updateMailLabel(id, name, editColor);
      setEditingId(null);
      await reload();
      onChange?.();
    } catch (e) {
      window.alert(`Couldn't update label: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (
      !window.confirm(
        "Delete this label? It will be removed from all messages.",
      )
    )
      return;
    setLabels((cur) => (cur ?? []).filter((l) => l.id !== id));
    try {
      await deleteMailLabel(id);
      await reload();
      onChange?.();
    } catch {
      reload();
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{
          width: 520,
          maxWidth: "96vw",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <ModalClose />
        <Typography level="h4">Manage labels</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7, mb: 1 }}>
          Create named, colored labels to organize your mail.
        </Typography>

        {labels === null ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size="sm" />
          </Box>
        ) : labels.length === 0 ? (
          <Typography level="body-sm" sx={{ opacity: 0.6, py: 1 }}>
            No labels yet.
          </Typography>
        ) : (
          <Stack spacing={0.75} sx={{ mb: 1 }}>
            {labels.map((l) => (
              <Sheet
                key={l.id}
                variant="outlined"
                sx={{
                  p: 1,
                  borderRadius: "sm",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                {editingId === l.id ? (
                  <>
                    {/* Color picker row */}
                    <Box
                      sx={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 0.5,
                        mr: 0.5,
                      }}
                    >
                      {PRESET_COLORS.map((c) => (
                        <Box
                          key={c}
                          onClick={() => setEditColor(c)}
                          sx={{
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            bgcolor: c,
                            cursor: "pointer",
                            outline: editColor === c ? "2px solid" : "none",
                            outlineColor: "primary.500",
                            outlineOffset: "1px",
                          }}
                        />
                      ))}
                    </Box>
                    <Input
                      slotProps={{ input: { ref: editInputRef } }}
                      size="sm"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(l.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      sx={{ flex: 1 }}
                    />
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="success"
                      onClick={() => commitEdit(l.id)}
                      disabled={saving}
                      aria-label="Save"
                    >
                      <CheckIcon />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <Box
                      sx={{
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        bgcolor: l.color || "#3D5A80",
                        flexShrink: 0,
                      }}
                    />
                    <Typography level="body-sm" sx={{ flex: 1 }} noWrap>
                      {l.name}
                    </Typography>
                    <IconButton
                      size="sm"
                      variant="plain"
                      onClick={() => startEdit(l)}
                      aria-label="Edit"
                    >
                      <EditIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="danger"
                      onClick={() => handleDelete(l.id)}
                      aria-label="Delete"
                    >
                      <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </>
                )}
              </Sheet>
            ))}
          </Stack>
        )}

        <Divider sx={{ my: 1.5 }} />
        <Typography level="title-sm" sx={{ mb: 1 }}>
          Create label
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
          {PRESET_COLORS.map((c) => (
            <Box
              key={c}
              onClick={() => setNewColor(c)}
              sx={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                bgcolor: c,
                cursor: "pointer",
                outline: newColor === c ? "2px solid" : "none",
                outlineColor: "primary.500",
                outlineOffset: "2px",
              }}
            />
          ))}
        </Box>
        <FormControl>
          <FormLabel>Label name</FormLabel>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder="e.g. Work, Personal…"
          />
        </FormControl>
        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1.5 }}
        >
          <Button variant="plain" color="neutral" onClick={onClose}>
            Close
          </Button>
          <Button
            startDecorator={<AddIcon />}
            loading={saving}
            onClick={handleCreate}
          >
            Create
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
