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
  Checkbox,
  Chip,
  CircularProgress,
} from "@mui/joy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import { listRules, createRule, deleteRule } from "./api";
import type { MailRule, RuleInput } from "./types";

const EMPTY: RuleInput = {
  name: "",
  match_from: "",
  match_to: "",
  match_subject: "",
  act_label: "",
  act_folder: "",
  act_forward: "",
  act_mark_read: false,
  act_star: false,
};

function summary(r: MailRule): string {
  const crit: string[] = [];
  if (r.match_from) crit.push(`from contains “${r.match_from}”`);
  if (r.match_to) crit.push(`to contains “${r.match_to}”`);
  if (r.match_subject) crit.push(`subject contains “${r.match_subject}”`);
  const act: string[] = [];
  if (r.act_forward) act.push(`forward to ${r.act_forward}`);
  if (r.act_folder) act.push(`move to ${r.act_folder}`);
  if (r.act_label) act.push(`label “${r.act_label}”`);
  if (r.act_mark_read) act.push("mark read");
  if (r.act_star) act.push("star");
  return `If ${crit.join(" and ") || "—"} → ${act.join(", ") || "—"}`;
}

/** RulesDialog manages mail filters (Gmail "Filters and blocked addresses"):
 *  match on from/to/subject, then forward/redirect, move, label, mark read, star. */
export function RulesDialog({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<MailRule[] | null>(null);
  const [form, setForm] = useState<RuleInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof RuleInput>(k: K, v: RuleInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function reload() {
    try {
      setRules(await listRules());
    } catch {
      setRules([]);
    }
  }
  useEffect(() => {
    reload();
  }, []);

  async function add() {
    if (!form.match_from && !form.match_to && !form.match_subject) {
      window.alert("Add at least one match criterion.");
      return;
    }
    if (
      !form.act_forward &&
      !form.act_folder &&
      !form.act_label &&
      !form.act_mark_read &&
      !form.act_star
    ) {
      window.alert("Add at least one action.");
      return;
    }
    setSaving(true);
    try {
      await createRule(form);
      setForm(EMPTY);
      await reload();
    } catch (e) {
      window.alert(`Couldn’t save rule: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    setRules((cur) => (cur ?? []).filter((r) => r.id !== id));
    try {
      await deleteRule(id);
    } catch {
      reload();
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{
          width: 640,
          maxWidth: "96vw",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <ModalClose />
        <Typography level="h4">Filters and rules</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7, mb: 1 }}>
          Automatically handle incoming mail — redirect, move, label, mark read,
          or star.
        </Typography>

        {/* Existing rules */}
        {rules === null ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size="sm" />
          </Box>
        ) : rules.length === 0 ? (
          <Typography level="body-sm" sx={{ opacity: 0.6, py: 1 }}>
            No rules yet.
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mb: 1 }}>
            {rules.map((r) => (
              <Sheet
                key={r.id}
                variant="outlined"
                sx={{
                  p: 1,
                  borderRadius: "sm",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  {r.name && <Typography level="title-sm">{r.name}</Typography>}
                  <Typography level="body-xs" sx={{ opacity: 0.8 }}>
                    {summary(r)}
                  </Typography>
                </Box>
                <IconButton
                  size="sm"
                  variant="plain"
                  color="danger"
                  onClick={() => remove(r.id)}
                  aria-label="Delete rule"
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Sheet>
            ))}
          </Stack>
        )}

        <Divider sx={{ my: 1.5 }} />
        <Typography level="title-sm" sx={{ mb: 1 }}>
          Create a rule
        </Typography>
        <Stack spacing={1}>
          <FormControl>
            <FormLabel>Name (optional)</FormLabel>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </FormControl>
          <Typography level="body-xs" sx={{ opacity: 0.7 }}>
            When a message matches (all that are filled):
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <FormControl sx={{ flex: 1, minWidth: 160 }}>
              <FormLabel>From contains</FormLabel>
              <Input
                value={form.match_from}
                onChange={(e) => set("match_from", e.target.value)}
              />
            </FormControl>
            <FormControl sx={{ flex: 1, minWidth: 160 }}>
              <FormLabel>To contains</FormLabel>
              <Input
                value={form.match_to}
                onChange={(e) => set("match_to", e.target.value)}
              />
            </FormControl>
            <FormControl sx={{ flex: 1, minWidth: 160 }}>
              <FormLabel>Subject contains</FormLabel>
              <Input
                value={form.match_subject}
                onChange={(e) => set("match_subject", e.target.value)}
              />
            </FormControl>
          </Box>
          <Typography level="body-xs" sx={{ opacity: 0.7, mt: 0.5 }}>
            Then:
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <FormControl sx={{ flex: 1, minWidth: 160 }}>
              <FormLabel>Forward to (redirect)</FormLabel>
              <Input
                placeholder="name@org"
                value={form.act_forward}
                onChange={(e) => set("act_forward", e.target.value)}
              />
            </FormControl>
            <FormControl sx={{ flex: 1, minWidth: 120 }}>
              <FormLabel>Move to folder</FormLabel>
              <Input
                placeholder="trash, spam, …"
                value={form.act_folder}
                onChange={(e) => set("act_folder", e.target.value)}
              />
            </FormControl>
            <FormControl sx={{ flex: 1, minWidth: 120 }}>
              <FormLabel>Apply label</FormLabel>
              <Input
                value={form.act_label}
                onChange={(e) => set("act_label", e.target.value)}
              />
            </FormControl>
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <Checkbox
              label="Mark as read"
              checked={form.act_mark_read}
              onChange={(e) => set("act_mark_read", e.target.checked)}
            />
            <Checkbox
              label="Star it"
              checked={form.act_star}
              onChange={(e) => set("act_star", e.target.checked)}
            />
          </Box>
          <Box
            sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1 }}
          >
            <Button variant="plain" color="neutral" onClick={onClose}>
              Close
            </Button>
            <Button startDecorator={<AddIcon />} loading={saving} onClick={add}>
              Create rule
            </Button>
          </Box>
        </Stack>
        <Chip size="sm" variant="soft" sx={{ mt: 1 }}>
          Rules run on internal delivery now; they map to Sieve once mailcow is
          connected.
        </Chip>
      </ModalDialog>
    </Modal>
  );
}
