import { useEffect, useState } from "react";
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
  Select,
  Option,
  Chip,
  CircularProgress,
} from "@mui/joy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import {
  listFilters,
  createFilter,
  deleteFilter,
  applyFiltersNow,
} from "./api";
import type { MailFilter, FilterInput } from "./types";

const MATCH_FIELDS = ["from", "to", "subject", "body"];
const MATCH_OPS = ["contains", "equals"];
const ACTION_TYPES = ["label", "mark_read", "archive", "star"];

const EMPTY: FilterInput = {
  match_field: "subject",
  match_op: "contains",
  match_value: "",
  action_type: "label",
  action_value: "",
};

function filterSummary(f: MailFilter): string {
  const crit = `${f.match_field} ${f.match_op} "${f.match_value}"`;
  let act = f.action_type;
  if (f.action_type === "label" && f.action_value)
    act = `label "${f.action_value}"`;
  return `If ${crit} → ${act}`;
}

interface Props {
  onClose: () => void;
}

/** FiltersDialog manages normalized mail filters (match_field/op/value + action). */
export function FiltersDialog({ onClose }: Props) {
  const [filters, setFilters] = useState<MailFilter[] | null>(null);
  const [form, setForm] = useState<FilterInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lastApply, setLastApply] = useState<string | null>(null);

  const set = <K extends keyof FilterInput>(k: K, v: FilterInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function reload() {
    try {
      setFilters(await listFilters());
    } catch {
      setFilters([]);
    }
  }
  useEffect(() => {
    reload();
  }, []);

  async function handleCreate() {
    if (!form.match_value.trim()) {
      window.alert("Match value is required.");
      return;
    }
    if (form.action_type === "label" && !form.action_value.trim()) {
      window.alert("Label name is required for the label action.");
      return;
    }
    setSaving(true);
    try {
      await createFilter({
        ...form,
        match_value: form.match_value.trim(),
        action_value: form.action_value.trim(),
      });
      setForm(EMPTY);
      await reload();
    } catch (e) {
      window.alert(`Couldn't save filter: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setFilters((cur) => (cur ?? []).filter((f) => f.id !== id));
    try {
      await deleteFilter(id);
    } catch {
      reload();
    }
  }

  async function handleApplyNow() {
    setApplying(true);
    try {
      const r = await applyFiltersNow();
      setLastApply(
        `Applied filters: ${r.modified} message${r.modified === 1 ? "" : "s"} updated.`,
      );
    } catch (e) {
      setLastApply(`Error: ${(e as Error).message}`);
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{
          width: 580,
          maxWidth: "96vw",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <ModalClose />
        <Typography level="h4">Mail filters</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7, mb: 1 }}>
          Match incoming messages and automatically apply actions (label, mark
          read, archive, star).
        </Typography>

        {/* Existing filters */}
        {filters === null ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size="sm" />
          </Box>
        ) : filters.length === 0 ? (
          <Typography level="body-sm" sx={{ opacity: 0.6, py: 1 }}>
            No filters yet.
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mb: 1 }}>
            {filters.map((f) => (
              <Sheet
                key={f.id}
                variant="outlined"
                sx={{
                  p: 1,
                  borderRadius: "sm",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <Typography level="body-xs" sx={{ flex: 1, opacity: 0.85 }}>
                  {filterSummary(f)}
                </Typography>
                <IconButton
                  size="sm"
                  variant="plain"
                  color="danger"
                  onClick={() => handleDelete(f.id)}
                  aria-label="Delete filter"
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Sheet>
            ))}
          </Stack>
        )}

        {/* Apply all now */}
        {filters && filters.length > 0 && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <Button
              size="sm"
              variant="outlined"
              startDecorator={<PlayArrowIcon />}
              loading={applying}
              onClick={handleApplyNow}
            >
              Apply all filters now
            </Button>
            {lastApply && (
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                {lastApply}
              </Typography>
            )}
          </Box>
        )}

        <Divider sx={{ my: 1.5 }} />
        <Typography level="title-sm" sx={{ mb: 1 }}>
          Create filter
        </Typography>
        <Stack spacing={1}>
          <Box
            sx={{
              display: "flex",
              gap: 1,
              flexWrap: "wrap",
              alignItems: "flex-end",
            }}
          >
            <FormControl sx={{ minWidth: 110 }}>
              <FormLabel>Field</FormLabel>
              <Select
                size="sm"
                value={form.match_field}
                onChange={(_, v) => v && set("match_field", v)}
              >
                {MATCH_FIELDS.map((f) => (
                  <Option key={f} value={f}>
                    {f}
                  </Option>
                ))}
              </Select>
            </FormControl>
            <FormControl sx={{ minWidth: 110 }}>
              <FormLabel>Operator</FormLabel>
              <Select
                size="sm"
                value={form.match_op}
                onChange={(_, v) => v && set("match_op", v)}
              >
                {MATCH_OPS.map((o) => (
                  <Option key={o} value={o}>
                    {o}
                  </Option>
                ))}
              </Select>
            </FormControl>
            <FormControl sx={{ flex: 1, minWidth: 150 }}>
              <FormLabel>Value</FormLabel>
              <Input
                size="sm"
                value={form.match_value}
                onChange={(e) => set("match_value", e.target.value)}
                placeholder="e.g. newsletter"
              />
            </FormControl>
          </Box>

          <Box
            sx={{
              display: "flex",
              gap: 1,
              flexWrap: "wrap",
              alignItems: "flex-end",
            }}
          >
            <FormControl sx={{ minWidth: 130 }}>
              <FormLabel>Action</FormLabel>
              <Select
                size="sm"
                value={form.action_type}
                onChange={(_, v) => v && set("action_type", v)}
              >
                {ACTION_TYPES.map((a) => (
                  <Option key={a} value={a}>
                    {a.replace("_", " ")}
                  </Option>
                ))}
              </Select>
            </FormControl>
            {form.action_type === "label" && (
              <FormControl sx={{ flex: 1, minWidth: 150 }}>
                <FormLabel>Label name</FormLabel>
                <Input
                  size="sm"
                  value={form.action_value}
                  onChange={(e) => set("action_value", e.target.value)}
                  placeholder="e.g. Newsletters"
                />
              </FormControl>
            )}
          </Box>

          <Box
            sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1 }}
          >
            <Button variant="plain" color="neutral" onClick={onClose}>
              Close
            </Button>
            <Button
              startDecorator={<AddIcon />}
              loading={saving}
              onClick={handleCreate}
            >
              Create filter
            </Button>
          </Box>
        </Stack>

        <Chip size="sm" variant="soft" sx={{ mt: 1 }}>
          Filters run on delivery. Use "Apply all filters now" to apply to
          existing inbox messages.
        </Chip>
      </ModalDialog>
    </Modal>
  );
}
