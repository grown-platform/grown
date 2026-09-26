// Tools > AutoCorrect options: toggles for each as-you-type correction, the
// replacement list and the capitalisation exceptions. Saving applies the
// settings to the editor and stores them for the user.
import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Divider,
  IconButton,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Stack,
  Textarea,
  Typography,
} from "@mui/joy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { DEFAULT_AUTOCORRECT, type AutoCorrectSettings } from "./autocorrect";

interface Props {
  open: boolean;
  onClose: () => void;
  settings: AutoCorrectSettings;
  onSave: (s: AutoCorrectSettings) => void;
}

const TOGGLES: { key: keyof AutoCorrectSettings; label: string }[] = [
  { key: "capitalizeSentences", label: "Capitalize first letter of sentences" },
  { key: "capitalizeCells", label: "Capitalize first letter of table cells" },
  { key: "smartQuotes", label: 'Replace "straight quotes" with “smart quotes”' },
  { key: "dashes", label: "Replace -- with an em dash (—)" },
  { key: "doubleSpacePeriod", label: "Add a period with a double space" },
  { key: "replaceText", label: "Replace text as you type" },
];

export function AutoCorrectDialog({ open, onClose, settings, onSave }: Props) {
  const [draft, setDraft] = useState(settings);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exceptions, setExceptions] = useState(settings.exceptions.join(" "));

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setExceptions(settings.exceptions.join(" "));
      setFrom("");
      setTo("");
    }
  }, [open, settings]);

  const add = () => {
    if (!from) return;
    setDraft((d) => ({
      ...d,
      replacements: [...d.replacements.filter((r) => r.from !== from), { from, to }],
    }));
    setFrom("");
    setTo("");
  };
  const save = () => {
    onSave({ ...draft, exceptions: exceptions.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean) });
    onClose();
  };
  const reset = () => {
    setDraft(DEFAULT_AUTOCORRECT);
    setExceptions(DEFAULT_AUTOCORRECT.exceptions.join(" "));
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        data-testid="docs-autocorrect-dialog"
        sx={{ width: { xs: "calc(100vw - 32px)", sm: 520 }, maxWidth: "calc(100vw - 32px)", overflowY: "auto" }}
      >
        <ModalClose />
        <Typography level="h4">AutoCorrect</Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {TOGGLES.map((t) => (
            <Checkbox
              key={t.key}
              size="sm"
              label={t.label}
              checked={!!draft[t.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [t.key]: e.target.checked }))}
              slotProps={{ input: { "data-testid": `autocorrect-${t.key}` } as Record<string, string> }}
            />
          ))}
          <Divider />
          <Typography level="title-sm">Replacements</Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Input size="sm" placeholder="Replace" value={from} onChange={(e) => setFrom(e.target.value)} sx={{ flex: 1 }} slotProps={{ input: { "aria-label": "Replace" } }} />
            <Input
              size="sm"
              placeholder="With"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              sx={{ flex: 1 }}
              slotProps={{ input: { "aria-label": "With" } }}
            />
            <Button size="sm" variant="soft" onClick={add} disabled={!from}>
              Add
            </Button>
          </Box>
          <Box sx={{ maxHeight: 180, overflowY: "auto", border: "1px solid", borderColor: "divider", borderRadius: "sm" }}>
            {draft.replacements.map((r) => (
              <Box
                key={r.from}
                sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.25, "&:not(:last-of-type)": { borderBottom: "1px solid", borderColor: "divider" } }}
              >
                <Typography level="body-sm" sx={{ flex: 1, fontFamily: "monospace" }}>{r.from}</Typography>
                <Typography level="body-sm" sx={{ flex: 1 }}>{r.to}</Typography>
                <IconButton
                  size="sm"
                  variant="plain"
                  aria-label={`Remove ${r.from}`}
                  onClick={() => setDraft((d) => ({ ...d, replacements: d.replacements.filter((x) => x.from !== r.from) }))}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Box>
            ))}
            {!draft.replacements.length && (
              <Typography level="body-sm" sx={{ p: 1, opacity: 0.6 }}>No replacements</Typography>
            )}
          </Box>
          <Typography level="title-sm">Don't capitalize after</Typography>
          <Textarea size="sm" minRows={2} value={exceptions} onChange={(e) => setExceptions(e.target.value)} />
          <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
            <Button variant="plain" color="neutral" onClick={reset} sx={{ mr: "auto" }}>
              Reset to defaults
            </Button>
            <Button variant="plain" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} data-testid="autocorrect-save">
              Save
            </Button>
          </Box>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
